import { supabase } from '../lib/supabaseClient.js';

const VISITOR_ACCOUNTS_CACHE_TTL_MS = 15_000;
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
    qrCode: row.qr_code,
    registeredAt: row.registered_at,
  };
}

export function invalidateVisitorAccountsCache() {
  visitorAccountsCache.clear();
}

export async function fetchVisitorAccounts({
  libraryId,
  page = 1,
  pageSize = 10,
  search = '',
} = {}) {
  const {
    data: sessionData,
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw new Error(
      sessionError.message || 'Unable to check the current authentication session.'
    );
  }

  const userId = sessionData?.session?.user?.id;
  if (!userId) {
    throw new Error('Sign in to view visitor accounts.');
  }

  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = Math.min(50, Math.max(1, Math.floor(Number(pageSize) || 10)));
  const normalizedSearch = String(search || '').trim().slice(0, 100);
  const cacheKey = JSON.stringify([
    userId,
    libraryId === undefined ? 'all' : libraryId,
    safePage,
    safePageSize,
    normalizedSearch.toLowerCase(),
  ]);
  const cached = visitorAccountsCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  let query = supabase
    .from('visitors')
    .select(
      'id, full_name, contact_number, email, address, otp_verified, is_active, qr_code, registered_at, library_id',
      { count: 'exact' }
    )
    .order('registered_at', { ascending: false });

  if (libraryId === null) {
    query = query.is('library_id', null);
  } else if (libraryId !== undefined) {
    query = query.eq('library_id', libraryId);
  }

  const safeSearch = normalizedSearch
    .replaceAll(String.fromCharCode(0), ' ')
    .replaceAll('\n', ' ')
    .replaceAll('\r', ' ')
    .replace(/[, %_*()"\\]/g, ' ')
    .trim();
  if (safeSearch) {
    const pattern = `%${safeSearch}%`;
    query = query.or(
      `full_name.ilike.${pattern},email.ilike.${pattern},contact_number.ilike.${pattern}`
    );
  }

  const from = (safePage - 1) * safePageSize;
  const { data, error, count } = await query.range(
    from,
    from + safePageSize - 1
  );

  if (error) {
    throw new Error(error.message || 'Unable to load visitor accounts.');
  }

  const result = {
    visitors: (data || []).map(mapVisitor),
    total: count || 0,
  };
  for (const [key, entry] of visitorAccountsCache) {
    if (entry.expiresAt <= Date.now()) visitorAccountsCache.delete(key);
  }
  if (visitorAccountsCache.size >= 50) {
    const oldestKey = visitorAccountsCache.keys().next().value;
    if (oldestKey !== undefined) visitorAccountsCache.delete(oldestKey);
  }
  visitorAccountsCache.set(cacheKey, {
    value: result,
    expiresAt: Date.now() + VISITOR_ACCOUNTS_CACHE_TTL_MS,
  });
  return result;
}
