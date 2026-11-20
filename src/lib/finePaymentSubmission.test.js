import test from 'node:test';
import assert from 'node:assert/strict';
import { submitFinePayment } from './finePaymentSubmission.js';

const key = '78e4dfba-3dd5-4a98-8f09-6e8b77fc2e4f';

test('fine payment uses the exact six-argument idempotent RPC contract', async () => {
  const calls = [];
  const result = await submitFinePayment({
    rpc: async (...args) => { calls.push(args); return { data: { paymentId: 'p-1' }, error: null }; },
    requestId: '0dcdf3ed-a093-4376-b8b7-c6ba2f2ba83f',
    amount: '25.50',
    paymentMethod: 'cash',
    referenceNumber: null,
    note: 'partial',
    idempotencyKey: key,
  });
  assert.deepEqual(result, { paymentId: 'p-1' });
  assert.deepEqual(calls, [[
    'record_fine_payment_v2',
    {
      p_request_id: '0dcdf3ed-a093-4376-b8b7-c6ba2f2ba83f',
      p_amount: 25.5,
      p_payment_method: 'cash',
      p_reference_number: null,
      p_note: 'partial',
      p_idempotency_key: key,
    },
  ]]);
});

test('fine payment failure propagates without pretending payment succeeded', async () => {
  const failure = new Error('permission denied');
  await assert.rejects(submitFinePayment({
    rpc: async () => ({ data: null, error: failure }),
    requestId: '0dcdf3ed-a093-4376-b8b7-c6ba2f2ba83f',
    amount: 10,
    paymentMethod: 'cash',
    referenceNumber: null,
    note: null,
    idempotencyKey: key,
  }), /permission denied/);
});

test('fine payment refuses to send an invalid idempotency key', async () => {
  let called = false;
  await assert.rejects(submitFinePayment({
    rpc: async () => { called = true; return { data: null, error: null }; },
    requestId: '0dcdf3ed-a093-4376-b8b7-c6ba2f2ba83f',
    amount: 10,
    paymentMethod: 'cash',
    referenceNumber: null,
    note: null,
    idempotencyKey: 'not-a-uuid',
  }), /valid payment idempotency key/);
  assert.equal(called, false);
});
