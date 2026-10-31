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

function migrationFunction(name) {
  const match = fineRateMigration.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name} \\([\\s\\S]*?\\$function\\$;`,
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
  for (const name of [
    'confirm_pickup',
    'confirm_community_book_pickup',
  ]) {
    const body = migrationFunction(name);
    assert.match(body, /status\s*=\s*'borrowed'/i);
    assert.match(body, /fine_rate_snapshot\s*=\s*v_fine_rate/i);
    assert.match(body, /IS NULL OR v_fine_rate NOT IN \(10, 15, 20\)/i);
  }
});

test('checkout RPC contracts preserve staff signatures and community lending behavior', () => {
  for (const name of ['confirm_pickup', 'confirm_return']) {
    assert.match(
      migrationFunction(name),
      new RegExp(`${name} \\(\\s*p_request_id text`, 'i')
    );
  }
  assert.doesNotMatch(
    fineRateMigration,
    /DROP FUNCTION(?: IF EXISTS)? public\.confirm_(?:pickup|return)\s*\(/i
  );

  const communityPickup = migrationFunction(
    'confirm_community_book_pickup'
  );
  assert.match(
    communityPickup,
    /RETURNS TABLE\s*\(\s*id uuid,\s*status text,\s*borrow_date timestamp with time zone,\s*due_date timestamp with time zone,\s*confirmed_by text\s*\)/i
  );
  assert.match(communityPickup, /book\.book_type = 'personal'/i);
  assert.match(communityPickup, /book\.lending_enabled/i);
  assert.match(
    communityPickup,
    /make_interval\(days\s*=>\s*v_lending_days\)/i
  );
  assert.match(communityPickup, /fine_rate_snapshot\s*=\s*v_fine_rate/i);
});

test('return functions calculate from snapshots and keep legacy fines untouched', () => {
  for (const name of ['confirm_return', 'confirm_community_book_return']) {
    const body = migrationFunction(name);
    assert.match(body, /v_req\.fine_rate_snapshot/i);
    assert.doesNotMatch(body, /fine_amount\s*=\s*[^;\n]*\*\s*10/i);
    const legacyBranchStart = body.lastIndexOf('  ELSE');
    assert.notEqual(legacyBranchStart, -1);
    const legacyBranch = body.slice(legacyBranchStart);
    assert.doesNotMatch(legacyBranch, /fine_amount\s*=/i);
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
