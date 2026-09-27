import { useMemo } from 'react';
import { useAuth } from '../context/useAuth.js';
import { useLibraryData } from '../context/useLibrary.js';
import { getAIRecommendations } from '../lib/recommendationEngine.js';

export default function AIRecommendations({ onRequestBorrow }) {
  const { user } = useAuth();
  const { books, borrowRequests } = useLibraryData();

  const { recommendations, topCategories, isColdStart } = useMemo(() => {
    return getAIRecommendations(borrowRequests, books, user?.id);
  }, [borrowRequests, books, user?.id]);

  if (!recommendations || recommendations.length === 0) {
    return null;
  }

  return (
    <div className="bg-gradient-to-br from-slate-900 to-[#002046] rounded-2xl p-6 text-white shadow-md space-y-4">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg">🤖</span>
            <h3 className="text-base font-bold text-white">
              AI Recommended for You
            </h3>
          </div>
          <p className="text-xs text-slate-300 mt-1">
            {isColdStart
              ? 'Popular titles across libraries to get you started:'
              : 'Curated based on your borrowing patterns and preferred categories:'}
          </p>
        </div>

        {topCategories.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase font-bold text-slate-400">
              Interests:
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
            className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col justify-between hover:bg-white/10 transition"
          >
            <div className="space-y-2">
              <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded uppercase">
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
              <span className="text-[11px] text-slate-400">
                {book.availableCopies > 0 ? '🟢 Available' : '🔴 Reserved'}
              </span>

              {onRequestBorrow && (
                <button
                  type="button"
                  onClick={() => onRequestBorrow(book)}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition"
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