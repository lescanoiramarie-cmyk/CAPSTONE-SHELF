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

    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON request body." }, 400);
    }

    const isManualFollowUp = payload.operation === "follow-up";

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

    if (!isManualFollowUp) {
      const requestSecret =
        req.headers.get(
          "x-due-notification-secret",
        );

      if (
        !notificationSecret ||
        requestSecret !==
        notificationSecret
      ) {
        return jsonResponse(
          {
            error: notificationSecret
              ? "Unauthorized."
              : "Scheduled due-date notifications are not configured with a secret.",
          },
          notificationSecret ? 401 : 503,
        );
      }
    }

    const supabaseAdmin =
      createClient(
        supabaseUrl,
        serviceRoleKey,
      );

    if (isManualFollowUp) {
      const authorization = req.headers.get("Authorization");
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (!authorization || !anonKey) {
        return jsonResponse({ error: "A signed-in Super Admin session is required." }, 401);
      }

      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: authData, error: authError } = await userClient.auth.getUser();
      if (authError || !authData.user) {
        return jsonResponse({ error: "Your session is invalid or expired." }, 401);
      }

      const { data: staff, error: staffError } = await supabaseAdmin
        .from("staff_profiles")
        .select("id, role, library_id, is_active")
        .eq("id", authData.user.id)
        .maybeSingle();
      const authRole = authData.user.app_metadata?.role;
      if (
        staffError ||
        !staff ||
        staff.is_active !== true ||
        !["superadmin", "subadmin"].includes(staff.role) ||
        (authRole !== undefined &&
          authRole !== null &&
          authRole !== staff.role)
      ) {
        return jsonResponse({ error: "Only active library staff can send a follow-up." }, 403);
      }

      const borrowRequestId = String(payload.borrowRequestId || "").trim();
      if (!borrowRequestId) {
        return jsonResponse({ error: "A borrow request ID is required." }, 400);
      }

      const { data: request, error: lookupError } = await supabaseAdmin
        .from("borrow_requests")
        .select("id, visitor_id, book_id, book_title, status, due_date, return_date")
        .eq("id", borrowRequestId)
        .maybeSingle();
      if (lookupError || !request) {
        return jsonResponse({ error: "Borrow request not found." }, 404);
      }
      if (staff.role === "subadmin") {
        if (!staff.library_id || !request.book_id) {
          return jsonResponse({ error: "This request is not assigned to your branch." }, 403);
        }
        const { data: requestBook, error: bookError } = await supabaseAdmin
          .from("books")
          .select("library_id")
          .eq("id", request.book_id)
          .maybeSingle();
        if (bookError || requestBook?.library_id !== staff.library_id) {
          return jsonResponse({ error: "You can only follow up on loans from your assigned branch." }, 403);
        }
      }
      if (request.status !== "borrowed" || request.return_date || !request.due_date) {
        return jsonResponse({ error: "This request is no longer an active loan." }, 409);
      }

      const today = getDateOnly(new Date());
      const dueDate = getDateOnly(request.due_date);
      if (dueDate.getTime() > today.getTime()) {
        return jsonResponse({ error: "This book is not due yet." }, 400);
      }

      const notificationDate = today.toISOString().slice(0, 10);
      const { error: claimError } = await supabaseAdmin
        .from("due_date_notifications")
        .insert({
          borrow_request_id: request.id,
          visitor_id: request.visitor_id,
          notification_type: "follow_up",
          notification_date: notificationDate,
        });
      if (claimError?.code === "23505") {
        return jsonResponse({ error: "A follow-up was already sent for this loan today." }, 409);
      }
      if (claimError) {
        console.error("Follow-up notification claim failed:", claimError);
        return jsonResponse({ error: "Unable to record the follow-up." }, 500);
      }

      const { data: visitor, error: visitorError } = await supabaseAdmin
        .from("visitors")
        .select("email, full_name")
        .eq("id", request.visitor_id)
        .maybeSingle();
      if (visitorError || !visitor?.email) {
        await supabaseAdmin
          .from("due_date_notifications")
          .delete()
          .eq("borrow_request_id", request.id)
          .eq("notification_type", "follow_up")
          .eq("notification_date", notificationDate);
        return jsonResponse({ error: "The visitor email address could not be found." }, 404);
      }

      const overdueDays = getOverdueDays(request.due_date);
      const bookTitle = escapeHtml(request.book_title || "Library book");
      const firstName = escapeHtml(visitor.full_name?.split(" ")[0] || "Visitor");
      const dueLabel = formatDate(request.due_date);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "SHELF ILMS <support@shelf-ilms.me>",
          to: [visitor.email],
          subject: "SHELF ILMS: Follow-up for your overdue book",
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2>Overdue book follow-up</h2><p>Hello ${firstName},</p><p>Please return <strong>${bookTitle}</strong>, which was due on <strong>${dueLabel}</strong>.</p><p>Overdue days: ${overdueDays}<br />Current fine: ₱${(overdueDays * FINE_PER_DAY).toFixed(2)}</p><p>Please contact the library if you have already returned this book.</p><p>Regards,<br /><strong>SHELF ILMS</strong></p></div>`,
        }),
      });
      const emailResult = await response.json().catch(() => ({}));
      if (!response.ok) {
        await supabaseAdmin
          .from("due_date_notifications")
          .delete()
          .eq("borrow_request_id", request.id)
          .eq("notification_type", "follow_up")
          .eq("notification_date", notificationDate);
        console.error("Follow-up email failed:", emailResult);
        return jsonResponse({ error: "Unable to send the follow-up email." }, 502);
      }

      return jsonResponse({ success: true, sent: true });
    }

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

    const {
      data: visitors,
      error: visitorsError,
    } = await supabaseAdmin
      .from("visitors")
      .select("id, email, full_name");

    if (visitorsError) {
      throw visitorsError;
    }

    for (const visitor of visitors || []) {
      if (!visitor.id || !visitor.email) {
        skipped++;
        continue;
      }

      const {
        data: communityRequests,
        error: communityRequestsError,
      } = await supabaseAdmin.rpc(
        "fetch_my_community_book_requests",
        {
          p_requester_visitor_id: visitor.id,
        },
      );

      if (communityRequestsError) {
        console.error(
          "Community due-date request lookup error:",
          {
            visitorId: visitor.id,
            error: communityRequestsError,
          },
        );
        failed++;
        continue;
      }

      for (const request of communityRequests || []) {
        if (
          request.status !== "borrowed" ||
          request.return_date ||
          !request.due_date
        ) {
          continue;
        }

        processed++;

        const today = getDateOnly(new Date());
        const dueDate = getDateOnly(request.due_date);
        const difference = Math.floor(
          (dueDate.getTime() - today.getTime()) /
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
          .from("community_due_date_notifications")
          .select("id")
          .eq("community_request_id", request.id)
          .eq("notification_type", notificationType)
          .eq("notification_date", notificationDate)
          .maybeSingle();

        if (existingError) {
          console.error(
            "Community due-date notification lookup error:",
            existingError,
          );
          failed++;
          continue;
        }

        if (existingNotification) {
          skipped++;
          continue;
        }

        const firstName = escapeHtml(
          visitor.full_name?.split(" ")[0] || "Visitor",
        );
        const bookTitle = escapeHtml(
          request.book_title || "Community book",
        );
        const ownerName = escapeHtml(
          request.owner_name || "the book owner",
        );
        const formattedDueDate = formatDate(
          request.due_date,
        );

        let subject = "";
        let heading = "";
        let message = "";

        if (notificationType === "due_soon") {
          subject =
            "SHELF ILMS: Return your community book soon";
          heading = "Your community book is due soon";
          message =
            `Please return <strong>${bookTitle}</strong> to ${ownerName} by <strong>${formattedDueDate}</strong>.`;
        } else if (notificationType === "due_today") {
          subject =
            "SHELF ILMS: Your community book is due today";
          heading = "Your community book is due today";
          message =
            `Please return <strong>${bookTitle}</strong> to ${ownerName} today, <strong>${formattedDueDate}</strong>.`;
        } else {
          const overdueDays = getOverdueDays(
            request.due_date,
          );
          subject =
            "SHELF ILMS: Your community book is overdue";
          heading = "Your community book is overdue";
          message =
            `<strong>${bookTitle}</strong> was due to ${ownerName} on <strong>${formattedDueDate}</strong> and is now ${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue. Please arrange its return with the owner as soon as possible.`;
        }

        const emailResponse = await fetch(
          "https://api.resend.com/emails",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "SHELF ILMS <support@shelf-ilms.me>",
              to: [visitor.email],
              subject,
              html: `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
                  <h2>${heading}</h2>
                  <p>Hello ${firstName},</p>
                  <p>${message}</p>
                  <p>This book is lent by a SHELF community member. Please coordinate the handover directly with the owner.</p>
                  <p>Regards,<br /><strong>SHELF ILMS</strong></p>
                </div>
              `,
            }),
          },
        );

        const emailData = await emailResponse.json();

        if (!emailResponse.ok) {
          console.error(
            "Community due-date email error:",
            emailData,
          );
          failed++;
          continue;
        }

        const {
          error: insertError,
        } = await supabaseAdmin
          .from("community_due_date_notifications")
          .insert({
            community_request_id: request.id,
            visitor_id: visitor.id,
            notification_type: notificationType,
            notification_date: notificationDate,
          });

        if (insertError) {
          console.error(
            "Community due-date notification log error:",
            insertError,
          );
          failed++;
          continue;
        }

        console.log(
          "Community book due-date notification sent:",
          {
            requestId: request.id,
            type: notificationType,
            resendId: emailData.id,
          },
        );
        sent++;
      }
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