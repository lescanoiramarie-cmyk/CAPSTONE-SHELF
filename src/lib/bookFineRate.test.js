import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  BOOK_FINE_RATE_CATEGORIES,
  buildDuplicateBookImportUpdate,
  bookFineRateMismatch,
  calculateOverdueFine,
  getBookFineRate,
  normalizeBookFineRate,
  resolveFineAtReturn,
  validateImportedBookFineRates,
} from './bookFineRate.js';
import {
  getCurrentFine,
  getFineNotificationCopy,
  getFineOverdueDays,
} from '../../supabase/functions/send-due-date-notifications/fineNotification.js';

const fineRateMigration = readFileSync(
  new URL(
    '../../supabase/migrations/20261130000000_book_fine_rate_checkout_and_return.sql',
    import.meta.url
  ),
  'utf8'
);
const manualFineRateMigration = readFileSync(
  new URL(
    '../../supabase/migrations/20261208000000_manual_book_fine_rates.sql',
    import.meta.url
  ),
  'utf8'
);
const communityLegacyFineRateMigration = readFileSync(
  new URL(
    '../../supabase/migrations/20261209000000_community_legacy_fine_rate_fallback.sql',
    import.meta.url
  ),
  'utf8'
);
const communityQueueMigration = readFileSync(
  new URL(
    '../../supabase/migrations/20261204000100_disable_community_queue_when_unavailable.sql',
    import.meta.url
  ),
  'utf8'
);
const libraryPickupMigration = readFileSync(
  new URL(
    '../../supabase/migrations/20261205000000_fix_library_book_pickup_confirmation.sql',
    import.meta.url
  ),
  'utf8'
);
const visitorDomainMigration = readFileSync(
  new URL(
    '../../supabase/migrations/20261206000000_restrict_visitor_registration_to_partner_domains.sql',
    import.meta.url
  ),
  'utf8'
);
const storeSource = readFileSync(
  new URL('../data/store.js', import.meta.url),
  'utf8'
);
const inventorySource = readFileSync(
  new URL('../component/BookInventory.jsx', import.meta.url),
  'utf8'
);
const subAdminImportSource = readFileSync(
  new URL('../pages/subadmin/SubAdminDashboard.jsx', import.meta.url),
  'utf8'
);
const superAdminImportSource = readFileSync(
  new URL('../pages/superadmin/SuperAdminDashboard.jsx', import.meta.url),
  'utf8'
);
const excelImportSource = readFileSync(
  new URL('./excelUtils.js', import.meta.url),
  'utf8'
);
const dueNotificationSource = readFileSync(
  new URL('../../supabase/functions/send-due-date-notifications/index.ts', import.meta.url),
  'utf8'
);

function migrationFunction(name, migration = fineRateMigration) {
  const match = migration.match(
    new RegExp(
      `CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\s*\\([\\s\\S]*?\\$function\\$;`,
      'i'
    )
  );
  assert.ok(match, `Expected migration function ${name}.`);
  return match[0];
}

test('approved SHELF categories map to fixed per-day rates', () => {
  assert.deepEqual(
    BOOK_FINE_RATE_CATEGORIES.map(({ category, rate }) => [category, rate]),
    [
      ['General', 10],
      ['Reference', 10],
      ['Self-Help', 10],
      ['Philosophy', 10],
      ['Psychology', 10],
      ['Science', 10],
      ['Fiction', 15],
      ['Filipino Literature', 15],
      ['Literature', 15],
      ['Poetry', 15],
      ['Young Adult', 15],
      ['Business', 20],
      ['Computer Science', 20],
      ['Education', 20],
      ['Engineering', 20],
      ['History', 20],
      ['Information Technology', 20],
      ['Mathematics', 20],
      ['Nursing & Health', 20],
      ['Physics', 20],
      ['Software Engineering', 20],
    ]
  );
  assert.equal(getBookFineRate('  fIcTiOn  '), 15);
  for (const { category, rate } of BOOK_FINE_RATE_CATEGORIES) {
    assert.equal(getBookFineRate(category.toUpperCase()), rate);
  }
  assert.equal(getBookFineRate(null), null);
  assert.equal(getBookFineRate('   '), null);
  assert.equal(getBookFineRate('General Subject'), null);
  assert.equal(getBookFineRate('self help'), null);
  assert.equal(getBookFineRate('Young  Adult'), null);
  assert.equal(normalizeBookFineRate('15'), 15);
});

test('checkout functions snapshot only when transitioning to borrowed', () => {
  const libraryPickup = migrationFunction(
    'confirm_pickup',
    libraryPickupMigration
  );
  assert.match(libraryPickup, /status\s*=\s*'borrowed'/i);
  assert.match(libraryPickup, /fine_rate_snapshot\s*=\s*v_fine_rate/i);
  assert.match(
    libraryPickup,
    /v_fine_rate\s+IS NULL\s+OR\s+v_fine_rate\s+NOT IN \(10, 15, 20\)/i
  );

  const communityPickup = migrationFunction('confirm_community_book_pickup');
  assert.match(communityPickup, /status\s*=\s*'borrowed'/i);
  assert.match(communityPickup, /fine_rate_snapshot\s*=\s*v_fine_rate/i);
  assert.match(communityPickup, /IF v_fine_rate IS NULL THEN/i);
  assert.match(manualFineRateMigration, /v_fine_rate NOT BETWEEN 1 AND 100/i);
  assert.match(manualFineRateMigration, /b\.fine_rate/);
  assert.match(manualFineRateMigration, /fine_rate_snapshot BETWEEN 1 AND 100/i);
});

test('checkout RPC contracts preserve staff signatures and community lending behavior', () => {
  for (const name of ['confirm_pickup', 'confirm_return']) {
    assert.match(
      migrationFunction(name, name === 'confirm_pickup' ? libraryPickupMigration : fineRateMigration),
      new RegExp(`${name} \\(\\s*p_request_id uuid`, 'i')
    );
  }

  const communityPickup = migrationFunction(
    'confirm_community_book_pickup'
  );
  assert.match(
    communityPickup,
    /RETURNS void/i
  );
  assert.match(
    communityPickup,
    /lower\(trim\(v_book_type\)\)\s*<>\s*'personal'/i
  );
  assert.match(communityPickup, /b\.lending_enabled/i);
  assert.match(communityPickup, /due_date = now\(\) \+ interval '7 days'/i);
  assert.match(communityPickup, /fine_rate_snapshot\s*=\s*v_fine_rate/i);
});

test('legacy community books use category rates only when no manual rate is saved', () => {
  assert.match(
    communityLegacyFineRateMigration,
    /COALESCE\(b\.fine_rate, public\.get_category_fine_rate\(b\.category\)\)/i
  );
  assert.match(
    communityLegacyFineRateMigration,
    /fine_rate_snapshot = v_fine_rate/i
  );
  assert.match(
    communityLegacyFineRateMigration,
    /v_fine_rate NOT BETWEEN 1 AND 100/i
  );
  assert.match(
    communityLegacyFineRateMigration,
    /replacement_count <> 1/
  );
  assert.doesNotMatch(
    communityLegacyFineRateMigration,
    /UPDATE public\.books\s+SET/i
  );
});

test('library pickup does not depend on the personal-book lending flag', () => {
  const body = migrationFunction('confirm_pickup', libraryPickupMigration);
  assert.match(body, /v_book_type IS DISTINCT FROM 'library'/i);
  assert.doesNotMatch(body, /lending_enabled/i);
  assert.match(body, /pickup_deadline IS NULL OR v_req\.pickup_deadline <= now\(\)/i);
});

test('community book requests reject books with no available copies', () => {
  const body = migrationFunction(
    'request_community_book',
    communityQueueMigration
  );
  assert.match(body, /COALESCE\(book_row\.available_copies, 0\) <= 0/i);
  assert.match(body, /This community book is currently unavailable\./i);
});

test('visitor registration requires the selected partner school domain', () => {
  const trigger = migrationFunction(
    'enforce_visitor_email_domain',
    visitorDomainMigration
  );
  const register = migrationFunction(
    'register_visitor',
    visitorDomainMigration
  );
  assert.match(trigger, /visitor_domain = 'gmail\.com'/i);
  assert.match(trigger, /selected_library_id/i);
  assert.match(register, /p_library_id IS NULL/i);
  assert.match(register, /auth_metadata ->> 'library_id' IS DISTINCT FROM p_library_id::text/i);
  assert.doesNotMatch(trigger, /IF visitor_domain = 'gmail\.com' THEN\s+RETURN new/i);
});

test('personal book creation passes the required fine rate to its RPC', () => {
  const addBookBody = storeSource.slice(
    storeSource.indexOf('export async function addPersonalBook'),
    storeSource.indexOf('export async function setPersonalBookVisibility')
  );
  assert.match(addBookBody, /p_fine_rate:\s*normalizedFineRate/i);
});

test('return functions calculate from snapshots and keep legacy fines untouched', () => {
  for (const name of ['confirm_return', 'confirm_community_book_return']) {
    const body = migrationFunction(name);
    assert.match(body, /v_req\.fine_rate_snapshot/i);
    assert.doesNotMatch(body, /fine_amount\s*=\s*[^;\n]*\*\s*10/i);
    const legacyBranchStart = body.lastIndexOf('  ELSE');
    assert.notEqual(legacyBranchStart, -1);
    const legacyBranch = body.slice(legacyBranchStart);
    assert.match(legacyBranch, /fine_amount\s*=\s*v_req\.fine_amount/i);
    assert.match(legacyBranch, /fine_review_required\s*=\s*true/i);
  }
});

test('manual review preserves historical flags without mislabeling calculated fines', () => {
  assert.doesNotMatch(fineRateMigration, /GENERATED ALWAYS AS/i);
  for (const table of ['borrow_requests', 'community_book_requests']) {
    const backfill = fineRateMigration.match(
      new RegExp(
        `UPDATE public\\.${table}\\s+SET fine_review_required = true[\\s\\S]*?;`,
        'i'
      )
    );
    assert.ok(backfill, `Expected a review-flag backfill for ${table}.`);
    assert.doesNotMatch(backfill[0], /\bSET\s+(?:status|fine_amount)\s*=/i);
  }

  for (const name of ['confirm_return', 'confirm_community_book_return']) {
    const body = migrationFunction(name);
    const calculationStart = body.indexOf(
      'IF v_req.fine_rate_snapshot IN'
    );
    const legacyBranchStart = body.lastIndexOf('  ELSE');
    assert.notEqual(calculationStart, -1);
    assert.ok(
      legacyBranchStart > calculationStart,
      `Expected a legacy return branch for ${name}.`
    );
    assert.doesNotMatch(
      body.slice(calculationStart, legacyBranchStart),
      /fine_review_required\s*=\s*true/i
    );
  }

  assert.match(fineRateMigration, /fine_review_required boolean NOT NULL DEFAULT false/i);
  assert.match(fineRateMigration, /fine_rate_snapshot NOT IN \(10, 15, 20\)/i);
  assert.match(manualFineRateMigration, /fine_rate_snapshot BETWEEN 1 AND 100/i);
  assert.match(manualFineRateMigration, /fine_rate_snapshot NOT BETWEEN 1 AND 100/i);
  assert.match(fineRateMigration, /fine_amount = v_req\.fine_amount/i);
  assert.match(manualFineRateMigration, /books_fine_rate_range/i);
  assert.match(manualFineRateMigration, /NOT VALID/i);
  assert.ok(manualFineRateMigration.includes('regexp_matches('));
  assert.ok(
    manualFineRateMigration.includes(
      String.raw`fine_rate_snapshot\s+(NOT BETWEEN|BETWEEN)\s+1\s+AND\s+100`
    )
  );
  assert.match(manualFineRateMigration, /legacy_snapshot_check_count <> 0/i);
  assert.match(
    manualFineRateMigration,
    /updated_snapshot_check_count <> expected_snapshot_check_count/i
  );
  assert.match(
    manualFineRateMigration,
    /IF patched_definition <> function_definition THEN\s+EXECUTE patched_definition;/i
  );
  assert.doesNotMatch(
    manualFineRateMigration,
    /UPDATE public\.(?:books|borrow_requests|community_book_requests)\s+SET/i
  );
});

test('new fine rates accept positive whole-number pesos from 1 through 100', () => {
  for (const value of [1, 10, 15, 20, 25, 100, '1', '25', '100']) {
    assert.equal(normalizeBookFineRate(value), Number(value));
  }

  for (const value of ['', undefined, null, 0, '0', -1, '-1', 1.5, '1.5', 'ten', '₱10', 101, '101']) {
    assert.throws(
      () => normalizeBookFineRate(value),
      /whole number from ₱1 to ₱100/
    );
  }
});

test('duplicate imports preserve an existing rate and flag only a differing supplied rate', () => {
  assert.equal(bookFineRateMismatch(10, 10), false);
  assert.equal(bookFineRateMismatch(10, 25), true);
  assert.equal(bookFineRateMismatch(null, 25), true);

  const duplicateUpdate = buildDuplicateBookImportUpdate(
    {
      total_copies: 2,
      available_copies: 1,
      fine_rate: 10,
      category: 'General',
    },
    {
      total_copies: 3,
      available_copies: 3,
      fine_rate: 15,
      category: 'Fiction',
    }
  );
  assert.deepEqual(duplicateUpdate, {
    update: { total_copies: 5, available_copies: 4 },
    fineRateMismatch: true,
  });
  assert.equal('fine_rate' in duplicateUpdate.update, false);
});

test('checkout snapshot rate is used for overdue days with fractional days rounded up', () => {
  assert.equal(
    calculateOverdueFine(
      '2026-01-01T00:00:00Z',
      '2026-01-04T00:00:00Z',
      10
    ),
    30
  );
  assert.equal(
    calculateOverdueFine(
      '2026-01-01T00:00:00Z',
      '2026-01-02T00:00:01Z',
      15
    ),
    30
  );
  assert.equal(
    calculateOverdueFine(
      '2026-01-01T00:00:00Z',
      '2026-01-01T00:00:00Z',
      20
    ),
    0
  );
  assert.equal(
    calculateOverdueFine(
      '2026-01-01T00:00:00Z',
      '2026-01-02T00:00:00Z',
      null
    ),
    null
  );
});

test('legacy loans are reviewable without guessing and historical fines are preserved', () => {
  assert.deepEqual(
    resolveFineAtReturn({
      existingFineAmount: 0,
      dueDate: '2026-01-01T00:00:00Z',
      returnedAt: '2026-01-03T00:00:00Z',
      fineRateSnapshot: null,
    }),
    { fineAmount: 0, fineReviewRequired: true }
  );
  assert.deepEqual(
    resolveFineAtReturn({
      existingFineAmount: 45,
      dueDate: '2026-01-01T00:00:00Z',
      returnedAt: '2026-01-03T00:00:00Z',
      fineRateSnapshot: 20,
    }),
    { fineAmount: 45, fineReviewRequired: true }
  );
  assert.deepEqual(
    resolveFineAtReturn({
      existingFineAmount: 0,
      dueDate: '2026-01-01T00:00:00Z',
      returnedAt: '2026-01-03T00:00:00Z',
      fineRateSnapshot: 10,
    }),
    { fineAmount: 20, fineReviewRequired: false }
  );
});

test('book imports require and preserve a supplied fine_rate regardless of category', () => {
  assert.deepEqual(
    validateImportedBookFineRates([
      { title: 'Book One', Category: '  gEnErAl  ', fine_rate: '25' },
      { title: 'Book Two', category: 'Fiction', fine_rate: 15 },
      { title: 'Book Three', category: 'Young  Adult', fine_rate: 100 },
      { title: 'Book Four', category: '   ', fine_rate: 1 },
    ]),
    [
      { title: 'Book One', category: 'gEnErAl', fine_rate: 25 },
      { title: 'Book Two', category: 'Fiction', fine_rate: 15 },
      { title: 'Book Three', category: 'Young  Adult', fine_rate: 100 },
      { title: 'Book Four', category: null, fine_rate: 1 },
    ]
  );
  for (const value of [undefined, '', 0, -1, 2.5, 'invalid', 101]) {
    assert.throws(
      () =>
        validateImportedBookFineRates([
          { title: 'Invalid rate', category: 'General', fine_rate: value },
        ]),
      /Row 1 \("Invalid rate"\).*fine_rate/
    );
  }
  assert.throws(
    () =>
      validateImportedBookFineRates([
        { title: 'Conflicting categories', category: 'General', Category: 'Fiction' },
      ]),
    /Row 1 has conflicting category values/
  );
});

test('staff add/edit and import store paths use the validated fine_rate field', () => {
  const addBookBody = storeSource.slice(
    storeSource.indexOf('export async function addBook'),
    storeSource.indexOf('export async function addPersonalBook')
  );
  const bulkBookBody = storeSource.slice(
    storeSource.indexOf('export async function addBooksBulk'),
    storeSource.indexOf('// UPDATE BOOK')
  );
  const updateBookBody = storeSource.slice(
    storeSource.indexOf('export async function updateBook'),
    storeSource.indexOf('// DELETE BOOK')
  );

  assert.match(addBookBody, /normalizeBookFineRate\(book\?\.fine_rate\)/);
  assert.match(addBookBody, /fine_rate:\s*fineRate/);
  assert.match(bulkBookBody, /normalizeBookFineRate\(normalized\.fine_rate\)/);
  assert.doesNotMatch(bulkBookBody, /fine_rate:\s*getBookFineRate\(category\)/);
  assert.match(updateBookBody, /patch\?\.fine_rate !== undefined/);
  assert.match(updateBookBody, /dbPatch\.fine_rate = normalizeBookFineRate/);
  assert.doesNotMatch(updateBookBody, /dbPatch\.fine_rate = getBookFineRate/);
  assert.match(
    updateBookBody,
    /if \(patch\?\.category !== undefined\) \{\s*dbPatch\.category = preserveBookCategory\(patch\.category\);\s*\}/
  );
  assert.match(manualFineRateMigration, /p_patch \? 'fine_rate'/);
  assert.match(manualFineRateMigration, /THEN \(p_patch ->> 'fine_rate'\)::integer/);
  assert.match(inventorySource, /name="fine_rate"/);
  assert.match(inventorySource, /normalizeBookFineRate\(form\.fine_rate\)/);
  assert.match(inventorySource, /book\.fineRate \?\? book\.fine_rate/);
  assert.doesNotMatch(inventorySource, /getBookFineRate\(form\.category\)/);
});

test('all supported book import formats document and validate supplied fine_rate', () => {
  assert.match(subAdminImportSource, /\['csv', 'json'\]/);
  assert.match(superAdminImportSource, /await importBooksBulk\(importedJSON\)/);
  assert.match(superAdminImportSource, /fine_rate.*whole number from 1 to 100/i);
  assert.match(excelImportSource, /extension === 'csv'/);
  assert.match(excelImportSource, /extension === 'xlsx' \|\| extension === 'xls'/);
  assert.match(subAdminImportSource, /validateImportedBookFineRates\(records\)/);
});

test('notification fines prefer saved amounts and calculate snapshot rates from rounded overdue days', () => {
  const dueDate = '2026-01-01T00:00:00Z';
  const asOf = new Date('2026-01-02T00:00:01Z');

  assert.equal(getCurrentFine({ due_date: dueDate, fine_amount: 12, fine_rate_snapshot: 100 }, asOf), 12);
  assert.equal(getCurrentFine({ due_date: dueDate, fine_amount: 0, fine_rate_snapshot: 10 }, asOf), 20);
  assert.equal(getCurrentFine({ due_date: dueDate, fine_rate_snapshot: null }, asOf), null);
  assert.equal(getCurrentFine({ due_date: dueDate }, asOf), null);
  assert.equal(getCurrentFine({ due_date: dueDate, fine_amount: null, fine_rate_snapshot: 20 }, asOf), 40);
  assert.equal(getCurrentFine({ due_date: dueDate, fine_rate_snapshot: 10 }, asOf), 20);
  assert.equal(getCurrentFine({ due_date: dueDate, fine_amount: 0, fine_rate_snapshot: 100 }, asOf), 200);
  assert.equal(getCurrentFine({ due_date: dueDate, fine_amount: 0, fine_rate_snapshot: 0 }, asOf), null);
  assert.equal(getCurrentFine({ due_date: dueDate, fine_amount: 0, fine_rate_snapshot: 101 }, asOf), null);
  assert.equal(getCurrentFine({ due_date: dueDate, fine_amount: 0, fine_rate_snapshot: 10.5 }, asOf), null);
});

test('notification overdue days round partial days up and return zero on or before the due timestamp', () => {
  const dueDate = '2026-01-01T00:00:00Z';

  assert.equal(getFineOverdueDays(dueDate, new Date('2026-01-01T00:00:00Z')), 0);
  assert.equal(getFineOverdueDays(dueDate, new Date('2025-12-31T23:59:59Z')), 0);
  assert.equal(getFineOverdueDays(dueDate, new Date('2026-01-02T00:00:00Z')), 1);
  assert.equal(getFineOverdueDays(dueDate, new Date('2026-01-02T00:00:01Z')), 2);
});

test('notification fine copy labels assessed, estimated, and unavailable amounts accurately', () => {
  assert.deepEqual(
    getFineNotificationCopy({ fine_amount: 25, fine_rate_snapshot: 20 }, 25),
    {
      dailyRate: 'Daily fine rate: ₱20 per overdue day.',
      fineAmount: 'Previously assessed fine: ₱25.00',
      unavailable: '',
    }
  );
  assert.deepEqual(
    getFineNotificationCopy({ fine_amount: 0, fine_rate_snapshot: 100 }, 200),
    {
      dailyRate: 'Daily fine rate: ₱100 per overdue day.',
      fineAmount: 'Estimated fine: ₱200.00',
      unavailable: '',
    }
  );
  assert.deepEqual(
    getFineNotificationCopy({ fine_rate_snapshot: null }, null),
    {
      dailyRate: 'Daily fine rate unavailable; please contact the library for review.',
      fineAmount: '',
      unavailable: 'Fine estimate unavailable; please contact the library for review.',
    }
  );
  assert.equal(
    getFineNotificationCopy({ fine_rate_snapshot: 101 }, null).fineAmount,
    ''
  );
  assert.equal(
    getFineNotificationCopy({ fine_rate_snapshot: 101 }, null).unavailable,
    'Fine estimate unavailable; please contact the library for review.'
  );
});

test('notification fine helpers leave fine review flags unchanged and valid rates remain calculable', () => {
  const request = Object.freeze({
    due_date: '2026-01-01T00:00:00Z',
    fine_amount: 0,
    fine_rate_snapshot: 10,
    fine_review_required: true,
  });
  const asOf = new Date('2026-01-02T00:00:00Z');

  assert.equal(getCurrentFine(request, asOf), 10);
  getFineNotificationCopy(request, 10);
  assert.equal(request.fine_review_required, true);
});

test('scheduled and manual notification messages use the shared fine copy', () => {
  assert.doesNotMatch(dueNotificationSource, /FINE_PER_DAY/);
  assert.match(dueNotificationSource, /fine_rate_snapshot/);
  assert.match(dueNotificationSource, /getFineOverdueDays/);
  const fineCopyCallSites = dueNotificationSource.split(
    /const fineCopy\s*=\s*getFineNotificationCopy\(request, currentFine\);/
  );
  assert.equal(fineCopyCallSites.length, 3, 'Expected one manual and one scheduled fine-copy call site.');
  const manualMessage = fineCopyCallSites[1].slice(0, fineCopyCallSites[1].indexOf('const emailResult'));
  const scheduledMessage = fineCopyCallSites[2].slice(0, fineCopyCallSites[2].indexOf('const resendData'));

  for (const message of [manualMessage, scheduledMessage]) {
    assert.match(message, /fineCopy\.dailyRate/);
    assert.match(message, /fineCopy\.fineAmount/);
    assert.match(message, /fineCopy\.unavailable/);
    assert.match(message, /Overdue days:/);
  }
  assert.doesNotMatch(dueNotificationSource, /fine_review_required/);
});
