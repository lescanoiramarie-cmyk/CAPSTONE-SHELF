import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDollarSign, Clock3, History, Search, X, ClipboardCheck } from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';

const peso = (value) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function getFineStatus(row) {
  if (row.fine_review_required) return 'Needs review';
  if (Number(row.outstanding_amount) <= 0) return 'Paid';
  if (Number(row.fine_paid_amount) > 0) return 'Partially paid';
  return 'Unpaid';
}

export default function FinePayments({ libraryId = null, libraryName = '', isSuperAdmin = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedFine, setSelectedFine] = useState(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({ error: '', message: '' });
  const [historyFor, setHistoryFor] = useState(null);
  const [reviewFine, setReviewFine] = useState(null);
  const [reviewDecision, setReviewDecision] = useState('confirmed');
  const [reviewAmount, setReviewAmount] = useState('');
  const [reviewNote, setReviewNote] = useState('');

  const loadRows = useCallback(async () => {
    if (!supabase) {
      setLoadError('The database connection is unavailable.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    const { data, error } = await supabase.rpc('get_fine_payment_dashboard', {
      p_library_id: libraryId ? String(libraryId) : null,
    });
    if (error) {
      setLoadError(error.message || 'Unable to load fine records.');
      setRows([]);
    } else {
      setRows(Array.isArray(data) ? data : []);
    }
    setLoading(false);
  }, [libraryId]);

  useEffect(() => { void loadRows(); }, [loadRows]);

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesText = !term || [row.visitor_name, row.book_title, row.library_name]
        .some((value) => String(value || '').toLowerCase().includes(term));
      return matchesText && (statusFilter === 'All' || getFineStatus(row) === statusFilter);
    });
  }, [rows, search, statusFilter]);

  const totals = useMemo(() => rows.reduce((result, row) => {
    const status = getFineStatus(row);
    if (status === 'Needs review') {
      result.reviewCount += 1;
      return result;
    }
    result.confirmedOutstanding += Number(row.outstanding_amount || 0);
    if (status === 'Unpaid' || status === 'Partially paid') result.dueCount += 1;
    return result;
  }, { confirmedOutstanding: 0, dueCount: 0, reviewCount: 0 }), [rows]);

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

  const openReview = (row) => {
    setReviewFine(row);
    setReviewDecision('confirmed');
    setReviewAmount(Number(row.fine_amount || 0).toFixed(2));
    setReviewNote('');
    setFeedback({ error: '', message: '' });
  };

  const submitReview = async (event) => {
    event.preventDefault();
    if (!reviewFine || saving) return;
    setSaving(true);
    setFeedback({ error: '', message: '' });
    const { error } = await supabase.rpc('resolve_fine_review', {
      p_request_id: reviewFine.request_id,
      p_decision: reviewDecision,
      p_approved_amount: reviewDecision === 'waived' ? 0 : Number(reviewAmount),
      p_note: reviewNote.trim(),
    });
    if (error) {
      setFeedback({ error: error.message || 'Unable to resolve this fine review.', message: '' });
      setSaving(false);
      return;
    }
    setReviewFine(null);
    setFeedback({ error: '', message: 'Fine review saved. The approved balance is now ready for payment recording.' });
    setSaving(false);
    await loadRows();
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">{libraryName || 'Administration'}</p>
          <h2 className="mt-1 text-2xl font-bold text-shelf-primary">Fine Payments</h2>
          <p className="mt-1 text-sm text-slate-600">Track outstanding library fines and record payments collected offline.</p>
        </div>
        <button type="button" onClick={() => void loadRows()} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Refresh</button>
      </header>

      {feedback.message && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{feedback.message}</p>}
      {loadError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Confirmed outstanding balance</p>
          <p className="mt-1 text-2xl font-bold text-shelf-primary">{peso(totals.confirmedOutstanding)}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-medium text-slate-500">Unpaid fine records</p>
          <p className="mt-1 text-2xl font-bold text-shelf-primary">{totals.dueCount}</p>
        </article>
        <article className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <p className="text-sm font-medium text-amber-800">Fines needing review</p>
          <p className="mt-1 text-2xl font-bold text-amber-900">{totals.reviewCount}</p>
        </article>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row">
        <label className="relative min-w-0 flex-1">
          <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search visitor, book, or library" className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-3 text-sm text-slate-800" />
        </label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter fines by status" className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800">
          {['All', 'Unpaid', 'Partially paid', 'Paid', 'Needs review'].map((status) => <option key={status}>{status}</option>)}
        </select>
      </div>

      {loading ? <p role="status" className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading fine records…</p> : visibleRows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">No fine records match this filter.</div>
      ) : (
        <div className="space-y-3">
          {visibleRows.map((row) => {
            const status = getFineStatus(row);
            const history = Array.isArray(row.payments) ? row.payments : [];
            return (
              <article key={row.request_id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-slate-900">{row.visitor_name}</h3>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status === 'Paid' ? 'bg-emerald-100 text-emerald-800' : status === 'Needs review' ? 'bg-amber-100 text-amber-900' : status === 'Partially paid' ? 'bg-blue-100 text-blue-800' : 'bg-red-100 text-red-800'}`}>{status}</span>
                    </div>
                    <p className="mt-1 break-words text-sm text-slate-700">{row.book_title}</p>
                    <p className="mt-1 text-xs text-slate-500">{row.library_name} · Due {row.due_date ? new Date(row.due_date).toLocaleDateString('en-PH') : 'Date unavailable'} · Request {row.request_id}</p>
                    {row.fine_review_required && <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-800"><AlertTriangle size={14} /> Review the fine before accepting payment.</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-sm lg:min-w-64">
                    <span className="text-slate-500">Fine</span><strong className="text-right text-slate-800">{peso(row.fine_amount)}</strong>
                    <span className="text-slate-500">Paid</span><strong className="text-right text-emerald-700">{peso(row.fine_paid_amount)}</strong>
                    <span className="font-semibold text-slate-700">Balance</span><strong className="text-right font-bold text-red-700">{peso(row.outstanding_amount)}</strong>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {history.length > 0 && <button type="button" onClick={() => setHistoryFor(historyFor === row.request_id ? null : row.request_id)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><History size={16} /> History ({history.length})</button>}
                    {row.fine_review_required && <button type="button" onClick={() => openReview(row)} className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"><ClipboardCheck size={16} /> Review fine</button>}
                    {Number(row.outstanding_amount) > 0 && !row.fine_review_required && <button type="button" onClick={() => openPayment(row)} className="inline-flex items-center gap-2 rounded-lg bg-shelf-primary px-3 py-2 text-sm font-semibold text-white hover:bg-shelf-primary/90"><CircleDollarSign size={16} /> Record payment</button>}
                    {status === 'Paid' && <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800"><CheckCircle2 size={16} /> Settled</span>}
                  </div>
                </div>
                {historyFor === row.request_id && <ol className="mt-4 space-y-2 border-t border-slate-100 pt-3">{history.map((payment) => <li key={payment.id} className="flex flex-wrap justify-between gap-2 text-xs text-slate-600"><span><strong className="text-slate-800">{peso(payment.amount)}</strong> · {String(payment.paymentMethod || '').replace('_', ' ')}{payment.referenceNumber ? ` · Ref ${payment.referenceNumber}` : ''}{payment.note ? ` · ${payment.note}` : ''}</span><span>{payment.receivedBy} · {new Date(payment.receivedAt).toLocaleString('en-PH')}</span></li>)}</ol>}
              </article>
            );
          })}
        </div>
      )}

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

      {reviewFine && <div className="fixed inset-0 z-[105] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setReviewFine(null); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="fine-review-dialog-title" className="my-auto w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-amber-800">Fine verification</p><h3 id="fine-review-dialog-title" className="mt-1 text-xl font-bold text-slate-900">Review fine</h3><p className="mt-1 text-sm text-slate-600">{reviewFine.visitor_name} · {reviewFine.book_title}</p></div><button type="button" onClick={() => setReviewFine(null)} disabled={saving} aria-label="Close fine review" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X size={18} /></button></div>
          <form onSubmit={submitReview} className="mt-5 space-y-4">
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">This fine needs verification before staff can record payment. The visitor’s balance will update after you save the review.</p>
            <label className="block text-sm font-semibold text-slate-700">Decision<select value={reviewDecision} onChange={(event) => setReviewDecision(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal"><option value="confirmed">Confirm the calculated fine</option><option value="adjusted">Set an adjusted fine</option>{isSuperAdmin && <option value="waived">Waive this fine</option>}</select></label>
            {reviewDecision !== 'waived' && <label className="block text-sm font-semibold text-slate-700">Approved fine amount<input type="number" min="0" step="0.01" required value={reviewAmount} onChange={(event) => setReviewAmount(event.target.value)} disabled={reviewDecision === 'confirmed'} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal disabled:bg-slate-100" /></label>}
            {reviewDecision === 'waived' && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">The balance will be set to ₱0. Only Super Admin can waive a fine.</p>}
            <label className="block text-sm font-semibold text-slate-700">Reason for this decision<textarea required minLength={3} maxLength={500} rows={3} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" placeholder="Explain what was verified or corrected" /></label>
            {feedback.error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{feedback.error}</p>}
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={() => setReviewFine(null)} disabled={saving} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Cancel</button><button type="submit" disabled={saving || reviewNote.trim().length < 3 || (reviewDecision !== 'waived' && (!Number.isFinite(Number(reviewAmount)) || Number(reviewAmount) < 0))} className="rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save review'}</button></div>
          </form>
        </section>
      </div>}
    </section>
  );
}
