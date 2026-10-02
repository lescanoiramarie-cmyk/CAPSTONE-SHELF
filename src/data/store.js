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
      'This comprehensive guide serves as an essential roadmap for students and software engineers aiming to master the foundational mechanics of computer science. Designed with clarity and practical implementation in mind, the text thoroughly explores complex topics such as binary search trees, stacks, queues, sorting algorithms, and advanced memory allocation techniques specifically within the Java programming environment. Readers are provided with clear architectural breakdowns and step-by-step code examples that demystify how underlying data structures affect application performance and scalability. Furthermore, the book emphasizes object-oriented design principles, ensuring that developers not only learn how to implement data structures efficiently but also how to write maintainable, modular, and robust codebases. Whether you are preparing for technical interviews, building enterprise-grade applications, or laying down the core academic groundwork required for advanced software engineering, this textbook bridges the crucial gap between abstract theoretical computer science and real-world programming execution, making it an indispensable resource for any modern technical library collection.',
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
      'Even bad code can function properly, but failing to keep code clean can drastically slow down a development team, stall product lifecycles, and accumulate massive technical debt over time. This seminal handbook introduces programmers to the core values, disciplines, and best practices of agile software craftsmanship. The author breaks down the art of writing readable, reusable, and refactorable code by examining meaningful naming conventions, proper function sizing, object-oriented design boundaries, effective error handling protocols, and comprehensive unit testing strategies. Through extensive comparative code examples, readers learn to distinguish between messy, convoluted implementations and elegant, self-documenting architectures. The text challenges programmers to take professional pride in their codebases, arguing that writing clean code is not merely an aesthetic preference but a fundamental ethical and economic necessity for long-term project viability. Packed with invaluable insights, heuristics, and practical refactoring exercises, this textbook transforms casual programmers into disciplined software artisans capable of collaborating seamlessly in high-performance development teams.',
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
      'Widely recognized as a cornerstone text for engineering and physical science students, this authoritative volume offers a rigorous and deeply analytical foundation in classical mechanics, thermodynamics, electromagnetism, and modern physics. The curriculum is meticulously structured to cultivate critical analytical thinking and problem-solving skills, taking complex physical phenomena and breaking them down through mathematical rigor, vector calculus applications, and real-world engineering scenarios. Each chapter features conceptual questions, detailed problem sets, and illustrative visual diagrams that connect abstract theoretical equations to tangible physical reality. Students explore the conservation of energy, rotational dynamics, wave motion, electromagnetic induction, and quantum principles with exceptional clarity. Designed to support rigorous academic programs, the book encourages learners to look beyond rote formula memorization and truly grasp the universal laws governing the physical universe.',
    coverUrl:
      'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&q=80&w=400',
  },
];

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
// ERROR HANDLER
// ============================================================================

function cleanErr(
  error,
  fallback = 'Something went wrong. Please try again.'
) {
  return new Error(
    String(error?.message || fallback)
  );
}

// ============================================================================
// FETCHING
// ============================================================================

export async function fetchLibraries() {
  const { data, error } = await supabase
    .from('libraries')
    .select('*')
    .order('name');

  if (error) {
    throw cleanErr(error);
  }

  return (data || []).map(mapLibrary);
}

export async function addLibrary(library) {
  const id =
    library.id ||
    globalThis.crypto?.randomUUID?.();

  if (!id) {
    throw new Error(
      'This browser cannot generate a UUID for the new library.'
    );
  }

  const { error } = await supabase
    .from('libraries')
    .insert({
      id,
      name: String(library.name || '').trim(),
      campus:
        String(library.campus || '').trim() || null,
      address:
        String(library.address || '').trim() || null,
      lat: Number(library.lat),
      lng: Number(library.lng),
      hours:
        String(library.hours || '').trim() || null,
      status: library.status || 'Open',
    });

  if (error) {
    throw cleanErr(error);
  }

  return id;
}

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

export async function fetchVisitors() {
  const {
    data: sessionData,
  } = await supabase.auth.getSession();

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

export async function fetchBorrowRequests() {
  const {
    data: sessionData,
  } = await supabase.auth.getSession();

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

export async function fetchAttendanceLogs() {
  const {
    data: sessionData,
  } = await supabase.auth.getSession();

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

export async function getVisitor(visitorId) {
  if (!visitorId) {
    return null;
  }

  const { data, error } = await supabase
    .from('visitors')
    .select(
      'id, full_name, contact_number, email, address, otp_verified, qr_code, registered_at'
    )
    .eq('id', visitorId)
    .maybeSingle();

  if (error) {
    throw cleanErr(error);
  }

  return data ? mapVisitor(data) : null;
}

// ============================================================================
// VISITOR ACCOUNTS
// ----------------------------------------------------------------------------
// Visitors use Supabase Auth for passwords.
//
// Registration:
//   supabase.auth.signUp()
//        ↓
//   auth.users
//        ↓
//   register_visitor(auth_user_id, profile data)
//        ↓
//   visitors row + OTP
//        ↓
//   send-visitor-otp Edge Function
//
// Verification:
//   verify_visitor_otp(uuid,text)
//
// Email login:
//   supabase.auth.signInWithPassword()
//        ↓
//   visitors.auth_user_id
//
// QR login:
//   visitors.qr_code
//
// IMPORTANT:
// Visitor passwords are NEVER stored in the visitors table.
// ============================================================================

export async function registerVisitor({
  fullName,
  contactNumber,
  email,
  address,
  password,
}) {
  const normalizedFullName =
    String(fullName || '').trim();

  const normalizedContactNumber =
    String(contactNumber || '').trim();

  const normalizedEmail =
    String(email || '')
      .trim()
      .toLowerCase();

  const normalizedAddress =
    String(address || '').trim();

  const normalizedPassword =
    String(password || '');

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

  // ==========================================================================
  // CREATE OR RESOLVE SUPABASE AUTH ACCOUNT
  // ==========================================================================

  let authUser = null;
  let isExistingAuthAccount = false;

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

  // --------------------------------------------------------------------------
  // NEW AUTH ACCOUNT
  // --------------------------------------------------------------------------

  if (
    !authError &&
    authData?.user?.id
  ) {
    authUser = authData.user;

    // Supabase can return an existing email as a user with zero identities.
    // That must be handled as an existing Auth account.
    if (
      Array.isArray(authUser.identities) &&
      authUser.identities.length === 0
    ) {
      isExistingAuthAccount = true;
    }
  }

  // --------------------------------------------------------------------------
  // EXISTING AUTH ACCOUNT REPORTED AS AN ERROR
  // --------------------------------------------------------------------------

  if (authError) {
    const message =
      String(
        authError?.message || ''
      ).toLowerCase();

    const isDuplicateAuthEmail =
      message.includes('already registered') ||
      message.includes('already exists') ||
      message.includes('user already registered');

    if (!isDuplicateAuthEmail) {
      throw cleanErr(
        authError,
        'Unable to create the visitor account.'
      );
    }

    isExistingAuthAccount = true;
  }

  // ==========================================================================
  // EXISTING AUTH ACCOUNT
  // ==========================================================================
  //
  // If Supabase Auth already has the email, authenticate using the password
  // supplied by the user. This lets us safely distinguish:
  //
  //   existing Auth + existing visitor
  //   existing Auth + no visitor
  //
  // ==========================================================================

  if (isExistingAuthAccount) {
    const {
      data: existingAuthData,
      error: existingAuthError,
    } =
      await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: normalizedPassword,
      });

    if (existingAuthError) {
      const message =
        String(
          existingAuthError?.message || ''
        ).toLowerCase();

      if (
        message.includes(
          'invalid login credentials'
        )
      ) {
        throw new Error(
          'An account with this email already exists. Please use the correct password or use another email address.'
        );
      }

      if (
        message.includes(
          'email not confirmed'
        )
      ) {
        throw new Error(
          'This email account already exists but has not been confirmed. Please verify the email account first.'
        );
      }

      throw cleanErr(
        existingAuthError,
        'Unable to authenticate the existing email account.'
      );
    }

    if (!existingAuthData?.user?.id) {
      throw new Error(
        'The existing authentication account could not be loaded.'
      );
    }

    authUser =
      existingAuthData.user;
  }

  // ==========================================================================
  // VERIFY AUTH USER ID
  // ==========================================================================

  if (!authUser?.id) {
    throw new Error(
      'Supabase Auth did not return a user account. Please try again.'
    );
  }

  const authUserId =
    String(
      authUser.id
    ).trim();

  // ==========================================================================
  // CHECK EXISTING VISITOR PROFILE
  // ==========================================================================
  //
  // This check is performed only for an existing Auth account.
  //
  // For a completely new Auth account, register_visitor() itself performs
  // duplicate protection atomically.
  //
  // ==========================================================================

  if (isExistingAuthAccount) {
    const {
      data: existingVisitor,
      error: existingVisitorError,
    } =
      await supabase
        .from('visitors')
        .select(
          'id, email, auth_user_id, otp_verified, is_active'
        )
        .eq(
          'auth_user_id',
          authUserId
        )
        .maybeSingle();

    if (existingVisitorError) {
      try {
        await supabase.auth.signOut();
      } catch {
        // Ignore cleanup errors.
      }

      throw cleanErr(
        existingVisitorError,
        'Unable to check the existing visitor profile.'
      );
    }

    if (existingVisitor) {
      try {
        await supabase.auth.signOut();
      } catch {
        // Ignore cleanup errors.
      }

      throw new Error(
        'A visitor account with this email already exists.'
      );
    }

    // No visitor profile exists.
    // Continue and connect this existing Auth account to SHELF.
  }

  // ==========================================================================
  // CREATE VISITOR PROFILE THROUGH RPC
  // ==========================================================================

  const {
    data: registrationData,
    error: registrationError,
  } =
    await supabase.rpc(
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

    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore cleanup errors.
    }

    throw cleanErr(
      registrationError,
      'The authentication account was created, but the visitor profile could not be created.'
    );
  }

  const row =
    Array.isArray(
      registrationData
    )
      ? registrationData[0]
      : registrationData;

  if (!row?.visitor_id) {
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore cleanup errors.
    }

    throw new Error(
      'The visitor profile could not be created. Please try again.'
    );
  }

  const visitorId =
    String(
      row.visitor_id
    ).trim();

  // ==========================================================================
  // SIGN OUT AFTER REGISTRATION
  // ==========================================================================

  try {
    await supabase.auth.signOut();
  } catch {
    // Ignore cleanup errors.
  }

  // ==========================================================================
  // SEND OTP
  // ==========================================================================

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
    String(visitorId || '').trim();

  if (!normalizedVisitorId) {
    throw new Error(
      'Registration session not found. Please register again.'
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
    String(visitorId || '').trim();

  const normalizedCode =
    String(code || '').trim();

  if (!normalizedVisitorId) {
    throw new Error(
      'Registration session not found. Please register again.'
    );
  }

  if (
    !/^\d{6}$/.test(
      normalizedCode
    )
  ) {
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
    Array.isArray(data)
      ? data[0]
      : data;

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
    String(identifier || '').trim();

  const normalizedPassword =
    String(password || '');

  if (!normalizedIdentifier) {
    throw new Error(
      'Email or visitor QR pass is required.'
    );
  }

  // ==========================================================================
  // QR LOGIN
  // ==========================================================================

  const looksLikeQr =
    /^SHELF-QR-\d{6}$/i.test(
      normalizedIdentifier
    );

  if (looksLikeQr) {
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
        normalizedIdentifier
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
        normalizedIdentifier.toLowerCase(),

      password:
        normalizedPassword,
    });

  if (authError) {
    const message =
      String(
        authError?.message || ''
      ).trim();

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
    String(
      authData.user.id
    ).trim();

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
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore cleanup errors.
    }

    throw cleanErr(
      visitorError,
      'Unable to load the visitor profile.'
    );
  }

  if (!visitor) {
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore cleanup errors.
    }

    throw new Error(
      'This account is not registered as a SHELF visitor.'
    );
  }

  if (
    visitor.is_active === false
  ) {
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore cleanup errors.
    }

    throw new Error(
      'This visitor account is currently inactive.'
    );
  }

  if (
    visitor.otp_verified !== true
  ) {
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore cleanup errors.
    }

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
    String(qrCode || '').trim();

  const normalizedLibraryId =
    String(libraryId || '').trim();

  if (!normalizedQrCode) {
    return null;
  }

  if (!normalizedLibraryId) {
    throw new Error(
      'Library branch is required to scan a visitor.'
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
    data.length === 0
  ) {
    return null;
  }

  const row =
    Array.isArray(data)
      ? data[0]
      : data;

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
    String(email || '')
      .trim()
      .toLowerCase();

  const normalizedPassword =
    String(password || '');

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

    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore cleanup errors.
    }

    const authErrorMessage =
      String(
        error?.message || ''
      )
        .trim()
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

  if (!data?.user) {
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore cleanup errors.
    }

    throw new Error(
      'Supabase Auth did not return a user.'
    );
  }

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
        data.user.id
      )
      .maybeSingle();

  if (profileError) {
    console.error(
      'STAFF PROFILE LOAD ERROR:',
      profileError
    );

    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore cleanup errors.
    }

    throw cleanErr(
      profileError,
      'Unable to load the staff profile.'
    );
  }

  if (!profile) {
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore cleanup errors.
    }

    throw new Error(
      'This account has not been provisioned as a SHELF staff account.'
    );
  }

  if (
    profile.is_active !== true
  ) {
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore cleanup errors.
    }

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
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore cleanup errors.
    }

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
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore cleanup errors.
    }

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
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore cleanup errors.
    }

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
  const {
    data,
    error,
  } = await supabase.rpc(
    'toggle_attendance',
    {
      p_qr:
        String(
          qrCode || ''
        ).trim(),

      p_library_id:
        libraryId,
    }
  );

  if (error) {
    throw cleanErr(error);
  }

  const row =
    Array.isArray(data)
      ? data[0]
      : data;

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
// BOOK INVENTORY
// ============================================================================

export async function addBook(
  book
) {
  const totalCopies =
    Math.max(
      1,
      Number(
        book.totalCopies
      ) || 1
    );

  const {
    data,
    error,
  } =
    await supabase
      .from('books')
      .insert({
        title:
          String(
            book.title || ''
          ).trim(),

        author:
          String(
            book.author || ''
          ).trim(),

        category:
          String(
            book.category || ''
          ).trim() ||
          'General',

        isbn:
          String(
            book.isbn || ''
          ).trim(),

        shelf_location:
          String(
            book.shelfLocation || ''
          ).trim(),

        library_id:
          book.libraryId,

        total_copies:
          totalCopies,

        available_copies:
          totalCopies,

        summary:
          String(
            book.summary || ''
          ).trim(),

        cover_url:
          String(
            book.coverUrl || ''
          ).trim() ||
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
            Object.entries(book).map(
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
          String(
            normalized.title || ''
          ).trim();

        const author =
          String(
            normalized.author || ''
          ).trim();

        const isbn =
          String(
            normalized.isbn || ''
          ).trim();

        const category =
          String(
            normalized.category || ''
          ).trim();

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

        return {
          library_id:
            String(
              normalized.library_id ||
                ''
            ).trim() || null,

          title,

          author,

          isbn,

          category,

          total_copies:
            stock,

          available_copies:
            stock,

          shelf_location:
            String(
              normalized.shelf_location ||
                ''
            ).trim() || null,

          summary:
            String(
              normalized.summary ||
                ''
            ).trim() || null,

          cover_url:
            String(
              normalized.cover_url ||
                ''
            ).trim() || null,
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
  const dbPatch = {};

  if (
    patch.title !==
    undefined
  ) {
    dbPatch.title =
      patch.title;
  }

  if (
    patch.author !==
    undefined
  ) {
    dbPatch.author =
      patch.author;
  }

  if (
    patch.category !==
    undefined
  ) {
    dbPatch.category =
      patch.category;
  }

  if (
    patch.isbn !==
    undefined
  ) {
    dbPatch.isbn =
      patch.isbn;
  }

  if (
    patch.shelfLocation !==
    undefined
  ) {
    dbPatch.shelf_location =
      patch.shelfLocation;
  }

  if (
    patch.libraryId !==
    undefined
  ) {
    dbPatch.library_id =
      patch.libraryId;
  }

  if (
    patch.totalCopies !==
    undefined
  ) {
    dbPatch.total_copies =
      patch.totalCopies;
  }

  if (
    patch.availableCopies !==
    undefined
  ) {
    dbPatch.available_copies =
      patch.availableCopies;
  }

  if (
    patch.summary !==
    undefined
  ) {
    dbPatch.summary =
      patch.summary;
  }

  if (
    patch.coverUrl !==
    undefined
  ) {
    dbPatch.cover_url =
      patch.coverUrl;
  }

  const {
    error,
  } =
    await supabase
      .from('books')
      .update(dbPatch)
      .eq(
        'id',
        bookId
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
  const {
    error,
  } =
    await supabase
      .from('books')
      .delete()
      .eq(
        'id',
        bookId
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
  if (!libraryId) {
    throw new Error(
      'A library must be selected before loading books.'
    );
  }

  const categories = [
    'computer+science',
    'engineering',
    'mathematics',
    'physics',
    'history',
  ];

  let allBooks = [];

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

            return {
              title:
                doc.title ||
                'Untitled',

              author:
                doc.author_name?.[0] ||
                'Unknown Author',

              category:
                cat
                  .replace(
                    '+',
                    ' '
                  )
                  .toUpperCase(),

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
                libraryId,

              total_copies:
                copies,

              available_copies:
                copies,

              summary:
                doc.first_sentence?.[0] ||
                `An authoritative academic resource focusing on ${cat.replace(
                  '+',
                  ' '
                )}, providing comprehensive theoretical frameworks, practical methodologies, and foundational insights for higher education students and researchers within the university network.`,

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
    allBooks.length > 0
  ) {
    const {
      error,
    } =
      await supabase
        .from('books')
        .insert(
          allBooks
        );

    if (error) {
      throw cleanErr(error);
    }
  }
}

// ============================================================================
// BORROW REQUESTS
// ============================================================================

export async function requestBorrow(
  visitorId,
  bookId
) {
  const {
    data,
    error,
  } =
    await supabase.rpc(
      'request_borrow',
      {
        p_visitor_id:
          visitorId,

        p_book_id:
          bookId,
      }
    );

  if (error) {
    throw cleanErr(error);
  }

  const row =
    Array.isArray(data)
      ? data[0]
      : data;

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
  const {
    error,
  } =
    await supabase.rpc(
      'cancel_borrow_request',
      {
        p_request_id:
          requestId,

        p_reason:
          reason,
      }
    );

  if (error) {
    throw cleanErr(error);
  }
}

// ============================================================================
// CONFIRM PICKUP
// ============================================================================

export async function confirmPickup(
  requestId,
  staffName
) {
  const {
    error,
  } =
    await supabase.rpc(
      'confirm_pickup',
      {
        p_request_id:
          requestId,

        p_staff_name:
          staffName,
      }
    );

  if (error) {
    throw cleanErr(error);
  }
}

// ============================================================================
// CONFIRM RETURN
// ============================================================================

export async function confirmReturn(
  requestId,
  staffName
) {
  const {
    error,
  } =
    await supabase.rpc(
      'confirm_return',
      {
        p_request_id:
          requestId,

        p_staff_name:
          staffName,
      }
    );

  if (error) {
    throw cleanErr(error);
  }
}
