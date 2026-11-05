import BookCover from './BookCover.jsx';
import { ChevronRight } from 'lucide-react';
import { formatBookCategory } from '../lib/bookCategory.js';

/** Shared book card used by the catalog and community books views. */
export default function OPACBookCard({ book, onSelect, community = false }) {
  const title = book?.title || 'Untitled Book';
  const author = book?.author || 'Unknown Author';
  const category = formatBookCategory(book?.category);
  const availableCopies = Number(book?.availableCopies || 0);

  return (
    <button
      type="button"
      onClick={() => onSelect(book)}
      aria-label={`View details for ${title}`}
      className={`opac-book-card${community ? ' opac-community-book-card' : ''}`}
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
        <span className="opac-book-card-view-details">
          <span>View book details</span>
          <ChevronRight size={15} aria-hidden="true" />
        </span>
      </div>
    </button>
  );
}
