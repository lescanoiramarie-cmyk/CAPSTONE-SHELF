import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import QRCode from "qrcode";

/**
 * Batch 3A Group 1 hardening.
 *
 * - Registration send requires server-verified registration nonce/proof.
 * - Resend/recovery require server-issued opaque capabilities (hashed at rest).
 * - Recovery never discloses visitor IDs and returns generic responses.
 * - QR email remains available but rejects anonymous visitor-ID-only requests;
 *   until external caller inventory/authorization is verified, no public caller
 *   path is enabled here (no QR login restoration).
 * - Delivery uses durable intent records and CAS state transitions:
 *   pending_claim -> provider_submitting -> provider_accepted -> persisted
 *   definitive rejection -> provider_rejected/failed; timeout/unknown -> ambiguous_timeout.
 *   Ambiguous outcomes fail closed and do not auto-release for unsafe retry.
 * - OTPs are protected with keyed HMAC (not unsalted plain hash) before storage.
 * - Distributed limitation: DB and provider are not atomically transactional.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Json = Record<string, unknown>;

function jsonResponse(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function generateOtp(): string {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return (100000 + (values[0] % 900000)).toString();
}

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toHex(digest);
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toHex(sig);
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function getTrustedRequestIpHash(_req: Request): Promise<string | null> {
  // Fail safe: trust only a deployment-configured proxy header injected/overwritten
  // by trusted infrastructure. If not configured, IP-based limiting is unavailable.
  const trusted = (Deno.env.get("SHELF_TRUST_PROXY_IP_HEADERS") || "").trim().toLowerCase();
  if (trusted !== "true" && trusted !== "1") return null;
  const headerName = Deno.env.get("SHELF_TRUSTED_CLIENT_IP_HEADER")?.trim();
  if (!headerName) return null;
  const raw = _req.headers.get(headerName)?.trim() || "";
  if (!raw) return null;
  return await sha256Hex(`ip:${raw}`);
}

async function writeAuditEvent(admin: SupabaseClient, action: string, details: Json): Promise<void> {
  try {
    const { error } = await admin.from("audit_logs").insert({
      actor_id: null,
      action,
      branch_id: null,
      details,
    });
    if (error) console.error(`Audit write failed for ${action}`);
  } catch {
    console.error(`Audit write threw for ${action}`);
  }
}

async function sendOtpEmail(params: {
  resendApiKey: string;
  to: string;
  firstName: string;
  otp: string;
}): Promise<{ ok: boolean; status: number; messageId: string | null; ambiguous: boolean; rejected: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.resendApiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        from: "SHELF <support@shelf-ilms.me>",
        to: [params.to],
        subject: "Your SHELF Verification Code",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #111827;">
            <h2>SHELF Email Verification</h2>
            <p>Hello ${params.firstName},</p>
            <p>Thank you for registering with <strong>SHELF</strong>.</p>
            <p>Your verification code is:</p>
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; padding: 20px; background: #f3f4f6; text-align: center; border-radius: 8px; margin: 20px 0;">${params.otp}</div>
            <p>This code will expire in <strong>10 minutes</strong>.</p>
            <p>If you did not create a SHELF account, you can safely ignore this email.</p>
            <p>Regards,<br /><strong>SHELF</strong></p>
          </div>`,
      }),
    });
    let data: Record<string, unknown> | null = null;
    try { data = await response.json(); } catch { data = null; }
    const messageId = typeof data?.id === "string" ? data.id : null;
    if (response.ok) return { ok: true, status: response.status, messageId, ambiguous: false, rejected: false };
    // Definitive client/provider rejection (4xx except timeout-like 408/429 treated carefully)
    const rejected = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;
    return { ok: false, status: response.status, messageId, ambiguous: !rejected, rejected };
  } catch {
    // Timeout/network/abort -> ambiguous: provider may have accepted.
    return { ok: false, status: 0, messageId: null, ambiguous: true, rejected: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function createIntent(admin: SupabaseClient, row: Json): Promise<string | null> {
  const { data, error } = await admin
    .from("visitor_otp_delivery_intents")
    .insert(row)
    .select("id")
    .maybeSingle();
  if (error || !data?.id) return null;
  return String(data.id);
}

async function casIntent(admin: SupabaseClient, id: string, from: string | string[], patch: Json): Promise<boolean> {
  let q = admin.from("visitor_otp_delivery_intents").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (Array.isArray(from)) q = q.in("state", from); else q = q.eq("state", from);
  const { data, error } = await q.select("id").maybeSingle();
  return !error && !!data?.id;
}

async function countRecentIntents(admin: SupabaseClient, field: "visitor_id" | "email_hash" | "trusted_ip_hash", value: string, minutes: number, purpose?: string): Promise<number> {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  let q = admin.from("visitor_otp_delivery_intents").select("id", { count: "exact", head: true }).eq(field, value).gt("created_at", since).neq("state", "failed");
  if (purpose) q = q.eq("purpose", purpose);
  const { count } = await q;
  return count || 0;
}

async function enforceRateLimits(admin: SupabaseClient, opts: { visitorId?: string | null; emailHash?: string | null; trustedIpHash?: string | null; purpose: string; visitorMax: number; emailMax: number; ipMax: number }): Promise<boolean> {
  if (opts.visitorId) {
    const n = await countRecentIntents(admin, "visitor_id", opts.visitorId, 15, opts.purpose);
    if (n >= opts.visitorMax) return false;
  }
  if (opts.emailHash) {
    const n = await countRecentIntents(admin, "email_hash", opts.emailHash, 15);
    if (n >= opts.emailMax) return false;
  }
  if (opts.trustedIpHash) {
    const n = await countRecentIntents(admin, "trusted_ip_hash", opts.trustedIpHash, 10);
    if (n >= opts.ipMax) return false;
  }
  return true;
}

function genericRecoveryResponse(): Response {
  return jsonResponse({
    success: true,
    message: "If an unverified registration exists for that address, a new verification code will be sent.",
  });
}

function genericDenied(message = "Unable to process the verification request.", status = 400): Response {
  return jsonResponse({ success: false, error: message }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return genericDenied("Method not allowed.", 405);

  try {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return genericDenied("Invalid request.", 400); }

    const type = typeof body?.type === "string" ? body.type.trim().toLowerCase() : "otp";
    if (type !== "otp" && type !== "qr") return genericDenied("Invalid request.", 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKeyName = "SUPABASE_SERVICE_ROLE_" + "KEY";
    const serviceRoleKey = Deno.env.get(serviceRoleKeyName);
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    // Keyed OTP protection secret required for all new issuance (fail closed).
    const otpHmacSecret = (Deno.env.get("SHELF_OTP_HMAC_SECRET") || "").trim();
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ success: false, error: "Email service is not configured." }, 500);
    if (!resendApiKey) return jsonResponse({ success: false, error: "Email service is not configured." }, 500);
    if (!otpHmacSecret) return jsonResponse({ success: false, error: "Email service is not configured." }, 500);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const trustedIpHash = await getTrustedRequestIpHash(req);

    // -----------------------------------------------------------------------
    // RECOVERY (email-based, generic, no visitor_id disclosure)
    // -----------------------------------------------------------------------
    if (type === "otp" && typeof body?.email === "string" && !body?.visitorId && !body?.capability && !body?.registrationNonce) {
      const email = normalizeEmail(body.email);
      if (!email) return genericRecoveryResponse();
      const emailHash = await sha256Hex(`email:${email}`);
      const allowed = await enforceRateLimits(admin, { emailHash, trustedIpHash, purpose: "recovery", visitorMax: 99, emailMax: 5, ipMax: 20 });
      if (!allowed) return genericRecoveryResponse();

      const { data: issued, error: issueError } = await admin.rpc("issue_visitor_recovery_capability", {
        p_email: email,
        p_trusted_ip_hash: trustedIpHash,
      });
      if (issueError) return genericRecoveryResponse();
      const row = Array.isArray(issued) ? issued[0] : issued;
      if (!row?.visitor_id || !row?.capability || !row?.email) {
        await writeAuditEvent(admin, "visitor.otp.recovery_requested", { result: "generic" });
        return genericRecoveryResponse();
      }

      // Proceed with secure issuance using internally obtained capability (never returned).
      const visitorId = String(row.visitor_id);
      const capability = String(row.capability);
      const targetEmail = String(row.email);
      const firstName = escapeHtml(String(row.full_name || "Visitor").split(" ")[0] || "Visitor");

      // Consume capability atomically before provider submission.
      const { data: consumed, error: consumeError } = await admin.rpc("consume_visitor_resend_capability", { p_capability: capability });
      if (consumeError || !Array.isArray(consumed) || !consumed[0]?.visitor_id) return genericRecoveryResponse();
      if (String(consumed[0].visitor_id) !== visitorId) return genericRecoveryResponse();

      const intentId = await createIntent(admin, {
        visitor_id: visitorId,
        purpose: "recovery",
        channel: "otp",
        state: "pending_claim",
        email_hash: emailHash,
        trusted_ip_hash: trustedIpHash,
        resend_capability_hash: await sha256Hex(capability),
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        metadata: { flow: "recovery" },
      });
      if (!intentId) return genericRecoveryResponse();
      if (!(await casIntent(admin, intentId, "pending_claim", { state: "provider_submitting", submitted_at: new Date().toISOString() }))) {
        return genericRecoveryResponse();
      }

      const otp = generateOtp();
      const otpExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
      const otpProtected = await hmacSha256Hex(otpHmacSecret, `${visitorId}:${otp}`);

      const provider = await sendOtpEmail({ resendApiKey, to: targetEmail, firstName, otp });
      if (provider.ambiguous) {
        await casIntent(admin, intentId, "provider_submitting", { state: "ambiguous_timeout", failure_code: "provider_timeout", provider_message_id: provider.messageId, resolved_at: new Date().toISOString() });
        await writeAuditEvent(admin, "visitor.otp.delivery_ambiguous", { visitorId, purpose: "recovery" });
        return genericRecoveryResponse(); // fail closed, no unsafe retry release
      }
      if (!provider.ok || provider.rejected) {
        await casIntent(admin, intentId, "provider_submitting", { state: "provider_rejected", failure_code: "provider_rejected", provider_message_id: provider.messageId, resolved_at: new Date().toISOString() });
        await admin.from("visitors").update({ otp: null, otp_expires_at: null, otp_last_sent_at: null }).eq("id", visitorId).eq("otp_verified", false);
        await writeAuditEvent(admin, "visitor.otp.email_failed", { visitorId, resendStatus: provider.status });
        return genericRecoveryResponse();
      }

      await casIntent(admin, intentId, "provider_submitting", { state: "provider_accepted", provider_message_id: provider.messageId });

      const { error: persistError } = await admin.from("visitors").update({
        otp: otpProtected,
        otp_expires_at: otpExpiresAt,
        otp_verified: false,
        otp_attempts: 0,
        otp_last_sent_at: new Date().toISOString(),
      }).eq("id", visitorId).eq("otp_verified", false);

      if (persistError) {
        await casIntent(admin, intentId, "provider_accepted", { state: "failed", failure_code: "persist_failed", resolved_at: new Date().toISOString() });
        await admin.from("visitors").update({ otp: null, otp_expires_at: null, otp_last_sent_at: null }).eq("id", visitorId).eq("otp_verified", false);
        await writeAuditEvent(admin, "visitor.otp.persist_failed", { visitorId });
        return genericRecoveryResponse();
      }

      await casIntent(admin, intentId, ["provider_accepted", "provider_submitting"], { state: "persisted", otp_hash: otpProtected, otp_expires_at: otpExpiresAt, resolved_at: new Date().toISOString() });
      await writeAuditEvent(admin, "visitor.otp.sent", { visitorId, purpose: "recovery", expiresAt: otpExpiresAt });
      return genericRecoveryResponse();
    }

    // -----------------------------------------------------------------------
    // REGISTRATION SEND (nonce-bound) and RESEND (capability-bound)
    // -----------------------------------------------------------------------
    if (type === "otp") {
      const capability = typeof body?.capability === "string" ? body.capability.trim() : "";
      const registrationNonce = typeof body?.registrationNonce === "string" ? body.registrationNonce.trim() : "";
      const visitorIdRaw = typeof body?.visitorId === "string" ? body.visitorId.trim() : "";

      let visitorId = "";
      let targetEmail = "";
      let firstName = "Visitor";
      let purpose: "registration_send" | "resend" = "registration_send";
      let authUserId: string | null = null;
      let resendCapabilityHash: string | null = null;

      if (capability) {
        purpose = "resend";
        const { data: consumed, error: consumeError } = await admin.rpc("consume_visitor_resend_capability", { p_capability: capability });
        if (consumeError || !Array.isArray(consumed) || !consumed[0]?.visitor_id) {
          return genericDenied("This verification request is invalid or has expired.", 403);
        }
        visitorId = String(consumed[0].visitor_id);
        targetEmail = String(consumed[0].email || "");
        firstName = escapeHtml(String(consumed[0].full_name || "Visitor").split(" ")[0] || "Visitor");
        resendCapabilityHash = await sha256Hex(capability);
      } else if (visitorIdRaw && registrationNonce) {
        purpose = "registration_send";
        const { data: proofRows, error: proofError } = await admin.rpc("verify_visitor_registration_send_proof", {
          p_visitor_id: visitorIdRaw,
          p_registration_nonce: registrationNonce,
        });
        if (proofError || !Array.isArray(proofRows) || !proofRows[0]?.visitor_id) {
          return genericDenied("A matching visitor registration proof is required.", 403);
        }
        const proof = proofRows[0] as Record<string, unknown>;
        visitorId = String(proof.visitor_id);
        authUserId = typeof proof.auth_user_id === "string" ? proof.auth_user_id : null;
        targetEmail = String(proof.email || "");
        firstName = escapeHtml(String(proof.full_name || "Visitor").split(" ")[0] || "Visitor");
      } else {
        // Anonymous visitorId-only requests are not accepted.
        return genericDenied("A valid verification request is required.", 403);
      }

      if (!visitorId || !targetEmail) return genericDenied("Unable to process the verification request.", 400);

      const emailHash = await sha256Hex(`email:${normalizeEmail(targetEmail)}`);
      const allowed = await enforceRateLimits(admin, {
        visitorId,
        emailHash,
        trustedIpHash,
        purpose,
        visitorMax: 5,
        emailMax: 8,
        ipMax: 20,
      });
      if (!allowed) return jsonResponse({ success: false, error: "Please wait before requesting another verification code." }, 429);

      const intentId = await createIntent(admin, {
        visitor_id: visitorId,
        auth_user_id: authUserId,
        purpose,
        channel: "otp",
        state: "pending_claim",
        email_hash: emailHash,
        trusted_ip_hash: trustedIpHash,
        registration_nonce_hash: registrationNonce ? await sha256Hex(`reg:${visitorId}:${registrationNonce}`) : null,
        resend_capability_hash: resendCapabilityHash,
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
        metadata: { flow: purpose },
      });
      if (!intentId) return jsonResponse({ success: false, error: "Unable to process the verification request." }, 409);

      const cooldownCutoffIso = new Date(Date.now() - 60_000).toISOString();
      // Claim/cooldown at visitor row level (CAS) to prevent concurrent sends.
      const { data: claimedVisitor } = await admin
        .from("visitors")
        .update({ otp: null, otp_expires_at: null, otp_verified: false, otp_attempts: 0, otp_last_sent_at: new Date().toISOString() })
        .eq("id", visitorId)
        .eq("otp_verified", false)
        .or(`otp_last_sent_at.is.null,otp_last_sent_at.lt.${cooldownCutoffIso}`)
        .select("id, email")
        .maybeSingle();
      if (!claimedVisitor?.id) {
        await casIntent(admin, intentId, "pending_claim", { state: "failed", failure_code: "claim_conflict", resolved_at: new Date().toISOString() });
        return jsonResponse({ success: false, error: "Please wait before requesting another verification code." }, 429);
      }
      if (!(await casIntent(admin, intentId, "pending_claim", { state: "provider_submitting", submitted_at: new Date().toISOString() }))) {
        return jsonResponse({ success: false, error: "Unable to process the verification request." }, 409);
      }

      // Registration nonce send proof becomes consumed for issuance/replay bound;
      // abort_visitor_registration remains valid via auth metadata nonce check.
      if (purpose === "registration_send" && registrationNonce) {
        await admin.rpc("consume_visitor_registration_send_proof", {
          p_visitor_id: visitorId,
          p_registration_nonce: registrationNonce,
        });
      }

      const otp = generateOtp();
      const otpExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
      const otpProtected = await hmacSha256Hex(otpHmacSecret, `${visitorId}:${otp}`);

      const provider = await sendOtpEmail({ resendApiKey, to: targetEmail, firstName, otp });
      if (provider.ambiguous) {
        await casIntent(admin, intentId, "provider_submitting", { state: "ambiguous_timeout", failure_code: "provider_timeout", provider_message_id: provider.messageId, resolved_at: new Date().toISOString() });
        await writeAuditEvent(admin, "visitor.otp.delivery_ambiguous", { visitorId, purpose });
        return jsonResponse({ success: false, error: "The verification email could not be confirmed. Please wait before trying again." }, 503);
      }
      if (!provider.ok || provider.rejected) {
        await casIntent(admin, intentId, "provider_submitting", { state: "provider_rejected", failure_code: "provider_rejected", provider_message_id: provider.messageId, resolved_at: new Date().toISOString() });
        await admin.from("visitors").update({ otp: null, otp_expires_at: null, otp_last_sent_at: null }).eq("id", visitorId).eq("otp_verified", false);
        await writeAuditEvent(admin, "visitor.otp.email_failed", { visitorId, resendStatus: provider.status });
        return jsonResponse({ success: false, error: "Failed to send verification email." }, 500);
      }

      await casIntent(admin, intentId, "provider_submitting", { state: "provider_accepted", provider_message_id: provider.messageId });
      const { error: persistError } = await admin.from("visitors").update({
        otp: otpProtected,
        otp_expires_at: otpExpiresAt,
        otp_verified: false,
        otp_attempts: 0,
      }).eq("id", visitorId).eq("otp_verified", false);

      if (persistError) {
        // Provider accepted but persistence failed: fail closed, invalidate OTP material.
        await casIntent(admin, intentId, "provider_accepted", { state: "failed", failure_code: "persist_failed", resolved_at: new Date().toISOString() });
        await admin.from("visitors").update({ otp: null, otp_expires_at: null, otp_last_sent_at: null }).eq("id", visitorId).eq("otp_verified", false);
        await writeAuditEvent(admin, "visitor.otp.persist_failed", { visitorId });
        return jsonResponse({ success: false, error: "The verification email could not be completed. Please request a new code." }, 500);
      }

      await casIntent(admin, intentId, ["provider_accepted", "provider_submitting"], { state: "persisted", otp_hash: otpProtected, otp_expires_at: otpExpiresAt, resolved_at: new Date().toISOString() });
      await writeAuditEvent(admin, "visitor.otp.sent", { visitorId, purpose, expiresAt: otpExpiresAt });
      return jsonResponse({ success: true, type: "otp", message: "Verification email sent successfully.", expiresAt: otpExpiresAt });
    }

    // -----------------------------------------------------------------------
    // QR EMAIL - retained but not anonymously callable by visitor ID alone.
    // External/legacy caller inventory is unresolved; no public authorization
    // path is enabled here. This preserves the function/capability without
    // restoring QR login or allowing anonymous targeting.
    // -----------------------------------------------------------------------
    if (type === "qr") {
      return genericDenied("QR email requests require an authorized caller.", 403);
    }

    return genericDenied("Invalid request.", 400);
  } catch {
    return jsonResponse({ success: false, error: "Unable to process email request." }, 500);
  }
});