import PropTypes from 'prop-types';

export default function PageJump({ page, pageCount, onPageChange, className = '' }) {
  const commit = (input) => {
    const requested = Number.parseInt(input.value, 10);
    const nextPage = Number.isFinite(requested)
      ? Math.max(1, Math.min(pageCount, requested))
      : page;
    onPageChange(nextPage);
    input.value = String(nextPage);
  };
  return (
    <label className={`inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-slate-600 ${className}`}>
      Page
      <input
        aria-label="Go to page"
        type="number"
        min="1"
        max={pageCount}
        key={page}
        defaultValue={page}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(event.currentTarget); event.currentTarget.blur(); } }}
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
