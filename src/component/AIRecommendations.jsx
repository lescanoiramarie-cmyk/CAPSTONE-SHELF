import { useEffect, useMemo, useState } from 'react';
import { CircleAlert, CircleCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../context/useAuth.js';
import { useLibraryData } from '../context/useLibrary.js';
import { fetchPopularBorrowedBookCounts } from '../data/store.js';
import { formatBookCategory } from '../lib/bookCategory.js';
import { supabase } from '../lib/supabaseClient.js';
import { makeBookRecommendationPayload, recommendationTitleKey, requestBookRecommendations, uniqueRecommendationTitles } from '../lib/bookRecommendationApi.js';
import {
  getAIRecommendations,
  getVisitorSearchHistory,
  VISITOR_SEARCH_HISTORY_EVENT,
} from '../lib/recommendationEngine.js';

export default function AIRecommendations({ onRequestBorrow, onSelectBook }) {
  const { user } = useAuth();
  const { books, borrowRequests } = useLibraryData();
  const [searchHistory, setSearchHistory] = useState([]);
  const [popularBorrowCounts, setPopularBorrowCounts] = useState([]);
  const [aiResult, setAiResult] = useState(null);
  const [aiStatus, setAiStatus] = useState('loading');

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

  const fallback = useMemo(() => {
    return getAIRecommendations(
      borrowRequests,
      books,
      user?.id,
      searchHistory,
      popularBorrowCounts,
      books.length
    );
  }, [borrowRequests, books, user?.id, searchHistory, popularBorrowCounts]);

  const payload = useMemo(() => makeBookRecommendationPayload(books, borrowRequests, user?.id, searchHistory, popularBorrowCounts), [books, borrowRequests, user?.id, searchHistory, popularBorrowCounts]);
  const payloadKey = JSON.stringify(payload);
  useEffect(() => {
    if (!user?.id || !payloadKey) return undefined;
    const controller = new AbortController();
    let current = true;
    setAiResult(null);
    setAiStatus('loading');
    const timeout = setTimeout(() => {
      if (current) { setAiStatus('unavailable'); controller.abort(); }
    }, 20000);
    const load = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data?.session?.access_token) throw new Error('Visitor session unavailable.');
        const result = await requestBookRecommendations({ payload: JSON.parse(payloadKey), token: data.session.access_token, configuredUrl: import.meta.env.VITE_ANALYTICS_API_URL, signal: controller.signal });
        if (current) { setAiResult(result); setAiStatus('ready'); }
      } catch (error) {
        if (current && error?.name !== 'AbortError') setAiStatus('unavailable');
      } finally {
        clearTimeout(timeout);
      }
    };
    void load();
    return () => { current = false; clearTimeout(timeout); controller.abort(); };
  }, [payloadKey, user?.id]);

  const bookById = useMemo(() => new Map(books.map((book) => [String(book.id), book])), [books]);
  const recommendations = aiStatus === 'ready' ? aiResult.bookIds.map((id) => bookById.get(id)).filter(Boolean) : aiStatus === 'unavailable' ? uniqueRecommendationTitles(fallback.recommendations) : [];
  const branchCounts = useMemo(() => {
    const groups = new Map();
    books.forEach((book) => {
      const libraryId = book.libraryId ?? book.library_id;
      if (!libraryId || Number(book.totalCopies ?? book.total_copies ?? 0) <= 0) return;
      const key = recommendationTitleKey(book);
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(String(libraryId));
    });
    return groups;
  }, [books]);
  const selectRecommendation = (book) => {
    const selected = { ...book, recommendationGroupByTitle: true };
    if (onSelectBook) onSelectBook(selected);
    else if (onRequestBorrow) onRequestBorrow(selected);
  };
  const topCategories = aiStatus === 'ready' ? [...new Set(recommendations.map((book) => book.category).filter(Boolean))].slice(0, 2) : fallback.topCategories;
  const isColdStart = aiStatus === 'ready' ? aiResult.source === 'popular' : fallback.isColdStart;

  if (aiStatus === 'loading') return <p role="status" className="text-sm text-slate-500">Preparing book recommendations...</p>;
  if (!recommendations.length && aiStatus !== 'unavailable') {
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
            {aiStatus === 'unavailable'
              ? 'AI recommendations are temporarily unavailable. Showing local suggestions when available.'
              : isColdStart
              ? 'Popular books based on aggregated borrowing activity:'
              : 'AI-ranked from your borrowing history and recent OPAC searches:'}
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
                className="category-chip rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-slate-800 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
              >
                {formatBookCategory(cat)}
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
            onClick={() => {
              selectRecommendation(book);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectRecommendation(book);
              }
            }}
            className="flex min-w-0 flex-row items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 transition hover:border-shelf-primary hover:bg-white hover:shadow-sm cursor-pointer dark:border-slate-700 dark:bg-slate-900/60 dark:hover:bg-slate-800"
          >
            <div className="min-w-0 flex-1">
              <span className="category-chip rounded-full bg-slate-100 px-2 py-0.5 text-slate-800 dark:bg-slate-700 dark:text-slate-100">
                {formatBookCategory(book.category) || 'General'}
              </span>
              <h4 title={book.title} className="mt-1 line-clamp-2 text-sm font-bold text-slate-900 dark:text-white hover:text-shelf-primary">
                {book.title}
              </h4>
              <p title={book.author || 'Unknown Author'} className="truncate text-xs text-slate-700 dark:text-slate-200">
                by {book.author || 'Unknown Author'}
              </p>
              {(branchCounts.get(recommendationTitleKey(book))?.size ?? 0) > 1 && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Listed at multiple libraries — view locations</p>}
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${book.availableCopies > 0 ? 'text-green-800 dark:text-green-300' : 'text-slate-700 dark:text-slate-200'}`}>
                {book.availableCopies > 0 ? <CircleCheck size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
                {book.availableCopies > 0 ? 'Available' : 'Reserved'}
              </span>

              {onRequestBorrow && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    selectRecommendation(book);
                  }}
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
