import { useState } from 'react';
import { BookOpen } from 'lucide-react';

export default function BookCover({
  src,
  title,
  className = '',
  imageFit = 'cover',
  onLoad,
  onError,
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className={`visitor-book-cover relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 ${className}`}
      role="img"
      aria-label={title ? `Cover for ${title}` : 'Book cover placeholder'}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={title || 'Book cover'}
          className={`absolute inset-0 h-full w-full ${
            imageFit === 'contain' ? 'object-contain' : 'object-cover'
          }`}
          onLoad={onLoad}
          onError={(event) => {
            setFailed(true);
            onError?.(event);
          }}
        />
      ) : (
        <BookOpen size={24} aria-hidden="true" />
      )}
    </div>
  );
}
