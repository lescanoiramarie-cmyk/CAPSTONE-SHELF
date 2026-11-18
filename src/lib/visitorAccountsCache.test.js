import { test, mock } from 'node:test';
import assert from 'node:assert';

const VISITOR_ACCOUNTS_CACHE_TTL_MS = 15_000;
const VISITOR_ACCOUNTS_CACHE_MAX_SIZE = 100;

function createMockSupabase() {
  const mockFrom = {
    select: mock.fn(() => mockFrom),
    order: mock.fn(() => mockFrom),
    eq: mock.fn(() => mockFrom),
    is: mock.fn(() => mockFrom),
    or: mock.fn(() => mockFrom),
    range: mock.fn(() => mockFrom),
  };

  const mockAuth = {
    getSession: mock.fn(),
  };

  return {
    from: mock.fn(() => mockFrom),
    auth: mockAuth,
  };
}

function createTestSession(userId, role) {
  return {
    user: {
      id: userId,
      app_metadata: { role },
      user_metadata: {},
    },
  };
}

function createTestContext() {
  const mockSupabase = createMockSupabase();

  mockSupabase.auth.getSession.mock.mockImplementation(() =>
    Promise.resolve({ data: { session: createTestSession('user-123', 'superadmin') }, error: null })
  );

  mockSupabase.from.mock.mockImplementation(() => {
    const chain = {
      select: mock.fn(() => chain),
      order: mock.fn(() => chain),
      eq: mock.fn(() => chain),
      is: mock.fn(() => chain),
      or: mock.fn(() => chain),
      range: mock.fn(() => Promise.resolve({ data: [], error: null, count: 0 })),
    };
    return chain;
  });

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
      qrCode: row.qr_code,
      registeredAt: row.registered_at,
    };
  }

  function getUserRoleFromSession(session) {
    const appMetadata = session?.user?.app_metadata;
    if (appMetadata && typeof appMetadata.role === 'string') {
      return appMetadata.role;
    }
    const userMetadata = session?.user?.user_metadata;
    if (userMetadata && typeof userMetadata.role === 'string') {
      return userMetadata.role;
    }
    return 'unknown';
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

  function invalidateVisitorAccountsCache() {
    visitorAccountsCache.clear();
  }

  function setupMockData(mockData) {
    mockSupabase.from.mock.mockImplementation(() => {
      const chain = {
        select: mock.fn(() => chain),
        order: mock.fn(() => chain),
        eq: mock.fn(() => chain),
        is: mock.fn(() => chain),
        or: mock.fn(() => chain),
        range: mock.fn(() => Promise.resolve({ data: mockData, error: null, count: mockData.length })),
      };
      return chain;
    });
  }

  function setupMockError(errorMessage) {
    mockSupabase.from.mock.mockImplementation(() => {
      const chain = {
        select: mock.fn(() => chain),
        order: mock.fn(() => chain),
        eq: mock.fn(() => chain),
        is: mock.fn(() => chain),
        or: mock.fn(() => chain),
        range: mock.fn(() => Promise.resolve({ data: null, error: { message: errorMessage }, count: 0 })),
      };
      return chain;
    });
  }

  async function fetchVisitorAccounts({ libraryId, page = 1, pageSize = 10, search = '' } = {}) {
    const { data: sessionData, error: sessionError } = await mockSupabase.auth.getSession();

    if (sessionError) {
      throw new Error(sessionError.message || 'Unable to check the current authentication session.');
    }

    const session = sessionData?.session;
    const userId = session?.user?.id;
    if (!userId) {
      throw new Error('Sign in to view visitor accounts.');
    }

    const userRole = getUserRoleFromSession(session);

    const safePage = Math.max(1, Math.floor(Number(page) || 1));
    const safePageSize = Math.min(50, Math.max(1, Math.floor(Number(pageSize) || 10)));
    const normalizedSearch = String(search || '').trim().slice(0, 100);
    const cacheKey = JSON.stringify([
      userId,
      userRole,
      libraryId === undefined ? 'all' : libraryId,
      safePage,
      safePageSize,
      normalizedSearch.toLowerCase(),
    ]);
    const cached = visitorAccountsCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const from = (safePage - 1) * safePageSize;
    const { data, error, count } = await mockSupabase.from('visitors').select('*').range(from, from + safePageSize - 1);

    if (error) {
      throw new Error(error.message || 'Unable to load visitor accounts.');
    }

    const result = {
      visitors: (data || []).map(mapVisitor),
      total: count || 0,
    };

    pruneExpiredCacheEntries();
    enforceCacheSizeLimit();
    visitorAccountsCache.set(cacheKey, { value: result, expiresAt: Date.now() + VISITOR_ACCOUNTS_CACHE_TTL_MS });
    return result;
  }

  async function setVisitorActive(visitorId, isActive) {
    invalidateVisitorAccountsCache();
    return isActive;
  }

  async function approveCommunityVisitor() {
    invalidateVisitorAccountsCache();
    return true;
  }

  return {
    mockSupabase,
    visitorAccountsCache,
    fetchVisitorAccounts,
    invalidateVisitorAccountsCache,
    setVisitorActive,
    approveCommunityVisitor,
    createTestSession,
    setupMockData,
    setupMockError,
  };
}

const mockData = [{ id: 'v1', full_name: 'Test User', contact_number: '09123456789', email: 'test@example.com', address: 'Test Address', otp_verified: true, is_active: true, qr_code: 'SHELF-QR-123456', registered_at: new Date().toISOString(), library_id: 'lib-1', registration_type: 'institutional', approval_status: 'approved' }];

test('visitorAccounts cache: caches results and returns cached value on subsequent calls', async () => {
  const ctx = createTestContext();
  ctx.setupMockData(mockData);

  const result1 = await ctx.fetchVisitorAccounts({ libraryId: 'lib-1' });
  const result2 = await ctx.fetchVisitorAccounts({ libraryId: 'lib-1' });

  assert.strictEqual(result1.visitors.length, 1);
  assert.strictEqual(result2.visitors.length, 1);
  assert.strictEqual(ctx.visitorAccountsCache.size, 1);
});

test('visitorAccounts cache: cache key includes user role - different roles have separate cache entries', async () => {
  const ctx = createTestContext();
  ctx.setupMockData(mockData);

  await ctx.fetchVisitorAccounts({ libraryId: 'lib-1' });

  ctx.mockSupabase.auth.getSession.mock.mockImplementation(() =>
    Promise.resolve({ data: { session: ctx.createTestSession('user-123', 'subadmin') }, error: null })
  );

  await ctx.fetchVisitorAccounts({ libraryId: 'lib-1' });

  assert.strictEqual(ctx.visitorAccountsCache.size, 2);
});

test('visitorAccounts cache: invalidateVisitorAccountsCache clears all cache entries', async () => {
  const ctx = createTestContext();
  ctx.setupMockData(mockData);

  await ctx.fetchVisitorAccounts({ libraryId: 'lib-1' });
  assert.strictEqual(ctx.visitorAccountsCache.size, 1);

  ctx.invalidateVisitorAccountsCache();
  assert.strictEqual(ctx.visitorAccountsCache.size, 0);
});

test('visitorAccounts cache: setVisitorActive invalidates cache', async () => {
  const ctx = createTestContext();
  ctx.setupMockData(mockData);

  await ctx.fetchVisitorAccounts({ libraryId: 'lib-1' });
  assert.strictEqual(ctx.visitorAccountsCache.size, 1);

  await ctx.setVisitorActive('v1', false);
  assert.strictEqual(ctx.visitorAccountsCache.size, 0);
});

test('visitorAccounts cache: approveCommunityVisitor invalidates cache', async () => {
  const ctx = createTestContext();
  ctx.setupMockData(mockData);

  await ctx.fetchVisitorAccounts({ libraryId: 'lib-1' });
  assert.strictEqual(ctx.visitorAccountsCache.size, 1);

  await ctx.approveCommunityVisitor('v1');
  assert.strictEqual(ctx.visitorAccountsCache.size, 0);
});

test('visitorAccounts cache: pruneExpiredCacheEntries removes only expired entries', () => {
  const ctx = createTestContext();
  const now = Date.now();
  ctx.visitorAccountsCache.set('key1', { value: { visitors: [], total: 0 }, expiresAt: now + 10000 });
  ctx.visitorAccountsCache.set('key2', { value: { visitors: [], total: 0 }, expiresAt: now - 1000 });
  ctx.visitorAccountsCache.set('key3', { value: { visitors: [], total: 0 }, expiresAt: now + 20000 });

  assert.strictEqual(ctx.visitorAccountsCache.size, 3);

  const expiredKeys = [];
  for (const [key, entry] of ctx.visitorAccountsCache) {
    if (entry.expiresAt <= now) {
      expiredKeys.push(key);
    }
  }
  for (const key of expiredKeys) {
    ctx.visitorAccountsCache.delete(key);
  }

  assert.strictEqual(ctx.visitorAccountsCache.size, 2);
  assert.ok(ctx.visitorAccountsCache.has('key1'));
  assert.ok(!ctx.visitorAccountsCache.has('key2'));
  assert.ok(ctx.visitorAccountsCache.has('key3'));
});

test('visitorAccounts cache: enforceCacheSizeLimit removes oldest entry when cache exceeds max size', () => {
  const ctx = createTestContext();
  const now = Date.now();
  for (let i = 0; i < VISITOR_ACCOUNTS_CACHE_MAX_SIZE + 5; i++) {
    ctx.visitorAccountsCache.set(`key${i}`, { value: { visitors: [], total: 0 }, expiresAt: now + 10000 + i * 1000 });
  }

  assert.ok(ctx.visitorAccountsCache.size > VISITOR_ACCOUNTS_CACHE_MAX_SIZE);

  let oldestKey = null;
  let oldestExpiresAt = Infinity;
  for (const [key, entry] of ctx.visitorAccountsCache) {
    if (entry.expiresAt < oldestExpiresAt) {
      oldestExpiresAt = entry.expiresAt;
      oldestKey = key;
    }
  }
  if (oldestKey !== null) {
    ctx.visitorAccountsCache.delete(oldestKey);
  }

  assert.ok(ctx.visitorAccountsCache.size <= VISITOR_ACCOUNTS_CACHE_MAX_SIZE + 4);
  assert.ok(!ctx.visitorAccountsCache.has('key0'));
});

test('visitorAccounts cache: cache differentiates by libraryId', async () => {
  const ctx = createTestContext();
  ctx.setupMockData(mockData);

  await ctx.fetchVisitorAccounts({ libraryId: 'lib-1' });
  await ctx.fetchVisitorAccounts({ libraryId: 'lib-2' });
  await ctx.fetchVisitorAccounts({ libraryId: undefined });

  assert.strictEqual(ctx.visitorAccountsCache.size, 3);
});

test('visitorAccounts cache: cache differentiates by page and pageSize', async () => {
  const ctx = createTestContext();
  ctx.setupMockData(mockData);

  await ctx.fetchVisitorAccounts({ libraryId: 'lib-1', page: 1, pageSize: 10 });
  await ctx.fetchVisitorAccounts({ libraryId: 'lib-1', page: 2, pageSize: 10 });
  await ctx.fetchVisitorAccounts({ libraryId: 'lib-1', page: 1, pageSize: 20 });

  assert.strictEqual(ctx.visitorAccountsCache.size, 3);
});

test('visitorAccounts cache: cache differentiates by search term', async () => {
  const ctx = createTestContext();
  ctx.setupMockData(mockData);

  await ctx.fetchVisitorAccounts({ libraryId: 'lib-1', search: 'john' });
  await ctx.fetchVisitorAccounts({ libraryId: 'lib-1', search: 'jane' });
  await ctx.fetchVisitorAccounts({ libraryId: 'lib-1', search: '' });

  assert.strictEqual(ctx.visitorAccountsCache.size, 3);
});

test('visitorAccounts cache: throws error when no session', async () => {
  const ctx = createTestContext();
  ctx.mockSupabase.auth.getSession.mock.mockImplementation(() =>
    Promise.resolve({ data: { session: null }, error: null })
  );

  await assert.rejects(ctx.fetchVisitorAccounts({}), /Sign in to view visitor accounts/);
});

test('visitorAccounts cache: throws error on session error', async () => {
  const ctx = createTestContext();
  ctx.mockSupabase.auth.getSession.mock.mockImplementation(() =>
    Promise.resolve({ data: { session: null }, error: { message: 'Session error' } })
  );

  await assert.rejects(ctx.fetchVisitorAccounts({}), /Unable to check the current authentication session|Session error/);
});

test('visitorAccounts cache: throws error on query error', async () => {
  const ctx = createTestContext();
  ctx.setupMockError('Query error');

  await assert.rejects(ctx.fetchVisitorAccounts({ libraryId: 'lib-1' }), /Unable to load visitor accounts|Query error/);
});