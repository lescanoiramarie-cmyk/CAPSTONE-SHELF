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

const fineRateMigration = readFileSync(
  new URL(
    '../../supabase/migrations/20261130000000_book_fine_rate_checkout_and_return.sql',
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
});

test('fine rates outside the approved values are rejected', () => {
  for (const value of ['', '0', '12', '₱10', null]) {
    assert.throws(() => normalizeBookFineRate(value), /fine rate of 10, 15, or 20/);
  }
});

test('duplicate imports flag differing or unclassified existing rates', () => {
  assert.equal(bookFineRateMismatch(10, 'general'), false);
  assert.equal(bookFineRateMismatch(10, 'Fiction'), true);
  assert.equal(bookFineRateMismatch(null, 'General'), true);
  assert.equal(bookFineRateMismatch(null, 'Unlisted'), false);

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

test('book imports derive rates from categories and ignore independent rates', () => {
  assert.deepEqual(
    validateImportedBookFineRates([
      { title: 'Book One', Category: '  gEnErAl  ', fine_rate: '20' },
      { title: 'Book Two', category: 'Fiction', fine_rate: 15 },
      { title: 'Book Three', category: 'Young  Adult', fine_rate: 15 },
      { title: 'Book Four', category: '   ', fine_rate: 10 },
    ]),
    [
      { title: 'Book One', category: 'gEnErAl', fine_rate: 10 },
      { title: 'Book Two', category: 'Fiction', fine_rate: 15 },
      { title: 'Book Three', category: 'Young  Adult', fine_rate: null },
      { title: 'Book Four', category: null, fine_rate: null },
    ]
  );
  assert.throws(
    () =>
      validateImportedBookFineRates([
        { title: 'Conflicting categories', category: 'General', Category: 'Fiction' },
      ]),
    /Row 1 has conflicting category values/
  );
});
