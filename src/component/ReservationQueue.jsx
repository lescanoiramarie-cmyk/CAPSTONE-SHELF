import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { BookOpen, Clock3, UsersRound } from 'lucide-react';
import { useLibraryData } from '../context/useLibrary.js';
import PageJump from './PageJump.jsx';

function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

function Stat({ label, value, description, Icon, tone }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <span className={`rounded-lg p-2.5 ${tone}`}><Icon size={18} aria-hidden="true" /></span>
      <div><p className="text-xs font-semibold text-slate-500 dark:text-slate-300">{label}</p><p className="mt-0.5 text-xl font-bold text-slate-900 dark:text-white">{value}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</p></div>
    </div>
  );
}

function PagedList({ items, label, focusRequestId, children }) {
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pages);
  const focusIndex = focusRequestId ? items.findIndex((item) => String(item.id) === String(focusRequestId) || item.queue?.some((request) => String(request.id) === String(focusRequestId))) : -1;
  useEffect(() => {
    if (focusIndex < 0) return undefined;
    const frame = requestAnimationFrame(() => setPage(Math.floor(focusIndex / pageSize) + 1));
    return () => cancelAnimationFrame(frame);
  }, [focusIndex, focusRequestId]);
  return <>
    {children(items.slice((current - 1) * pageSize, current * pageSize))}
    {items.length > pageSize && <nav aria-label={`${label} pages`} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-sm dark:border-slate-700">
      <span className="text-slate-600 dark:text-slate-300">Showing {(current - 1) * pageSize + 1}–{Math.min(current * pageSize, items.length)} of {items.length}</span>
      <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={current === 1} onClick={() => setPage(current - 1)} className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-40 dark:border-slate-600">Previous</button><PageJump page={current} pageCount={pages} onPageChange={setPage} className="dark:text-slate-200" /><button type="button" disabled={current === pages} onClick={() => setPage(current + 1)} className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-40 dark:border-slate-600">Next</button></div>
    </nav>}
  </>;
}

async function fetchAllReservations(rpcName) {
  const pageSize = 500;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.rpc(rpcName).range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < pageSize) return rows;
  }
}

export default function ReservationQueue({ user, focusRequestId = null }) {
  const { books, borrowRequests } = useLibraryData();
  const [reservations, setReservations] = useState([]);
  const [rejectedReservations, setRejectedReservations] = useState([]);
  const [reservationError, setReservationError] = useState('');
  const [reservationLoading, setReservationLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState(null);
  const loadReservations = useCallback(async () => {
    try {
      const [active, rejected] = await Promise.all([
        fetchAllReservations('get_staff_scheduled_reservations'),
        fetchAllReservations('get_staff_rejected_reservations'),
      ]);
      setReservations(active); setRejectedReservations(rejected); setReservationError('');
    } catch (error) { setReservationError(error?.message || 'Unable to load reservations.'); }
    setReservationLoading(false);
  }, []);
  useEffect(() => {
    void Promise.resolve().then(loadReservations);
    const channel = supabase.channel('staff-scheduled-reservations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'borrow_requests' }, () => { void loadReservations(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadReservations]);
  const reviewReservation = async (reservation, decision) => {
    setReviewingId(reservation.id); setReservationError('');
    const { error } = await supabase.rpc('decide_library_reservation', { p_request_id: reservation.id, p_decision: decision });
    if (error) setReservationError(error.message || 'Unable to review this reservation.');
    else await loadReservations();
    setReviewingId(null);
  };

  const isSubAdmin = user?.role === 'subadmin';
  const branchId = user?.libraryId || user?.assignedBranch;
  const branchBooks = books.filter((book) => !isSubAdmin || String(book.libraryId || book.library_id) === String(branchId));
  const branchBookIds = new Set(branchBooks.map((book) => String(book.id)));
  const branchRequests = borrowRequests.filter((request) => !isSubAdmin || branchBookIds.has(String(request.bookId || request.book_id)));
  const readyForPickup = branchRequests
    .filter((request) => request.status === 'ready_for_pickup')
    .sort((a, b) => new Date(a.pickupDeadline || a.pickup_deadline) - new Date(b.pickupDeadline || b.pickup_deadline));
  const booksWithQueue = branchBooks
    .map((book) => ({
      book,
      queue: branchRequests
        .filter((request) => String(request.bookId || request.book_id) === String(book.id) && request.status === 'queued')
        .sort((a, b) => (a.queuePosition || a.queue_position || 0) - (b.queuePosition || b.queue_position || 0)),
    }))
    .filter(({ queue }) => queue.length > 0);
  const queuedVisitors = booksWithQueue.reduce((total, item) => total + item.queue.length, 0) + reservations.length;
  const queueTitles = new Set([...booksWithQueue.map(({ book }) => String(book.id)), ...reservations.map((reservation) => String(reservation.book_id))]).size;
  const pendingReview = reservations.filter((reservation) => reservation.status === 'pending_reservation').length;
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">Circulation</p>
          <h2 className="mt-1 text-2xl font-bold text-shelf-primary">Reservation queue</h2>
          <p className="mt-1 text-sm text-slate-600">Track approved pickups and visitors waiting for a copy.</p>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">Branch activity</span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Pending review" value={pendingReview} description="Reservations awaiting a decision" Icon={Clock3} tone="bg-amber-50 text-amber-700" />
        <Stat label="Ready for pickup" value={readyForPickup.length} description="Copies awaiting collection" Icon={BookOpen} tone="bg-emerald-50 text-emerald-700" />
        <Stat label="Requests in queues" value={queuedVisitors} description="Scheduled reservations and waitlists" Icon={UsersRound} tone="bg-blue-50 text-blue-700" />
        <Stat label="Titles with a queue" value={queueTitles} description="Titles with reservations or waitlists" Icon={BookOpen} tone="bg-violet-50 text-violet-700" />
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="scheduled-reservations-title">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div><h3 id="scheduled-reservations-title" className="text-base font-bold text-slate-900">Scheduled reservations</h3><p className="mt-1 text-sm text-slate-500">Review requests and track each book's reservation queue.</p></div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-800">{reservations.length} reservations</span>
        </div>
        {reservationError && <p role="alert" className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{reservationError} <button type="button" onClick={() => void loadReservations()} className="underline">Retry</button></p>}
        {reservationLoading ? <p className="p-5 text-sm text-slate-500">Loading reservations...</p> : reservations.length === 0 ? <p className="p-5 text-sm text-slate-500">No scheduled reservations.</p> : <PagedList items={reservations} label="Scheduled reservation" focusRequestId={focusRequestId}>{(items) => <ol className="divide-y divide-slate-100">
          {items.map((reservation) => <li key={reservation.id} id={`reservation-queue-request-${reservation.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="min-w-0"><p className="font-bold text-slate-900">{reservation.book_title}</p><p className="mt-1 text-sm text-slate-600">Visitor: {reservation.visitor_name}</p><p className="mt-1 text-sm text-slate-600">Pickup date: {new Date(`${reservation.scheduled_pickup_date}T00:00:00`).toLocaleDateString('en-PH', { dateStyle: 'medium' })} - Queue #{reservation.reservation_position}</p></div>
            <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">{reservation.status === 'pending_reservation' ? 'Pending approval' : 'Approved'}</span>
              {reservation.status === 'pending_reservation' && <><button type="button" disabled={Boolean(reviewingId)} onClick={() => void reviewReservation(reservation, 'approved')} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Approve</button><button type="button" disabled={Boolean(reviewingId)} onClick={() => void reviewReservation(reservation, 'rejected')} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">Reject</button></>}
            </div>
          </li>)}
        </ol>}</PagedList>}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="rejected-reservations-title">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div><h3 id="rejected-reservations-title" className="text-base font-bold text-slate-900">Rejected reservations</h3><p className="mt-1 text-sm text-slate-500">Reservation requests declined by library staff.</p></div>
          <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-800">{rejectedReservations.length} rejected</span>
        </div>
        {reservationLoading ? <p className="p-5 text-sm text-slate-500">Loading reservations...</p> : rejectedReservations.length === 0 ? <p className="p-5 text-sm text-slate-500">No rejected reservations.</p> : <PagedList items={rejectedReservations} label="Rejected reservation">{(items) => <ol className="divide-y divide-slate-100">
          {items.map((reservation) => <li key={reservation.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="min-w-0"><p className="font-bold text-slate-900">{reservation.book_title}</p><p className="mt-1 text-sm text-slate-600">Visitor: {reservation.visitor_name}</p><p className="mt-1 text-sm text-slate-600">Requested pickup: {new Date(`${reservation.scheduled_pickup_date}T00:00:00`).toLocaleDateString('en-PH', { dateStyle: 'medium' })}</p></div>
            <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-800">Rejected</span>
          </li>)}
        </ol>}</PagedList>}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div><h3 className="text-base font-bold text-slate-900">Ready for pickup</h3><p className="mt-1 text-sm text-slate-500">Approved holds with a pickup deadline.</p></div>
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">{readyForPickup.length} waiting</span>
        </div>
        {readyForPickup.length === 0 ? (
          <div className="px-5 py-10 text-center"><span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-500"><Clock3 size={20} /></span><p className="mt-3 text-sm font-semibold text-slate-800">No pending pickups</p><p className="mt-1 text-xs text-slate-500">Approved holds will appear here until they are collected or expire.</p></div>
        ) : (
          <PagedList items={readyForPickup} label="Ready for pickup" focusRequestId={focusRequestId}>{(items) => <div className="divide-y divide-slate-100">
            {items.map((request) => <article key={request.id} id={`reservation-queue-request-${request.id}`} className={`grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.7fr)_auto] sm:items-center ${String(request.id) === String(focusRequestId) ? 'bg-amber-50 ring-2 ring-inset ring-amber-400' : 'hover:bg-slate-50/70'}`}>
              <div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-800"><BookOpen size={18} /></span><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{request.bookTitle || 'Book title unavailable'}</p><p className="mt-0.5 text-xs text-slate-500">Visitor: {request.visitorName || 'Unknown visitor'}</p></div></div>
              <p className="text-sm text-slate-600"><span className="text-xs text-slate-500">Pickup deadline</span><br /><span className="font-semibold tabular-nums text-amber-800">{formatDateTime(request.pickupDeadline || request.pickup_deadline)}</span></p>
              <span className="w-fit rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">Ready</span>
            </article>)}
          </div>}</PagedList>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div><h3 className="text-base font-bold text-slate-900">Waiting lists</h3><p className="mt-1 text-sm text-slate-500">Visitors are shown in the order they will be offered a copy.</p></div>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-800">{booksWithQueue.length} titles</span>
        </div>
        {booksWithQueue.length === 0 ? (
          <div className="px-5 py-10 text-center"><span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-500"><UsersRound size={20} /></span><p className="mt-3 text-sm font-semibold text-slate-800">No waiting lists</p><p className="mt-1 text-xs text-slate-500">A list appears when no copy is currently available for a requested title.</p></div>
        ) : (
          <PagedList items={booksWithQueue} label="Waiting list" focusRequestId={focusRequestId}>{(items) => <div className="grid gap-4 p-4 lg:grid-cols-2">
            {items.map(({ book, queue }) => <article key={book.id} className="overflow-hidden rounded-xl border border-slate-200">
              <div className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3"><div className="flex min-w-0 items-center gap-2"><BookOpen size={16} className="shrink-0 text-shelf-primary" /><p className="truncate text-sm font-bold text-slate-900">{book.title}</p></div><span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">{queue.length} waiting</span></div>
              <PagedList items={queue} label={`${book.title} queue`} focusRequestId={focusRequestId}>{(queueItems) => <ol className="divide-y divide-slate-100">{queueItems.map((request) => <li key={request.id} id={`reservation-queue-request-${request.id}`} className={`grid grid-cols-[2rem_minmax(0,1fr)] gap-2 px-4 py-3 text-sm text-slate-700 ${String(request.id) === String(focusRequestId) ? 'bg-amber-50 ring-2 ring-inset ring-amber-400' : ''}`}>
                <span className="grid h-7 w-7 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-800">{request.queuePosition || request.queue_position || '—'}</span><div className="min-w-0"><p className="truncate font-semibold">{request.visitorName || 'Unknown visitor'}</p><p className="mt-0.5 text-xs text-slate-500">Requested {formatDateTime(request.requestDate || request.request_date)}</p></div>
              </li>)}</ol>}</PagedList>
            </article>)}
          </div>}</PagedList>
        )}
      </section>
    </div>
  );
}
