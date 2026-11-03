# SHELF ILMS

SHELF: A Shared Hub for Education and Library Fusion System is a library management system for visitors and library staff. The frontend is built with React, Vite, and Tailwind CSS. Its production site is <https://shelf-system.vercel.app>.

## Features

- Visitor registration, email verification, and QR sign-in
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

Allow the production frontend origin for the `visitor-qr-login` Edge Function:

```bash
supabase secrets set APP_ORIGINS="https://shelf-system.vercel.app"
supabase functions deploy visitor-qr-login
```

Apply `supabase/schema.sql` once for a fresh database, then apply the timestamped
migrations in order. For an existing database, review the applied migrations
and deployment plan before applying changes; do not rerun the base schema after
the security migrations.

### Render analytics API

Set `ANALYTICS_ALLOWED_ORIGINS` to the exact frontend origin
`https://shelf-system.vercel.app` (no trailing slash or path). Set
`GEMINI_API_KEY` in Render if Gemini-powered analytics is enabled. Keep API
secrets in the service's environment settings, not in frontend code.

For local analytics development, see `analytics/requirements.txt` and
`analytics/.env.example`. The service provides `/health`, `/forecast`, and
`/faq/answer` endpoints.
