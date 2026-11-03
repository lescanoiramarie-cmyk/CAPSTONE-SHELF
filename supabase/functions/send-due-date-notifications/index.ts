import { createClient } from "@supabase/supabase-js";
import {
  getCurrentFine,
  getFineNotificationCopy,
  getFineOverdueDays,
} from "./fineNotification.js";
import {
  formatNotificationDate,
  getDueDateNotificationType,
  getNotificationDateKey,
} from "./notificationDate.js";
import {
  claimNotification,
  releaseNotificationClaim,
  sendWithNotificationClaim,
} from "./notificationClaims.js";

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

function formatDate(value: string) {
  return formatNotificationDate(value);
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
        return jsonResponse({ error: "A signed-in staff session is required." }, 401);
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
      if (staffError) {
        console.error("Follow-up staff profile lookup failed:", staffError);
        return jsonResponse({ error: "Unable to verify your staff profile." }, 500);
      }
      if (!staff || staff.is_active !== true) {
        return jsonResponse({ error: "Your staff account is not active." }, 403);
      }
      if (!["superadmin", "subadmin"].includes(staff.role)) {
        return jsonResponse({ error: "Only active library staff can send a follow-up." }, 403);
      }

      const borrowRequestId = String(payload.borrowRequestId || "").trim();
      if (!borrowRequestId) {
        return jsonResponse({ error: "A borrow request ID is required." }, 400);
      }

      const { data: request, error: lookupError } = await supabaseAdmin
        .from("borrow_requests")
        .select("id, visitor_id, book_id, book_title, status, due_date, return_date, fine_amount, fine_rate_snapshot")
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

      const asOf = new Date();
      const dueTime = new Date(request.due_date).getTime();
      if (!Number.isFinite(dueTime) || dueTime >= asOf.getTime()) {
        return jsonResponse({ error: "This book is not due yet." }, 400);
      }

      const notificationDate = getNotificationDateKey(asOf);
      const followUpClaim = {
        borrow_request_id: request.id,
        visitor_id: request.visitor_id,
        notification_type: "follow_up",
        notification_date: notificationDate,
      };
      // This table has no claimed/sent state; the row is an idempotency claim.
      const claimResult = await claimNotification(
        supabaseAdmin,
        "due_date_notifications",
        followUpClaim,
      );
      if (claimResult.status === "duplicate") {
        return jsonResponse({ error: "A follow-up is already recorded for this loan today." }, 409);
      }
      if (claimResult.status !== "claimed") {
        console.error(
          "Follow-up claim could not be confirmed; no email was attempted.",
          claimResult.error?.code || claimResult.status,
        );
        return jsonResponse({ error: "Unable to record the follow-up." }, 500);
      }

      let visitor: { email: string | null; full_name: string | null } | null = null;
      let visitorLookupFailed = false;
      try {
        const { data, error } = await supabaseAdmin
          .from("visitors")
          .select("email, full_name")
          .eq("id", request.visitor_id)
          .maybeSingle();
        visitor = data;
        visitorLookupFailed = Boolean(error);
      } catch {
        visitorLookupFailed = true;
      }
      if (visitorLookupFailed || !visitor?.email) {
        const cleanup = await releaseNotificationClaim(
          supabaseAdmin,
          "due_date_notifications",
          {
            borrow_request_id: request.id,
            notification_type: "follow_up",
            notification_date: notificationDate,
          },
        );
        if (!cleanup.released) {
          console.error(
            "Follow-up claim cleanup failed after visitor lookup failure.",
            cleanup.error?.code || "claim_not_removed",
          );
          return jsonResponse({ error: "Unable to clear the follow-up claim." }, 500);
        }
        if (visitorLookupFailed) {
          console.error("Follow-up recipient lookup failed; claim cleared.");
          return jsonResponse({ error: "Unable to retrieve the follow-up recipient." }, 500);
        }
        return jsonResponse({ error: "The visitor email address could not be found." }, 404);
      }

      const overdueDays = getFineOverdueDays(request.due_date, asOf);
      const currentFine = getCurrentFine(request, asOf);
      const fineCopy = getFineNotificationCopy(request, currentFine);
      const bookTitle = escapeHtml(request.book_title || "Library book");
      const firstName = escapeHtml(visitor.full_name?.split(" ")[0] || "Visitor");
      const dueLabel = formatDate(request.due_date);
      const delivery = await sendWithNotificationClaim(
        supabaseAdmin,
        "due_date_notifications",
        {
          borrow_request_id: request.id,
          notification_type: "follow_up",
          notification_date: notificationDate,
        },
        () => fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "SHELF <support@shelf-ilms.me>",
            to: [visitor.email],
            subject: "SHELF: Follow-up for your overdue book",
            html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2>Overdue book follow-up</h2><p>Hello ${firstName},</p><p>Please return <strong>${bookTitle}</strong>, which was due on <strong>${dueLabel}</strong>.</p><p>Overdue days: ${overdueDays ?? 'unavailable'}<br />${fineCopy.dailyRate}${fineCopy.fineAmount ? `<br />${fineCopy.fineAmount}` : `<br />${fineCopy.unavailable}`}</p><p>Please contact the library if you have already returned this book.</p><p>Regards,<br /><strong>SHELF</strong></p></div>`,
          }),
        }),
      );
      if (delivery.status === "ambiguous") {
        console.error(
          "Follow-up provider outcome is ambiguous; claim retained and retry blocked for today.",
          delivery.response?.status || "network_error",
        );
        return jsonResponse({ error: "Unable to confirm the follow-up email. The claim was retained to prevent a duplicate." }, 502);
      }
      if (delivery.status === "cleanup_failed") {
        console.error(
          "Follow-up provider rejection claim cleanup failed.",
          delivery.error?.code || "claim_not_removed",
        );
        return jsonResponse({ error: "The email provider rejected the send, but the retry claim could not be cleared." }, 500);
      }
      if (delivery.status === "rejected") {
        console.error("Follow-up email provider rejected the request:", delivery.response.status);
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
        return_date,
        fine_amount,
        fine_rate_snapshot
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

      const now = new Date();
      const notificationType = getDueDateNotificationType(
        request.due_date,
        now,
      );

      if (!notificationType) {
        skipped++;
        continue;
      }

      const notificationDate = getNotificationDateKey(now);
      if (!notificationDate) {
        failed++;
        console.error("Unable to derive the Manila notification date key.");
        continue;
      }

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

      const asOf = new Date();
      const overdueDays =
        getFineOverdueDays(request.due_date, asOf);

      const currentFine =
        getCurrentFine(request, asOf);
      const fineCopy =
        getFineNotificationCopy(request, currentFine);

      let subject = "";
      let heading = "";
      let message = "";
      let noticeHtml = "";

      if (
        notificationType ===
        "due_soon"
      ) {
        subject =
          "SHELF: Your borrowed book is due soon";

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
          "SHELF: Your borrowed book is due today";

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
          "SHELF: Your borrowed book is overdue";

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
            ${overdueDays ?? "unavailable"}
            ${fineCopy.fineAmount ? `<br /><strong>${fineCopy.fineAmount}</strong>` : `<br /><strong>${fineCopy.unavailable}</strong>`}
          </div>
        `;
      }

      const notificationClaim = {
        borrow_request_id: request.id,
        visitor_id: request.visitor_id,
        notification_type: notificationType,
        notification_date: notificationDate,
      };
      // The current table has no separate claimed/sent state; this row is the
      // atomic claim and is retained after provider acceptance or ambiguity.
      const claimResult = await claimNotification(
        supabaseAdmin,
        "due_date_notifications",
        notificationClaim,
      );
      if (claimResult.status === "duplicate") {
        skipped++;
        continue;
      }
      if (claimResult.status !== "claimed") {
        console.error(
          "Due-date notification claim could not be confirmed; no email was attempted.",
          claimResult.error?.code || claimResult.status,
        );
        failed++;
        continue;
      }

      const delivery = await sendWithNotificationClaim(
        supabaseAdmin,
        "due_date_notifications",
        {
          borrow_request_id: request.id,
          notification_type: notificationType,
          notification_date: notificationDate,
        },
        () => fetch(
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
                "SHELF <support@shelf-ilms.me>",
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
                    ${fineCopy.dailyRate}
                  </p>

                  <p>
                    Please return the book
                    through the library as
                    soon as possible.
                  </p>

                  <p>
                    Regards,<br />
                    <strong>SHELF</strong>
                  </p>
                </div>
              `,
            }),
          },
        ),
      );
      if (delivery.status === "ambiguous") {
        console.error(
          "Due-date provider outcome is ambiguous; claim retained and retry blocked for today.",
          delivery.response?.status || "network_error",
        );
        failed++;
        continue;
      }
      if (delivery.status === "cleanup_failed") {
        console.error(
          "Due-date provider rejection claim cleanup failed.",
          delivery.error?.code || "claim_not_removed",
        );
        failed++;
        continue;
      }
      if (delivery.status === "rejected") {
        console.error(
          "Due-date email provider rejected the request:",
          delivery.response.status,
        );
        failed++;
        continue;
      }

      const resendData = await delivery.response.json().catch(() => ({}));

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
      } = await supabaseAdmin
        .from("community_book_requests")
        .select(
          "id, requester_visitor_id, book_id, book_title, owner_name, status, due_date, return_date",
        )
        .eq("requester_visitor_id", visitor.id)
        .eq("status", "borrowed")
        .is("return_date", null)
        .not("due_date", "is", null);

      if (communityRequestsError) {
        console.error(
          "Community due-date request lookup error:",
          communityRequestsError.message,
        );
        failed++;
        continue;
      }

      for (const request of communityRequests || []) {
        if (request.requester_visitor_id !== visitor.id) {
          continue;
        }

        processed++;

        const now = new Date();
        const notificationType = getDueDateNotificationType(
          request.due_date,
          now,
        );

        if (!notificationType) {
          skipped++;
          continue;
        }

        const notificationDate = getNotificationDateKey(now);
        if (!notificationDate) {
          failed++;
          console.error("Unable to derive the Manila notification date key.");
          continue;
        }

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

        const notificationClaim = {
          community_request_id: request.id,
          visitor_id: visitor.id,
          notification_type: notificationType,
          notification_date: notificationDate,
        };
        // The table has no separate claimed/sent state; retain this atomic
        // claim after acceptance or an ambiguous provider outcome.
        const claimResult = await claimNotification(
          supabaseAdmin,
          "community_due_date_notifications",
          notificationClaim,
        );
        if (claimResult.status === "duplicate") {
          skipped++;
          continue;
        }
        if (claimResult.status !== "claimed") {
          console.error(
            "Community due-date claim could not be confirmed; no email was attempted.",
            claimResult.error?.code || claimResult.status,
          );
          failed++;
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
            "SHELF: Return your community book soon";
          heading = "Your community book is due soon";
          message =
            `Please return <strong>${bookTitle}</strong> to ${ownerName} by <strong>${formattedDueDate}</strong>.`;
        } else if (notificationType === "due_today") {
          subject =
            "SHELF: Your community book is due today";
          heading = "Your community book is due today";
          message =
            `Please return <strong>${bookTitle}</strong> to ${ownerName} today, <strong>${formattedDueDate}</strong>.`;
        } else {
          const overdueDays = getFineOverdueDays(request.due_date, now);
          subject =
            "SHELF: Your community book is overdue";
          heading = "Your community book is overdue";
          message =
            `<strong>${bookTitle}</strong> was due to ${ownerName} on <strong>${formattedDueDate}</strong> and is now ${overdueDays ?? "an unknown number of"} day${overdueDays === 1 ? "" : "s"} overdue. Please arrange its return with the owner as soon as possible.`;
        }

        const delivery = await sendWithNotificationClaim(
          supabaseAdmin,
          "community_due_date_notifications",
          {
            community_request_id: request.id,
            notification_type: notificationType,
            notification_date: notificationDate,
          },
          () => fetch(
            "https://api.resend.com/emails",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${resendApiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: "SHELF <support@shelf-ilms.me>",
                to: [visitor.email],
                subject,
                html: `
                  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
                    <h2>${heading}</h2>
                    <p>Hello ${firstName},</p>
                    <p>${message}</p>
                    <p>This book is lent by a SHELF community member. Please coordinate the handover directly with the owner.</p>
                    <p>Regards,<br /><strong>SHELF</strong></p>
                  </div>
                `,
              }),
            },
          ),
        );
        if (delivery.status === "ambiguous") {
          console.error(
            "Community due-date provider outcome is ambiguous; claim retained and retry blocked for today.",
            delivery.response?.status || "network_error",
          );
          failed++;
          continue;
        }
        if (delivery.status === "cleanup_failed") {
          console.error(
            "Community due-date provider rejection claim cleanup failed.",
            delivery.error?.code || "claim_not_removed",
          );
          failed++;
          continue;
        }
        if (delivery.status === "rejected") {
          console.error(
            "Community due-date provider rejected the request:",
            delivery.response.status,
          );
          failed++;
          continue;
        }

        const emailData = await delivery.response.json().catch(() => ({}));

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
      success: failed === 0,
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
