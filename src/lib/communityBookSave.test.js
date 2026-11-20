import test from 'node:test';
import assert from 'node:assert/strict';
import { persistCommunityBookSaveState } from './communityBookSave.js';

test('saved-list changes succeed only after the matching RPC succeeds', async () => {
  const calls = [];
  const save = async (id) => { calls.push(['save', id]); return { success: true }; };
  const unsave = async (id) => { calls.push(['unsave', id]); return { success: true }; };

  assert.equal(await persistCommunityBookSaveState({ bookId: 'book-1', shouldBeSaved: true, save, unsave }), true);
  assert.equal(await persistCommunityBookSaveState({ bookId: 'book-1', shouldBeSaved: false, save, unsave }), false);
  assert.deepEqual(calls, [['save', 'book-1'], ['unsave', 'book-1']]);
});

test('a rejected save or unsave RPC propagates and cannot report success', async () => {
  const failure = new Error('database unavailable');
  for (const shouldBeSaved of [true, false]) {
    await assert.rejects(
      persistCommunityBookSaveState({
        bookId: 'book-2',
        shouldBeSaved,
        save: async () => { throw failure; },
        unsave: async () => { throw failure; },
      }),
      /database unavailable/
    );
  }
});

test('RPC error results restore failure behavior for save and unsave', async () => {
  for (const shouldBeSaved of [true, false]) {
    await assert.rejects(
      persistCommunityBookSaveState({
        bookId: 'book-3',
        shouldBeSaved,
        save: async () => ({ success: false, message: 'save denied' }),
        unsave: async () => ({ success: false, message: 'unsave denied' }),
      }),
      shouldBeSaved ? /save denied/ : /unsave denied/
    );
  }
});
