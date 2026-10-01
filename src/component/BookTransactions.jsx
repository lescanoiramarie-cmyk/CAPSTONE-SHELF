import { useState } from 'react';
import { useAuth } from '../context/useAuth.js';
import { useLibraryData, useLibrary } from '../context/useLibrary.js';
import QrScanner from './QrScanner';

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function BookTransactions() {
  const { user } = useAuth();
  const { borrowRequests, books } = useLibraryData();
  const { findVisitorByQr, confirmPickup, confirmReturn } = useLibrary();

  const [mode, setMode] = useState('borrowing'); // 'borrowing' | 'returning'
  const [scannedVisitor, setScannedVisitor] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleScan = async (code) => {
    try {
      const visitor = await findVisitorByQr(code, libraryId);
      if (!visitor) {
        throw new Error('QR code not recognized. Please check the visitor pass and try again.');
      }
      setScannedVisitor(visitor);
      setMessage('');
      setError('');
    } catch (error) {
      setError(error.message || 'Unable to verify this visitor pass.');
      setScannedVisitor(null);
    }
  };

  const libraryId = user?.libraryId || user?.assignedBranch;
  const visitorRequests = scannedVisitor
    ? borrowRequests.filter(
        (request) => request.visitorId === scannedVisitor.id &&
          request.status === (mode === 'borrowing' ? 'ready_for_pickup' : 'borrowed') &&
          (user?.role !== 'subadmin' || books.some((book) => (
            book.id === request.bookId && book.libraryId === libraryId
          )))
      )
    : [];

  const handleConfirmPickup = async (requestId) => {
    try {
      await confirmPickup(requestId, user.name);
      setMessage('Pickup confirmed — the book is now marked as borrowed in real time.');
      setError('');
    } catch (err) {
      setError(err.message || 'Unable to confirm pickup.');
    }
  };

  const handleConfirmReturn = async (requestId) => {
    try {
      await confirmReturn(requestId, user.name);
      setMessage('Return confirmed — the copy is now available again, and the queue was updated.');
      setError('');
    } catch (err) {
      setError(err.message || 'Unable to confirm return.');
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
              setError('');
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
          <div role="status" className="text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-3 py-2">
            {message}
          </div>
        )}

        {error && (
          <div role="alert" className="text-xs font-semibold bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2">
            {error}
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
