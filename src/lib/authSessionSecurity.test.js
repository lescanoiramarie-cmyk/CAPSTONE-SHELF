import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const authContext = readFileSync(new URL('../context/AuthContext.jsx', import.meta.url), 'utf8');

test('idle session listeners are registered once and cleanup matches registrations', () => {
  const pointerDownAdds = (authContext.match(/addEventListener\('pointerdown', handleActivity/g) || []).length;
  const storageAdds = (authContext.match(/addEventListener\('storage', handleStorage/g) || []).length;
  assert.equal(pointerDownAdds, 1, 'pointerdown listener should be registered once');
  assert.equal(storageAdds, 1, 'storage listener should be registered once');
  assert.doesNotMatch(authContext, /removeEventListener\('scroll', handleActivity\)/);
  assert.match(authContext, /removeEventListener\('storage', handleStorage\)/);
});

test('staff MFA completion revalidates AAL2 and confirmed session before granting access', () => {
  assert.match(authContext, /getAuthenticatorAssuranceLevel/);
  assert.match(authContext, /assurance\?\.\s*currentLevel !== 'aal2'/);
  assert.match(authContext, /The verified staff session could not be confirmed/);
});