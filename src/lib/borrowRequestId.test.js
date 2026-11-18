import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidBorrowRequestId } from './borrowRequestId.js';

test('accepts UUID and the persisted REQ- plus eight hex character IDs', () => {
  assert.equal(isValidBorrowRequestId('3b241101-e2bb-4255-8caf-4136c566a962'), true);
  assert.equal(isValidBorrowRequestId('REQ-1a2b3c4d'), true);
  assert.equal(isValidBorrowRequestId('req-1A2B3C4D'), true);
});

test('rejects malformed, blank, or overlong request identifiers', () => {
  assert.equal(isValidBorrowRequestId(''), false);
  assert.equal(isValidBorrowRequestId('REQ-123'), false);
  assert.equal(isValidBorrowRequestId('REQ-123456789'), false);
  assert.equal(isValidBorrowRequestId('request-12345678'), false);
  assert.equal(isValidBorrowRequestId(null), false);
});