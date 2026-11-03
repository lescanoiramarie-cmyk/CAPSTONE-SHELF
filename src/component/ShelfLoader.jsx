import './ShelfLoader.css';

export default function ShelfLoader({
  label = 'Loading SHELF...',
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
      {screen ? (
        <img className="shelf-loader-logo" src="/shelf-logo.png" alt="" />
      ) : (
        <span className="shelf-loader-indicator" aria-hidden="true" />
      )}

      {!compact && (
        <div className="shelf-loader-brand">
          {screen && <span className="shelf-loader-loading">Loading...</span>}
          <span className="shelf-loader-name">SHELF</span>
          <span className="shelf-loader-tagline">
            A Shared Hub for Library and Education Fusion System
          </span>
          <span className="shelf-loader-progress" aria-hidden="true">
            <span className="shelf-loader-progress-fill" />
          </span>
        </div>
      )}
    </div>
  );
}
