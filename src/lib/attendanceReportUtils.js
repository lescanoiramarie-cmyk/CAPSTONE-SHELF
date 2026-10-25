const dateValue = (record) => record.timeIn ?? record.time_in;
const checkoutValue = (record) => record.checkedOutAt ?? record.checked_out_at;

const durationMinutes = (record) => {
  const start = new Date(dateValue(record)).getTime();
  const endValue = checkoutValue(record);
  const end = endValue ? new Date(endValue).getTime() : Date.now();
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? Math.round((end - start) / 60000)
    : 0;
};

export const formatVisitDuration = (record) => {
  if (!checkoutValue(record)) return 'Active Session';
  const minutes = durationMinutes(record);
  return `${Math.floor(minutes / 60)} hr${Math.floor(minutes / 60) === 1 ? '' : 's'} ${minutes % 60} min${minutes % 60 === 1 ? '' : 's'}`;
};

export const buildAttendanceRows = (records = []) => (Array.isArray(records) ? records : []).map((record) => ({
  id: record.id,
  visitorId: record.visitorId ?? record.visitor_id,
  visitorName: record.visitorName ?? record.visitor_name,
  libraryId: record.libraryId ?? record.library_id,
  timeIn: dateValue(record),
  checkedOutAt: checkoutValue(record),
  duration: formatVisitDuration(record),
  sessionStatus: checkoutValue(record) ? 'Completed' : 'Currently Inside',
}));

const hourLabel = (hour) => {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour} ${suffix}`;
};

const isoDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toISOString().slice(0, 10);
};

const groupCount = (rows, getKey) => {
  const counts = new Map();
  rows.forEach((row) => {
    const key = getKey(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
};

const chart = (type, title, labels, data, colors, extra = {}) => ({
  type,
  title,
  labels,
  data,
  colors,
  ...extra,
});

export const buildSubAdminAttendanceAnalytics = (rows) => {
  const hourly = groupCount(rows, (row) => new Date(row.timeIn).getHours());
  const completed = rows.filter((row) => row.sessionStatus === 'Completed').length;
  const durations = rows.filter((row) => row.sessionStatus === 'Completed');
  const average = durations.length
    ? durations.reduce((sum, row) => sum + durationMinutes(row), 0) / durations.length
    : 0;
  const peak = hourly.reduce((best, current) => current[1] > best[1] ? current : best, [0, 0]);
  return {
    kpis: [
      { label: 'Total Visits', value: rows.length },
      { label: 'Average Visit Duration', value: `${Math.floor(average / 60)} hr ${Math.round(average % 60)} mins` },
      { label: 'Peak Hour', value: hourLabel(Number(peak[0])) },
    ],
    charts: [
      chart('bar', 'Hourly Peak Traffic', hourly.map(([hour]) => hourLabel(Number(hour))), hourly.map(([, count]) => count), '#2563EB'),
      chart('doughnut', 'Visitor Status Breakdown', ['Completed Visits', 'Currently Active'], [completed, rows.length - completed], ['#10B981', '#F97316']),
    ],
  };
};

export const buildSystemAttendanceAnalytics = (rows) => {
  const branches = groupCount(rows, (row) => row.libraryId || 'Unknown');
  const daily = groupCount(rows, (row) => isoDate(row.timeIn));
  const durations = rows.filter((row) => row.sessionStatus === 'Completed');
  const average = durations.length
    ? durations.reduce((sum, row) => sum + durationMinutes(row), 0) / durations.length
    : 0;
  return {
    kpis: [
      { label: 'Total Visits', value: rows.length },
      { label: 'Average Visit Duration', value: `${Math.floor(average / 60)} hr ${Math.round(average % 60)} mins` },
      { label: 'Peak Hour', value: hourLabel(Number(groupCount(rows, (row) => new Date(row.timeIn).getHours()).reduce((best, current) => current[1] > best[1] ? current : best, [0, 0])[0])) },
    ],
    charts: [
      chart('bar', 'Comparative Branch Foot Traffic', branches.map(([branch]) => branch), branches.map(([, count]) => count), '#2563EB'),
      chart('line', 'Daily Attendance Volume Trend', daily.map(([date]) => date), daily.map(([, count]) => count), '#0F766E', { borderColor: '#0F766E', datasetLabel: 'Check-ins' }),
    ],
  };
};

export const buildAttendanceSummary = (rows) => ({
  hourly: groupCount(rows, (row) => hourLabel(new Date(row.timeIn).getHours())).map(([label, count]) => [label, count]),
  daily: groupCount(rows, (row) => isoDate(row.timeIn)),
  branches: groupCount(rows, (row) => row.libraryId || 'Unknown'),
});
