import BookCover from './BookCover.jsx';

/**
 * Shared institutional OPAC card used by both the public catalog and the
 * catalog embedded in the visitor dashboard.
 */
export default function OPACBookCard({ book, onSelect }) {
  const title = book?.title || 'Untitled Book';
  const author = book?.author || 'Unknown Author';
  const availableCopies = Number(book?.availableCopies || 0);

  return (
    <button
      type="button"
      onClick={() => onSelect(book)}
      aria-label={`View details for ${title}`}
      className="opac-book-card"
    >
      <div className="opac-book-card-content">
        <BookCover
          src={book?.coverUrl}
          title={title}
          imageFit="contain"
          className="opac-book-card-cover"
        />
        <div className="opac-book-card-details">
          <span className="opac-book-card-category">
            {book?.category || 'Uncategorized'}
          </span>
          <h3 title={title}>{title}</h3>
          <p className="opac-book-card-author" title={author}>{author}</p>
          <p className="opac-book-card-isbn">
            ISBN: {book?.isbn || '—'}
          </p>
          <div className="opac-book-card-availability">
            <span className={`visitor-status ${availableCopies > 0 ? 'visitor-status-success' : 'visitor-status-neutral'}`}>
              {availableCopies > 0 ? `${availableCopies} Copies Available` : 'Unavailable'}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
