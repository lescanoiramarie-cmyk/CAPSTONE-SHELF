import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Building2, CalendarDays, Clock3, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';

const today = () => new Date().toISOString().slice(0, 10);
const dateLabel = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Not set';
const statusLabel = (value) => ({ not_configured: 'Not configured', trial: 'Trial', active: 'Active', expiring: 'Expiring', past_due: 'Past due', suspended: 'Suspended' }[value] || value || 'Not configured');
const statusStyle = (value) => value === 'active' || value === 'trial' ? 'bg-emerald-100 text-emerald-800' : value === 'expiring' ? 'bg-amber-100 text-amber-900' : value === 'past_due' || value === 'suspended' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700';
const FEATURES = {
  basic: ['Inventory and book circulation', 'Visitor accounts and attendance', 'Core library operations'],
  premium: ['Everything in Basic', 'Advanced reports and analytics', 'SMS reminders (available when an SMS provider is configured)'],
};

function SubscriptionEditor({ row, onClose, onSaved }) {
  const [form, setForm] = useState({
    plan: row.plan_key || 'basic', mode: row.plan_mode || 'trial', period: row.billing_period || 'monthly',
    starts: row.starts_on || today(), renews: row.renews_on || today(), grace: String(row.grace_period_days ?? 7),
    paid: row.is_paid === true, paidAt: row.paid_at || today(), note: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const save = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    const { error: rpcError } = await supabase.rpc('update_library_subscription', {
      p_library_id: row.library_id, p_plan_key: form.plan, p_plan_mode: form.mode,
      p_billing_period: form.period, p_starts_on: form.starts, p_renews_on: form.renews,
      p_grace_period_days: Number(form.grace), p_is_paid: form.paid,
      p_paid_at: form.paid ? form.paidAt : null, p_note: form.note.trim() || null,
    });
    if (rpcError) { setError(rpcError.message || 'Unable to save subscription.'); setBusy(false); return; }
    await onSaved(); onClose();
  };
  const field = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800';
  return <div className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4"><section role="dialog" aria-modal="true" aria-labelledby="subscription-editor-title" className="my-auto max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
    <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wider text-blue-700">Library subscription</p><h3 id="subscription-editor-title" className="mt-1 text-xl font-bold text-slate-900">{row.library_name}</h3><p className="mt-1 text-sm text-slate-600">Record the plan and renewal. No payment method or reference is collected.</p></div><button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">Close</button></div>
    <form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-semibold text-slate-700">Plan<select className={field} value={form.plan} onChange={(e) => update('plan', e.target.value)}><option value="basic">Basic</option><option value="premium">Premium</option></select></label>
      <label className="text-sm font-semibold text-slate-700">Status<select className={field} value={form.mode} onChange={(e) => update('mode', e.target.value)}><option value="trial">Trial</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
      <label className="text-sm font-semibold text-slate-700">Billing period<select className={field} value={form.period} onChange={(e) => update('period', e.target.value)}><option value="monthly">Monthly</option><option value="annual">Annual</option></select></label>
      <label className="text-sm font-semibold text-slate-700">Grace period (days)<input className={field} type="number" min="0" max="60" value={form.grace} onChange={(e) => update('grace', e.target.value)} /></label>
      <label className="text-sm font-semibold text-slate-700">Subscription starts<input required type="date" className={field} value={form.starts} onChange={(e) => update('starts', e.target.value)} /></label>
      <label className="text-sm font-semibold text-slate-700">Renewal due date<input required type="date" className={field} value={form.renews} onChange={(e) => update('renews', e.target.value)} /></label>
      <div className="sm:col-span-2 rounded-xl border border-blue-100 bg-blue-50/70 p-4"><label className="flex items-center gap-3 text-sm font-semibold text-slate-800"><input type="checkbox" checked={form.paid} onChange={(e) => update('paid', e.target.checked)} />Paid for the current subscription period</label>{form.paid && <label className="mt-3 block text-sm font-semibold text-slate-700">Date received<input required type="date" className={field} value={form.paidAt} onChange={(e) => update('paidAt', e.target.value)} /></label>}</div>
      <label className="sm:col-span-2 text-sm font-semibold text-slate-700">Admin note <span className="font-normal text-slate-500">(optional)</span><textarea rows={2} maxLength={500} className={field} value={form.note} onChange={(e) => update('note', e.target.value)} placeholder="Context for this subscription change" /></label>
      {error && <p role="alert" className="sm:col-span-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="sm:col-span-2 flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold">Cancel</button><button disabled={busy} className="rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Saving…' : 'Save subscription'}</button></div>
    </form>
  </section></div>;
}

export default function SubscriptionManagement({ mode = 'subadmin', libraryId = null, libraryName = '' }) {
  const isSuperAdmin = mode === 'superadmin';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [requestPlan, setRequestPlan] = useState('premium');
  const [requestNote, setRequestNote] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');
  const [filter, setFilter] = useState('');
  const reload = useCallback(async () => {
    setLoading(true); setError('');
    const { data, error: rpcError } = await supabase.rpc('get_library_subscription_dashboard', { p_library_id: libraryId ? String(libraryId) : null });
    if (rpcError) { setError(rpcError.message || 'Unable to load subscriptions.'); setRows([]); }
    else setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [libraryId]);
  useEffect(() => { void reload(); }, [reload]);
  const displayed = useMemo(() => rows.filter((row) => !filter || `${row.library_name} ${(row.sub_admin_names || []).join(' ')}`.toLowerCase().includes(filter.toLowerCase())), [rows, filter]);
  const renewalAlerts = rows.filter((row) => ['expiring', 'past_due', 'suspended'].includes(row.effective_status));
  const requestUpgrade = async (event) => {
    event.preventDefault(); setBusyId('request'); setError(''); setMessage('');
    const { error: rpcError } = await supabase.rpc('request_subscription_upgrade', { p_requested_plan: requestPlan, p_note: requestNote.trim() || null });
    if (rpcError) setError(rpcError.message || 'Unable to send request.');
    else { setMessage('Upgrade request sent to Super Admin.'); setRequestNote(''); await reload(); }
    setBusyId('');
  };
  const decide = async (request, decision) => {
    setBusyId(request.id); setError('');
    const { error: rpcError } = await supabase.rpc('decide_subscription_upgrade', { p_request_id: request.id, p_decision: decision, p_note: null });
    if (rpcError) setError(rpcError.message || 'Unable to update request.');
    else { setMessage(`Upgrade request ${decision}. Assign the approved plan in subscription settings when ready.`); await reload(); }
    setBusyId('');
  };
  const rowsToShow = isSuperAdmin ? displayed : rows;
  const heading = isSuperAdmin ? 'Subscriptions' : 'Plan & Subscription';
  return <section className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">{isSuperAdmin ? 'System administration' : libraryName || 'Library administration'}</p><h2 className="mt-1 text-2xl font-bold text-shelf-primary">{heading}</h2><p className="mt-1 max-w-3xl text-sm text-slate-600">{isSuperAdmin ? 'Manage each library’s plan, renewal, grace period, and manually recorded paid status.' : 'View your library plan and request an upgrade from Super Admin.'}</p></div><button type="button" onClick={() => void reload()} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"><RefreshCw size={15} />Refresh</button></header>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}{message && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    {isSuperAdmin && renewalAlerts.length > 0 && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-bold">Subscription follow-up needed for {renewalAlerts.length} {renewalAlerts.length === 1 ? 'library' : 'libraries'}</p><p className="mt-1">{renewalAlerts.map((row) => `${row.library_name} (${statusLabel(row.effective_status).toLowerCase()}${row.renews_on ? ` · due ${dateLabel(row.renews_on)}` : ''})`).join(' · ')}</p></div>}
    {isSuperAdmin && <label className="block"><span className="sr-only">Search libraries</span><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search library or Sub Admin" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm" /></label>}
    {loading ? <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading subscriptions…</p> : rowsToShow.length === 0 ? <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">No subscription information is available yet.</div> : <div className="space-y-4">{rowsToShow.map((row) => {
      const status = row.effective_status || 'not_configured';
      const history = Array.isArray(row.subscription_history) ? row.subscription_history : [];
      const upgrades = Array.isArray(row.upgrade_requests) ? row.upgrade_requests : [];
      const paidLabel = row.is_paid ? `Paid${row.paid_at ? ` on ${dateLabel(row.paid_at)}` : ''}` : 'Not recorded as paid';
      return <article key={row.library_id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Building2 size={18} className="text-blue-700"/><h3 className="font-bold text-slate-900">{row.library_name}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusStyle(status)}`}>{statusLabel(status)}</span></div><p className="mt-1 text-sm text-slate-500">Sub Admin: {(row.sub_admin_names || []).join(', ') || 'Not assigned'}</p></div>{isSuperAdmin && <button type="button" onClick={() => setSelected(row)} className="shrink-0 rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-semibold text-white">{row.plan_key ? 'Manage subscription' : 'Set up subscription'}</button>}</div>
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4 sm:p-5"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Plan</p><p className="mt-1 font-semibold capitalize text-slate-900">{row.plan_key || 'Not assigned'}{row.billing_period ? ` · ${row.billing_period}` : ''}</p></div><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Paid status</p><p className={`mt-1 font-semibold ${row.is_paid ? 'text-emerald-700' : 'text-amber-800'}`}>{paidLabel}</p></div><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Subscription start</p><p className="mt-1 font-medium text-slate-800">{dateLabel(row.starts_on)}</p></div><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Renewal due</p><p className="mt-1 font-medium text-slate-800">{dateLabel(row.renews_on)}</p></div></div>
        <div className="border-t border-slate-100 bg-slate-50/70 p-4 sm:px-5"><p className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Sparkles size={16} className="text-blue-700" />{row.plan_key === 'premium' ? 'Premium features' : 'Basic features'}</p><ul className="mt-2 grid gap-1.5 text-sm text-slate-600 sm:grid-cols-2">{FEATURES[row.plan_key] ? FEATURES[row.plan_key].map((feature) => <li key={feature} className="flex gap-2"><BadgeCheck size={15} className="mt-0.5 shrink-0 text-emerald-700" />{feature}</li>) : FEATURES.basic.map((feature) => <li key={feature} className="flex gap-2"><BadgeCheck size={15} className="mt-0.5 shrink-0 text-slate-400" />{feature}</li>)}</ul>{row.plan_key === 'premium' && <p className="mt-2 text-xs text-slate-500">SMS reminders require an SMS provider configuration before they can be sent.</p>}</div>
        {upgrades.length > 0 && isSuperAdmin && <div className="border-t border-slate-100 p-4 sm:px-5"><h4 className="font-semibold text-slate-900">Upgrade requests</h4><div className="mt-2 space-y-2">{upgrades.map((request) => <div key={request.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="text-sm"><p className="font-semibold text-slate-800">{request.requestedBy} requested <span className="capitalize">{request.requestedPlan}</span> · <span className="capitalize">{request.status}</span></p><p className="text-xs text-slate-500">{request.note || 'No note'} · {dateLabel(String(request.requestedAt || '').slice(0, 10))}</p></div>{request.status === 'pending' && <div className="flex gap-2"><button type="button" disabled={!!busyId} onClick={() => void decide(request, 'approved')} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Approve</button><button type="button" disabled={!!busyId} onClick={() => void decide(request, 'rejected')} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">Reject</button></div>}</div>)}</div></div>}
        {!isSuperAdmin && upgrades.length > 0 && <div className="border-t border-slate-100 p-4 sm:px-5"><h4 className="font-semibold text-slate-900">Upgrade request status</h4><ul className="mt-2 space-y-2">{upgrades.map((request) => <li key={request.id} className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><span className="font-semibold capitalize">{request.requestedPlan} · {request.status}</span>{request.decisionNote ? ` · ${request.decisionNote}` : ''}<span className="block text-xs text-slate-500">Requested {new Date(request.requestedAt).toLocaleDateString('en-PH')}{request.decidedAt ? ` · reviewed ${new Date(request.decidedAt).toLocaleDateString('en-PH')}` : ''}</span></li>)}</ul></div>}
        {history.length > 0 && <details className="border-t border-slate-100 p-4 sm:px-5"><summary className="cursor-pointer text-sm font-semibold text-slate-700"><Clock3 size={15} className="mr-2 inline" />Subscription history ({history.length})</summary><ol className="mt-3 space-y-2">{history.map((entry, i) => <li key={`${entry.createdAt}-${i}`} className="text-xs text-slate-600"><span className="font-semibold text-slate-800">{String(entry.eventType).replaceAll('_', ' ')}</span> · {entry.changedBy} · {new Date(entry.createdAt).toLocaleString('en-PH')}{entry.details?.note ? ` · ${entry.details.note}` : ''}</li>)}</ol></details>}
      </article>;
    })}</div>}
    {!isSuperAdmin && rows[0] && <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]"><form onSubmit={requestUpgrade} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-bold text-slate-900">Request an upgrade</h3><p className="mt-1 text-sm text-slate-600">Super Admin will review your request and update your library’s plan if approved.</p><div className="mt-4 flex flex-col gap-3 sm:flex-row"><select aria-label="Requested plan" value={requestPlan} onChange={(e) => setRequestPlan(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="premium">Premium</option><option value="basic">Basic</option></select><input value={requestNote} onChange={(e) => setRequestNote(e.target.value)} maxLength={500} placeholder="Optional reason" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm"/><button disabled={busyId === 'request'} className="rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Send request</button></div></form><aside className="rounded-xl border border-blue-100 bg-blue-50/70 p-5"><h3 className="flex items-center gap-2 font-bold text-slate-900"><ShieldCheck size={17} className="text-blue-700"/>Subscription access</h3><p className="mt-2 text-sm text-slate-700">If Premium expires or is suspended, core circulation and inventory operations remain available. Premium tools can be restricted according to the library’s subscription status.</p><p className="mt-2 flex items-center gap-2 text-xs text-slate-500"><CalendarDays size={14}/>Renewal and payment records are managed by Super Admin.</p></aside></div>}
    {isSuperAdmin && rows.length > 0 && <p className="text-xs text-slate-500">A grace period is applied before a past-due subscription is suspended. Refresh this page to check current renewal reminders.</p>}
    {selected && <SubscriptionEditor row={selected} onClose={() => setSelected(null)} onSaved={reload} />}
  </section>;
}
