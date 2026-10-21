import { createClient } from "@supabase/supabase-js";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
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
  "http://localhost:5174",
  "http://127.0.0.1:5174",
]);

function isAllowedOrigin(origin: string) {
  if (allowedOrigins.has(origin)) {
    return true;
  }

  try {
    const parsedOrigin = new URL(origin);
    return (
      parsedOrigin.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(parsedOrigin.hostname)
    );
  } catch {
    return false;
  }
}

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
  const requestOriginAllowed = isAllowedOrigin(requestOrigin);
  const origin = requestOriginAllowed
    ? requestOrigin
    : configuredOrigins[0] || "http://localhost:5173";

  if (requestOrigin && !requestOriginAllowed) {
    return respond(origin, 403, { error: "Origin is not allowed." });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders(origin) });
  }

  if (request.method !== "POST") {
    return respond(origin, 405, { error: "Method not allowed." });
  }

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
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
  let password = "";
  try {
    const body = await request.json();
    qrCode = String(body?.qrCode || "").trim().toUpperCase();
    password = String(body?.password || "");
  } catch {
    return respond(origin, 400, { error: "Invalid request body." });
  }

  if (!/^SHELF-QR-(?:[0-9]{6}|[0-9A-F]{32})$/.test(qrCode) || !password) {
    return respond(origin, 401, { error: "Invalid QR pass or password." });
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
    return respond(origin, 401, { error: "Invalid QR pass or password." });
  }

  let loginResponse: Response;
  try {
    loginResponse = await fetch(
      `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/login-with-lockout`,
      {
        method: "POST",
        headers: {
          "apikey": anonKey,
          "Authorization": `Bearer ${anonKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: visitor.email,
          password,
        }),
      },
    );
  } catch (error) {
    console.error("QR sign-in credential check failed:", error);
    return respond(origin, 503, {
      error: "Unable to verify your password right now. Please try again.",
    });
  }

  let loginData: Record<string, unknown>;
  try {
    const responseBody: unknown = await loginResponse.json();
    if (
      !responseBody ||
      typeof responseBody !== "object" ||
      Array.isArray(responseBody)
    ) {
      return respond(origin, 502, {
        error: "Unable to complete QR sign-in. Please try again.",
      });
    }
    loginData = responseBody as Record<string, unknown>;
  } catch (error) {
    console.error("QR sign-in received an invalid login response:", error);
    return respond(origin, 502, {
      error: "Unable to complete QR sign-in. Please try again.",
    });
  }

  const sessionValue = loginData.session;
  const session =
    typeof sessionValue === "object" && sessionValue !== null
      ? sessionValue as Record<string, unknown>
      : undefined;
  const userValue = loginData.user;
  const user =
    typeof userValue === "object" && userValue !== null
      ? userValue as Record<string, unknown>
      : undefined;

  if (
    !loginResponse.ok ||
    loginData.success !== true ||
    typeof session?.access_token !== "string" ||
    typeof session.refresh_token !== "string" ||
    user?.id !== visitor.auth_user_id
  ) {
    const status = loginResponse.ok
      ? 401
      : loginResponse.status;
    const errorMessage =
      typeof loginData.error === "string"
        ? loginData.error
        : "Invalid QR pass or password.";
    return respond(origin, status, { error: errorMessage });
  }

  return respond(origin, 200, {
    session: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    },
  });
});