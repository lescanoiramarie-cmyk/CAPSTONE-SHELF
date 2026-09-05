import { createClient } from "npm:@supabase/supabase-js@2";
import QRCode from "npm:qrcode@1.5.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
          error: "Method not allowed",
        },
        405,
      );
    }

    const body = await req.json();

    const visitorId = body?.visitorId;
    const type = body?.type || "otp";

    if (!visitorId) {
      return jsonResponse(
        {
          error: "visitorId is required",
        },
        400,
      );
    }

    if (type !== "otp" && type !== "qr") {
      return jsonResponse(
        {
          error: "Invalid email type.",
        },
        400,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY",
    );
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        "Supabase environment variables are missing.",
      );
    }

    if (!resendApiKey) {
      throw new Error(
        "RESEND_API_KEY is not configured.",
      );
    }

    const supabaseAdmin = createClient(
      supabaseUrl,
      serviceRoleKey,
    );

    // ============================================================
    // OTP EMAIL
    // ============================================================
    if (type === "otp") {
      const {
        data: visitor,
        error: visitorError,
      } = await supabaseAdmin
        .from("visitors")
        .select(
          "email, full_name, otp, otp_expires_at",
        )
        .eq("id", visitorId)
        .single();

      if (visitorError || !visitor) {
        console.error(
          "Visitor lookup error:",
          visitorError,
        );

        return jsonResponse(
          {
            error: "Visitor not found.",
          },
          404,
        );
      }

      if (!visitor.email || !visitor.otp) {
        return jsonResponse(
          {
            error:
              "No verification code is available for this visitor.",
          },
          400,
        );
      }

      if (
        visitor.otp_expires_at &&
        new Date(visitor.otp_expires_at).getTime() <=
          Date.now()
      ) {
        return jsonResponse(
          {
            error:
              "The verification code has expired. Please request a new code.",
          },
          400,
        );
      }

      const firstName = escapeHtml(
        visitor.full_name?.split(" ")[0] ||
          "Visitor",
      );

      const resendResponse = await fetch(
        "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from:
            "SHELF ILMS <support@shelf-ilms.me>",
            to: [visitor.email],
            subject:
              "Your SHELF ILMS Verification Code",
            html: `
              <div style="
                font-family: Arial, sans-serif;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
              ">
                <h2>
                  SHELF ILMS Email Verification
                </h2>

                <p>Hello ${firstName},</p>

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
                  ${visitor.otp}
                </div>

                <p>
                  This code will expire in approximately
                  <strong>10 minutes</strong>.
                </p>

                <p>
                  If you did not create a SHELF ILMS
                  account, you can safely ignore this
                  email.
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

      const resendData =
        await resendResponse.json();

      if (!resendResponse.ok) {
        console.error(
          "Resend OTP error:",
          resendData,
        );

        return jsonResponse(
          {
            error:
              "Failed to send verification email.",
          },
          500,
        );
      }

      console.log(
        "OTP email sent successfully:",
        resendData.id,
      );

      return jsonResponse({
        success: true,
        type: "otp",
        message:
          "Verification email sent successfully.",
      });
    }

    // ============================================================
    // QR CODE EMAIL
    // ============================================================
    const {
      data: visitor,
      error: visitorError,
    } = await supabaseAdmin
      .from("visitors")
      .select(
        "email, full_name, qr_code, otp_verified",
      )
      .eq("id", visitorId)
      .single();

    if (visitorError || !visitor) {
      console.error(
        "Visitor lookup error:",
        visitorError,
      );

      return jsonResponse(
        {
          error: "Visitor not found.",
        },
        404,
      );
    }

    if (!visitor.email) {
      return jsonResponse(
        {
          error:
            "Visitor email address is missing.",
        },
        400,
      );
    }

    if (!visitor.otp_verified) {
      return jsonResponse(
        {
          error:
            "Visitor email has not been verified.",
        },
        400,
      );
    }

    if (!visitor.qr_code) {
      return jsonResponse(
        {
          error:
            "QR code is not available for this visitor.",
        },
        400,
      );
    }

    const firstName = escapeHtml(
      visitor.full_name?.split(" ")[0] ||
        "Visitor",
    );

    // Generate QR code as PNG
    const qrDataUrl = await QRCode.toDataURL(
      visitor.qr_code,
      {
        width: 500,
        margin: 2,
        errorCorrectionLevel: "M",
      },
    );

    const base64Qr = qrDataUrl.split(",")[1];

    if (!base64Qr) {
      throw new Error(
        "Failed to generate QR code image.",
      );
    }

    const resendResponse = await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from:
            "SHELF ILMS <onboarding@resend.dev>",
          to: [visitor.email],
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
                attached below. Please keep this
                QR code for your future library
                visits.
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
                You may also save the attached
                QR image to your device.
              </p>

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
              content: base64Qr,
              content_type: "image/png",
              content_id:
                "visitor-qr-code",
            },
          ],
        }),
      },
    );

    const resendData =
      await resendResponse.json();

    if (!resendResponse.ok) {
      console.error(
        "Resend QR email error:",
        resendData,
      );

      return jsonResponse(
        {
          error:
            "Failed to send QR code email.",
        },
        500,
      );
    }

    console.log(
      "QR code email sent successfully:",
      resendData.id,
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
        error:
          "Unable to process email request.",
      },
      500,
    );
  }
});