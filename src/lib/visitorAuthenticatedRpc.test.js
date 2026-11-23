import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { callVisitorAuthenticatedRpc } from './visitorAuthenticatedRpc.js';

const session = (id = 'visitor-auth', token = 'valid-token') => ({ data: { session: { user: { id }, access_token: token } }, error: null });

test('token-scoped Supabase client sends the visitor bearer token', async () => {
  let authorization;
  const scoped = createClient('https://example.supabase.co', 'public-key', {
    accessToken: async () => 'visitor-token',
    global: { fetch: async (_url, options) => {
      authorization = new Headers(options.headers).get('authorization');
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    } },
  });
  await scoped.rpc('fetch_my_community_book_requests', { p_requester_visitor_id: 'visitor' });
  assert.equal(authorization, 'Bearer visitor-token');
});

test('sends the checked visitor token to the scoped RPC client', async () => {
  const client = { auth: { getSession: async () => session() } };
  let call;
  const result = await callVisitorAuthenticatedRpc(client, (token) => ({ rpc: async (name, args) => {
    call = { token, name, args };
    return { status: 200, data: [{ id: 'request' }], error: null };
  } }), 'fetch_my_community_book_requests', { p_requester_visitor_id: 'visitor' });
  assert.deepEqual(call, { token: 'valid-token', name: 'fetch_my_community_book_requests', args: { p_requester_visitor_id: 'visitor' } });
  assert.deepEqual(result, [{ id: 'request' }]);
});

test('does not call private RPC with no visitor session', async () => {
  const client = { auth: { getSession: async () => ({ data: { session: null } }) } };
  let invoked = false;
  await assert.rejects(callVisitorAuthenticatedRpc(client, () => { invoked = true; }, 'rpc', {}), /sign in again/i);
  assert.equal(invoked, false);
});

test('refreshes once after 401 and uses the refreshed token', async () => {
  let current = session();
  let refreshes = 0;
  const tokens = [];
  const client = { auth: { getSession: async () => current, refreshSession: async () => { refreshes++; current = session('visitor-auth', 'new-token'); return current; } } };
  const result = await callVisitorAuthenticatedRpc(client, (token) => ({ rpc: async () => {
    tokens.push(token);
    return token === 'valid-token' ? { status: 401, error: { message: 'permission denied' } } : { status: 200, data: [{ id: 'ok' }] };
  } }), 'rpc', {});
  assert.deepEqual(tokens, ['valid-token', 'new-token']);
  assert.equal(refreshes, 1);
  assert.equal(result[0].id, 'ok');
});

test('simultaneous 401 responses share one session refresh', async () => {
  let current = session();
  let refreshes = 0;
  const client = { auth: { getSession: async () => current, refreshSession: async () => {
    refreshes++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    current = session('visitor-auth', 'new-token');
    return current;
  } } };
  const scoped = (token) => ({ rpc: async () => token === 'valid-token'
    ? { status: 401, error: { message: 'permission denied' } }
    : { status: 200, data: [{ id: 'ok' }] } });
  const results = await Promise.all([
    callVisitorAuthenticatedRpc(client, scoped, 'fetch_my_community_book_requests', {}),
    callVisitorAuthenticatedRpc(client, scoped, 'fetch_owner_community_book_requests', {}),
  ]);
  assert.equal(refreshes, 1);
  assert.equal(results.length, 2);
});

test('does not retry under a different signed-in account', async () => {
  let calls = 0;
  const client = { auth: { getSession: async () => ++calls === 1 ? session() : session('other-user'), refreshSession: async () => { throw new Error('unexpected refresh'); } } };
  let rpcCalls = 0;
  await assert.rejects(callVisitorAuthenticatedRpc(client, () => ({ rpc: async () => { rpcCalls++; return { status: 401 }; } }), 'rpc', {}), /sign in again/i);
  assert.equal(rpcCalls, 1);
});

test('does not expose an old account response after the signed-in account changes', async () => {
  let reads = 0;
  const client = { auth: { getSession: async () => ++reads === 1 ? session() : session('other-user') } };
  await assert.rejects(callVisitorAuthenticatedRpc(client, () => ({ rpc: async () => ({ status: 200, data: [{ id: 'private' }] }) }), 'rpc', {}), /sign in again/i);
});

test('preserves non-session RPC errors without retrying', async () => {
  const client = { auth: { getSession: async () => session() } };
  await assert.rejects(callVisitorAuthenticatedRpc(client, () => ({ rpc: async () => ({ status: 403, error: { message: 'Visitor identity could not be verified.' } }) }), 'rpc', {}), /identity could not be verified/);
});
