import { useLibraryData } from '../context/LibraryContext';

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function ReservationQueue() {
  const { books, borrowRequests } = useLibraryData();

  const readyForPickup = borrowRequests
    .filter((r) => r.status === 'ready_for_pickup')
    .sort((a, b) => new Date(a.pickupDeadline) - new Date(b.pickupDeadline));

  const booksWithQueue = books
    .map((b) => ({
      book: b,
      queue: borrowRequests
        .filter((r) => r.bookId === b.id && r.status === 'queued')
        .sort((a, b2) => (a.queuePosition || 0) - (b2.queuePosition || 0)),
    }))
    .filter((x) => x.queue.length > 0);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-800">Pending Pickups</h3>
          <p className="text-xs text-slate-500">Holds waiting for the visitor to arrive and scan in before the window expires.</p>
        </div>
        {readyForPickup.length === 0 ? (
          <p className="p-5 text-xs text-slate-500">No pending pickups right now.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="p-3">Book</th>
                <th className="p-3">Visitor</th>
                <th className="p-3">Pickup Deadline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {readyForPickup.map((r) => (
                <tr key={r.id}>
                  <td className="p-3 font-semibold text-slate-700">{r.bookTitle}</td>
                  <td className="p-3 text-xs text-slate-500">{r.visitorName}</td>
                  <td className="p-3 text-xs font-mono text-amber-700">{formatDateTime(r.pickupDeadline)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-800">Reservation Queues</h3>
          <p className="text-xs text-slate-500">Visitors waiting for a copy to become available, in order.</p>
        </div>
        {booksWithQueue.length === 0 ? (
          <p className="p-5 text-xs text-slate-500">No reservation queues right now.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {booksWithQueue.map(({ book, queue }) => (
              <div key={book.id} className="p-4">
                <p className="text-sm font-bold text-slate-800">{book.title}</p>
                <ol className="mt-2 space-y-1">
                  {queue.map((r) => (
                    <li key={r.id} className="text-xs text-slate-600 flex justify-between">
                      <span>#{r.queuePosition} — {r.visitorName}</span>
                      <span className="text-slate-400">{formatDateTime(r.requestDate)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
