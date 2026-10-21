import { createClient } from "@supabase/supabase-js";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const configuredOrigins = (
  Deno.env.get("APP_ORIGINS") ||
  Deno.env.get("APP_ORIGIN") ||
  "http://localhost:5173"
).split(",").map((origin) => origin.trim()).filter(Boolean);
const allowedOrigins = new Set([
  ...configuredOrigins,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function responseHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

function respond(
  origin: string,
  status: number,
  body: Record<string, unknown>,
  additionalHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...responseHeaders(origin), ...additionalHeaders },
  });
}

async function hashClientAddress(address: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(address),
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

Deno.serve(async (request: Request) => {
  const requestOrigin = request.headers.get("origin") || "";
  const origin = allowedOrigins.has(requestOrigin)
    ? requestOrigin
    : configuredOrigins[0] || "http://localhost:5173";

  if (requestOrigin && !allowedOrigins.has(requestOrigin)) {
    return respond(origin, 403, { error: "Origin is not allowed." });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders(origin) });
  }

  if (request.method !== "POST") {
    return respond(origin, 405, { error: "Method not allowed." });
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return respond(origin, 500, { error: "QR sign-in is not configured." });
  }

  const forwardedAddresses =
    request.headers.get("x-forwarded-for")
      ?.split(",")
      .map((address) => address.trim())
      .filter(Boolean) || [];
  const clientAddress =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    forwardedAddresses.at(-1);

  if (!clientAddress) {
    console.error("QR sign-in rejected: trusted client address is unavailable.");
    return respond(origin, 503, {
      error: "QR sign-in is temporarily unavailable. Please try again later.",
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: rateLimitData, error: rateLimitError } = await admin.rpc(
    "consume_visitor_qr_login_attempt",
    { p_client_hash: await hashClientAddress(clientAddress) },
  );

  if (rateLimitError) {
    console.error("QR sign-in rate-limit check failed:", rateLimitError.message);
    return respond(origin, 500, {
      error: "Unable to validate QR sign-in. Please try again.",
    });
  }

  const rateLimit = Array.isArray(rateLimitData)
    ? rateLimitData[0]
    : rateLimitData;

  if (!rateLimit?.allowed) {
    const retryAfter = Math.max(
      1,
      Number(rateLimit?.retry_after_seconds) || 900,
    );
    return respond(
      origin,
      429,
      { error: "Too many QR sign-in attempts. Please try again later." },
      { "Retry-After": String(retryAfter) },
    );
  }

  let qrCode = "";
  try {
    const body = await request.json();
    qrCode = String(body?.qrCode || "").trim().toUpperCase();
  } catch {
    return respond(origin, 400, { error: "Invalid request body." });
  }

  if (!/^SHELF-QR-[0-9A-F]{32}$/.test(qrCode)) {
    return respond(origin, 401, { error: "This QR pass could not be used to sign in." });
  }

  const { data: visitor, error: visitorError } = await admin
    .from("visitors")
    .select("auth_user_id, email, otp_verified, is_active, qr_code")
    .eq("qr_code", qrCode)
    .maybeSingle();

  
  if (visitorError) {
    console.error("QR sign-in visitor lookup failed:", visitorError.message);
    return respond(origin, 500, {
      error: "Unable to validate the visitor record. Please try again.",
    });
  }

  if (
    !visitor?.auth_user_id ||
    !visitor.email ||
    visitor.otp_verified !== true ||
    visitor.is_active !== true ||
    !visitor.qr_code ||
    visitor.qr_code !== qrCode
  ) {
    console.warn("QR sign-in rejected: visitor validation failed.");
    return respond(origin, 401, {
      error: "This QR pass could not be used to sign in.",
    });
  }

  const { data: account, error: accountError } =
    await admin.auth.admin.getUserById(visitor.auth_user_id);

  if (
    accountError ||
    !account.user ||
    account.user.user_metadata?.role !== "visitor" ||
    !account.user.email_confirmed_at ||
    (account.user.banned_until &&
      Date.parse(account.user.banned_until) > Date.now())
  ) {
    return respond(origin, 401, { error: "This QR pass could not be used to sign in." });
  }

  const { data: link, error: linkError } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email: visitor.email,
      options: { redirectTo: origin },
    });

  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    console.error("QR sign-in token generation failed:", linkError?.message);
    return respond(origin, 500, { error: "Unable to create a QR sign-in session." });
  }

  return respond(origin, 200, { tokenHash });
});