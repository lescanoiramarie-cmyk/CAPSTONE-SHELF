// ============================================================================
// SHELF ILMS — data & business-logic layer (Supabase-backed)
// ----------------------------------------------------------------------------
// This module is the only place in the app that talks to Supabase directly.
// Components/contexts call these functions and never import `supabase`
// themselves — that keeps the React layer simple and makes it possible to
// swap the backend again later without touching the UI.
//
// The trickier, must-be-atomic logic (borrow queueing, pickup expiry,
// visitor OTP/login checks) lives in Postgres functions defined in
// supabase/schema.sql and is called here via supabase.rpc(...), so it can't
// race between two visitors hitting "Borrow" on the last copy at once.
// ============================================================================

import { supabase } from '../lib/supabaseClient';

// ---------------------------------------------------------------------------
// Hardcoded staff credentials (per requirement: super admin & sub admin
// accounts are hardcoded, not self-registered, and not stored in the DB).
// ---------------------------------------------------------------------------
export const SUPER_ADMIN_CREDENTIALS = [
  {
    email: 'superadmin@shelf.edu',
    password: 'SuperAdmin@2026',
    name: 'System Super Administrator',
  },
];

export const SUB_ADMIN_CREDENTIALS = [
  {
    email: 'librarian@shelf.edu',
    password: 'Librarian@2026',
    name: 'Maria Santos',
    libraryId: '78c0a005-06cd-48f5-92d2-daa06fe36e12',
  },
  {
    email: 'circdesk@shelf.edu',
    password: 'CircDesk@2026',
    name: 'Circulation Desk Staff',
    libraryId: '9c82c34b-6059-47e1-983a-d03755cb830b',
  },
];

// ---------------------------------------------------------------------------
// Tunable business rules (mirrored in the Postgres functions — keep in sync
// if you change one side; see supabase/schema.sql)
// ---------------------------------------------------------------------------
export const PICKUP_WINDOW_HOURS = 24;
export const BORROW_PERIOD_DAYS = 7;
export const FINE_PER_DAY = 10; // PHP

export const DEFAULT_COVER_URL =
  'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&q=80&w=400';

// Demo/sample catalog — inserted only when the admin clicks "Load Sample
// Catalog"; the real catalog starts empty (new deployment, no data yet).
export const SAMPLE_BOOKS = [
  {
    title: 'Data Structures and Algorithms in Java',
    author: 'Robert Lafore',
    category: 'Computer Science',
    isbn: '978-0672324536',
    shelfLocation: 'Shelf A-3 (Technology)',
    libraryId: '78c0a005-06cd-48f5-92d2-daa06fe36e12',
    totalCopies: 5,
    summary:
      'A comprehensive guide to foundational algorithms, binary trees, sorting mechanisms, and memory allocation in Java.',
    coverUrl:
      'https://images.unsplash.com/photo-1532012197267-da84d127e765?auto=format&fit=crop&q=80&w=400',
  },
  {
    title: 'Clean Code: A Handbook of Agile Software Craftsmanship',
    author: 'Robert C. Martin',
    category: 'Software Engineering',
    isbn: '978-0132350884',
    shelfLocation: 'Shelf B-1 (Software)',
    libraryId: '78c0a005-06cd-48f5-92d2-daa06fe36e12',
    totalCopies: 3,
    summary:
      'Even bad code can function, but unclean code slows a team down. Learn how to write code that is clean and readable.',
    coverUrl:
      'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&q=80&w=400',
  },
  {
    title: 'Principles of Physics',
    author: 'David Halliday',
    category: 'Science',
    isbn: '978-1118230749',
    shelfLocation: 'Shelf C-2 (Science)',
    libraryId: '9c82c34b-6059-47e1-983a-d03755cb830b',
    totalCopies: 2,
    summary:
      'An essential textbook offering a solid foundation in mechanics, thermodynamics, electromagnetism, and modern physics.',
    coverUrl:
      'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&q=80&w=400',
  },
];

// ---------------------------------------------------------------------------
// Row → camelCase mappers (DB columns are snake_case; the UI uses camelCase)
// ---------------------------------------------------------------------------
const mapLibrary = (r) => ({
  id: r.id,
  name: r.name,
  campus: r.campus,
  address: r.address,
  lat: r.lat,
  lng: r.lng,
  hours: r.hours,
  status: r.status,
  isSampleLocation: r.is_sample_location,
});

const mapBook = (r) => ({
  id: r.id,
  title: r.title,
  author: r.author,
  category: r.category,
  isbn: r.isbn,
  shelfLocation: r.shelf_location,
  libraryId: r.library_id,
  totalCopies: r.total_copies,
  availableCopies: r.available_copies,
  summary: r.summary,
  coverUrl: r.cover_url,
});

// NOTE: never select password/otp columns into this shape — those checks
// happen server-side inside the RPC functions, not via a client-side select.
const mapVisitor = (r) => ({
  id: r.id,
  fullName: r.full_name,
  contactNumber: r.contact_number,
  email: r.email,
  address: r.address,
  otpVerified: r.otp_verified,
  qrCode: r.qr_code,
  registeredAt: r.registered_at,
});

const mapBorrowRequest = (r) => ({
  id: r.id,
  bookId: r.book_id,
  bookTitle: r.book_title,
  visitorId: r.visitor_id,
  visitorName: r.visitor_name,
  status: r.status,
  requestDate: r.request_date,
  pickupDeadline: r.pickup_deadline,
  queuePosition: r.queue_position,
  borrowDate: r.borrow_date,
  dueDate: r.due_date,
  returnDate: r.return_date,
  fineAmount: r.fine_amount,
  confirmedBy: r.confirmed_by,
  returnConfirmedBy: r.return_confirmed_by,
});

const mapAttendance = (r) => ({
  id: r.id,
  visitorId: r.visitor_id,
  visitorName: r.visitor_name,
  libraryId: r.library_id,
  timeIn: r.time_in,
});

function cleanErr(
  error,
  fallback = 'Something went wrong. Please try again.'
) {
  return new Error(error?.message || fallback);
}

// ---------------------------------------------------------------------------
// Fetching (used by LibraryContext to populate + refresh state)
// ---------------------------------------------------------------------------
export async function fetchLibraries() {
  const { data, error } = await supabase
    .from('libraries')
    .select('*')
    .order('name');

  if (error) throw cleanErr(error);

  return data.map(mapLibrary);
}

export async function fetchBooks() {
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw cleanErr(error);

  return data.map(mapBook);
}

export async function fetchVisitors() {
  const { data, error } = await supabase
    .from('visitors')
    .select(
      'id, full_name, contact_number, email, address, otp_verified, qr_code, registered_at'
    )
    .order('registered_at', { ascending: false });

  if (error) throw cleanErr(error);

  return data.map(mapVisitor);
}

export async function fetchBorrowRequests() {
  const { data, error } = await supabase
    .from('borrow_requests')
    .select('*')
    .order('request_date', { ascending: false });

  if (error) throw cleanErr(error);

  return data.map(mapBorrowRequest);
}

export async function fetchAttendanceLogs() {
  const { data, error } = await supabase
    .from('attendance_logs')
    .select('*')
    .order('time_in', { ascending: false });

  if (error) throw cleanErr(error);

  return data.map(mapAttendance);
}

export async function getVisitor(visitorId) {
  const { data, error } = await supabase
    .from('visitors')
    .select(
      'id, full_name, contact_number, email, address, otp_verified, qr_code, registered_at'
    )
    .eq('id', visitorId)
    .maybeSingle();

  if (error) throw cleanErr(error);

  return data ? mapVisitor(data) : null;
}

// ---------------------------------------------------------------------------
// Visitor accounts: register -> verify OTP -> login
// ---------------------------------------------------------------------------

export async function registerVisitor({
  fullName,
  contactNumber,
  email,
  address,
  password,
}) {
  // Step 1:
  // Create the visitor and generate/store the OTP in PostgreSQL.
  const { data, error } = await supabase.rpc('register_visitor', {
    p_full_name: fullName,
    p_contact_number: contactNumber,
    p_email: email,
    p_address: address,
    p_password: password,
  });

  if (error) throw cleanErr(error);

  const row = data?.[0];

  if (!row?.visitor_id) {
    throw new Error(
      'Registration was unsuccessful. Please try again.'
    );
  }

  const visitorId = row.visitor_id;

  // Step 2:
  // Ask the server-side Edge Function to send the OTP.
  //
  // IMPORTANT:
  // The OTP is NEVER returned to the React frontend.
  const { error: emailError } = await supabase.functions.invoke(
    'send-visitor-otp',
    {
      body: {
        visitorId,
      },
    }
  );

  if (emailError) {
    throw new Error(
      'Your registration was created, but we could not send the verification email. Please try again.'
    );
  }

  return {
    visitorId,
  };
}

export async function resendOtp(visitorId) {
  // Step 1:
  // Generate and store a new OTP in PostgreSQL.
  const { error } = await supabase.rpc('resend_otp', {
    p_visitor_id: visitorId,
  });

  if (error) throw cleanErr(error);

  // Step 2:
  // Send the newly generated OTP through the server-side Edge Function.
  //
  // IMPORTANT:
  // The OTP is NEVER returned to the React frontend.
  const { error: emailError } = await supabase.functions.invoke(
    'send-visitor-otp',
    {
      body: {
        visitorId,
      },
    }
  );

  if (emailError) {
    throw new Error(
      'A new verification code was generated, but we could not send the email. Please try again.'
    );
  }

  return {
    success: true,
  };
}

export async function verifyVisitorOtp(visitorId, code) {
  const { data, error } = await supabase.rpc(
    'verify_visitor_otp',
    {
      p_visitor_id: visitorId,
      p_code: String(code).trim(),
    }
  );

  if (error) throw cleanErr(error);

  const row = data?.[0];

  if (!row) {
    throw new Error(
      'Unable to verify the OTP. Please try again.'
    );
  }

  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    qrCode: row.qr_code,
    otpVerified: true,
  };
}

export async function loginVisitor({ identifier, password }) {
  const { data, error } = await supabase.rpc('login_visitor', {
    p_identifier: identifier.trim(),
    p_password: password,
  });

  if (error) throw cleanErr(error);

  const row = data?.[0];

  if (!row) {
    throw new Error('Invalid visitor credentials.');
  }

  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    qrCode: row.qr_code,
  };
}

export async function findVisitorByQr(qrCode) {
  const { data, error } = await supabase.rpc('find_visitor_by_qr', {
    p_qr: qrCode.trim(),
  });

  if (error) throw cleanErr(error);

  if (!data || data.length === 0) {
    return null;
  }

  const row = data[0];

  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    qrCode: row.qr_code,
  };
}

// ---------------------------------------------------------------------------
// Staff logins (hardcoded — not in the database)
// ---------------------------------------------------------------------------
export function loginSuperAdmin(email, password) {
  const found = SUPER_ADMIN_CREDENTIALS.find(
    (a) =>
      a.email.toLowerCase() === email.trim().toLowerCase() &&
      a.password === password
  );

  if (!found) {
    throw new Error('Invalid super-admin credentials.');
  }

  return found;
}

export function loginSubAdmin(email, password) {
  const found = SUB_ADMIN_CREDENTIALS.find(
    (a) =>
      a.email.toLowerCase() === email.trim().toLowerCase() &&
      a.password === password
  );

  if (!found) {
    throw new Error('Invalid staff credentials.');
  }

  return found;
}

// ---------------------------------------------------------------------------
// Attendance (QR scan at the entrance)
// ---------------------------------------------------------------------------
export async function scanAttendance(qrCode, libraryId) {
  console.log('QR CODE:', qrCode);
  console.log('LIBRARY ID:', libraryId);

  const { data, error } = await supabase.rpc('scan_attendance', {
    p_qr: qrCode.trim(),
    p_library_id: libraryId,
  });

  console.log('SUPABASE DATA:', data);
  console.log('SUPABASE ERROR:', error);

  if (error) throw cleanErr(error);

  const row = data?.[0];

  if (!row) {
    throw new Error('Unable to record attendance.');
  }

  return {
    visitor: {
      id: row.visitor_id,
      fullName: row.visitor_name,
    },
    log: {
      id: row.log_id,
    },
  };
}

// ---------------------------------------------------------------------------
// Book inventory (admin-managed — no data pre-loaded, per requirement)
// ---------------------------------------------------------------------------
export async function addBook(book) {
  const totalCopies = Math.max(
    1,
    Number(book.totalCopies) || 1
  );

  const { data, error } = await supabase
    .from('books')
    .insert({
      title: book.title.trim(),
      author: book.author.trim(),
      category: book.category?.trim() || 'General',
      isbn: book.isbn?.trim() || '',
      shelf_location: book.shelfLocation?.trim() || '',
      library_id: book.libraryId,
      total_copies: totalCopies,
      available_copies: totalCopies,
      summary: book.summary?.trim() || '',
      cover_url:
        book.coverUrl?.trim() || DEFAULT_COVER_URL,
    })
    .select()
    .single();

  if (error) throw cleanErr(error);

  return mapBook(data);
}

export async function updateBook(bookId, patch) {
  const dbPatch = {};

  if (patch.title !== undefined)
    dbPatch.title = patch.title;

  if (patch.author !== undefined)
    dbPatch.author = patch.author;

  if (patch.category !== undefined)
    dbPatch.category = patch.category;

  if (patch.isbn !== undefined)
    dbPatch.isbn = patch.isbn;

  if (patch.shelfLocation !== undefined)
    dbPatch.shelf_location = patch.shelfLocation;

  if (patch.libraryId !== undefined)
    dbPatch.library_id = patch.libraryId;

  if (patch.totalCopies !== undefined)
    dbPatch.total_copies = patch.totalCopies;

  if (patch.availableCopies !== undefined)
    dbPatch.available_copies =
      patch.availableCopies;

  if (patch.summary !== undefined)
    dbPatch.summary = patch.summary;

  if (patch.coverUrl !== undefined)
    dbPatch.cover_url = patch.coverUrl;

  const { error } = await supabase
    .from('books')
    .update(dbPatch)
    .eq('id', bookId);

  if (error) throw cleanErr(error);
}

export async function deleteBook(bookId) {
  const { error } = await supabase
    .from('books')
    .delete()
    .eq('id', bookId);

  if (error) throw cleanErr(error);
}

export async function loadSampleCatalog() {
  const rows = SAMPLE_BOOKS.map((b) => ({
    title: b.title,
    author: b.author,
    category: b.category,
    isbn: b.isbn,
    shelf_location: b.shelfLocation,
    library_id: b.libraryId,
    total_copies: b.totalCopies,
    available_copies: b.totalCopies,
    summary: b.summary,
    cover_url: b.coverUrl,
  }));

  const { error } = await supabase
    .from('books')
    .insert(rows);

  if (error) throw cleanErr(error);
}

// ---------------------------------------------------------------------------
// Borrow requests, pickup window, and reservation queue — atomic logic lives
// in Postgres (see supabase/schema.sql); these just call the RPC functions.
// ---------------------------------------------------------------------------
export async function requestBorrow(visitorId, bookId) {
  const { data, error } = await supabase.rpc(
    'request_borrow',
    {
      p_visitor_id: visitorId,
      p_book_id: bookId,
    }
  );

  if (error) throw cleanErr(error);

  return mapBorrowRequest(data);
}

export async function cancelBorrowRequest(
  requestId,
  reason = 'cancelled'
) {
  const { error } = await supabase.rpc(
    'cancel_borrow_request',
    {
      p_request_id: requestId,
      p_reason: reason,
    }
  );

  if (error) throw cleanErr(error);
}

/**
 * Called periodically (and on dashboard load) to auto-cancel expired pickups
 * and promote the next person in each book's reservation queue.
 */
export async function autoExpireOverduePickups() {
  const { data, error } = await supabase.rpc(
    'auto_expire_pickups'
  );

  if (error) throw cleanErr(error);

  return data;
}

/**
 * Librarian confirms pickup at the circulation desk.
 */
export async function confirmPickup(
  requestId,
  staffName
) {
  const { error } = await supabase.rpc(
    'confirm_pickup',
    {
      p_request_id: requestId,
      p_staff_name: staffName,
    }
  );

  if (error) throw cleanErr(error);
}

/**
 * Librarian confirms return at the circulation desk.
 */
export async function confirmReturn(
  requestId,
  staffName
) {
  const { error } = await supabase.rpc(
    'confirm_return',
    {
      p_request_id: requestId,
      p_staff_name: staffName,
    }
  );

  if (error) throw cleanErr(error);
}
