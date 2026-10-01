import { createClient } from "@supabase/supabase-js";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const allowedOrigins = (
  Deno.env.get("APP_ORIGINS") ||
  Deno.env.get("APP_ORIGIN") ||
  "http://localhost:5173"
).split(",").map((origin) => origin.trim()).filter(Boolean);

function responseHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

function respond(origin: string, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(origin),
  });
}

Deno.serve(async (request: Request) => {
  const requestOrigin = request.headers.get("origin") || "";
  const origin = allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : allowedOrigins[0] || "http://localhost:5173";

  if (requestOrigin && !allowedOrigins.includes(requestOrigin)) {
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

  let qrCode = "";
  try {
    const body = await request.json();
    qrCode = String(body?.qrCode || "").trim();
  } catch {
    return respond(origin, 400, { error: "Invalid request body." });
  }

  if (!qrCode || qrCode.length > 200) {
    return respond(origin, 401, { error: "This QR pass could not be used to sign in." });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: visitor, error: visitorError } = await admin
    .from("visitors")
    .select("auth_user_id, email, otp_verified")
    .eq("qr_code", qrCode)
    .maybeSingle();

  if (
    visitorError ||
    !visitor?.auth_user_id ||
    !visitor.email ||
    !visitor.otp_verified
  ) {
    return respond(origin, 401, { error: "This QR pass could not be used to sign in." });
  }

  const { data: account, error: accountError } =
    await admin.auth.admin.getUserById(visitor.auth_user_id);

  if (
    accountError ||
    !account.user ||
    account.user.user_metadata?.role !== "visitor"
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