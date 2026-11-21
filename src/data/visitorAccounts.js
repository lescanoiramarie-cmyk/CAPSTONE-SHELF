import { supabase } from '../lib/supabaseClient.js';

const VISITOR_ACCOUNTS_CACHE_TTL_MS = 15_000;
const VISITOR_ACCOUNTS_CACHE_MAX_SIZE = 100;
const visitorAccountsCache = new Map();

function mapVisitor(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    contactNumber: row.contact_number,
    email: row.email,
    address: row.address,
    libraryId: row.library_id ?? null,
    otpVerified: row.otp_verified,
    isActive: row.is_active,
    registrationType: row.registration_type || 'institutional',
    approvalStatus: row.approval_status || 'approved',
    registeredAt: row.registered_at,
  };
}

export function invalidateVisitorAccountsCache() {
  visitorAccountsCache.clear();
}

export async function setVisitorActive(visitorId, isActive) {
  const { error } = await supabase.rpc('set_visitor_active', {
    p_visitor_id: visitorId,
    p_is_active: isActive,
  });

  if (error) {
    throw new Error(error.message || 'Unable to update visitor account status.');
  }

  invalidateVisitorAccountsCache();
  return isActive;
}

async function approveVisitorWithRpc(rpcName, visitorId, errorMessage) {
  const { data, error } = await supabase.rpc(rpcName, {
    p_visitor_id: visitorId,
  });
  if (error) throw new Error(error.message || errorMessage);
  if (data !== true) throw new Error(errorMessage);
  invalidateVisitorAccountsCache();
  return true;
}

export function approveVisitor(visitorId) {
  return approveVisitorWithRpc(
    'approve_visitor',
    visitorId,
    'Unable to approve this visitor.',
  );
}

export function approveCommunityVisitor(visitorId) {
  return approveVisitorWithRpc(
    'approve_community_visitor',
    visitorId,
    'Unable to approve this community visitor.',
  );
}

function pruneExpiredCacheEntries() {
  const now = Date.now();
  const expiredKeys = [];
  for (const [key, entry] of visitorAccountsCache) {
    if (entry.expiresAt <= now) {
      expiredKeys.push(key);
    }
  }
  for (const key of expiredKeys) {
    visitorAccountsCache.delete(key);
  }
}

function enforceCacheSizeLimit() {
  if (visitorAccountsCache.size < VISITOR_ACCOUNTS_CACHE_MAX_SIZE) {
    return;
  }
  let oldestKey = null;
  let oldestExpiresAt = Infinity;
  for (const [key, entry] of visitorAccountsCache) {
    if (entry.expiresAt < oldestExpiresAt) {
      oldestExpiresAt = entry.expiresAt;
      oldestKey = key;
    }
  }
  if (oldestKey !== null) {
    visitorAccountsCache.delete(oldestKey);
  }
}

export async function fetchVisitorAccounts({
  libraryId,
  page = 1,
  pageSize = 10,
  search = '',
} = {}) {
  // Use the new secure RPC to validate the current user's role
  // with AAL2 enforcement for staff operations.
  const { data: roleData, error: roleError } = await supabase.rpc('get_current_user_role');

  if (roleError) {
    throw new Error(roleError.message || 'Unable to verify your access to visitor accounts.');
  }

  if (!roleData || roleData.length === 0) {
    throw new Error('Sign in to view visitor accounts.');
  }

  const roleInfo = roleData[0];
  const userType = roleInfo.user_type;
  const libraryIdFromRole = roleInfo.library_id;
  const isActive = roleInfo.is_active;

  if (!isActive || (userType !== 'superadmin' && userType !== 'subadmin')) {
    throw new Error('Active library staff access is required to view visitor accounts.');
  }

  // Determine effective library scope:
  // - superadmin: can view all libraries or filter by provided libraryId
  // - subadmin: scoped to their assigned branch (libraryIdFromRole)
  let effectiveLibraryId = libraryId;
  if (userType === 'subadmin') {
    if (libraryId !== undefined && libraryId !== null && libraryId !== libraryIdFromRole) {
      throw new Error('You can only view visitors from your assigned branch.');
    }
    effectiveLibraryId = libraryIdFromRole;
  }

  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = Math.min(50, Math.max(1, Math.floor(Number(pageSize) || 10)));
  const normalizedSearch = String(search || '').trim().slice(0, 100);
  const cacheKey = JSON.stringify([
    roleInfo.visitor_id || roleInfo.role, // Use role as cache key basis
    userType,
    effectiveLibraryId === undefined ? 'all' : effectiveLibraryId,
    safePage,
    safePageSize,
    normalizedSearch.toLowerCase(),
  ]);
  const cached = visitorAccountsCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const safeSearch = normalizedSearch
    .replaceAll(String.fromCharCode(0), ' ')
    .replaceAll('\n', ' ')
    .replaceAll('\r', ' ')
    .replace(/[, %_*()"\\]/g, ' ')
    .trim();
  const from = (safePage - 1) * safePageSize;
  const { data, error } = await supabase.rpc('list_visitor_accounts_v2', {
    p_filter_library: effectiveLibraryId !== undefined,
    p_library_id: effectiveLibraryId ?? null,
    p_visitor_id: null,
    p_search: safeSearch || null,
    p_offset: from,
    p_limit: safePageSize,
  });

  if (error) {
    throw new Error(error.message || 'Unable to load visitor accounts.');
  }

  const rows = Array.isArray(data) ? data : [];
  const result = {
    visitors: rows.map(mapVisitor),
    total: Number(rows[0]?.total_count) || 0,
  };

  pruneExpiredCacheEntries();
  enforceCacheSizeLimit();
  visitorAccountsCache.set(cacheKey, {
    value: result,
    expiresAt: Date.now() + VISITOR_ACCOUNTS_CACHE_TTL_MS,
  });
  return result;
}