export default function ProgressiveListFooter({
  noun,
  totalCount,
  visibleCount,
  hasMore,
  loadMore,
  sentinelRef,
  className = '',
}) {
  if (totalCount === 0) return null;

  return (
    <div
      ref={sentinelRef}
      className={`progressive-list-footer flex flex-col items-center justify-center gap-2 py-4 text-center ${className}`}
    >
      <p className="text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
        Showing {visibleCount} of {totalCount} {noun}
      </p>
      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          Load more
        </button>
      )}
    </div>
  );
}
