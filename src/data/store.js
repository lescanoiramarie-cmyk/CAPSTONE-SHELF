// ============================================================================
// SHELF ILMS — Client-side data & business-logic layer
// ----------------------------------------------------------------------------
// The project has no backend/database yet, so this module simulates one:
//  - localStorage is the single source of truth (acts like a shared DB table set)
//  - the native `storage` event lets separate browser tabs of the SAME browser
//    (e.g. a "visitor" tab and a "librarian" tab open side-by-side for a demo)
//    see each other's changes immediately — this is what gives the "real-time"
//    borrow/return/attendance updates described in the requirements.
//  - all read/write logic (OTP, QR attendance, borrow queueing, pickup expiry,
//    fines, etc.) lives here so the UI components stay dumb/presentational.
//
// IMPORTANT (for the defense/production step): this is a realistic simulation
// for demo purposes, not a real multi-device backend. To go to production,
// replace the persist()/load() functions below with calls to a real database
// (e.g. Firebase Firestore, or your own REST/Socket.io API) — every exported
// function's signature can stay the same, so the React components would not
// need to change.
// ============================================================================

const STORAGE_KEY = 'shelf_ilms_data_v1';

// ---------------------------------------------------------------------------
// Hardcoded staff credentials (per requirement: super admin & sub admin
// accounts are hardcoded, not self-registered).
// ---------------------------------------------------------------------------
export const SUPER_ADMIN_CREDENTIALS = [
  { email: 'superadmin@shelf.edu', password: 'SuperAdmin@2026', name: 'System Super Administrator' },
];

export const SUB_ADMIN_CREDENTIALS = [
  { email: 'librarian@shelf.edu', password: 'Librarian@2026', name: 'Maria Santos', libraryId: 'LIB-01' },
  { email: 'circdesk@shelf.edu', password: 'CircDesk@2026', name: 'Circulation Desk Staff', libraryId: 'LIB-02' },
];

// ---------------------------------------------------------------------------
// Tunable business rules
// ---------------------------------------------------------------------------
export const PICKUP_WINDOW_HOURS = 24; // window to pick up a "ready for pickup" book before it auto-cancels
export const BORROW_PERIOD_DAYS = 7; // loan period once picked up/confirmed
export const FINE_PER_DAY = 10; // PHP, applied per overdue day on return

// ---------------------------------------------------------------------------
// Seed / demo data
// ---------------------------------------------------------------------------
// The system is a brand-new deployment (a "startup"), so there is no real
// inventory or member data yet. `books` and `visitors` start EMPTY — admins
// add real books themselves via the Inventory module. A "Load Sample Catalog"
// action is provided separately so the team can populate believable dummy
// data for a defense/demo without hand-typing every field.
//
// The library *network* map, however, needs at least placeholder nodes to be
// meaningful (per Chapter 3, Figure 14 — the multi-library map for Tanauan
// City's integrated network). These coordinates are approximate town-center
// coordinates, clearly marked as sample data — swap in surveyed GPS
// coordinates for each real branch before going live.
export const SAMPLE_LIBRARIES = [
  {
    id: 'LIB-01',
    name: 'BatStateU JPLPC – Malvar Campus Library',
    campus: 'Malvar Campus',
    address: 'Batangas State University, JPLPC – Malvar Campus, Malvar, Batangas',
    lat: 14.0672,
    lng: 121.1597,
    hours: '7:00 AM – 6:00 PM (Mon–Fri)',
    status: 'Open',
    isSampleLocation: true,
  },
  {
    id: 'LIB-02',
    name: 'Tanauan City Public Library',
    campus: 'Tanauan City Hall Complex',
    address: 'P. Gomez St, Poblacion, Tanauan City, Batangas',
    lat: 14.0860,
    lng: 121.1497,
    hours: '8:00 AM – 5:00 PM (Mon–Sat)',
    status: 'Open',
    isSampleLocation: true,
  },
  {
    id: 'LIB-03',
    name: 'BatStateU Batangas City Main Campus Library',
    campus: 'Batangas City (Main Campus)',
    address: 'Rizal Avenue Extension, Batangas City, Batangas',
    lat: 13.7565,
    lng: 121.0583,
    hours: '8:00 AM – 5:00 PM (Mon–Fri)',
    status: 'Closed',
    isSampleLocation: true,
  },
];

export const SAMPLE_BOOKS = [
  {
    title: 'Data Structures and Algorithms in Java',
    author: 'Robert Lafore',
    category: 'Computer Science',
    isbn: '978-0672324536',
    shelfLocation: 'Shelf A-3 (Technology)',
    libraryId: 'LIB-01',
    totalCopies: 5,
    summary: 'A comprehensive guide to foundational algorithms, binary trees, sorting mechanisms, and memory allocation in Java.',
    coverUrl: 'https://images.unsplash.com/photo-1532012197267-da84d127e765?auto=format&fit=crop&q=80&w=400',
  },
  {
    title: 'Clean Code: A Handbook of Agile Software Craftsmanship',
    author: 'Robert C. Martin',
    category: 'Software Engineering',
    isbn: '978-0132350884',
    shelfLocation: 'Shelf B-1 (Software)',
    libraryId: 'LIB-01',
    totalCopies: 3,
    summary: "Even bad code can function, but unclean code slows a team down. Learn how to write code that is clean and readable.",
    coverUrl: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&q=80&w=400',
  },
  {
    title: 'Principles of Physics',
    author: 'David Halliday',
    category: 'Science',
    isbn: '978-1118230749',
    shelfLocation: 'Shelf C-2 (Science)',
    libraryId: 'LIB-02',
    totalCopies: 2,
    summary: 'An essential textbook offering a solid foundation in mechanics, thermodynamics, electromagnetism, and modern physics.',
    coverUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&q=80&w=400',
  },
];

function defaultState() {
  return {
    books: [],
    libraries: SAMPLE_LIBRARIES,
    visitors: [],
    borrowRequests: [],
    attendanceLogs: [],
  };
}

// ---------------------------------------------------------------------------
// Persistence + subscription plumbing
// ---------------------------------------------------------------------------
function load() {
  if (typeof window === 'undefined') return defaultState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

let state = load();
const listeners = new Set();

function persist() {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      state = load();
      listeners.forEach((l) => l());
    }
  });
}

export function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getState() {
  return state;
}

function update(mutator) {
  state = mutator(state);
  persist();
}

function genId(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.floor(100 + Math.random() * 900)}`;
}

function genOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function genQrCode() {
  return 'SHELF-QR-' + Math.floor(100000 + Math.random() * 900000);
}

// ---------------------------------------------------------------------------
// Visitor accounts: register -> verify OTP -> login
// ---------------------------------------------------------------------------
export function registerVisitor({ fullName, contactNumber, email, address, password }) {
  const emailNorm = email.trim().toLowerCase();
  if (state.visitors.some((v) => v.email.toLowerCase() === emailNorm)) {
    throw new Error('An account with this email already exists. Please log in instead.');
  }
  const otp = genOtp();
  const visitor = {
    id: genId('VIS'),
    fullName: fullName.trim(),
    contactNumber: contactNumber.trim(),
    email: email.trim(),
    address: address.trim(),
    password,
    otp,
    otpVerified: false,
    qrCode: null,
    registeredAt: new Date().toISOString(),
  };
  update((s) => ({ ...s, visitors: [...s.visitors, visitor] }));
  // In production this would be emailed/texted via a provider (e.g. Semaphore,
  // SendGrid). Returned here so the UI can display it — simulating delivery.
  return { visitorId: visitor.id, otp };
}

export function resendOtp(visitorId) {
  const otp = genOtp();
  update((s) => ({
    ...s,
    visitors: s.visitors.map((v) => (v.id === visitorId ? { ...v, otp } : v)),
  }));
  return otp;
}

export function verifyVisitorOtp(visitorId, code) {
  const visitor = state.visitors.find((v) => v.id === visitorId);
  if (!visitor) throw new Error('Registration not found. Please register again.');
  if (visitor.otpVerified) return visitor;
  if (String(code).trim() !== String(visitor.otp)) {
    throw new Error('Incorrect OTP code. Please try again.');
  }
  const qrCode = genQrCode();
  let updated;
  update((s) => ({
    ...s,
    visitors: s.visitors.map((v) => {
      if (v.id !== visitorId) return v;
      updated = { ...v, otpVerified: true, qrCode, otp: null };
      return updated;
    }),
  }));
  return updated;
}

export function loginVisitor({ identifier, password }) {
  const idNorm = identifier.trim().toLowerCase();
  const visitor = state.visitors.find(
    (v) => v.email.toLowerCase() === idNorm || (v.qrCode && v.qrCode.toLowerCase() === idNorm)
  );
  if (!visitor) throw new Error('No account found with that email or QR pass ID. Please register first.');
  if (!visitor.otpVerified) throw new Error('Please verify your OTP code before logging in.');
  const viaQr = visitor.qrCode && visitor.qrCode.toLowerCase() === idNorm;
  if (!viaQr && visitor.password !== password) {
    throw new Error('Incorrect password.');
  }
  return visitor;
}

export function findVisitorByQr(qrCode) {
  return state.visitors.find((v) => v.qrCode === qrCode.trim()) || null;
}

export function getVisitor(visitorId) {
  return state.visitors.find((v) => v.id === visitorId) || null;
}

// ---------------------------------------------------------------------------
// Staff logins (hardcoded credentials)
// ---------------------------------------------------------------------------
export function loginSuperAdmin(email, password) {
  const found = SUPER_ADMIN_CREDENTIALS.find(
    (a) => a.email.toLowerCase() === email.trim().toLowerCase() && a.password === password
  );
  if (!found) throw new Error('Invalid super-admin credentials.');
  return found;
}

export function loginSubAdmin(email, password) {
  const found = SUB_ADMIN_CREDENTIALS.find(
    (a) => a.email.toLowerCase() === email.trim().toLowerCase() && a.password === password
  );
  if (!found) throw new Error('Invalid staff credentials.');
  return found;
}

// ---------------------------------------------------------------------------
// Attendance (QR scan at the entrance)
// ---------------------------------------------------------------------------
export function scanAttendance(qrCode, libraryId) {
  const visitor = findVisitorByQr(qrCode);
  if (!visitor) throw new Error('QR code not recognized. Please check the pass and try again.');
  const log = {
    id: genId('ATT'),
    visitorId: visitor.id,
    visitorName: visitor.fullName,
    libraryId: libraryId || 'LIB-01',
    timeIn: new Date().toISOString(),
  };
  update((s) => ({ ...s, attendanceLogs: [log, ...s.attendanceLogs] }));
  return { visitor, log };
}

// ---------------------------------------------------------------------------
// Book inventory (admin-managed — no data pre-loaded, per requirement)
// ---------------------------------------------------------------------------
export function addBook(book) {
  const totalCopies = Math.max(1, Number(book.totalCopies) || 1);
  const newBook = {
    id: genId('BK'),
    title: book.title.trim(),
    author: book.author.trim(),
    category: book.category.trim() || 'General',
    isbn: book.isbn.trim(),
    shelfLocation: book.shelfLocation.trim(),
    libraryId: book.libraryId || 'LIB-01',
    totalCopies,
    availableCopies: totalCopies,
    summary: book.summary?.trim() || '',
    coverUrl: book.coverUrl?.trim() || 'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&q=80&w=400',
  };
  update((s) => ({ ...s, books: [newBook, ...s.books] }));
  return newBook;
}

export function updateBook(bookId, patch) {
  update((s) => ({
    ...s,
    books: s.books.map((b) => (b.id === bookId ? { ...b, ...patch } : b)),
  }));
}

export function deleteBook(bookId) {
  update((s) => ({
    ...s,
    books: s.books.filter((b) => b.id !== bookId),
    borrowRequests: s.borrowRequests.filter((r) => r.bookId !== bookId || !['queued', 'ready_for_pickup'].includes(r.status)),
  }));
}

export function loadSampleCatalog() {
  update((s) => ({
    ...s,
    books: [
      ...SAMPLE_BOOKS.map((b) => ({
        ...b,
        id: genId('BK'),
        availableCopies: b.totalCopies,
      })),
      ...s.books,
    ],
  }));
}

// ---------------------------------------------------------------------------
// Borrow requests, pickup window, and reservation queue
// ---------------------------------------------------------------------------
function releaseCopyAndPromote(s, bookId) {
  let books = s.books.map((b) => (b.id === bookId ? { ...b, availableCopies: b.availableCopies + 1 } : b));
  let borrowRequests = [...s.borrowRequests];

  const queued = borrowRequests
    .filter((r) => r.bookId === bookId && r.status === 'queued')
    .sort((a, b) => (a.queuePosition || 0) - (b.queuePosition || 0));

  if (queued.length > 0) {
    const next = queued[0];
    const deadline = new Date(Date.now() + PICKUP_WINDOW_HOURS * 3600 * 1000).toISOString();
    borrowRequests = borrowRequests.map((r) =>
      r.id === next.id ? { ...r, status: 'ready_for_pickup', pickupDeadline: deadline, queuePosition: null } : r
    );
    // that copy is now claimed for the promoted visitor's pickup window
    books = books.map((b) => (b.id === bookId ? { ...b, availableCopies: b.availableCopies - 1 } : b));

    let pos = 1;
    borrowRequests = borrowRequests.map((r) => {
      if (r.bookId === bookId && r.status === 'queued') {
        const nr = { ...r, queuePosition: pos };
        pos += 1;
        return nr;
      }
      return r;
    });
  }

  return { ...s, books, borrowRequests };
}

export function requestBorrow(visitorId, bookId) {
  const visitor = state.visitors.find((v) => v.id === visitorId);
  const book = state.books.find((b) => b.id === bookId);
  if (!visitor || !book) throw new Error('Invalid borrow request.');

  const active = state.borrowRequests.find(
    (r) => r.visitorId === visitorId && r.bookId === bookId && ['queued', 'ready_for_pickup', 'borrowed'].includes(r.status)
  );
  if (active) throw new Error('You already have an active request or loan for this title.');

  let created;
  if (book.availableCopies > 0) {
    const deadline = new Date(Date.now() + PICKUP_WINDOW_HOURS * 3600 * 1000).toISOString();
    created = {
      id: genId('REQ'),
      bookId,
      bookTitle: book.title,
      visitorId,
      visitorName: visitor.fullName,
      status: 'ready_for_pickup',
      requestDate: new Date().toISOString(),
      pickupDeadline: deadline,
      queuePosition: null,
      borrowDate: null,
      dueDate: null,
      returnDate: null,
      fineAmount: 0,
    };
    update((s) => ({
      ...s,
      books: s.books.map((b) => (b.id === bookId ? { ...b, availableCopies: b.availableCopies - 1 } : b)),
      borrowRequests: [created, ...s.borrowRequests],
    }));
  } else {
    const queueCount = state.borrowRequests.filter((r) => r.bookId === bookId && r.status === 'queued').length;
    created = {
      id: genId('REQ'),
      bookId,
      bookTitle: book.title,
      visitorId,
      visitorName: visitor.fullName,
      status: 'queued',
      requestDate: new Date().toISOString(),
      pickupDeadline: null,
      queuePosition: queueCount + 1,
      borrowDate: null,
      dueDate: null,
      returnDate: null,
      fineAmount: 0,
    };
    update((s) => ({ ...s, borrowRequests: [created, ...s.borrowRequests] }));
  }
  return created;
}

export function cancelBorrowRequest(requestId, reason = 'cancelled') {
  const req = state.borrowRequests.find((r) => r.id === requestId);
  if (!req) throw new Error('Request not found.');
  if (!['queued', 'ready_for_pickup'].includes(req.status)) {
    throw new Error('This request can no longer be cancelled.');
  }
  update((s) => {
    let ns = {
      ...s,
      borrowRequests: s.borrowRequests.map((r) => (r.id === requestId ? { ...r, status: reason } : r)),
    };
    if (req.status === 'ready_for_pickup') {
      ns = releaseCopyAndPromote(ns, req.bookId);
    } else if (req.status === 'queued') {
      let pos = 1;
      ns = {
        ...ns,
        borrowRequests: ns.borrowRequests.map((r) => {
          if (r.bookId === req.bookId && r.status === 'queued') {
            const nr = { ...r, queuePosition: pos };
            pos += 1;
            return nr;
          }
          return r;
        }),
      };
    }
    return ns;
  });
}

/** Called periodically (and on dashboard load) to auto-cancel expired pickups
 *  and promote the next person in each book's reservation queue. */
export function autoExpireOverduePickups() {
  const now = Date.now();
  const expired = state.borrowRequests.filter(
    (r) => r.status === 'ready_for_pickup' && r.pickupDeadline && new Date(r.pickupDeadline).getTime() < now
  );
  expired.forEach((r) => cancelBorrowRequest(r.id, 'expired'));
  return expired.length;
}

/** Librarian confirms pickup at the circulation desk (Book Borrowing module). */
export function confirmPickup(requestId, staffName) {
  const req = state.borrowRequests.find((r) => r.id === requestId);
  if (!req) throw new Error('Request not found.');
  if (req.status !== 'ready_for_pickup') throw new Error('This request is not ready for pickup.');
  const borrowDate = new Date();
  const dueDate = new Date(borrowDate.getTime() + BORROW_PERIOD_DAYS * 24 * 3600 * 1000);
  update((s) => ({
    ...s,
    borrowRequests: s.borrowRequests.map((r) =>
      r.id === requestId
        ? { ...r, status: 'borrowed', borrowDate: borrowDate.toISOString(), dueDate: dueDate.toISOString(), confirmedBy: staffName }
        : r
    ),
  }));
}

/** Librarian confirms return at the circulation desk (Book Returning module). */
export function confirmReturn(requestId, staffName) {
  const req = state.borrowRequests.find((r) => r.id === requestId);
  if (!req) throw new Error('Request not found.');
  if (req.status !== 'borrowed') throw new Error('This item is not currently on loan.');
  const now = new Date();
  const overdueDays = Math.max(0, Math.ceil((now - new Date(req.dueDate)) / (24 * 3600 * 1000)));
  const fine = overdueDays * FINE_PER_DAY;
  update((s) => {
    let ns = {
      ...s,
      borrowRequests: s.borrowRequests.map((r) =>
        r.id === requestId
          ? { ...r, status: 'returned', returnDate: now.toISOString(), fineAmount: fine, returnConfirmedBy: staffName }
          : r
      ),
    };
    ns = releaseCopyAndPromote(ns, req.bookId);
    return ns;
  });
}

// ---------------------------------------------------------------------------
// Derived helpers (pure, operate on a state snapshot)
// ---------------------------------------------------------------------------
export function getQueueForBook(s, bookId) {
  return s.borrowRequests
    .filter((r) => r.bookId === bookId && r.status === 'queued')
    .sort((a, b) => (a.queuePosition || 0) - (b.queuePosition || 0));
}

export function getVisitorRequests(s, visitorId) {
  return s.borrowRequests
    .filter((r) => r.visitorId === visitorId)
    .sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));
}
