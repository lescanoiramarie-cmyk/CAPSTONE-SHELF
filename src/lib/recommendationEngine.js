/**
 * Generates book recommendations for a visitor based on their borrowing history.
 * 
 * @param {Array} borrowRequests - All borrow requests from state/context.
 * @param {Array} allBooks - Complete books catalog.
 * @param {string} visitorId - Current visitor's ID.
 * @returns {Object} - Object containing top recommended books and identified top categories.
 */
export function getAIRecommendations(borrowRequests, allBooks, visitorId) {
  if (!visitorId || !borrowRequests || !allBooks) {
    return { recommendations: [], topCategories: [] };
  }

  // 1. Get all completed or active borrow requests for this visitor
  const visitorHistory = borrowRequests.filter(
    (req) => req.visitorId === visitorId || req.visitor_id === visitorId
  );

  if (visitorHistory.length === 0) {
    // Cold start: return top available books if user has no history
    return {
      recommendations: allBooks.slice(0, 4),
      topCategories: [],
      isColdStart: true,
    };
  }

  // 2. Map borrowed book IDs to actual book objects
  const borrowedBookIds = new Set(
    visitorHistory.map((req) => req.bookId || req.book_id)
  );

  const borrowedBooks = allBooks.filter((book) =>
    borrowedBookIds.has(book.id)
  );

  // 3. Count category frequencies to find top genres/interests
  const categoryScores = {};
  const authorScores = {};

  borrowedBooks.forEach((book) => {
    if (book.category) {
      categoryScores[book.category] = (categoryScores[book.category] || 0) + 1;
    }
    if (book.author) {
      authorScores[book.author] = (authorScores[book.author] || 0) + 1;
    }
  });

  // Sort categories by score
  const sortedCategories = Object.keys(categoryScores).sort(
    (a, b) => categoryScores[b] - categoryScores[a]
  );

  // 4. Filter unborrowed books and calculate similarity score
  const candidateBooks = allBooks.filter(
    (book) => !borrowedBookIds.has(book.id)
  );

  const scoredRecommendations = candidateBooks.map((book) => {
    let score = 0;

    // +3 points if the book matches top categories
    if (categoryScores[book.category]) {
      score += categoryScores[book.category] * 3;
    }

    // +2 points if the book is by a previously read author
    if (authorScores[book.author]) {
      score += authorScores[book.author] * 2;
    }

    return { ...book, score };
  });

  // Sort candidates by score (highest first) and take top 4
  const finalRecommendations = scoredRecommendations
    .filter((b) => b.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  // Fallback if not enough scored recommendations
  if (finalRecommendations.length < 4) {
    const remaining = candidateBooks
      .filter((b) => !finalRecommendations.some((r) => r.id === b.id))
      .slice(0, 4 - finalRecommendations.length);

    finalRecommendations.push(...remaining);
  }

  return {
    recommendations: finalRecommendations,
    topCategories: sortedCategories.slice(0, 2),
    isColdStart: false,
  };
}