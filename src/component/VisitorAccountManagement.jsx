import { useEffect, useState } from 'react';
import { Search, ChevronLeft, ChevronRight, UsersRound } from 'lucide-react';
import { fetchVisitorAccounts } from '../data/visitorAccounts.js';

const PAGE_SIZE = 10;

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
}

export default function VisitorAccountManagement({
  mode = 'superadmin',
  libraryId = null,
  libraryName = '',
  libraries = [],
}) {
  const [branchFilter, setBranchFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [visitors, setVisitors] = useState([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loadedRequestKey, setLoadedRequestKey] = useState('');
  const isSuperAdmin = mode === 'superadmin';
  const missingBranch = !isSuperAdmin && !libraryId;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const selectedLibraryId = !isSuperAdmin
    ? libraryId
    : branchFilter === 'all'
      ? undefined
      : branchFilter === 'outside'
        ? null
        : branchFilter;
  const requestKey = JSON.stringify([
    selectedLibraryId === undefined ? 'all' : selectedLibraryId,
    page,
    debouncedSearch,
  ]);

  useEffect(() => {
    if (missingBranch) return undefined;

    let cancelled = false;

    fetchVisitorAccounts({
      libraryId: selectedLibraryId,
      page,
      pageSize: PAGE_SIZE,
      search: debouncedSearch,
    })
      .then((result) => {
        if (cancelled) return;
        setVisitors(result.visitors);
        setTotal(result.total);
        setError('');
        setLoadedRequestKey(requestKey);
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.error('Visitor account loading failed:', loadError);
        setError(loadError.message || 'Unable to load visitor accounts.');
        setVisitors([]);
        setTotal(0);
        setLoadedRequestKey(requestKey);
      });

    return () => {
      cancelled = true;
    };
  }, [
    debouncedSearch,
    isSuperAdmin,
    libraryId,
    missingBranch,
    page,
    requestKey,
    selectedLibraryId,
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(page * PAGE_SIZE, total);
  const loading = !missingBranch && loadedRequestKey !== requestKey;
  const visibleError = missingBranch
    ? 'This sub-admin account is not assigned to a library branch.'
    : loadedRequestKey === requestKey
      ? error
      : '';
  const visibleVisitors = loadedRequestKey === requestKey ? visitors : [];

  return (
    <section className="min-w-0 space-y-5">
      <header>
        <h2 className="text-xl font-bold text-slate-800">Visitor Account Management</h2>
        <p className="mt-1 text-sm text-slate-500">
          {isSuperAdmin
            ? 'View registered visitors and filter accounts by library branch.'
            : `Registered visitors for ${libraryName || 'your assigned library branch'}.`}
        </p>
      </header>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search visitor accounts</span>
          <Search
            size={17}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search visitor name or email"
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm"
          />
        </label>
      </div>

      {isSuperAdmin && (
        <div
          role="group"
          aria-label="Filter visitor accounts by library"
          className="flex min-w-0 gap-2 overflow-x-auto pb-2"
        >
          {[
            { id: 'all', label: 'All libraries' },
            { id: 'outside', label: 'Outside Visitor' },
            ...libraries.map((library) => ({
              id: library.id,
              label: library.name,
            })),
          ].map((filter) => (
            <button
              key={filter.id}
              type="button"
              aria-pressed={branchFilter === filter.id}
              onClick={() => {
                setBranchFilter(filter.id);
                setPage(1);
              }}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                branchFilter === filter.id
                  ? 'border-shelf-primary bg-shelf-primary text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      )}

      {visibleError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {visibleError}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Visitor</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Library</th>
                <th className="px-4 py-3 font-semibold">Registration Date</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && !missingBranch ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    Loading visitor accounts…
                  </td>
                </tr>
              ) : visibleVisitors.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    <UsersRound size={22} className="mx-auto mb-2 text-slate-400" />
                    No visitor accounts found.
                  </td>
                </tr>
              ) : (
                visibleVisitors.map((visitor) => (
                  <tr key={visitor.id} className="align-top">
                    <td className="px-4 py-3 font-semibold text-slate-800">{visitor.fullName || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{visitor.email || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {visitor.libraryId
                        ? libraries.find((library) => String(library.id) === String(visitor.libraryId))?.name ||
                          (isSuperAdmin ? 'Library branch' : libraryName || 'Assigned library')
                        : isSuperAdmin ? 'Outside Visitor' : libraryName || 'No library assigned'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(visitor.registeredAt)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                        visitor.isActive
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}>
                        {visitor.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <footer className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <p aria-live="polite">
            Showing {firstRow}–{lastRow} of {total} visitors
          </p>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1 || loading}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeft size={16} aria-hidden="true" />
              Previous
            </button>
            <span className="whitespace-nowrap text-xs font-medium">
              Page {page} of {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              disabled={page >= pageCount || loading}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </footer>
      </div>
    </section>
  );
}
