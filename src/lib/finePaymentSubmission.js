const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function submitFinePayment({
  rpc,
  requestId,
  amount,
  paymentMethod,
  referenceNumber,
  note,
  idempotencyKey,
}) {
  if (typeof rpc !== 'function') throw new TypeError('A database RPC function is required.');
  if (!UUID_PATTERN.test(String(idempotencyKey || ''))) {
    throw new TypeError('A valid payment idempotency key is required.');
  }
  const { data, error } = await rpc('record_fine_payment_v2', {
    p_request_id: String(requestId),
    p_amount: Number(amount),
    p_payment_method: paymentMethod,
    p_reference_number: referenceNumber,
    p_note: note,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  return data;
}
