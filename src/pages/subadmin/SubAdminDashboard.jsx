import { useEffect, useRef, useState, useMemo } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

import { useAuth } from '../../context/AuthContext.jsx';
import { useLibraryData } from '../../context/LibraryContext.jsx';

import AttendanceScanner from '../../component/AttendanceScanner.jsx';
import BookTransactions from '../../component/BookTransactions.jsx';
import BookInventory from '../../component/BookInventory.jsx';
import ReservationQueue from '../../component/ReservationQueue.jsx';

import { supabase } from '../../lib/supabaseClient.js';
import { exportToExcel, exportToCSV, parseImportFile } from '../../lib/excelUtils.js';
import {
  findVisitorByQr,
  confirmPickup,
} from '../../data/store.js';

const NAV = [
  { id: 'overview', label: '📊 Overview' },
  { id: 'attendance', label: '🪪 Attendance' },
  { id: 'transactions', label: '🔁 Book Transactions' },
  { id: 'inventory', label: '📚 Inventory' },
  { id: 'queue', label: '⏳ Reservation Queue' },
];

function StatCard({ label, value, tone = 'default' }) {
  const tones = {
    default: 'bg-white border-slate-200 text-slate-800',
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
    red: 'bg-red-50 border-red-200 text-red-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-800',
  };

  return (
    <div className={`rounded-xl border p-5 shadow-sm ${tones[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-wider opacity-70">
        {label}
      </p>

      <p className="text-3xl font-extrabold mt-1">
        {value}
      </p>
    </div>
  );
}

function formatDateTime(value) {
  if (!value) return '—';

  return new Date(value).toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function QRBookBorrowing({
  user,
  _borrowRequests,
  onBorrowConfirmed,
}) {
  const scannerRef = useRef(null);

  const [showScanner, setShowScanner] = useState(false);
  const [scanning, setScanning] = useState(false);

  const [visitor, setVisitor] = useState(null);
  const [visitorRequests, setVisitorRequests] = useState([]);

  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const stopScanner = async () => {
    try {
      if (scannerRef.current) {
        try {
          await scannerRef.current.stop();
        } catch {
          // Scanner may already be stopped.
        }

        try {
          await scannerRef.current.clear();
        } catch {
          // Scanner may already be cleared.
        }

        scannerRef.current = null;
      }
    } catch (err) {
      console.error('QR scanner cleanup error:', err);
    }

    setScanning(false);
    setShowScanner(false);
  };

  const startScanner = () => {
    setError('');
    setMessage('');
    setVisitor(null);
    setVisitorRequests([]);
    setShowScanner(true);
  };

  useEffect(() => {
    if (!showScanner) return;

    let cancelled = false;
    let scanner;

    const startCamera = async () => {
      try {
        setScanning(true);

        scanner = new Html5Qrcode('book-borrowing-qr-reader');
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: {
              width: 250,
              height: 250,
            },
            aspectRatio: 1,
          },
          async (decodedText) => {
            if (cancelled) return;

            const qrValue = decodedText.trim();

            if (!qrValue) return;

            try {
              await scanner.stop();
            } catch {
              // Ignore if already stopped.
            }

            try {
              await scanner.clear();
            } catch {
              // Ignore if already cleared.
            }

            scannerRef.current = null;

            setScanning(false);
            setShowScanner(false);

            await handleQrScan(qrValue);
          },
          () => {
            // Ignore unsuccessful scan attempts.
          }
        );
      } catch (err) {
        console.error('Unable to start QR scanner:', err);

        if (!cancelled) {
          setScanning(false);
          setError(
            'Unable to open the camera. Please allow camera access and try again.'
          );
        }
      }
    };

    startCamera();

    return () => {
      cancelled = true;

      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .catch(() => {})
          .finally(() => {
            scannerRef.current
              ?.clear()
              .catch(() => {});

            scannerRef.current = null;
          });
      }
    };
  }, [showScanner]);

  const handleQrScan = async (qrValue) => {
    setLoading(true);
    setError('');
    setMessage('');
    setVisitor(null);
    setVisitorRequests([]);

    try {
      const foundVisitor = await findVisitorByQr(qrValue);

      if (!foundVisitor) {
        throw new Error(
          'Visitor not found. Please scan a valid SHELF ILMS visitor QR code.'
        );
      }

      setVisitor(foundVisitor);

      const { data, error: requestError } = await supabase
        .from('borrow_requests')
        .select(
          `
            id,
            book_id,
            book_title,
            visitor_id,
            visitor_name,
            status,
            request_date,
            pickup_deadline,
            queue_position,
            borrow_date,
            due_date,
            return_date,
            fine_amount,
            confirmed_by,
            return_confirmed_by
          `
        )
        .eq('visitor_id', foundVisitor.id)
        .in('status', ['ready_for_pickup', 'borrowed'])
        .order('request_date', {
          ascending: false,
        });

      if (requestError) {
        throw requestError;
      }

      const requests = (data || []).map((r) => ({
        id: r.id,
        bookId: r.book_id,
        bookTitle: r.book_title,
        visitorId: r.visitor_id,
        visitorName: r.visitor_name,
        status: r.status,
        requestDate: r.request_date,
        pickupDeadline: r.pickup_deadline,
        queuePosition: r.queue_position,
        borrowDate: r.borrow_date,
        dueDate: r.due_date,
        returnDate: r.return_date,
        fineAmount: r.fine_amount,
        confirmedBy: r.confirmed_by,
        returnConfirmedBy: r.return_confirmed_by,
      }));

      setVisitorRequests(requests);

      const readyRequests = requests.filter(
        (r) => r.status === 'ready_for_pickup'
      );

      if (readyRequests.length === 0) {
        if (
          requests.some((r) => r.status === 'borrowed')
        ) {
          setMessage(
            'This visitor has no book ready for pickup. The visitor already has an active borrowed book.'
          );
        } else {
          setMessage(
            'Visitor verified, but there is no book currently ready for pickup.'
          );
        }
      } else {
        setMessage(
          `${readyRequests.length} book request${
            readyRequests.length > 1 ? 's are' : ' is'
          } ready for borrowing.`
        );
      }
    } catch (err) {
      console.error('QR borrowing lookup error:', err);

      setError(
        err?.message ||
          'Unable to process the visitor QR code.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmBorrow = async (request) => {
    if (!request?.id) return;

    setConfirming(true);
    setError('');
    setMessage('');

    try {
      const staffName =
        user?.name ||
        user?.fullName ||
        user?.email ||
        'Sub-Admin';

      await confirmPickup(
        request.id,
        staffName
      );

      setVisitorRequests((current) =>
        current.map((item) =>
          item.id === request.id
            ? {
                ...item,
                status: 'borrowed',
                borrowDate: new Date().toISOString(),
                dueDate: new Date(
                  Date.now() +
                    7 * 24 * 60 * 60 * 1000
                ).toISOString(),
                confirmedBy: staffName,
              }
            : item
        )
      );

      setMessage(
        `"${request.bookTitle}" has been successfully borrowed by ${request.visitorName}.`
      );

      if (onBorrowConfirmed) {
        onBorrowConfirmed(request.id);
      }
    } catch (err) {
      console.error(
        'Book borrowing confirmation error:',
        err
      );

      setError(
        err?.message ||
          'Unable to confirm this book borrowing.'
      );
    } finally {
      setConfirming(false);
    }
  };

  const clearVisitor = async () => {
    await stopScanner();

    setVisitor(null);
    setVisitorRequests([]);
    setMessage('');
    setError('');
  };

  const readyRequests = visitorRequests.filter(
    (r) => r.status === 'ready_for_pickup'
  );

  return (
    <div className="space-y-6">

      {/* QR BORROWING HEADER */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">

        <div className="p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-lg font-extrabold text-slate-800">
              Book Borrowing
            </h2>

            <p className="text-xs text-slate-500 mt-1">
              Scan the visitor's QR code to verify the borrower and
              process the book pickup.
            </p>
          </div>

          <button
            type="button"
            onClick={startScanner}
            disabled={scanning}
            className="bg-[#002046] text-white px-5 py-2.5 rounded-lg text-sm font-bold hover:opacity-90 transition disabled:opacity-50"
          >
            {scanning
              ? 'Scanner Active'
              : 'Scan Visitor QR'}
          </button>
        </div>

        {/* CAMERA SCANNER */}
        {showScanner && (
          <div className="p-5 bg-slate-50 border-b border-slate-200">
            <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">

              <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-800">
                    Scan Visitor QR Code
                  </p>

                  <p className="text-xs text-slate-500 mt-1">
                    Position the visitor QR code inside the box.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={stopScanner}
                  className="text-xs font-bold text-red-600 hover:text-red-800"
                >
                  Close
                </button>
              </div>

              <div className="p-4">
                <div
                  id="book-borrowing-qr-reader"
                  className="w-full"
                />
              </div>
            </div>
          </div>
        )}

        {/* STATUS MESSAGE */}
        {message && (
          <div className="mx-5 mt-5 bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-4 py-3 text-sm">
            {message}
          </div>
        )}

        {error && (
          <div className="mx-5 mt-5 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* LOADING */}
        {loading && (
          <div className="p-8 text-center text-sm text-slate-500">
            Verifying visitor QR code and checking borrow requests...
          </div>
        )}

        {/* VERIFIED VISITOR */}
        {!loading && visitor && (
          <div className="p-5 space-y-5">

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Verified Visitor
                  </p>

                  <h3 className="text-xl font-extrabold text-slate-800 mt-1">
                    {visitor.fullName}
                  </h3>

                  {visitor.email && (
                    <p className="text-xs text-slate-500 mt-1">
                      {visitor.email}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-full text-xs font-bold">
                    QR Verified
                  </span>

                  <button
                    type="button"
                    onClick={clearVisitor}
                    className="bg-white border border-slate-300 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-50"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>

            {/* READY FOR PICKUP */}
            {readyRequests.length > 0 && (
              <div className="space-y-3">

                <div>
                  <h3 className="text-sm font-extrabold text-slate-800">
                    Books Ready for Pickup
                  </h3>

                  <p className="text-xs text-slate-500 mt-1">
                    Confirm the book only after checking the physical
                    book and the visitor's identity.
                  </p>
                </div>

                {readyRequests.map((request) => {
                  const expired =
                    request.pickupDeadline &&
                    new Date(request.pickupDeadline) <
                      new Date();

                  return (
                    <div
                      key={request.id}
                      className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm"
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">

                        <div>
                          <p className="text-base font-extrabold text-slate-800">
                            {request.bookTitle}
                          </p>

                          <div className="mt-2 space-y-1 text-xs text-slate-500">
                            <p>
                              Request Date:{' '}
                              {formatDateTime(
                                request.requestDate
                              )}
                            </p>

                            <p
                              className={
                                expired
                                  ? 'text-red-600 font-bold'
                                  : ''
                              }
                            >
                              Pickup Deadline:{' '}
                              {formatDateTime(
                                request.pickupDeadline
                              )}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">

                          {expired ? (
                            <span className="bg-red-100 text-red-700 px-4 py-2 rounded-lg text-xs font-bold text-center">
                              Pickup Deadline Expired
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                handleConfirmBorrow(
                                  request
                                )
                              }
                              disabled={confirming}
                              className="bg-[#002046] text-white px-5 py-2.5 rounded-lg text-xs font-bold hover:opacity-90 transition disabled:opacity-50"
                            >
                              {confirming
                                ? 'Confirming...'
                                : 'Confirm Borrowing'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ACTIVE BORROWS */}
            {visitorRequests.some(
              (r) => r.status === 'borrowed'
            ) && (
              <div className="space-y-3">

                <h3 className="text-sm font-extrabold text-slate-800">
                  Active Borrowed Books
                </h3>

                {visitorRequests
                  .filter(
                    (r) => r.status === 'borrowed'
                  )
                  .map((request) => (
                    <div
                      key={request.id}
                      className="border border-blue-200 bg-blue-50 rounded-xl p-4"
                    >
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">

                        <div>
                          <p className="font-extrabold text-blue-900">
                            {request.bookTitle}
                          </p>

                          <p className="text-xs text-blue-700 mt-1">
                            Borrowed:{' '}
                            {formatDateTime(
                              request.borrowDate
                            )}
                          </p>
                        </div>

                        <div className="text-left md:text-right">
                          <p className="text-[10px] uppercase tracking-wider font-bold text-blue-600">
                            Due Date
                          </p>

                          <p className="text-sm font-extrabold text-blue-900">
                            {formatDateTime(
                              request.dueDate
                            )}
                          </p>
                        </div>

                      </div>
                    </div>
                  ))}
              </div>
            )}

            {/* NO REQUESTS */}
            {!visitorRequests.length && (
              <div className="border border-dashed border-slate-300 rounded-xl p-8 text-center">
                <p className="text-sm font-bold text-slate-600">
                  No active book requests found.
                </p>

                <p className="text-xs text-slate-400 mt-1">
                  This visitor does not currently have a book ready
                  for pickup or an active borrowed book.
                </p>
              </div>
            )}

          </div>
        )}
      </div>

      {/* EXISTING BOOK TRANSACTIONS */}
      <div>
        <div className="mb-3">
          <h2 className="text-lg font-extrabold text-slate-800">
            Transaction Records
          </h2>

          <p className="text-xs text-slate-500 mt-1">
            View and manage existing book transaction records.
          </p>
        </div>

        <BookTransactions />
      </div>
    </div>
  );
}

export default function SubAdminDashboard() {
  const { user, logout } = useAuth();

  const {
    books,
    borrowRequests,
    attendanceLogs,
  } = useLibraryData();

  const [section, setSection] = useState('overview');

  // ============================================================
  // BRANCH SPECIFIC DATA & IMPORT / EXPORT LOGIC
  // ============================================================
  const currentLibraryId = user?.libraryId || user?.assignedBranch || '';

  // 1. Filter Books para sa branch ng Sub-Admin lang
  const branchBooks = useMemo(() => {
    if (!currentLibraryId) return books;
    return books.filter(
      (b) => b.libraryId === currentLibraryId || b.library_id === currentLibraryId
    );
  }, [books, currentLibraryId]);

  // 2. Filter Attendance Logs para sa branch ng Sub-Admin lang
  const branchAttendance = useMemo(() => {
    if (!currentLibraryId) return attendanceLogs;
    return attendanceLogs.filter(
      (a) => a.libraryId === currentLibraryId || a.library_id === currentLibraryId
    );
  }, [attendanceLogs, currentLibraryId]);

  // 3. Import File Handler para sa Branch
  const [importTarget, setImportTarget] = useState('books');

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    parseImportFile(file, async (importedJSON) => {
      // Isasama ang current library ID sa bawat imported item
      const dataWithLibrary = importedJSON.map((item) => ({
        ...item,
        library_id: currentLibraryId || item.library_id,
      }));

      const { error } = await supabase.from(importTarget).insert(dataWithLibrary);

      if (error) {
        alert('Failed to import data: ' + error.message);
      } else {
        alert(`Data successfully imported for your branch to ${importTarget}!`);
        window.location.reload();
      }
    });
  };

  const [locallyConfirmedPickups, setLocallyConfirmedPickups] =
    useState([]);

  const today = new Date().toDateString();

  const todaysVisits = branchAttendance.filter(
    (a) => new Date(a.timeIn).toDateString() === today
  ).length;

  const pendingPickups =
    borrowRequests.filter(
      (r) =>
        (r.libraryId === currentLibraryId || r.library_id === currentLibraryId) &&
        r.status === 'ready_for_pickup' &&
        !locallyConfirmedPickups.includes(r.id)
    ).length;

  const activeBorrows =
    borrowRequests.filter(
      (r) =>
        (r.libraryId === currentLibraryId || r.library_id === currentLibraryId) &&
        (r.status === 'borrowed' || locallyConfirmedPickups.includes(r.id))
    ).length;

  const overdue =
    borrowRequests.filter(
      (r) =>
        (r.libraryId === currentLibraryId || r.library_id === currentLibraryId) &&
        r.status === 'borrowed' &&
        new Date(r.dueDate) < new Date()
    ).length;

  const handleBorrowConfirmed = (requestId) => {
    setLocallyConfirmedPickups((current) => {
      if (current.includes(requestId)) {
        return current;
      }

      return [...current, requestId];
    });
  };

  const currentNav = NAV.find(
    (n) => n.id === section
  );

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 flex">

      {/* SIDEBAR */}
      <aside className="w-60 bg-[#002046] text-white flex flex-col shrink-0">

        <div className="p-5 border-b border-white/10">
          <p className="font-extrabold tracking-wider">
            SHELF ILMS
          </p>

          <p className="text-xs text-slate-300 mt-1">
            Sub-Admin Console
          </p>
        </div>

        <nav className="flex-1 p-3 space-y-1">

          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() =>
                setSection(item.id)
              }
              className={`w-full text-left text-sm px-3 py-2.5 rounded-lg transition ${
                section === item.id
                  ? 'bg-white/15 font-bold'
                  : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              {item.label}
            </button>
          ))}

        </nav>

        <div className="p-4 border-t border-white/10 space-y-2">

          <p className="text-xs text-slate-300">
            Signed in as
          </p>

          <p className="text-sm font-bold">
            {user?.name}
          </p>

          <button
            type="button"
            onClick={logout}
            className="w-full bg-white/10 hover:bg-white/20 text-xs px-3 py-2 rounded-lg border border-white/20 transition"
          >
            Sign Out
          </button>

        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 p-8 space-y-6 overflow-y-auto">

        <div>
          <h1 className="text-2xl font-bold text-[#0f172a]">
            {currentNav?.label.replace(
              /^\S+\s/,
              ''
            )}
          </h1>

          <p className="text-xs text-slate-500 mt-1">
            Manage book inventories, issue books, and process returns for your branch.
          </p>
        </div>

        {/* OVERVIEW */}
        {section === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">

              <StatCard
                label="Visits Today"
                value={todaysVisits}
                tone="blue"
              />

              <StatCard
                label="Pending Pickups"
                value={pendingPickups}
                tone="amber"
              />

              <StatCard
                label="Active Borrows"
                value={activeBorrows}
              />

              <StatCard
                label="Overdue Items"
                value={overdue}
                tone="red"
              />

              <StatCard
                label="Branch Books"
                value={branchBooks.length}
              />

            </div>

            {/* BRANCH DATA MANAGEMENT CARD */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
              <div className="border-b border-slate-100 pb-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    Branch Data Management & Reports
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Export records or import data specifically for your assigned library branch.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={importTarget}
                    onChange={(e) => setImportTarget(e.target.value)}
                    className="text-xs border border-slate-300 rounded-lg px-2.5 py-2 bg-slate-50 font-semibold text-slate-700"
                  >
                    <option value="books">Import Books to Branch</option>
                    <option value="attendance_logs">Import Attendance Logs</option>
                  </select>

                  <label className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3.5 py-2 rounded-lg cursor-pointer transition">
                    📤 Import File
                    <input
                      type="file"
                      accept=".csv, .xlsx, .xls"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                
                {/* BRANCH BOOKS EXPORT */}
                <div className="p-3.5 border border-slate-100 bg-slate-50/50 rounded-lg flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-slate-700">📚 Branch Books Inventory</p>
                    <p className="text-[11px] text-slate-500">Total Books: {branchBooks.length}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => exportToExcel(branchBooks, `Branch_Books_${currentLibraryId || 'data'}.xlsx`)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-3 py-1.5 rounded transition"
                    >
                      Excel
                    </button>
                    <button
                      type="button"
                      onClick={() => exportToCSV(branchBooks, `Branch_Books_${currentLibraryId || 'data'}.csv`)}
                      className="bg-slate-700 hover:bg-slate-800 text-white text-[11px] font-bold px-3 py-1.5 rounded transition"
                    >
                      CSV
                    </button>
                  </div>
                </div>

                {/* BRANCH ATTENDANCE EXPORT */}
                <div className="p-3.5 border border-slate-100 bg-slate-50/50 rounded-lg flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-slate-700">📊 Branch Visitor Attendance</p>
                    <p className="text-[11px] text-slate-500">Total Attendance Logs: {branchAttendance.length}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => exportToExcel(branchAttendance, `Branch_Attendance_${currentLibraryId || 'data'}.xlsx`)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-3 py-1.5 rounded transition"
                    >
                      Excel
                    </button>
                    <button
                      type="button"
                      onClick={() => exportToCSV(branchAttendance, `Branch_Attendance_${currentLibraryId || 'data'}.csv`)}
                      className="bg-slate-700 hover:bg-slate-800 text-white text-[11px] font-bold px-3 py-1.5 rounded transition"
                    >
                      CSV
                    </button>
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}

        {/* ATTENDANCE */}
        {section === 'attendance' && (
          <AttendanceScanner />
        )}

        {/* BOOK TRANSACTIONS / QR BORROWING */}
        {section === 'transactions' && (
          <QRBookBorrowing
            user={user}
            borrowRequests={borrowRequests}
            onBorrowConfirmed={
              handleBorrowConfirmed
            }
          />
        )}

        {/* INVENTORY */}
        {section === 'inventory' && (
          <BookInventory />
        )}

        {/* RESERVATION QUEUE */}
        {section === 'queue' && (
          <ReservationQueue />
        )}

      </main>
    </div>
  );
}