import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';

// These are genuine Auth + PostgREST tests. The dedicated isolated local stack
// is enabled by setting SHELF_AUTH_TEST_URL, SHELF_AUTH_TEST_ANON_KEY, and
// SHELF_AUTH_TEST_SERVICE_ROLE_KEY in the test process. No JWTs are fabricated.
const url = process.env.SHELF_AUTH_TEST_URL;
const anonKey = process.env.SHELF_AUTH_TEST_ANON_KEY;
const serviceKey = process.env.SHELF_AUTH_TEST_SERVICE_ROLE_KEY;
const dbContainer = process.env.SHELF_AUTH_TEST_DB_CONTAINER;
const execFileAsync = promisify(execFile);
const enabled = Boolean(url && anonKey && serviceKey
  && dbContainer === 'supabase_db_shelf-ilms-auth-release-20261120'
  && process.env.SHELF_AUTH_TEST_ENVIRONMENT === 'isolated-local');
const state = { users: [], visitors: [], libraries: [], books: [], requests: [], payments: [], fineRequests: [], sessions: {} };
const runId = randomBytes(8).toString('hex');
const syntheticPassword = randomBytes(32).toString('base64url');

function jwtClaims(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

function base32Bytes(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = value.replace(/=+$/g, '').toUpperCase();
  let bits = '';
  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Local Auth returned an invalid TOTP secret format.');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret, now = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac('sha1', base32Bytes(secret)).update(counter).digest();
  const offset = digest.at(-1) & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function request(path, { method = 'GET', body, token = anonKey, admin = false } = {}) {
  const bearer = admin ? serviceKey : token;
  const headers = { apikey: admin ? serviceKey : anonKey, Authorization: `Bearer ${bearer}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method === 'POST' && path.startsWith('/rest/v1/')) headers.Prefer = 'return=representation';
  let response;
  try {
    response = await fetch(new URL(path, url), {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error('Isolated Auth/PostgREST endpoint was unreachable.');
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* Keep malformed bodies unavailable to diagnostics. */ }
  return { status: response.status, ok: response.ok, data };
}

function assertAllowed(response, description) {
  const code = typeof response.data?.code === 'string' ? ` (${response.data.code})` : '';
  const detail = typeof response.data?.message === 'string'
    ? `: ${response.data.message
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
      .replace(/REQ-[A-Z0-9-]+/gi, '[request-id]')
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '[uuid]')
      .replace(/\b\d{7,}\b/g, '[number]')}`
    : '';
  assert.ok(response.ok, `${description} returned HTTP ${response.status}${code}${detail}`);
}

function assertDenied(response, description) {
  assert.ok(!response.ok || (Array.isArray(response.data) && response.data.length === 0),
    `${description} unexpectedly succeeded`);
}

function visitor(alias) { return state.visitors.find((row) => row.alias === alias); }

async function makeAccount(alias, role, { registrationType, approvalStatus, active, otpVerified = true } = {}) {
  const email = `${alias}-${runId}@shelf-test.invalid`;
  const created = await request('/auth/v1/admin/users', {
    method: 'POST', admin: true,
    body: {
      email, password: syntheticPassword, email_confirm: true,
      app_metadata: { role }, user_metadata: { full_name: `Synthetic ${alias}` },
    },
  });
  assertAllowed(created, `create synthetic Auth user (${alias})`);
  const userId = created.data?.id;
  assert.ok(userId, `Auth did not return an id for synthetic account ${alias}`);
  state.users.push({ alias, id: userId, email, role });

  if (registrationType) {
    const qrCode = `SHELF-QR-${String(randomBytes(4).readUInt32BE() % 1_000_000).padStart(6, '0')}`;
    const inserted = await request('/rest/v1/visitors', {
      method: 'POST', admin: true,
      body: {
        auth_user_id: userId,
        full_name: `Synthetic ${alias}`,
        email,
        contact_number: '09000000000',
        address: 'Isolated release test fixture',
        library_id: state.libraries[0].id,
        otp_verified: otpVerified,
        is_active: active,
        qr_code: qrCode,
        registration_type: registrationType,
        approval_status: approvalStatus,
      },
    });
    assertAllowed(inserted, `create synthetic visitor profile (${alias})`);
    state.visitors.push({ alias, userId, id: inserted.data?.[0]?.id, qrCode });
    assert.ok(state.visitors.at(-1).id, `visitor fixture missing id (${alias})`);
  }
}

async function passwordSession(account) {
  const response = await request('/auth/v1/token?grant_type=password', {
    method: 'POST', body: { email: account.email, password: syntheticPassword },
  });
  assertAllowed(response, `password login (${account.alias})`);
  assert.ok(response.data?.access_token, `Auth returned no session for ${account.alias}`);
  return response.data;
}

async function enrollAal2(account, aal1Session) {
  let factorId = account.totpFactorId;
  let secret = account.totpSecret;
  if (!factorId) {
    const factor = await request('/auth/v1/factors', {
      method: 'POST', token: aal1Session.access_token,
      body: { factor_type: 'totp', friendly_name: `Isolated ${account.alias} release test` },
    });
    assertAllowed(factor, `enroll TOTP for ${account.alias}`);
    factorId = factor.data.id;
    secret = factor.data.totp.secret;
    account.totpFactorId = factorId;
    account.totpSecret = secret;
  }
  const challenge = await request(`/auth/v1/factors/${factorId}/challenge`, {
    method: 'POST', token: aal1Session.access_token, body: {},
  });
  assertAllowed(challenge, `challenge TOTP for ${account.alias}`);
  const verified = await request(`/auth/v1/factors/${factorId}/verify`, {
    method: 'POST', token: aal1Session.access_token,
    body: { challenge_id: challenge.data.id, code: totp(secret) },
  });
  assertAllowed(verified, `verify TOTP for ${account.alias}`);
  assert.equal(jwtClaims(verified.data.access_token).aal, 'aal2', 'Auth must issue an AAL2 token');
  return verified.data;
}

async function setup() {
  const branchA = await request('/rest/v1/libraries', {
    method: 'POST', admin: true,
    body: { name: `SHELF isolated test A ${runId}`, email_domain: 'shelf-test.invalid', status: 'Open' },
  });
  assertAllowed(branchA, 'create synthetic branch A');
  state.libraries.push({ id: branchA.data?.[0]?.id });
  assert.ok(state.libraries[0].id, 'synthetic branch A id missing');
  const branchB = await request('/rest/v1/libraries', {
    method: 'POST', admin: true,
    body: { name: `SHELF isolated test B ${runId}`, email_domain: 'shelf-test.invalid', status: 'Open' },
  });
  assertAllowed(branchB, 'create synthetic branch B');
  state.libraries.push({ id: branchB.data?.[0]?.id });

  await makeAccount('institutional', 'visitor', {
    registrationType: 'institutional', approvalStatus: 'approved', active: true,
  });
  await makeAccount('community_pending', 'visitor', {
    registrationType: 'community', approvalStatus: 'pending', active: false,
  });
  await makeAccount('institutional_pending', 'visitor', {
    registrationType: 'institutional', approvalStatus: 'pending', active: false,
  });
  await makeAccount('institutional_unverified', 'visitor', {
    registrationType: 'institutional', approvalStatus: 'pending', active: false, otpVerified: false,
  });
  await makeAccount('community_approved', 'visitor', {
    registrationType: 'community', approvalStatus: 'approved', active: true,
  });
  await makeAccount('subadmin', 'subadmin');
  await makeAccount('subadmin_branch_b', 'subadmin');
  await makeAccount('superadmin', 'superadmin');

  for (const account of state.users.filter((item) => ['subadmin', 'subadmin_branch_b', 'superadmin'].includes(item.alias))) {
    const staff = await request('/rest/v1/staff_profiles', {
      method: 'POST', admin: true,
      body: {
        id: account.id, email: account.email, full_name: `Synthetic ${account.alias}`,
        role: account.alias === 'superadmin' ? 'superadmin' : 'subadmin',
        library_id: account.alias === 'superadmin'
          ? null
          : account.alias === 'subadmin_branch_b'
            ? state.libraries[1].id
            : state.libraries[0].id,
        is_active: true,
      },
    });
    assertAllowed(staff, `create synthetic staff profile (${account.alias})`);
  }

  const book = await request('/rest/v1/books', {
    method: 'POST', admin: true,
    body: {
      title: `Synthetic release test book ${runId}`, author: 'Synthetic Test',
      library_id: state.libraries[0].id, book_type: 'library', is_public: false,
      total_copies: 2, available_copies: 2, lending_enabled: true, fine_rate: 10,
    },
  });
  assertAllowed(book, 'create synthetic book');
  state.books.push({ id: book.data?.[0]?.id });
  assert.ok(state.books[0].id, 'synthetic book id missing');
  const otherBook = await request('/rest/v1/books', {
    method: 'POST', admin: true,
    body: {
      title: `Synthetic other-branch test book ${runId}`, author: 'Synthetic Test',
      library_id: state.libraries[1].id, book_type: 'library', is_public: false,
      total_copies: 1, available_copies: 1, lending_enabled: true, fine_rate: 10,
    },
  });
  assertAllowed(otherBook, 'create synthetic other-branch book');
  state.books.push({ id: otherBook.data?.[0]?.id });
  assert.ok(state.books[1].id, 'synthetic other-branch book id missing');
  const fineBook = await request('/rest/v1/books', {
    method: 'POST', admin: true,
    body: {
      title: `Synthetic fine-only test book ${runId}`, author: 'Synthetic Test',
      library_id: state.libraries[0].id, book_type: 'library', is_public: false,
      total_copies: 1, available_copies: 0, lending_enabled: true, fine_rate: 10,
    },
  });
  assertAllowed(fineBook, 'create synthetic fine-only book');
  state.books.push({ id: fineBook.data?.[0]?.id });
  assert.ok(state.books[2].id, 'synthetic fine-only book id missing');

  for (const [bookIndex, branchIndex] of [[2, 0], [1, 1]]) {
    const fineRequest = await request('/rest/v1/borrow_requests', {
      method: 'POST', admin: true,
      body: {
        book_id: state.books[bookIndex].id,
        book_title: `Synthetic fine fixture ${runId}-${bookIndex}`,
        visitor_id: visitor('institutional').id,
        visitor_name: 'Synthetic institutional visitor',
        status: 'borrowed', library_id: state.libraries[branchIndex].id,
        borrow_date: new Date(Date.now() - 30 * 86_400_000).toISOString(),
        due_date: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        fine_amount: 0, fine_paid_amount: 0, fine_rate_snapshot: 10,
      },
    });
    assertAllowed(fineRequest, 'create synthetic overdue fine fixture');
    const row = fineRequest.data?.[0];
    assert.ok(row?.id, 'synthetic fine request id missing');
    state.fineRequests.push({ id: row.id, branchIndex });
    state.requests.push(row.id);
  }

  for (const account of state.users) account.aal1 = await passwordSession(account);
  for (const alias of ['subadmin', 'subadmin_branch_b', 'superadmin']) {
    const account = state.users.find((item) => item.alias === alias);
    account.aal2 = await enrollAal2(account, account.aal1);
  }
  state.sessions = Object.fromEntries(state.users.map((account) => [account.alias, account]));
}

async function cleanup() {
  if (!enabled) return;
  const sql = `
    BEGIN;
    DELETE FROM public.fine_payment_idempotency
      WHERE received_by IN (SELECT id FROM public.staff_profiles WHERE email LIKE '%-${runId}@shelf-test.invalid');
    DELETE FROM public.fine_payments
      WHERE received_by IN (SELECT id FROM public.staff_profiles WHERE email LIKE '%-${runId}@shelf-test.invalid')
         OR borrow_request_id IN (
           SELECT request.id::text FROM public.borrow_requests AS request
           JOIN public.books AS book ON book.id = request.book_id
           WHERE book.title LIKE '%${runId}%'
         );
    DELETE FROM public.borrow_requests
      WHERE book_id IN (SELECT id FROM public.books WHERE title LIKE '%${runId}%')
         OR visitor_id IN (SELECT id FROM public.visitors WHERE email LIKE '%-${runId}@shelf-test.invalid');
    DELETE FROM public.books WHERE title LIKE '%${runId}%';
    DELETE FROM auth.users WHERE email LIKE '%-${runId}@shelf-test.invalid';
    DELETE FROM public.libraries WHERE name LIKE '%${runId}%';
    COMMIT;
  `;
  try {
    await execFileAsync('docker', [
      'exec', dbContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql,
    ], { windowsHide: true, timeout: 20_000 });
  } catch {
    throw new Error('Synthetic Auth/PostgREST fixture cleanup failed in the dedicated isolated database.');
  }
}

before(async () => { if (enabled) await setup(); });
after(async () => { if (enabled) await cleanup(); });

function authTest(name, fn) {
  test(name, { skip: !enabled }, fn);
}

authTest('auth-role regression: institutional visitor receives a real AAL1 Auth session', async () => {
  const session = state.sessions.institutional.aal1;
  assert.equal(jwtClaims(session.access_token).aal, 'aal1');
  assert.equal(jwtClaims(session.access_token).app_metadata.role, 'visitor');
  assertAllowed(await request('/auth/v1/user', { token: session.access_token }), 'verify institutional Auth session');
});
authTest('auth-role regression: institutional visitor can read only their own profile', async () => {
  const own = visitor('institutional');
  const mine = await request(`/rest/v1/visitors?auth_user_id=eq.${own.userId}&select=id`, { token: state.sessions.institutional.aal1.access_token });
  assertAllowed(mine, 'read own institutional visitor profile');
  assert.equal(mine.data.length, 1);
  const other = await request(`/rest/v1/visitors?id=eq.${visitor('community_approved').id}&select=id`, { token: state.sessions.institutional.aal1.access_token });
  assert.equal(other.status, 200);
  assert.equal(other.data.length, 0, 'RLS must hide another visitor profile');
});
authTest('auth-role regression: institutional visitor cannot read staff profiles', async () => {
  const result = await request('/rest/v1/staff_profiles?select=id', { token: state.sessions.institutional.aal1.access_token });
  assertDenied(result, 'institutional visitor staff profile query');
});
authTest('auth-role regression: institutional visitor is denied staff dashboard RPC', async () => {
  assertDenied(await request('/rest/v1/rpc/get_fine_payment_dashboard', {
    method: 'POST', token: state.sessions.institutional.aal1.access_token, body: { p_library_id: state.libraries[0].id },
  }), 'institutional visitor fine dashboard');
});
authTest('auth-role regression: institutional visitor cannot create notifications for another visitor', async () => {
  assertDenied(await request('/rest/v1/rpc/create_visitor_notification', {
    method: 'POST', token: state.sessions.institutional.aal1.access_token,
    body: { p_visitor_id: visitor('community_approved').id, p_notification_type: 'test', p_title: 'test', p_message: 'test', p_reference_id: null, p_reference_type: null, p_expires_at: null },
  }), 'institutional visitor notification RPC');
});

authTest('auth-role regression: community pending visitor receives a real visitor AAL1 session', async () => {
  const token = state.sessions.community_pending.aal1.access_token;
  assert.equal(jwtClaims(token).aal, 'aal1');
  assert.equal(jwtClaims(token).app_metadata.role, 'visitor');
  assertAllowed(await request('/auth/v1/user', { token }), 'verify pending visitor Auth session');
});
for (const alias of ['institutional_pending', 'community_pending']) {
  authTest(`visitor privacy regression: ${alias} reads only its own approval status`, async () => {
    const row = visitor(alias);
    const token = state.sessions[alias].aal1.access_token;
    const status = await request('/rest/v1/rpc/get_my_visitor_approval_status', {
      method: 'POST', token, body: {},
    });
    assertAllowed(status, `${alias} approval status RPC`);
    assert.equal(status.data.length, 1);
    assert.deepEqual(Object.keys(status.data[0]).sort(), [
      'approval_status', 'is_active', 'otp_verified', 'registration_type',
    ]);
    assert.equal(status.data[0].registration_type, alias === 'community_pending' ? 'community' : 'institutional');
    assert.equal(status.data[0].approval_status, 'pending');
    assert.equal(status.data[0].otp_verified, true);
    assert.equal(status.data[0].is_active, false);

    const directStatus = await request(`/rest/v1/visitors?auth_user_id=eq.${row.userId}&select=id,approval_status,is_active`, { token });
    assertAllowed(directStatus, `${alias} direct status query`);
    assert.deepEqual(directStatus.data, [], 'pending visitor rows must not be directly readable');

    const privateColumns = await request(`/rest/v1/visitors?auth_user_id=eq.${row.userId}&select=email,full_name,address,qr_code,profile_image_path`, { token });
    assertDenied(privateColumns, `${alias} private-column query`);
    const legacyProfile = await request('/rest/v1/rpc/get_visitor_profile', {
      method: 'POST', token, body: {},
    });
    assertDenied(legacyProfile, `${alias} legacy full-profile RPC`);
    const otherStatus = await request('/rest/v1/rpc/get_my_visitor_approval_status', {
      method: 'POST', token, body: { p_visitor_id: visitor('community_approved').id },
    });
    assertDenied(otherStatus, `${alias} supplied-other-visitor status query`);
  });
}
authTest('visitor privacy regression: OTP-unverified visitor cannot read approval status', async () => {
  assertDenied(await request('/rest/v1/rpc/get_my_visitor_approval_status', {
    method: 'POST', token: state.sessions.institutional_unverified.aal1.access_token, body: {},
  }), 'OTP-unverified visitor approval status');
});
authTest('auth-role regression: community pending visitor retains public catalog read access only', async () => {
  const catalog = await request(`/rest/v1/books?id=eq.${encodeURIComponent(state.books[0].id)}&select=id`, { token: state.sessions.community_pending.aal1.access_token });
  assertAllowed(catalog, 'read public catalog');
  assert.equal(catalog.data.length, 1, 'catalog policy permits read-only OPAC access');
});
authTest('auth-role regression: community pending visitor cannot create a borrow request', async () => {
  assertDenied(await request('/rest/v1/rpc/request_borrow_v2', {
    method: 'POST', token: state.sessions.community_pending.aal1.access_token, body: { p_book_id: state.books[0].id },
  }), 'pending visitor borrowing');
});
authTest('auth-role regression: community pending visitor cannot view fine analytics', async () => {
  assertDenied(await request('/rest/v1/rpc/get_fine_payment_analytics', {
    method: 'POST', token: state.sessions.community_pending.aal1.access_token, body: { p_library_id: state.libraries[0].id },
  }), 'pending visitor fine analytics');
});
authTest('visitor approval regression: pending institutional visitor cannot borrow', async () => {
  assertDenied(await request('/rest/v1/rpc/request_borrow_v2', {
    method: 'POST', token: state.sessions.institutional_pending.aal1.access_token,
    body: { p_book_id: state.books[0].id },
  }), 'pending institutional visitor borrowing');
});

authTest('auth-role regression: community approved visitor receives a real AAL1 session', async () => {
  const token = state.sessions.community_approved.aal1.access_token;
  assert.equal(jwtClaims(token).aal, 'aal1');
  assert.equal(jwtClaims(token).app_metadata.role, 'visitor');
  assertAllowed(await request('/auth/v1/user', { token }), 'verify approved community Auth session');
});
authTest('auth-role regression: community approved visitor profile is active and scoped', async () => {
  const row = visitor('community_approved');
  const result = await request('/rest/v1/rpc/get_my_visitor_profile_v2', {
    method: 'POST', token: state.sessions.community_approved.aal1.access_token, body: {},
  });
  assertAllowed(result, 'read approved visitor profile');
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].id, row.id);
  assert.equal(result.data[0].approval_status, 'approved');
  assert.equal(result.data[0].is_active, true);
  const privateColumns = await request(`/rest/v1/visitors?auth_user_id=eq.${row.userId}&select=email,full_name,address,qr_code`, {
    token: state.sessions.community_approved.aal1.access_token,
  });
  assertDenied(privateColumns, 'approved visitor direct private-column query');
});
authTest('auth-role regression: approved community visitor can submit a borrowing request', async () => {
  const result = await request('/rest/v1/rpc/request_borrow_v2', {
    method: 'POST', token: state.sessions.community_approved.aal1.access_token, body: { p_book_id: state.books[0].id },
  });
  assertAllowed(result, 'approved visitor borrow request');
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  assert.ok(row?.id, 'borrow RPC must return the created request id');
  state.requests.push(row.id);
  state.borrowRequest = row;
});
authTest('auth-role regression: approved visitor can read their request but not another visitor request', async () => {
  assert.ok(state.borrowRequest?.id, 'approved visitor request fixture is required');
  const own = await request(`/rest/v1/borrow_requests?id=eq.${encodeURIComponent(state.borrowRequest.id)}&select=id,visitor_id`, { token: state.sessions.community_approved.aal1.access_token });
  assertAllowed(own, 'read own borrow request');
  assert.equal(own.data.length, 1);
  assert.equal(own.data[0].visitor_id, visitor('community_approved').id);
  const other = await request(`/rest/v1/borrow_requests?id=eq.${encodeURIComponent(state.borrowRequest.id)}&visitor_id=eq.${encodeURIComponent(visitor('institutional').id)}&select=id`, { token: state.sessions.institutional.aal1.access_token });
  assertAllowed(other, 'cross-visitor borrow request query');
  assert.equal(other.data.length, 0);
});
authTest('auth-role regression: approved visitor cannot access individual fine payment records', async () => {
  const result = await request('/rest/v1/fine_payments?select=id,amount', { token: state.sessions.community_approved.aal1.access_token });
  assertDenied(result, 'visitor fine payment table query');
});
authTest('auth-role regression: approved visitor cannot call staff attendance lookup', async () => {
  assertDenied(await request('/rest/v1/rpc/lookup_attendance_visitor_v2', {
    method: 'POST', token: state.sessions.community_approved.aal1.access_token,
    body: { p_qr: visitor('institutional').id, p_library_id: state.libraries[0].id },
  }), 'visitor attendance lookup');
});

authTest('auth-role regression: subadmin password session is genuine AAL1 and carries matching role', async () => {
  const token = state.sessions.subadmin.aal1.access_token;
  assert.equal(jwtClaims(token).aal, 'aal1');
  assert.equal(jwtClaims(token).app_metadata.role, 'subadmin');
  assertAllowed(await request('/auth/v1/user', { token }), 'verify subadmin AAL1 session');
});
authTest('auth-role regression: subadmin privileged attendance lookup rejects AAL1', async () => {
  assertDenied(await request('/rest/v1/rpc/lookup_attendance_visitor_v2', {
    method: 'POST', token: state.sessions.subadmin.aal1.access_token,
    body: { p_qr: visitor('institutional').id, p_library_id: state.libraries[0].id },
  }), 'subadmin AAL1 attendance lookup');
});
authTest('auth-role regression: verified subadmin TOTP session is genuine AAL2', async () => {
  const token = state.sessions.subadmin.aal2.access_token;
  assert.equal(jwtClaims(token).aal, 'aal2');
  assert.equal(jwtClaims(token).app_metadata.role, 'subadmin');
  assertAllowed(await request('/auth/v1/user', { token }), 'verify subadmin AAL2 session');
});
authTest('visitor privacy regression: AAL2 Sub-Admin reads only visitor accounts in the assigned branch', async () => {
  const token = state.sessions.subadmin.aal2.access_token;
  const ownBranch = await request('/rest/v1/rpc/list_visitor_accounts_v2', {
    method: 'POST', token,
    body: {
      p_filter_library: true, p_library_id: state.libraries[0].id,
      p_visitor_id: null, p_search: null, p_offset: 0, p_limit: 100,
    },
  });
  assertAllowed(ownBranch, 'assigned Sub-Admin visitor list');
  assert.ok(ownBranch.data.length > 0);
  assert.ok(ownBranch.data.every((row) => row.library_id === state.libraries[0].id));

  assertDenied(await request('/rest/v1/rpc/list_visitor_accounts_v2', {
    method: 'POST', token,
    body: {
      p_filter_library: true, p_library_id: state.libraries[1].id,
      p_visitor_id: null, p_search: null, p_offset: 0, p_limit: 100,
    },
  }), 'cross-branch visitor-list RPC');
  assertDenied(await request('/rest/v1/rpc/list_visitor_accounts_v2', {
    method: 'POST', token: state.sessions.subadmin.aal1.access_token,
    body: {
      p_filter_library: true, p_library_id: state.libraries[0].id,
      p_visitor_id: null, p_search: null, p_offset: 0, p_limit: 100,
    },
  }), 'AAL1 visitor-list RPC');
});
authTest('visitor privacy regression: AAL2 Super-Admin retains read-only system-wide visitor listing', async () => {
  const result = await request('/rest/v1/rpc/list_visitor_accounts_v2', {
    method: 'POST', token: state.sessions.superadmin.aal2.access_token,
    body: {
      p_filter_library: false, p_library_id: null,
      p_visitor_id: null, p_search: null, p_offset: 0, p_limit: 100,
    },
  });
  assertAllowed(result, 'Super-Admin visitor list');
  assert.ok(result.data.some((row) => row.library_id === state.libraries[0].id));
  assert.ok(result.data.some((row) => row.library_id === state.libraries[1].id));
});
authTest('auth-role regression: subadmin can look up an active same-branch synthetic visitor', async () => {
  const result = await request('/rest/v1/rpc/lookup_attendance_visitor_v2', {
    method: 'POST', token: state.sessions.subadmin.aal2.access_token,
    body: { p_qr: visitor('institutional').qrCode, p_library_id: state.libraries[0].id },
  });
  assertAllowed(result, 'subadmin same-branch QR lookup');
  assert.equal(result.data?.[0]?.id, visitor('institutional').id);
});
authTest('auth-role regression: subadmin QR check-in and check-out use the real attendance RPC', async () => {
  const first = await request('/rest/v1/rpc/toggle_attendance', {
    method: 'POST', token: state.sessions.subadmin.aal2.access_token,
    body: { p_qr: visitor('institutional').qrCode, p_library_id: state.libraries[0].id },
  });
  assertAllowed(first, 'synthetic QR check-in');
  assert.equal(first.data?.[0]?.action, 'checked_in');
  assert.equal(first.data?.[0]?.visitor_id, visitor('institutional').id);
  const second = await request('/rest/v1/rpc/toggle_attendance', {
    method: 'POST', token: state.sessions.subadmin.aal2.access_token,
    body: { p_qr: visitor('institutional').qrCode, p_library_id: state.libraries[0].id },
  });
  assertAllowed(second, 'synthetic QR check-out');
  assert.equal(second.data?.[0]?.action, 'checked_out');
  assert.equal(second.data?.[0]?.log_id, first.data?.[0]?.log_id);
});
authTest('auth-role regression: subadmin cannot look up another branch', async () => {
  assertDenied(await request('/rest/v1/rpc/lookup_attendance_visitor_v2', {
    method: 'POST', token: state.sessions.subadmin.aal2.access_token,
    body: { p_qr: visitor('institutional').qrCode, p_library_id: state.libraries[1].id },
  }), 'subadmin cross-branch QR lookup');
});
authTest('visitor approval regression: pending institutional QR is not usable before approval', async () => {
  const pending = visitor('institutional_pending');
  assertDenied(await request('/rest/v1/rpc/lookup_attendance_visitor_v2', {
    method: 'POST', token: state.sessions.subadmin.aal2.access_token,
    body: { p_qr: pending.qrCode, p_library_id: state.libraries[0].id },
  }), 'pending institutional QR lookup');
});
authTest('visitor approval regression: AAL1 cannot approve an institutional visitor', async () => {
  assertDenied(await request('/rest/v1/rpc/approve_visitor', {
    method: 'POST', token: state.sessions.subadmin.aal1.access_token,
    body: { p_visitor_id: visitor('institutional_pending').id },
  }), 'AAL1 institutional visitor approval');
});
authTest('visitor approval regression: wrong-branch Sub-Admin cannot approve', async () => {
  assertDenied(await request('/rest/v1/rpc/approve_visitor', {
    method: 'POST', token: state.sessions.subadmin_branch_b.aal2.access_token,
    body: { p_visitor_id: visitor('institutional_pending').id },
  }), 'cross-branch institutional visitor approval');
});
authTest('visitor approval regression: OTP-unverified institutional visitor cannot be approved', async () => {
  assertDenied(await request('/rest/v1/rpc/approve_visitor', {
    method: 'POST', token: state.sessions.subadmin.aal2.access_token,
    body: { p_visitor_id: visitor('institutional_unverified').id },
  }), 'unverified institutional visitor approval');
});
authTest('visitor approval regression: activation RPC cannot bypass pending approval', async () => {
  assertDenied(await request('/rest/v1/rpc/set_visitor_active', {
    method: 'POST', token: state.sessions.subadmin.aal2.access_token,
    body: { p_visitor_id: visitor('institutional_pending').id, p_is_active: true },
  }), 'pending institutional direct activation');
});
authTest('visitor approval regression: visitor cannot approve its own account', async () => {
  const account = state.sessions.institutional_pending;
  account.aal2 = await enrollAal2(account, account.aal1);
  assertDenied(await request('/rest/v1/rpc/approve_visitor', {
    method: 'POST', token: account.aal2.access_token,
    body: { p_visitor_id: visitor('institutional_pending').id },
  }), 'institutional visitor self-approval');
});
authTest('visitor approval regression: assigned AAL2 Sub-Admin approves institutional visitor once', async () => {
  const pending = visitor('institutional_pending');
  const result = await request('/rest/v1/rpc/approve_visitor', {
    method: 'POST', token: state.sessions.subadmin.aal2.access_token,
    body: { p_visitor_id: pending.id },
  });
  assertAllowed(result, 'assigned Sub-Admin institutional visitor approval');
  assert.equal(result.data, true);

  const rows = await request(`/rest/v1/visitors?id=eq.${encodeURIComponent(pending.id)}&select=approval_status,is_active,otp_verified`, {
    token: state.sessions.subadmin.aal2.access_token,
  });
  assertAllowed(rows, 'read approved institutional status');
  assert.deepEqual(rows.data, [{ approval_status: 'approved', is_active: true, otp_verified: true }]);

  const existingRows = await request(`/rest/v1/visitors?id=eq.${encodeURIComponent(visitor('institutional').id)}&select=approval_status,is_active`, {
    token: state.sessions.subadmin.aal2.access_token,
  });
  assertAllowed(existingRows, 'read existing institutional visitor status');
  assert.deepEqual(existingRows.data, [{ approval_status: 'approved', is_active: true }]);
});
authTest('visitor approval regression: repeated approval fails safely', async () => {
  assertDenied(await request('/rest/v1/rpc/approve_visitor', {
    method: 'POST', token: state.sessions.subadmin.aal2.access_token,
    body: { p_visitor_id: visitor('institutional_pending').id },
  }), 'repeated institutional visitor approval');
});
authTest('visitor approval regression: community compatibility RPC still approves community visitors', async () => {
  const pending = visitor('community_pending');
  const result = await request('/rest/v1/rpc/approve_community_visitor', {
    method: 'POST', token: state.sessions.subadmin.aal2.access_token,
    body: { p_visitor_id: pending.id },
  });
  assertAllowed(result, 'community compatibility approval');
  assert.equal(result.data, true);
});
authTest('auth-role regression: subadmin cannot manage staff through direct table access', async () => {
  assertDenied(await request('/rest/v1/staff_profiles', {
    method: 'POST', token: state.sessions.subadmin.aal2.access_token,
    body: { id: state.sessions.subadmin.id, email: 'forged@shelf-test.invalid', full_name: 'Forged', role: 'superadmin' },
  }), 'subadmin direct staff profile mutation');
});
authTest('auth-role regression: subadmin handover accepts the actual generated text request id', async () => {
  assert.ok(state.borrowRequest?.id, 'borrow request from approved community visitor is required');
  const result = await request('/rest/v1/rpc/confirm_pickup_v2', {
    method: 'POST', token: state.sessions.subadmin.aal2.access_token,
    body: { p_request_id: state.borrowRequest.id, p_staff_name: 'Synthetic Subadmin' },
  });
  assertAllowed(result, 'same-branch pickup confirmation');
});
authTest('auth-role regression: subadmin return confirmation keeps workflow and privacy intact', async () => {
  assert.ok(state.borrowRequest?.id, 'borrow request from approved community visitor is required');
  const result = await request('/rest/v1/rpc/confirm_return_v2', {
    method: 'POST', token: state.sessions.subadmin.aal2.access_token,
    body: { p_request_id: state.borrowRequest.id, p_staff_name: 'Synthetic Subadmin' },
  });
  assertAllowed(result, 'same-branch return confirmation');
  const rows = await request(`/rest/v1/borrow_requests?id=eq.${encodeURIComponent(state.borrowRequest.id)}&select=status`, { token: state.sessions.community_approved.aal1.access_token });
  assertAllowed(rows, 'visitor read returned request');
  assert.equal(rows.data[0]?.status, 'returned');
});
authTest('fine-payment regression: AAL2 subadmin records a partial payment and balance stays accurate', async () => {
  const fixture = state.fineRequests[0];
  const key = randomUUID();
  const result = await request('/rest/v1/rpc/record_fine_payment_v2', {
    method: 'POST', token: state.sessions.subadmin.aal2.access_token,
    body: { p_request_id: fixture.id, p_amount: 10, p_payment_method: 'cash', p_reference_number: null, p_note: null, p_idempotency_key: key },
  });
  assertAllowed(result, 'record synthetic partial fine payment');
  assert.equal(Number(result.data?.amount), 10);
  state.paymentReplay = { fixture, key, result: result.data };
  const transaction = await request(`/rest/v1/borrow_requests?id=eq.${encodeURIComponent(fixture.id)}&select=status,fine_amount,fine_paid_amount`, { token: state.sessions.subadmin.aal2.access_token });
  assertAllowed(transaction, 'read own branch payment transaction');
  assert.equal(transaction.data.length, 1);
  assert.equal(transaction.data[0].status, 'borrowed', 'payment must not mark an unreturned book as returned');
  assert.equal(Number(transaction.data[0].fine_paid_amount), 10);
  assert.ok(Number(transaction.data[0].fine_amount) >= 10);
  assert.equal(Number(result.data.remainingBalance), Number(transaction.data[0].fine_amount) - 10);
});
authTest('fine-payment regression: same idempotency key replay returns the original receipt once', async () => {
  const { fixture, key, result: original } = state.paymentReplay;
  assert.ok(original?.paymentId, 'first payment receipt is required');
  const replay = await request('/rest/v1/rpc/record_fine_payment_v2', {
    method: 'POST', token: state.sessions.subadmin.aal2.access_token,
    body: { p_request_id: fixture.id, p_amount: 10, p_payment_method: 'cash', p_reference_number: null, p_note: null, p_idempotency_key: key },
  });
  assertAllowed(replay, 'replay synthetic payment request');
  assert.equal(replay.data.paymentId, original.paymentId);
  const transaction = await request(`/rest/v1/borrow_requests?id=eq.${encodeURIComponent(fixture.id)}&select=fine_paid_amount`, { token: state.sessions.subadmin.aal2.access_token });
  assertAllowed(transaction, 'verify replay did not double-charge');
  assert.equal(Number(transaction.data[0].fine_paid_amount), 10);
});
authTest('fine-payment regression: invalid payment methods are rejected before recording', async () => {
  const fixture = state.fineRequests[0];
  const result = await request('/rest/v1/rpc/record_fine_payment_v2', {
    method: 'POST', token: state.sessions.subadmin.aal2.access_token,
    body: { p_request_id: fixture.id, p_amount: 1, p_payment_method: 'gift_card', p_reference_number: null, p_note: null, p_idempotency_key: randomUUID() },
  });
  assertDenied(result, 'invalid fine payment method');
});
authTest('fine-payment regression: visitors cannot record payments or inspect payment rows', async () => {
  const fixture = state.fineRequests[0];
  assertDenied(await request('/rest/v1/rpc/record_fine_payment_v2', {
    method: 'POST', token: state.sessions.community_approved.aal1.access_token,
    body: { p_request_id: fixture.id, p_amount: 1, p_payment_method: 'cash', p_reference_number: null, p_note: null, p_idempotency_key: randomUUID() },
  }), 'visitor payment recording');
  const rows = await request('/rest/v1/fine_payments?select=id,amount', { token: state.sessions.community_approved.aal1.access_token });
  assertDenied(rows, 'visitor fine payment privacy');
});
authTest('fine-payment regression: subadmin cannot record a payment for another branch', async () => {
  const fixture = state.fineRequests[1];
  assertDenied(await request('/rest/v1/rpc/record_fine_payment_v2', {
    method: 'POST', token: state.sessions.subadmin.aal2.access_token,
    body: { p_request_id: fixture.id, p_amount: 1, p_payment_method: 'cash', p_reference_number: null, p_note: null, p_idempotency_key: randomUUID() },
  }), 'cross-branch fine payment');
});

authTest('auth-role regression: superadmin password session is genuine AAL1', async () => {
  const token = state.sessions.superadmin.aal1.access_token;
  assert.equal(jwtClaims(token).aal, 'aal1');
  assertAllowed(await request('/auth/v1/user', { token }), 'verify superadmin AAL1 session');
});
authTest('auth-role regression: superadmin staff RPC rejects AAL1', async () => {
  assertDenied(await request('/rest/v1/rpc/lookup_attendance_visitor_v2', {
    method: 'POST', token: state.sessions.superadmin.aal1.access_token,
    body: { p_qr: visitor('institutional').qrCode, p_library_id: state.libraries[0].id },
  }), 'superadmin AAL1 attendance lookup');
});
authTest('auth-role regression: superadmin TOTP session is AAL2 and can access system-scoped staff data', async () => {
  const token = state.sessions.superadmin.aal2.access_token;
  assert.equal(jwtClaims(token).aal, 'aal2');
  const result = await request('/rest/v1/staff_profiles?select=id', { token });
  assertAllowed(result, 'superadmin staff profile access');
  assert.ok(result.data.some((row) => row.id === state.sessions.subadmin.id));
});
authTest('auth-role regression: superadmin cannot create a visitor borrowing request', async () => {
  assertDenied(await request('/rest/v1/rpc/request_borrow_v2', {
    method: 'POST', token: state.sessions.superadmin.aal2.access_token, body: { p_book_id: state.books[0].id },
  }), 'superadmin visitor borrowing');
});
authTest('auth-role regression: mismatched app role claim is rejected against staff profile', async () => {
  const account = state.sessions.subadmin;
  const updated = await request(`/auth/v1/admin/users/${account.id}`, {
    method: 'PUT', admin: true, body: { app_metadata: { role: 'superadmin' } },
  });
  assertAllowed(updated, 'set synthetic mismatched role claim');
  const session = await passwordSession(account);
  const mismatchAal2 = await enrollAal2(account, session);
  assertDenied(await request('/rest/v1/rpc/lookup_attendance_visitor_v2', {
    method: 'POST', token: mismatchAal2.access_token,
    body: { p_qr: visitor('institutional').qrCode, p_library_id: state.libraries[0].id },
  }), 'mismatched role claim attendance lookup');
});
authTest('auth-role regression: inactive staff profile is rejected even with a genuine AAL2 session', async () => {
  const account = state.sessions.subadmin;
  const updated = await request(`/rest/v1/staff_profiles?id=eq.${account.id}`, {
    method: 'PATCH', admin: true, body: { is_active: false },
  });
  assertAllowed(updated, 'deactivate synthetic subadmin');
  assertDenied(await request('/rest/v1/rpc/lookup_attendance_visitor_v2', {
    method: 'POST', token: account.aal2.access_token,
    body: { p_qr: visitor('institutional').qrCode, p_library_id: state.libraries[0].id },
  }), 'inactive subadmin attendance lookup');
});
