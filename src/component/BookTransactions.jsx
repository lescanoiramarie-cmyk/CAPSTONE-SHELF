import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLibraryData, useLibrary } from '../context/LibraryContext';
import QrScanner from './QrScanner';

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function BookTransactions() {
  const { user } = useAuth();
  const { borrowRequests } = useLibraryData();
  const { findVisitorByQr, confirmPickup, confirmReturn } = useLibrary();

  const [mode, setMode] = useState('borrowing'); // 'borrowing' | 'returning'
  const [scannedVisitor, setScannedVisitor] = useState(null);
  const [message, setMessage] = useState('');

  const handleScan = (code) => {
    const visitor = findVisitorByQr(code);
    if (!visitor) {
      setMessage('QR code not recognized. Please check the visitor pass and try again.');
      setScannedVisitor(null);
      return;
    }
    setScannedVisitor(visitor);
    setMessage('');
  };

  const visitorRequests = scannedVisitor
    ? borrowRequests.filter(
        (r) => r.visitorId === scannedVisitor.id && r.status === (mode === 'borrowing' ? 'ready_for_pickup' : 'borrowed')
      )
    : [];

  const handleConfirmPickup = (requestId) => {
    try {
      confirmPickup(requestId, user.name);
      setMessage('Pickup confirmed — the book is now marked as borrowed in real time.');
    } catch (err) {
      setMessage(err.message);
    }
  };

  const handleConfirmReturn = (requestId) => {
    try {
      confirmReturn(requestId, user.name);
      setMessage('Return confirmed — the copy is now available again, and the queue was updated.');
    } catch (err) {
      setMessage(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[
          { id: 'borrowing', label: 'Book Borrowing' },
          { id: 'returning', label: 'Book Returning' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setMode(t.id);
              setScannedVisitor(null);
              setMessage('');
            }}
            className={`px-4 py-2 text-sm font-bold rounded-lg transition ${
              mode === t.id ? 'bg-[#002046] text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-800 mb-1">
            Step 1 — Scan Visitor QR (for attendance verification)
          </h3>
          <p className="text-xs text-slate-500 mb-3">
            The visitor should already have scanned in at the entrance. Scan their pass again here to pull up their{' '}
            {mode === 'borrowing' ? 'pending pickup requests' : 'active borrowed items'}.
          </p>
          <QrScanner onScan={handleScan} />
        </div>

        {message && (
          <div className="text-xs font-semibold bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2">
            {message}
          </div>
        )}

        {scannedVisitor && (
          <div className="border-t border-slate-100 pt-4 space-y-3">
            <h3 className="text-sm font-bold text-slate-800">
              Step 2 — Confirm {mode === 'borrowing' ? 'Borrowing' : 'Return'} for {scannedVisitor.fullName}
            </h3>

            {visitorRequests.length === 0 ? (
              <p className="text-xs text-slate-500">
                No {mode === 'borrowing' ? 'pending pickup requests' : 'active borrowed items'} found for this visitor.
              </p>
            ) : (
              <div className="space-y-2">
                {visitorRequests.map((r) => (
                  <div key={r.id} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{r.bookTitle}</p>
                      <p className="text-xs text-slate-500">
                        {mode === 'borrowing'
                          ? `Hold expires: ${formatDateTime(r.pickupDeadline)}`
                          : `Due: ${formatDateTime(r.dueDate)}`}
                      </p>
                    </div>
                    <button
                      onClick={() => (mode === 'borrowing' ? handleConfirmPickup(r.id) : handleConfirmReturn(r.id))}
                      className="bg-emerald-700 text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-emerald-800 transition"
                    >
                      {mode === 'borrowing' ? 'Confirm Borrowing' : 'Confirm Return'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
