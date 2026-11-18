import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAttendanceCursorFilter, fetchAllAttendancePages } from './attendancePagination.js';

const row = (id, time) => ({ id, time_in: `2026-11-12T${time}:00.000Z` });

test('fetches every keyset page and returns deterministic order without duplicate rows', async () => {
  const pages = [
    [row('a', '10:00'), row('b', '09:00')],
    [row('b', '09:00'), row('c', '08:00')],
    [row('d', '07:00')],
  ];
  const cursors = [];
  const result = await fetchAllAttendancePages(async (cursor) => {
    cursors.push(cursor);
    return { data: pages.shift(), error: null };
  }, 2);

  assert.deepEqual(result.map((item) => item.id), ['a', 'b', 'c', 'd']);
  assert.equal(cursors.length, 3);
  assert.equal(cursors[1].id, 'b');
});

test('builds a strict continuation filter for descending time and ascending id order', () => {
  assert.equal(buildAttendanceCursorFilter(null), null);
  assert.equal(
    buildAttendanceCursorFilter(row('visitor-id', '09:00')),
    'time_in.lt.2026-11-12T09:00:00.000Z,and(time_in.eq.2026-11-12T09:00:00.000Z,id.gt.visitor-id)'
  );
});

test('fails closed when a page repeats its terminal cursor or contains malformed rows', async () => {
  const repeated = row('same', '10:00');
  await assert.rejects(
    fetchAllAttendancePages(async () => ({ data: [repeated], error: null }), 1),
    /did not advance/
  );
  await assert.rejects(
    fetchAllAttendancePages(async () => ({ data: [{ id: 'missing-time' }], error: null }), 1),
    /without a valid cursor/
  );
});