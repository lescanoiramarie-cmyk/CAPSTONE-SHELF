const MAX_CALL_NUMBER_LENGTH = 100;

export function normalizeCallNumber(value) {
  if (value == null) return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('Call Number must be text or a finite number.');
  }

  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Call Number must be text or a finite number.');
  }

  // Spreadsheet parsers may return numeric-only call numbers as numbers.
  // Text values remain text so meaningful leading zeroes are preserved.
  const normalized = String(value).trim();
  if (normalized === '') return null;
  if (normalized.length > MAX_CALL_NUMBER_LENGTH) {
    throw new Error(`Call Number must be ${MAX_CALL_NUMBER_LENGTH} characters or fewer.`);
  }
  return normalized;
}

export function matchesCallNumberSearch(book, searchTerm) {
  const term = String(searchTerm ?? '').trim().toLocaleLowerCase();
  if (!term) return true;
  return String(book?.callNumber ?? book?.call_number ?? '')
    .toLocaleLowerCase()
    .includes(term);
}

export { MAX_CALL_NUMBER_LENGTH };