import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const protectedRoute = readFileSync(new URL('../routes/ProtectedRoute.jsx', import.meta.url), 'utf8');
const roleHome = readFileSync(new URL('../routes/roleHome.js', import.meta.url), 'utf8');
const authContext = readFileSync(new URL('../context/AuthContext.jsx', import.meta.url), 'utf8');
const pendingPage = readFileSync(new URL('../pages/visitor/CommunityVisitorPending.jsx', import.meta.url), 'utf8');

test('pending visitors access pending-approval page without a full app session', () => {
  // The pending-approval route allows unauthenticated access (visitor_id passed via query param)
  assert.match(app, /path="\/visitor\/pending-approval"/);
  assert.match(app, /unauthenticatedTo="\/visitor-login"/);
  assert.match(app, /CommunityVisitorPending/);

  // roleHome no longer has community_pending role (not an authorization role)
  assert.match(roleHome, /visitor: '\/visitor'/);
  assert.match(roleHome, /subadmin: '\/subadmin'/);
  assert.match(roleHome, /superadmin: '\/superadmin'/);
  // community_pending should not be in roleHome
  assert.ok(!roleHome.includes('community_pending'));

  // AuthContext handles either pending visitor type by returning null from createVisitorSession
  // and storing visitor_id in sessionStorage for the pending-approval page
  assert.match(authContext, /const approvalPending = visitor\.approvalPending === true/);
  assert.match(authContext, /if \(approvalPending\) \{/);
  assert.match(authContext, /return null/);
  assert.doesNotMatch(authContext, /pending_visitor_id/);
  assert.match(pendingPage, /supabase\.auth\.getUser\(\)/);
  assert.match(pendingPage, /get_my_visitor_approval_status/);
  assert.doesNotMatch(pendingPage, /\.from\('visitors'\)/);
});

test('protected routes fail closed to role home when role is not allowed', () => {
  assert.match(protectedRoute, /allowedRoles && !allowedRoles\.includes\(user\.role\)/);
  assert.match(protectedRoute, /Navigate to=\{getDashboardPath\(user\.role\)\}/);
});