import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleDollarSign, History, Search, X, Bell, ChevronLeft, ChevronRight } from 'lucide-react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { supabase } from '../lib/supabaseClient.js';
import { sendFineReminder } from '../lib/fineReminder.js';
import {
  buildFinePaymentAnalyticsArgs,
  FINE_PAYMENT_ANALYTICS_RPC,
  sanitizeFinePaymentAnalyticsRows,
} from '../lib/finePaymentAnalytics.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const peso = (value) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PAGE_SIZE = 10;

function getFineStatus(row) {
  if (Number(row.outstanding_amount) <= 0) return 'Paid';
  if (Number(row.fine_paid_amount) > 0) return 'Partially paid';
  return 'Unpaid';
}

export default function FinePayments({ libraryId = null, libraryName = '', isSuperAdmin = false, libraries = [] }) {
  const [rows, setRows] = useState([]);
  const [analyticsRows, setAnalyticsRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedLibraryId, setSelectedLibraryId] = useState('all');
  const [selectedFine, setSelectedFine] = useState(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({ error: '', message: '' });
  const [historyFor, setHistoryFor] = useState(null);
  const [page, setPage] = useState(1);
  const [alertingId, setAlertingId] = useState('');
  const [alertingAll, setAlertingAll] = useState(false);
  const [visitorIdsByRequest, setVisitorIdsByRequest] = useState({});
  const [alertedTodayRequestIds, setAlertedTodayRequestIds] = useState(() => new Set());
  const activeLibraryId = isSuperAdmin
    ? selectedLibraryId === 'all' ? null : selectedLibraryId
    : libraryId;

  const loadRows = useCallback(async () => {
    if (!supabase) {
      setLoadError('The database connection is unavailable.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    setVisitorIdsByRequest({});
    setAlertedTodayRequestIds(new Set());
    if (isSuperAdmin) {
      const { data, error } = await supabase.rpc(
        FINE_PAYMENT_ANALYTICS_RPC,
        buildFinePaymentAnalyticsArgs(activeLibraryId)
      );
      if (error) {
        setLoadError(['PGRST202', '42883'].includes(error.code)
          ? 'The aggregate fine analytics endpoint is not available. Confirm the fine-payment privacy migration is deployed and the PostgREST schema cache has reloaded.'
          : error.message || 'Unable to load aggregate fine analytics.');
        setAnalyticsRows([]);
      } else {
        setAnalyticsRows(sanitizeFinePaymentAnalyticsRows(data));
      }
      setRows([]);
      setLoading(false);
      return;
    }
    setAnalyticsRows([]);
    const dashboardResult = await supabase.rpc('get_fine_payment_dashboard', { p_library_id: activeLibraryId ? String(activeLibraryId) : null });
    const { data, error } = dashboardResult;
    if (error) {
      setVisitorIdsByRequest({});
    } else {
      supabase.rpc('get_fine_payment_alert_targets', { p_library_id: activeLibraryId ? String(activeLibraryId) : null })
        .then(({ data: targets, error: targetError }) => {
          if (!targetError && Array.isArray(targets)) {
            setVisitorIdsByRequest(Object.fromEntries(targets.map((target) => [String(target.request_id), String(target.visitor_id)])));
            setAlertedTodayRequestIds(new Set(targets.filter((target) => target.alerted_today).map((target) => String(target.request_id))));
          }
        })
        .catch(() => {});
    }
    if (error) {
      setLoadError(error.code === '57014'
        ? (isSuperAdmin && !activeLibraryId
          ? 'Loading fines across all libraries timed out. Choose a partner library from the filter and try again.'
          : 'Loading these fine records timed out. Please retry in a moment.')
        : error.message || 'Unable to load fine records.');
      setRows([]);
    } else {
      setRows(Array.isArray(data) ? data : []);
    }
    setLoading(false);
  }, [activeLibraryId, isSuperAdmin]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadRows(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRows]);

  const libraryRows = useMemo(() => rows.filter((row) => {
    const matchesLibrary = !isSuperAdmin || selectedLibraryId === 'all' || String(row.library_id) === String(selectedLibraryId);
    const hasFine = Number(row.fine_amount) > 0 || Number(row.fine_paid_amount) > 0;
    return matchesLibrary && hasFine;
  }), [rows, selectedLibraryId, isSuperAdmin]);
  const statusCounts = useMemo(() => libraryRows.reduce((counts, row) => {
    counts[getFineStatus(row)] += 1;
    return counts;
  }, { All: libraryRows.length, Unpaid: 0, 'Partially paid': 0, Paid: 0 }), [libraryRows]);
  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return libraryRows.filter((row) => {
      const matchesText = !term || [row.visitor_name, row.book_title, row.library_name]
        .some((value) => String(value || '').toLowerCase().includes(term));
      return matchesText && (statusFilter === 'All' || getFineStatus(row) === statusFilter);
    });
  }, [libraryRows, search, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const visiblePage = Math.min(page, pageCount);
  const pageRows = visibleRows.slice((visiblePage - 1) * PAGE_SIZE, visiblePage * PAGE_SIZE);

  const totals = useMemo(() => rows.filter((row) => Number(row.fine_amount) > 0 || Number(row.fine_paid_amount) > 0).reduce((result, row) => {
    result.totalAssessed += Number(row.fine_amount || 0);
    result.totalCollected += Number(row.fine_paid_amount || 0);
    result.confirmedOutstanding += Number(row.outstanding_amount || 0);
    return result;
  }, { totalAssessed: 0, totalCollected: 0, confirmedOutstanding: 0 }), [rows]);

  const openPayment = (row) => {
    setSelectedFine(row);
    setAmount(Number(row.outstanding_amount || 0).toFixed(2));
    setMethod('cash');
    setReference('');
    setNote('');
    setFeedback({ error: '', message: '' });
  };

  const submitPayment = async (event) => {
    event.preventDefault();
    if (!selectedFine || saving) return;
    setSaving(true);
    setFeedback({ error: '', message: '' });
    const { error } = await supabase.rpc('record_fine_payment', {
      p_request_id: selectedFine.request_id,
      p_amount: Number(amount),
      p_payment_method: method,
      p_reference_number: reference.trim() || null,
      p_note: note.trim() || null,
    });
    if (error) {
      setFeedback({ error: error.message || 'Unable to record this payment.', message: '' });
      setSaving(false);
      return;
    }
    setSelectedFine(null);
    setFeedback({ error: '', message: 'Payment recorded. The outstanding balance has been updated.' });
    setSaving(false);
    await loadRows();
  };

  const dueFineRows = useMemo(() => rows.filter((row) => Number(row.outstanding_amount) > 0), [rows]);
  const alertedRequestIdsForVisitor = useCallback((row) => {
    const visitorId = visitorIdsByRequest[String(row.request_id)];
    if (!visitorId) return [String(row.request_id)];
    return rows
      .filter((candidate) => String(candidate.library_id || candidate.library_name) === String(row.library_id || row.library_name)
        && visitorIdsByRequest[String(candidate.request_id)] === visitorId)
      .map((candidate) => String(candidate.request_id));
  }, [rows, visitorIdsByRequest]);
  const wasVisitorAlertedToday = useCallback((row) => alertedRequestIdsForVisitor(row)
    .some((requestId) => alertedTodayRequestIds.has(requestId)), [alertedRequestIdsForVisitor, alertedTodayRequestIds]);
  const visitorAlertRows = useMemo(() => {
    const visitors = new Map();
    dueFineRows.forEach((row) => {
      if (wasVisitorAlertedToday(row)) return;
      const visitorId = visitorIdsByRequest[String(row.request_id)];
      const key = visitorId ? `${row.library_id || row.library_name}:${visitorId}` : `${row.library_id || row.library_name}:${String(row.visitor_name || '').trim().toLowerCase()}:${row.request_id}`;
      if (!visitors.has(key)) visitors.set(key, row);
    });
    return [...visitors.values()];
  }, [dueFineRows, visitorIdsByRequest, wasVisitorAlertedToday]);
  const sendSingleAlert = async (row) => {
    setAlertingId(String(row.request_id));
    setFeedback({ error: '', message: '' });
    try {
      await sendFineReminder(row.request_id);
      setAlertedTodayRequestIds((previous) => new Set([...previous, ...alertedRequestIdsForVisitor(row)]));
      setFeedback({ error: '', message: `Fine reminder sent to ${row.visitor_name}.` });
    } catch (error) {
      if (/already sent for this loan today/i.test(String(error.message || ''))) {
        setAlertedTodayRequestIds((previous) => new Set([...previous, ...alertedRequestIdsForVisitor(row)]));
        setFeedback({ error: '', message: `${row.visitor_name} was already alerted today.` });
      } else setFeedback({ error: error.message || 'Unable to send the fine reminder.', message: '' });
    } finally {
      setAlertingId('');
    }
  };

  const sendAllAlerts = async () => {
    if (alertingAll || visitorAlertRows.length === 0) return;
    setAlertingAll(true);
    setFeedback({ error: '', message: '' });
    let sent = 0;
    const failures = [];
    for (const row of visitorAlertRows) {
      try {
        await sendFineReminder(row.request_id);
        sent += 1;
        setAlertedTodayRequestIds((previous) => new Set([...previous, ...alertedRequestIdsForVisitor(row)]));
      } catch (error) {
        if (/already sent for this loan today/i.test(String(error.message || ''))) {
          setAlertedTodayRequestIds((previous) => new Set([...previous, ...alertedRequestIdsForVisitor(row)]));
        } else failures.push(`${row.visitor_name}: ${error.message || 'send failed'}`);
      }
    }
    if (failures.length) setFeedback({ error: `${sent} alert(s) sent. ${failures.length} could not be sent: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '; …' : ''}`, message: '' });
    else setFeedback({ error: '', message: `Fine alerts sent for ${sent} visitor(s); existing alerts were marked as already sent today.` });
    setAlertingAll(false);
  };

  if (isSuperAdmin) {
    const summaries = analyticsRows.filter((row) => row.report_kind === 'summary');
    const overall = summaries.find((row) => !row.branch_id) || {};
    const branchSummaries = summaries.filter((row) => row.branch_id);
    const monthlyRows = analyticsRows
      .filter((row) => row.report_kind === 'monthly')
      .sort((left, right) => String(right.period_month).localeCompare(String(left.period_month)));
    const fmtMonth = (value) => value
      ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
      : '—';
    const metricCards = [
      ['Fines assessed', overall.fines_assessed],
      ['Fines collected', overall.fines_collected],
      ['Outstanding', overall.outstanding_balance],
      ['Paid / partial / unpaid', `${overall.paid_request_count || 0} / ${overall.partially_paid_request_count || 0} / ${overall.unpaid_request_count || 0}`],
    ];
    return (
      <section className="space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Fine Payment Analytics</h2>
            <p className="mt-1 text-sm text-slate-600">Aggregate totals and trends across libraries.</p>
          </div>
          <label className="w-72 max-w-full">
            <span className="sr-only">Filter analytics by library</span>
            <select value={selectedLibraryId} onChange={(event) => setSelectedLibraryId(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800">
              <option value="all">All partner libraries</option>
              {libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
            </select>
          </label>
        </header>
        {loading ? <p className="text-sm text-slate-500">Loading aggregate analytics…</p> : null}
        {loadError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</p> : null}
        {!loading && !loadError && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {metricCards.map(([label, value]) => (
                <article key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                  <p className="mt-2 text-xl font-bold text-slate-900">{typeof value === 'number' || (value != null && label !== 'Paid / partial / unpaid') ? peso(value) : value ?? '—'}</p>
                </article>
              ))}
            </div>

            {branchSummaries.length > 0 && (
              <article className="overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="font-bold text-slate-900 mb-3">Branch Collections vs Outstanding</h3>
                <div className="h-64">
                  <Bar
                    data={{
                      labels: branchSummaries.map((b) => b.branch_name || 'Library'),
                      datasets: [
                        {
                          label: 'Collected (₱)',
                          data: branchSummaries.map((b) => Number(b.fines_collected || 0)),
                          backgroundColor: '#10b981',
                        },
                        {
                          label: 'Outstanding (₱)',
                          data: branchSummaries.map((b) => Number(b.outstanding_balance || 0)),
                          backgroundColor: '#ef4444',
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { position: 'top' },
                      },
                      scales: {
                        y: {
                          beginAtZero: true,
                          ticks: { callback: (v) => `₱${v}` },
                        },
                      },
                    }}
                  />
                </div>
              </article>
            )}
            <article className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3"><h3 className="font-bold text-slate-900">Branch comparison</h3></div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Library</th><th className="px-4 py-3">Assessed</th><th className="px-4 py-3">Collected</th><th className="px-4 py-3">Outstanding</th><th className="px-4 py-3">Paid / partial / unpaid</th><th className="px-4 py-3">Cash / transfer / other</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {branchSummaries.map((row) => <tr key={row.branch_id}><td className="px-4 py-3 font-medium">{row.branch_name}</td><td className="px-4 py-3">{peso(row.fines_assessed)}</td><td className="px-4 py-3">{peso(row.fines_collected)}</td><td className="px-4 py-3">{peso(row.outstanding_balance)}</td><td className="px-4 py-3">{row.paid_request_count} / {row.partially_paid_request_count} / {row.unpaid_request_count}</td><td className="px-4 py-3">{peso(row.cash_collected)} / {peso(row.bank_transfer_collected)} / {peso(row.other_collected)}</td></tr>)}
                    {branchSummaries.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No aggregate fine data is available.</td></tr>}
                  </tbody>
                </table>
              </div>
            </article>
            <article className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3"><h3 className="font-bold text-slate-900">Monthly collection trend</h3></div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Month</th><th className="px-4 py-3">Library</th><th className="px-4 py-3">Collected</th><th className="px-4 py-3">Cash / transfer / other</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {monthlyRows.map((row, index) => <tr key={`${row.period_month}-${row.branch_id || 'all'}-${index}`}><td className="px-4 py-3">{fmtMonth(row.period_month)}</td><td className="px-4 py-3">{row.branch_name}</td><td className="px-4 py-3">{peso(row.fines_collected)}</td><td className="px-4 py-3">{peso(row.cash_collected)} / {peso(row.bank_transfer_collected)} / {peso(row.other_collected)}</td></tr>)}
                    {monthlyRows.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">No collection history is available.</td></tr>}
                  </tbody>
                </table>
              </div>
            </article>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">{libraryName || 'Administration'}</p>
          <h2 className="mt-1 text-2xl font-bold text-shelf-primary">Fine Payments</h2>
          <p className="mt-1 text-sm text-slate-600">Track outstanding library fines and record payments collected offline.</p>
        </div>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={alertingAll || visitorAlertRows.length === 0} onClick={() => void sendAllAlerts()} className="inline-flex items-center gap-2 rounded-lg bg-shelf-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><Bell size={16}/>{alertingAll ? 'Sending alerts…' : `Alert all (${visitorAlertRows.length} visitors)`}</button><button type="button" onClick={() => void loadRows()} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Refresh</button></div>
      </header>

      {feedback.message && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{feedback.message}</p>}
      {loadError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Total fines charged</p>
          <p className="mt-1 text-xs text-slate-500">Full fine amount for these records</p>
          <p className="mt-2 text-2xl font-bold text-shelf-primary">{peso(totals.totalAssessed)}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Payments received</p>
          <p className="mt-1 text-xs text-slate-500">Actual offline payments logged by staff</p>
          <p className="mt-2 text-2xl font-bold text-emerald-700">{peso(totals.totalCollected)}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Still owed by visitors</p>
          <p className="mt-1 text-xs text-slate-500">Unpaid amount remaining after payments</p>
          <p className="mt-2 text-2xl font-bold text-red-700">{peso(totals.confirmedOutstanding)}</p>
        </article>
      </div>

      <div className="flex min-w-0 flex-nowrap items-center gap-3 overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        {isSuperAdmin && <label className="w-72 shrink-0"><span className="sr-only">Filter fines by partner library</span><select value={selectedLibraryId} onChange={(event) => setSelectedLibraryId(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800"><option value="all">All partner libraries</option>{libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}</select></label>}
        <label className="relative min-w-[16rem] flex-1">
          <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search visitor, book, or library" className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-3 text-sm text-slate-800" />
        </label>
        <div role="tablist" aria-label="Fine payment status" className="flex shrink-0 flex-nowrap gap-1 rounded-lg bg-slate-50 p-1">
          {['All', 'Unpaid', 'Partially paid', 'Paid'].map((status) => {
            const selected = statusFilter === status;
            const count = statusCounts[status];
            return <button key={status} type="button" role="tab" aria-selected={selected} onClick={() => setStatusFilter(status)} className={`inline-flex min-w-max items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${selected ? 'bg-shelf-primary text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-900'}`}>
              {status}<span className={`rounded-full px-2 py-0.5 text-xs ${selected ? 'bg-white/15 text-white' : 'bg-white text-slate-600'}`}>{count}</span>
            </button>;
          })}
        </div>
      </div>

      {loading ? <p role="status" className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading fine records…</p> : visibleRows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">No fine records match this filter.</div>
      ) : (
        <div className="space-y-3">
          {pageRows.map((row) => {
            const status = getFineStatus(row);
            const history = Array.isArray(row.payments) ? row.payments : [];
            return (
              <article key={row.request_id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_11rem_18rem] lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-slate-900">{row.visitor_name}</h3>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status === 'Paid' ? 'bg-emerald-100 text-emerald-800' : status === 'Partially paid' ? 'bg-blue-100 text-blue-800' : 'bg-red-100 text-red-800'}`}>{status}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 break-words text-sm leading-5 text-slate-700">{row.book_title}</p>
                    <p className="mt-1 line-clamp-2 break-words text-xs leading-4 text-slate-500">{row.library_name} · Borrowed {row.borrow_date ? new Date(row.borrow_date).toLocaleDateString('en-PH') : 'Date unavailable'} · Due {row.due_date ? new Date(row.due_date).toLocaleDateString('en-PH') : 'Date unavailable'}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-sm lg:w-44">
                    <span className="text-slate-500">Fine</span><strong className="text-right text-slate-800">{peso(row.fine_amount)}</strong>
                    <span className="text-slate-500">Paid</span><strong className="text-right text-emerald-700">{peso(row.fine_paid_amount)}</strong>
                    <span className="font-semibold text-slate-700">Balance</span><strong className="text-right font-bold text-red-700">{peso(row.outstanding_amount)}</strong>
                  </div>
                  <div className="grid min-w-0 grid-cols-2 gap-2 lg:w-[18rem] lg:justify-self-end">
                    {history.length > 0 ? <button type="button" onClick={() => setHistoryFor(historyFor === row.request_id ? null : row.request_id)} className="inline-flex min-w-0 items-center justify-center gap-2 rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><History size={16} className="shrink-0" /> History ({history.length})</button> : <span aria-hidden="true" className="invisible rounded-lg border px-2.5 py-2" />}
                    {Number(row.outstanding_amount) > 0 ? <button type="button" disabled={alertingAll || alertingId === String(row.request_id) || wasVisitorAlertedToday(row)} onClick={() => void sendSingleAlert(row)} title={wasVisitorAlertedToday(row) ? 'This visitor was alerted today for this library.' : 'Send a fine reminder to this visitor'} className={`inline-flex min-w-0 items-center justify-center gap-2 rounded-lg border px-2.5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-100 ${wasVisitorAlertedToday(row) ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100'}`}><Bell size={16} className="shrink-0"/>{alertingId === String(row.request_id) ? 'Sending…' : wasVisitorAlertedToday(row) ? 'Alerted today' : 'Alert visitor'}</button> : <span aria-hidden="true" className="invisible rounded-lg border px-2.5 py-2" />}
                    {Number(row.outstanding_amount) > 0 ? <button type="button" onClick={() => openPayment(row)} className="col-span-2 inline-flex items-center justify-center gap-2 rounded-lg bg-shelf-primary px-3 py-2 text-sm font-semibold text-white hover:bg-shelf-primary/90"><CircleDollarSign size={16} /> Record payment</button> : <span className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800"><CheckCircle2 size={16} /> Settled</span>}
                  </div>
                </div>
                {historyFor === row.request_id && <ol className="mt-4 space-y-2 border-t border-slate-100 pt-3">{history.map((payment) => <li key={payment.id} className="flex flex-wrap justify-between gap-2 text-xs text-slate-600"><span><strong className="text-slate-800">{peso(payment.amount)}</strong> · {String(payment.paymentMethod || '').replace('_', ' ')}{payment.referenceNumber ? ` · Ref ${payment.referenceNumber}` : ''}{payment.note ? ` · ${payment.note}` : ''}</span><span>{payment.receivedBy} · {new Date(payment.receivedAt).toLocaleString('en-PH')}</span></li>)}</ol>}
              </article>
            );
          })}
        </div>
      )}

      {!loading && visibleRows.length > 0 && <nav aria-label="Fine payments pagination" className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-slate-600">Showing {(visiblePage - 1) * PAGE_SIZE + 1}–{Math.min(visiblePage * PAGE_SIZE, visibleRows.length)} of {visibleRows.length} fine records</p><div className="flex items-center justify-between gap-3 sm:justify-end"><button type="button" disabled={visiblePage === 1} onClick={() => setPage((current) => Math.max(1, Math.min(current, pageCount) - 1))} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft size={16}/>Previous</button><span className="text-sm font-medium text-slate-700">Page {visiblePage} of {pageCount}</span><button type="button" disabled={visiblePage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, Math.min(current, pageCount) + 1))} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Next<ChevronRight size={16}/></button></div></nav>}

      {selectedFine && <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setSelectedFine(null); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="fine-payment-dialog-title" className="my-auto w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Offline payment record</p><h3 id="fine-payment-dialog-title" className="mt-1 text-xl font-bold text-slate-900">Record fine payment</h3><p className="mt-1 text-sm text-slate-600">{selectedFine.visitor_name} · {selectedFine.book_title}</p></div><button type="button" onClick={() => setSelectedFine(null)} disabled={saving} aria-label="Close payment form" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X size={18} /></button></div>
          <form onSubmit={submitPayment} className="mt-5 space-y-4">
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">Outstanding balance: <strong>{peso(selectedFine.outstanding_amount)}</strong></p>
            <label className="block text-sm font-semibold text-slate-700">Amount received<input type="number" min="0.01" max={Number(selectedFine.outstanding_amount).toFixed(2)} step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
            <label className="block text-sm font-semibold text-slate-700">Payment method<select value={method} onChange={(event) => setMethod(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal"><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="other">Other offline payment</option></select></label>
            <label className="block text-sm font-semibold text-slate-700">Receipt / reference number <span className="font-normal text-slate-500">(optional)</span><input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={120} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
            <label className="block text-sm font-semibold text-slate-700">Note <span className="font-normal text-slate-500">(optional)</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
            {feedback.error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{feedback.error}</p>}
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={() => setSelectedFine(null)} disabled={saving} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button><button type="submit" disabled={saving || Number(amount) <= 0 || Number(amount) > Number(selectedFine.outstanding_amount)} className="rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Confirm payment'}</button></div>
          </form>
        </section>
      </div>}
    </section>
  );
}