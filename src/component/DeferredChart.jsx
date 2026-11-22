import { lazy, Suspense } from 'react';

const ChartRenderer = lazy(() => import('./ChartRenderer.jsx'));

export default function DeferredChart({ type = 'bar', ...props }) {
  return (
    <Suspense
      fallback={(
        <div role="status" className="grid h-full min-h-24 place-items-center text-xs text-slate-500">
          Loading chart…
        </div>
      )}
    >
      <ChartRenderer type={type} {...props} />
    </Suspense>
  );
}
