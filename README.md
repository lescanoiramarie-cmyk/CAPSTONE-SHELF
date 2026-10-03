# SHELF ILMS — Integrated Library Management System

Frontend for SHELF (Smart Hub for E-Library... Facilities), built for BatStateU
JPLPC–Malvar Campus and Tanauan City's integrated library network. React 19 +
Vite + Tailwind CSS v4.

## Running locally

```bash
npm install
npm run dev
```

## Backend and local setup

Operational data is stored in Supabase. The browser connects using
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; copy `.env.example` to `.env`,
set those values, run `supabase/schema.sql` in the project's SQL editor, then
apply the SQL files in `supabase/migrations/` in filename order. Visitor
registration uses Supabase Auth email OTP; enable email signup and email
confirmation, then configure the email provider/template before testing.
Existing visitor profiles are linked when a visitor signs up using the same
email address; the security migration clears legacy plaintext passwords.
The visitor QR is generated only after Auth confirms the six-digit email OTP;
set Supabase Auth email OTP length to 6 and use an email template that renders
`{{ .Token }}`.
Run `schema.sql` once on a fresh database. For an existing pre-migration
database, rerun it only to complete the base upgrade, then apply
`20261002_security_features.sql` followed by
`20261002_visitor_qr_activation.sql`. Do not rerun the base schema after those
migrations; it reinstates the initial permissive demo policies.
`src/data/store.js` contains most database operations and business actions,
while `src/context/LibraryContext.jsx` loads data and subscribes to Supabase
Realtime updates. Some dashboard operations also call Supabase directly.

The signed-in user session is persisted in browser `localStorage` by
`src/context/AuthContext.jsx`; library, visitor, attendance, and borrowing
records are not stored there. A working Supabase project is required for those
features to load and persist across devices.

## Demo / test accounts

Because this is a brand-new deployment, there is no seed data for visitors
or books — admins add real books via **Sub-Admin/Super-Admin → Inventory →
Add Book**, or click **Load Sample Catalog** there for dummy demo data.
Visitors self-register through the Visitor Portal (register → OTP → QR pass).

Staff accounts are provisioned through Supabase Auth and staff profiles;
there are no staff passwords embedded in the frontend. See the Auth-backed
staff provisioning steps below.

## Core workflow implemented

1. **Visitor**: register with Supabase Auth → verify the emailed OTP → receives
   a unique QR pass. Visitors can sign in with email/password or scan that pass;
   staff also scan it to confirm attendance, pickups, and returns. Treat the QR
   pass like a password because anyone holding it can access the account.
2. **Attendance**: visitor scans their QR pass at the entrance
   (Sub-Admin → Attendance) to log a visit.
3. **Borrowing**: visitor requests a book from the OPAC catalog.
   - If a copy is available, it's held for **24 hours** (`PICKUP_WINDOW_HOURS`
     in `store.js`) — the visitor must come in, scan their QR pass, and have
     the librarian confirm pickup (Sub-Admin → Book Transactions → Book
     Borrowing) within that window, or the hold auto-cancels and the next
     person in the reservation queue is promoted automatically.
   - If no copy is available, the visitor is queued and notified of their
     position.
4. **Returning**: librarian scans the visitor's QR pass (Sub-Admin → Book
   Transactions → Book Returning) and confirms the return; the copy becomes
   available again and the queue is re-checked.
5. **Library Map & Location**: multi-branch map (Tanauan City network) with
   search/filter and a status list — see `src/component/LibraryMap.jsx` for
   notes on swapping the key-free OpenStreetMap embed for the Google Maps API
   once a billing-enabled key is available.

## Admin workspace modules

Both admin dashboards include **Reports & Services**. Sub-admins see only
their assigned branch; super-admins can select a branch or view the whole
network. Reports and analytics share date filters, sorting, and CSV/Excel/PDF
exports. Analytics charts use attendance and borrowing records,
with demand-based operational suggestions. Visitors can submit feedback and
questions, receive FAQ answers for common topics, read announcements, and see
replies from the library team.

Attendance QR scans alternate between check-in and check-out for the active
branch/day. The security migration adds branch-aware RLS, Auth-linked visitor
profiles, personal books, reviews, audit logs, and a `pg_cron` job that expires
24-hour holds every minute. The QR activation follow-up withholds passes until
email verification and rotates existing passes; visitors should sign in and
save their refreshed pass after both migrations. Verify the scheduled job
under Database → Cron.
Deploy `visitor-qr-login` with `supabase functions deploy visitor-qr-login` and
set the Edge Function secret `APP_ORIGIN` (or comma-separated `APP_ORIGINS`) to
the exact deployed frontend origin so QR sign-in passes CORS.

### Community book return reminders

Borrowers see an in-app reminder on the Visitor Dashboard starting two days
before a community book is due, on the due date, and while it is overdue.
Deploy `send-due-date-notifications` to email the same reminders to borrowers:

1. Apply the `20261003000000_community_due_date_notifications.sql`,
   `20261003000100_community_return_reminder_schedule.sql`, and
   `20261003000200_community_borrower_transaction_details.sql` migrations.
   Apply `20261003000300_community_book_copy_inventory.sql` to enable visitor
   copy counts and automatic availability updates when a community book is
   handed over or returned.
2. Add `shelf_supabase_url` and `due_notification_secret` to Supabase Vault.
   Set `DUE_NOTIFICATION_SECRET` to the same secret using
   `supabase secrets set DUE_NOTIFICATION_SECRET=<secret>`.
3. Set `RESEND_API_KEY` as an Edge Function secret and deploy with
   `supabase functions deploy send-due-date-notifications`.

The scheduled job runs daily at 00:00 UTC (08:00 Philippine time). It also
sends the existing reminders for regular library loans. Community-book return
requests are read through `fetch_my_community_book_requests`; each reminder is
logged once per request, reminder type, and date.

### Auth-backed staff provisioning

Staff sign-in and authorization use Supabase Auth and `staff_profiles`.
Provisioning uses the `manage-staff` Supabase Edge Function and requires an
Auth-backed super-admin session:

1. Create a super-admin user in Supabase Authentication.
2. In the SQL editor, mark that account as the initial super-admin and create
   its profile (replace the email):

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"superadmin"}'::jsonb
   where lower(email) = lower('admin@example.edu');

   insert into public.staff_profiles (id, email, full_name, role)
   select id, email, coalesce(raw_user_meta_data ->> 'full_name', email), 'superadmin'
   from auth.users
   where lower(email) = lower('admin@example.edu')
   on conflict (id) do update set role = excluded.role;
   ```

3. Deploy the function with `supabase functions deploy manage-staff`. Configure
   `APP_ORIGIN` for the deployed frontend. The function uses Supabase's server
   environment and service-role key; never expose that key through a `VITE_`
   variable.
4. Sign in through the normal login page using the Auth-backed super-admin.
   Use **Reports & Services → Staff accounts** to create or disable branch
   sub-admins. New sub-admins sign in through the same login page.

### Python forecast service

The forecast endpoint consumes branch-scoped aggregate data from the dashboard
and returns seven daily visitor estimates, ranked category demand, and
operational recommendations. From PowerShell with Python 3.11 installed:

```powershell
cd analytics
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:ANALYTICS_ALLOWED_ORIGINS = "http://localhost:5173"
uvicorn main:app --host 127.0.0.1 --port 8000
```

Set `VITE_ANALYTICS_API_URL=http://localhost:8000` in the frontend `.env` and
restart Vite. The service exposes `GET /health` and `POST /forecast`.

## Known simplifications (flagged in-code)

- QR scanning supports both camera decoding (`html5-qrcode`) and manual input.
- Existing email/branch labels may remain in frontend constants for old UI
   paths, but no staff passwords are stored or used there.
- `schema.sql` is the initial demo schema and defines permissive policies.
   Apply `supabase/migrations/20261002_security_features.sql` after it before
   exposing a deployment.
- Map markers use approximate, clearly-flagged sample coordinates.
