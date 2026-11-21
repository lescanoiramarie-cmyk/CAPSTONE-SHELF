import { useEffect, useState } from 'react';
import { Search, ChevronLeft, ChevronRight, UsersRound, ShieldCheck } from 'lucide-react';
import AdminAnalyticsPanel from './AdminAnalyticsPanel.jsx';
import {
  fetchVisitorAccounts,
  approveCommunityVisitor,
  setVisitorActive,
} from '../data/visitorAccounts.js';



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
  const [pageSize, setPageSize] = useState(10);
  const [visitors, setVisitors] = useState([]);
  const [total, setTotal] = useState(0);
  const [accountAnalytics, setAccountAnalytics] = useState(null);
  const [error, setError] = useState('');
  const [loadedRequestKey, setLoadedRequestKey] = useState('');
  const [updatingVisitorId, setUpdatingVisitorId] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
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
    pageSize,
    debouncedSearch,
  ]);

  useEffect(() => {
    if (missingBranch) return undefined;

    let cancelled = false;

    fetchVisitorAccounts({
      libraryId: selectedLibraryId,
      page,
      pageSize,
      search: debouncedSearch,
    })
      .then((result) => {
        if (cancelled) return;
        setVisitors(result.visitors);
        setTotal(result.total);
        setAccountAnalytics(result.analytics || null);
        setError('');
        setLoadedRequestKey(requestKey);
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.error('Visitor account loading failed:', loadError);
        setError(loadError.message || 'Unable to load visitor accounts.');
        setVisitors([]);
        setTotal(0);
        setAccountAnalytics(null);
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
    pageSize,
    requestKey,
    selectedLibraryId,
  ]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);
  const loading = !missingBranch && loadedRequestKey !== requestKey;
  const visibleError = missingBranch
    ? 'This sub-admin account is not assigned to a library branch.'
    : loadedRequestKey === requestKey
      ? error
      : '';
  const visibleVisitors = loadedRequestKey === requestKey ? visitors : [];

  const handleToggleVisitor = async (visitor) => {
    if (isSuperAdmin || !visitor?.id || updatingVisitorId) return;

    const nextIsActive = !visitor.isActive;
    setUpdatingVisitorId(visitor.id);
    setActionError('');
    setActionMessage('');

    try {
      const isPendingCommunity = visitor.registrationType === 'community'
        && visitor.approvalStatus === 'pending';
      if (isPendingCommunity) await approveCommunityVisitor(visitor.id);
      else await setVisitorActive(visitor.id, nextIsActive);
      setVisitors((current) =>
        current.map((item) =>
          item.id === visitor.id
            ? { ...item, isActive: true, approvalStatus: 'approved' }
            : item
        )
      );
      setActionMessage(isPendingCommunity ? 'Community visitor approved successfully.' : `Visitor account ${nextIsActive ? 'enabled' : 'disabled'} successfully.`);
    } catch (updateError) {
      console.error('Visitor account status update failed:', updateError);
      setActionError(
        updateError.message || 'Unable to update visitor account status.'
      );
    } finally {
      setUpdatingVisitorId('');
    }
  };

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

      {!loading && accountAnalytics && <AdminAnalyticsPanel
        title="Visitor account health"
        description="Descriptive counts are scoped to this branch or the selected Super Admin library filter, independent of the current search and page."
        metrics={[
          { label: 'Registered visitors', value: accountAnalytics.total.toLocaleString() },
          { label: 'Active accounts', value: accountAnalytics.active.toLocaleString() },
          { label: 'New · last 30 days', value: accountAnalytics.registeredLast30Days.toLocaleString() },
          { label: 'Community approvals pending', value: accountAnalytics.pendingCommunity.toLocaleString() },
        ]}
        prediction={accountAnalytics.registeredPrevious30Days > 0
          ? `At the last 30-day pace, about ${accountAnalytics.registeredLast30Days.toLocaleString()} new accounts may register in the next 30 days (${Math.round(((accountAnalytics.registeredLast30Days - accountAnalytics.registeredPrevious30Days) / accountAnalytics.registeredPrevious30Days) * 100)}% versus the prior 30 days).`
          : accountAnalytics.registeredLast30Days > 0
            ? `About ${accountAnalytics.registeredLast30Days.toLocaleString()} new accounts may register in the next 30 days if the current pace continues; there is no prior-period baseline yet.`
            : 'No registrations were recorded in the last 30 days, so a near-term registration projection is not available.'}
        recommendation={accountAnalytics.pendingCommunity
          ? `Review the ${accountAnalytics.pendingCommunity.toLocaleString()} pending community registration(s) before enabling account access.`
          : accountAnalytics.unverified
            ? `Check the ${accountAnalytics.unverified.toLocaleString()} account(s) without verified email before approving access to visitor features.`
            : 'Continue reviewing account verification and branch assignment when new registrations arrive.'}
      />}

      {isSuperAdmin && (
        <div className="flex items-center gap-2.5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-200">
          <ShieldCheck size={18} className="shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <span>System-wide visitor accounts oversight (Read-only). Account activation, approvals, and status mutations are managed by branch sub-administrators.</span>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end">
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
        {isSuperAdmin && (
          <label className="block w-full sm:w-80 sm:shrink-0">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Library</span>
            <select
              value={branchFilter}
              onChange={(event) => {
                setBranchFilter(event.target.value);
                setPage(1);
              }}
              aria-label="Filter visitor accounts by library"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-shelf-primary focus:ring-2 focus:ring-shelf-primary/20"
            >
              <option value="all">All libraries</option>
              <option value="outside">Outside Visitor</option>
              {libraries.map((library) => (
                <option key={library.id} value={library.id}>{library.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="block w-full sm:w-40 sm:shrink-0">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Rows per page</span>
          <select
            value={pageSize}
            onChange={(event) => {
              setPage(1);
              setPageSize(Number(event.target.value));
            }}
            aria-label="Rows per page"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-shelf-primary focus:ring-2 focus:ring-shelf-primary/20"
          >
            <option value={10}>10 per page</option>
            <option value={20}>20 per page</option>
            <option value={30}>30 per page</option>
            <option value={40}>40 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
          </select>
        </label>
      </div>

      {visibleError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {visibleError}
        </div>
      )}
      {actionError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {actionError}
        </div>
      )}
      {actionMessage && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {actionMessage}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Visitor</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Library</th>
                <th className="px-4 py-3 font-semibold">Registration / approval</th>
                <th className="px-4 py-3 font-semibold">Registration Date</th>
                <th className="px-4 py-3 font-semibold">{isSuperAdmin ? 'Status' : 'Action'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && !missingBranch ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    Loading visitor accounts…
                  </td>
                </tr>
              ) : visibleVisitors.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
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
                    <td className="px-4 py-3 text-slate-600">
                      <span className="block capitalize">{visitor.registrationType === 'community' ? 'Public / Community' : 'Institutional'}</span>
                      {visitor.registrationType === 'community' && <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${visitor.approvalStatus === 'pending' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{visitor.approvalStatus === 'pending' ? 'Approval pending' : 'Approved'}</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(visitor.registeredAt)}</td>
                    <td className="px-4 py-3">
                      {isSuperAdmin ? (
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                          visitor.isActive
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}>
                          {visitor.isActive ? 'Active' : 'Disabled'}
                        </span>
                      ) : (
                        <button
                          type="button"
                          data-confirm-message={`${visitor.registrationType === 'community' && visitor.approvalStatus === 'pending' ? 'Approve' : visitor.isActive ? 'Disable' : 'Enable'} the visitor account for "${visitor.fullName || visitor.email || 'this visitor'}"?`}
                          onClick={() => void handleToggleVisitor(visitor)}
                          disabled={Boolean(updatingVisitorId)}
                          className={`rounded-md border px-3 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            visitor.isActive
                              ? 'border-red-200 text-red-700 hover:bg-red-50'
                              : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                          }`}
                        >
                          {updatingVisitorId === visitor.id
                            ? 'Updating...'
                            : visitor.registrationType === 'community' && visitor.approvalStatus === 'pending'
                              ? 'Approve visitor'
                              : visitor.isActive
                                ? 'Disable'
                                : 'Enable'}
                        </button>
                      )}
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
