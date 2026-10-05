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
with Gemini-generated operational suggestions. Visitors can submit feedback and
questions, ask FAQ questions with answers grounded in the published FAQ corpus,
read announcements, and see replies from the library team. OPAC recommendations
can also use recent searches saved locally for the signed-in visitor; searches
are not sent to the analytics service.

Attendance QR scans alternate between check-in and check-out for the active
branch/day. Visitors show their QR pass to staff for scanning; visitor
self-service entrance scanning is intentionally not enabled. The security
migrations add branch-aware RLS, Auth-linked visitor profiles, personal books,
reviews, audit logs, and a `pg_cron` job that expires 24-hour holds every
minute. The QR activation follow-up withholds passes until email verification
and rotates existing passes; visitors should sign in and save their refreshed
pass after both migrations. Verify the scheduled job under Database → Cron.
Deploy `visitor-qr-login` with `supabase functions deploy visitor-qr-login` and
set the Edge Function secret `APP_ORIGINS` to every frontend origin that should
be allowed to use QR sign-in. The function also allows the standard local Vite
origins (`localhost:5173` and `127.0.0.1:5173`). For the production site:

```bash
supabase secrets set APP_ORIGINS="https://capstone-shelf.vercel.app"
supabase functions deploy visitor-qr-login
```

Replace the production URL with the exact deployed frontend origin if it differs.
Redeploy the function whenever its CORS allowlist code changes. If using
`APP_ORIGINS`, it takes precedence over `APP_ORIGIN` for production origins.

### Community book return reminders

Borrowers see an in-app reminder on the Visitor Dashboard starting two days
before a community book is due, on the due date, and while it is overdue.
Deploy `send-due-date-notifications` to email the same reminders to borrowers:

1. Apply the `20261003000000_community_due_date_notifications.sql`,
   `20261003000100_community_return_reminder_schedule.sql`, and
   `20261003000200_community_borrower_transaction_details.sql` migrations.
   Apply `20261003000300_community_book_copy_inventory.sql` to enable visitor
   copy counts and automatic availability updates when a community book is
   handed over or returned. Apply
   `20261004000000_auth_inventory_geography_fixes.sql` after the earlier
   migrations; it repairs the Auth registration and visitor-ID contracts,
   adds/backfills PostGIS geography, and enables conflict-checked inventory
   updates. Apply `20261005000000_registration_rpc_hardening.sql` to ensure the
   registration RPC only returns a trigger-created profile ID after validating
   the sign-up nonce; it does not mutate visitor profiles. Apply
   `20261006000000_community_book_visibility.sql` to add public/Only Me
   visibility for community books, owner-only visibility controls, and database
   policies that prevent private books from appearing to other visitors. Apply
   `20261007000000_community_request_text_id_rpcs.sql` to align owner request
   RPCs with text visitor/book IDs and enforce owner authorization.
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
Gemini-generated insights and operational recommendations. From PowerShell
with Python 3.11 installed:

```powershell
cd analytics
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
if (!(Test-Path .env)) { Copy-Item .env.example .env }
# Open analytics/.env and set GEMINI_API_KEY to your key from
# https://aistudio.google.com/apikey.
uvicorn main:app --host 127.0.0.1 --port 8000
```

For local development, set
`VITE_ANALYTICS_API_URL=http://localhost:8000` and restart Vite after changing
it. For a deployed frontend, deploy this FastAPI service separately and set
`VITE_ANALYTICS_API_URL` to its public HTTPS base URL in the frontend hosting
environment before rebuilding/redeploying the frontend. Do not use `localhost`
for a deployed frontend: it refers to each staff member's own computer, not the
server running the app. Set `ANALYTICS_ALLOWED_ORIGINS` on the analytics service
to the exact deployed frontend origin (scheme and host, without a path) so
browser requests pass CORS. Configure `GEMINI_API_KEY` on the analytics service
for Gemini-generated insights; never put it in a `VITE_` variable or frontend
code. The service keeps numeric forecasts in its forecasting model and uses
Gemini for analytics insights and operational recommendations. It also exposes
`POST /faq/answer` for FAQ-corpus-grounded answers. `GET /health` reports
whether a key is configured without exposing it; `POST /forecast` calls Gemini
and returns the analytics response.
If forecasting returns a Gemini error, check the analytics service's runtime
logs and `/health` response. `geminiConfigured: true` only confirms that a key
is present; it does not confirm the key is valid, has quota, or can access the
configured `GEMINI_MODEL`.

#### Deploy the analytics service with Render and Vercel

The repository root includes `render.yaml` for the analytics web service:

1. In Render, create a **Blueprint** from this GitHub repository and deploy the
   `shelf-analytics` service defined in `render.yaml`.
2. Set `ANALYTICS_ALLOWED_ORIGINS` to the exact Vercel site origin, for example
   `https://your-project.vercel.app` (no trailing slash or path). Add any other
   required Vercel preview origins as a comma-separated list.
3. Set `GEMINI_API_KEY` in the Render service environment settings. Keep it
   private; do not add it to Vercel or commit it to the repository.
4. Wait for Render's `/health` check to pass and copy the service's public HTTPS
   URL.
5. In Vercel, open the project settings, add `VITE_ANALYTICS_API_URL` with that
   Render URL for the Production environment, then redeploy the frontend.
   Configure Preview too if preview deployments need forecasting, and include
   each preview origin in `ANALYTICS_ALLOWED_ORIGINS`.

Render's free web service may sleep when idle, so the first request after a
period of inactivity can take longer while the service starts.

### Database bootstrap and migration safety

For a new database, apply `supabase/schema.sql` first, then apply every
timestamped migration in order. Before upgrading an existing Supabase project,
back it up, inspect applied versions with `supabase migration list --linked`,
and review `supabase db push --dry-run`. The forward-fix migration
`20261001000000_legacy_uuid_key_compatibility.sql` preserves existing UUID
book and visitor IDs while converting legacy key columns to the text-ID
contract expected by the application. The forward-fix migration
`20261004000000_auth_inventory_geography_fixes.sql` is intended to repair
already-migrated installations as well as fresh installs; verify PostGIS
availability. `20261005000000_registration_rpc_hardening.sql` further
restricts the registration RPC to a nonce-backed, read-only profile lookup.
Review the migration plan before applying it with `supabase db push`. The
repository changes do not apply migrations to a remote database automatically.

## Known simplifications (flagged in-code)

- QR scanning supports both camera decoding (`html5-qrcode`) and manual input.
- Existing email/branch labels may remain in frontend constants for old UI
   paths, but no staff passwords are stored or used there.
- `schema.sql` is the base schema; timestamped migrations must be applied in
  order before exposing a deployment.
- Map markers use approximate, clearly-flagged sample coordinates.
