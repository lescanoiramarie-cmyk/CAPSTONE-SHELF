import { Activity, Lightbulb } from 'lucide-react';

/** A compact, prominent descriptive/predictive/prescriptive analytics panel. */
export default function AdminAnalyticsPanel({
  title,
  description = '',
  metrics = [],
  prediction = 'There is not enough recent information to estimate what may happen next.',
  recommendation = 'Keep records up to date and review this section regularly.',
}) {
  const chartMetrics = metrics
    .map((metric) => {
      const numericText = String(metric.value ?? '').replace(/,/g, '').replace(/%/g, '').trim();
      return {
        ...metric,
        chartValue: /^-?\d+(\.\d+)?$/.test(numericText) ? Number(numericText) : Number.NaN,
      };
    })
    .filter((metric) => Number.isFinite(metric.chartValue) && metric.chartValue >= 0);
  const chartMaximum = Math.max(1, ...chartMetrics.map((metric) => metric.chartValue));

  return (
    <section aria-label={`${title} analytics`} className="overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-blue-100 bg-gradient-to-r from-blue-50 via-white to-indigo-50 px-5 py-4 dark:border-slate-700 dark:from-slate-800 dark:via-slate-800 dark:to-slate-900">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-blue-100 p-2.5 text-blue-800 dark:bg-blue-950 dark:text-blue-300"><Activity size={19} aria-hidden="true" /></span>
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">Analytics summary</p>
            <h3 className="mt-0.5 text-lg font-bold text-slate-900 dark:text-white">{title}</h3>
            {description && <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{description}</p>}
          </div>
        </div>
      </div>
      {metrics.length > 0 && <><p className="px-4 pt-3 text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Descriptive analytics · Current totals</p><dl className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-4 sm:divide-y-0 dark:divide-slate-700">
        {metrics.map((metric) => <div key={metric.label} className="px-4 py-3"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{metric.label}</dt><dd className="mt-1 text-xl font-extrabold tabular-nums text-slate-900 dark:text-white">{metric.value}</dd>{metric.note && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{metric.note}</p>}</div>)}
      </dl>{chartMetrics.length > 1 && <figure className="border-t border-slate-100 px-4 py-3 dark:border-slate-700"><figcaption className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Descriptive analytics · Relative metric comparison</figcaption><div role="img" aria-label={`${title} descriptive metrics comparison: ${chartMetrics.map((metric) => `${metric.label} ${metric.value}`).join(', ')}`} className="space-y-2">{chartMetrics.map((metric) => <div key={metric.label} className="grid grid-cols-[minmax(7rem,1fr)_3fr_auto] items-center gap-2 text-[11px]"><span className="truncate text-slate-600 dark:text-slate-300">{metric.label}</span><span className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><span className="block h-full rounded-full bg-blue-600" style={{ width: `${Math.max(metric.chartValue > 0 ? 2 : 0, (metric.chartValue / chartMaximum) * 100)}%` }} /></span><span className="tabular-nums font-semibold text-slate-700 dark:text-slate-200">{metric.value}</span></div>)}</div></figure>}</>}
      <div className="grid gap-3 border-t border-slate-100 p-4 sm:grid-cols-2 dark:border-slate-700">
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3.5 dark:border-indigo-900 dark:bg-indigo-950/50">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-indigo-800 dark:text-indigo-300">Predictive analytics · What may happen next</p>
          <p className="mt-1.5 text-sm font-semibold leading-5 text-indigo-950 dark:text-indigo-100">{prediction}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-amber-900 dark:text-amber-300"><Lightbulb size={13} aria-hidden="true" /> Prescriptive analytics · Suggested next step</p>
          <p className="mt-1.5 text-sm font-semibold leading-5 text-amber-950 dark:text-amber-100">{recommendation}</p>
        </div>
      </div>
    </section>
  );
}
