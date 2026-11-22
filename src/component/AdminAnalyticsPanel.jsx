import { Activity, Lightbulb, TrendingUp } from 'lucide-react';

function toNumber(value) {
  const numericText = String(value ?? '').replace(/,/g, '').replace(/%/g, '').trim();
  return /^-?\d+(\.\d+)?$/.test(numericText) ? Number(numericText) : Number.NaN;
}

export default function AdminAnalyticsPanel({
  title,
  description = '',
  metrics = [],
  prediction = 'There is not enough recent information to estimate what may happen next.',
  recommendation = 'Keep records up to date and review this section regularly.',
  predictiveSeries = [],
  rationale = '',
}) {
  const chartMetrics = metrics
    .map((metric) => ({ ...metric, chartValue: toNumber(metric.value) }))
    .filter((metric) => Number.isFinite(metric.chartValue) && metric.chartValue >= 0);
  const chartMaximum = Math.max(1, ...chartMetrics.map((metric) => metric.chartValue));
  const usableForecast = predictiveSeries
    .map((point) => ({ ...point, value: Number(point.value) }))
    .filter((point) => Number.isFinite(point.value) && point.value >= 0);
  const forecastMaximum = Math.max(1, ...usableForecast.map((point) => point.value));
  const forecastPoints = usableForecast.map((point, index) => {
    const x = usableForecast.length < 2 ? 160 : 18 + (index / (usableForecast.length - 1)) * 284;
    const y = 94 - (point.value / forecastMaximum) * 72;
    return { ...point, x, y };
  });

  return (
    <section aria-label={`${title} analytics`} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-slate-900 dark:text-white">
          <Activity size={19} aria-hidden="true" className="text-blue-700 dark:text-blue-300" />
          <h3 className="text-xl font-extrabold">{title}</h3>
        </div>
        {description && <p className="text-sm text-slate-600 dark:text-slate-300">{description}</p>}
      </div>

      <div className="grid items-stretch gap-4 lg:grid-cols-3">
        <article className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <h4 className="text-lg font-bold text-slate-900 dark:text-white">Descriptive Analytics</h4>
          <p className="mt-1 min-h-10 text-sm text-slate-600 dark:text-slate-300">Current recorded totals and their relative comparison.</p>
          {metrics.length > 0 ? (
            <dl className="mt-3 grid grid-cols-2 gap-2">
              {metrics.map((metric) => (
                <div key={metric.label} className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-900">
                  <dt className="text-xs font-semibold text-slate-600 dark:text-slate-300">{metric.label}</dt>
                  <dd className="mt-1 text-xl font-extrabold tabular-nums text-slate-900 dark:text-white">{metric.value}</dd>
                  {metric.note && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{metric.note}</p>}
                </div>
              ))}
            </dl>
          ) : <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">No descriptive totals are available.</p>}
          {chartMetrics.length > 1 && (
            <figure className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-700">
              <figcaption className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">Relative comparison of recorded totals</figcaption>
              <div role="img" aria-label={`${title}: ${chartMetrics.map((metric) => `${metric.label} ${metric.value}`).join(', ')}`} className="flex h-28 items-end gap-2 border-b border-l border-slate-200 px-2 pt-2 dark:border-slate-600">
                {chartMetrics.map((metric) => (
                  <div key={metric.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                    <span className="text-[11px] font-bold tabular-nums text-slate-700 dark:text-slate-200">{metric.value}</span>
                    <span className="w-full max-w-10 rounded-t bg-blue-600" style={{ height: `${Math.max(metric.chartValue > 0 ? 5 : 0, (metric.chartValue / chartMaximum) * 68)}%` }} />
                    <span className="w-full truncate text-center text-[10px] text-slate-500 dark:text-slate-400">{metric.label}</span>
                  </div>
                ))}
              </div>
            </figure>
          )}
        </article>

        <article className="min-w-0 rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/40">
          <div className="flex items-center gap-2 text-indigo-950 dark:text-indigo-100">
            <TrendingUp size={18} aria-hidden="true" />
            <h4 className="text-lg font-bold">Predictive Analytics</h4>
          </div>
          <p className="mt-1 min-h-10 text-sm text-indigo-900/80 dark:text-indigo-200">Estimate or outlook derived from the available history.</p>
          {forecastPoints.length > 1 && (
            <figure className="mt-3 rounded-lg border border-indigo-100 bg-white/80 p-2 dark:border-indigo-900 dark:bg-slate-900/60">
              <svg viewBox="0 0 320 120" className="h-28 w-full" role="img" aria-label={`Forecast trend: ${forecastPoints.map((point) => `${point.label} ${point.value}`).join(', ')}`}>
                <line x1="18" y1="96" x2="302" y2="96" stroke="currentColor" className="text-indigo-200 dark:text-indigo-800" />
                <polyline points={forecastPoints.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                {forecastPoints.map((point) => <circle key={`${point.label}-${point.x}`} cx={point.x} cy={point.y} r="4" fill="white" stroke="#2563eb" strokeWidth="2" />)}
              </svg>
              <figcaption className="flex justify-between gap-2 text-[10px] text-slate-600 dark:text-slate-300">
                {forecastPoints.map((point) => <span key={point.label} className="truncate">{point.label}: {point.value}</span>)}
              </figcaption>
            </figure>
          )}
          <p className="mt-3 text-sm font-semibold leading-6 text-indigo-950 dark:text-indigo-100">{prediction}</p>
        </article>

        <article className="min-w-0 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
          <div className="flex items-center gap-2 text-amber-950 dark:text-amber-100">
            <Lightbulb size={18} aria-hidden="true" />
            <h4 className="text-lg font-bold">Prescriptive Analytics</h4>
          </div>
          <p className="mt-1 min-h-10 text-sm text-amber-900/80 dark:text-amber-200">Suggested action based on the current measures and outlook.</p>
          <div className="mt-3 rounded-lg border border-amber-200 bg-white/80 p-3 dark:border-amber-900 dark:bg-slate-900/50">
            <p className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">Recommended action</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-amber-950 dark:text-amber-100">{recommendation}</p>
            {rationale && <><p className="mt-3 text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">Rationale</p><p className="mt-1 text-sm leading-5 text-amber-950 dark:text-amber-100">{rationale}</p></>}
          </div>
        </article>
      </div>
    </section>
  );
}
