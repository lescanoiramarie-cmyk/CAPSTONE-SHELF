import { getAnalyticsApiUrl } from './analyticsApi.js';

export function makeBookRecommendationPayload(books, requests, visitorId, searches, popularCounts) {
  const ownRequests = requests.filter((item) => String(item.visitorId ?? item.visitor_id ?? '') === String(visitorId));
  const active = new Set(ownRequests.filter((item) => ['queued', 'scheduled', 'ready_for_pickup', 'borrowed'].includes(String(item.status || '').toLowerCase())).map((item) => String(item.bookId ?? item.book_id ?? '')));
  const borrowed = new Set(ownRequests.filter((item) => ['borrowed', 'returned'].includes(String(item.status || '').toLowerCase())).map((item) => String(item.bookId ?? item.book_id ?? '')));
  const popularity = new Map(popularCounts.map((item) => [String(item.bookId ?? item.book_id ?? ''), Math.max(0, Math.min(10000000, Math.floor(Number(item.borrowCount ?? item.borrow_count) || 0)))]));
  const seen = new Set();
  const catalog = books.filter((book) => book?.id && String(book.title || '').trim() && !seen.has(String(book.id)) && seen.add(String(book.id)))
    .sort((a, b) => Number(borrowed.has(String(b.id))) - Number(borrowed.has(String(a.id))))
    .slice(0, 5000)
    .map((book) => ({
      id: String(book.id).slice(0, 100), title: String(book.title).trim().slice(0, 300),
      author: String(book.author || '').slice(0, 200), category: String(book.category || '').slice(0, 120),
      available: Number(book.availableCopies ?? book.available_copies ?? book.totalCopies ?? book.total_copies ?? 0) > 0,
      active: active.has(String(book.id)), borrowed: borrowed.has(String(book.id)), popularity: popularity.get(String(book.id)) || 0,
    }));
  return { books: catalog, searches: searches.filter((item) => typeof item === 'string').slice(0, 20).map((item) => item.slice(0, 120)) };
}

export async function requestBookRecommendations({ payload, token, configuredUrl, signal }) {
  const response = await fetch(`${getAnalyticsApiUrl(configuredUrl)}/recommendations/books`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload), signal,
  });
  if (!response.ok) throw new Error('AI recommendations are temporarily unavailable.');
  const result = await response.json();
  if (!Array.isArray(result?.bookIds) || !['ai', 'popular'].includes(result.source)) throw new Error('Invalid recommendation response.');
  const eligible = new Set(payload.books.filter((book) => book.available && !book.active).map((book) => book.id));
  return { source: result.source, bookIds: [...new Set(result.bookIds.filter((id) => typeof id === 'string' && eligible.has(id)))].slice(0, 4) };
}
