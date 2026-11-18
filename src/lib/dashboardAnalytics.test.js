import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOperationalRecommendations,
  canRunVisitorForecast,
  countMonthlyEventsByCalendarWeek,
  filterAttendanceForAnalytics,
  filterRequestsForLibrary,
  filterRowsForLibrary,
  getMonthlyCalendarWeekBuckets,
  getRequestLibraryId,
  getRequestStatus,
} from './dashboardAnalytics.js';

test('branch filters normalize UUID-like IDs and fail closed on missing branch', () => {
  const rows = [{ library_id: 'branch-a' }, { libraryId: 'branch-b' }, { libraryId: null }];
  assert.deepEqual(filterRowsForLibrary(rows, 'branch-a'), [rows[0]]);
  assert.deepEqual(filterRowsForLibrary(rows, ''), []);
});

test('attendance analytics preserve branch isolation and use an inclusive-start exclusive-end date window', () => {
  const rows = [
    { id: 'a', library_id: 'branch-a', time_in: '2026-11-01T00:00:00Z' },
    { id: 'b', library_id: 'branch-a', time_in: '2026-11-02T12:00:00Z' },
    { id: 'c', library_id: 'branch-b', time_in: '2026-11-02T12:00:00Z' },
    { id: 'd', library_id: 'branch-a', time_in: '2026-11-03T00:00:00Z' },
  ];
  assert.deepEqual(
    filterAttendanceForAnalytics(rows, {
      libraryId: 'branch-a',
      requireLibraryId: true,
      start: '2026-11-02T00:00:00Z',
      endExclusive: '2026-11-03T00:00:00Z',
    }).map((item) => item.id),
    ['b']
  );
  assert.deepEqual(filterAttendanceForAnalytics(rows, { requireLibraryId: true }), []);
});

test('request branch uses request metadata and excludes conflicting book ownership', () => {
  const books = new Map([
    ['book-1', { library_id: 'branch-a', category: 'History' }],
    ['book-2', { libraryId: 'branch-b' }],
  ]);
  const requests = [
    { book_id: 'book-1', library_id: 'branch-a' },
    { bookId: 'book-2', libraryId: 'branch-a' },
    { bookId: 'book-1' },
  ];
  assert.equal(getRequestLibraryId(requests[0], books), 'branch-a');
  assert.equal(getRequestLibraryId(requests[1], books), '');
  assert.deepEqual(filterRequestsForLibrary(requests, books, 'branch-a'), [requests[0], requests[2]]);
});

test('monthly calendar buckets cover each day exactly once and exclude adjacent months', () => {
  const now = new Date(2026, 10, 12, 12);
  const { monthLabel, buckets } = getMonthlyCalendarWeekBuckets(now);
  assert.equal(monthLabel, 'October 2026');
  const totalDays = buckets.reduce((total, bucket) => total + (bucket.endExclusive - bucket.start) / 86400000, 0);
  assert.equal(totalDays, 31);

  const result = countMonthlyEventsByCalendarWeek([
    { date: '2026-09-30T23:59:00' },
    { date: '2026-10-01T12:00:00' },
    { date: '2026-10-31T23:59:00' },
    { date: '2026-11-01T00:00:00' },
  ], (row) => row.date, now);
  assert.equal(result.counts.reduce((sum, count) => sum + count, 0), 2);
});

test('recommendations compare fixed selected-window weeks and report insufficient evidence', () => {
  const end = new Date(2026, 10, 12);
  const attendance = [
    ...Array.from({ length: 6 }, (_, index) => ({ timeIn: new Date(end.getTime() - (index + 1) * 86400000).toISOString() })),
    ...Array.from({ length: 5 }, (_, index) => ({ timeIn: new Date(end.getTime() - (index + 8) * 86400000).toISOString() })),
  ];
  const recommendations = buildOperationalRecommendations({
    attendance,
    categoryDemand: [['History', 7], ['Science', 4]],
    windowEnd: end,
    attendanceComplete: true,
  });
  assert.match(recommendations[0], /increased from 5 to 6/);
  assert.match(recommendations[1], /History led selected-range demand with 7 of 11 requests/);

  const sparse = buildOperationalRecommendations({ attendance: [], categoryDemand: [], windowEnd: end, attendanceComplete: true });
  assert.match(sparse[0], /Insufficient attendance volume/);
  assert.match(sparse[1], /Insufficient book-request volume/);
});

test('forecast requires sufficient observations and an explicitly complete attendance feed', () => {
  assert.equal(canRunVisitorForecast({ historyDays: 30, observedVisitDays: 12, totalVisits: 24, attendanceComplete: true }), true);
  assert.equal(canRunVisitorForecast({ historyDays: 30, observedVisitDays: 12, totalVisits: 24, attendanceComplete: false }), false);
  assert.equal(canRunVisitorForecast({ historyDays: 30, observedVisitDays: 3, totalVisits: 24, attendanceComplete: true }), false);
});

test('incomplete attendance blocks a staffing recommendation based on partial history', () => {
  const end = new Date(2026, 10, 12);
  const recommendations = buildOperationalRecommendations({
    attendance: Array.from({ length: 12 }, (_, index) => ({
      timeIn: new Date(end.getTime() - (index + 1) * 86400000).toISOString(),
    })),
    categoryDemand: [],
    windowEnd: end,
    attendanceComplete: false,
  });
  assert.match(recommendations[0], /history is incomplete or unavailable/);
});

test('request statuses are normalized before KPI calculations', () => {
  assert.equal(getRequestStatus({ status: 'Ready for Pickup' }), 'ready_for_pickup');
  assert.equal(getRequestStatus({ status: 'BORROWED' }), 'borrowed');
});