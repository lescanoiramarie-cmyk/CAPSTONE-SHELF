import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCancelBorrowRequestArgs } from './borrowRequestRpc.js';

test('cancellation RPC uses the SQL contract argument names', () => {
  assert.deepEqual(
    buildCancelBorrowRequestArgs(' request-1 ', ' visitor-1 '),
    { p_request_id: 'request-1', p_visitor_id: 'visitor-1' },
  );
});

test('cancellation RPC args fail closed without request or visitor identity', () => {
  assert.throws(() => buildCancelBorrowRequestArgs('request-1', ''), /identity are required/);
  assert.throws(() => buildCancelBorrowRequestArgs('', 'visitor-1'), /identity are required/);
});
