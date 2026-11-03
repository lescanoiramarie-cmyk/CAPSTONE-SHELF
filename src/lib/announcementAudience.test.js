import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminWorkspaceSource = readFileSync(
  new URL('../component/AdminWorkspace.jsx', import.meta.url),
  'utf8'
);
const landingPageSource = readFileSync(
  new URL('../pages/visitor/LandingPage.jsx', import.meta.url),
  'utf8'
);

test('sub-admin announcements are visitor-only and branch-scoped', () => {
  const saveHandlerStart = adminWorkspaceSource.indexOf(
    'const handleAnnouncementSave'
  );
  const saveHandlerEnd = adminWorkspaceSource.indexOf(
    'const handleAnnouncementDelete',
    saveHandlerStart
  );
  assert.ok(saveHandlerStart >= 0 && saveHandlerEnd > saveHandlerStart);

  const saveHandler = adminWorkspaceSource.slice(
    saveHandlerStart,
    saveHandlerEnd
  );
  assert.match(saveHandler, /audience:\s*isSubAdmin\s*\?\s*'visitor'/);
  assert.match(saveHandler, /library_id:\s*isSubAdmin\s*\?\s*currentLibraryId/);
});

test('public landing announcements exclude branch-specific announcements', () => {
  assert.match(
    landingPageSource,
    /\.in\('audience',\s*\['general',\s*'both'\]\)/
  );
  assert.match(landingPageSource, /\.is\('library_id',\s*null\)/);
});

test('sub-admin announcement form explains the visitor-only audience', () => {
  assert.match(
    adminWorkspaceSource,
    /Sub-admin announcements appear on visitor dashboards only, not on the public landing page\./
  );
});