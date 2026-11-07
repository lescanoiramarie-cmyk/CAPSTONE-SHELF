import { BookOpen, Clock3, UsersRound } from 'lucide-react';
import { useLibraryData } from '../context/useLibrary.js';

function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

function Stat({ label, value, Icon, tone }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <span className={`rounded-lg p-2.5 ${tone}`}><Icon size={18} aria-hidden="true" /></span>
      <div><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-0.5 text-xl font-bold text-slate-900">{value}</p></div>
    </div>
  );
}

export default function ReservationQueue({ user, focusRequestId = null }) {
  const { books, borrowRequests } = useLibraryData();
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
  const queuedVisitors = booksWithQueue.reduce((total, item) => total + item.queue.length, 0);
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

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Pending pickups" value={readyForPickup.length} Icon={Clock3} tone="bg-amber-50 text-amber-700" />
        <Stat label="Visitors in queues" value={queuedVisitors} Icon={UsersRound} tone="bg-blue-50 text-blue-700" />
        <Stat label="Titles with a queue" value={booksWithQueue.length} Icon={BookOpen} tone="bg-emerald-50 text-emerald-700" />
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div><h3 className="text-base font-bold text-slate-900">Ready for pickup</h3><p className="mt-1 text-sm text-slate-500">Approved holds with a pickup deadline.</p></div>
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">{readyForPickup.length} waiting</span>
        </div>
        {readyForPickup.length === 0 ? (
          <div className="px-5 py-10 text-center"><span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-500"><Clock3 size={20} /></span><p className="mt-3 text-sm font-semibold text-slate-800">No pending pickups</p><p className="mt-1 text-xs text-slate-500">Approved holds will appear here until they are collected or expire.</p></div>
        ) : (
          <div className="divide-y divide-slate-100">
            {readyForPickup.map((request) => <article key={request.id} id={`reservation-queue-request-${request.id}`} className={`grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.7fr)_auto] sm:items-center ${String(request.id) === String(focusRequestId) ? 'bg-amber-50 ring-2 ring-inset ring-amber-400' : 'hover:bg-slate-50/70'}`}>
              <div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-800"><BookOpen size={18} /></span><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{request.bookTitle || 'Book title unavailable'}</p><p className="mt-0.5 text-xs text-slate-500">Visitor: {request.visitorName || 'Unknown visitor'}</p></div></div>
              <p className="text-sm text-slate-600"><span className="text-xs text-slate-500">Pickup deadline</span><br /><span className="font-semibold tabular-nums text-amber-800">{formatDateTime(request.pickupDeadline || request.pickup_deadline)}</span></p>
              <span className="w-fit rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">Ready</span>
            </article>)}
          </div>
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
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            {booksWithQueue.map(({ book, queue }) => <article key={book.id} className="overflow-hidden rounded-xl border border-slate-200">
              <div className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3"><div className="flex min-w-0 items-center gap-2"><BookOpen size={16} className="shrink-0 text-shelf-primary" /><p className="truncate text-sm font-bold text-slate-900">{book.title}</p></div><span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">{queue.length} waiting</span></div>
              <ol className="divide-y divide-slate-100">{queue.map((request) => <li key={request.id} id={`reservation-queue-request-${request.id}`} className={`grid grid-cols-[2rem_minmax(0,1fr)] gap-2 px-4 py-3 text-sm text-slate-700 ${String(request.id) === String(focusRequestId) ? 'bg-amber-50 ring-2 ring-inset ring-amber-400' : ''}`}>
                <span className="grid h-7 w-7 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-800">{request.queuePosition || request.queue_position || '—'}</span><div className="min-w-0"><p className="truncate font-semibold">{request.visitorName || 'Unknown visitor'}</p><p className="mt-0.5 text-xs text-slate-500">Requested {formatDateTime(request.requestDate || request.request_date)}</p></div>
              </li>)}</ol>
            </article>)}
          </div>
        )}
      </section>
    </div>
  );
}
