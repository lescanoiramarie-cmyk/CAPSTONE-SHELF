export function buildCancelBorrowRequestArgs(requestId, visitorId) {
  const normalizedRequestId = String(requestId ?? '').trim();
  const normalizedVisitorId = String(visitorId ?? '').trim();

  if (!normalizedRequestId || !normalizedVisitorId) {
    throw new Error('Request and visitor identity are required.');
  }

  return {
    p_request_id: normalizedRequestId,
    p_visitor_id: normalizedVisitorId,
  };
}
