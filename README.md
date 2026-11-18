# SHELF ILMS

SHELF: A Shared Hub for Education and Library Fusion System is a library management system for visitors and library staff. The frontend is built with React, Vite, and Tailwind CSS. Its production site is <https://shelf-system.vercel.app>.

## Features

- Visitor registration and email verification, with QR passes for in-library identification
- Book catalog, borrowing requests, returns, due dates and fines
- Personal Books Management, Community Books, and Read Later Books
- Attendance, Inventory Management, and User Management
- Reports, analytics, and FAQ assistance
- Multi-branch library information

## Local development

Requirements: Node.js and npm. In PowerShell:

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Set the values in `.env` before running the app:

```dotenv
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-supabase-publishable-key>
VITE_ANALYTICS_API_URL=http://localhost:8000
```

The Supabase URL and publishable/anon key are available in the Supabase
project's API settings. Never put a Supabase service-role key, Resend key, or
Gemini key in a `VITE_` variable or commit secrets to the repository.

Available frontend scripts:

```bash
npm run dev
npm run build
npm run preview
npm run lint
```

## Services and deployment

The frontend is hosted on Vercel. Supabase provides authentication, database,
and Edge Functions; the Python analytics API is hosted separately on Render.

Configure these production settings:

### Vercel

Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and
`VITE_ANALYTICS_API_URL` in the Vercel project's Production environment, then
redeploy after changing them. `VITE_ANALYTICS_API_URL` must be the public HTTPS
base URL of the analytics service (currently
`https://shelf-analytics-q24u.onrender.com`).

Vercel's SPA rewrite is configured in `vercel.json`.

### Supabase

In Authentication → URL Configuration, set the Site URL to
`https://shelf-system.vercel.app` and add that origin to the allowed redirect
URLs. Keep any local development URLs needed for testing.

Visitor authentication uses email and password (or the supported passkey flow).
Visitor QR passes identify visitors for attendance and circulation workflows;
they are not login credentials. The existing `visitor-qr-login` Edge Function
has not been retired server-side because external consumers have not yet been
verified. Its retirement is pending a separate caller review.

For a clean Supabase database, replay the timestamped files in
`supabase/migrations/` in order using the Supabase CLI. Do not apply
`supabase/schema.sql` before that migration chain: both define base relations,
and the first migration creates those relations without `IF NOT EXISTS`, so
applying both paths can fail on duplicate objects. Treat `schema.sql` as a
separate standalone bootstrap/snapshot, not an extra step in migration replay.
For an existing database, compare its migration ledger and schema with the
migrations before applying changes; never mark a migration applied based only
on the presence of an object.

### Visitor registration types

Registration offers Institutional Visitor and Public / Community Visitor.
Institutional registration continues to require an email domain configured for
the selected library. Community visitors may use a personal email domain, must
select a preferred library, and must complete the existing visitor email OTP.
After verification, community accounts remain limited to the pending-approval
screen and public catalog. A branch-authorized librarian must approve the
account before visitor services or a QR identification pass are enabled. The
approval RPC enforces AAL2, active staff status, role-claim consistency, library
scope, and rejection of self-approval. Existing institutional visitor access
and QR identification workflows remain unchanged.

### Render analytics API

Set `ANALYTICS_ALLOWED_ORIGINS` to the exact frontend origin
`https://shelf-system.vercel.app` (no trailing slash or path). Set
`GEMINI_API_KEY` in Render if Gemini-powered analytics is enabled. Keep API
secrets in the service's environment settings, not in frontend code.

For local analytics development, see `analytics/requirements.txt` and
`analytics/.env.example`. The service provides `/health`, `/forecast`, and
`/faq/answer` endpoints.