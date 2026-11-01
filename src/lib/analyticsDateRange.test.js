import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getTimeframeBucketKey,
  getTimeframeBuckets,
  getTimeframeRange,
  TIMEFRAME_OPTIONS,
} from './analyticsDateRange.js';

test('all-time range includes historical activity through today', () => {
  const now = new Date(2026, 10, 1, 12);
  const range = getTimeframeRange('all', '', '', now);

  assert.equal(range.valid, true);
  assert.equal(range.label, 'All time');
  assert.equal(range.start.getTime(), 0);
  assert.equal(range.endExclusive.getTime(), new Date(2026, 10, 2).getTime());
  assert.ok(TIMEFRAME_OPTIONS.some((option) => option.id === 'all'));
  assert.equal(getTimeframeBucketKey(new Date(2024, 3, 5), 'all'), '2024');
});

test('all-time analytics groups activity into yearly buckets', () => {
  const range = getTimeframeRange('all', '', '', new Date(2026, 10, 1, 12));
  const buckets = getTimeframeBuckets('all', range);

  assert.equal(buckets[0].key, '1970');
  assert.equal(buckets.at(-1).key, '2026');
  assert.equal(buckets.at(-1).label, '2026');
});

test('existing timeframe bucket keys retain their previous granularity', () => {
  const date = new Date(2026, 10, 1);

  assert.equal(getTimeframeBucketKey(date, 'year'), '2026-11');
  assert.equal(getTimeframeBucketKey(date, 'this_month'), '2026-11-01');
});
