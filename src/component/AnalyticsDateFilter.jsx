const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function dateValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function AnalyticsDateFilter({
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
  const firstYear = Math.min(2024, selectedYear);
  const years = Array.from({ length: selectedYear - firstYear + 1 }, (_, index) => firstYear + index).reverse();

  const applyPeriod = (year, month) => {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    onTimeframeChange('custom');
    onCustomStartChange(dateValue(start));
    onCustomEndChange(dateValue(end));
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
        Year
        <select
          value={selectedYear}
          onChange={(event) => applyPeriod(Number(event.target.value), selectedMonth)}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        >
          {years.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
      </label>
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
        Month
        <select
          value={selectedMonth}
          onChange={(event) => applyPeriod(selectedYear, Number(event.target.value))}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        >
          {MONTHS.map((month, index) => <option key={month} value={index}>{month}</option>)}
        </select>
      </label>
    </div>
  );
}
