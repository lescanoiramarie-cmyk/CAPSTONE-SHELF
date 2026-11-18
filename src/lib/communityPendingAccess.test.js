import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const protectedRoute = readFileSync(new URL('../routes/ProtectedRoute.jsx', import.meta.url), 'utf8');
const roleHome = readFileSync(new URL('../routes/roleHome.js', import.meta.url), 'utf8');
const authContext = readFileSync(new URL('../context/AuthContext.jsx', import.meta.url), 'utf8');

test('pending community visitors access pending-approval page without full session', () => {
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

  // AuthContext handles pending community visitors by returning null from createVisitorSession
  // and storing visitor_id in sessionStorage for the pending-approval page
  assert.match(authContext, /if \(communityApprovalPending\) \{/);
  assert.match(authContext, /return null/);
  assert.match(authContext, /sessionStorage\.setItem\('pending_visitor_id'/);
});

test('protected routes fail closed to role home when role is not allowed', () => {
  assert.match(protectedRoute, /allowedRoles && !allowedRoles\.includes\(user\.role\)/);
  assert.match(protectedRoute, /Navigate to=\{getDashboardPath\(user\.role\)\}/);
});