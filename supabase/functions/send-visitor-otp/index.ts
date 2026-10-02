import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";

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
// GENERATE EXACTLY 6 DIGITS
// Example: 404725
// ============================================================================

function generateOtp(): string {
  return Math.floor(
    100000 + Math.random() * 900000,
  ).toString();
}

Deno.serve(async (req: Request) => {
  // ==========================================================================
  // CORS
  // ==========================================================================

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    // ==========================================================================
    // METHOD
    // ==========================================================================

    if (req.method !== "POST") {
      return jsonResponse(
        {
          success: false,
          error: "Method not allowed.",
        },
        405,
      );
    }

    // ==========================================================================
    // READ REQUEST BODY
    // ==========================================================================

    let body: Record<string, unknown>;

    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        {
          success: false,
          error: "Invalid JSON request body.",
        },
        400,
      );
    }

    const visitorId =
      typeof body?.visitorId === "string"
        ? body.visitorId.trim()
        : "";

    const type =
      typeof body?.type === "string"
        ? body.type.trim().toLowerCase()
        : "otp";

    if (!visitorId) {
      return jsonResponse(
        {
          success: false,
          error: "visitorId is required.",
        },
        400,
      );
    }

    if (
      type !== "otp" &&
      type !== "qr"
    ) {
      return jsonResponse(
        {
          success: false,
          error: "Invalid email type.",
        },
        400,
      );
    }

    // ==========================================================================
    // ENVIRONMENT VARIABLES
    // ==========================================================================

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL");

    const serviceRoleKey =
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY",
      );

    const resendApiKey =
      Deno.env.get("RESEND_API_KEY");

    if (
      !supabaseUrl ||
      !serviceRoleKey
    ) {
      console.error(
        "Missing Supabase environment variables.",
      );

      throw new Error(
        "Supabase environment variables are missing.",
      );
    }

    if (!resendApiKey) {
      console.error(
        "Missing RESEND_API_KEY.",
      );

      throw new Error(
        "RESEND_API_KEY is not configured.",
      );
    }

    // ==========================================================================
    // SUPABASE ADMIN CLIENT
    // ==========================================================================

    const supabaseAdmin =
      createClient(
        supabaseUrl,
        serviceRoleKey,
      );

    // ==========================================================================
    // OTP EMAIL
    // ==========================================================================

    if (type === "otp") {
      // ------------------------------------------------------------------------
      // 1. FIND VISITOR
      // ------------------------------------------------------------------------

      const {
        data: visitor,
        error: visitorError,
      } =
        await supabaseAdmin
          .from("visitors")
          .select(
            "id, email, full_name, otp, otp_expires_at, otp_verified",
          )
          .eq("id", visitorId)
          .single();

      if (
        visitorError ||
        !visitor
      ) {
        console.error(
          "Visitor lookup error:",
          visitorError,
        );

        return jsonResponse(
          {
            success: false,
            error: "Visitor not found.",
          },
          404,
        );
      }

      // ------------------------------------------------------------------------
      // 2. VALIDATE EMAIL
      // ------------------------------------------------------------------------

      if (!visitor.email) {
        return jsonResponse(
          {
            success: false,
            error:
              "Visitor email address is missing.",
          },
          400,
        );
      }

      // ------------------------------------------------------------------------
      // 3. DO NOT SEND OTP AGAIN TO A VERIFIED VISITOR
      // ------------------------------------------------------------------------

      if (
        visitor.otp_verified === true
      ) {
        return jsonResponse(
          {
            success: false,
            error:
              "This visitor has already been verified.",
          },
          400,
        );
      }

      // ------------------------------------------------------------------------
      // 4. GENERATE NEW 6-DIGIT OTP
      //
      // IMPORTANT:
      // The Edge Function now creates the OTP itself.
      //
      // Example:
      // 404725
      //
      // NOT:
      // 40472500
      // ------------------------------------------------------------------------

      const otp = generateOtp();

      const otpExpiresAt =
        new Date(
          Date.now() +
            10 * 60 * 1000,
        ).toISOString();

      console.log(
        "Generated SHELF OTP:",
        {
          visitorId,
          email: visitor.email,
          expiresAt:
            otpExpiresAt,
        },
      );

      // ------------------------------------------------------------------------
      // 5. SAVE OTP TO VISITOR
      // ------------------------------------------------------------------------

      const {
        error: updateError,
      } =
        await supabaseAdmin
          .from("visitors")
          .update({
            otp,
            otp_expires_at:
              otpExpiresAt,
            otp_verified: false,
          })
          .eq("id", visitorId);

      if (updateError) {
        console.error(
          "Failed to save visitor OTP:",
          updateError,
        );

        throw new Error(
          "Unable to save the verification code.",
        );
      }

      // ------------------------------------------------------------------------
      // 6. PREPARE EMAIL
      // ------------------------------------------------------------------------

      const firstName =
        escapeHtml(
          visitor.full_name
            ?.split(" ")[0] ||
            "Visitor",
        );

      // ------------------------------------------------------------------------
      // 7. SEND OTP THROUGH RESEND
      // ------------------------------------------------------------------------

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
              from:
                "SHELF ILMS <support@shelf-ilms.me>",

              to: [
                visitor.email,
              ],

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
                    SHELF ILMS Email Verification
                  </h2>

                  <p>
                    Hello ${firstName},
                  </p>

                  <p>
                    Thank you for registering with
                    <strong>SHELF ILMS</strong>.
                  </p>

                  <p>
                    Your verification code is:
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
                    ${otp}
                  </div>

                  <p>
                    This code will expire in approximately
                    <strong>10 minutes</strong>.
                  </p>

                  <p>
                    If you did not create a
                    SHELF ILMS account, you can
                    safely ignore this email.
                  </p>

                  <p>
                    Regards,<br />
                    <strong>SHELF ILMS</strong>
                  </p>

                </div>
              `,
            }),
          },
        );

      // ------------------------------------------------------------------------
      // 8. READ RESEND RESPONSE SAFELY
      // ------------------------------------------------------------------------

      let resendData:
        | Record<string, unknown>
        | null = null;

      try {
        resendData =
          await resendResponse.json();
      } catch {
        resendData = null;
      }

      // ------------------------------------------------------------------------
      // 9. HANDLE RESEND ERROR
      // ------------------------------------------------------------------------

      if (!resendResponse.ok) {
        console.error(
          "Resend OTP error:",
          {
            status:
              resendResponse.status,

            data:
              resendData,
          },
        );

        return jsonResponse(
          {
            success: false,

            error:
              typeof resendData?.message ===
              "string"
                ? resendData.message
                : "Failed to send verification email.",

            resend_status:
              resendResponse.status,
          },
          500,
        );
      }

      // ------------------------------------------------------------------------
      // 10. SUCCESS
      // ------------------------------------------------------------------------

      console.log(
        "OTP email sent successfully:",
        resendData,
      );

      return jsonResponse({
        success: true,
        type: "otp",
        message:
          "Verification email sent successfully.",
      });
    }

    // ==========================================================================
    // QR CODE EMAIL
    // ==========================================================================

    const {
      data: visitor,
      error: visitorError,
    } =
      await supabaseAdmin
        .from("visitors")
        .select(
          "email, full_name, qr_code, otp_verified",
        )
        .eq("id", visitorId)
        .single();

    if (
      visitorError ||
      !visitor
    ) {
      console.error(
        "Visitor lookup error:",
        visitorError,
      );

      return jsonResponse(
        {
          success: false,
          error:
            "Visitor not found.",
        },
        404,
      );
    }

    if (!visitor.email) {
      return jsonResponse(
        {
          success: false,
          error:
            "Visitor email address is missing.",
        },
        400,
      );
    }

    if (
      !visitor.otp_verified
    ) {
      return jsonResponse(
        {
          success: false,
          error:
            "Visitor email has not been verified.",
        },
        400,
      );
    }

    if (!visitor.qr_code) {
      return jsonResponse(
        {
          success: false,
          error:
            "QR code is not available for this visitor.",
        },
        400,
      );
    }

    const firstName =
      escapeHtml(
        visitor.full_name
          ?.split(" ")[0] ||
          "Visitor",
      );

    // ------------------------------------------------------------------------
    // GENERATE QR PNG
    // ------------------------------------------------------------------------

    const qrDataUrl =
      await QRCode.toDataURL(
        visitor.qr_code,
        {
          width: 500,
          margin: 2,
          errorCorrectionLevel:
            "M",
        },
      );

    const base64Qr =
      qrDataUrl.split(",")[1];

    if (!base64Qr) {
      throw new Error(
        "Failed to generate QR code image.",
      );
    }

    // ------------------------------------------------------------------------
    // SEND QR EMAIL
    // ------------------------------------------------------------------------

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
            from:
              "SHELF ILMS <onboarding@resend.dev>",

            to: [
              visitor.email,
            ],

            subject:
              "Your SHELF ILMS Visitor QR Code",

            html: `
              <div style="
                font-family: Arial, sans-serif;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
                text-align: center;
              ">

                <h2>
                  SHELF ILMS Visitor QR Code
                </h2>

                <p style="text-align: left;">
                  Hello ${firstName},
                </p>

                <p style="text-align: left;">
                  Your SHELF ILMS account has been
                  successfully verified.
                </p>

                <p style="text-align: left;">
                  Your personal visitor QR code is
                  attached below.
                </p>

                <div style="
                  margin: 30px auto;
                  padding: 20px;
                  background: #ffffff;
                  border: 1px solid #e5e7eb;
                  border-radius: 12px;
                  width: fit-content;
                ">

                  <img
                    src="cid:visitor-qr-code"
                    alt="SHELF ILMS Visitor QR Code"
                    width="300"
                    style="
                      display: block;
                      width: 300px;
                      height: 300px;
                    "
                  />

                </div>

                <p style="text-align: left;">
                  Please present this QR code when
                  checking in at the library.
                </p>

                <p style="text-align: left;">
                  Regards,<br />
                  <strong>SHELF ILMS</strong>
                </p>

              </div>
            `,

            attachments: [
              {
                filename:
                  "shelf-ilms-visitor-qr.png",

                content:
                  base64Qr,

                content_type:
                  "image/png",

                content_id:
                  "visitor-qr-code",
              },
            ],
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
        "Resend QR email error:",
        {
          status:
            resendResponse.status,

          data:
            resendData,
        },
      );

      return jsonResponse(
        {
          success: false,
          error:
            typeof resendData?.message ===
            "string"
              ? resendData.message
              : "Failed to send QR code email.",

          resend_status:
            resendResponse.status,
        },
        500,
      );
    }

    console.log(
      "QR code email sent successfully:",
      resendData,
    );

    return jsonResponse({
      success: true,
      type: "qr",
      message:
        "QR code email sent successfully.",
    });
  } catch (error) {
    console.error(
      "send-visitor-otp error:",
      error,
    );

    return jsonResponse(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to process email request.",
      },
      500,
    );
  }
});
