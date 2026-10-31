export const BOOK_FINE_RATE_CATEGORIES = [
  { category: 'General', rate: 10 },
  { category: 'Reference', rate: 10 },
  { category: 'Self-Help', rate: 10 },
  { category: 'Philosophy', rate: 10 },
  { category: 'Psychology', rate: 10 },
  { category: 'Science', rate: 10 },
  { category: 'Fiction', rate: 15 },
  { category: 'Filipino Literature', rate: 15 },
  { category: 'Literature', rate: 15 },
  { category: 'Poetry', rate: 15 },
  { category: 'Young Adult', rate: 15 },
  { category: 'Business', rate: 20 },
  { category: 'Computer Science', rate: 20 },
  { category: 'Education', rate: 20 },
  { category: 'Engineering', rate: 20 },
  { category: 'History', rate: 20 },
  { category: 'Information Technology', rate: 20 },
  { category: 'Mathematics', rate: 20 },
  { category: 'Nursing & Health', rate: 20 },
  { category: 'Physics', rate: 20 },
  { category: 'Software Engineering', rate: 20 },
];

const VALID_FINE_RATES = new Set(
  BOOK_FINE_RATE_CATEGORIES.map(({ rate }) => rate)
);
const FINE_RATE_BY_CATEGORY = new Map(
  BOOK_FINE_RATE_CATEGORIES.map(({ category, rate }) => [
    category.toLowerCase(),
    rate,
  ])
);

export function getBookFineRate(category) {
  if (category == null) return null;

  const key = String(category).trim().toLowerCase();
  return key ? FINE_RATE_BY_CATEGORY.get(key) ?? null : null;
}

function storedRateMismatch(storedRate, derivedRate) {
  const raw = typeof storedRate === 'string' ? storedRate.trim() : storedRate;
  if (raw == null || raw === '') return derivedRate !== null;

  const rate = typeof raw === 'number' ? raw : Number(raw);
  return !VALID_FINE_RATES.has(rate) || rate !== derivedRate;
}

function normalizeImportKey(key) {
  return String(key)
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function normalizeBookFineRate(value) {
  const raw = typeof value === 'string' ? value.trim() : value;
  const rate = typeof raw === 'number' ? raw : Number(raw);

  if (
    (typeof raw !== 'number' && (typeof raw !== 'string' || !/^\d+(?:\.\d+)?$/.test(raw))) ||
    !VALID_FINE_RATES.has(rate)
  ) {
    throw new Error('Choose a fine rate of 10, 15, or 20 PHP per overdue day.');
  }

  return rate;
}

export function bookFineRateMismatch(existingRate, category) {
  return storedRateMismatch(existingRate, getBookFineRate(category));
}

export function buildDuplicateBookImportUpdate(existing, incoming) {
  return {
    update: {
      total_copies:
        Number(existing.total_copies || 0) +
        Number(incoming.total_copies || 0),
      available_copies:
        Number(existing.available_copies || 0) +
        Number(incoming.available_copies || 0),
    },
    fineRateMismatch:
      bookFineRateMismatch(existing.fine_rate, existing.category) ||
      bookFineRateMismatch(existing.fine_rate, incoming.category),
  };
}

export function calculateOverdueFine(dueDate, returnedAt, fineRateSnapshot) {
  if (dueDate == null || returnedAt == null) return null;

  let rate;
  try {
    rate = normalizeBookFineRate(fineRateSnapshot);
  } catch {
    return null;
  }

  const dueTime = new Date(dueDate).getTime();
  const returnTime = new Date(returnedAt).getTime();
  if (!Number.isFinite(dueTime) || !Number.isFinite(returnTime)) return null;
  if (returnTime <= dueTime) return 0;

  const overdueDays = Math.ceil((returnTime - dueTime) / 86400000);
  return overdueDays * rate;
}

export function resolveFineAtReturn({
  existingFineAmount,
  dueDate,
  returnedAt,
  fineRateSnapshot,
}) {
  const existingFine = Number(existingFineAmount) || 0;
  if (existingFine !== 0) {
    return { fineAmount: existingFine, fineReviewRequired: true };
  }

  const calculatedFine = calculateOverdueFine(
    dueDate,
    returnedAt,
    fineRateSnapshot
  );
  if (calculatedFine == null) {
    return { fineAmount: existingFine, fineReviewRequired: true };
  }

  return { fineAmount: calculatedFine, fineReviewRequired: false };
}

export function validateImportedBookFineRates(records) {
  if (!Array.isArray(records)) {
    throw new Error('The import file must contain an array of book records.');
  }

  const errors = [];
  const validatedRecords = records.map((record, index) => {
    const rowNumber = index + 1;
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      errors.push(`Row ${rowNumber} is not a book record.`);
      return record;
    }

    const categoryFields = Object.entries(record).filter(
      ([key]) => normalizeImportKey(key) === 'category'
    );
    const categoryValues = categoryFields
      .map(([, value]) => String(value ?? '').trim())
      .filter(Boolean);
    if (
      new Set(categoryValues.map((value) => value.toLowerCase())).size > 1
    ) {
      errors.push(`Row ${rowNumber} has conflicting category values.`);
      return record;
    }

    const category = categoryValues[0] || null;

    const nonClassificationFields = Object.fromEntries(
      Object.entries(record).filter(
        ([key]) =>
          !['category', 'fine_rate'].includes(normalizeImportKey(key))
      )
    );
    return {
      ...nonClassificationFields,
      category,
      fine_rate: getBookFineRate(category),
    };
  });

  if (errors.length > 0) {
    const displayedErrors = errors.slice(0, 10);
    const remainingCount = errors.length - displayedErrors.length;
    const remainingMessage = remainingCount
      ? `; and ${remainingCount} more issue${remainingCount === 1 ? '' : 's'}`
      : '';
    throw new Error(`${displayedErrors.join('; ')}${remainingMessage}`);
  }

  return validatedRecords;
}
