// ============================================================================
// SHELF ILMS — data & business-logic layer (Supabase-backed)
// ----------------------------------------------------------------------------
// This module is the only place in the app that talks to Supabase directly.
// Components/contexts call these functions and never import `supabase`
// themselves.
//
// Authentication:
//   Visitors      → Supabase Auth + visitors.auth_user_id
//   Staff/Admin   → Supabase Auth + staff_profiles
//
// Business rules that must be atomic are handled by PostgreSQL RPC functions.
// ============================================================================

import { supabase } from '../lib/supabaseClient.js';

// ============================================================================
// COMPATIBILITY CREDENTIAL LISTS
// ============================================================================

export const SUPER_ADMIN_CREDENTIALS = [
  {
    email: 'superadmin@shelf.com',
    name: 'SUPER ADMIN',
  },
];

export const SUB_ADMIN_CREDENTIALS = [
  {
    email: 'malvar.admin@shelf.edu',
    name: 'Malvar Campus Sub-Admin',
    libraryId: '277829af-1475-47ae-9e26-4b64c68f54f4',
  },
  {
    email: 'lipa.admin@shelf.edu',
    name: 'Lipa Campus Sub-Admin',
    libraryId: '3ccf575d-4573-4ed9-acdb-c8d9cf8a949e',
  },
  {
    email: 'lemery.admin@shelf.edu',
    name: 'Lemery Campus Sub-Admin',
    libraryId: '41dec6e1-28cd-4057-a046-982269698cdc',
  },
  {
    email: 'sanjuan.admin@shelf.edu',
    name: 'San Juan Campus Sub-Admin',
    libraryId: '4226ff5c-21f1-48bd-9cf8-a5a272c81e3d',
  },
  {
    email: 'mabini.admin@shelf.edu',
    name: 'Mabini Campus Sub-Admin',
    libraryId: '66ea1120-0789-410f-bb87-ae22d115ce1e',
  },
  {
    email: 'nasugbu.admin@shelf.edu',
    name: 'Nasugbu Campus Sub-Admin',
    libraryId: '67487fb6-6988-433c-aeef-9b770f59f010',
  },
  {
    email: 'batangascity.admin@shelf.edu',
    name: 'Batangas City Library Staff',
    libraryId: '78c0a005-06cd-48f5-92d2-daa06fe36e12',
  },
  {
    email: 'lobo.admin@shelf.edu',
    name: 'Lobo Campus Sub-Admin',
    libraryId: '7c23ab9b-b42d-4420-b5b7-fdc71c49792a',
  },
  {
    email: 'alangilan.admin@shelf.edu',
    name: 'Alangilan Campus Sub-Admin',
    libraryId: '84819f90-5923-4bd8-8aa0-1805e7613e81',
  },
  {
    email: 'balayan.admin@shelf.edu',
    name: 'Balayan Campus Sub-Admin',
    libraryId: '971893c8-5670-46b5-833c-398b2968ad1c',
  },
  {
    email: 'provincial.admin@shelf.edu',
    name: 'Provincial Library Staff',
    libraryId: '9c82c34b-6059-47e1-983a-d03755cb830b',
  },
  {
    email: 'pabloborbon.admin@shelf.edu',
    name: 'Pablo Borbon Campus Sub-Admin',
    libraryId: 'bde57b8b-d3b8-4676-823e-7573f80d3a36',
  },
  {
    email: 'rosario.admin@shelf.edu',
    name: 'Rosario Campus Sub-Admin',
    libraryId: 'c5613110-237e-4e93-b27b-95b41da95f3a',
  },
  {
    email: 'librarian@shelf.edu',
    name: 'Maria Santos',
    libraryId: '78c0a005-06cd-48f5-92d2-daa06fe36e12',
  },
  {
    email: 'circdesk@shelf.edu',
    name: 'Circulation Desk Staff',
    libraryId: '9c82c34b-6059-47e1-983a-d03755cb830b',
  },
];

// ============================================================================
// TUNABLE BUSINESS RULES
// ============================================================================

export const PICKUP_WINDOW_HOURS = 24;
export const BORROW_PERIOD_DAYS = 7;
export const FINE_PER_DAY = 10;

export const DEFAULT_COVER_URL =
  'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&q=80&w=400';

// ============================================================================
// DEMO / SAMPLE CATALOG
// ============================================================================

export const SAMPLE_BOOKS = [
  {
    title: 'Data Structures and Algorithms in Java',
    author: 'Robert Lafore',
    category: 'Computer Science',
    isbn: '978-0672324536',
    shelfLocation: 'Shelf A-3 (Technology)',
    libraryId: '277829af-1475-47ae-9e26-4b64c68f54f4',
    totalCopies: 5,
    summary:
      'This comprehensive guide serves as an essential roadmap for students and software engineers aiming to master the foundational mechanics of computer science. Designed with clarity and practical implementation in mind, the text thoroughly explores complex topics such as binary search trees, stacks, queues, sorting algorithms, and advanced memory allocation techniques specifically within the Java programming environment.',
    coverUrl:
      'https://images.unsplash.com/photo-1532012197267-da84d127e765?auto=format&fit=crop&q=80&w=400',
  },
  {
    title: 'Clean Code: A Handbook of Agile Software Craftsmanship',
    author: 'Robert C. Martin',
    category: 'Software Engineering',
    isbn: '978-0132350884',
    shelfLocation: 'Shelf B-1 (Software)',
    libraryId: '3ccf575d-4573-4ed9-acdb-c8d9cf8a949e',
    totalCopies: 3,
    summary:
      'Even bad code can function properly, but failing to keep code clean can drastically slow down a development team, stall product lifecycles, and accumulate massive technical debt over time. This handbook introduces programmers to the core values, disciplines, and best practices of agile software craftsmanship.',
    coverUrl:
      'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&q=80&w=400',
  },
  {
    title: 'Principles of Physics',
    author: 'David Halliday',
    category: 'Science',
    isbn: '978-1118230749',
    shelfLocation: 'Shelf C-2 (Science)',
    libraryId: '84819f90-5923-4bd8-8aa0-1805e7613e81',
    totalCopies: 4,
    summary:
      'Widely recognized as a cornerstone text for engineering and physical science students, this authoritative volume offers a rigorous foundation in classical mechanics, thermodynamics, electromagnetism, and modern physics.',
    coverUrl:
      'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&q=80&w=400',
  },
];

// ============================================================================
// HELPERS
// ============================================================================

const asString = (value) =>
  value === null || value === undefined
    ? ''
    : String(value);

const normalizeText = (value) =>
  asString(value).trim();

const normalizeEmail = (value) =>
  normalizeText(value).toLowerCase();

const normalizeQr = (value) =>
  normalizeText(value).toUpperCase();

const isValidUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalizeText(value)
  );

const isValidShelfQr = (value) =>
  /^SHELF-QR-\d{6}$/i.test(
    normalizeText(value)
  );

function cleanErr(
  error,
  fallback = 'Something went wrong. Please try again.'
) {
  const message = normalizeText(error?.message);

  return new Error(
    message || fallback
  );
}

async function safeSignOut() {
  try {
    await supabase.auth.signOut();
  } catch {
    // Ignore cleanup errors.
  }
}

function firstRow(data) {
  if (Array.isArray(data)) {
    return data[0] || null;
  }

  return data || null;
}

// ============================================================================
// ROW → CAMELCASE MAPPERS
// ============================================================================

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
  cancelReason: r.cancel_reason,
});

const mapAttendance = (r) => ({
  id: r.id,
  visitorId: r.visitor_id,
  visitorName: r.visitor_name,
  libraryId: r.library_id,
  timeIn: r.time_in,
  checkedOutAt: r.checked_out_at,
});

// ============================================================================
// FETCH LIBRARIES
// ============================================================================

export async function fetchLibraries() {
  const { data, error } = await supabase
    .from('libraries')
    .select('*')
    .order('name', {
      ascending: true,
    });

  if (error) {
    throw cleanErr(error);
  }

  return (data || []).map(mapLibrary);
}

// ============================================================================
// ADD LIBRARY
// ============================================================================

export async function addLibrary(library) {
  const suppliedId = normalizeText(library?.id);

  const id =
    suppliedId ||
    globalThis.crypto?.randomUUID?.();

  if (!id) {
    throw new Error(
      'This browser cannot generate a UUID for the new library.'
    );
  }

  if (!isValidUuid(id)) {
    throw new Error(
      'The library ID must be a valid UUID.'
    );
  }

  const name =
    normalizeText(library?.name);

  if (!name) {
    throw new Error(
      'Library name is required.'
    );
  }

  const { data, error } = await supabase
    .from('libraries')
    .insert({
      id,
      name,
      campus:
        normalizeText(library?.campus) || null,
      address:
        normalizeText(library?.address) || null,
      lat:
        Number.isFinite(Number(library?.lat))
          ? Number(library.lat)
          : null,
      lng:
        Number.isFinite(Number(library?.lng))
          ? Number(library.lng)
          : null,
      hours:
        normalizeText(library?.hours) || null,
      status:
        normalizeText(library?.status) || 'Open',
    })
    .select()
    .single();

  if (error) {
    throw cleanErr(error);
  }

  return mapLibrary(data);
}

// ============================================================================
// FETCH BOOKS
// ============================================================================

export async function fetchBooks() {
  const { data, error } = await supabase
    .from('books')
    .select('*')
    .order('created_at', {
      ascending: false,
    });

  if (error) {
    throw cleanErr(error);
  }

  return (data || []).map(mapBook);
}

// ============================================================================
// FETCH VISITORS
// ============================================================================

export async function fetchVisitors() {
  const {
    data: sessionData,
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw cleanErr(
      sessionError,
      'Unable to check the current authentication session.'
    );
  }

  if (!sessionData?.session) {
    return [];
  }

  const { data, error } = await supabase
    .from('visitors')
    .select(
      'id, full_name, contact_number, email, address, otp_verified, qr_code, registered_at'
    )
    .order('registered_at', {
      ascending: false,
    });

  if (error) {
    throw cleanErr(error);
  }

  return (data || []).map(mapVisitor);
}

// ============================================================================
// FETCH BORROW REQUESTS
// ============================================================================

export async function fetchBorrowRequests() {
  const {
    data: sessionData,
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw cleanErr(
      sessionError,
      'Unable to check the current authentication session.'
    );
  }

  if (!sessionData?.session) {
    return [];
  }

  const { data, error } = await supabase
    .from('borrow_requests')
    .select('*')
    .order('request_date', {
      ascending: false,
    });

  if (error) {
    throw cleanErr(error);
  }

  return (data || []).map(mapBorrowRequest);
}

// ============================================================================
// FETCH ATTENDANCE LOGS
// ============================================================================

export async function fetchAttendanceLogs() {
  const {
    data: sessionData,
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw cleanErr(
      sessionError,
      'Unable to check the current authentication session.'
    );
  }

  if (!sessionData?.session) {
    return [];
  }

  const { data, error } = await supabase
    .from('attendance_logs')
    .select('*')
    .order('time_in', {
      ascending: false,
    });

  if (error) {
    throw cleanErr(error);
  }

  return (data || []).map(mapAttendance);
}

// ============================================================================
// GET VISITOR
// ============================================================================

export async function getVisitor(visitorId) {
  const normalizedVisitorId =
    normalizeText(visitorId);

  if (!normalizedVisitorId) {
    return null;
  }

  if (!isValidUuid(normalizedVisitorId)) {
    throw new Error(
      'Invalid visitor ID.'
    );
  }

  const { data, error } = await supabase
    .from('visitors')
    .select(
      'id, full_name, contact_number, email, address, otp_verified, qr_code, registered_at'
    )
    .eq('id', normalizedVisitorId)
    .maybeSingle();

  if (error) {
    throw cleanErr(error);
  }

  return data
    ? mapVisitor(data)
    : null;
}

// ============================================================================
// VISITOR REGISTRATION
// ============================================================================

export async function registerVisitor({
  fullName,
  contactNumber,
  email,
  address,
  password,
}) {
  const normalizedFullName =
    normalizeText(fullName);

  const normalizedContactNumber =
    normalizeText(contactNumber);

  const normalizedEmail =
    normalizeEmail(email);

  const normalizedAddress =
    normalizeText(address);

  const normalizedPassword =
    asString(password);

  if (!normalizedFullName) {
    throw new Error(
      'Full name is required.'
    );
  }

  if (!normalizedContactNumber) {
    throw new Error(
      'Contact number is required.'
    );
  }

  if (!normalizedEmail) {
    throw new Error(
      'Email address is required.'
    );
  }

  if (!normalizedAddress) {
    throw new Error(
      'Address is required.'
    );
  }

  if (!normalizedPassword) {
    throw new Error(
      'Password is required.'
    );
  }

  // --------------------------------------------------------------------------
  // 1. CREATE SUPABASE AUTH ACCOUNT
  // --------------------------------------------------------------------------

  const {
    data: authData,
    error: authError,
  } = await supabase.auth.signUp({
    email: normalizedEmail,
    password: normalizedPassword,
    options: {
      data: {
        role: 'visitor',
        full_name: normalizedFullName,
        contact_number: normalizedContactNumber,
        address: normalizedAddress,
      },
    },
  });

  if (authError) {
    console.error(
      'SUPABASE AUTH REGISTRATION ERROR:',
      authError
    );

    const message =
      normalizeText(authError?.message)
        .toLowerCase();

    if (
      message.includes('already registered') ||
      message.includes('already exists') ||
      message.includes('user already registered')
    ) {
      throw new Error(
        'This email is already registered. Please log in instead.'
      );
    }

    throw cleanErr(
      authError,
      'Unable to create the visitor authentication account.'
    );
  }

  // --------------------------------------------------------------------------
  // 2. VERIFY AUTH USER
  // --------------------------------------------------------------------------

  if (!authData?.user?.id) {
    throw new Error(
      'Supabase Auth did not return a user account. Please try again.'
    );
  }

  const authUserId =
    normalizeText(authData.user.id);

  if (!isValidUuid(authUserId)) {
    await safeSignOut();

    throw new Error(
      'Supabase returned an invalid authentication user ID.'
    );
  }

  // Supabase can return an existing user from signUp()
  // without a normal "already registered" error.
  if (
    Array.isArray(authData.user.identities) &&
    authData.user.identities.length === 0
  ) {
    await safeSignOut();

    throw new Error(
      'This email is already registered. Please log in instead.'
    );
  }

  // --------------------------------------------------------------------------
  // 3. CREATE VISITOR PROFILE THROUGH RPC
  // --------------------------------------------------------------------------

  const {
    data: registrationData,
    error: registrationError,
  } = await supabase.rpc(
    'register_visitor',
    {
      p_auth_user_id:
        authUserId,

      p_full_name:
        normalizedFullName,

      p_contact_number:
        normalizedContactNumber,

      p_email:
        normalizedEmail,

      p_address:
        normalizedAddress,
    }
  );

  if (registrationError) {
    console.error(
      'REGISTER VISITOR PROFILE ERROR:',
      registrationError
    );

    const databaseMessage =
      normalizeText(
        registrationError?.message
      ).toLowerCase();

    if (
      databaseMessage.includes(
        'authentication account is already registered as a visitor'
      )
    ) {
      await safeSignOut();

      throw new Error(
        'This email is already registered as a SHELF visitor. Please log in instead.'
      );
    }

    if (
      databaseMessage.includes(
        'visitor account with this email already exists'
      )
    ) {
      await safeSignOut();

      throw new Error(
        'This email is already registered as a SHELF visitor. Please log in instead.'
      );
    }

    await safeSignOut();

    throw cleanErr(
      registrationError,
      'The authentication account was created, but the visitor profile could not be created.'
    );
  }

  // --------------------------------------------------------------------------
  // 4. GET VISITOR ID
  // --------------------------------------------------------------------------

  const row =
    firstRow(registrationData);

  if (!row?.visitor_id) {
    await safeSignOut();

    throw new Error(
      'The visitor profile could not be created. Please try again.'
    );
  }

  const visitorId =
    normalizeText(row.visitor_id);

  if (!isValidUuid(visitorId)) {
    await safeSignOut();

    throw new Error(
      'The visitor profile returned an invalid ID.'
    );
  }

  // --------------------------------------------------------------------------
  // 5. SIGN OUT BEFORE OTP VERIFICATION
  // --------------------------------------------------------------------------

  await safeSignOut();

  // --------------------------------------------------------------------------
  // 6. SEND OTP
  // --------------------------------------------------------------------------

  const {
    data: emailData,
    error: emailError,
  } =
    await supabase.functions.invoke(
      'send-visitor-otp',
      {
        body: {
          visitorId,
        },
      }
    );

  if (emailError) {
    console.error(
      'SEND VISITOR OTP ERROR:',
      emailError
    );

    throw new Error(
      'Your registration was created, but we could not send the verification email. Please try again.'
    );
  }

  if (
    emailData &&
    typeof emailData === 'object' &&
    emailData.success === false
  ) {
    throw new Error(
      emailData.message ||
        'Your registration was created, but we could not send the verification email. Please try again.'
    );
  }

  return {
    visitorId,
  };
}

// ============================================================================
// RESEND VISITOR OTP
// ============================================================================

export async function resendOtp(
  visitorId
) {
  const normalizedVisitorId =
    normalizeText(visitorId);

  if (!normalizedVisitorId) {
    throw new Error(
      'Registration session not found. Please register again.'
    );
  }

  if (!isValidUuid(normalizedVisitorId)) {
    throw new Error(
      'Invalid visitor registration session.'
    );
  }

  const {
    error,
  } = await supabase.rpc(
    'resend_otp',
    {
      p_visitor_id:
        normalizedVisitorId,
    }
  );

  if (error) {
    throw cleanErr(error);
  }

  const {
    data: emailData,
    error: emailError,
  } =
    await supabase.functions.invoke(
      'send-visitor-otp',
      {
        body: {
          visitorId:
            normalizedVisitorId,
        },
      }
    );

  if (emailError) {
    console.error(
      'RESEND VISITOR OTP ERROR:',
      emailError
    );

    throw new Error(
      'A new verification code was generated, but we could not send the email. Please try again.'
    );
  }

  if (
    emailData &&
    typeof emailData === 'object' &&
    emailData.success === false
  ) {
    throw new Error(
      emailData.message ||
        'A new verification code was generated, but we could not send the email. Please try again.'
    );
  }

  return {
    success: true,
  };
}

// ============================================================================
// VERIFY VISITOR OTP
// ============================================================================

export async function verifyVisitorOtp(
  visitorId,
  code
) {
  const normalizedVisitorId =
    normalizeText(visitorId);

  const normalizedCode =
    normalizeText(code);

  if (!normalizedVisitorId) {
    throw new Error(
      'Registration session not found. Please register again.'
    );
  }

  if (!isValidUuid(normalizedVisitorId)) {
    throw new Error(
      'Invalid visitor registration session.'
    );
  }

  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new Error(
      'Please enter the complete 6-digit verification code.'
    );
  }

  const {
    data,
    error,
  } = await supabase.rpc(
    'verify_visitor_otp',
    {
      p_visitor_id:
        normalizedVisitorId,

      p_code:
        normalizedCode,
    }
  );

  if (error) {
    throw cleanErr(error);
  }

  const row =
    firstRow(data);

  if (!row?.id) {
    throw new Error(
      'Verification was unsuccessful. Please request a new code.'
    );
  }

  return {
    id:
      row.id,

    fullName:
      row.full_name,

    email:
      row.email,

    qrCode:
      row.qr_code,

    otpVerified: true,
  };
}

// ============================================================================
// VISITOR LOGIN
// ============================================================================

export async function loginVisitor({
  identifier,
  password,
}) {
  const normalizedIdentifier =
    normalizeText(identifier);

  const normalizedPassword =
    asString(password);

  if (!normalizedIdentifier) {
    throw new Error(
      'Email or visitor QR pass is required.'
    );
  }

  // ==========================================================================
  // QR LOGIN
  // ==========================================================================

  if (
    isValidShelfQr(
      normalizedIdentifier
    )
  ) {
    const normalizedQr =
      normalizeQr(normalizedIdentifier);

    const {
      data: visitor,
      error: visitorError,
    } = await supabase
      .from('visitors')
      .select(
        'id, full_name, email, otp_verified, qr_code, is_active, auth_user_id'
      )
      .eq(
        'qr_code',
        normalizedQr
      )
      .maybeSingle();

    if (visitorError) {
      throw cleanErr(
        visitorError,
        'Unable to verify the visitor QR pass.'
      );
    }

    if (!visitor) {
      throw new Error(
        'Visitor QR pass was not found.'
      );
    }

    if (
      visitor.is_active === false
    ) {
      throw new Error(
        'This visitor account is currently inactive.'
      );
    }

    if (
      visitor.otp_verified !== true
    ) {
      throw new Error(
        'Please verify your visitor account before using the QR pass.'
      );
    }

    return {
      id:
        visitor.id,

      fullName:
        visitor.full_name,

      email:
        visitor.email,

      qrCode:
        visitor.qr_code,
    };
  }

  // ==========================================================================
  // EMAIL + PASSWORD LOGIN
  // ==========================================================================

  if (!normalizedPassword) {
    throw new Error(
      'Password is required.'
    );
  }

  const {
    data: authData,
    error: authError,
  } =
    await supabase.auth.signInWithPassword({
      email:
        normalizeEmail(
          normalizedIdentifier
        ),

      password:
        normalizedPassword,
    });

  if (authError) {
    const message =
      normalizeText(
        authError?.message
      );

    const lowerMessage =
      message.toLowerCase();

    if (
      lowerMessage.includes(
        'invalid login credentials'
      )
    ) {
      throw new Error(
        'Invalid login credentials'
      );
    }

    if (
      lowerMessage.includes(
        'email not confirmed'
      )
    ) {
      throw new Error(
        'Please verify your email account before logging in.'
      );
    }

    throw cleanErr(
      authError,
      'Unable to log in to the visitor account.'
    );
  }

  if (!authData?.user?.id) {
    throw new Error(
      'Supabase Auth did not return a visitor account.'
    );
  }

  const authUserId =
    normalizeText(
      authData.user.id
    );

  if (!isValidUuid(authUserId)) {
    await safeSignOut();

    throw new Error(
      'Supabase returned an invalid authentication user ID.'
    );
  }

  // ==========================================================================
  // LOAD VISITOR PROFILE
  // ==========================================================================

  const {
    data: visitor,
    error: visitorError,
  } =
    await supabase
      .from('visitors')
      .select(
        'id, full_name, email, otp_verified, qr_code, is_active, auth_user_id'
      )
      .eq(
        'auth_user_id',
        authUserId
      )
      .maybeSingle();

  if (visitorError) {
    await safeSignOut();

    throw cleanErr(
      visitorError,
      'Unable to load the visitor profile.'
    );
  }

  if (!visitor) {
    await safeSignOut();

    throw new Error(
      'This account is not registered as a SHELF visitor.'
    );
  }

  if (
    visitor.is_active === false
  ) {
    await safeSignOut();

    throw new Error(
      'This visitor account is currently inactive.'
    );
  }

  if (
    visitor.otp_verified !== true
  ) {
    await safeSignOut();

    throw new Error(
      'Please verify your OTP code before logging in.'
    );
  }

  return {
    id:
      visitor.id,

    fullName:
      visitor.full_name,

    email:
      visitor.email,

    qrCode:
      visitor.qr_code,
  };
}

// ============================================================================
// FIND VISITOR BY QR
// ============================================================================

export async function findVisitorByQr(
  qrCode,
  libraryId
) {
  const normalizedQrCode =
    normalizeQr(qrCode);

  const normalizedLibraryId =
    normalizeText(libraryId);

  if (!normalizedQrCode) {
    return null;
  }

  if (!normalizedLibraryId) {
    throw new Error(
      'Library branch is required to scan a visitor.'
    );
  }

  if (
    !isValidShelfQr(
      normalizedQrCode
    )
  ) {
    throw new Error(
      'Invalid SHELF visitor QR pass.'
    );
  }

  if (
    !isValidUuid(
      normalizedLibraryId
    )
  ) {
    throw new Error(
      'Invalid library branch ID.'
    );
  }

  const {
    data,
    error,
  } = await supabase.rpc(
    'find_visitor_by_qr',
    {
      p_qr:
        normalizedQrCode,

      p_library_id:
        normalizedLibraryId,
    }
  );

  if (error) {
    throw cleanErr(error);
  }

  if (
    !data ||
    (Array.isArray(data) &&
      data.length === 0)
  ) {
    return null;
  }

  const row =
    firstRow(data);

  if (!row) {
    return null;
  }

  return {
    id:
      row.id,

    fullName:
      row.full_name,

    email:
      row.email,

    qrCode:
      row.qr_code,
  };
}

// ============================================================================
// STAFF AUTHENTICATION
// ============================================================================

export async function loginStaffAccount(
  email,
  password
) {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured.'
    );
  }

  const normalizedEmail =
    normalizeEmail(email);

  const normalizedPassword =
    asString(password);

  if (
    !normalizedEmail ||
    !normalizedPassword
  ) {
    throw new Error(
      'Email and password are required.'
    );
  }

  const {
    data,
    error,
  } =
    await supabase.auth.signInWithPassword({
      email:
        normalizedEmail,

      password:
        normalizedPassword,
    });

  if (error) {
    console.error(
      'SUPABASE STAFF LOGIN ERROR:',
      error
    );

    await safeSignOut();

    const authErrorMessage =
      normalizeText(
        error?.message
      )
        .toLowerCase();

    if (
      authErrorMessage.includes(
        'user is banned'
      ) ||
      authErrorMessage.includes(
        'user has been banned'
      ) ||
      authErrorMessage.includes(
        'banned'
      )
    ) {
      throw new Error(
        'This staff account is currently inactive.'
      );
    }

    if (
      authErrorMessage.includes(
        'invalid login credentials'
      )
    ) {
      throw new Error(
        'Invalid login credentials'
      );
    }

    if (
      authErrorMessage.includes(
        'email not confirmed'
      )
    ) {
      throw new Error(
        'This staff account email has not been confirmed.'
      );
    }

    throw cleanErr(
      error,
      'Unable to authenticate the staff account.'
    );
  }

  if (!data?.user?.id) {
    await safeSignOut();

    throw new Error(
      'Supabase Auth did not return a user.'
    );
  }

  const authUserId =
    normalizeText(
      data.user.id
    );

  if (!isValidUuid(authUserId)) {
    await safeSignOut();

    throw new Error(
      'Supabase returned an invalid staff user ID.'
    );
  }

  // ==========================================================================
  // LOAD STAFF PROFILE
  // ==========================================================================

  const {
    data: profile,
    error: profileError,
  } =
    await supabase
      .from('staff_profiles')
      .select(
        'id, email, full_name, role, library_id, is_active'
      )
      .eq(
        'id',
        authUserId
      )
      .maybeSingle();

  if (profileError) {
    console.error(
      'STAFF PROFILE LOAD ERROR:',
      profileError
    );

    await safeSignOut();

    throw cleanErr(
      profileError,
      'Unable to load the staff profile.'
    );
  }

  if (!profile) {
    await safeSignOut();

    throw new Error(
      'This account has not been provisioned as a SHELF staff account.'
    );
  }

  if (
    profile.is_active !== true
  ) {
    await safeSignOut();

    throw new Error(
      'This staff account is currently inactive.'
    );
  }

  const allowedRoles = [
    'subadmin',
    'superadmin',
  ];

  if (
    !allowedRoles.includes(
      profile.role
    )
  ) {
    await safeSignOut();

    throw new Error(
      'This account does not have a valid SHELF staff role.'
    );
  }

  return {
    id:
      profile.id,

    email:
      profile.email,

    name:
      profile.full_name,

    role:
      profile.role,

    libraryId:
      profile.library_id,
  };
}

// ============================================================================
// SUB-ADMIN LOGIN
// ============================================================================

export async function loginSubAdmin(
  email,
  password
) {
  const staff =
    await loginStaffAccount(
      email,
      password
    );

  if (
    staff.role !==
    'subadmin'
  ) {
    await safeSignOut();

    throw new Error(
      'This account is not authorized as a sub-admin.'
    );
  }

  return staff;
}

// ============================================================================
// SUPER-ADMIN LOGIN
// ============================================================================

export async function loginSuperAdmin(
  email,
  password
) {
  const staff =
    await loginStaffAccount(
      email,
      password
    );

  if (
    staff.role !==
    'superadmin'
  ) {
    await safeSignOut();

    throw new Error(
      'This account is not authorized as a super-admin.'
    );
  }

  return staff;
}

// ============================================================================
// ATTENDANCE
// ============================================================================

export async function scanAttendance(
  qrCode,
  libraryId
) {
  const normalizedQrCode =
    normalizeQr(qrCode);

  const normalizedLibraryId =
    normalizeText(libraryId);

  if (!normalizedQrCode) {
    throw new Error(
      'Visitor QR pass is required.'
    );
  }

  if (!isValidShelfQr(normalizedQrCode)) {
    throw new Error(
      'Invalid SHELF visitor QR pass.'
    );
  }

  if (!isValidUuid(normalizedLibraryId)) {
    throw new Error(
      'Invalid library branch ID.'
    );
  }

  const {
    data,
    error,
  } = await supabase.rpc(
    'toggle_attendance',
    {
      p_qr:
        normalizedQrCode,

      p_library_id:
        normalizedLibraryId,
    }
  );

  if (error) {
    throw cleanErr(error);
  }

  const row =
    firstRow(data);

  if (!row) {
    throw new Error(
      'Unable to record attendance.'
    );
  }

  return {
    visitor: {
      id:
        row.visitor_id,

      fullName:
        row.visitor_name,
    },

    log: {
      id:
        row.log_id,

      action:
        row.action,
    },
  };
}

// ============================================================================
// BOOK INVENTORY — ADD BOOK
// ============================================================================

export async function addBook(
  book
) {
  const title =
    normalizeText(book?.title);

  const author =
    normalizeText(book?.author);

  const libraryId =
    normalizeText(book?.libraryId);

  if (!title) {
    throw new Error(
      'Book title is required.'
    );
  }

  if (!author) {
    throw new Error(
      'Book author is required.'
    );
  }

  if (
    libraryId &&
    !isValidUuid(libraryId)
  ) {
    throw new Error(
      'Invalid library ID.'
    );
  }

  const totalCopies =
    Math.max(
      1,
      Number(
        book?.totalCopies
      ) || 1
    );

  const {
    data,
    error,
  } =
    await supabase
      .from('books')
      .insert({
        title,

        author,

        category:
          normalizeText(
            book?.category
          ) ||
          'General',

        isbn:
          normalizeText(
            book?.isbn
          ) || null,

        shelf_location:
          normalizeText(
            book?.shelfLocation
          ) || null,

        library_id:
          libraryId || null,

        total_copies:
          totalCopies,

        available_copies:
          totalCopies,

        summary:
          normalizeText(
            book?.summary
          ) || null,

        cover_url:
          normalizeText(
            book?.coverUrl
          ) ||
          DEFAULT_COVER_URL,
      })
      .select()
      .single();

  if (error) {
    throw cleanErr(error);
  }

  return mapBook(data);
}

// ============================================================================
// BULK BOOK UPLOAD
// ============================================================================

export async function addBooksBulk(
  books
) {
  if (
    !Array.isArray(books) ||
    books.length === 0
  ) {
    throw new Error(
      'Choose a file containing at least one book.'
    );
  }

  const rows =
    books.map(
      (book, index) => {
        const normalized =
          Object.fromEntries(
            Object.entries(
              book || {}
            ).map(
              ([key, value]) => [
                String(key)
                  .trim()
                  .toLowerCase()
                  .replace(
                    /[\s-]+/g,
                    '_'
                  ),
                value,
              ]
            )
          );

        const title =
          normalizeText(
            normalized.title
          );

        const author =
          normalizeText(
            normalized.author
          );

        const isbn =
          normalizeText(
            normalized.isbn
          );

        const category =
          normalizeText(
            normalized.category
          );

        const stock =
          Number(
            normalized.stock_count ??
              normalized.stock ??
              normalized.total_copies ??
              normalized.copies
          );

        if (
          !title ||
          !author ||
          !isbn ||
          !category ||
          !Number.isInteger(stock) ||
          stock < 1
        ) {
          throw new Error(
            `Row ${index + 1} requires title, author, ISBN, category, and a positive whole-number stock count.`
          );
        }

        const libraryId =
          normalizeText(
            normalized.library_id
          );

        if (
          libraryId &&
          !isValidUuid(libraryId)
        ) {
          throw new Error(
            `Row ${index + 1} contains an invalid library UUID.`
          );
        }

        return {
          library_id:
            libraryId || null,

          title,

          author,

          isbn,

          category,

          total_copies:
            stock,

          available_copies:
            stock,

          shelf_location:
            normalizeText(
              normalized.shelf_location
            ) || null,

          summary:
            normalizeText(
              normalized.summary
            ) || null,

          cover_url:
            normalizeText(
              normalized.cover_url
            ) || DEFAULT_COVER_URL,
        };
      }
    );

  const {
    data,
    error,
  } =
    await supabase
      .from('books')
      .insert(rows)
      .select();

  if (error) {
    throw cleanErr(error);
  }

  return (data || []).map(
    mapBook
  );
}

// ============================================================================
// UPDATE BOOK
// ============================================================================

export async function updateBook(
  bookId,
  patch
) {
  const normalizedBookId =
    normalizeText(bookId);

  if (!normalizedBookId) {
    throw new Error(
      'Book ID is required.'
    );
  }

  if (!isValidUuid(normalizedBookId)) {
    throw new Error(
      'Invalid book ID.'
    );
  }

  const dbPatch = {};

  if (
    patch?.title !== undefined
  ) {
    dbPatch.title =
      normalizeText(
        patch.title
      );
  }

  if (
    patch?.author !== undefined
  ) {
    dbPatch.author =
      normalizeText(
        patch.author
      );
  }

  if (
    patch?.category !== undefined
  ) {
    dbPatch.category =
      normalizeText(
        patch.category
      );
  }

  if (
    patch?.isbn !== undefined
  ) {
    dbPatch.isbn =
      normalizeText(
        patch.isbn
      ) || null;
  }

  if (
    patch?.shelfLocation !== undefined
  ) {
    dbPatch.shelf_location =
      normalizeText(
        patch.shelfLocation
      ) || null;
  }

  if (
    patch?.libraryId !== undefined
  ) {
    const libraryId =
      normalizeText(
        patch.libraryId
      );

    if (
      libraryId &&
      !isValidUuid(libraryId)
    ) {
      throw new Error(
        'Invalid library ID.'
      );
    }

    dbPatch.library_id =
      libraryId || null;
  }

  if (
    patch?.totalCopies !== undefined
  ) {
    const totalCopies =
      Number(
        patch.totalCopies
      );

    if (
      !Number.isInteger(
        totalCopies
      ) ||
      totalCopies < 1
    ) {
      throw new Error(
        'Total copies must be a positive whole number.'
      );
    }

    dbPatch.total_copies =
      totalCopies;
  }

  if (
    patch?.availableCopies !== undefined
  ) {
    const availableCopies =
      Number(
        patch.availableCopies
      );

    if (
      !Number.isInteger(
        availableCopies
      ) ||
      availableCopies < 0
    ) {
      throw new Error(
        'Available copies must be a non-negative whole number.'
      );
    }

    dbPatch.available_copies =
      availableCopies;
  }

  if (
    patch?.summary !== undefined
  ) {
    dbPatch.summary =
      normalizeText(
        patch.summary
      ) || null;
  }

  if (
    patch?.coverUrl !== undefined
  ) {
    dbPatch.cover_url =
      normalizeText(
        patch.coverUrl
      ) || DEFAULT_COVER_URL;
  }

  if (
    Object.keys(dbPatch).length === 0
  ) {
    return;
  }

  const {
    error,
  } =
    await supabase
      .from('books')
      .update(dbPatch)
      .eq(
        'id',
        normalizedBookId
      );

  if (error) {
    throw cleanErr(error);
  }
}

// ============================================================================
// DELETE BOOK
// ============================================================================

export async function deleteBook(
  bookId
) {
  const normalizedBookId =
    normalizeText(bookId);

  if (!normalizedBookId) {
    throw new Error(
      'Book ID is required.'
    );
  }

  if (!isValidUuid(normalizedBookId)) {
    throw new Error(
      'Invalid book ID.'
    );
  }

  const {
    error,
  } =
    await supabase
      .from('books')
      .delete()
      .eq(
        'id',
        normalizedBookId
      );

  if (error) {
    throw cleanErr(error);
  }
}

// ============================================================================
// LOAD SAMPLE / API CATALOG
// ============================================================================

export async function loadSampleCatalog(
  libraryId
) {
  const normalizedLibraryId =
    normalizeText(libraryId);

  if (!normalizedLibraryId) {
    throw new Error(
      'A library must be selected before loading books.'
    );
  }

  if (!isValidUuid(normalizedLibraryId)) {
    throw new Error(
      'Invalid library ID.'
    );
  }

  const categories = [
    'computer+science',
    'engineering',
    'mathematics',
    'physics',
    'history',
  ];

  const allBooks = [];

  for (
    const cat of categories
  ) {
    try {
      const response =
        await fetch(
          `https://openlibrary.org/search.json?q=${cat}&limit=25`
        );

      if (!response.ok) {
        throw new Error(
          `Open Library returned ${response.status}.`
        );
      }

      const data =
        await response.json();

      const mapped =
        (data.docs || []).map(
          (
            doc,
            index
          ) => {
            const copies =
              Math.floor(
                Math.random() * 5
              ) + 3;

            const categoryName =
              cat.replace(
                '+',
                ' '
              );

            return {
              title:
                doc.title ||
                'Untitled',

              author:
                doc.author_name?.[0] ||
                'Unknown Author',

              category:
                categoryName.toUpperCase(),

              isbn:
                doc.isbn?.[0] ||
                `ISBN-${Math.random()
                  .toString(36)
                  .substring(
                    2,
                    10
                  )
                  .toUpperCase()}`,

              shelf_location:
                `Shelf ${String.fromCharCode(
                  65 +
                    (index % 5)
                )}-${(index % 10) + 1}`,

              library_id:
                normalizedLibraryId,

              total_copies:
                copies,

              available_copies:
                copies,

              summary:
                doc.first_sentence?.[0] ||
                `An authoritative academic resource focusing on ${categoryName}, providing comprehensive theoretical frameworks, practical methodologies, and foundational insights for higher education students and researchers within the library network.`,

              cover_url:
                doc.cover_i
                  ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
                  : DEFAULT_COVER_URL,
            };
          }
        );

      allBooks.push(
        ...mapped
      );
    } catch (err) {
      console.error(
        'Error fetching sample catalog from API:',
        err
      );
    }
  }

  if (
    allBooks.length === 0
  ) {
    throw new Error(
      'No books could be loaded from Open Library.'
    );
  }

  const {
    data,
    error,
  } =
    await supabase
      .from('books')
      .insert(
        allBooks
      )
      .select();

  if (error) {
    throw cleanErr(error);
  }

  return (data || []).map(
    mapBook
  );
}

// ============================================================================
// BORROW REQUEST
// ============================================================================

export async function requestBorrow(
  visitorId,
  bookId
) {
  const normalizedVisitorId =
    normalizeText(visitorId);

  const normalizedBookId =
    normalizeText(bookId);

  if (
    !isValidUuid(
      normalizedVisitorId
    )
  ) {
    throw new Error(
      'Invalid visitor ID.'
    );
  }

  if (
    !isValidUuid(
      normalizedBookId
    )
  ) {
    throw new Error(
      'Invalid book ID.'
    );
  }

  const {
    data,
    error,
  } =
    await supabase.rpc(
      'request_borrow',
      {
        p_visitor_id:
          normalizedVisitorId,

        p_book_id:
          normalizedBookId,
      }
    );

  if (error) {
    throw cleanErr(error);
  }

  const row =
    firstRow(data);

  if (!row) {
    throw new Error(
      'Borrow request was not created.'
    );
  }

  return mapBorrowRequest(
    row
  );
}

// ============================================================================
// CANCEL BORROW REQUEST
// ============================================================================

export async function cancelBorrowRequest(
  requestId,
  reason = 'cancelled'
) {
  const normalizedRequestId =
    normalizeText(requestId);

  if (
    !isValidUuid(
      normalizedRequestId
    )
  ) {
    throw new Error(
      'Invalid borrow request ID.'
    );
  }

  const normalizedReason =
    normalizeText(reason) ||
    'cancelled';

  const {
    error,
  } =
    await supabase.rpc(
      'cancel_borrow_request',
      {
        p_request_id:
          normalizedRequestId,

        p_reason:
          normalizedReason,
      }
    );

  if (error) {
    throw cleanErr(error);
  }

  return {
    success: true,
  };
}

// ============================================================================
// CONFIRM PICKUP
// ============================================================================

export async function confirmPickup(
  requestId,
  staffName
) {
  const normalizedRequestId =
    normalizeText(requestId);

  const normalizedStaffName =
    normalizeText(staffName);

  if (
    !isValidUuid(
      normalizedRequestId
    )
  ) {
    throw new Error(
      'Invalid borrow request ID.'
    );
  }

  if (!normalizedStaffName) {
    throw new Error(
      'Staff name is required.'
    );
  }

  const {
    error,
  } =
    await supabase.rpc(
      'confirm_pickup',
      {
        p_request_id:
          normalizedRequestId,

        p_staff_name:
          normalizedStaffName,
      }
    );

  if (error) {
    throw cleanErr(error);
  }

  return {
    success: true,
  };
}

// ============================================================================
// CONFIRM RETURN
// ============================================================================

export async function confirmReturn(
  requestId,
  staffName
) {
  const normalizedRequestId =
    normalizeText(requestId);

  const normalizedStaffName =
    normalizeText(staffName);

  if (
    !isValidUuid(
      normalizedRequestId
    )
  ) {
    throw new Error(
      'Invalid borrow request ID.'
    );
  }

  if (!normalizedStaffName) {
    throw new Error(
      'Staff name is required.'
    );
  }

  const {
    error,
  } =
    await supabase.rpc(
      'confirm_return',
      {
        p_request_id:
          normalizedRequestId,

        p_staff_name:
          normalizedStaffName,
      }
    );

  if (error) {
    throw cleanErr(error);
  }

  return {
    success: true,
  };
}
