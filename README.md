# SHELF ILMS — Integrated Library Management System

Frontend for SHELF (Smart Hub for E-Library... Facilities), built for BatStateU
JPLPC–Malvar Campus and Tanauan City's integrated library network. React 19 +
Vite + Tailwind CSS v4.

## Running locally

```bash
npm install
npm run dev
```

## How the "backend" works right now

This project has no server/database yet. `src/data/store.js` simulates one
using `localStorage`, with all registration, OTP, QR-attendance, borrowing,
queueing, and fine logic centralized there so the UI stays presentational.

Two browser tabs of the **same browser** (e.g. a visitor tab and a librarian
tab open side by side) will see each other's changes live — `localStorage`'s
native `storage` event keeps them in sync. This is enough to demo the
end-to-end "real-time" flow described in the requirements, but it is **not**
a real multi-device backend: two different devices, or two different
browsers, will each have their own local data.

**Path to production:** every read/write in the app goes through the
functions exported from `src/data/store.js`. To go live, swap the
`persist()`/`load()` internals (and the `storage`-event listener) for real
calls to a database with realtime updates — e.g. Firebase Firestore
listeners, or your own REST + Socket.io/WebSocket API. The function
signatures used by the React components (`requestBorrow`, `confirmPickup`,
`confirmReturn`, `scanAttendance`, etc.) would not need to change.

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

## Known simplifications (flagged in-code)

- QR **scanning** is a manual/typed input (no camera decoding library is
  installed) — a real scanner types into the same field, or install
  `html5-qrcode` and swap `src/component/QrScanner.jsx`'s input for a camera
  decoder.
- OTP delivery is simulated (shown on-screen) — wire up an email/SMS
  provider (e.g. SendGrid, Semaphore) in `store.registerVisitor`/`resendOtp`.
- Map markers use approximate, clearly-flagged sample coordinates.
