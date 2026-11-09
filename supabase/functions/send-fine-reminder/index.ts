import { createClient } from "@supabase/supabase-js";
import { claimNotification, sendWithNotificationClaim } from "../send-due-date-notifications/notificationClaims.js";
import { getCurrentFine } from "../send-due-date-notifications/fineNotification.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const authorization = req.headers.get("Authorization");
    if (!supabaseUrl || !serviceRoleKey || !anonKey || !authorization) return jsonResponse({ error: "A signed-in staff session is required." }, 401);
    if (!resendApiKey) return jsonResponse({ error: "Email alerts are not configured." }, 503);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return jsonResponse({ error: "Your session is invalid or expired." }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: staff, error: staffError } = await admin.from("staff_profiles").select("id, role, library_id, is_active").eq("id", authData.user.id).maybeSingle();
    if (staffError) return jsonResponse({ error: "Unable to verify your staff profile." }, 500);
    if (!staff || staff.is_active !== true || !["subadmin", "superadmin"].includes(String(staff.role).toLowerCase())) return jsonResponse({ error: "Active library staff access is required." }, 403);

    const payload = await req.json().catch(() => null);
    const requestId = String(payload?.borrowRequestId || "").trim();
    if (!requestId) return jsonResponse({ error: "A borrow request ID is required." }, 400);
    const { data: loan, error: loanError } = await admin.from("borrow_requests").select("id, visitor_id, book_id, book_title, status, due_date, return_date, fine_amount, fine_paid_amount, fine_rate_snapshot").eq("id", requestId).maybeSingle();
    if (loanError || !loan) return jsonResponse({ error: "Fine record not found." }, 404);
    const role = String(staff.role).toLowerCase();
    const { data: book, error: bookError } = await admin.from("books").select("library_id").eq("id", loan.book_id).maybeSingle();
    if (bookError || !book) return jsonResponse({ error: "The loan’s library could not be verified." }, 404);
    if (role === "subadmin" && (!staff.library_id || book.library_id !== staff.library_id)) return jsonResponse({ error: "You can only alert visitors with fines from your assigned library." }, 403);
    if (!["borrowed", "returned"].includes(loan.status)) return jsonResponse({ error: "This loan has no active fine balance." }, 409);
    const { data: visitorLoans, error: visitorLoansError } = await admin.from("borrow_requests").select("id, book_id, book_title, status, due_date, fine_amount, fine_paid_amount, fine_rate_snapshot").eq("visitor_id", loan.visitor_id).in("status", ["borrowed", "returned"]);
    if (visitorLoansError || !visitorLoans?.length) return jsonResponse({ error: "Unable to retrieve the visitor’s fine records." }, 500);
    const bookIds = [...new Set(visitorLoans.map((item) => item.book_id).filter(Boolean))];
    const { data: books, error: booksError } = await admin.from("books").select("id, library_id").in("id", bookIds);
    if (booksError) return jsonResponse({ error: "Unable to verify the visitor’s library records." }, 500);
    const bookLibraryIds = new Map((books || []).map((item) => [String(item.id), String(item.library_id)]));
    const fineRows = visitorLoans.filter((item) => {
      if (!["borrowed", "returned"].includes(item.status)) return false;
      if (bookLibraryIds.get(String(item.book_id)) !== String(book.library_id)) return false;
      const fine = getCurrentFine(item, new Date());
      return fine != null && Math.max(0, Number(fine) - Number(item.fine_paid_amount || 0)) > 0;
    }).map((item) => {
      const fine = Number(getCurrentFine(item, new Date()) || 0);
      return { ...item, balance: Math.max(0, fine - Number(item.fine_paid_amount || 0)) };
    });
    const balance = fineRows.reduce((sum, item) => sum + item.balance, 0);
    if (balance <= 0) return jsonResponse({ error: "This visitor has no confirmed outstanding balance." }, 409);
    const { data: visitor, error: visitorError } = await admin.from("visitors").select("email, full_name").eq("id", loan.visitor_id).maybeSingle();
    if (visitorError) return jsonResponse({ error: "Unable to retrieve the visitor email." }, 500);
    if (!visitor?.email) return jsonResponse({ error: "The visitor has no email address on file." }, 404);

    const notificationDate = new Date().toISOString().slice(0, 10);
    const claim = { borrow_request_id: loan.id, visitor_id: String(loan.visitor_id), notification_type: "fine_reminder", notification_date: notificationDate };
    const claimResult = await claimNotification(admin, "due_date_notifications", claim);
    if (claimResult.status === "duplicate") return jsonResponse({ error: "A fine alert was already sent for this loan today." }, 409);
    if (claimResult.status !== "claimed") return jsonResponse({ error: "Unable to record this alert." }, 500);

    const firstName = escapeHtml(String(visitor.full_name || "Visitor").split(" ")[0]);
    const fineList = fineRows.map((item) => {
      const dueDate = item.due_date ? new Date(item.due_date).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }) : "unavailable";
      return `<li style="margin:10px 0"><strong>${escapeHtml(String(item.book_title || "Library book"))}</strong> · due ${escapeHtml(dueDate)} · ₱${item.balance.toFixed(2)}</li>`;
    }).join("");
    const delivery = await sendWithNotificationClaim(admin, "due_date_notifications", claim, () => fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "SHELF <support@shelf-ilms.me>",
        to: [visitor.email],
        subject: "SHELF: Outstanding library fine",
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2>Outstanding fine reminder</h2><p>Hello ${firstName},</p><p>Our records show confirmed outstanding fines for your books:</p><ul>${fineList}</ul><p>Total confirmed balance: <strong>₱${balance.toFixed(2)}</strong></p><p>Please contact the library to settle the balance. If you have already paid, please contact library staff so they can update your record.</p><p>Regards,<br/><strong>SHELF</strong></p></div>`,
      }),
    }));
    if (delivery.status === "accepted") return jsonResponse({ success: true, sent: true });
    if (delivery.status === "rejected") return jsonResponse({ error: "The email provider could not send the alert." }, 502);
    if (delivery.status === "cleanup_failed") return jsonResponse({ error: "The provider rejected the alert, but its retry record could not be cleared." }, 500);
    return jsonResponse({ error: "The email result could not be confirmed. Retry is blocked for today to prevent duplicate alerts." }, 502);
  } catch (error) {
    console.error("Fine reminder failed:", error);
    return jsonResponse({ error: "Unable to send fine reminder." }, 500);
  }
});
