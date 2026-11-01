import './ShelfLoader.css';

export default function ShelfLoader({
  label = 'Loading SHELF ILMS...',
  compact = false,
  screen = false,
}) {
  return (
    <div
      className={[
        'shelf-loader',
        compact && 'shelf-loader-compact',
        screen && 'shelf-loader-screen',
      ]
        .filter(Boolean)
        .join(' ')}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="shelf-loader-art" aria-hidden="true">
        <div className="shelf-loader-book">
          <img
            className="shelf-loader-book-base"
            src="/shelf-loader-book.png"
            alt=""
          />
          <img
            className="shelf-loader-bookmark"
            src="/shelf-loader-bookmark.png"
            alt=""
          />
        </div>
      </div>

      {!compact && (
        <div className="shelf-loader-brand">
          <span className="shelf-loader-name">SHELF ILMS</span>
          <span className="shelf-loader-tagline">
            A Shared Hub for Education and Library Fusion System
          </span>
          <span className="shelf-loader-progress" aria-hidden="true">
            <span className="shelf-loader-progress-fill" />
          </span>
        </div>
      )}
    </div>
  );
}
