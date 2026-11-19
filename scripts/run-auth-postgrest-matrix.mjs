#!/usr/bin/env node
// Opt-in integration runner. It never loads .env and never prints credentials,
// JWTs, response bodies, visitor data, or payment details.
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const requiredTags = [
  'aal1-denial', 'aal2-success', 'role-missing', 'role-null', 'role-empty',
  'role-mismatch', 'inactive-staff', 'unsupported-role', 'superadmin',
  'subadmin', 'cross-branch', 'pickup', 'return', 'fine-privacy',
  'review-privacy', 'review-ownership', 'community-registration', 'visitor-ownership',
];
const knownProductionRef = 'khwtfjyvawukbsvyjdux';

function fail(message) {
  throw new Error(message);
}

function decodeBase32(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = secret.toUpperCase().replace(/=+$/g, '').replace(/[\s-]/g, '');
  let bits = '';
  for (const character of normalized) {
    const value = alphabet.indexOf(character);
    if (value < 0) fail('TOTP factor returned an unsupported secret format.');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

function makeTotp(secret, now = Date.now()) {
  const counter = BigInt(Math.floor(now / 1000 / 30));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmacSha1(decodeBase32(secret), message);
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

function createHmacSha1(key, message) {
  // Kept local to avoid external TOTP packages and network installs.
  return createHmac('sha1', key).update(message).digest();
}

function getPath(value, path) {
  if (path === '$') return value;
  return path.replace(/^\$\.?/, '').split('.').filter(Boolean).reduce((current, key) => {
    if (key === '[]') return Array.isArray(current) ? current : undefined;
    return current == null ? undefined : current[key];
  }, value);
}

function assertResponse(body, expectation) {
  for (const key of expectation.requireKeys ?? []) {
    if (!body || !Object.hasOwn(body, key)) fail(`response missing required key ${key}`);
  }
  const forbidden = new Set((expectation.forbidKeys ?? []).map((key) => key.toLowerCase()));
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (forbidden.has(key.toLowerCase())) fail(`response contains forbidden key ${key}`);
      visit(nested);
    }
  };
  visit(body);
  if (expectation.arrayLength) {
    const selected = getPath(body, expectation.arrayLength.path ?? '$');
    if (!Array.isArray(selected)) fail('expected response path is not an array');
    const { min = 0, max = Number.POSITIVE_INFINITY } = expectation.arrayLength;
    if (selected.length < min || selected.length > max) fail('response array length outside expected bounds');
  }
  for (const check of expectation.equals ?? []) {
    if (getPath(body, check.path) !== check.value) fail(`response value mismatch at ${check.path}`);
  }
}

async function getSession({ account, targetAal, client }) {
  if (!account) return null;
  const email = process.env[account.emailEnv];
  const password = process.env[account.passwordEnv];
  if (!email || !password) fail(`Missing account environment variables for ${account.alias}.`);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) fail(`Authentication failed for test alias ${account.alias}.`);
  if (targetAal === 'aal1') {
    const { data: levelData, error: levelError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (levelError || levelData.currentLevel !== 'aal1') fail(`Expected a genuine AAL1 session for ${account.alias}.`);
    return data.session;
  }
  if (targetAal !== 'aal2') fail(`Unsupported target AAL for ${account.alias}.`);

  const { data: factorsData, error: factorsError } = await client.auth.mfa.listFactors();
  if (factorsError) fail(`Could not inspect test MFA factors for ${account.alias}.`);
  let factor = factorsData.totp.find((item) => item.status === 'verified');
  let secret;
  if (!factor) {
    if (account.allowTotpEnrollment !== true) fail(`No verified TOTP factor for ${account.alias}; enrollment is not authorized in fixture.`);
    const { data: enrolled, error: enrollError } = await client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `SHELF isolated integration ${account.alias}`,
    });
    if (enrollError || !enrolled?.id || !enrolled?.totp?.secret) fail(`TOTP enrollment failed for ${account.alias}.`);
    factor = { id: enrolled.id };
    secret = enrolled.totp.secret;
  } else {
    const suppliedSecret = process.env[account.totpSecretEnv];
    if (suppliedSecret) secret = suppliedSecret;
    else fail(`A verified factor exists for ${account.alias}, but its TOTP secret was not supplied securely.`);
  }
  const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: makeTotp(secret),
  });
  if (verifyError) fail(`TOTP challenge/verification failed for ${account.alias}.`);
  const { data: levelData, error: levelError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (levelError || levelData.currentLevel !== 'aal2') fail(`Supabase did not issue an AAL2 session for ${account.alias}.`);
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError || !sessionData.session) fail(`AAL2 session was not returned for ${account.alias}.`);
  return sessionData.session;
}

async function main() {
  const fixturePath = process.env.SHELF_AUTH_TEST_FIXTURE;
  const urlValue = process.env.SHELF_TEST_SUPABASE_URL;
  const anonKey = process.env.SHELF_TEST_SUPABASE_ANON_KEY;
  const environment = process.env.SHELF_TEST_ENVIRONMENT;
  const projectRef = process.env.SHELF_TEST_PROJECT_REF ?? '';
  if (!fixturePath || !urlValue || !anonKey || environment !== 'isolated-staging') {
    fail('Set SHELF_AUTH_TEST_FIXTURE, SHELF_TEST_SUPABASE_URL, SHELF_TEST_SUPABASE_ANON_KEY, and SHELF_TEST_ENVIRONMENT=isolated-staging.');
  }
  const resolvedFixture = resolve(fixturePath);
  if (!isAbsolute(fixturePath) || resolvedFixture.toLowerCase().endsWith('.env')) fail('Fixture must be an absolute non-.env path outside repository configuration.');
  const repositoryPrefix = resolve('.').toLowerCase();
  if (resolvedFixture.toLowerCase().startsWith(repositoryPrefix)) fail('Keep test credentials and fixture data outside the repository.');
  const url = new URL(urlValue);
  const hostRef = url.hostname.split('.')[0];
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.hostname === 'shelf-system.vercel.app'
      || hostRef === knownProductionRef
      || projectRef === knownProductionRef
      || (!localHost && hostRef !== projectRef)) {
    fail('Refusing a URL that is production or whose staging project ref is not explicitly verified.');
  }
  if (!projectRef) fail('SHELF_TEST_PROJECT_REF must identify the isolated staging project.');
  if (anonKey.startsWith('eyJ')) {
    try {
      const tokenPayload = JSON.parse(Buffer.from(anonKey.split('.')[1], 'base64url').toString('utf8'));
      if (tokenPayload.role === 'service_role') fail('The test runner refuses a service_role key; use only a public anon/publishable key.');
    } catch (error) {
      if (error.message.includes('refuses a service_role')) throw error;
      fail('The configured JWT-like public key could not be safely inspected.');
    }
  }

  const fixture = JSON.parse(await readFile(resolvedFixture, 'utf8'));
  if (!fixture || typeof fixture.accounts !== 'object' || !Array.isArray(fixture.cases)) fail('Fixture needs accounts and cases.');
  const suppliedTags = new Set(fixture.cases.flatMap((testCase) => testCase.tags ?? []));
  const missingTags = requiredTags.filter((tag) => !suppliedTags.has(tag));
  if (missingTags.length) fail(`Fixture is missing required coverage tags: ${missingTags.join(', ')}.`);

  const anonymousClient = createClient(urlValue, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const sessions = new Map();
  const results = [];
  for (const testCase of fixture.cases) {
    const alias = testCase.account ?? null;
    try {
      let session = null;
      if (alias) {
        if (!Object.hasOwn(fixture.accounts, alias)) fail(`Unknown fixture account alias ${alias}.`);
        const cacheKey = `${alias}:${testCase.aal}`;
        if (!sessions.has(cacheKey)) {
          const client = createClient(urlValue, anonKey, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          });
          sessions.set(cacheKey, await getSession({ account: fixture.accounts[alias], targetAal: testCase.aal, client }));
        }
        session = sessions.get(cacheKey);
      } else if (testCase.aal) {
        fail('Anonymous cases must omit aal and account.');
      }
      const path = testCase.request?.path;
      if (!path?.startsWith('/rest/v1/')) fail('Each integration request must use a PostgREST /rest/v1/ path.');
      const method = String(testCase.request.method ?? 'GET').toUpperCase();
      const headers = new Headers({ apikey: anonKey, accept: 'application/json' });
      if (session?.access_token) headers.set('authorization', `Bearer ${session.access_token}`);
      if (testCase.request.body !== undefined) headers.set('content-type', 'application/json');
      for (const [name, value] of Object.entries(testCase.request.headers ?? {})) {
        if (/^(authorization|apikey)$/i.test(name)) fail('Fixture may not override auth credentials.');
        headers.set(name, value);
      }
      const response = await fetch(new URL(path, url), {
        method,
        headers,
        ...(testCase.request.body === undefined ? {} : { body: JSON.stringify(testCase.request.body) }),
      });
      const text = await response.text();
      let body = null;
      if (text) {
        try { body = JSON.parse(text); } catch { body = text; }
      }
      const expectedStatuses = Array.isArray(testCase.expected?.status)
        ? testCase.expected.status : [testCase.expected?.status ?? 200];
      if (!expectedStatuses.includes(response.status)) fail(`expected status ${expectedStatuses.join('|')}, received ${response.status}`);
      if (testCase.expected?.json) assertResponse(body, testCase.expected.json);
      results.push({ name: testCase.name, status: response.status, result: 'PASS' });
      process.stdout.write(`PASS ${testCase.name} [HTTP ${response.status}]\n`);
    } catch (error) {
      results.push({ name: testCase.name, result: 'FAIL', reason: error.message });
      process.stdout.write(`FAIL ${testCase.name} — ${error.message}\n`);
    }
  }
  process.stdout.write(`Total: ${results.length}; passed: ${results.filter((item) => item.result === 'PASS').length}; failed: ${results.filter((item) => item.result === 'FAIL').length}\n`);
  return results.every((result) => result.result === 'PASS') ? 0 : 2;
}

main().then((code) => { process.exit(code); }).catch((error) => {
  process.stderr.write(`Auth/PostgREST matrix not run: ${error.message}\n`);
  process.exit(1);
});
