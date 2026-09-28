import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FINE_PER_DAY = 10;

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

function getDateOnly(value: string | Date) {
  const date = new Date(value);

  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getOverdueDays(dueDate: string) {
  const today = getDateOnly(new Date());
  const due = getDateOnly(dueDate);

  const difference =
    today.getTime() - due.getTime();

  return Math.max(
    0,
    Math.floor(
      difference / (1000 * 60 * 60 * 24),
    ),
  );
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
          error: "Method not allowed.",
        },
        405,
      );
    }

    const supabaseUrl =
      Deno.env.get("SUPABASE_URL");

    const serviceRoleKey =
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY",
      );

    const resendApiKey =
      Deno.env.get("RESEND_API_KEY");

    const notificationSecret =
      Deno.env.get(
        "DUE_NOTIFICATION_SECRET",
      );

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

    if (notificationSecret) {
      const requestSecret =
        req.headers.get(
          "x-due-notification-secret",
        );

      if (
        requestSecret !==
        notificationSecret
      ) {
        return jsonResponse(
          {
            error: "Unauthorized.",
          },
          401,
        );
      }
    }

    const supabaseAdmin =
      createClient(
        supabaseUrl,
        serviceRoleKey,
      );

    const {
      data: requests,
      error: requestError,
    } = await supabaseAdmin
      .from("borrow_requests")
      .select(`
        id,
        visitor_id,
        book_id,
        book_title,
        status,
        due_date,
        return_date
      `)
      .eq("status", "borrowed")
      .is("return_date", null)
      .not("due_date", "is", null);

    if (requestError) {
      throw requestError;
    }

    let processed = 0;
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const request of requests || []) {
      processed++;

      if (!request.due_date) {
        skipped++;
        continue;
      }

      const today =
        getDateOnly(new Date());

      const dueDate =
        getDateOnly(request.due_date);

      const difference = Math.floor(
        (
          dueDate.getTime() -
          today.getTime()
        ) /
          (1000 * 60 * 60 * 24),
      );

      let notificationType:
        | "due_soon"
        | "due_today"
        | "overdue"
        | null = null;

      if (difference === 2) {
        notificationType = "due_soon";
      } else if (difference === 0) {
        notificationType = "due_today";
      } else if (difference < 0) {
        notificationType = "overdue";
      }

      if (!notificationType) {
        skipped++;
        continue;
      }

      const notificationDate =
        today.toISOString().slice(0, 10);

      const {
        data: existingNotification,
        error: existingError,
      } = await supabaseAdmin
        .from("due_date_notifications")
        .select("id")
        .eq(
          "borrow_request_id",
          request.id,
        )
        .eq(
          "notification_type",
          notificationType,
        )
        .eq(
          "notification_date",
          notificationDate,
        )
        .maybeSingle();

      if (existingError) {
        console.error(
          "Notification lookup error:",
          existingError,
        );

        failed++;
        continue;
      }

      if (existingNotification) {
        skipped++;
        continue;
      }

      const {
        data: visitor,
        error: visitorError,
      } = await supabaseAdmin
        .from("visitors")
        .select(
          "email, full_name",
        )
        .eq(
          "id",
          request.visitor_id,
        )
        .single();

      if (
        visitorError ||
        !visitor?.email
      ) {
        console.error(
          "Visitor lookup error:",
          visitorError,
        );

        failed++;
        continue;
      }

      const firstName =
        escapeHtml(
          visitor.full_name
            ?.split(" ")[0] ||
            "Visitor",
        );

      const bookTitle =
        escapeHtml(
          request.book_title ||
            "Library book",
        );

      const formattedDueDate =
        formatDate(
          request.due_date,
        );

      const overdueDays =
        getOverdueDays(
          request.due_date,
        );

      const currentFine =
        overdueDays *
        FINE_PER_DAY;

      let subject = "";
      let heading = "";
      let message = "";
      let noticeHtml = "";

      if (
        notificationType ===
        "due_soon"
      ) {
        subject =
          "SHELF ILMS: Your borrowed book is due soon";

        heading =
          "Your book is due soon";

        message =
          `Your borrowed book <strong>${bookTitle}</strong> is due on <strong>${formattedDueDate}</strong>.`;

        noticeHtml = `
          <div style="
            background:#f3f4f6;
            padding:16px;
            border-radius:8px;
            margin:20px 0;
          ">
            <strong>Due date:</strong>
            ${formattedDueDate}
          </div>
        `;
      }

      if (
        notificationType ===
        "due_today"
      ) {
        subject =
          "SHELF ILMS: Your borrowed book is due today";

        heading =
          "Your book is due today";

        message =
          `Your borrowed book <strong>${bookTitle}</strong> is due today. Please return it today to avoid an overdue fine.`;

        noticeHtml = `
          <div style="
            background:#fff7ed;
            padding:16px;
            border-radius:8px;
            margin:20px 0;
          ">
            <strong>Due today:</strong>
            ${formattedDueDate}
          </div>
        `;
      }

      if (
        notificationType ===
        "overdue"
      ) {
        subject =
          "SHELF ILMS: Your borrowed book is overdue";

        heading =
          "Your book is overdue";

        message =
          `Your borrowed book <strong>${bookTitle}</strong> is overdue. Please return it as soon as possible.`;

        noticeHtml = `
          <div style="
            background:#fef2f2;
            border:1px solid #fecaca;
            padding:16px;
            border-radius:8px;
            margin:20px 0;
          ">
            <strong>Due date:</strong>
            ${formattedDueDate}<br />
            <strong>Overdue days:</strong>
            ${overdueDays}<br />
            <strong>Current fine:</strong>
            ₱${currentFine.toFixed(2)}
          </div>
        `;
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
              from:
                "SHELF ILMS <support@shelf-ilms.me>",
              to: [visitor.email],
              subject,
              html: `
                <div style="
                  font-family:Arial,sans-serif;
                  max-width:600px;
                  margin:0 auto;
                  padding:20px;
                ">
                  <h2>
                    ${heading}
                  </h2>

                  <p>
                    Hello ${firstName},
                  </p>

                  <p>
                    ${message}
                  </p>

                  ${noticeHtml}

                  <p>
                    SHELF ILMS applies an
                    overdue fine of
                    <strong>₱10 per overdue day</strong>.
                  </p>

                  <p>
                    Please return the book
                    through the library as
                    soon as possible.
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
          "Resend notification error:",
          resendData,
        );

        failed++;
        continue;
      }

      const {
        error: insertError,
      } = await supabaseAdmin
        .from(
          "due_date_notifications",
        )
        .insert({
          borrow_request_id:
            request.id,
          visitor_id:
            request.visitor_id,
          notification_type:
            notificationType,
          notification_date:
            notificationDate,
          sent_at:
            new Date().toISOString(),
        });

      if (insertError) {
        console.error(
          "Notification log error:",
          insertError,
        );

        failed++;
        continue;
      }

      console.log(
        "Due-date notification sent:",
        {
          requestId: request.id,
          type: notificationType,
          resendId: resendData.id,
        },
      );

      sent++;
    }

    return jsonResponse({
      success: true,
      processed,
      sent,
      skipped,
      failed,
      checkedAt:
        new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "send-due-date-notifications error:",
      error,
    );

    return jsonResponse(
      {
        error:
          "Unable to process due-date notifications.",
      },
      500,
    );
  }
});