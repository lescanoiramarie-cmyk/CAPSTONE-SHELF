import { useEffect, useMemo, useState } from 'react';
import { CircleAlert, CircleCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../context/useAuth.js';
import { useLibraryData } from '../context/useLibrary.js';
import { fetchPopularBorrowedBookCounts } from '../data/store.js';
import {
  getAIRecommendations,
  getVisitorSearchHistory,
  VISITOR_SEARCH_HISTORY_EVENT,
} from '../lib/recommendationEngine.js';

export default function AIRecommendations({ onRequestBorrow }) {
  const { user } = useAuth();
  const { books, borrowRequests } = useLibraryData();
  const [searchHistory, setSearchHistory] = useState([]);
  const [popularBorrowCounts, setPopularBorrowCounts] = useState([]);

  useEffect(() => {
    let active = true;
    fetchPopularBorrowedBookCounts()
      .then((counts) => {
        if (active) setPopularBorrowCounts(counts);
      })
      .catch((error) => {
        console.warn('Book popularity is unavailable:', error.message);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const refreshSearchHistory = (event) => {
      if (!event?.detail?.visitorId || event.detail.visitorId === String(user?.id || '')) {
        setSearchHistory(getVisitorSearchHistory(user?.id));
      }
    };

    refreshSearchHistory();
    globalThis.addEventListener?.(VISITOR_SEARCH_HISTORY_EVENT, refreshSearchHistory);
    return () =>
      globalThis.removeEventListener?.(
        VISITOR_SEARCH_HISTORY_EVENT,
        refreshSearchHistory
      );
  }, [user?.id]);

  const { recommendations, topCategories, isColdStart } = useMemo(() => {
    return getAIRecommendations(
      borrowRequests,
      books,
      user?.id,
      searchHistory,
      popularBorrowCounts
    );
  }, [borrowRequests, books, user?.id, searchHistory, popularBorrowCounts]);

  if (!recommendations || recommendations.length === 0) {
    return null;
  }

  return (
    <section className="visitor-popular-panel space-y-3 rounded-2xl border border-slate-200 bg-white p-4 text-slate-800 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 sm:p-5">
      {/* HEADER */}
      <div className="flex flex-col justify-between gap-2 border-b border-slate-200 pb-3 dark:border-slate-700 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-slate-100 p-2 text-shelf-primary dark:bg-slate-700 dark:text-slate-100">
              <Sparkles size={17} aria-hidden="true" />
            </span>
            <h3 className="text-base font-bold text-shelf-primary dark:text-white">
              {isColdStart ? 'Popular for SHELF Visitors' : 'Recommended for You'}
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">
            {isColdStart
              ? 'Popular across SHELF activity, based on aggregated borrowing and available search trends:'
              : 'Personalized from your own borrowing history and recent OPAC searches:'}
          </p>
        </div>

        {topCategories.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold uppercase text-slate-700 dark:text-slate-200">
              {isColdStart ? 'Popular categories:' : 'Your interests:'}
            </span>
            {topCategories.map((cat) => (
              <span
                key={cat}
                className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
              >
                {cat}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* RECOMMENDATIONS CARDS GRID */}
      <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2 xl:grid-cols-4">
        {recommendations.map((book) => (
          <div
            key={book.id}
            className="flex min-w-0 flex-row items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 transition hover:border-shelf-primary hover:bg-white hover:shadow-sm dark:border-slate-700 dark:bg-slate-900/60 dark:hover:bg-slate-800"
          >
            <div className="min-w-0 flex-1">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-800 dark:bg-slate-700 dark:text-slate-100">
                {book.category || 'General'}
              </span>
              <h4 title={book.title} className="mt-1 truncate text-sm font-bold text-slate-900 dark:text-white">
                {book.title}
              </h4>
              <p title={book.author || 'Unknown Author'} className="truncate text-xs text-slate-700 dark:text-slate-200">
                by {book.author || 'Unknown Author'}
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${book.availableCopies > 0 ? 'text-green-800 dark:text-green-300' : 'text-slate-700 dark:text-slate-200'}`}>
                {book.availableCopies > 0 ? <CircleCheck size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
                {book.availableCopies > 0 ? 'Available' : 'Reserved'}
              </span>

              {onRequestBorrow && (
                <button
                  type="button"
                  onClick={() => onRequestBorrow(book)}
                  className="rounded-lg bg-shelf-primary px-3 py-1.5 text-xs font-bold text-white transition hover:opacity-90"
                >
                  Borrow
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
