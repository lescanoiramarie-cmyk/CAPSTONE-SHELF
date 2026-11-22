// ============================================================================
// SHELF ILMS — data & business-logic layer (Supabase-backed)
// ----------------------------------------------------------------------------
// Data modules in this directory own Supabase access. Components and contexts
// call the data layer and never import the Supabase client directly.
//
// Authentication:
//   Visitors      →’ Supabase Auth + visitors.auth_user_id
//   Staff/Admin   →’ Supabase Auth + staff_profiles
//
// Business rules that must be atomic are handled by PostgreSQL RPC functions.
// ============================================================================

import { supabase } from '../lib/supabaseClient.js';
import { normalizeVisitorRegistrationType, VISITOR_REGISTRATION_TYPES } from '../lib/visitorRegistration.js';
import { normalizeBookCategory } from '../lib/bookCategory.js';
import { normalizeCallNumber } from '../lib/callNumber.js';
import { isValidBorrowRequestId } from '../lib/borrowRequestId.js';
import { buildCancelBorrowRequestArgs } from '../lib/borrowRequestRpc.js';
import {
  buildDuplicateBookImportUpdate,
  normalizeBookFineRate,
  normalizeLendingPeriodDays,
  validateImportedBookFineRates,
} from '../lib/bookFineRate.js';
import { invalidateVisitorAccountsCache } from './visitorAccounts.js';
export { fetchVisitorAccounts } from './visitorAccounts.js';

// ============================================================================
// COMPATIBILITY CREDENTIAL LISTS (REMOVED - no production credentials in source)
// ============================================================================
// These were removed to prevent credential exposure. Use test fixtures in
// isolated staging environments instead.
export const SUPER_ADMIN_CREDENTIALS = [];
export const SUB_ADMIN_CREDENTIALS = [];

// ============================================================================
// TUNABLE BUSINESS RULES
// ============================================================================

export const PICKUP_WINDOW_HOURS = 24;
export const BORROW_PERIOD_DAYS = 7;
export const FINE_PER_DAY = 10;

export const DEFAULT_COVER_URL =
  'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&q=80&w=400';

const LIBRARIES_CACHE_TTL_MS = 60_000;
let librariesCache = null;
let librariesCacheExpiresAt = 0;
let librariesRequest = null;

function invalidateLibrariesCache() {
  librariesCache = null;
  librariesCacheExpiresAt = 0;
  librariesRequest = null;
}

function invalidatePopularBorrowCountsCache() {
  popularBorrowCountsCache = null;
  popularBorrowCountsCacheExpiresAt = 0;
  popularBorrowCountsPromise = null;
}

export function invalidateClientCaches() {
  invalidateLibrariesCache();
  invalidatePopularBorrowCountsCache();
  invalidateVisitorAccountsCache();
}

// ============================================================================
// PERSONAL BOOK RULES
// ============================================================================

export const PERSONAL_BOOK_CONDITIONS = [
  'New',
  'Like New',
  'Good',
  'Fair',
  'Poor',
];

export const PERSONAL_BOOK_MIN_LENDING_DAYS = 1;
export const PERSONAL_BOOK_MAX_LENDING_DAYS = 30;

export const PERSONAL_BOOK_HANDOVER_METHODS = [
  'meet_in_person',
  'public_place',
  'courier',
  'arrange_with_owner',
];

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

const isValidVisitorId = (value) =>
  Boolean(normalizeText(value));

const VISITOR_PROFILE_COLUMNS =
  'id, full_name, contact_number, email, address, profile_image_path, otp_verified, qr_code, registered_at, library_id, registration_type, approval_status, is_active';
const LEGACY_VISITOR_PROFILE_COLUMNS =
  'id, full_name, contact_number, email, address, otp_verified, qr_code, registered_at, library_id, registration_type, approval_status, is_active';

function isMissingVisitorProfileImageColumn(error) {
  const message = normalizeText(error?.message || error);
  return (
    (error?.code === '42703' || /column .* does not exist/i.test(message)) &&
    /visitors\.profile_image_path|profile_image_path/i.test(message)
  );
}

function warnVisitorProfileMigrationRequired() {
  console.warn(
    'SHELF visitor profile photos are unavailable because profile_image_path is missing. Apply migration 20261212000000_visitor_profile_images_and_self_update.sql.'
  );
}

const isValidShelfQr = (value) =>
  /^SHELF-QR-(?:[0-9]{6}|[0-9A-F]{32})$/i.test(
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
// PASSWORD POLICY
//
// Must match both VisitorLogin.jsx and the request-password-reset edge function
// so a password accepted at reset could not have been rejected at registration,
// and the reverse.
// ============================================================================

const PASSWORD_MIN_LENGTH = 12;

const PASSWORD_REQUIREMENT_MESSAGE =
  'Password must be at least 12 characters and include an uppercase letter, a lowercase letter, a number and a symbol.';

function isPasswordValid(
  value
) {
  const password =
    asString(value);

  return (
    password.length >=
      PASSWORD_MIN_LENGTH &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

// ============================================================================
// ROW →’ CAMELCASE MAPPERS
// ============================================================================

const mapLibrary = (r) => ({
  id: r.id,
  name: r.name,
  campus: r.campus,
  emailDomain: r.email_domain ?? null,
  visitorAccessMode: r.visitor_access_mode || 'institutional',
  address: r.address,
  lat: r.lat,
  lng: r.lng,
  hours: r.hours,
  status: r.status,
  isSampleLocation: r.is_sample_location,
});

export const mapBook = (r) => ({
  id: r.id,
  title: r.title,
  author: r.author,
  category: r.category ?? null,
  fineRate: r.fine_rate == null ? null : Number(r.fine_rate),
  isbn: r.isbn,
  callNumber: r.call_number ?? null,
  shelfLocation: r.shelf_location,
  libraryId: r.library_id,
  totalCopies: r.total_copies,
  availableCopies: r.available_copies,
  summary: r.summary,
  coverUrl:
    r.cover_url === DEFAULT_COVER_URL
      ? null
      : r.cover_url,
  createdAt: r.created_at,
  updatedAt: r.updated_at,

  bookType:
    r.book_type || 'library',

  isPublic:
    r.is_public === true,

  ownerVisitorId:
    r.owner_visitor_id || null,

  lendingEnabled:
    r.lending_enabled ?? false,

  condition:
    r.condition || null,

  lendingPeriodDays:
    r.lending_period_days ?? 7,

  handoverMethod:
    r.handover_method || null,

  handoverDetails:
    r.handover_details || null,

  handoverLocation:
    r.handover_location || null,
});

const mapVisitor = (r) => ({
  id: r.id,
  fullName: r.full_name,
  contactNumber: r.contact_number,
  email: r.email,
  address: r.address,
  profileImagePath: r.profile_image_path || null,
  libraryId: r.library_id ?? null,
  otpVerified: r.otp_verified,
  qrCode: r.qr_code,
  registeredAt: r.registered_at,
  registrationType: r.registration_type || 'institutional',
  approvalStatus: r.approval_status || 'approved',
  isActive: r.is_active,
  communityApprovalPending: r.registration_type === 'community' && r.approval_status === 'pending',
});

export const isFineReviewRequired = () => {
  // Legacy flags remain in the database for compatibility, but they no longer
  // create a manual review state in visitor-facing flows.
  return false;
};

const cleanTestVisitorName = (name) =>
  typeof name === 'string' ? name.replace(/^\[TEST\]\s*/i, '').trim() : name;

export const mapBorrowRequest = (r) => ({
  id: r.id,
  bookId: r.book_id,
  bookTitle: r.book_title,
  libraryId: r.library_id ?? null,
  visitorId: r.visitor_id,
  visitorName: cleanTestVisitorName(r.visitor_name),
  isTestData: /^\[TEST\]\s*/i.test(String(r.visitor_name || ''))
    || r.confirmed_by === 'Test data seed'
    || r.return_confirmed_by === 'Test data seed',
  status: r.status,
  requestDate: r.request_date,
  pickupDeadline: r.pickup_deadline,
  scheduledPickupDate: r.scheduled_pickup_date || null,
  queuePosition: r.queue_position,
  borrowDate: r.borrow_date,
  dueDate: r.due_date,
  returnDate: r.return_date,
  fineAmount: r.fine_amount,
  finePaidAmount: Number(r.fine_paid_amount || 0),
  fineRateSnapshot:
    r.fine_rate_snapshot == null ? null : Number(r.fine_rate_snapshot),
  fineReviewRequired: false,
  fineReviewResolvedAt: r.fine_review_resolved_at || null,
  confirmedBy: r.confirmed_by,
  returnConfirmedBy: r.return_confirmed_by,
  cancelReason: r.cancel_reason,
});

const mapAttendance = (r) => ({
  id: r.id,
  visitorId: r.visitor_id,
  visitorName: cleanTestVisitorName(r.visitor_name),
  isTestData: /^\[TEST\]\s*/i.test(String(r.visitor_name || '')),
  libraryId: r.library_id,
  timeIn: r.time_in,
  checkedOutAt: r.checked_out_at,
});

const FETCH_PAGE_SIZE = 1000;
const FETCH_PAGE_BATCH_SIZE = 2;
const authenticatedDataScopeRequests = new Map();

async function getAuthenticatedDataScope() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw cleanErr(sessionError, 'Unable to resolve the current user session.');
  }

  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) return { type: 'anonymous' };

  let request = authenticatedDataScopeRequests.get(accessToken);
  if (!request) {
    request = (async () => {
      const { data: roleData, error: roleError } = await supabase.rpc('get_current_user_role');

      if (roleError) {
        throw cleanErr(roleError, 'Unable to resolve the current user role.');
      }

      if (!roleData || roleData.length === 0) {
        return { type: 'anonymous' };
      }

      const roleInfo = roleData[0];
      const userType = roleInfo.user_type;
      const role = roleInfo.role;
      const libraryId = roleInfo.library_id;
      const visitorId = roleInfo.visitor_id;
      const isActive = roleInfo.is_active;

      if (!isActive) {
        return { type: 'anonymous' };
      }

      if (userType === 'superadmin' || userType === 'subadmin') {
        return {
          type: role === 'superadmin' ? 'superadmin' : 'subadmin',
          libraryId,
        };
      }

      if (userType === 'visitor') {
        return { type: 'visitor', visitorId };
      }

      return { type: 'anonymous' };
    })();
    authenticatedDataScopeRequests.set(accessToken, request);
  }

  try {
    return await request;
  } finally {
    if (authenticatedDataScopeRequests.get(accessToken) === request) {
      authenticatedDataScopeRequests.delete(accessToken);
    }
  }
}

async function fetchAllRowsInPages(buildQuery, resourceName) {
  const rows = [];

  for (
    let batchOffset = 0;
    ;
    batchOffset += FETCH_PAGE_SIZE * FETCH_PAGE_BATCH_SIZE
  ) {
    const pages = await Promise.all(
      Array.from({ length: FETCH_PAGE_BATCH_SIZE }, (_, pageIndex) => {
        const from = batchOffset + pageIndex * FETCH_PAGE_SIZE;
        return buildQuery().range(from, from + FETCH_PAGE_SIZE - 1);
      })
    );

    for (const page of pages) {
      if (page.error) {
        throw cleanErr(
          page.error,
          `Unable to fetch all ${resourceName}.`
        );
      }
      rows.push(...(page.data || []));
    }

    if (pages.some((page) => (page.data || []).length < FETCH_PAGE_SIZE)) {
      return rows;
    }
  }
}

async function getBorrowRequestsForSession(loadRows) {
  const rows = await loadRows();
  return rows.map(mapBorrowRequest);
}

const BORROW_DASHBOARD_ACTIVE_STATUSES = [
  'pending',
  'queued',
  'ready_for_pickup',
  'borrowed',
];
// Include the historical demo range (January 2024 onward) for year/month
// selectors in staff analytics, while retaining the active status rows.
const BORROW_DASHBOARD_RECENT_DAYS = 1200;

async function fetchStaffBorrowRequestRows(authenticatedUserId, signal) {
  // Use the new secure RPC for staff borrowing history
  // which handles AAL2 enforcement, role validation, and branch scoping server-side.
  const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) {
    throw cleanErr(assuranceError, 'Unable to verify staff sign-in security level.');
  }
  if (assurance?.currentLevel !== 'aal2') {
    throw new Error('AAL2 authentication is required. Complete the staff two-step sign-in, then retry.');
  }

  const { data, error } = await supabase.rpc('get_staff_borrowing_history', {
    p_recent_days: BORROW_DASHBOARD_RECENT_DAYS,
    p_active_statuses: BORROW_DASHBOARD_ACTIVE_STATUSES,
  });

  if (signal?.aborted) {
    const abortError = new Error('Request aborted');
    abortError.name = 'AbortError';
    throw abortError;
  }

  if (error) {
    throw cleanErr(error, 'Unable to load staff borrowing history.');
  }

  return data || [];
}

// ============================================================================
// FETCH LIBRARIES
// ============================================================================

export async function fetchLibraries() {
  if (librariesCache && librariesCacheExpiresAt > Date.now()) {
    return librariesCache.map((library) => ({ ...library }));
  }

  if (!librariesRequest) {
    librariesRequest = (async () => {
      const {
        data,
        error,
      } = await supabase
        .from('libraries')
        .select('*')
        .order('name', {
          ascending: true,
        });

      if (error) {
        throw cleanErr(error);
      }

      librariesCache = (data || []).map(mapLibrary);
      librariesCacheExpiresAt = Date.now() + LIBRARIES_CACHE_TTL_MS;
      return librariesCache;
    })();
  }

  try {
    const libraryList = await librariesRequest;
    return libraryList.map((library) => ({ ...library }));
  } finally {
    librariesRequest = null;
  }
}

// ============================================================================
// ADD LIBRARY
// ============================================================================

export async function addLibrary(library) {
  const suppliedId =
    normalizeText(library?.id);

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

  const {
    data,
    error,
  } = await supabase
    .from('libraries')
    .insert({
      id,
      name,
      email_domain: normalizeText(
        library?.email_domain ?? library?.emailDomain
      )
        .toLowerCase()
        .replace(/^@+/, '')
        .replace(/\.+$/, '') || null,
      visitor_access_mode: library?.visitor_access_mode ?? library?.visitorAccessMode ?? 'institutional',
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

  invalidateLibrariesCache();
  return mapLibrary(data);
}


/**
 * Update an existing library.
 */
export async function updateLibrary(libraryId, library) {
  const id = normalizeText(libraryId);

  if (!id || !isValidUuid(id)) {
    throw new Error('A valid library ID is required.');
  }

  const name = normalizeText(library?.name);

  if (!name) {
    throw new Error('Library name is required.');
  }

  const emailDomain = normalizeText(
    library?.email_domain ?? library?.emailDomain
  );

  const { data, error } = await supabase
    .from('libraries')
    .update({
      name,
      campus: normalizeText(library?.campus) || null,
      address: normalizeText(library?.address) || null,
      lat: Number.isFinite(Number(library?.lat))
        ? Number(library.lat)
        : null,
      lng: Number.isFinite(Number(library?.lng))
        ? Number(library.lng)
        : null,
      hours: normalizeText(library?.hours) || null,
      status: normalizeText(library?.status) || 'Open',
      email_domain: emailDomain
        ? emailDomain.toLowerCase()
        : null,
      visitor_access_mode: library?.visitor_access_mode ?? library?.visitorAccessMode ?? 'institutional',
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw cleanErr(error);
  }

  invalidateLibrariesCache();
  return mapLibrary(data);
}

/**
 * Delete a library by its UUID.
 */
export async function deleteLibrary(libraryId) {
  const id = normalizeText(libraryId);

  if (!id || !isValidUuid(id)) {
    throw new Error('A valid library ID is required.');
  }

  const { data, error } = await supabase
    .from('libraries')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    throw cleanErr(error);
  }

  if (!data) {
    throw new Error(
      'Library not found or you do not have permission to delete it.'
    );
  }

  invalidateLibrariesCache();
  return data.id;
}


// ============================================================================
// FETCH ALL BOOKS
// ============================================================================

export async function fetchBooks() {
  const pageSize = 1000;
  const data = [];
  let offset = 0;
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 3;

  while (true) {
    const { data: page, error } = await supabase
      .from('books')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      consecutiveErrors++;
      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw cleanErr(error);
      }
      // Brief delay before retry
      await new Promise((resolve) => setTimeout(resolve, 100 * consecutiveErrors));
      continue;
    }

    consecutiveErrors = 0;
    data.push(...(page || []));
    if (!page || page.length < pageSize) break;
    offset += pageSize;
  }

  return data.map(mapBook);
}

// ============================================================================
// FETCH BOOK COUNTS VIA RPC (exact, server-side)
// ============================================================================

export async function fetchOpacLibraryBookCount() {
  const { data, error } = await supabase.rpc('get_opac_library_book_count');
  if (error) throw cleanErr(error);
  return Number(data ?? 0);
}

export async function fetchOpacTotalBookCount() {
  const { data, error } = await supabase.rpc('get_opac_total_book_count');
  if (error) throw cleanErr(error);
  return Number(data ?? 0);
}

export async function fetchOpacLibraryBookCountByLibrary(libraryId) {
  if (!libraryId) return 0;
  const { data, error } = await supabase.rpc('get_opac_library_book_count_by_library', {
    p_library_id: libraryId,
  });
  if (error) throw cleanErr(error);
  return Number(data ?? 0);
}

export async function fetchOpacFilteredBookCount({
  search = '',
  category = 'All',
  libraryId = null,
  availability = 'All',
} = {}) {
  const { data, error } = await supabase.rpc('get_opac_filtered_book_count', {
    p_search: search,
    p_category: category,
    p_library_id: libraryId,
    p_availability: availability,
  });
  if (error) throw cleanErr(error);
  return Number(data ?? 0);
}

export async function fetchOpacCategoryBookCounts(libraryId = null) {
  const { data, error } = await supabase.rpc('get_opac_category_book_counts', {
    p_library_id: libraryId,
  });
  if (error) throw cleanErr(error);
  return (data || []).map((row) => ({
    label: row.category,
    count: Number(row.book_count) || 0,
  }));
}

const POPULAR_BORROW_COUNTS_CACHE_MS = 60_000;
let popularBorrowCountsCache = null;
let popularBorrowCountsCacheExpiresAt = 0;
let popularBorrowCountsPromise = null;

export async function fetchPopularBorrowedBookCounts(limit = 40) {
  const normalizedLimit = Math.min(
    100,
    Math.max(1, Math.trunc(Number(limit) || 40))
  );

  if (
    popularBorrowCountsCache &&
    popularBorrowCountsCacheExpiresAt > Date.now() &&
    popularBorrowCountsCache.length >= normalizedLimit
  ) {
    return popularBorrowCountsCache.slice(0, normalizedLimit).map((item) => ({ ...item }));
  }

  if (!popularBorrowCountsPromise) {
    popularBorrowCountsPromise = (async () => {
      const { data, error } = await supabase.rpc(
        'get_popular_borrowed_book_counts',
        { p_limit: 100 }
      );

      if (error) throw cleanErr(error);

      popularBorrowCountsCache = (data || []).map((row) => ({
        book_id: String(row.book_id),
        borrow_count: Number(row.borrow_count) || 0,
      }));
      popularBorrowCountsCacheExpiresAt = Date.now() + POPULAR_BORROW_COUNTS_CACHE_MS;
      return popularBorrowCountsCache;
    })();
  }

  try {
    const counts = await popularBorrowCountsPromise;
    return counts.slice(0, normalizedLimit).map((item) => ({ ...item }));
  } finally {
    popularBorrowCountsPromise = null;
  }
}

// ============================================================================
// FETCH PERSONAL BOOKS OWNED BY A VISITOR
// ============================================================================

export async function fetchPersonalBooks(
  visitorId
) {
  const normalizedVisitorId =
    normalizeText(visitorId);

  if (!normalizedVisitorId) {
    return [];
  }

  if (!isValidVisitorId(normalizedVisitorId)) {
    throw new Error(
      'Invalid visitor ID.'
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from('books')
    .select('*')
    .eq(
      'book_type',
      'personal'
    )
    .eq(
      'owner_visitor_id',
      normalizedVisitorId
    )
    .order('created_at', {
      ascending: false,
    });

  if (error) {
    throw cleanErr(
      error,
      'Unable to load your personal books.'
    );
  }

  return (data || []).map(mapBook);
}

// ============================================================================
// FETCH COMMUNITY BOOKS
// ============================================================================

export async function fetchCommunityBooks() {
  const {
    data,
    error,
  } = await supabase
    .from('books')
    .select('*')
    .eq(
      'book_type',
      'personal'
    )
    .eq(
      'is_public',
      true
    )
    .order('created_at', {
      ascending: false,
    });

  if (error) {
    throw cleanErr(
      error,
      'Unable to load community books.'
    );
  }

  return (data || []).map(mapBook);
}

// ============================================================================
// COMMUNITY BOOKS - READ LATER / SAVED BOOKS
// ============================================================================

export async function saveCommunityBookForLater(communityBookId) {
  const { data, error } = await supabase.rpc('save_community_book_for_later', {
    p_community_book_id: communityBookId,
  });

  if (error) {
    throw cleanErr(error, 'Unable to save book for later.');
  }

  const result = (data || [])[0];
  return { success: result?.success === true, message: result?.message || '' };
}

export async function unsaveCommunityBookForLater(communityBookId) {
  const { data, error } = await supabase.rpc('unsave_community_book_for_later', {
    p_community_book_id: communityBookId,
  });

  if (error) {
    throw cleanErr(error, 'Unable to remove book from saved list.');
  }

  const result = (data || [])[0];
  return { success: result?.success === true, message: result?.message || '' };
}

export async function getSavedCommunityBooks() {
  const { data, error } = await supabase.rpc('get_saved_community_books');

  if (error) {
    throw cleanErr(error, 'Unable to load saved community books.');
  }

  return data || [];
}

// ============================================================================
// FETCH VISITORS
// ============================================================================

export async function fetchVisitors(visitorId = null, knownVisitor = null) {
  const normalizedVisitorId = normalizeText(visitorId);

  // When a specific visitorId is provided (staff looking up a visitor),
  // continue using direct table access with proper RLS/grants.
  if (normalizedVisitorId) {
    if (
      knownVisitor?.id &&
      normalizeText(knownVisitor.id) === normalizedVisitorId
    ) {
      return [knownVisitor];
    }

    let { data, error } = await supabase
      .from('visitors')
      .select(VISITOR_PROFILE_COLUMNS)
      .eq('id', normalizedVisitorId)
      .maybeSingle();

    if (isMissingVisitorProfileImageColumn(error)) {
      warnVisitorProfileMigrationRequired();
      ({ data, error } = await supabase
        .from('visitors')
        .select(LEGACY_VISITOR_PROFILE_COLUMNS)
        .eq('id', normalizedVisitorId)
        .maybeSingle());
    }

    if (error) throw cleanErr(error, 'Unable to fetch the visitor profile.');

    return data ? [mapVisitor(data)] : [];
  }

  // No specific visitorId: return current user's own profile (visitor)
  // or list of visitors (staff) using RPC for current visitor profile.
  const scope = await getAuthenticatedDataScope();
  if (scope.type === 'anonymous') return [];

  // Visitor fetching their own profile - use RPC
  if (scope.type === 'visitor') {
    const { data, error } = await supabase.rpc('get_visitor_profile');
    if (error) throw cleanErr(error, 'Unable to fetch your visitor profile.');
    return data ? [mapVisitor(data[0])] : [];
  }

  // Staff fetching list of visitors - continue using direct table access
  // with RLS scoping (subadmin limited to their branch)
  const buildQuery = (columns) => {
      let query = supabase
        .from('visitors')
        .select(columns)
        .order('registered_at', { ascending: false })
        .order('id', { ascending: true });

      if (scope.type === 'subadmin') {
        query = query.eq('library_id', scope.libraryId);
      }

      return query;
    };
  let data;
  try {
    data = await fetchAllRowsInPages(
      () => buildQuery(VISITOR_PROFILE_COLUMNS),
      'visitor profiles'
    );
  } catch (error) {
    if (!isMissingVisitorProfileImageColumn(error)) throw error;
    warnVisitorProfileMigrationRequired();
    data = await fetchAllRowsInPages(
      () => buildQuery(LEGACY_VISITOR_PROFILE_COLUMNS),
      'visitor profiles'
    );
  }

  return data.map(mapVisitor);
}

export async function fetchVisitorCount() {
  const scope = await getAuthenticatedDataScope();
  if (scope.type === 'anonymous') return 0;

  let query = supabase
    .from('visitors')
    .select('id', { count: 'exact', head: true });

  if (scope.type === 'subadmin') {
    if (!scope.libraryId) {
      throw new Error('Your staff account has no assigned library branch.');
    }
    query = query.eq('library_id', scope.libraryId);
  } else if (scope.type === 'visitor') {
    query = query.eq('id', scope.visitorId);
  }

  const { count, error } = await query;
  if (error) throw cleanErr(error, 'Unable to count registered visitors.');
  return Number(count) || 0;
}

// ============================================================================
// FETCH ALL REQUESTS AND BORROWS
// ----------------------------------------------------------------------------
// Includes:
//   1. Normal library borrow requests
//   2. Community/personal book requests
//
// Both are normalized into the same request structure so the OPAC
// "My Requests & Borrows" section can display them together.
//
// IMPORTANT:
// Community requests are stored in community_book_requests, NOT
// borrow_requests.
//
// This function:
//   - Gets the current visitor from the SHELF local session.
//   - Loads normal library borrow requests.
//   - Optionally loads community requests through the PostgreSQL RPC.
//   - Normalizes the loaded request types into one structure.
//   - Removes duplicates.
//   - Sorts newest requests first.
// ============================================================================

export async function fetchBorrowRequests({
  includeCommunityRequests = true,
  visitorId = null,
  signal,
  skipVisitorResolution = false,
} = {}) {
  // ==========================================================================
  // 1. READ LOCAL SHELF SESSION
  // ==========================================================================

  let localSession = null;

  try {
    const rawSession =
      globalThis.localStorage?.getItem(
        'shelf_ilms_session_v1'
      );

    if (rawSession) {
      localSession = JSON.parse(
        rawSession
      );
    }
  } catch {
    console.error('SHELF — unable to read local session:');
  }

  // ==========================================================================
  // 2. RESOLVE THE ACTUAL VISITOR ID
  // ==========================================================================
  //
  // IMPORTANT:
  //
  // Supabase Auth ID:
  //     auth.users.id
  //
  // SHELF visitor ID:
  //     public.visitors.id
  //
  // Community requests use:
  //     requester_visitor_id
  //
  // Therefore we MUST use visitors.id.
  // ==========================================================================

  let normalizedVisitorId =
    normalizeText(visitorId) || null;
  let authenticatedUserId;

  // ------------------------------------------------------------------------
  // 2A. FIRST: TRY SUPABASE AUTH
  // ------------------------------------------------------------------------

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

  const authUserId =
    sessionData?.session?.user?.id ||
    null;
  authenticatedUserId = authUserId;

  // ------------------------------------------------------------------------
  // 2B. RESOLVE AUTH USER →’ SHELF VISITOR
  // ------------------------------------------------------------------------

  if (
    !skipVisitorResolution &&
    !normalizedVisitorId &&
    authUserId &&
    isValidUuid(authUserId)
  ) {
    const visitor =
      await getVisitor(
        authUserId
      );

    if (
      visitor?.id &&
      isValidVisitorId(
        normalizeText(
          visitor.id
        )
      )
    ) {
      normalizedVisitorId =
        normalizeText(
          visitor.id
        );

      // Visitor identity resolved from the authenticated session. Avoid
      // logging identifiers to prevent PII leakage in client logs.
    }
  }

  // ------------------------------------------------------------------------
  // 2C. FALLBACK: LOCAL SHELF SESSION
  // ------------------------------------------------------------------------
  //
  // Local visitor sessions normally store the SHELF visitor ID.
  // ========================================================================

  if (
    !skipVisitorResolution &&
    !normalizedVisitorId
  ) {
    const localVisitorId =
      localSession?.role &&
      localSession.role !== 'visitor'
        ? null
        : localSession?.visitor?.id ||
          localSession?.visitor?.visitorId ||
          localSession?.user?.visitorId ||
          localSession?.user?.visitor_id ||
          localSession?.user?.id ||
          localSession?.id ||
          null;

    if (
      localVisitorId &&
      isValidVisitorId(
        normalizeText(
          localVisitorId
        )
      )
    ) {
      normalizedVisitorId =
        normalizeText(
          localVisitorId
        );

      // Visitor identity resolved from local session; avoid logging IDs.
    }
  }

// ==========================================================================
  // 3. LOAD NORMAL LIBRARY BORROW REQUESTS
  // ==========================================================================

  let normalRequests;

  try {
    // ------------------------------------------------------------------------
    // AUTHENTICATED SESSION
    //
    // RLS on borrow_requests already scopes the result to the
    // visitor's own rows.
    // ------------------------------------------------------------------------

    if (authenticatedUserId) {
      if (
        normalizedVisitorId &&
        isValidVisitorId(normalizedVisitorId)
      ) {
        // Use the new secure RPC for visitor's own borrowing history
        // which handles authorization and scoping server-side.
        normalRequests = await getBorrowRequestsForSession(async () => {
          const { data, error } = await supabase.rpc('get_visitor_borrowing_history');
          if (signal) {
            // Note: RPC doesn't support abort signal directly, but we check after
            if (signal?.aborted) {
              const abortError = new Error('Request aborted');
              abortError.name = 'AbortError';
              throw abortError;
            }
          }
          if (error) {
            throw cleanErr(
              error,
              'Unable to load your borrowing history.'
            );
          }
          return data || [];
        });
      } else {
        if (skipVisitorResolution) {
          normalRequests = await getBorrowRequestsForSession(() =>
            fetchStaffBorrowRequestRows(authenticatedUserId, signal)
          );
        } else {
          throw new Error(
            'Unable to resolve the signed-in visitor profile. Borrowing history was not loaded.'
          );
        }
      }
    }

    // ------------------------------------------------------------------------
    // NO SUPABASE SESSION
    //
    // Visitors without an authenticated Supabase session have
    // no borrowing history to load.
    // ------------------------------------------------------------------------

    else {
      // No borrowing requests are loaded for anonymous pages.
    }

  } catch (normalError) {
    if (signal?.aborted || normalError?.name === 'AbortError') {
      throw normalError;
    }
    console.error('SHELF — NORMAL BORROW REQUESTS ERROR:');
    throw normalError;
  }

  const libraryBorrowRequests =
    Array.isArray(normalRequests)
      ? normalRequests
      : [];

  
  
  // ==========================================================================
  // 4. LOAD COMMUNITY BOOK REQUESTS
  // ==========================================================================

  let communityRequests = [];

  if (includeCommunityRequests) {
    try {
      // Kunin ang kasalukuyang Supabase Auth session.
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      // Huwag tawagin ang protected RPC kapag walang authenticated session.
      if (session?.user?.id && isValidVisitorId(normalizedVisitorId)) {
        const {
          data,
          error,
        } = await supabase.rpc(
          'fetch_my_community_book_requests',
          {
            p_requester_visitor_id: normalizedVisitorId,
          }
        );

        if (error) {
          console.error('SHELF — COMMUNITY REQUEST RPC ERROR:');
          throw cleanErr(
            error,
            'Unable to load your community book requests.'
          );
        } else {
          communityRequests = Array.isArray(data) ? data : [];
        }
      } else {
        // No community requests are loaded without an authenticated visitor session.
      }
    } catch (error) {
      console.error('Unable to load community book requests.');
      throw error;
    }
  }

  // ==========================================================================
  // 5. MAP COMMUNITY REQUESTS
  // ==========================================================================

  const mappedCommunityRequests =
    communityRequests
      .filter(
        (request) =>
          request &&
          request.id
      )
      .map(
        (request) => {

          const requestId =
            request.id;

          const bookId =
            request.book_id ||
            null;

          const bookTitle =
            request.book_title ||
            'Untitled Book';

          const requestDate =
            request.request_date ||
            null;

          const status =
            normalizeText(
              request.status
            ).toLowerCase() ||
            'pending';

          const requesterVisitorId =
            request.requester_visitor_id ||
            normalizedVisitorId ||
            null;

          const requesterName =
            request.requester_name ||
            localSession?.user?.fullName ||
            localSession?.user?.full_name ||
            localSession?.visitor?.fullName ||
            localSession?.visitor?.full_name ||
            'SHELF Visitor';

          const ownerVisitorId =
            request.owner_visitor_id ||
            null;

          const ownerName =
            request.owner_name ||
            null;

          const ownerResponse =
            request.owner_response ||
            null;

          const approvedAt =
            request.approved_at ||
            null;

          const rejectedAt =
            request.rejected_at ||
            null;

          return {
            id:
              requestId,

            bookId:
              bookId,

            bookTitle:
              bookTitle,

            visitorId:
              requesterVisitorId,

            visitorName:
              requesterName,

            status:
              status,

            requestDate:
              requestDate,

            pickupDeadline:
              request.pickup_deadline ||
              null,

            queuePosition:
              request.queue_position ??
              null,

            borrowDate:
              request.borrow_date ||
              null,

            dueDate:
              request.due_date ||
              null,

            returnDate:
              request.return_date ||
              null,

            fineAmount:
              Number(
                request.fine_amount ??
                0
              ) || 0,

            fineRateSnapshot:
              request.fine_rate_snapshot == null
                ? null
                : Number(request.fine_rate_snapshot),

            fineReviewRequired: false,

            confirmedBy:
              request.confirmed_by ||
              null,

            returnConfirmedBy:
              request.return_confirmed_by ||
              null,

            cancelReason:
              request.cancel_reason ||
              null,

            requestType:
              'community',

            isCommunityBook:
              true,

            ownerVisitorId:
              ownerVisitorId,

            ownerName:
              ownerName,

            ownerResponse:
              ownerResponse,

            approvedAt:
              approvedAt,

            rejectedAt:
              rejectedAt,

            lendingPeriodDays:
              request.lending_period_days ??
              null,
          };
        }
      );

  // ==========================================================================
  // 6. MAP NORMAL LIBRARY REQUESTS
  // ==========================================================================

  const mappedNormalRequests =
    libraryBorrowRequests
      .filter(
        (request) =>
          request &&
          request.id
      )
      .map(
        (request) => ({
          ...request,

          finePaidAmount:
            Number(request.fine_paid_amount ?? request.finePaidAmount ?? 0) || 0,

          requestType:
            'library',

          isCommunityBook:
            false,
        })
      );

  // ==========================================================================
  // 7. MERGE REQUESTS
  // ==========================================================================

  const mergedRequests = [
    ...mappedNormalRequests,
    ...mappedCommunityRequests,
  ];

  // ==========================================================================
  // 8. REMOVE DUPLICATES
  // ==========================================================================

  const uniqueRequests =
    Array.from(
      new Map(
        mergedRequests
          .filter(
            (request) =>
              request &&
              request.id
          )
          .map(
            (request) => [
              String(
                request.id
              ),
              request,
            ]
          )
      ).values()
    );

  // ==========================================================================
  // 9. SORT NEWEST FIRST
  // ==========================================================================

  uniqueRequests.sort(
    (a, b) =>
      new Date(
        b?.requestDate || 0
      ).getTime() -
      new Date(
        a?.requestDate || 0
      ).getTime()
  );

  return uniqueRequests;
}

// ============================================================================
// FETCH ATTENDANCE LOGS
// Server-side scoped RPCs enforce role, AAL2 (staff), ownership, and library
// isolation. Direct attendance_logs table reads are not used here.
// ============================================================================

export async function fetchAttendanceLogs() {
  const scope = await getAuthenticatedDataScope();
  if (scope.type === 'anonymous') return [];
  if (scope.type === 'subadmin' && !scope.libraryId) return [];

  const { data, error } = await supabase.rpc('get_attendance_logs_v1');
  if (error) {
    throw cleanErr(error, 'Unable to load attendance records.');
  }
  return (Array.isArray(data) ? data : []).map(mapAttendance);
}

export async function fetchAttendanceLogsPage({
  cursor = null,
  pageSize = 30,
  fromTime = null,
  beforeTime = null,
  libraryId = null,
} = {}) {
  const scope = await getAuthenticatedDataScope();
  if (scope.type !== 'visitor' || !scope.visitorId) {
    return { logs: [], nextCursor: null, hasMore: false, totalCount: 0 };
  }

  const safePageSize = Math.min(100, Math.max(1, Math.trunc(Number(pageSize) || 30)));
  const { data, error } = await supabase.rpc('get_visitor_attendance_logs_v1', {
    p_limit: safePageSize,
    p_cursor_time_in: cursor?.timeIn || null,
    p_cursor_id: cursor?.id || null,
    p_from_time: fromTime || null,
    p_before_time: beforeTime || null,
    p_library_id: libraryId ? String(libraryId) : null,
  });
  if (error) {
    throw cleanErr(error, 'Unable to load your attendance history.');
  }

  const rows = Array.isArray(data) ? data : [];
  const hasMore = rows.length > safePageSize;
  const pageRows = rows.slice(0, safePageSize);
  const lastRow = pageRows.at(-1);
  const totalCount = pageRows.length > 0 ? (pageRows[0].total_count ?? null) : (cursor ? null : 0);

  return {
    logs: pageRows.map(mapAttendance),
    nextCursor: hasMore && lastRow
      ? { timeIn: lastRow.time_in, id: lastRow.id }
      : null,
    hasMore,
    totalCount: cursor ? null : (totalCount == null ? null : Number(totalCount)),
  };
}

// ============================================================================
// GET VISITOR
// ============================================================================

export async function getVisitor(
  visitorId
) {
  const normalizedVisitorId =
    normalizeText(visitorId);

  if (!normalizedVisitorId) {
    return null;
  }

  if (!isValidVisitorId(normalizedVisitorId)) {
    throw new Error(
      'Invalid visitor ID.'
    );
  }

  const buildQuery = (columns) => {
    let query = supabase
    .from('visitors')
    .select(columns);

    query = isValidUuid(normalizedVisitorId)
      ? query.eq('auth_user_id', normalizedVisitorId)
      : query.eq('id', normalizedVisitorId);
    return query;
  };

  let { data, error } = await buildQuery(VISITOR_PROFILE_COLUMNS).maybeSingle();
  if (isMissingVisitorProfileImageColumn(error)) {
    warnVisitorProfileMigrationRequired();
    ({ data, error } = await buildQuery(LEGACY_VISITOR_PROFILE_COLUMNS).maybeSingle());
  }

  if (error) {
    throw cleanErr(error);
  }

  return data
    ? mapVisitor(data)
    : null;
}

export async function updateVisitorProfile({
  visitorId,
  contactNumber,
  profileImagePath,
}) {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const normalizedVisitorId = normalizeText(visitorId);
  const normalizedContactNumber = normalizeText(contactNumber);
  const normalizedProfileImagePath = normalizeText(profileImagePath);

  if (!normalizedVisitorId || !isValidVisitorId(normalizedVisitorId)) {
    throw new Error('Invalid visitor ID.');
  }
  if (normalizedContactNumber.length > 50) {
    throw new Error('Contact number must not exceed 50 characters.');
  }
  if (normalizedProfileImagePath.length > 2048) {
    throw new Error('Profile image path is too long.');
  }

  const {
    data: { user: authenticatedUser },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) {
    throw cleanErr(authError, 'Unable to verify your visitor account.');
  }
  if (!authenticatedUser?.id) {
    throw new Error('Sign in again before updating your profile.');
  }

  let { data, error } = await supabase
    .from('visitors')
    .update({
      contact_number: normalizedContactNumber || null,
      profile_image_path: normalizedProfileImagePath || null,
    })
    .eq('id', normalizedVisitorId)
    .eq('auth_user_id', authenticatedUser.id)
    .select(VISITOR_PROFILE_COLUMNS)
    .single();

  if (isMissingVisitorProfileImageColumn(error)) {
    if (normalizedProfileImagePath) {
      throw new Error(
        'Profile photo upload is not available until migration 20261212000000_visitor_profile_images_and_self_update.sql is applied.'
      );
    }
    warnVisitorProfileMigrationRequired();
    ({ data, error } = await supabase
      .from('visitors')
      .update({
        contact_number: normalizedContactNumber || null,
      })
      .eq('id', normalizedVisitorId)
      .eq('auth_user_id', authenticatedUser.id)
      .select(LEGACY_VISITOR_PROFILE_COLUMNS)
      .single());
  }

  if (error) {
    throw cleanErr(error, 'Unable to update your visitor profile.');
  }

  return mapVisitor(data);
}

export const resolveVisitorAuthUserId = async (
  visitorId
) => {
  const normalizedVisitorId =
    normalizeText(visitorId);

  if (!normalizedVisitorId) {
    throw new Error(
      'Visitor ID is required to resolve the authentication user ID.'
    );
  }

  const {
    data,
    error,
  } =
    await supabase
      .from('visitors')
      .select('auth_user_id')
      .eq('id', normalizedVisitorId)
      .maybeSingle();

  if (error) {
    throw cleanErr(
      error,
      'Unable to resolve the visitor authentication user ID.'
    );
  }

  const authUserId =
    normalizeText(data?.auth_user_id);

  if (!isValidUuid(authUserId)) {
    throw new Error(
      'The visitor profile does not have a valid authentication user ID.'
    );
  }

  return authUserId;
};

// ============================================================================
// VISITOR REGISTRATION
// ============================================================================

export async function registerVisitor({
  fullName,
  contactNumber,
  email,
  address,
  password,
  libraryId = null,
  registrationType = VISITOR_REGISTRATION_TYPES.INSTITUTIONAL,
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
  const normalizedRegistrationType = normalizeVisitorRegistrationType(registrationType);
  if (!normalizedRegistrationType) throw new Error('Select a valid visitor registration type.');

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

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('Please enter a valid email address.');
  }

  if (!/^09\d{9}$/.test(normalizedContactNumber)) {
    throw new Error('Contact number must be exactly 11 digits and start with 09.');
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

  if (!isPasswordValid(normalizedPassword)) {
    throw new Error(PASSWORD_REQUIREMENT_MESSAGE);
  }

  const normalizedLibraryId = normalizeText(libraryId) || null;
  if (!normalizedLibraryId || !isValidUuid(normalizedLibraryId)) {
    throw new Error('Select a valid preferred library.');
  }

  const registrationNonce =
    globalThis.crypto?.randomUUID?.();

  if (!registrationNonce) {
    throw new Error(
      'Secure visitor registration is unavailable in this browser.'
    );
  }

  const {
    data: authData,
    error: authError,
  } =
    await supabase.auth.signUp({
      email:
        normalizedEmail,
      password:
        normalizedPassword,
      options: {
        data: {
          role: 'visitor',
          registration_type: normalizedRegistrationType,
          library_id: normalizedLibraryId,
          full_name:
            normalizedFullName,
          contact_number:
            normalizedContactNumber,
          address:
            normalizedAddress,
          registration_nonce:
            registrationNonce,
        },
      },
    });

  if (authError) {
    console.error('SUPABASE AUTH REGISTRATION ERROR:');

    const message =
      normalizeText(
        authError?.message
      ).toLowerCase();

    if (
      message.includes(
        'already registered'
      ) ||
      message.includes(
        'already exists'
      ) ||
      message.includes(
        'user already registered'
      )
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

  if (!authData?.user?.id) {
    throw new Error(
      'Supabase Auth did not return a user account. Please try again.'
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

  const {
    data: registrationData,
    error: registrationError,
  } =
    await supabase.rpc(
      'register_visitor_v2',
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

        p_registration_nonce:
          registrationNonce,

        p_library_id:
          normalizedLibraryId,

        p_registration_type:
          normalizedRegistrationType,
      }
    );

  if (registrationError) {
    console.error('REGISTER VISITOR PROFILE ERROR:');

    await safeSignOut();

    throw cleanErr(
      registrationError,
      'The visitor authentication account was created, but the visitor profile could not be created.'
    );
  }

  const row =
    firstRow(registrationData);

  if (!row?.visitor_id) {
    await safeSignOut();

    throw new Error(
      'The visitor profile could not be created. Please try again.'
    );
  }

  const visitorId =
    normalizeText(
      row.visitor_id
    );

  if (!isValidVisitorId(visitorId)) {
    await safeSignOut();

    throw new Error(
      'The visitor profile returned an invalid ID.'
    );
  }

  invalidateVisitorAccountsCache();
  await safeSignOut();

  const {
    data: emailData,
    error: emailError,
  } =
    await supabase.functions.invoke(
      'send-visitor-otp',
      {
        body: {
          visitorId,
          registrationNonce,
        },
      }
    );

  const otpDeliveryError =
    await readFunctionError(
      emailError,
      emailData
    );

  // Ambiguous delivery outcomes (timeout/unknown provider state) fail closed on
  // the server and must not auto-abort registration; caller should wait/retry
  // through the secure resend/recovery flow.
  if (otpDeliveryError) {
    console.error('SEND VISITOR OTP ERROR:');

    const message = normalizeText(otpDeliveryError);
    const lower = message.toLowerCase();
    const ambiguous =
      lower.includes('could not be confirmed') ||
      lower.includes('please wait before trying again');

    if (!ambiguous) {
      await abortVisitorRegistration(
        visitorId,
        registrationNonce
      );
    }

    throw new Error(
      otpDeliveryError
    );
  }

  return {
    visitorId,
    registrationNonce,
    registrationType: normalizedRegistrationType,
    otpExpiresAt:
      normalizeText(emailData?.expiresAt) ||
      new Date(Date.now() + 2 * 60 * 1000).toISOString(),
  };
}

// ============================================================================
// ABORT VISITOR REGISTRATION
// ============================================================================

async function abortVisitorRegistration(
  visitorId,
  registrationNonce
) {
  try {
    const { error } =
      await supabase.rpc(
        'abort_visitor_registration',
        {
          p_visitor_id:
            visitorId,

          p_registration_nonce:
            registrationNonce,
        }
      );

    if (error) {
      console.error('ABORT VISITOR REGISTRATION ERROR:');
    }
  } catch {
    console.error('ABORT VISITOR REGISTRATION THREW:');
  }
}

// ============================================================================
// EDGE FUNCTION ERROR EXTRACTION
//
// supabase.functions.invoke returns non-2xx payloads through
// error.context. Read that response as well as successful data
// so the UI can show the edge function's actionable message.
// ============================================================================

async function readFunctionError(
  error,
  data
) {
  let responseData = data;
  if (
    !responseData &&
    typeof error?.context?.json === 'function'
  ) {
    try {
      responseData = await error.context.json();
    } catch {
      console.warn('Unable to read Edge Function error details:');
      responseData = null;
    }
  }

  const dataMessage =
    responseData &&
    typeof responseData === 'object' &&
    responseData.success === false
      ? normalizeText(
          responseData.error || responseData.message
        )
      : '';

  const errorMessage =
    normalizeText(
      error?.message
    );

  const combined =
    dataMessage ||
    errorMessage;

  if (!combined) {
    return null;
  }

  const lowerCombined =
    combined.toLowerCase();

  // Network/CORS failures surface as opaque messages that
  // would only confuse the visitor.
  if (
    lowerCombined.includes(
      'failed to fetch'
    ) ||
    lowerCombined.includes(
      'networkerror'
    ) ||
    lowerCombined.includes(
      'load failed'
    )
  ) {
    return (
      'We could not reach the verification email service. Please try again.'
    );
  }

  return combined;
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

  if (!isValidVisitorId(normalizedVisitorId)) {
    throw new Error(
      'Invalid visitor registration session.'
    );
  }

  const {
    data: capabilityData,
    error: capabilityError,
  } =
    await supabase.rpc(
      'issue_visitor_resend_capability',
      {
        p_visitor_id:
          normalizedVisitorId,
      }
    );

  if (capabilityError) {
    throw cleanErr(capabilityError);
  }

  const capabilityRow = firstRow(capabilityData);
  const capability = normalizeText(capabilityRow?.capability);
  if (!capability) {
    throw new Error(
      'Unable to request a new verification code right now.'
    );
  }

  const {
    data: emailData,
    error: emailError,
  } =
    await supabase.functions.invoke(
      'send-visitor-otp',
      {
        body: {
          capability,
        },
      }
    );

  const otpDeliveryError =
    await readFunctionError(
      emailError,
      emailData
    );

  if (otpDeliveryError) {
    throw new Error(
      otpDeliveryError
    );
  }

  return {
    success: true,
    expiresAt:
      normalizeText(emailData?.expiresAt) ||
      new Date(Date.now() + 2 * 60 * 1000).toISOString(),
  };
}

// ============================================================================
// RESEND OTP BY EMAIL
//
// Recovery path for visitors stranded by a failed registration,
// where no registration session is held in this browser.
// ============================================================================

export async function resendVisitorOtpByEmail(
  email
) {
  const normalizedEmail =
    normalizeEmail(email);

  if (!normalizedEmail) {
    throw new Error(
      'Please enter the email address you registered with.'
    );
  }

  const {
    data: emailData,
    error: emailError,
  } =
    await supabase.functions.invoke(
      'send-visitor-otp',
      {
        body: {
          email:
            normalizedEmail,
        },
      }
    );

  const otpDeliveryError =
    await readFunctionError(
      emailError,
      emailData
    );

  if (otpDeliveryError) {
    const message = normalizeText(otpDeliveryError);
    const lower = message.toLowerCase();
    if (
      lower.includes('could not reach') ||
      lower.includes('not configured')
    ) {
      throw new Error(message);
    }
  }

  return {
    success: true,
    visitorId: null,
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

  if (!isValidVisitorId(normalizedVisitorId)) {
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
  } =
    await supabase.rpc(
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

  // verify_visitor_otp returns expected failures as a result row with a null
  // id and a populated error column, rather than raising. Raising would abort
  // the transaction and roll back the attempt counter, leaving the 6-digit code
  // brute-forceable.
  const verificationError =
    normalizeText(
      row?.error
    );

  if (!row?.id) {
    throw new Error(
      verificationError ||
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
// PASSWORD RESET
//
// Three steps, all routed through the request-password-reset edge function:
//
//   1. requestPasswordResetCode(email)
//      Emails a 6-digit code. The function answers identically whether or not
//      the address has an account, so this cannot be used to discover which
//      emails are registered.
//
//   2. verifyPasswordResetCode(email, code)
//      Checks the code and the attempt limit WITHOUT consuming it.
//
//   3. applyPasswordReset(email, code, newPassword)
//      Exchanges the code for the new password in a single call.
//
// The separate verify step exists so the UI can reject a bad code before the
// visitor bothers typing a new password. It re-verifies on apply, because a
// client-side check proves nothing: the edge function never trusts a prior
// verification, and the code is spent only after the password actually changed.
// ============================================================================

export async function requestPasswordResetCode(
  email,
  accountKind = 'visitor'
) {
  const normalizedEmail =
    normalizeEmail(email);

  if (!normalizedEmail) {
    throw new Error(
      'Please enter your email address.'
    );
  }

  const {
    data,
    error,
  } =
    await supabase.functions.invoke(
      'request-password-reset',
      {
        body: {
          operation: 'request',
          email:
            normalizedEmail,
          accountKind,
        },
      }
    );

  const failure =
    await readFunctionError(
      error,
      data
    );

  if (failure) {
    throw new Error(
      failure
    );
  }

  const expiresInSeconds =
    Number(data?.expiresInSeconds);

  return {
    success: true,
    expiresInSeconds:
      Number.isFinite(expiresInSeconds) && expiresInSeconds >= 0
        ? expiresInSeconds
        : 10 * 60,
    message:
      normalizeText(
        data?.message
      ) ||
      'If that address belongs to a SHELF account, a verification code is on its way.',
  };
}

export async function verifyPasswordResetCode(
  email,
  code
) {
  const normalizedEmail =
    normalizeEmail(email);

  if (!normalizedEmail) {
    throw new Error(
      'Please enter your email address.'
    );
  }

  const normalizedCode =
    normalizeText(code);

  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new Error(
      'Please enter the complete 6-digit verification code.'
    );
  }

  const {
    data,
    error,
  } =
    await supabase.functions.invoke(
      'request-password-reset',
      {
        body: {
          operation: 'verify',
          email:
            normalizedEmail,
          code:
            normalizedCode,
        },
      }
    );

  const failure =
    await readFunctionError(
      error,
      data
    );

  if (failure) {
    throw new Error(
      failure
    );
  }

  return {
    success:
      data?.valid === true,
  };
}

export async function applyPasswordReset({
  email,
  code,
  newPassword,
}) {
  const normalizedEmail =
    normalizeEmail(email);

  if (!normalizedEmail) {
    throw new Error(
      'Please enter your email address.'
    );
  }

  const normalizedCode =
    normalizeText(code);

  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new Error(
      'Please enter the complete 6-digit verification code.'
    );
  }

  const normalizedPassword =
    asString(newPassword);

  if (
    !isPasswordValid(
      normalizedPassword
    )
  ) {
    throw new Error(
      PASSWORD_REQUIREMENT_MESSAGE
    );
  }

  const {
    data,
    error,
  } =
    await supabase.functions.invoke(
      'request-password-reset',
      {
        body: {
          operation: 'apply',
          email:
            normalizedEmail,
          code:
            normalizedCode,
          newPassword:
            normalizedPassword,
        },
      }
    );

  const failure =
    await readFunctionError(
      error,
      data
    );

  if (failure) {
    throw new Error(
      failure
    );
  }

  return {
    success: true,
    message:
      normalizeText(
        data?.message
      ) ||
      'Your password has been updated. You can now sign in with your new password.',
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
      'Email is required.'
    );
  }

  if (!normalizedPassword) {
    throw new Error(
      'Password is required.'
    );
  }

  
const {
  data: loginData,
  error: loginError,
} = await supabase.functions.invoke(
  'login-with-lockout',
  {
    body: {
      email: normalizeEmail(normalizedIdentifier),
      password: normalizedPassword,
    },
  }
);

if (
  loginError ||
  !loginData?.success ||
  !loginData?.session
) {
  let details;

  try {
    details = await loginError?.context?.json?.();
  } catch {
    console.warn('Unable to read visitor login error details:');
  }

  const err = new Error(
    details?.error ||
      loginData?.error ||
      'Unable to log in. Please try again.'
  );
  if (loginError?.context?.status) {
    err.status = loginError.context.status;
  }
  throw err;
}

const { data: sessionData, error: sessionError } =
  await supabase.auth.setSession({
    access_token: loginData.session.access_token,
    refresh_token: loginData.session.refresh_token,
  });

if (sessionError) {
  throw cleanErr(
    sessionError,
    'Unable to establish the login session.'
  );
}

const authData = {
  user: sessionData.user || loginData.user,
};

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

  const {
    data: visitor,
    error: visitorError,
  } =
    await supabase
      .from('visitors')
      .select(
        'id, full_name, email, otp_verified, qr_code, is_active, auth_user_id, registration_type, approval_status'
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

  const communityApprovalPending = visitor.registration_type === 'community'
    && visitor.approval_status === 'pending'
    && visitor.is_active === false
    && visitor.otp_verified === true;

  if (visitor.is_active === false && !communityApprovalPending) {
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
      communityApprovalPending ? null : visitor.qr_code,

    registrationType: visitor.registration_type || 'institutional',
    communityApprovalPending,
  };
}

export async function fetchVisitorForPasskey(authUserId) {
  const normalizedAuthUserId = normalizeText(authUserId);
  if (!normalizedAuthUserId) {
    throw new Error('The passkey sign-in did not return an account.');
  }
  const { data: visitor, error } = await supabase
    .from('visitors')
    .select('id, full_name, email, otp_verified, qr_code, is_active, auth_user_id, registration_type, approval_status')
    .eq('auth_user_id', normalizedAuthUserId)
    .maybeSingle();
  if (error) throw cleanErr(error, 'Unable to load your visitor account.');
  if (!visitor) throw new Error('This passkey is not linked to a SHELF visitor account.');
  if (visitor.otp_verified !== true) throw new Error('Please verify your email before signing in.');
  const communityApprovalPending = visitor.registration_type === 'community'
    && visitor.approval_status === 'pending'
    && visitor.is_active === false;
  if (visitor.is_active === false && !communityApprovalPending) throw new Error('This visitor account is currently inactive.');
  return {
    id: visitor.id,
    fullName: visitor.full_name,
    email: visitor.email,
    qrCode: communityApprovalPending ? null : visitor.qr_code,
    registrationType: visitor.registration_type || 'institutional',
    communityApprovalPending,
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
  } =
    await supabase.rpc(
      'lookup_attendance_visitor_v2',
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

    contactNumber:
      row.contact_number,

    email:
      row.email,

    address:
      row.address,

    profileImagePath:
      row.profile_image_path || null,

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
  data: loginData,
  error: loginError,
} = await supabase.functions.invoke(
  'login-with-lockout',
  {
    body: {
      email: normalizedEmail,
      password: normalizedPassword,
    },
  }
);

if (
  loginError ||
  !loginData?.success ||
  !loginData?.session
) {
  let details;

  try {
    details = await loginError?.context?.json?.();
  } catch {
    console.warn('Unable to read staff login error details:');
  }

  const message =
    details?.error ||
    loginData?.error ||
    'Unable to authenticate the staff account.';

  throw new Error(message);
}

const {
  data: sessionData,
  error: sessionError,
} = await supabase.auth.setSession({
  access_token: loginData.session.access_token,
  refresh_token: loginData.session.refresh_token,
});

if (sessionError) {
  throw cleanErr(
    sessionError,
    'Unable to establish the staff login session.'
  );
}

const data = {
  user: sessionData.user || loginData.user,
};

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
    console.error('STAFF PROFILE LOAD ERROR:');

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

// Restore a staff profile only from the current Supabase-authenticated user.
// The caller must also verify the session's MFA assurance level before exposing
// any staff routes.
export async function getAuthenticatedStaffProfile() {
  if (!supabase) return null;
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user?.id) return null;
  const { data: profile, error } = await supabase
    .from('staff_profiles')
    .select('id, email, full_name, role, library_id, is_active')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw cleanErr(error, 'Unable to restore the staff profile.');
  if (!profile?.is_active || !['subadmin', 'superadmin'].includes(profile.role)) return null;
  return {
    id: profile.id,
    email: profile.email,
    name: profile.full_name,
    role: profile.role,
    libraryId: profile.library_id,
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
  } =
    await supabase.rpc(
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


function normalizeInventoryMatch(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

function preserveBookCategory(value) {
  const category = String(value ?? '').trim();
  return category || null;
}

/**
 * Adds incoming library stock to an existing matching book,
 * or inserts a new book if no match exists.
 *
 * Matching: normalized title + author + library branch.
 * Existing book IDs and transaction references are preserved.
 *
 * If the database already has multiple matching records,
 * stop and request manual review instead of guessing which
 * record should receive the additional copies.
 */

export async function mergeOrInsertLibraryBooks(incomingRows) {
  if (!Array.isArray(incomingRows) || incomingRows.length === 0) {
    return { books: [], rateMismatches: [] };
  }

  const grouped = new Map();

  // Combine repeated copies of the same book within this import.
  for (const source of incomingRows) {
    const row = { ...source };
    row.category = preserveBookCategory(row.category);
    row.fine_rate = normalizeBookFineRate(row.fine_rate);
    row.lending_period_days = normalizeLendingPeriodDays(row.lending_period_days);
    row.call_number = normalizeCallNumber(row.call_number ?? row.callNumber);

    const title = normalizeText(row.title);
    const author = normalizeText(row.author);
    const libraryId = normalizeText(row.library_id) || null;
    const rawStock =
      row.total_copies ??
      row.stock_count ??
      row.stock ??
      row.copies;
    const stock =
      rawStock == null || String(rawStock).trim() === ''
        ? 1
        : Number(rawStock);

    if (!title || !author) {
      throw new Error('Every library book requires a title and author.');
    }

    if (!Number.isInteger(stock) || stock < 1) {
      throw new Error(`Invalid stock count for "${title}".`);
    }

    if (libraryId && !isValidUuid(libraryId)) {
      throw new Error(`Invalid library ID for "${title}".`);
    }

    const isbn = normalizeText(row.isbn).replace(/[\s-]/g, '').toUpperCase();
    const key = JSON.stringify([
      isbn || normalizeInventoryMatch(title),
      isbn ? '' : normalizeInventoryMatch(author),
      libraryId,
    ]);

    const existingGroup = grouped.get(key);

    if (existingGroup) {
      if (Number(existingGroup.fine_rate) !== Number(row.fine_rate)) {
        throw new Error(
          `Duplicate import rows for "${title}" by ${author} have different fine rates. ` +
          'Resolve the rate conflict before importing.'
        );
      }
      existingGroup.total_copies += stock;
      existingGroup.available_copies += Number(
        row.available_copies ?? stock
      );
    } else {
      grouped.set(key, {
        ...row,
        title,
        author,
        library_id: libraryId,
        total_copies: stock,
        available_copies: Number(row.available_copies ?? stock),
        book_type: 'library',
        owner_visitor_id: null,
      });
    }
  }

  const rows = [...grouped.values()];
  const branchIds = [...new Set(rows.map((row) => row.library_id))];

  // Read the existing catalog for each affected branch.
  // No database writes occur during this preflight stage.
  const existingByBranch = new Map();

  for (const libraryId of branchIds) {
    let query = supabase
      .from('books')
      .select(
        'id, title, author, category, isbn, call_number, library_id, total_copies, available_copies, fine_rate, lending_period_days, book_type'
      )
      .or('book_type.eq.library,book_type.is.null');

    query = libraryId
      ? query.eq('library_id', libraryId)
      : query.is('library_id', null);

    const { data, error } = await query;

    if (error) {
      throw cleanErr(
        error,
        'Unable to check existing inventory for duplicates.'
      );
    }

    existingByBranch.set(libraryId, data || []);
  }

  // Validate every match before changing any records.
  const plan = rows.map((row) => {
    const branchBooks = existingByBranch.get(row.library_id) || [];
    const incomingIsbn = normalizeText(row.isbn)
      .replace(/[\s-]/g, '')
      .toUpperCase();

    const matches = branchBooks.filter((book) =>
      (incomingIsbn &&
        normalizeText(book.isbn).replace(/[\s-]/g, '').toUpperCase() ===
          incomingIsbn) ||
      (
        normalizeInventoryMatch(book.title) ===
          normalizeInventoryMatch(row.title) &&
        normalizeInventoryMatch(book.author) ===
          normalizeInventoryMatch(row.author)
      )
    );

    if (matches.length > 1) {
      throw new Error(
        `Multiple existing records match "${row.title}" by ${row.author} ` +
        `in this branch. No inventory changes were made. ` +
        `Review those records manually before importing this book.`
      );
    }

    return {
      incoming: row,
      existing: matches[0] || null,
    };
  });

  const saved = [];
  const rateMismatches = [];

  // Apply the validated plan.
  for (const { incoming, existing } of plan) {
    if (existing) {
      const { update: copyUpdate, fineRateMismatch } =
        buildDuplicateBookImportUpdate(existing, incoming);
      if (fineRateMismatch) {
        rateMismatches.push({
          title: incoming.title,
          author: incoming.author,
          libraryId: incoming.library_id,
          existingRate: existing.fine_rate,
          importedRate: incoming.fine_rate,
          existingCategory: existing.category,
          importedCategory: incoming.category,
        });
      }
      if (!existing.call_number && incoming.call_number) {
        copyUpdate.call_number = incoming.call_number;
      }
      const { data, error } = await supabase
        .from('books')
        .update(copyUpdate)
        .eq('id', existing.id)
        .select('*')
        .single();

      if (error) {
        throw cleanErr(
          error,
          `Unable to add copies to "${incoming.title}".`
        );
      }

      saved.push(data);
    } else {
      const { data, error } = await supabase
        .from('books')
        .insert(incoming)
        .select('*')
        .single();

      if (error) {
        throw cleanErr(
          error,
          `Unable to add "${incoming.title}" to inventory.`
        );
      }

      saved.push(data);
    }
  }

  return {
    books: saved.map(mapBook),
    rateMismatches,
  };
}


// ============================================================================
// BOOK INVENTORY — ADD LIBRARY BOOK
// ============================================================================


export async function addBook(book) {
  const title = normalizeText(book?.title);
  const author = normalizeText(book?.author);
  const category = preserveBookCategory(book?.category);
  const fineRate = normalizeBookFineRate(book?.fine_rate);
  const lendingPeriodDays = normalizeLendingPeriodDays(
    book?.lendingPeriodDays ?? book?.lending_period_days
  );
  const libraryId = normalizeText(book?.libraryId);
  const totalCopies = Math.max(
    1,
    Number(book?.totalCopies) || 1
  );

  if (!title) {
    throw new Error('Book title is required.');
  }

  if (!author) {
    throw new Error('Book author is required.');
  }

  if (libraryId && !isValidUuid(libraryId)) {
    throw new Error('Invalid library ID.');
  }

  const result = await mergeOrInsertLibraryBooks([
    {
      title,
      author,
      category,
      fine_rate: fineRate,
      isbn: normalizeText(book?.isbn) || null,
      call_number: normalizeCallNumber(book?.callNumber),
      shelf_location: normalizeText(book?.shelfLocation) || null,
      library_id: libraryId || null,
      total_copies: totalCopies,
      available_copies: totalCopies,
      summary: normalizeText(book?.summary) || null,
      cover_url: normalizeText(book?.coverUrl) || DEFAULT_COVER_URL,
      book_type: 'library',
      owner_visitor_id: null,
      lending_enabled: false,
      condition: null,
      lending_period_days: lendingPeriodDays,
      handover_location: null,
      handover_method: null,
      handover_details: null,
    },
  ]);

  return {
    ...result.books[0],
    fineRateMismatch: result.rateMismatches[0] || null,
  };
}


// ============================================================================
// PERSONAL BOOK — ADD
// ============================================================================

export async function addPersonalBook({
  visitorId,
  title,
  author,
  category = null,
  isbn = null,
  summary = null,
  condition = 'Good',
  lendingPeriodDays = 7,
  totalCopies = 1,
  handoverMethod = 'arrange_with_owner',
  handoverDetails = null,
  lendingEnabled = true,
  isPublic = false,
  coverUrl,
  fineRate,
}) {
  const normalizedVisitorId =
    normalizeText(visitorId);

  const normalizedTitle =
    normalizeText(title);

  const normalizedAuthor =
    normalizeText(author);

  const normalizedCategory = preserveBookCategory(category);

  const normalizedIsbn =
    normalizeText(isbn) || null;

  const normalizedSummary =
    normalizeText(summary) || null;

  const normalizedCondition =
    normalizeText(condition) || 'Good';

  const normalizedHandoverMethod =
    normalizeText(
      handoverMethod
    ).toLowerCase() ||
    'arrange_with_owner';

  const normalizedHandoverDetails =
    normalizeText(
      handoverDetails
    ) || null;

  const normalizedLendingPeriod =
    Number(lendingPeriodDays);

  const normalizedTotalCopies =
    Number(totalCopies);

  const normalizedLendingEnabled =
    lendingEnabled !== false;
  const normalizedFineRate = fineRate == null || String(fineRate).trim() === ''
    ? null
    : normalizeBookFineRate(fineRate);

  if (normalizedLendingEnabled && normalizedFineRate == null) {
    throw new Error('Enter a fine rate from 1 to 100 per overdue day to enable community lending.');
  }

  if (!normalizedVisitorId) {
    throw new Error(
      'Visitor ID is required.'
    );
  }

  if (
    !isValidVisitorId(
      normalizedVisitorId
    )
  ) {
    throw new Error(
      'Invalid visitor ID.'
    );
  }

  if (!normalizedTitle) {
    throw new Error(
      'Book title is required.'
    );
  }

  if (!normalizedAuthor) {
    throw new Error(
      'Book author is required.'
    );
  }

  if (
    !PERSONAL_BOOK_CONDITIONS.includes(
      normalizedCondition
    )
  ) {
    throw new Error(
      'Invalid book condition.'
    );
  }

  if (
    !Number.isInteger(
      normalizedLendingPeriod
    ) ||
    normalizedLendingPeriod <
      PERSONAL_BOOK_MIN_LENDING_DAYS ||
    normalizedLendingPeriod >
      PERSONAL_BOOK_MAX_LENDING_DAYS
  ) {
    throw new Error(
      `Lending period must be between ${PERSONAL_BOOK_MIN_LENDING_DAYS} and ${PERSONAL_BOOK_MAX_LENDING_DAYS} days.`
    );
  }

  if (
    !Number.isInteger(
      normalizedTotalCopies
    ) ||
    normalizedTotalCopies < 1
  ) {
    throw new Error(
      'Copy count must be a whole number of at least 1.'
    );
  }

  if (
    !PERSONAL_BOOK_HANDOVER_METHODS.includes(
      normalizedHandoverMethod
    )
  ) {
    throw new Error(
      'Invalid handover method.'
    );
  }

  if (
    normalizedHandoverDetails &&
    normalizedHandoverDetails.length > 500
  ) {
    throw new Error(
      'Handover details must not exceed 500 characters.'
    );
  }

  const {
    data,
    error,
  } =
    await supabase.rpc(
      coverUrl === undefined
        ? 'add_personal_book'
        : 'add_personal_book_with_cover',
      {
        p_visitor_id:
          normalizedVisitorId,

        p_title:
          normalizedTitle,

        p_author:
          normalizedAuthor,

        p_category:
          normalizedCategory,

        p_isbn:
          normalizedIsbn,

        p_summary:
          normalizedSummary,

        p_condition:
          normalizedCondition,

        p_lending_period_days:
          normalizedLendingPeriod,

        p_handover_method:
          normalizedHandoverMethod,

        p_handover_details:
          normalizedHandoverDetails,

        p_lending_enabled:
          normalizedLendingEnabled,

        p_total_copies:
          normalizedTotalCopies,

        p_is_public:
          Boolean(isPublic),
        p_fine_rate:
          normalizedFineRate,
        ...(coverUrl === undefined
          ? {}
          : {
              p_cover_url:
                normalizeText(coverUrl) || null,
            }),
      }
    );

  if (error) {
    console.error('ADD PERSONAL BOOK RPC ERROR:');

    throw cleanErr(
      error,
      'Unable to add the personal book.'
    );
  }

  const row =
    firstRow(data);

  if (!row?.id) {
    throw new Error(
      'The personal book was not created.'
    );
  }

  return mapBook(row);
}

export async function setPersonalBookVisibility(
  visitorId,
  bookId,
  isPublic
) {
  const normalizedVisitorId =
    normalizeText(visitorId);
  const normalizedBookId =
    normalizeText(bookId);

  if (!normalizedVisitorId || !isValidVisitorId(normalizedVisitorId)) {
    throw new Error('Invalid visitor ID.');
  }
  if (!normalizedBookId) {
    throw new Error('Book ID is required.');
  }

  const { error } = await supabase.rpc(
    'set_personal_book_visibility',
    {
      p_visitor_id: normalizedVisitorId,
      p_book_id: normalizedBookId,
      p_is_public: Boolean(isPublic),
    }
  );

  if (error) {
    console.error('SET PERSONAL BOOK VISIBILITY RPC ERROR:');
    throw cleanErr(
      error,
      'Unable to update the book visibility.'
    );
  }

  return Boolean(isPublic);
}

export async function updatePersonalBook({
  visitorId,
  bookId,
  title,
  author,
  category = null,
  isbn = null,
  summary = null,
  condition = 'Good',
  lendingPeriodDays = 7,
  totalCopies = 1,
  handoverMethod = 'arrange_with_owner',
  handoverDetails = null,
  lendingEnabled = true,
  isPublic = false,
  coverUrl,
  fineRate,
}) {
  const normalizedVisitorId = normalizeText(visitorId);
  const normalizedBookId = normalizeText(bookId);
  const normalizedTitle = normalizeText(title);
  const normalizedAuthor = normalizeText(author);
  const normalizedCategory = preserveBookCategory(category);
  const normalizedIsbn = normalizeText(isbn) || null;
  const normalizedSummary = normalizeText(summary) || null;
  const normalizedCondition = normalizeText(condition) || 'Good';
  const normalizedLendingPeriod = Number(lendingPeriodDays);
  const normalizedTotalCopies = Number(totalCopies);
  const normalizedHandoverMethod =
    normalizeText(handoverMethod).toLowerCase() || 'arrange_with_owner';
  const normalizedHandoverDetails =
    normalizeText(handoverDetails) || null;
  const normalizedFineRate = fineRate == null || String(fineRate).trim() === ''
    ? null
    : normalizeBookFineRate(fineRate);

  if (!isValidVisitorId(normalizedVisitorId)) {
    throw new Error('Invalid visitor ID.');
  }
  if (!normalizedBookId) {
    throw new Error('Book ID is required.');
  }
  if (!normalizedTitle || !normalizedAuthor) {
    throw new Error('Book title and author are required.');
  }
  if (!PERSONAL_BOOK_CONDITIONS.includes(normalizedCondition)) {
    throw new Error('Invalid book condition.');
  }
  if (
    !Number.isInteger(normalizedLendingPeriod) ||
    normalizedLendingPeriod < PERSONAL_BOOK_MIN_LENDING_DAYS ||
    normalizedLendingPeriod > PERSONAL_BOOK_MAX_LENDING_DAYS
  ) {
    throw new Error(
      `Lending period must be between ${PERSONAL_BOOK_MIN_LENDING_DAYS} and ${PERSONAL_BOOK_MAX_LENDING_DAYS} days.`
    );
  }
  if (!Number.isInteger(normalizedTotalCopies) || normalizedTotalCopies < 1) {
    throw new Error('Copy count must be a whole number of at least 1.');
  }
  if (!PERSONAL_BOOK_HANDOVER_METHODS.includes(normalizedHandoverMethod)) {
    throw new Error('Invalid handover method.');
  }
  if (normalizedHandoverDetails?.length > 500) {
    throw new Error('Handover details must not exceed 500 characters.');
  }
  if (lendingEnabled !== false && normalizedFineRate == null) {
    throw new Error('Enter a fine rate from 1 to 100 per overdue day to enable community lending.');
  }

  const { data, error } = await supabase.rpc(
    coverUrl === undefined
      ? 'update_personal_book'
      : 'update_personal_book_with_cover',
    {
    p_visitor_id: normalizedVisitorId,
    p_book_id: normalizedBookId,
    p_title: normalizedTitle,
    p_author: normalizedAuthor,
    p_category: normalizedCategory,
    p_isbn: normalizedIsbn,
    p_summary: normalizedSummary,
    p_condition: normalizedCondition,
    p_lending_period_days: normalizedLendingPeriod,
    p_handover_method: normalizedHandoverMethod,
    p_handover_details: normalizedHandoverDetails,
    p_lending_enabled: lendingEnabled !== false,
    p_total_copies: normalizedTotalCopies,
    p_is_public: Boolean(isPublic),
    p_fine_rate: normalizedFineRate,
    ...(coverUrl === undefined
      ? {}
      : {
          p_cover_url:
            normalizeText(coverUrl) || null,
        }),
    }
  );

  if (error) {
    console.error('UPDATE PERSONAL BOOK RPC ERROR:');
    throw cleanErr(error, 'Unable to update the personal book.');
  }

  const row = firstRow(data);
  if (!row?.id) {
    throw new Error('The personal book was not updated.');
  }
  return mapBook(row);
}

export async function deletePersonalBook(visitorId, bookId) {
  const normalizedVisitorId = normalizeText(visitorId);
  const normalizedBookId = normalizeText(bookId);

  if (!isValidVisitorId(normalizedVisitorId)) {
    throw new Error('Invalid visitor ID.');
  }
  if (!normalizedBookId) {
    throw new Error('Book ID is required.');
  }

  const { data, error } = await supabase.rpc('delete_personal_book', {
    p_visitor_id: normalizedVisitorId,
    p_book_id: normalizedBookId,
  });

  if (error) {
    console.error('DELETE PERSONAL BOOK RPC ERROR:');
    throw cleanErr(error, 'Unable to remove the personal book.');
  }
  if (data !== true) {
    throw new Error('The personal book was not removed.');
  }
  return true;
}

// ============================================================================
// COMMUNITY BOOK REQUEST
// ============================================================================
//
// Separate from requestBorrow().
//
// requestBorrow() is ONLY for normal library books.
//
// Community books are visitor-owned books. Their request must first be sent
// to the owner for approval.
//
// PostgreSQL RPC:
//
//   request_community_book(
//      p_requester_visitor_id,
//      p_book_id
//   )
//
// ============================================================================

export async function requestCommunityBook(
  requesterVisitorId,
  bookId
) {
  const normalizedRequesterId =
    normalizeText(
      requesterVisitorId
    );

  const normalizedBookId =
    normalizeText(
      bookId
    );

  if (!normalizedRequesterId) {
    throw new Error(
      'Visitor ID is required.'
    );
  }

  if (
    !isValidVisitorId(
      normalizedRequesterId
    )
  ) {
    throw new Error(
      'Invalid visitor ID.'
    );
  }

  if (!normalizedBookId) {
    throw new Error(
      'Book ID is required.'
    );
  }

  const resolvedRequesterId =
    isValidUuid(normalizedRequesterId)
      ? normalizedRequesterId
      : await resolveVisitorAuthUserId(
          normalizedRequesterId
        );

  const {
    data,
    error,
  } =
    await supabase.rpc(
      'request_community_book',
      {
        p_requester_visitor_id:
          resolvedRequesterId,

        p_book_id:
          normalizedBookId,
      }
    );

  if (error) {
    console.error('COMMUNITY BOOK REQUEST RPC ERROR:');
    const message =
      normalizeText(
        error?.message
      );

    const lowerMessage =
      message.toLowerCase();

    if (
      lowerMessage.includes(
        'already have an active request'
      ) ||
      lowerMessage.includes(
        'already requested'
      ) ||
      lowerMessage.includes(
        'duplicate'
      )
    ) {
      throw new Error(
        'You already have an active request for this community book.'
      );
    }

    if (
      lowerMessage.includes(
        'cannot request your own'
      ) ||
      lowerMessage.includes(
        'own personal book'
      )
    ) {
      throw new Error(
        'You cannot request your own personal book.'
      );
    }

    if (
      lowerMessage.includes(
        'not available for community lending'
      ) ||
      lowerMessage.includes(
        'not available for lending'
      )
    ) {
      throw new Error(
        'This community book is not currently available for lending.'
      );
    }

    if (
      lowerMessage.includes(
        'not a community book'
      )
    ) {
      throw new Error(
        'This book is not a community book.'
      );
    }

    if (
      lowerMessage.includes(
        'could not be found'
      ) ||
      lowerMessage.includes(
        'book could not be found'
      )
    ) {
      throw new Error(
        'The selected community book could not be found.'
      );
    }

    if (
      lowerMessage.includes(
        'visitor account could not be found'
      ) ||
      lowerMessage.includes(
        'not verified'
      )
    ) {
      throw new Error(
        'Please verify your visitor account before requesting a community book.'
      );
    }

    if (
      lowerMessage.includes(
        'uuid'
      )
    ) {
      throw new Error(
        'The visitor or book ID is invalid.'
      );
    }

    throw cleanErr(
      error,
      'Unable to request this community book. Please try again.'
    );
  }

  const row =
    firstRow(data);

  if (!row?.id) {
    throw new Error(
      'The community book request was not created.'
    );
  }

  if (
    !isValidUuid(
      row.id
    )
  ) {
    throw new Error(
      'The database returned an invalid community book request.'
    );
  }

  return {
    id:
      row.id,

    bookId:
      row.book_id,

    bookTitle:
      row.book_title,

    ownerVisitorId:
      row.owner_visitor_id,

    ownerName:
      row.owner_name,

    requesterVisitorId:
      row.requester_visitor_id,

    requesterName:
      row.requester_name,

    status:
      row.status,

    requestDate:
      row.request_date,

    ownerResponse:
      row.owner_response ||
      null,

    queuePosition:
      row.queue_position ??
      row.queuePosition ??
      null,
  };
}

// ============================================================================
// FETCH COMMUNITY BOOK REQUESTS — OWNER
// ============================================================================
//
// Loads requests made by other visitors for books owned by this visitor.
//
// PostgreSQL RPC:
//
//   fetch_owner_community_book_requests(
//      p_owner_visitor_id
//   )
//
// ============================================================================

export async function fetchOwnerCommunityBookRequests(
  ownerVisitorId
) {
  const normalizedOwnerVisitorId =
    normalizeText(ownerVisitorId);

  if (!normalizedOwnerVisitorId) {
    return [];
  }

  if (!isValidVisitorId(normalizedOwnerVisitorId)) {
    throw new Error(
      'Invalid owner visitor ID.'
    );
  }

  const {
    data,
    error,
  } = await supabase.rpc(
    'fetch_owner_community_book_requests',
    {
      p_owner_visitor_id:
        normalizedOwnerVisitorId,
    }
  );

  if (error) {
    console.error('FETCH OWNER COMMUNITY BOOK REQUESTS RPC ERROR:');

    throw cleanErr(
      error,
      'Unable to load community book requests.'
    );
  }

  return (Array.isArray(data)
    ? data
    : []
  ).map((request) => ({
    ...request,

    id:
      request.id,

    bookId:
      request.book_id,

    bookTitle:
      request.book_title ||
      'Untitled Book',

    ownerVisitorId:
      request.owner_visitor_id ||
      null,

    ownerName:
      request.owner_name ||
      null,

    queuePosition:
      request.queue_position ??
      null,

    ownerContactEmail:
      request.owner_contact_email ||
      null,

    ownerContactNumber:
      request.owner_contact_number ||
      null,

    ownerContactDetails:
      request.owner_contact_details ||
      null,

    requesterVisitorId:
      request.requester_visitor_id ||
      null,

    requesterName:
      request.requester_name ||
      'SHELF Visitor',

    status:
      String(request.status || 'pending')
        .trim()
        .toLowerCase(),

    requestDate:
      request.request_date ||
      null,

    approvedAt:
      request.approved_at ||
      null,

    rejectedAt:
      request.rejected_at ||
      null,

    ownerResponse:
      request.owner_response ||
      null,

    pickupDeadline:
      request.pickup_deadline ||
      null,

    borrowDate:
      request.borrow_date ||
      null,

    dueDate:
      request.due_date ||
      null,

    returnDate:
      request.return_date ||
      null,

    fineAmount:
      request.fine_amount ??
      0,

    fineRateSnapshot:
      request.fine_rate_snapshot == null
        ? null
        : Number(request.fine_rate_snapshot),

    fineReviewRequired: false,

    confirmedBy:
      request.confirmed_by ||
      null,

    returnConfirmedBy:
      request.return_confirmed_by ||
      null,

    requestType: 'community',
    isCommunityBook: true,
  }));
}

// ============================================================================
// FETCH COMMUNITY BOOK REQUESTS — REQUESTER
// ============================================================================
//
// Loads requests submitted by the current visitor.
//
// PostgreSQL RPC:
//
//   fetch_my_community_book_requests(
//      p_requester_visitor_id
//   )
//
// ============================================================================

export async function fetchMyCommunityBookRequests(visitorId) {
  const normalizedVisitorId = normalizeText(visitorId);

  if (!normalizedVisitorId) {
    return [];
  }

  if (!isValidVisitorId(normalizedVisitorId)) {
    throw new Error('Invalid visitor ID.');
  }

  const { data, error } = await supabase.rpc(
    'fetch_my_community_book_requests',
    {
      p_requester_visitor_id: normalizedVisitorId,
    }
  );

  if (error) {
    console.error('FETCH MY COMMUNITY BOOK REQUESTS RPC ERROR:');

    throw cleanErr(
      error,
      'Unable to load your community book requests.'
    );
  }

  return Array.isArray(data) ? data : [];
}

// ============================================================================
// APPROVE COMMUNITY BOOK REQUEST
// ============================================================================
//
// The owner approves a visitor's request.
//
// PostgreSQL RPC:
//
//   approve_community_book_request(
//      p_request_id,
//      p_owner_visitor_id
//   )
//
// ============================================================================

export async function approveCommunityBookRequest(
  requestId,
  ownerVisitorId,
  response = null
) {
  const normalizedRequestId =
    normalizeText(requestId);

  const normalizedOwnerVisitorId =
    normalizeText(ownerVisitorId);

  const normalizedResponse =
    normalizeText(response);

  if (!normalizedRequestId) {
    throw new Error(
      'Community book request ID is required.'
    );
  }

  if (!isValidUuid(normalizedRequestId)) {
    throw new Error(
      'Invalid community book request ID.'
    );
  }

  if (!normalizedOwnerVisitorId) {
    throw new Error(
      'Owner visitor ID is required.'
    );
  }

  if (!isValidVisitorId(normalizedOwnerVisitorId)) {
    throw new Error(
      'Invalid owner visitor ID.'
    );
  }

  if (normalizedResponse.length > 500) {
    throw new Error(
      'Response must not exceed 500 characters.'
    );
  }

  const {
    data,
    error,
  } = await supabase.rpc(
    'approve_community_book_request',
    {
      p_request_id:
        normalizedRequestId,

      p_owner_visitor_id:
        normalizedOwnerVisitorId,

      p_response:
        normalizedResponse || null,
    }
  );

  if (error) {
    console.error('APPROVE COMMUNITY BOOK REQUEST RPC ERROR:');

    throw cleanErr(
      error,
      'Unable to approve the community book request. Please try again.'
    );
  }

  const result = firstRow(data);

  if (!result?.id) {
    throw new Error(
      'The community book request was not approved.'
    );
  }

  return result;
}


export async function rejectCommunityBookRequest(
  requestId,
  ownerVisitorId,
  response = null
) {
  const normalizedRequestId =
    normalizeText(requestId);

  const normalizedOwnerVisitorId =
    normalizeText(ownerVisitorId);

  const normalizedResponse =
    normalizeText(response);

  if (!normalizedRequestId) {
    throw new Error(
      'Community book request ID is required.'
    );
  }

  if (!isValidUuid(normalizedRequestId)) {
    throw new Error(
      'Invalid community book request ID.'
    );
  }

  if (!normalizedOwnerVisitorId) {
    throw new Error(
      'Owner visitor ID is required.'
    );
  }

  if (!isValidVisitorId(normalizedOwnerVisitorId)) {
    throw new Error(
      'Invalid owner visitor ID.'
    );
  }

  if (normalizedResponse.length > 500) {
    throw new Error(
      'Response must not exceed 500 characters.'
    );
  }

  const {
    data,
    error,
  } = await supabase.rpc(
    'reject_community_book_request',
    {
      p_request_id:
        normalizedRequestId,

      p_owner_visitor_id:
        normalizedOwnerVisitorId,

      p_response:
        normalizedResponse || null,
    }
  );

  if (error) {
    console.error('REJECT COMMUNITY BOOK REQUEST RPC ERROR:');

    throw cleanErr(
      error,
      'Unable to reject the community book request. Please try again.'
    );
  }

  const result = firstRow(data);

  if (!result?.id) {
    throw new Error(
      'The community book request was not rejected.'
    );
  }

  return result;
}

export async function confirmCommunityBookPickup(
  requestId,
  ownerVisitorId
) {
  const normalizedRequestId = normalizeText(requestId);
  const normalizedOwnerVisitorId =
    normalizeText(ownerVisitorId);

  if (!normalizedRequestId) {
    throw new Error('Community book request ID is required.');
  }

  if (!isValidUuid(normalizedRequestId)) {
    throw new Error('Invalid community book request ID.');
  }

  if (!normalizedOwnerVisitorId) {
    throw new Error('Owner visitor ID is required.');
  }

  if (!isValidVisitorId(normalizedOwnerVisitorId)) {
    throw new Error('Invalid owner visitor ID.');
  }

  const { data, error } = await supabase.rpc(
    'confirm_community_book_pickup',
    {
      p_request_id: normalizedRequestId,
      p_owner_visitor_id: normalizedOwnerVisitorId,
    }
  );

  if (error) {
    console.error('CONFIRM COMMUNITY BOOK PICKUP RPC ERROR:');

    throw cleanErr(
      error,
      'Unable to confirm the community book handover.'
    );
  }

  return firstRow(data);
}


export async function confirmCommunityBookReturn(
  requestId,
  ownerVisitorId
) {
  const normalizedRequestId =
    normalizeText(requestId);

  const normalizedOwnerVisitorId =
    normalizeText(ownerVisitorId);

  if (!normalizedRequestId) {
    throw new Error(
      'Community book request ID is required.'
    );
  }

  if (!isValidUuid(normalizedRequestId)) {
    throw new Error(
      'Invalid community book request ID.'
    );
  }

  if (!normalizedOwnerVisitorId) {
    throw new Error(
      'Owner visitor ID is required.'
    );
  }

  if (!isValidVisitorId(normalizedOwnerVisitorId)) {
    throw new Error(
      'Invalid owner visitor ID.'
    );
  }

  const { error } = await supabase.rpc(
    'confirm_community_book_return',
    {
      p_request_id:
        normalizedRequestId,

      p_owner_visitor_id:
        normalizedOwnerVisitorId,
    }
  );

  if (error) {
    console.error('CONFIRM COMMUNITY BOOK RETURN RPC ERROR:');
    throw cleanErr(
      error,
      'Unable to confirm the community book return.'
    );
  }

  /*
    confirm_community_book_return()
    intentionally returns VOID.

    The RPC succeeding is enough to confirm
    that the return was processed.
  */
  return {
    success: true,
    requestId:
      normalizedRequestId,
  };
}

// ============================================================================
// CANCEL COMMUNITY BOOK REQUEST
// ============================================================================
//
// Cancels a request submitted by the current visitor for a community book.
//
// PostgreSQL RPC:
//
//   cancel_community_book_request(
//      p_request_id,
//      p_requester_visitor_id,
//      p_reason
//   )
//
// ============================================================================

export async function cancelCommunityBookRequest(
  requestId,
  requesterVisitorId,
  reason = 'cancelled'
) {
  const normalizedRequestId =
    normalizeText(requestId);

  const normalizedRequesterId =
    normalizeText(requesterVisitorId);

  const normalizedReason =
    normalizeText(reason) || 'cancelled';

  if (!normalizedRequestId) {
    throw new Error(
      'Community book request ID is required.'
    );
  }

  if (!isValidUuid(normalizedRequestId)) {
    throw new Error(
      'Invalid community book request ID.'
    );
  }

  if (!normalizedRequesterId) {
    throw new Error(
      'Visitor ID is required.'
    );
  }

  if (!isValidVisitorId(normalizedRequesterId)) {
    throw new Error(
      'Invalid visitor ID.'
    );
  }

  if (normalizedReason.length > 500) {
    throw new Error(
      'Cancellation reason must not exceed 500 characters.'
    );
  }

  const {
    data,
    error,
  } = await supabase.rpc(
    'cancel_community_book_request',
    {
      p_request_id:
        normalizedRequestId,

      p_requester_visitor_id:
        normalizedRequesterId,

      p_reason:
        normalizedReason,
    }
  );

  if (error) {
    console.error('CANCEL COMMUNITY BOOK REQUEST RPC ERROR:');

    const message =
      normalizeText(error?.message);

    const lowerMessage =
      message.toLowerCase();

    if (
      lowerMessage.includes(
        'request not found'
      ) ||
      lowerMessage.includes(
        'community book request not found'
      )
    ) {
      throw new Error(
        'The community book request could not be found.'
      );
    }

    if (
      lowerMessage.includes(
        'not authorized'
      ) ||
      lowerMessage.includes(
        'not your request'
      ) ||
      lowerMessage.includes(
        'unauthorized'
      )
    ) {
      throw new Error(
        'You are not authorized to cancel this community book request.'
      );
    }

    if (
      lowerMessage.includes(
        'cannot cancel'
      )
    ) {
      throw new Error(
        message ||
        'This community book request can no longer be cancelled.'
      );
    }

    if (
      lowerMessage.includes(
        'uuid'
      )
    ) {
      throw new Error(
        'The request or visitor ID is invalid.'
      );
    }

    throw cleanErr(
      error,
      'Unable to cancel the community book request. Please try again.'
    );
  }

  return {
    success: true,
    data,
  };
}

// ============================================================================
// BULK BOOK UPLOAD
// ============================================================================

function normalizeAndValidateIsbn(value) {
  const raw = normalizeText(value);

  // Optional ang ISBN.
  if (!raw) return null;

  const isbn = raw
    .replace(/^ISBN(?:-10|-13)?\s*:?/i, '')
    .replace(/[\s-]/g, '')
    .toUpperCase();

  // Validate ISBN-10 checksum.
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const sum = [...isbn].reduce(
      (total, char, index) =>
        total +
        (char === 'X' ? 10 : Number(char)) *
          (10 - index),
      0
    );

    if (sum % 11 === 0) return isbn;
  }

  // Validate ISBN-13 checksum.
  if (/^\d{13}$/.test(isbn)) {
    const sum = [...isbn.slice(0, 12)].reduce(
      (total, digit, index) =>
        total +
        Number(digit) * (index % 2 === 0 ? 1 : 3),
      0
    );

    const checkDigit = (10 - (sum % 10)) % 10;

    if (checkDigit === Number(isbn[12])) {
      return isbn;
    }
  }

  throw new Error(
    `Invalid ISBN "${raw}". Please check the ISBN-10 or ISBN-13 digits.`
  );
}

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

  const booksWithValidatedFineRates =
    validateImportedBookFineRates(books);

  const rows =
    booksWithValidatedFineRates.map(
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
          normalizeAndValidateIsbn(
            normalized.isbn
          );

        const category = preserveBookCategory(normalized.category);

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
          !Number.isInteger(stock) ||
          stock < 1
        ) {
          throw new Error(
            `Row ${index + 1} requires title, author, and a positive whole-number stock count.`
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

          fine_rate:
            normalizeBookFineRate(normalized.fine_rate),

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

          book_type:
            'library',

          owner_visitor_id:
            null,

          lending_enabled:
            false,

          condition:
            null,

          lending_period_days:
            normalizeLendingPeriodDays(normalized.lending_period_days),

          handover_location:
            null,

          handover_method:
            null,

          handover_details:
            null,
        };
      }
    );


  return await mergeOrInsertLibraryBooks(rows);
}

export async function importBooksBulk(books) {
  if (!Array.isArray(books) || books.length === 0) {
    throw new Error('Choose a file containing at least one book.');
  }

  return mergeOrInsertLibraryBooks(
    validateImportedBookFineRates(books)
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

  const expectedUpdatedAt =
    normalizeText(patch?.updatedAt);

  if (!expectedUpdatedAt) {
    throw new Error(
      'INVENTORY_CONFLICT: reload this book before saving.'
    );
  }

  const dbPatch = {};

  if (
    patch?.title !== undefined
  ) {
    const title =
      normalizeText(
        patch.title
      );

    if (!title) {
      throw new Error(
        'Book title is required.'
      );
    }

    dbPatch.title =
      title;
  }

  if (
    patch?.author !== undefined
  ) {
    const author =
      normalizeText(
        patch.author
      );

    if (!author) {
      throw new Error(
        'Book author is required.'
      );
    }

    dbPatch.author =
      author;
  }

  if (patch?.category !== undefined) {
    dbPatch.category = preserveBookCategory(patch.category);
  }

  if (patch?.callNumber !== undefined) {
    dbPatch.call_number = normalizeCallNumber(patch.callNumber);
  }

  if (patch?.fine_rate !== undefined) {
    dbPatch.fine_rate = normalizeBookFineRate(patch.fine_rate);
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
    patch?.bookType !== undefined
  ) {
    const bookType =
      normalizeText(
        patch.bookType
      ).toLowerCase();

    if (
      bookType !== 'library' &&
      bookType !== 'personal'
    ) {
      throw new Error(
        'Invalid book type.'
      );
    }

    dbPatch.book_type =
      bookType;
  }

  if (
    patch?.ownerVisitorId !== undefined
  ) {
    const ownerVisitorId =
      normalizeText(
        patch.ownerVisitorId
      );

    if (
      ownerVisitorId &&
      !isValidVisitorId(
        ownerVisitorId
      )
    ) {
      throw new Error(
        'Invalid owner visitor ID.'
      );
    }

    dbPatch.owner_visitor_id =
      ownerVisitorId || null;
  }

  if (
    patch?.lendingEnabled !== undefined
  ) {
    dbPatch.lending_enabled =
      Boolean(
        patch.lendingEnabled
      );
  }

  if (
    patch?.condition !== undefined
  ) {
    const condition =
      normalizeText(
        patch.condition
      );

    if (
      condition &&
      !PERSONAL_BOOK_CONDITIONS.includes(
        condition
      )
    ) {
      throw new Error(
        'Invalid book condition.'
      );
    }

    dbPatch.condition =
      condition || null;
  }

  if (
    patch?.lendingPeriodDays !== undefined
  ) {
    const lendingPeriodDays =
      Number(
        patch.lendingPeriodDays
      );

    if (
      !Number.isInteger(
        lendingPeriodDays
      ) ||
      lendingPeriodDays <
        PERSONAL_BOOK_MIN_LENDING_DAYS ||
      lendingPeriodDays >
        PERSONAL_BOOK_MAX_LENDING_DAYS
    ) {
      throw new Error(
        `Lending period must be between ${PERSONAL_BOOK_MIN_LENDING_DAYS} and ${PERSONAL_BOOK_MAX_LENDING_DAYS} days.`
      );
    }

    dbPatch.lending_period_days =
      lendingPeriodDays;
  }

  if (
    patch?.handoverMethod !== undefined
  ) {
    const handoverMethod =
      normalizeText(
        patch.handoverMethod
      ).toLowerCase();

    if (
      handoverMethod &&
      !PERSONAL_BOOK_HANDOVER_METHODS.includes(
        handoverMethod
      )
    ) {
      throw new Error(
        'Invalid handover method.'
      );
    }

    dbPatch.handover_method =
      handoverMethod || null;
  }

  if (
    patch?.handoverDetails !== undefined
  ) {
    const handoverDetails =
      normalizeText(
        patch.handoverDetails
      );

    if (
      handoverDetails.length > 500
    ) {
      throw new Error(
        'Handover details must not exceed 500 characters.'
      );
    }

    dbPatch.handover_details =
      handoverDetails || null;
  }

  if (
    patch?.handoverLocation !== undefined
  ) {
    dbPatch.handover_location =
      normalizeText(
        patch.handoverLocation
      ) || null;
  }

  if (
    Object.keys(dbPatch).length === 0
  ) {
    return null;
  }

  const {
    data,
    error,
  } =
    await supabase.rpc(
      'update_inventory_book',
      {
        p_book_id:
          normalizedBookId,

        p_expected_updated_at:
          expectedUpdatedAt,

        p_patch:
          dbPatch,
      }
    );

  if (error) {
    throw cleanErr(error);
  }

  return mapBook(firstRow(data));
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

  return {
    success: true,
  };
}

// ============================================================================
// LOAD SAMPLE / API CATALOG
// ============================================================================


export async function loadExternalCatalog(libraryId) {
  const normalizedLibraryId = normalizeText(libraryId);

  if (!normalizedLibraryId || !isValidUuid(normalizedLibraryId)) {
    throw new Error('Select a valid library before loading API books.');
  }

  const categories = [
    { query: 'computer+science', label: 'Computer Science' },
    { query: 'engineering', label: 'Engineering' },
    { query: 'mathematics', label: 'Mathematics' },
    { query: 'physics', label: 'Physics' },
    { query: 'history', label: 'History' },
  ];

  const recordsByKey = new Map();
  const errors = [];

  for (const category of categories) {
    try {
      const response = await fetch(
        `https://openlibrary.org/search.json?q=${category.query}&limit=25`
      );

      if (!response.ok) {
        throw new Error(`Open Library returned ${response.status}.`);
      }

      const data = await response.json();

      for (const doc of data.docs || []) {
        const key = String(doc.key || '').trim();
        const title = String(doc.title || '').trim();

        // Open Library work keys identify records across repeated imports.
        if (!key.startsWith('/works/') || !title) continue;

        const firstSentence = Array.isArray(doc.first_sentence)
          ? doc.first_sentence[0]
          : doc.first_sentence;

        recordsByKey.set(key, {
          openlibrary_key: key,
          title,
          author: doc.author_name?.[0] || null,
          category: normalizeBookCategory(category.label),
          isbn: doc.isbn?.[0] || null,
          summary: typeof firstSentence === 'string'
            ? firstSentence
            : null,
          cover_url: doc.cover_i
            ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
            : null,
          source_url: `https://openlibrary.org${key}`,
        });
      }
    } catch {
      errors.push(`${category.label}: ${error.message}`);
      console.error('Open Library category import failed:');
    }
  }

  const records = [...recordsByKey.values()];

  if (records.length === 0) {
    throw new Error(
      errors.length
        ? `Could not retrieve external books. ${errors.join(' | ')}`
        : 'Open Library returned no usable records.'
    );
  }

  // Upsert metadata only. This RPC never inserts into public.books.
  const { data, error } = await supabase.rpc(
    'upsert_external_catalog_books',
    {
      p_library_id: normalizedLibraryId,
      p_books: records,
    }
  );

  if (error) throw cleanErr(error);

  return {
    success: true,
    fetched: records.length,
    upserted: Number(data || 0),
    warnings: errors,
  };
}

export async function fetchExternalCatalogBooks() {
  const pageSize = 1000;
  const data = [];
  let offset = 0;

  while (true) {
    const { data: page, error } = await supabase
      .from('external_catalog_books')
      .select('*')
      .order('title', { ascending: true })
      .order('openlibrary_key', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw cleanErr(error);

    data.push(...(page || []));
    if (!page || page.length < pageSize) break;
    offset += pageSize;
  }

  return (data || []).map((record) => ({
    id: record.openlibrary_key,
    openLibraryKey: record.openlibrary_key,
    title: record.title,
    author: record.author,
    category: normalizeBookCategory(record.category),
    isbn: record.isbn,
    summary: record.summary,
    coverUrl: record.cover_url,
    sourceUrl: record.source_url,
    lastSyncedAt: record.last_synced_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    isExternalCatalog: true,
    availableCopies: 0,
    totalCopies: 0,
  }));
}

// ============================================================================
// BORROW REQUEST — LIBRARY BOOKS
// ============================================================================

export async function requestBorrow(
  visitorId,
  bookId
) {
  const normalizedVisitorId =
    normalizeText(visitorId);

  const normalizedBookId =
    normalizeText(bookId);

  if (!normalizedVisitorId) {
    throw new Error(
      'Visitor ID is required.'
    );
  }

  if (!isValidVisitorId(normalizedVisitorId)) {
    throw new Error(
      'Invalid visitor ID.'
    );
  }

  if (!normalizedBookId) {
    throw new Error(
      'Book ID is required.'
    );
  }

  let {
    data: { user: authenticatedUser },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !authenticatedUser?.id) {
    const {
      data: refreshedAuth,
      error: refreshError,
    } = await supabase.auth.refreshSession();

    authenticatedUser = refreshedAuth?.user;

    if (refreshError || !authenticatedUser?.id) {
      throw new Error(
        'Your visitor sign-in session has expired. Please sign in again before requesting a book.'
      );
    }
  }

  const authenticatedVisitor =
    await getVisitor(authenticatedUser.id);

  if (
    !authenticatedVisitor ||
    (
      normalizedVisitorId !== authenticatedVisitor.id &&
      normalizedVisitorId !== authenticatedUser.id
    )
  ) {
    throw new Error(
      'Your current sign-in does not match this visitor account. Please sign out and sign in again.'
    );
  }

  const {
    data,
    error,
  } =
    await supabase.rpc(
      'request_borrow_v2',
      {
        p_book_id:
          normalizedBookId,
      }
    );

  if (error) {
    console.error('BORROW REQUEST RPC ERROR:');

    const message =
      normalizeText(
        error?.message
      );

    const lowerMessage =
      message.toLowerCase();

    if (
      lowerMessage.includes(
        'visitor not found'
      ) ||
      lowerMessage.includes(
        'visitor does not exist'
      ) ||
      lowerMessage.includes(
        'registration not found'
      )
    ) {
      throw new Error(
        'Visitor account could not be found.'
      );
    }

    if (
      lowerMessage.includes(
        'visitor is inactive'
      ) ||
      lowerMessage.includes(
        'account is inactive'
      )
    ) {
      throw new Error(
        'This visitor account is currently inactive.'
      );
    }

    if (
      lowerMessage.includes(
        'visitor is not verified'
      ) ||
      lowerMessage.includes(
        'not verified'
      ) ||
      lowerMessage.includes(
        'otp_verified'
      )
    ) {
      throw new Error(
        'Please verify your visitor account before requesting a book.'
      );
    }

    if (
      lowerMessage.includes(
        'book not found'
      ) ||
      lowerMessage.includes(
        'book does not exist'
      )
    ) {
      throw new Error(
        'The selected book could not be found.'
      );
    }

    if (
      lowerMessage.includes(
        'no available copies'
      ) ||
      lowerMessage.includes(
        'book is unavailable'
      ) ||
      lowerMessage.includes(
        'not available'
      ) ||
      lowerMessage.includes(
        'available_copies'
      )
    ) {
      throw new Error(
        'This book is currently unavailable.'
      );
    }

    if (
      lowerMessage.includes(
        'already requested'
      ) ||
      lowerMessage.includes(
        'duplicate request'
      ) ||
      lowerMessage.includes(
        'active borrow request'
      ) ||
      lowerMessage.includes(
        'already has a borrow request'
      )
    ) {
      throw new Error(
        'You already have an active borrow request for this book.'
      );
    }

    if (
      lowerMessage.includes(
        'already borrowed'
      )
    ) {
      throw new Error(
        'You already have this book borrowed.'
      );
    }

    if (
      lowerMessage.includes(
        'permission denied'
      ) ||
      lowerMessage.includes(
        'not authorized'
      ) ||
      lowerMessage.includes(
        'unauthorized'
      )
    ) {
      throw new Error(
        'You are not authorized to create a borrow request.'
      );
    }

    if (
      lowerMessage.includes(
        'foreign key'
      )
    ) {
      throw new Error(
        'The selected visitor or book is not valid.'
      );
    }

    if (
      lowerMessage.includes(
        'uuid'
      )
    ) {
      throw new Error(
        'The visitor or book ID is invalid. ' +
          'Visitor: ' +
          normalizedVisitorId +
          ', authenticated visitor: verified, Book: ' +
          normalizedBookId +
          '. Supabase error: ' +
          message +
          '. Check DevTools Network for full error.'
      );
    }

    throw cleanErr(
      error,
      'Unable to create the borrow request. Please try again. ' +
        'Visitor: ' +
        normalizedVisitorId +
        ', Book: ' +
        normalizedBookId +
        '. Check DevTools Network for full error.'
    );
  }

  const row =
    firstRow(data);

  if (!row) {
    throw new Error(
      'Borrow request was not created.'
    );
  }

  if (
    row.id &&
    !isValidUuid(row.id)
  ) {
    console.error('INVALID BORROW REQUEST RETURNED BY RPC:');

    throw new Error(
      'The database returned an invalid borrow request.'
    );
  }

  return mapBorrowRequest(
    row
  );
}

export async function reserveBookForDate(bookId, pickupDate) {
  const normalizedBookId = normalizeText(bookId);
  if (!normalizedBookId) throw new Error('Book ID is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(pickupDate || ''))) {
    throw new Error('Choose a valid pickup date.');
  }
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user?.id) {
    throw new Error('Your visitor sign-in session has expired. Please sign in again.');
  }
  const visitor = await getVisitor(user.id);
  if (!visitor?.id || !visitor.otpVerified || !visitor.isActive) {
    throw new Error('An active, verified visitor account is required.');
  }
  const { data, error } = await supabase.rpc('reserve_book_for_date_v1', {
    p_book_id: normalizedBookId,
    p_pickup_date: pickupDate,
  });
  if (error) throw cleanErr(error, 'Unable to schedule this book reservation.');
  const row = firstRow(data);
  if (!row?.id) throw new Error('The reservation was not created.');
  return mapBorrowRequest(row);
}

// ============================================================================
// CANCEL BORROW REQUEST
// ============================================================================

export async function cancelBorrowRequest(requestId) {
  const normalizedRequestId =
    normalizeText(requestId);

  if (
    !isValidBorrowRequestId(
      normalizedRequestId
    )
  ) {
    throw new Error(
      'Invalid borrow request ID.'
    );
  }

  const {
    data: { user: authenticatedUser },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !authenticatedUser?.id) {
    throw new Error('Your visitor sign-in session has expired. Please sign in again.');
  }

  const authenticatedVisitor = await getVisitor(authenticatedUser.id);
  if (!authenticatedVisitor?.id) {
    throw new Error('Visitor account could not be verified.');
  }

  const {
    error,
  } =
    await supabase.rpc(
      'cancel_borrow_request',
      buildCancelBorrowRequestArgs(normalizedRequestId, authenticatedVisitor.id)
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
    !isValidBorrowRequestId(
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
      'confirm_pickup_v2',
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
    !isValidBorrowRequestId(
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
      'confirm_return_v2',
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
// VISITOR FEEDBACK
// ============================================================================

export async function submitVisitorFeedback({
  visitorId,
  visitorName,
  visitorEmail,
  libraryId,
  category,
  subject,
  message,
}) {
  if (!supabase) {
    throw new Error('Feedback submission is unavailable until Supabase is configured.');
  }

  const normalizedVisitorId = normalizeText(visitorId);
  const normalizedVisitorName = normalizeText(visitorName);
  const normalizedVisitorEmail = normalizeText(visitorEmail);
  const normalizedLibraryId = libraryId ? normalizeText(libraryId) : null;
  const normalizedCategory = normalizeText(category);
  const normalizedSubject = normalizeText(subject);
  const normalizedMessage = normalizeText(message);

  if (!normalizedVisitorId) {
    throw new Error('Visitor ID is required.');
  }
  if (!normalizedVisitorName) {
    throw new Error('Visitor name is required.');
  }
  if (!normalizedCategory) {
    throw new Error('Category is required.');
  }
  if (!normalizedSubject) {
    throw new Error('Subject is required.');
  }
  if (!normalizedMessage) {
    throw new Error('Message is required.');
  }

  const {
    data,
    error,
  } = await supabase
    .from('visitor_feedback')
    .insert({
      visitor_id: normalizedVisitorId,
      visitor_name: normalizedVisitorName,
      visitor_email: normalizedVisitorEmail || null,
      library_id: normalizedLibraryId,
      category: normalizedCategory,
      subject: normalizedSubject,
      message: normalizedMessage,
    })
    .select('id, category, subject, message, library_id, status, admin_reply, replied_at, created_at')
    .single();

  if (error) {
    throw cleanErr(error);
  }

  return data;
}

// ============================================================================
// ANNOUNCEMENTS
// ============================================================================

export async function createAnnouncement({
  title,
  message,
  audience,
  libraryId,
  createdBy,
  expiresAt,
}) {
  if (!supabase) {
    throw new Error('Announcement service is unavailable until Supabase is configured.');
  }

  const normalizedTitle = normalizeText(title);
  const normalizedMessage = normalizeText(message);
  const normalizedAudience = normalizeText(audience);
  const normalizedLibraryId = libraryId ? normalizeText(libraryId) : null;
  const normalizedCreatedBy = normalizeText(createdBy);
  const normalizedExpiresAt = expiresAt ? normalizeText(expiresAt) : null;

  if (!normalizedTitle) {
    throw new Error('Title is required.');
  }
  if (!normalizedMessage) {
    throw new Error('Message is required.');
  }
  if (!normalizedAudience) {
    throw new Error('Audience is required.');
  }
  if (!normalizedCreatedBy) {
    throw new Error('Creator is required.');
  }

  const values = {
    title: normalizedTitle,
    message: normalizedMessage,
    audience: normalizedAudience,
    library_id: normalizedLibraryId,
    created_by: normalizedCreatedBy,
    published: true,
    expires_at: normalizedExpiresAt,
  };

  const {
    data,
    error,
  } = await supabase
    .from('announcements')
    .insert(values)
    .select('*')
    .single();

  if (error) {
    throw cleanErr(error);
  }

  return data;
}

export async function updateAnnouncement(announcementId, {
  title,
  message,
  audience,
  libraryId,
  expiresAt,
}) {
  if (!supabase) {
    throw new Error('Announcement service is unavailable until Supabase is configured.');
  }

  const normalizedAnnouncementId = normalizeText(announcementId);
  const normalizedTitle = normalizeText(title);
  const normalizedMessage = normalizeText(message);
  const normalizedAudience = normalizeText(audience);
  const normalizedLibraryId = libraryId ? normalizeText(libraryId) : null;
  const normalizedExpiresAt = expiresAt ? normalizeText(expiresAt) : null;

  if (!normalizedAnnouncementId) {
    throw new Error('Announcement ID is required.');
  }
  if (!normalizedTitle) {
    throw new Error('Title is required.');
  }
  if (!normalizedMessage) {
    throw new Error('Message is required.');
  }
  if (!normalizedAudience) {
    throw new Error('Audience is required.');
  }

  const values = {
    title: normalizedTitle,
    message: normalizedMessage,
    audience: normalizedAudience,
    library_id: normalizedLibraryId,
    updated_at: new Date().toISOString(),
    expires_at: normalizedExpiresAt,
  };

  const {
    data,
    error,
  } = await supabase
    .from('announcements')
    .update(values)
    .eq('id', normalizedAnnouncementId)
    .select('*')
    .single();

  if (error) {
    throw cleanErr(error);
  }

  return data;
}

// ============================================================================
// DELETE ANNOUNCEMENT
// ============================================================================

export async function deleteAnnouncement(announcementId) {
  if (!supabase) {
    throw new Error('Announcement service is unavailable until Supabase is configured.');
  }

  const normalizedAnnouncementId = normalizeText(announcementId);

  if (!normalizedAnnouncementId) {
    throw new Error('Announcement ID is required.');
  }

  const { error } = await supabase
    .from('announcements')
    .delete()
    .eq('id', normalizedAnnouncementId);

  if (error) {
    throw cleanErr(error);
  }

  return { success: true };
}

// ============================================================================
// SYSTEM TERMS DOCUMENTS
// ============================================================================

export async function upsertSystemTermsDocument({
  documentKey,
  version,
  content,
  updatedBy,
}) {
  if (!supabase) {
    throw new Error('Terms document service is unavailable until Supabase is configured.');
  }

  const normalizedDocumentKey = normalizeText(documentKey);
  const normalizedVersion = normalizeText(version);
  const normalizedContent = normalizeText(content);
  const normalizedUpdatedBy = updatedBy ? normalizeText(updatedBy) : null;

  if (!normalizedDocumentKey) {
    throw new Error('Document key is required.');
  }
  if (!normalizedVersion) {
    throw new Error('Version is required.');
  }
  if (!normalizedContent) {
    throw new Error('Content is required.');
  }

  const {
    data,
    error,
  } = await supabase
    .from('system_terms_documents')
    .upsert({
      document_key: normalizedDocumentKey,
      version: normalizedVersion,
      content: normalizedContent,
      updated_at: new Date().toISOString(),
      updated_by: normalizedUpdatedBy,
    }, { onConflict: 'document_key' })
    .select('*')
    .single();

  if (error) {
    throw cleanErr(error);
  }

  return data;
}

// ============================================================================
// VISITOR NOTIFICATIONS
// ============================================================================

const mapNotification = (r) => ({
  id: r.id,
  type: r.notification_type,
  title: r.title,
  message: r.message,
  referenceId: r.reference_id,
  referenceType: r.reference_type,
  readAt: r.read_at,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
});

export async function fetchVisitorNotifications({ limit = 50, offset = 0, unreadOnly = false } = {}) {
  const { data, error } = await supabase.rpc('get_visitor_notifications', {
    p_limit: limit,
    p_offset: offset,
    p_unread_only: unreadOnly,
  });

  if (error) {
    throw cleanErr(error, 'Unable to load notifications.');
  }

  return (data || []).map(mapNotification);
}

export async function markVisitorNotificationRead(notificationId) {
  const { error } = await supabase.rpc('mark_visitor_notification_read', {
    p_notification_id: notificationId,
  });

  if (error) {
    throw cleanErr(error, 'Unable to mark notification as read.');
  }
}

export async function markAllVisitorNotificationsRead() {
  const { data, error } = await supabase.rpc('mark_all_visitor_notifications_read');

  if (error) {
    throw cleanErr(error, 'Unable to mark all notifications as read.');
  }

  return Number(data) || 0;
}
