import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBookRecommendationPayload, requestBookRecommendations } from './bookRecommendationApi.js';

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
