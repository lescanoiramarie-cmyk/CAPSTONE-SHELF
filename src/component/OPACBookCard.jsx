import BookCover from './BookCover.jsx';
import { ChevronRight, Bookmark, BookmarkCheck } from 'lucide-react';
import { formatBookCategory } from '../lib/bookCategory.js';

/** Shared book card used by the catalog and community books views. */
export default function OPACBookCard({
  book,
  onSelect,
  community = false,
  isSaved = false,
  onSaveToggle,
}) {
  const title = book?.title || 'Untitled Book';
  const author = book?.author || 'Unknown Author';
  const category = formatBookCategory(book?.category);
  const availableCopies = Number(book?.availableCopies || 0);

  const handleSaveToggle = (event) => {
    event.stopPropagation();
    if (onSaveToggle) onSaveToggle(book.id, !isSaved);
  };

  const handleCardClick = (event) => {
    onSelect?.(book, event);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect?.(book, event);
    }
  };

  return (
    <article
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`View details for ${title}`}
      className={`opac-book-card cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600${community ? ' opac-community-book-card' : ''}`}
    >
      <BookCover
        src={book?.coverUrl}
        title={title}
        imageFit="contain"
        className="opac-book-card-cover"
      />
      <span
        className={`opac-book-card-availability visitor-status ${
          availableCopies > 0 ? 'visitor-status-success' : 'visitor-status-neutral'
        }`}
      >
        <span className="opac-book-card-availability-label">
          {availableCopies > 0 ? `${availableCopies} copies available` : 'Unavailable'}
        </span>
      </span>
      <div className="opac-book-card-details">
        <span className="opac-book-card-category category-chip">
          {category || 'Uncategorized'}
        </span>
        <h3 title={title}>{title}</h3>
        <p className="opac-book-card-author" title={author}>By {author}</p>
        <p className="opac-book-card-isbn">
          ISBN: {book?.isbn || '—'}
        </p>
        <div className="opac-book-card-actions mt-auto w-full pt-2">
          {community && onSaveToggle && (
            <button
              type="button"
              onClick={handleSaveToggle}
              aria-label={isSaved ? 'Remove from saved' : 'Save for later'}
              aria-pressed={isSaved}
              className={`opac-book-card-save-btn w-full mb-2 ${
                isSaved ? 'opac-book-card-saved' : ''
              }`}
            >
              {isSaved ? (
                <BookmarkCheck size={16} aria-hidden="true" />
              ) : (
                <Bookmark size={16} aria-hidden="true" />
              )}
              <span className="text-xs font-semibold">{isSaved ? 'Saved' : 'Read later'}</span>
            </button>
          )}
          <span className="opac-book-card-view-details">
            <span>View book details</span>
            <ChevronRight size={15} aria-hidden="true" />
          </span>
        </div>
      </div>
    </article>
  );
}
