const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function dateValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function AnalyticsDateFilter({
  timeframe,
  onTimeframeChange,
  onCustomStartChange,
  onCustomEndChange,
  range,
}) {
  const selectedDate = range?.start instanceof Date && Number.isFinite(range.start.getTime())
    ? range.start
    : new Date();
  const selectedYear = selectedDate.getFullYear();
  const selectedMonth = selectedDate.getMonth();
  const period = timeframe === 'annual' ? 'annual' : timeframe === 'weekly' ? 'weekly' : 'monthly';
  // Keep the list independent from the selected year. Deriving it from the
  // selected date made every newer year disappear after choosing an older one.
  const currentYear = new Date().getFullYear();
  const firstYear = Math.min(2024, currentYear);
  const years = Array.from(
    { length: currentYear - firstYear + 1 },
    (_, index) => currentYear - index
  );

  const applyPeriod = (year, month) => {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    onTimeframeChange('custom');
    onCustomStartChange(dateValue(start));
    onCustomEndChange(dateValue(end));
  };

  const weekStartFor = (year, weekIndex) => {
    const start = new Date(year, 0, 1);
    start.setDate(start.getDate() + weekIndex * 7);
    return start;
  };
  const selectedWeek = Math.max(0, Math.floor((selectedDate - weekStartFor(selectedYear, 0)) / 604800000));
  const weekCount = Math.ceil((new Date(selectedYear + 1, 0, 1) - weekStartFor(selectedYear, 0)) / 604800000);
  const applyAnnual = (year) => {
    onTimeframeChange('annual');
    onCustomStartChange(dateValue(new Date(year, 0, 1)));
    onCustomEndChange(dateValue(new Date(year, 11, 31)));
  };
  const applyWeek = (year, weekIndex) => {
    const start = weekStartFor(year, weekIndex);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    if (end > new Date(year, 11, 31)) end.setTime(new Date(year, 11, 31).getTime());
    onTimeframeChange('weekly');
    onCustomStartChange(dateValue(start));
    onCustomEndChange(dateValue(end));
  };
  const applyYear = (year) => {
    if (period === 'annual') applyAnnual(year);
    else if (period === 'weekly') applyWeek(year, 0);
    else applyPeriod(year, selectedMonth);
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="col-span-2 block text-xs font-semibold text-slate-600 dark:text-slate-300">
        View by
        <select
          value={period}
          onChange={(event) => {
            const next = event.target.value;
            if (next === 'annual') applyAnnual(selectedYear);
            else if (next === 'weekly') applyWeek(selectedYear, selectedWeek);
            else applyPeriod(selectedYear, selectedMonth);
          }}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        >
          <option value="monthly">Month</option>
          <option value="annual">Whole year</option>
          <option value="weekly">Week</option>
        </select>
      </label>
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
        Year
        <select
          value={selectedYear}
          onChange={(event) => applyYear(Number(event.target.value))}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        >
          {years.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
      </label>
      {period === 'monthly' && <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
        Month
        <select
          value={selectedMonth}
          onChange={(event) => applyPeriod(selectedYear, Number(event.target.value))}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        >
          {MONTHS.map((month, index) => <option key={month} value={index}>{month}</option>)}
        </select>
      </label>}
      {period === 'weekly' && <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
        Week
        <select
          value={selectedWeek}
          onChange={(event) => applyWeek(selectedYear, Number(event.target.value))}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        >
          {Array.from({ length: weekCount }, (_, index) => {
            const start = weekStartFor(selectedYear, index);
            const end = new Date(start);
            end.setDate(end.getDate() + 6);
            if (end > new Date(selectedYear, 11, 31)) end.setTime(new Date(selectedYear, 11, 31).getTime());
            const dates = `${start.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}`;
            return <option key={index} value={index}>Week {index + 1} ({dates})</option>;
          })}
        </select>
      </label>}
    </div>
  );
}
