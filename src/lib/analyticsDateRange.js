export const TIMEFRAME_OPTIONS = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: 'this_week', label: 'This week' },
  { id: 'last_week', label: 'Last week' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'year', label: 'This year' },
  { id: 'custom', label: 'Custom range' },
];

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function mondayOf(value) {
  const date = startOfDay(value);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function range(start, endExclusive, label) {
  return { start, endExclusive, label, valid: true, error: '' };
}

export function getTimeframeRange(
  timeframe,
  customStart = '',
  customEnd = '',
  now = new Date()
) {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);

  if (timeframe === 'today') {
    return range(today, tomorrow, 'Today');
  }

  if (timeframe === '7d') {
    return range(addDays(today, -6), tomorrow, 'Last 7 days');
  }

  if (timeframe === 'this_week') {
    return range(mondayOf(today), tomorrow, 'This week');
  }

  if (timeframe === 'last_week') {
    const end = mondayOf(today);
    return range(addDays(end, -7), end, 'Last week');
  }

  if (timeframe === 'this_month') {
    return range(
      new Date(today.getFullYear(), today.getMonth(), 1),
      tomorrow,
      'This month'
    );
  }

  if (timeframe === 'last_month') {
    return range(
      new Date(today.getFullYear(), today.getMonth() - 1, 1),
      new Date(today.getFullYear(), today.getMonth(), 1),
      'Last month'
    );
  }

  if (timeframe === 'year') {
    return range(
      new Date(today.getFullYear(), 0, 1),
      tomorrow,
      'This year'
    );
  }

  if (timeframe === 'custom') {
    if (!customStart || !customEnd) {
      return {
        start: today,
        endExclusive: tomorrow,
        label: 'Custom range',
        valid: false,
        error: 'Select both a start date and an end date.',
      };
    }

    const start = startOfDay(`${customStart}T00:00:00`);
    const end = startOfDay(`${customEnd}T00:00:00`);

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      start > end
    ) {
      return {
        start,
        endExclusive: addDays(end, 1),
        label: 'Custom range',
        valid: false,
        error: 'The start date must be on or before the end date.',
      };
    }

    return range(
      start,
      addDays(end, 1),
      `${customStart} to ${customEnd}`
    );
  }

  throw new RangeError(`Unsupported analytics timeframe: ${timeframe}`);
}

export function getTimeframeBuckets(timeframe, timeframeRange) {
  const buckets = [];

  if (!timeframeRange?.valid) {
    return buckets;
  }

  if (timeframe === 'year') {
    const cursor = new Date(
      timeframeRange.start.getFullYear(),
      timeframeRange.start.getMonth(),
      1
    );

    while (cursor < timeframeRange.endExclusive) {
      const next = new Date(
        cursor.getFullYear(),
        cursor.getMonth() + 1,
        1
      );
      const endExclusive = new Date(
        Math.min(next.getTime(), timeframeRange.endExclusive.getTime())
      );
      buckets.push({
        start: new Date(cursor),
        endExclusive,
        key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`,
        label: cursor.toLocaleDateString(undefined, { month: 'short' }),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return buckets;
  }

  const cursor = new Date(timeframeRange.start);

  while (cursor < timeframeRange.endExclusive) {
    const endExclusive = addDays(cursor, 1);
    buckets.push({
      start: new Date(cursor),
      endExclusive,
      key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`,
      label: cursor.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return buckets;
}