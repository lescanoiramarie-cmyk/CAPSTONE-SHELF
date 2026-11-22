const DAY_MS = 24 * 60 * 60 * 1000;

export function getAnalyticsMonthKey(value = new Date()) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function getAnalyticsMonthOptions(count = 12, value = new Date()) {
  const current = new Date(value.getFullYear(), value.getMonth(), 1);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(current.getFullYear(), current.getMonth() - index, 1);
    return {
      value: getAnalyticsMonthKey(date),
      label: date.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }),
    };
  });
}

export function getAnalyticsYearOptions(startYear = 2024, value = new Date()) {
  const currentYear = new Date(value).getFullYear();
  return Array.from({ length: Math.max(0, currentYear - startYear + 1) }, (_, index) => currentYear - index);
}

export function getAnalyticsMonthOptionsForYear(year, value = new Date()) {
  const selectedYear = Number(year);
  const current = new Date(value);
  const lastMonth = selectedYear === current.getFullYear() ? current.getMonth() : 11;
  return getAnalyticsMonthOptions(lastMonth + 1, new Date(selectedYear, lastMonth, 1));
}

export function getAnalyticsMonthWindow(monthKey) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (month < 0 || month > 11) return null;
  const start = new Date(year, month, 1);
  const endExclusive = new Date(year, month + 1, 1);
  return {
    start,
    endExclusive,
    days: new Date(year, month + 1, 0).getDate(),
    monthLabel: start.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }),
  };
}

export function getMonthlyBorrowingProjection(requests = [], anchorDate = new Date(), historyMonths = 5) {
  const anchor = new Date(anchorDate);
  if (!Number.isFinite(anchor.getTime())) return { labels: [], values: [], projectedNextMonth: null };
  const endMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
  const startMonth = new Date(anchor.getFullYear(), anchor.getMonth() - Math.max(1, historyMonths) + 1, 1);
  const months = [];
  for (let cursor = new Date(startMonth); cursor < endMonth; cursor.setMonth(cursor.getMonth() + 1)) {
    months.push({
      key: getAnalyticsMonthKey(cursor),
      label: cursor.toLocaleDateString('en-US', { month: 'short' }),
      value: 0,
    });
  }
  const byMonth = new Map(months.map((month) => [month.key, month]));
  requests.forEach((request) => {
    const dateValue = request?.borrowDate ?? request?.borrow_date;
    if (!dateValue) return;
    const date = new Date(dateValue);
    if (!Number.isFinite(date.getTime())) return;
    const month = byMonth.get(getAnalyticsMonthKey(date));
    if (month) month.value += 1;
  });
  const observed = months.slice(-3).map((month) => month.value);
  const projectedNextMonth = observed.some((value) => value > 0)
    ? Math.round(observed.reduce((sum, value) => sum + value, 0) / observed.length)
    : null;
  return {
    labels: [...months.map((month) => month.label), ...(projectedNextMonth == null ? [] : ['Next'])],
    values: [...months.map((month) => month.value), ...(projectedNextMonth == null ? [] : [projectedNextMonth])],
    projectedNextMonth,
  };
}

export function normalizeAnalyticsId(value) {
  return value == null || value === '' ? '' : String(value);
}

export function getRowLibraryId(row) {
  return normalizeAnalyticsId(row?.libraryId) || normalizeAnalyticsId(row?.library_id);
}

export function getRequestLibraryId(request, booksById) {
  const requestLibraryId = getRowLibraryId(request);
  const bookId = normalizeAnalyticsId(request?.bookId ?? request?.book_id);
  const book = booksById.get(bookId) ?? booksById.get(request?.bookId ?? request?.book_id);
  const bookLibraryId = getRowLibraryId(book);

  // A conflicting request/book branch is ambiguous; exclude it from branch analytics.
  if (requestLibraryId && bookLibraryId && requestLibraryId !== bookLibraryId) return '';
  return requestLibraryId || bookLibraryId;
}

export function filterRowsForLibrary(rows, libraryId, getLibraryId = getRowLibraryId) {
  const targetId = normalizeAnalyticsId(libraryId);
  if (!targetId) return [];
  return rows.filter((row) => getLibraryId(row) === targetId);
}

export function filterAttendanceForAnalytics(rows, {
  libraryId = null,
  requireLibraryId = false,
  start = null,
  endExclusive = null,
} = {}) {
  const targetId = normalizeAnalyticsId(libraryId);
  if (requireLibraryId && !targetId) return [];
  const startTime = start == null ? null : new Date(start).getTime();
  const endTime = endExclusive == null ? null : new Date(endExclusive).getTime();
  if ((start != null && !Number.isFinite(startTime)) || (endExclusive != null && !Number.isFinite(endTime))) return [];

  return rows.filter((row) => {
    if (targetId && getRowLibraryId(row) !== targetId) return false;
    const value = row?.timeIn ?? row?.time_in;
    const time = new Date(value ?? '').getTime();
    if (!Number.isFinite(time)) return false;
    return (startTime == null || time >= startTime) && (endTime == null || time < endTime);
  });
}

export function filterRequestsForLibrary(requests, booksById, libraryId) {
  const targetId = normalizeAnalyticsId(libraryId);
  if (!targetId) return [];
  return requests.filter((request) => getRequestLibraryId(request, booksById) === targetId);
}

export function getRequestDate(request) {
  return request?.requestDate ?? request?.request_date ?? null;
}

export function getRequestStatus(request) {
  return String(request?.status ?? '').trim().toLowerCase().replace(/\s+/g, '_');
}

export function getMonthlyCalendarWeekBuckets(value = new Date()) {
  const date = new Date(value);
  const start = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  const end = new Date(date.getFullYear(), date.getMonth(), 1);
  const monthLabel = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const buckets = [];

  for (let cursor = new Date(start); cursor < end;) {
    const bucketStart = new Date(cursor);
    const daysToSaturday = 6 - bucketStart.getDay();
    const bucketEnd = new Date(bucketStart);
    bucketEnd.setDate(bucketEnd.getDate() + daysToSaturday + 1);
    if (bucketEnd > end) bucketEnd.setTime(end.getTime());
    const lastDay = new Date(bucketEnd.getTime() - 1);
    buckets.push({
      start: bucketStart,
      endExclusive: bucketEnd,
      label: `${bucketStart.toLocaleDateString('en-US', { month: 'short' })} ${bucketStart.getDate()}–${lastDay.getDate()}`,
    });
    cursor = bucketEnd;
  }

  return { monthLabel, buckets };
}

export function countMonthlyEventsByCalendarWeek(rows, getDate, now = new Date()) {
  const { monthLabel, buckets } = getMonthlyCalendarWeekBuckets(now);
  const counts = Array(buckets.length).fill(0);
  rows.forEach((row) => {
    const value = getDate(row);
    if (!value) return;
    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime())) return;
    const index = buckets.findIndex((bucket) => timestamp >= bucket.start && timestamp < bucket.endExclusive);
    if (index >= 0) counts[index] += 1;
  });
  return { monthLabel, labels: buckets.map((bucket) => bucket.label), counts };
}

export function getComparisonWindowCounts(rows, getDate, endExclusive) {
  const end = new Date(endExclusive).getTime();
  if (!Number.isFinite(end)) return { recent: 0, previous: 0 };
  const recentStart = end - 7 * DAY_MS;
  const previousStart = end - 14 * DAY_MS;
  return rows.reduce((counts, row) => {
    const timestamp = new Date(getDate(row) ?? '').getTime();
    if (!Number.isFinite(timestamp)) return counts;
    if (timestamp >= recentStart && timestamp < end) counts.recent += 1;
    else if (timestamp >= previousStart && timestamp < recentStart) counts.previous += 1;
    return counts;
  }, { recent: 0, previous: 0 });
}

export function buildOperationalRecommendations({
  attendance = [],
  categoryDemand = [],
  windowEnd,
  attendanceComplete = false,
}) {
  const { recent, previous } = getComparisonWindowCounts(attendance, (row) => row?.timeIn ?? row?.time_in, windowEnd);
  const recommendations = [];

  if (!attendanceComplete) {
    recommendations.push('Attendance history is incomplete or unavailable; a reliable staffing recommendation cannot be calculated.');
  } else if (previous >= 5 && recent >= 5 && recent >= previous * 1.2) {
    recommendations.push(`Attendance increased from ${previous} to ${recent} check-ins across the last two complete seven-day windows in the selected range. Review desk coverage for this period.`);
  } else if (recent < 5 || previous < 5) {
    recommendations.push('Insufficient attendance volume in one or both seven-day comparison windows for a reliable staffing recommendation.');
  } else {
    recommendations.push(`Attendance was ${recent} check-ins in the latest seven-day window and ${previous} in the prior window; no increase of 20% or more was observed.`);
  }

  const topCategory = categoryDemand[0];
  const totalRequests = categoryDemand.reduce((total, [, count]) => total + count, 0);
  if (topCategory && topCategory[1] >= 5 && totalRequests >= 10) {
    recommendations.push(`${topCategory[0]} led selected-range demand with ${topCategory[1]} of ${totalRequests} requests. Review branch inventory before changing copy levels.`);
  } else {
    recommendations.push('Insufficient book-request volume in the selected range for a reliable category stocking recommendation.');
  }

  return recommendations;
}

export function canRunVisitorForecast({ historyDays, observedVisitDays, totalVisits, attendanceComplete = false }) {
  return historyDays >= 7 && observedVisitDays >= 2 && totalVisits >= 3 && attendanceComplete;
}

export const ANALYTICS_DAY_MS = DAY_MS;
