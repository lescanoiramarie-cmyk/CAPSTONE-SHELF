# SHELF ILMS System Functions, Flow, and Visitor Dashboard UI/UX Report

**Review scope:** current application source in this workspace  
**Review date:** 25 October 2026  
**Primary focus:** system functions and flow, plus the Visitor Dashboard UI/UX

## 1. Executive summary

SHELF ILMS is a React/Vite library information system backed by Supabase. It supports three role-based experiences: visitors, sub-admins, and super-admins. The visitor experience combines a public catalog, authenticated borrowing and reading-list workflows, QR-based identity/attendance support, personal/community books, branch discovery, announcements, feedback, FAQs, and an account drawer.

The overall architecture is functional and security-aware: authentication state is separated from library data, protected routes enforce roles, Supabase Auth and database RPCs handle sensitive actions, and realtime events trigger data refreshes. The Visitor Dashboard is visually coherent and responsive, with a strong navy brand, clear iconography, dark mode, sticky navigation, card-based content, and accessible modal patterns.

The main maintainability and UX risks are concentration of many responsibilities in very large components, a high number of dashboard navigation choices, reliance on a large shared data refresh, and mixed interaction patterns between tabs, drawers, modals, and embedded catalog views. The strongest next improvements would be progressive disclosure of visitor features, clearer task-oriented navigation, component decomposition, more explicit loading/empty/error states per section, and performance instrumentation around catalog/data refreshes.

## 2. Current system architecture

### Application shell and routing

The application is assembled in [App.jsx](./src/App.jsx#L22). The provider order is:

1. `AuthProvider`
2. `LibraryProvider`
3. `BrowserRouter`
4. lazy-loaded routes inside `Suspense`

The main routes are:

| Route | Experience | Access |
|---|---|---|
| `/` | Landing page | Public |
| `/catalog` | OPAC catalog | Public |
| `/visitor-login` and `/visitor-register` | Visitor authentication | Public |
| `/visitor` | Visitor Dashboard | Visitor only |
| `/subadmin` | Branch operations dashboard | Sub-admin only |
| `/superadmin` | System administration dashboard | Super-admin only |

Role protection is centralized in [ProtectedRoute.jsx](./src/routes/ProtectedRoute.jsx#L10). Unauthenticated users are redirected to the landing page, while authenticated users with the wrong role are redirected to that role's home route.

### Authentication and identity

[AuthContext.jsx](./src/context/AuthContext.jsx#L21) restores a SHELF browser session from `localStorage`, listens for Supabase Auth changes, refreshes the visitor profile from Supabase, and exposes login, registration, OTP, password-reset, QR-login, and logout functions. Logout clears both the SHELF session and browser session storage ([AuthContext.jsx](./src/context/AuthContext.jsx#L150)).

An important security boundary is documented in [LibraryContext.jsx](./src/context/LibraryContext.jsx#L56): the local SHELF session controls protected UI state, but the current visitor identity for private RPCs is resolved from a real Supabase Auth session. This is a sound separation between client-side navigation state and server-trusted identity.

### Shared data and refresh flow

[LibraryContext.jsx](./src/context/LibraryContext.jsx#L118) is the main client data orchestrator. On refresh it resolves the current visitor, then loads shared collections in parallel: books, external catalog records, libraries, visitors, borrow requests, attendance logs, and community books ([LibraryContext.jsx](./src/context/LibraryContext.jsx#L138)). The context also:

- exposes loading, connection, and attendance-specific error state;
- refreshes after local visitor-session changes;
- listens to Supabase Auth changes;
- subscribes to realtime changes for relevant tables;
- wraps mutations so the UI can refresh after successful actions;
- exposes attendance scanning and other library operations through a common context API.

The database access and business-action layer is concentrated in [store.js](./src/data/store.js). It maps Supabase snake_case rows into UI-friendly camelCase objects. Attendance records are explicitly mapped from `id`, `visitor_id`, `visitor_name`, `library_id`, `time_in`, and `checked_out_at` ([store.js](./src/data/store.js#L378)). Attendance queries are branch-aware and select only those six database fields ([store.js](./src/data/store.js#L1405)).

### High-level system flow

```text
User opens application
        |
        v
AuthProvider restores local UI session + listens to Supabase Auth
        |
        v
LibraryProvider resolves Auth-linked visitor identity
        |
        +--> fetches shared library/catalog/visitor/borrow/attendance data
        +--> subscribes to Auth and realtime changes
        |
        v
ProtectedRoute checks role
        |
        +--> Visitor Dashboard
        +--> Sub-admin Dashboard
        +--> Super-admin Dashboard
        |
        v
Visitor actions call context/store/RPC functions
        |
        v
Supabase validates permissions, mutates data, and realtime refresh updates UI
```

## 3. System functions currently represented

### Visitor functions

The visitor route composes the following functional areas:

- browse physical, external, personal, and community catalog content;
- search, filter, sort, view details, and inspect availability;
- request books, monitor request/borrow status, and view due dates/fines;
- save and remove books from a reading list;
- view personal books and community-book lending workflows;
- view branch locations and library status through the map;
- view announcements and community-book notifications;
- submit questions/feedback and see replies through [VisitorServices.jsx](./src/component/VisitorServices.jsx#L1);
- open FAQ assistance through the floating FAQ panel;
- view and save the visitor QR pass as an image;
- view attendance history in the profile drawer;
- review and accept Terms and Conditions before using the visitor account.

The Visitor Dashboard delegates catalog behavior to the large [OPACCatalog.jsx](./src/component/OPACCatalog.jsx#L200), map behavior to [LibraryMap.jsx](./src/component/LibraryMap.jsx), and visitor support actions to [VisitorServices.jsx](./src/component/VisitorServices.jsx).

### Staff/admin functions

The README describes the operational workflow: visitor registration and OTP verification, QR attendance, borrowing/holds, pickup confirmation, returns, queue promotion, branch maps, analytics, feedback, announcements, and exports ([README.md](./README.md#L52)). The current source also contains dedicated sub-admin and super-admin dashboards with branch/system scope separation.

### Attendance behavior

Attendance is branch-aware. The store queries attendance by authenticated scope and branch, and super-admin loading aggregates records across libraries in batches ([store.js](./src/data/store.js#L1421)). The dashboard flow therefore supports both branch-level and system-wide attendance views while retaining the same canonical database fields.

## 4. Visitor Dashboard UI/UX assessment

### Information architecture

The dashboard uses a single-page, tab-driven information architecture. The primary navigation currently contains eight destinations ([VisitorDashboard.jsx](./src/pages/visitor/VisitorDashboard.jsx#L1206)):

1. Catalog
2. Book Categories
3. Community Books
4. My Personal Books
5. My Reading List
6. My Requests & Borrows
7. Library Map
8. Announcements & Feedback

The default tab is Catalog ([VisitorDashboard.jsx](./src/pages/visitor/VisitorDashboard.jsx#L176), which is appropriate because discovery is the highest-frequency visitor task. The catalog view can also display AI recommendations and branch filtering before rendering the embedded OPAC ([VisitorDashboard.jsx](./src/pages/visitor/VisitorDashboard.jsx#L1247)).

### Visual design system

The dashboard has a defined local visual language in [visitorDashboard.css](./src/pages/visitor/visitorDashboard.css#L1): navy branding, slate text, muted surfaces, semantic success/warning/danger colors, 16px card radii, 10px control radii, and pill-shaped chips. This creates a consistent library/product identity and makes status-oriented content easy to scan.

The sticky header identifies the product as `SHELF ILMS` and `Library Visitor` ([VisitorDashboard.jsx](./src/pages/visitor/VisitorDashboard.jsx#L822)). The content header reinforces context by showing the visitor's registered library and a task-oriented description: “Search books, check availability, manage requests, and keep track of your library visits” ([VisitorDashboard.jsx](./src/pages/visitor/VisitorDashboard.jsx#L1081)).

### Navigation and responsive behavior

The primary navigation is horizontally scrollable and becomes sticky on larger screens ([visitorDashboard.css](./src/pages/visitor/visitorDashboard.css#L172)). This is a practical solution for eight tabs, but it also creates discoverability risk: users may not notice off-screen tabs on smaller devices. The mobile CSS collapses book grids to one column ([visitorDashboard.css](./src/pages/visitor/visitorDashboard.css#L509), while cards use truncation/clamping to stabilize layout ([visitorDashboard.css](./src/pages/visitor/visitorDashboard.css#L355)).

Positive UX choices include:

- responsive single-column fallback for book cards;
- large touch-friendly action controls in modals and drawers;
- visible focus rings and `aria-label` usage on key icon buttons;
- sticky navigation that keeps section switching available during browsing;
- dark-mode styling for the dashboard and overlays;
- content containment using truncation and `min-width: 0` to reduce layout overflow.

### Account, QR, and modal interactions

The account menu opens a profile drawer containing identity information, QR pass content, attendance history, and transaction history. The QR pass can be saved as an image, which is useful for repeated library entry. Terms review and notification content use modal/dialog patterns with `aria-modal`, labels, backdrop handling, and Escape/pointer-dismiss behavior ([VisitorDashboard.jsx](./src/pages/visitor/VisitorDashboard.jsx#L1810)).

The UX is feature-rich, but the dashboard has several simultaneous overlay concepts: account menu, profile drawer, notifications, terms review, announcement modal, book modal, map modal, and floating FAQ. This increases interaction complexity and raises the possibility of focus-management or stacking conflicts as more features are added.

### Catalog and task completion

OPAC search and filtering are implemented inside [OPACCatalog.jsx](./src/component/OPACCatalog.jsx#L1003). The component also manages reading-list actions, borrow/request actions, community-book requests, authentication prompts, map details, and book-detail dialogs. This gives visitors a continuous workflow from discovery to action, but it also makes the component a high-risk area for regression and performance issues because many concerns are coupled into one file.

### Accessibility and content clarity

The UI includes several positive accessibility signals: semantic `nav`, `main`, `section`, `dialog`, `aria-label`, `aria-modal`, `aria-labelledby`, keyboard Escape handlers, focus-visible styles, and icon buttons with labels. Status badges use semantic color groupings rather than color alone in many places because they also include text labels.

Areas that deserve continued attention:

- ensure every tab exposes a clear active-state announcement for screen readers;
- verify focus is moved into and returned from every modal/drawer;
- avoid relying on truncated titles for critical identification;
- provide explicit loading and empty-state copy for each tab, not only the global loading state;
- verify contrast in dark mode for muted text, chips, and disabled controls;
- test the horizontal tab navigation with keyboard and screen-reader users.

## 5. Strengths

1. **Clear role separation:** routes and protected roles are explicit.
2. **Good security intent:** server-authenticated identity is separated from local UI session state.
3. **Strong operational coverage:** catalog, borrowing, attendance, QR, maps, feedback, announcements, and admin workflows are represented.
4. **Consistent visual language:** reusable CSS variables, status colors, rounded cards, and familiar icons create a coherent experience.
5. **Responsive foundation:** mobile grid fallbacks, overflow handling, and sticky navigation show deliberate responsive design.
6. **Useful visitor self-service:** the QR pass, reading list, transaction history, FAQ, and feedback tools reduce dependence on staff for routine information.

## 6. Risks and improvement opportunities

### High priority

- **Component concentration:** [VisitorDashboard.jsx](./src/pages/visitor/VisitorDashboard.jsx) is approximately 1,900 lines and [OPACCatalog.jsx](./src/component/OPACCatalog.jsx) is approximately 3,900 lines. Extracting feature modules would reduce regression risk and make targeted testing practical.
- **Data-refresh cost:** [LibraryContext.jsx](./src/context/LibraryContext.jsx#L138) loads several collections together and refreshes after Auth/realtime changes. Add timing instrumentation, cache stable reference data, and consider route/feature-level loading where safe.
- **Navigation density:** eight top-level tabs are a lot for a visitor portal. Group lower-frequency tools under “More” or use a two-level information architecture.
- **Overlay complexity:** centralize dialog behavior and focus management to avoid focus leaks, z-index conflicts, and inconsistent close behavior.

### Medium priority

- Add a compact “current task” area near the top: active borrow, pending pickup, overdue item, or active attendance status.
- Add a visible global refresh/error affordance when data is stale or attendance loading fails.
- Make branch context more prominent when the visitor belongs to a branch but can browse the wider network.
- Standardize empty-state layouts and action language across catalog, reading list, borrows, map, and services.
- Add automated interaction tests for login-to-dashboard, borrow request, reading list, QR save, modal Escape, and dark-mode flows.

### Low priority / polish

- Normalize source formatting in the Visitor Dashboard/context files where indentation is inconsistent.
- Continue replacing raw encoding artifacts such as mojibake dashes in displayed fallback text.
- Add analytics for tab usage, search-to-request conversion, and failed actions to guide future navigation simplification.

## 7. Recommended target visitor flow

```text
Sign in / Register
      |
      v
Dashboard home: branch context + current tasks + search
      |
      +--> Search catalog --> Open book --> Check copies --> Request / save
      |
      +--> My Requests & Borrows --> Pickup / due-date / return status
      |
      +--> QR Pass --> Present at desk / save image
      |
      +--> Library Map --> Select branch --> Browse filtered inventory
      |
      +--> Help & Services --> FAQ / announcement / feedback / replies
```

This flow keeps the most valuable visitor task—finding and obtaining a book—close to the dashboard entry point while retaining the system's existing operational features.

## 8. Files reviewed

- [README.md](./README.md) — system purpose, setup, workflows, and deployment notes.
- [App.jsx](./src/App.jsx) — provider composition, routes, lazy loading, and role-protected pages.
- [AuthContext.jsx](./src/context/AuthContext.jsx) — browser session restoration, Supabase Auth synchronization, visitor profile refresh, and logout.
- [LibraryContext.jsx](./src/context/LibraryContext.jsx) — shared data loading, refresh, realtime behavior, mutations, and error state.
- [ProtectedRoute.jsx](./src/routes/ProtectedRoute.jsx) — role gate and redirect behavior.
- [store.js](./src/data/store.js) — Supabase data access, row mapping, attendance scope, and business actions.
- [VisitorDashboard.jsx](./src/pages/visitor/VisitorDashboard.jsx) — visitor state, navigation, account/QR/terms/notification flows, and page composition.
- [visitorDashboard.css](./src/pages/visitor/visitorDashboard.css) — visitor visual tokens, card styles, sticky navigation, responsive behavior, and status styling.
- [OPACCatalog.jsx](./src/component/OPACCatalog.jsx) — search/filter/catalog, requests, reading list, book details, community/personal books, and related modals.
- [VisitorServices.jsx](./src/component/VisitorServices.jsx) — feedback, FAQ support, announcements/replies, and service interactions.
- [LibraryMap.jsx](./src/component/LibraryMap.jsx) — branch discovery and map presentation.
- [DashboardWelcome.jsx](./src/component/DashboardWelcome.jsx) — visitor page introduction and quick actions.

## 9. Overall assessment

The current system is feature-complete enough to support a real library visitor workflow and has a thoughtful foundation for authentication, branch scope, realtime updates, QR identity, and operational service integration. The Visitor Dashboard presents a polished and recognizable UI with good responsive intent. The next phase should focus less on adding more features and more on reducing complexity: split large components, simplify navigation, make state/loading/error behavior more explicit, and measure refresh and interaction performance.
