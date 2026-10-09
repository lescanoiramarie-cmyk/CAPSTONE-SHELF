import { useEffect, useMemo, useState } from 'react';
import { CircleAlert, CircleCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../context/useAuth.js';
import { useLibraryData } from '../context/useLibrary.js';
import {
  getAIRecommendations,
  getVisitorSearchHistory,
  VISITOR_SEARCH_HISTORY_EVENT,
} from '../lib/recommendationEngine.js';

export default function AIRecommendations({ onRequestBorrow }) {
  const { user } = useAuth();
  const { books, borrowRequests } = useLibraryData();
  const [searchHistory, setSearchHistory] = useState([]);

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
      searchHistory
    );
  }, [borrowRequests, books, user?.id, searchHistory]);

  if (!recommendations || recommendations.length === 0) {
    return null;
  }

  return (
    <div className="bg-gradient-to-br from-slate-900 to-[#002046] rounded-2xl p-6 text-white shadow-md space-y-4">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-amber-400/15 p-2 text-amber-300">
              <Sparkles size={18} aria-hidden="true" />
            </span>
            <h3 className="text-base font-bold text-white">
              {isColdStart ? 'Popular for SHELF Visitors' : 'Recommended for You'}
            </h3>
          </div>
          <p className="text-xs text-slate-300 mt-1">
            {isColdStart
              ? 'Popular across SHELF activity, based on aggregated borrowing and available search trends:'
              : 'Personalized from your own borrowing history and recent OPAC searches:'}
          </p>
        </div>

        {topCategories.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase font-bold text-slate-400">
              {isColdStart ? 'Popular categories:' : 'Your interests:'}
            </span>
            {topCategories.map((cat) => (
              <span
                key={cat}
                className="bg-blue-500/20 text-blue-300 border border-blue-400/30 text-[11px] font-bold px-2.5 py-0.5 rounded-full"
              >
                {cat}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* RECOMMENDATIONS CARDS GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
        {recommendations.map((book) => (
          <div
            key={book.id}
            className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col justify-between transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/10 hover:shadow-md"
          >
            <div className="space-y-2">
              <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded">
                {book.category || 'General'}
              </span>

              <h4 className="text-sm font-bold text-white line-clamp-2">
                {book.title}
              </h4>

              <p className="text-xs text-slate-300">
                by {book.author || 'Unknown Author'}
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between gap-2">
              <span className={`inline-flex items-center gap-1.5 text-[11px] ${book.availableCopies > 0 ? 'text-emerald-300' : 'text-slate-400'}`}>
                {book.availableCopies > 0 ? <CircleCheck size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
                {book.availableCopies > 0 ? 'Available' : 'Reserved'}
              </span>

              {onRequestBorrow && (
                <button
                  type="button"
                  onClick={() => onRequestBorrow(book)}
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold px-3 py-1.5 rounded-lg transition"
                >
                  Borrow
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
