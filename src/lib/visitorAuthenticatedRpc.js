const SESSION_ERROR = 'Your visitor session has expired. Please sign in again to load community book requests.';
let refreshInFlight = null;

function checkedSession(result) {
  const session = result?.data?.session;
  if (result?.error || !session?.user?.id || !session.access_token) throw new Error(SESSION_ERROR);
  return session;
}

async function refreshForUser(client, userId, oldToken) {
  if (refreshInFlight?.userId === userId) return refreshInFlight.promise;
  const promise = (async () => {
    const before = checkedSession(await client.auth.getSession());
    if (before.user.id !== userId) throw new Error(SESSION_ERROR);
    if (before.access_token !== oldToken) return before;
    const refreshed = checkedSession(await client.auth.refreshSession());
    if (refreshed.user.id !== userId) throw new Error(SESSION_ERROR);
    const current = checkedSession(await client.auth.getSession());
    if (current.user.id !== userId) throw new Error(SESSION_ERROR);
    return current;
  })();
  const pending = { userId, promise };
  refreshInFlight = pending;
  try { return await promise; } finally { if (refreshInFlight === pending) refreshInFlight = null; }
}

export async function callVisitorAuthenticatedRpc(client, createScopedClient, name, args) {
  if (!client) throw new Error(SESSION_ERROR);
  const session = checkedSession(await client.auth.getSession());
  let response = await createScopedClient(session.access_token).rpc(name, args);
  if (response.status === 401) {
    const refreshed = await refreshForUser(client, session.user.id, session.access_token);
    response = await createScopedClient(refreshed.access_token).rpc(name, args);
  }
  if (response.status === 401) throw new Error(SESSION_ERROR);
  if (response.error) throw new Error(response.error.message || 'Unable to load community book requests.');
  const current = checkedSession(await client.auth.getSession());
  if (current.user.id !== session.user.id) throw new Error(SESSION_ERROR);
  return Array.isArray(response.data) ? response.data : [];
}
