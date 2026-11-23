import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBookRecommendationPayload, requestBookRecommendations, uniqueRecommendationTitles } from './bookRecommendationApi.js';
import { getAIRecommendations } from './recommendationEngine.js';

test('recommendation request includes only the visitor history and catalog metadata', () => {
  const payload = makeBookRecommendationPayload(
    [{ id: 'a', title: 'Sea', availableCopies: 2 }, { id: 'b', title: 'Stars', availableCopies: 0 }],
    [{ visitorId: 'me', bookId: 'a', status: 'returned' }, { visitorId: 'someone', bookId: 'b', status: 'borrowed' }],
    'me', ['ocean'], []
  );
  assert.equal(payload.books[0].borrowed, true);
  assert.equal(payload.books[1].borrowed, false);
  assert.deepEqual(payload.searches, ['ocean']);
  assert.equal(JSON.stringify(payload).includes('someone'), false);
  assert.equal(JSON.stringify(payload).includes('me'), false);
});

test('combines matching titles across libraries while retaining different authors', () => {
  const books = [
    { id: 'a', title: ' The Sea ', author: 'A. Writer', libraryId: 'one' },
    { id: 'b', title: 'the   sea', author: 'a. writer', libraryId: 'two' },
    { id: 'c', title: 'The Sea', author: 'Different Writer', libraryId: 'three' },
    { id: 'd', title: 'Stars', author: 'A. Writer', libraryId: 'one' },
  ];
  assert.deepEqual(uniqueRecommendationTitles(books).map((book) => book.id), ['a', 'c', 'd']);
});

test('fallback fills the recommendation cards with distinct titles', () => {
  const books = [
    { id: 'a', title: 'Sea', author: 'Author', availableCopies: 2 },
    { id: 'b', title: 'Sea', author: 'Author', availableCopies: 2 },
    { id: 'c', title: 'Sea', author: 'Author', availableCopies: 2 },
    { id: 'd', title: 'Sea', author: 'Author', availableCopies: 2 },
    { id: 'e', title: 'Stars', author: 'Author', availableCopies: 1 },
    { id: 'f', title: 'Forest', author: 'Author', availableCopies: 1 },
    { id: 'g', title: 'River', author: 'Author', availableCopies: 1 },
  ];
  const result = getAIRecommendations([], books, 'visitor', [], [], books.length);
  assert.deepEqual(uniqueRecommendationTitles(result.recommendations).map((book) => book.title), ['Sea', 'Forest', 'River', 'Stars']);
});

test('service results collapse duplicate title and author after checking availability', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ source: 'ai', bookIds: ['a', 'b', 'c'] }) });
  try {
    const result = await requestBookRecommendations({ token: 'test-token', configuredUrl: 'http://localhost:8000', payload: { books: [
      { id: 'a', title: 'The Sea', author: 'Writer', available: true, active: false },
      { id: 'b', title: 'the sea', author: 'writer', available: true, active: false },
      { id: 'c', title: 'Stars', author: 'Writer', available: true, active: false },
    ], searches: [] } });
    assert.deepEqual(result.bookIds, ['a', 'c']);
  } finally { globalThis.fetch = originalFetch; }
});

test('recommendation service results cannot add unknown, unavailable, or active books', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return { ok: true, json: async () => ({ source: 'ai', bookIds: ['unknown', 'b', 'c', 'a', 'a'] }) };
  };
  try {
    const result = await requestBookRecommendations({ token: 'test-token', configuredUrl: 'http://localhost:8000', payload: { books: [
      { id: 'a', available: true, active: false }, { id: 'b', available: false, active: false }, { id: 'c', available: true, active: true },
    ], searches: [] } });
    assert.deepEqual(result, { source: 'ai', bookIds: ['a'] });
  } finally { globalThis.fetch = originalFetch; }
});
