import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';

export default function BookRatingsChart({ books = [], fillHeight = false }) {
  const [summaries, setSummaries] = useState([]);
  const [error, setError] = useState('');
  const [loadedBookIdKey, setLoadedBookIdKey] = useState('');
  const bookIds = useMemo(
    () => books.map((book) => String(book.id)).filter(Boolean),
    [books]
  );
  const bookIdKey = bookIds.join('|');

  useEffect(() => {
    let cancelled = false;
    if (!bookIds.length) {
      return () => { cancelled = true; };
    }

    const bookIdBatches = [];
    for (let index = 0; index < bookIds.length; index += 100) {
      bookIdBatches.push(bookIds.slice(index, index + 100));
    }

    async function loadSummaries() {
      if (!supabase) {
        throw new Error('Supabase is not configured.');
      }
      return Promise.all(bookIdBatches.map((batch) =>
        supabase.rpc('get_book_rating_summaries', { p_book_ids: batch })
      ));
    }

    loadSummaries().then((results) => {
        if (cancelled) return;
        const failedResult = results.find((result) => result.error);
        if (failedResult) {
          console.error('Book rating summary RPC failed:', failedResult.error);
          setError('Unable to load book ratings.');
          setSummaries([]);
        } else {
          setError('');
          setSummaries(results.flatMap((result) => result.data || []));
        }
        setLoadedBookIdKey(bookIdKey);
      }).catch((queryError) => {
        if (cancelled) return;
        console.error('Book rating summary request failed:', queryError);
        setError('Unable to load book ratings.');
        setSummaries([]);
        setLoadedBookIdKey(bookIdKey);
      });

    return () => { cancelled = true; };
  // bookIdKey changes only when the scoped set of books changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookIdKey]);

  const loading = bookIds.length > 0 && loadedBookIdKey !== bookIdKey;
  const visibleError = loadedBookIdKey === bookIdKey ? error : '';

  const rows = useMemo(() => {
    const byBook = new Map(summaries.map((summary) => [
      String(summary.book_id),
      { average: Number(summary.average_rating), count: Number(summary.rating_count) },
    ]));
    return books
      .map((book) => {
        const summary = byBook.get(String(book.id));
        return summary && summary.count > 0 ? {
          id: book.id,
          title: book.title || 'Untitled book',
          average: Math.round(summary.average),
          count: summary.count,
        } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.average - a.average || b.count - a.count || a.title.localeCompare(b.title))
      .slice(0, 5);
  }, [books, summaries]);

  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${fillHeight ? 'flex h-full flex-col' : ''}`}>
      <h3 className="text-sm font-bold text-slate-800">Visitor Ratings by Book</h3>
      <p className="mt-1 text-xs text-slate-500">Rounded average star rating and number of visitor ratings for each book.</p>
      {loading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading ratings…</p>
      ) : visibleError ? (
        <p role="alert" className="py-8 text-center text-sm text-rose-600">{visibleError}</p>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">No visitor ratings for these books yet.</p>
      ) : (
        <div className={fillHeight ? 'mt-4 flex flex-1 flex-col justify-between gap-3 pr-1' : 'mt-4 max-h-80 space-y-3 overflow-y-auto pr-1'}>
          {rows.map((row, index) => (
            <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-700" title={row.title}>
                  <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-800">{index + 1}</span>
                  {row.title}
                </p>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-amber-400" style={{ width: `${(row.average / 5) * 100}%` }} />
                </div>
              </div>
              <p className="whitespace-nowrap text-xs font-bold text-slate-700">★ {row.average} <span className="font-normal text-slate-500">({row.count})</span></p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
