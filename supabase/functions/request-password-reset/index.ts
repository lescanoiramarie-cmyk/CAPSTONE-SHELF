import { createClient } from "@supabase/supabase-js";

// ============================================================================
// REQUEST PASSWORD RESET
//
// One function, three operations:
//
//   request  -> email a 6-digit verification code
//   verify   -> verify a code without consuming it
//   apply    -> exchange a verified code for a new password
//
// The service role key never reaches the browser.
// Password changes are performed server-side through the Supabase Admin API.
//
// Both request and unknown-account cases use an indistinguishable success
// response where appropriate to reduce account/email enumeration.
// ============================================================================

const supabaseUrl =
  Deno.env.get("SUPABASE_URL") || "";

const serviceRoleKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const resendApiKey =
  Deno.env.get("RESEND_API_KEY") || "";

const CODE_TTL_MINUTES = 10;
const MAX_CODE_ATTEMPTS = 5;

const SENDER =
  "SHELF ILMS <support@shelf-ilms.me>";

// Must match the password policy used during visitor registration.
const PASSWORD_MIN_LENGTH = 12;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
};

// ============================================================================
// RESPONSE HELPER
// ============================================================================

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
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

// ============================================================================
// 6-DIGIT CODE
//
// crypto.getRandomValues() is used instead of Math.random() because it is
// suitable for security-sensitive random values.
// ============================================================================

function generateCode(): string {
  const values =
    new Uint32Array(1);

  crypto.getRandomValues(values);

  return (
    100000 +
    (values[0] % 900000)
  ).toString();
}

// ============================================================================
// SHA-256
// ============================================================================

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
      byte
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
}

// ============================================================================
// PASSWORD POLICY
// ============================================================================

function isAcceptablePassword(
  value: string,
): boolean {
  return (
    value.length >=
      PASSWORD_MIN_LENGTH &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

// ============================================================================
// AUDIT LOG CLIENT TYPE
//
// Do not use ReturnType<typeof createClient> here.
//
// Supabase's generated generic types can become incompatible with the generic
// SupabaseClient expected by helper functions under Deno TypeScript.
//
// The audit helper only needs the small portion of the client used below.
// ============================================================================

// ============================================================================
// AUDIT EVENT
//
// The Supabase PostgREST query builder is thenable rather than typed as a
// native Promise. Using PromiseLike here matches the actual return type of
// .insert() while keeping the helper independent from Supabase's generated
// generic client type.
// ============================================================================

type AuditClient = {
  from: (
    table: string,
  ) => {
    insert: (
      values: Record<string, unknown>,
    ) => PromiseLike<{
      error: unknown;
    }>;
  };
};

async function writeAuditEvent(
  admin: AuditClient,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    const result =
      await admin
        .from("audit_logs")
        .insert({
          actor_id: null,
          action,
          branch_id: null,
          details,
        });

    if (result.error) {
      console.error(
        `Audit write failed for ${action}:`,
        result.error,
      );
    }
  } catch (auditError) {
    console.error(
      `Audit write threw for ${action}:`,
      auditError,
    );
  }
}

// ============================================================================
// MAIN EDGE FUNCTION
// ============================================================================

Deno.serve(async (req: Request) => {
  // --------------------------------------------------------------------------
  // CORS PREFLIGHT
  // --------------------------------------------------------------------------

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    // ------------------------------------------------------------------------
    // METHOD
    // ------------------------------------------------------------------------

    if (req.method !== "POST") {
      return jsonResponse(
        {
          success: false,
          error:
            "Method not allowed.",
        },
        405,
      );
    }

    // ------------------------------------------------------------------------
    // ENVIRONMENT
    // ------------------------------------------------------------------------

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

    // ------------------------------------------------------------------------
    // REQUEST BODY
    // ------------------------------------------------------------------------

    let body: Record<
      string,
      unknown
    >;

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

    // ------------------------------------------------------------------------
    // COMMON VALUES
    // ------------------------------------------------------------------------

    const operation =
      String(
        body?.operation ||
          "request",
      )
        .trim()
        .toLowerCase();

    const email =
      String(
        body?.email || "",
      )
        .trim()
        .toLowerCase();

    // ------------------------------------------------------------------------
    // SERVICE-ROLE CLIENT
    // ------------------------------------------------------------------------

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

    // =========================================================================
    // OPERATION: REQUEST
    //
    // Create a reset code and email it to the account address.
    // =========================================================================

    if (operation === "request") {
      const accountKind =
        String(
          body?.accountKind ||
            "visitor",
        )
          .trim()
          .toLowerCase();

      // ----------------------------------------------------------------------
      // RESEND CONFIGURATION
      // ----------------------------------------------------------------------

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

      // ----------------------------------------------------------------------
      // EMAIL VALIDATION
      //
      // Do not reveal whether an address exists.
      // ----------------------------------------------------------------------

      if (
        !email.includes("@") ||
        email.length > 254
      ) {
        return jsonResponse({
          success: true,
          expiresInSeconds:
            CODE_TTL_MINUTES * 60,
          message:
            "If that address belongs to a SHELF account, a verification code is on its way.",
        });
      }

      // ----------------------------------------------------------------------
      // GENERATE CODE
      // ----------------------------------------------------------------------

      const code =
        generateCode();

      const codeHash =
        await sha256Hex(
          `${email}:${code}`,
        );

      // IMPORTANT:
      // expiresAt must be declared BEFORE it is used.
      const expiresAt =
        new Date(
          Date.now() +
            CODE_TTL_MINUTES *
              60 *
              1000,
        ).toISOString();

      // ----------------------------------------------------------------------
      // ISSUE RESET CODE THROUGH RPC
      // ----------------------------------------------------------------------

      const {
        data: issued,
        error: issueError,
      } = await admin.rpc(
        "issue_password_reset_code",
        {
          p_email: email,
          p_code_hash: codeHash,
          p_account_kind:
            accountKind,
          p_expires_at:
            expiresAt,
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

      // RPC may return either a row or an array containing one row.
      const result =
        Array.isArray(issued)
          ? issued[0]
          : issued;

      // ----------------------------------------------------------------------
      // HANDLE RPC RESULT
      // ----------------------------------------------------------------------

      if (!result?.issued) {
        // Cooldown
        if (
          result?.reason ===
          "cooldown"
        ) {
          return jsonResponse(
            {
              success: false,
              error:
                "A verification code was sent recently. Please wait a minute before requesting another.",
            },
            429,
          );
        }

        // Rate limit
        if (
          result?.reason ===
          "rate_limited"
        ) {
          return jsonResponse(
            {
              success: false,
              error:
                "Too many reset codes requested. Please try again later.",
            },
            429,
          );
        }

        // Unknown account / unavailable account.
        // Keep the response indistinguishable from a successful request.
        console.warn(
          "Password reset requested for an address without a usable account.",
        );

        return jsonResponse({
          success: true,
          expiresInSeconds:
            CODE_TTL_MINUTES * 60,
          message:
            "If that address belongs to a SHELF account, a verification code is on its way.",
        });
      }

      // ----------------------------------------------------------------------
      // SEND EMAIL THROUGH RESEND
      // ----------------------------------------------------------------------

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
                  <h2>
                    SHELF ILMS Password Reset
                  </h2>

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
                  ">
                    ${code}
                  </div>

                  <p style="text-align: left;">
                    This code expires in
                    <strong>
                      ${CODE_TTL_MINUTES} minutes
                    </strong>
                    and can be used
                    <strong>
                      ${MAX_CODE_ATTEMPTS} times
                    </strong>
                    at most.
                  </p>

                  <p style="text-align: left;">
                    If you did not request a password
                    reset, you can ignore this email.
                    Your current password will keep working.
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

      // ----------------------------------------------------------------------
      // READ RESEND RESPONSE
      // ----------------------------------------------------------------------

      let resendData:
        | Record<string, unknown>
        | null = null;

      try {
        resendData =
          await resendResponse.json();
      } catch {
        resendData = null;
      }

      // ----------------------------------------------------------------------
      // HANDLE EMAIL FAILURE
      // ----------------------------------------------------------------------

      if (!resendResponse.ok) {
        console.error(
          "Resend password reset error:",
          {
            status:
              resendResponse.status,
            data: resendData,
          },
        );

        await writeAuditEvent(
          admin,
          "security.password_reset.email_failed",
          {
            email,
            status:
              resendResponse.status,
          },
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

      // ----------------------------------------------------------------------
      // AUDIT CODE SENT
      // ----------------------------------------------------------------------

      await writeAuditEvent(
        admin,
        "security.password_reset.code_sent",
        {
          email,
          accountKind:
            result.account_kind ??
            accountKind,
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
        expiresInSeconds:
          CODE_TTL_MINUTES * 60,
        message:
          "If that address belongs to a SHELF account, a verification code is on its way.",
      });
    }

    // =========================================================================
    // OPERATION: VERIFY
    //
    // Check the code without consuming it.
    //
    // The APPLY operation verifies the code again server-side.
    // =========================================================================

    if (operation === "verify") {
      const code =
        String(
          body?.code || "",
        ).trim();

      // ----------------------------------------------------------------------
      // CODE FORMAT
      // ----------------------------------------------------------------------

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

      // ----------------------------------------------------------------------
      // HASH CODE
      // ----------------------------------------------------------------------

      const codeHash =
        await sha256Hex(
          `${email}:${code}`,
        );

      // ----------------------------------------------------------------------
      // VERIFY RPC
      // ----------------------------------------------------------------------

      const {
        data: verified,
        error: verifyError,
      } = await admin.rpc(
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

      const row =
        Array.isArray(verified)
          ? verified[0]
          : verified;

      // ----------------------------------------------------------------------
      // INVALID CODE
      // ----------------------------------------------------------------------

      if (!row?.valid) {
        const locked =
          row?.error === "locked";

        if (locked) {
          await writeAuditEvent(
            admin,
            "security.password_reset.code_rejected",
            {
              email,
              reason: "locked",
            },
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

        const expired =
          row?.error === "expired";

        return jsonResponse(
          {
            success: false,
            valid: false,
            error: expired
              ? "This verification code has expired. Please request a new one."
              : "That verification code is not valid. Please check it and try again.",
          },
          400,
        );
      }

      // ----------------------------------------------------------------------
      // VALID CODE
      // ----------------------------------------------------------------------

      return jsonResponse({
        success: true,
        valid: true,
      });
    }

    // =========================================================================
    // OPERATION: APPLY
    //
    // Verify the code again and update the Supabase Auth password.
    // =========================================================================

    if (operation === "apply") {
      const code =
        String(
          body?.code || "",
        ).trim();

      const newPassword =
        String(
          body?.newPassword || "",
        );

      // ----------------------------------------------------------------------
      // CODE FORMAT
      // ----------------------------------------------------------------------

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

      // ----------------------------------------------------------------------
      // PASSWORD POLICY
      // ----------------------------------------------------------------------

      if (
        !isAcceptablePassword(
          newPassword,
        )
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

      // Prevent excessively large password payloads.
      if (
        newPassword.length > 200
      ) {
        return jsonResponse(
          {
            success: false,
            error:
              "Password is too long.",
          },
          400,
        );
      }

      // ----------------------------------------------------------------------
      // HASH CODE
      // ----------------------------------------------------------------------

      const codeHash =
        await sha256Hex(
          `${email}:${code}`,
        );

      // ----------------------------------------------------------------------
      // VERIFY CODE AGAIN
      // ----------------------------------------------------------------------

      const {
        data: verified,
        error: verifyError,
      } = await admin.rpc(
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

      const row =
        Array.isArray(verified)
          ? verified[0]
          : verified;

      // ----------------------------------------------------------------------
      // INVALID / EXPIRED / LOCKED
      // ----------------------------------------------------------------------

      if (
        !row?.valid ||
        !row?.user_id
      ) {
        const reason =
          row?.error;

        if (
          reason === "locked"
        ) {
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
          {
            email,
            reason:
              reason ?? "unknown",
          },
        );

        return jsonResponse(
          {
            success: false,
            error:
              reason === "expired"
                ? "This verification code has expired. Please request a new one."
                : "That verification code is not valid. Please check it and try again.",
          },
          400,
        );
      }

      // ----------------------------------------------------------------------
      // UPDATE SUPABASE AUTH PASSWORD
      // ----------------------------------------------------------------------

      const {
        error: updateError,
      } =
        await admin.auth.admin.updateUserById(
          String(row.user_id),
          {
            password:
              newPassword,
          },
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

      // ----------------------------------------------------------------------
      // CONSUME CODE
      //
      // The code is consumed only after the password update succeeds.
      // ----------------------------------------------------------------------

      const {
        error: consumeError,
      } = await admin.rpc(
        "consume_password_reset_code",
        {
          p_email: email,
        },
      );

      if (consumeError) {
        // Password has already changed successfully.
        // Log the issue instead of reporting a false password-update failure.
        console.error(
          "consume_password_reset_code failed after successful password update:",
          consumeError,
        );
      }

      // ----------------------------------------------------------------------
      // AUDIT COMPLETION
      // ----------------------------------------------------------------------

      await writeAuditEvent(
        admin,
        "security.password_reset.completed",
        {
          email,
          accountKind:
            row.account_kind,
        },
      );

      console.log(
        "Password reset completed.",
        {
          email,
        },
      );

      return jsonResponse({
        success: true,
        message:
          "Your password has been updated. You can now sign in with your new password.",
      });
    }

    // =========================================================================
    // INVALID OPERATION
    // =========================================================================

    return jsonResponse(
      {
        success: false,
        error:
          "Invalid operation.",
      },
      400,
    );
  } catch (error) {
    // =========================================================================
    // UNEXPECTED ERROR
    // =========================================================================

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