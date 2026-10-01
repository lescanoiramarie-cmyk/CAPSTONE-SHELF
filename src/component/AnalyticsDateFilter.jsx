import { TIMEFRAME_OPTIONS } from '../lib/analyticsDateRange.js';

export default function AnalyticsDateFilter({
  timeframe,
  onTimeframeChange,
  customStart,
  onCustomStartChange,
  customEnd,
  onCustomEndChange,
  range,
}) {
  return (
    <div className="space-y-3">
      <label className="block text-xs font-semibold text-slate-600">
        Date range
        <select
          value={timeframe}
          onChange={(event) => onTimeframeChange(event.target.value)}
          className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700"
        >
          {TIMEFRAME_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {timeframe === 'custom' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-slate-600">
            Start date
            <input
              type="date"
              value={customStart}
              onChange={(event) => onCustomStartChange(event.target.value)}
              className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700"
            />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            End date
            <input
              type="date"
              value={customEnd}
              onChange={(event) => onCustomEndChange(event.target.value)}
              className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700"
            />
          </label>
        </div>
      )}

      {!range.valid && (
        <p role="alert" className="border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          {range.error}
        </p>
      )}
    </div>
  );
}