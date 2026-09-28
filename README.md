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
set those values, and run `supabase/schema.sql` in the project's SQL editor.
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

Staff accounts are hardcoded (per the system requirements — no
self-registration for admins):

| Role        | Email                     | Password           |
|-------------|---------------------------|---------------------|
| Super-Admin | superadmin@shelf.edu      | SuperAdmin@2026     |
| Sub-Admin   | librarian@shelf.edu       | Librarian@2026      |
| Sub-Admin   | circdesk@shelf.edu        | CircDesk@2026       |

These live in `src/data/store.js` (`SUPER_ADMIN_CREDENTIALS` /
`SUB_ADMIN_CREDENTIALS`) — edit that list directly to change them.

## Core workflow implemented

1. **Visitor**: register → OTP verification (simulated delivery, shown
   on-screen since no email/SMS provider is wired up yet) → receives a QR
   pass → log in with email/password or the QR pass ID.
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
network. Reports support daily, weekly, monthly, and annual periods, sorting,
and Excel/CSV export. Analytics charts use attendance and borrowing records,
with demand-based operational suggestions. Visitors can submit feedback and
questions, receive FAQ answers for common topics, read announcements, and see
replies from the library team.

Attendance QR scans alternate between check-in and check-out for the active
branch/day. New Supabase tables and functions for feedback, announcements,
staff profiles, and checkout are defined in `supabase/schema.sql`; re-run that
schema in the Supabase SQL editor when upgrading an existing deployment.

### Auth-backed staff provisioning

The old hardcoded demo staff accounts continue to work for legacy features,
but they cannot authorize staff management or access protected feedback
moderation. Move staff to Supabase Auth to use those features. Provisioning
uses the `manage-staff` Supabase Edge Function and requires a real Auth
super-admin session:

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
- OTP delivery is handled through the `send-visitor-otp` Supabase Edge
   Function; configure its email provider and secrets for the target deployment.
- Staff credentials are hardcoded in the frontend for the capstone demo, and
   the SQL schema currently uses permissive public policies and plaintext
   visitor passwords. Do not use this setup with real accounts or personal data
   without replacing those demo security choices.
- Map markers use approximate, clearly-flagged sample coordinates.
