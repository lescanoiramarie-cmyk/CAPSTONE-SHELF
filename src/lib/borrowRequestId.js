const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LEGACY_REQUEST_PATTERN = /^REQ-[0-9a-f]{8}$/i;

export function isValidBorrowRequestId(value) {
  const requestId = String(value ?? '').trim();
  return UUID_PATTERN.test(requestId) || LEGACY_REQUEST_PATTERN.test(requestId);
}