import ShelfLoader from './ShelfLoader.jsx';

export default function DashboardDataBoundary({
  loading,
  error,
  onRetry,
}) {
  if (loading) {
    return <ShelfLoader screen label="Loading dashboard data..." />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <section
        role="alert"
        className="w-full max-w-lg space-y-4 rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm"
      >
        <h1 className="text-xl font-bold text-slate-900">
          Dashboard data is unavailable
        </h1>
        <p className="text-sm text-slate-600">
          {error || 'Required library data could not be loaded.'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          Retry
        </button>
      </section>
    </main>
  );
}
