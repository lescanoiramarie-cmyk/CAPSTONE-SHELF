import { createClient } from "@supabase/supabase-js";

// ============================================================================
// REQUEST PASSWORD RESET
//
// One function, two operations, so the whole reset lifecycle stays server-side:
//
//   request  email a 6-digit code to the account address
//   apply    exchange a verified code for a new password
//
// The service role key never reaches the browser. Applying a new password
// requires writing to auth.users, which the anon key cannot do, so the exchange
// has to happen here.
//
// Response shape is { success, error } to match send-visitor-otp.
//
// Both operations answer identically whether or not the account exists. A
// different response for an unknown address would let anyone enumerate which
// emails hold a SHELF account.
// ============================================================================

const supabaseUrl =
  Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    "";
const resendApiKey =
  Deno.env.get("RESEND_API_KEY") || "";

const CODE_TTL_MINUTES = 15;
const MAX_CODE_ATTEMPTS = 5;
const SENDER = "SHELF ILMS <support@shelf-ilms.me>";

// Must match the policy the client enforces at registration, so a password set
// here cannot be weaker than one set at registration.
const PASSWORD_MIN_LENGTH = 12;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
};

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type":
          "application/json",
      },
    },
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ============================================================================
// 6 DIGIT CODE
//
// crypto.getRandomValues rather than Math.random. Math.random is not a CSPRNG
// and its output is predictable from previously observed values.
// ============================================================================

function generateCode(): string {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);

  return (100000 +
    (values[0] % 900000)).toString();
}

async function sha256Hex(
  value: string,
): Promise<string> {
  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );

  return Array.from(
    new Uint8Array(digest),
  )
    .map((byte) =>
      byte.toString(16).padStart(2, "0"))
    .join("");
}

function isAcceptablePassword(
  value: string,
): boolean {
  return (
    value.length >= PASSWORD_MIN_LENGTH &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

async function writeAuditEvent(
  admin: ReturnType<typeof createClient>,
  action: string,
  details: Record<string, unknown>,
) {
  try {
    const { error } =
      await admin
        .from("audit_logs")
        .insert({
          actor_id: null,
          action,
          branch_id: null,
          details,
        });

    if (error) {
      console.error(
        `Audit write failed for ${action}:`,
        error,
      );
    }
  } catch (auditError) {
    console.error(
      `Audit write threw for ${action}:`,
      auditError,
    );
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse(
        {
          success: false,
          error: "Method not allowed.",
        },
        405,
      );
    }

    if (
      !supabaseUrl ||
      !serviceRoleKey
    ) {
      console.error(
        "Missing Supabase environment variables.",
      );

      return jsonResponse(
        {
          success: false,
          error:
            "Password reset is not configured.",
        },
        500,
      );
    }

    let body: Record<string, unknown>;

    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        {
          success: false,
          error:
            "Invalid JSON request body.",
        },
        400,
      );
    }

    const operation = String(
      body?.operation || "request",
    ).trim().toLowerCase();

    const email = String(
      body?.email || "",
    ).trim().toLowerCase();

    const admin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    // ==========================================================================
    // OPERATION: REQUEST — EMAIL A CODE
    // ==========================================================================

    if (operation === "request") {
      const accountKind = String(
        body?.accountKind || "visitor",
      ).trim().toLowerCase();

      if (!resendApiKey) {
        console.error(
          "Missing RESEND_API_KEY.",
        );

        return jsonResponse(
          {
            success: false,
            error:
              "Password reset email is not configured.",
          },
          500,
        );
      }

      if (
        !email.includes("@") ||
        email.length > 254
      ) {
        // Same shape as success so the form cannot be used as a probe.
        return jsonResponse({
          success: true,
          message:
            "If that address belongs to a SHELF account, a verification code is on its way.",
        });
      }

      const code = generateCode();
      const codeHash =
        await sha256Hex(`${email}:${code}`);

      const expiresAt =
        new Date(
          Date.now() +
            CODE_TTL_MINUTES * 60 * 1000,
        ).toISOString();

      const { data: issued, error: issueError } =
        await admin.rpc(
          "issue_password_reset_code",
          {
            p_email: email,
            p_code_hash: codeHash,
            p_account_kind: accountKind,
            p_expires_at: expiresAt,
          },
        );

      if (issueError) {
        console.error(
          "issue_password_reset_code failed:",
          issueError,
        );

        return jsonResponse(
          {
            success: false,
            error:
              "Unable to start the password reset. Please try again.",
          },
          500,
        );
      }

      const result = Array.isArray(issued)
        ? issued[0]
        : issued;

      if (!result?.issued) {
        if (result?.reason === "cooldown") {
          return jsonResponse(
            {
              success: false,
              error:
                "A verification code was sent recently. Please wait a minute before requesting another.",
            },
            429,
          );
        }

        if (result?.reason === "rate_limited") {
          return jsonResponse(
            {
              success: false,
              error:
                "Too many reset codes requested. Please try again later.",
            },
            429,
          );
        }

        // not_found or anything unexpected: respond identically to success.
        console.warn(
          "Password reset requested for an address without a usable account.",
        );

        return jsonResponse({
          success: true,
          message:
            "If that address belongs to a SHELF account, a verification code is on its way.",
        });
      }

      const resendResponse =
        await fetch(
          "https://api.resend.com/emails",
          {
            method: "POST",
            headers: {
              Authorization:
                `Bearer ${resendApiKey}`,
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              from: SENDER,
              to: [email],
              subject:
                "Your SHELF ILMS Verification Code",
              html: `
                <div style="
                  font-family: Arial, sans-serif;
                  max-width: 600px;
                  margin: 0 auto;
                  padding: 20px;
                  color: #111827;
                ">
                  <h2>SHELF ILMS Password Reset</h2>
                  <p style="text-align: left;">
                    Hello,
                  </p>
                  <p style="text-align: left;">
                    Use the verification code below to
                    choose a new password for your SHELF
                    ILMS account.
                  </p>
                  <div style="
                    font-size: 32px;
                    font-weight: bold;
                    letter-spacing: 8px;
                    padding: 20px;
                    background: #f3f4f6;
                    text-align: center;
                    border-radius: 8px;
                    margin: 20px 0;
                  ">${code}</div>
                  <p style="text-align: left;">
                    This code expires in
                    <strong>${CODE_TTL_MINUTES} minutes</strong>
                    and can be used
                    <strong>${MAX_CODE_ATTEMPTS} times</strong>
                    at most.
                  </p>
                  <p style="text-align: left;">
                    If you did not request a password
                    reset, you can ignore this email. Your
                    current password will keep working.
                  </p>
                  <p style="text-align: left;">
                    Regards,<br />
                    <strong>SHELF ILMS</strong>
                  </p>
                </div>
              `,
            }),
          },
        );

      let resendData:
        | Record<string, unknown>
        | null = null;

      try {
        resendData =
          await resendResponse.json();
      } catch {
        resendData = null;
      }

      if (!resendResponse.ok) {
        console.error(
          "Resend password reset error:",
          {
            status: resendResponse.status,
            data: resendData,
          },
        );

        await writeAuditEvent(
          admin,
          "security.password_reset.email_failed",
          { email, status: resendResponse.status },
        );

        return jsonResponse(
          {
            success: false,
            error:
              "We could not send the verification email. Please try again.",
          },
          500,
        );
      }

      await writeAuditEvent(
        admin,
        "security.password_reset.code_sent",
        {
          email,
          accountKind:
            result.account_kind ?? accountKind,
          expiresAt,
        },
      );

      console.log(
        "Password reset code sent.",
        {
          email,
          expiresAt,
        },
      );

      return jsonResponse({
        success: true,
        message:
          "If that address belongs to a SHELF account, a verification code is on its way.",
      });
    }

    // ==========================================================================
    // OPERATION: VERIFY — CHECK A CODE WITHOUT SPENDING IT
    //
    // Lets the UI reject a bad code before the visitor types a new password.
    // The apply operation re-verifies, because a client-side pass proves
    // nothing on its own.
    // ==========================================================================

    if (operation === "verify") {
      const code = String(
        body?.code || "",
      ).trim();

      if (!/^\d{6}$/.test(code)) {
        return jsonResponse(
          {
            success: false,
            valid: false,
            error:
              "Enter the complete 6-digit verification code.",
          },
          400,
        );
      }

      const codeHash =
        await sha256Hex(`${email}:${code}`);

      const {
        data: verified,
        error: verifyError,
      } =
        await admin.rpc(
          "verify_password_reset_code",
          {
            p_email: email,
            p_code_hash: codeHash,
          },
        );

      if (verifyError) {
        console.error(
          "verify_password_reset_code failed:",
          verifyError,
        );

        return jsonResponse(
          {
            success: false,
            valid: false,
            error:
              "Unable to verify the code. Please try again.",
          },
          500,
        );
      }

      const row = Array.isArray(verified)
        ? verified[0]
        : verified;

      if (!row?.valid) {
        const locked = row?.error === "locked";

        if (locked) {
          await writeAuditEvent(
            admin,
            "security.password_reset.code_rejected",
            { email, reason: "locked" },
          );

          return jsonResponse(
            {
              success: false,
              valid: false,
              error:
                "Too many incorrect attempts. Please request a new verification code.",
            },
            429,
          );
        }

        return jsonResponse(
          {
            success: false,
            valid: false,
            error:
              "That verification code is not valid or has expired. Please request a new one.",
          },
          400,
        );
      }

      return jsonResponse({
        success: true,
        valid: true,
      });
    }

    // ==========================================================================
    // OPERATION: APPLY — EXCHANGE THE CODE FOR A NEW PASSWORD
    // ==========================================================================

    if (operation === "apply") {
      const code = String(
        body?.code || "",
      ).trim();

      const newPassword = String(
        body?.newPassword || "",
      );

      if (!/^\d{6}$/.test(code)) {
        return jsonResponse(
          {
            success: false,
            error:
              "Enter the complete 6-digit verification code.",
          },
          400,
        );
      }

      if (
        !isAcceptablePassword(newPassword)
      ) {
        return jsonResponse(
          {
            success: false,
            error:
              `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include an uppercase letter, a lowercase letter, a number and a symbol.`,
          },
          400,
        );
      }

      if (newPassword.length > 200) {
        return jsonResponse(
          {
            success: false,
            error:
              "Password is too long.",
          },
          400,
        );
      }

      const codeHash =
        await sha256Hex(`${email}:${code}`);

      const {
        data: verified,
        error: verifyError,
      } =
        await admin.rpc(
          "verify_password_reset_code",
          {
            p_email: email,
            p_code_hash: codeHash,
          },
        );

      if (verifyError) {
        console.error(
          "verify_password_reset_code failed:",
          verifyError,
        );

        return jsonResponse(
          {
            success: false,
            error:
              "Unable to verify the code. Please try again.",
          },
          500,
        );
      }

      const row = Array.isArray(verified)
        ? verified[0]
        : verified;

      if (!row?.valid || !row?.user_id) {
        const reason = row?.error;

        if (reason === "locked") {
          return jsonResponse(
            {
              success: false,
              error:
                "Too many incorrect attempts. Please request a new verification code.",
            },
            429,
          );
        }

        await writeAuditEvent(
          admin,
          "security.password_reset.code_rejected",
          { email, reason: reason ?? "unknown" },
        );

        return jsonResponse(
          {
            success: false,
            error:
              "That verification code is not valid or has expired. Please request a new one.",
          },
          400,
        );
      }

      const {
        error: updateError,
      } =
        await admin.auth.admin.updateUserById(
          row.user_id as string,
          { password: newPassword },
        );

      if (updateError) {
        console.error(
          "Password update failed:",
          updateError,
        );

        return jsonResponse(
          {
            success: false,
            error:
              "Unable to update the password. Please try again.",
          },
          500,
        );
      }

      // Spend the code only after the password actually changed, so a failed
      // write does not consume a valid code.
      await admin.rpc(
        "consume_password_reset_code",
        { p_email: email },
      );

      await writeAuditEvent(
        admin,
        "security.password_reset.completed",
        {
          email,
          accountKind: row.account_kind,
        },
      );

      console.log(
        "Password reset completed.",
        { email },
      );

      return jsonResponse({
        success: true,
        message:
          "Your password has been updated. You can now sign in with your new password.",
      });
    }

    return jsonResponse(
      {
        success: false,
        error: "Invalid operation.",
      },
      400,
    );
  } catch (error) {
    console.error(
      "request-password-reset error:",
      error,
    );

    return jsonResponse(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to process the request.",
      },
      500,
    );
  }
});