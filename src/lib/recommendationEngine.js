import {
  getBookCategoryKey,
  normalizeBookCategory,
} from './bookCategory.js';

const SEARCH_HISTORY_LIMIT = 20;
const SEARCH_QUERY_MAX_LENGTH = 120;
const SEARCH_HISTORY_EVENT = 'shelf:visitor-search-history';

function searchHistoryKey(visitorId) {
  return `shelf_opac_search_history_v1_${encodeURIComponent(String(visitorId))}`;
}

export function getVisitorSearchHistory(visitorId) {
  if (!visitorId) return [];

  try {
    const storage = globalThis.localStorage;
    if (!storage) return [];
    const parsed = JSON.parse(
      storage.getItem(searchHistoryKey(visitorId)) || '[]'
    );
    return Array.isArray(parsed)
      ? parsed
          .filter((query) => typeof query === 'string')
          .map((query) => query.trim().slice(0, SEARCH_QUERY_MAX_LENGTH))
          .filter(Boolean)
          .slice(0, SEARCH_HISTORY_LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function recordVisitorSearch(visitorId, query) {
  const normalizedQuery = String(query || '')
    .trim()
    .slice(0, SEARCH_QUERY_MAX_LENGTH);
  if (!visitorId || !normalizedQuery) return [];

  try {
    const storage = globalThis.localStorage;
    if (!storage) return [];
    const history = [
      normalizedQuery,
      ...getVisitorSearchHistory(visitorId).filter(
        (item) => item.toLowerCase() !== normalizedQuery.toLowerCase()
      ),
    ].slice(0, SEARCH_HISTORY_LIMIT);
    storage.setItem(
      searchHistoryKey(visitorId),
      JSON.stringify(history)
    );
    if (typeof globalThis.CustomEvent === 'function') {
      globalThis.dispatchEvent?.(
        new globalThis.CustomEvent(SEARCH_HISTORY_EVENT, {
          detail: { visitorId: String(visitorId) },
        })
      );
    }
    return history;
  } catch {
    return [];
  }
}

export const VISITOR_SEARCH_HISTORY_EVENT = SEARCH_HISTORY_EVENT;

/**
 * Generates book recommendations from borrowing and local OPAC search history.
 * 
 * @param {Array} borrowRequests - All borrow requests from state/context.
 * @param {Array} allBooks - Complete books catalog.
 * @param {string} visitorId - Current visitor's ID.
 * @param {Array<string>} searchHistory - Recent searches stored for this visitor.
 * @returns {Object} - Object containing top recommended books and identified top categories.
 */
export function getAIRecommendations(
  borrowRequests,
  allBooks,
  visitorId,
  searchHistory = []
) {
  if (
    !visitorId ||
    !Array.isArray(borrowRequests) ||
    !Array.isArray(allBooks)
  ) {
    return { recommendations: [], topCategories: [] };
  }

  const visitorRequests = borrowRequests.filter(
    (request) =>
      String(request.visitorId ?? request.visitor_id ?? '') ===
      String(visitorId)
  );
  const activeStatuses = new Set([
    'queued',
    'ready_for_pickup',
    'borrowed',
  ]);
  const completedStatuses = new Set([
    'borrowed',
    'returned',
  ]);
  const activeBookIds = new Set(
    visitorRequests
      .filter((request) =>
        activeStatuses.has(String(request.status ?? '').toLowerCase())
      )
      .map((request) => String(request.bookId ?? request.book_id ?? ''))
      .filter(Boolean)
  );
  const completedBookIds = new Set(
    visitorRequests
      .filter((request) =>
        completedStatuses.has(String(request.status ?? '').toLowerCase())
      )
      .map((request) => String(request.bookId ?? request.book_id ?? ''))
      .filter(Boolean)
  );

  const recentSearches = Array.isArray(searchHistory)
    ? searchHistory
        .filter((query) => typeof query === 'string' && query.trim())
        .map((query) => query.trim().toLocaleLowerCase())
    : [];

  const availableBooks = allBooks.filter((book) => {
    const availableValue =
      book.availableCopies ?? book.available_copies;
    const totalValue =
      book.totalCopies ?? book.total_copies;
    const availableCopies =
      availableValue == null
        ? Number(totalValue ?? 1)
        : Number(availableValue);

    return Number.isFinite(availableCopies) && availableCopies > 0;
  });

  const visitorHasBorrowingInterests = completedBookIds.size > 0;
  const isColdStart =
    !visitorHasBorrowingInterests && recentSearches.length === 0;

  const fallbackBooks = availableBooks
    .filter((book) => !activeBookIds.has(String(book.id)))
    .sort((left, right) => {
      const availabilityDifference =
        Number(right.availableCopies ?? right.available_copies ?? 0) -
        Number(left.availableCopies ?? left.available_copies ?? 0);
      return (
        availabilityDifference ||
        String(left.title ?? '').localeCompare(String(right.title ?? ''))
      );
    });

  if (isColdStart) {
    const coldStartCategories = new Map();
    fallbackBooks.slice(0, 4).forEach((book) => {
      const category = normalizeBookCategory(book.category);
      const key = getBookCategoryKey(category);
      if (key) {
        coldStartCategories.set(key, category);
      }
    });

    return {
      recommendations: fallbackBooks.slice(0, 4),
      topCategories: [...coldStartCategories.values()].slice(0, 2),
      isColdStart: true,
    };
  }

  const borrowedBooks = allBooks.filter((book) =>
    completedBookIds.has(String(book.id))
  );
  const categoryScores = new Map();
  const authorScores = new Map();
  const searchScores = new Map();

  const addScore = (scores, key, value) => {
    if (key) scores.set(key, (scores.get(key) ?? 0) + value);
  };

  borrowedBooks.forEach((book) => {
    addScore(categoryScores, getBookCategoryKey(book.category), 1);
    addScore(
      authorScores,
      String(book.author ?? '').trim().toLocaleLowerCase(),
      1
    );
  });

  const ignoredSearchTerms = new Set([
    'a', 'an', 'and', 'are', 'for', 'from', 'how', 'in', 'is', 'of',
    'on', 'or', 'the', 'to', 'with',
  ]);

  recentSearches.forEach((query, index) => {
    const weight = Math.max(1, 3 - Math.floor(index / 5));
    const terms = [
      ...new Set(
        query
          .split(/[^\p{L}\p{N}]+/u)
          .filter(
            (term) =>
              term.length > 1 &&
              !ignoredSearchTerms.has(term)
          )
      ),
    ];
    if (!terms.length) return;

    const matchedCategories = new Set();
    const matchedAuthors = new Set();

    allBooks.forEach((book) => {
      const title = String(book.title || '').toLowerCase();
      const author = String(book.author || '').toLowerCase();
      const category = String(book.category || '').toLowerCase();
      const matchingTerms = terms.filter(
        (term) =>
          title.includes(term) ||
          author.includes(term) ||
          category.includes(term)
      );

      const fieldMatchScore = matchingTerms.reduce(
        (score, term) =>
          score +
          (title.includes(term) ? 3 : 0) +
          (author.includes(term) ? 2 : 0) +
          (category.includes(term) ? 2 : 0),
        0
      );
      const exactTitleBoost =
        title.includes(query) ? 5 : 0;

      if (fieldMatchScore + exactTitleBoost > 0) {
        addScore(
          searchScores,
          String(book.id),
          (fieldMatchScore + exactTitleBoost) * weight
        );
      }
      if (
        book.category &&
        matchingTerms.some((term) => category.includes(term))
      ) {
        matchedCategories.add(getBookCategoryKey(book.category));
      }
      if (
        book.author &&
        matchingTerms.some((term) => author.includes(term))
      ) {
        matchedAuthors.add(author.trim());
      }
    });

    matchedCategories.forEach((category) =>
      addScore(categoryScores, category, weight)
    );
    matchedAuthors.forEach((author) =>
      addScore(authorScores, author, weight)
    );
  });

  const categoryLabels = new Map();
  borrowedBooks.forEach((book) => {
    const key = getBookCategoryKey(book.category);
    if (key && !categoryLabels.has(key)) {
      categoryLabels.set(key, book.category);
    }
  });
  allBooks.forEach((book) => {
    const key = getBookCategoryKey(book.category);
    if (key && !categoryLabels.has(key)) {
      categoryLabels.set(key, book.category);
    }
  });

  const sortedCategories = [...categoryScores.entries()]
    .sort(([leftKey, leftScore], [rightKey, rightScore]) =>
      rightScore - leftScore || leftKey.localeCompare(rightKey)
    )
    .map(([key]) => categoryLabels.get(key) || key);

  const candidateBooks = availableBooks.filter(
    (book) => !activeBookIds.has(String(book.id))
  );

  const scoredRecommendations = candidateBooks.map((book) => {
    const categoryKey = getBookCategoryKey(book.category);
    const authorKey = String(book.author ?? '').trim().toLocaleLowerCase();
    const score =
      (categoryScores.get(categoryKey) ?? 0) * 3 +
      (authorScores.get(authorKey) ?? 0) * 2 +
      (searchScores.get(String(book.id)) ?? 0);

    return { ...book, score };
  });

  const finalRecommendations = scoredRecommendations
    .filter((b) => b.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        String(left.title ?? '').localeCompare(String(right.title ?? ''))
    )
    .slice(0, 4);

  if (finalRecommendations.length < 4) {
    const remaining = fallbackBooks
      .filter((b) => !finalRecommendations.some((r) => r.id === b.id))
      .slice(0, 4 - finalRecommendations.length);

    finalRecommendations.push(...remaining);
  }

  return {
    recommendations: finalRecommendations,
    topCategories: sortedCategories.slice(0, 2),
    isColdStart,
  };
}
