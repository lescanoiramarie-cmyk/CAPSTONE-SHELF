import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

export default function PageJump({ page, pageCount, onPageChange, className = '' }) {
  const [draft, setDraft] = useState({ page, value: String(page) });
  const displayedValue = draft.page === page ? draft.value : String(page);

  useEffect(() => {
    if (draft.page !== page || !/^\d+$/.test(draft.value)) return undefined;
    const requested = Number(draft.value);
    if (requested < 1 || requested > pageCount || requested === page) return undefined;
    const timer = window.setTimeout(() => onPageChange(requested), 450);
    return () => window.clearTimeout(timer);
  }, [draft, page, pageCount, onPageChange]);

  const commit = () => {
    const requested = Number.parseInt(displayedValue, 10);
    const nextPage = Number.isFinite(requested)
      ? Math.max(1, Math.min(pageCount, requested))
      : page;
    setDraft({ page: nextPage, value: String(nextPage) });
    if (nextPage !== page) onPageChange(nextPage);
  };

  return (
    <label className={`inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-slate-600 ${className}`}>
      Page
      <input
        aria-label="Go to page"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={displayedValue}
        onChange={(event) => setDraft({ page, value: event.target.value.replace(/\D/g, '') })}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); event.currentTarget.blur(); } }}
        className="w-16 rounded-md border border-slate-300 bg-white px-2 py-1 text-center text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
      />
      of {pageCount}
    </label>
  );
}

PageJump.propTypes = {
  page: PropTypes.number.isRequired,
  pageCount: PropTypes.number.isRequired,
  onPageChange: PropTypes.func.isRequired,
  className: PropTypes.string,
};
