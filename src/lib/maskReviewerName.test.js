import assert from 'node:assert/strict';
import test from 'node:test';
import { maskReviewerName } from './maskReviewerName.js';

test('masks reviewer names correctly according to privacy requirements', () => {
  // Two-word name
  assert.equal(maskReviewerName('Kyle Morcilla'), 'K*** M.');
  assert.equal(maskReviewerName('Ana Reyes'), 'A*** R.');

  // Multi-word name (first name and last name initial)
  assert.equal(maskReviewerName('Mary Jane Cruz'), 'M*** C.');

  // Single name
  assert.equal(maskReviewerName('John'), 'J***');
  assert.equal(maskReviewerName('admin'), 'A***');

  // Fallbacks
  assert.equal(maskReviewerName(''), 'Verified Reader');
  assert.equal(maskReviewerName('   '), 'Verified Reader');
  assert.equal(maskReviewerName(null), 'Verified Reader');
  assert.equal(maskReviewerName(undefined), 'Verified Reader');
  assert.equal(maskReviewerName('Verified Reader'), 'Verified Reader');
  assert.equal(maskReviewerName('verified reader'), 'Verified Reader');

  // Already masked preserves structure
  assert.equal(maskReviewerName('K*** M.'), 'K*** M.');
  assert.equal(maskReviewerName('J***'), 'J***');
});
