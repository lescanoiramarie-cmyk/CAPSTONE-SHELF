import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ClipboardList,
  Clock3,
  MapPinned,
  QrCode,
  Building2,
  Upload,
  UsersRound,
  Info,
  Bell,
  Sparkles,
  Calendar,
  Clock
} from 'lucide-react';
import VisitorScanDetails from '../../component/VisitorScanDetails.jsx';
import { useAuth } from '../../context/useAuth.js';
import { useLibrary, useLibraryData } from '../../context/useLibrary.js';
import AttendanceScanner from '../../component/AttendanceScanner.jsx';
import BookTransactions from '../../component/BookTransactions.jsx';
import BookInventory from '../../component/BookInventory.jsx';
import ReservationQueue from '../../component/ReservationQueue.jsx';
import AdminWorkspace from '../../component/AdminWorkspace.jsx';
import LibraryMap from '../../component/LibraryMap.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { exportToExcel, exportToCSV } from '../../lib/excelUtils.js';
import Papa from 'papaparse';
import { findVisitorByQr } from '../../data/store.js';
import { sendDueDateFollowUp } from '../../lib/dueDateFollowUp.js';

const NAV = [
  { id: 'overview', label: 'Overview', Icon: Activity },
  { id: 'attendance', label: 'Attendance', Icon: QrCode },
  { id: 'transactions', label: 'Book Transactions', Icon: BookOpen },
  { id: 'inventory', label: 'Inventory', Icon: ClipboardList },
  { id: 'queue', label: 'Reservation Queue', Icon: Clock3 },
  { id: 'map', label: 'Branch Map', Icon: MapPinned },
];

function StatCard({ label, value, tone = 'default' }) {
  const tones = {
    default: 'bg-white border-slate-200 border-l-slate-300 text-slate-800',
    amber: 'bg-amber-50 border-amber-200 border-l-amber-500 text-amber-800',
    red: 'bg-red-50 border-red-200 border-l-red-500 text-red-700',
    blue: 'bg-blue-50 border-blue-200 border-l-blue-500 text-blue-800',
  };
  return (
    <div className={`rounded-r-xl border border-l-4 p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider opacity-70">{label}</p>
          <p className="mt-1 text-3xl font-extrabold">{value}</p>
        </div>
        <span className="rounded-lg bg-white/70 p-2 text-current shadow-sm" aria-hidden="true">
          {tone === 'amber' ? (
            <Clock3 size={18} />
          ) : tone === 'red' ? (
            <AlertTriangle size={18} />
          ) : tone === 'blue' ? (
            <UsersRound size={18} />
          ) : tone === 'book' ? (
            <BookOpen size={18} />
          ) : (
            <Activity size={18} />
          )}
        </span>
      </div>
    </div>
  );
}

function AttendanceTrendChart({ attendance = [] }) {
  const dailyCounts = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const count = attendance.filter((record) => {
      const timestamp = record.timeIn || record.time_in;
      if (!timestamp) return false;
      const recordDate = new Date(timestamp);
      return (
        !Number.isNaN(recordDate.getTime()) &&
        recordDate.toDateString() === date.toDateString()
      );
    }).length;
    return {
      label: date.toLocaleDateString('en-US', { weekday: 'short' }),
      count,
    };
  });
  const maxCount = Math.max(1, ...dailyCounts.map((day) => day.count));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-bold text-slate-800">
        Visitor Attendance
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Daily attendance for the last seven days
      </p>
      {attendance.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">
          No attendance records available for this branch.
        </p>
      ) : (
        <div className="mt-6 flex h-44 items-end justify-around gap-2">
          {dailyCounts.map((day) => (
            <div
              key={day.label}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
            >
              <span className="text-xs font-semibold text-slate-600">
                {day.count}
              </span>
              <div className="flex h-28 w-full items-end justify-center">
                <div
                  title={`${day.label}: ${day.count} visitors`}
                  aria-label={`${day.label}: ${day.count} visitors`}
                  className="w-full max-w-10 rounded-t-md bg-blue-500 transition-all duration-200 hover:scale-x-110 hover:bg-blue-600 hover:shadow-md"
                  style={{
                    height:
                      day.count === 0
                        ? '0%'
                        : `${Math.max(6, (day.count / maxCount) * 100)}%`,
                  }}
                />
              </div>
              <span className="text-xs text-slate-500">
                {day.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BorrowingStatusChart({ requests = [] }) {
  const getStatus = (request) =>
    String(request.status || '')
      .toLowerCase()
      .trim()
      .replace(/[\s-]+/g, '_');
  const isOverdue = (request) => {
    const status = getStatus(request);
    const dueDate = request.dueDate || request.due_date;
    return (
      status === 'borrowed' &&
      dueDate &&
      !Number.isNaN(new Date(dueDate).getTime()) &&
      new Date(dueDate) < new Date()
    );
  };
  const statuses = [
    {
      key: 'pending',
      label: 'Pending',
      color: 'bg-amber-500',
      count: requests.filter((r) => getStatus(r) === 'pending').length,
    },
    {
      key: 'ready',
      label: 'Ready for Pickup',
      color: 'bg-blue-500',
      count: requests.filter(
        (r) => getStatus(r) === 'ready_for_pickup'
      ).length,
    },
    {
      key: 'borrowed',
      label: 'Active Borrows',
      color: 'bg-violet-500',
      count: requests.filter(
        (r) => getStatus(r) === 'borrowed' && !isOverdue(r)
      ).length,
    },
    {
      key: 'overdue',
      label: 'Overdue',
      color: 'bg-red-500',
      count: requests.filter(isOverdue).length,
    },
    {
      key: 'returned',
      label: 'Returned',
      color: 'bg-emerald-500',
      count: requests.filter((r) => getStatus(r) === 'returned').length,
    },
  ];
  const maxCount = Math.max(1, ...statuses.map((item) => item.count));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-bold text-slate-800">
        Borrowing Status
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Book requests and transactions for your assigned branch
      </p>
      {requests.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">
          No borrowing records available for this branch.
        </p>
      ) : (
        <div className="mt-6 space-y-4">
          {statuses.map((item) => (
            <div key={item.key}>
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-600">
                  {item.label}
                </span>
                <span className="text-xs font-bold text-slate-800">
                  {item.count}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  title={`${item.label}: ${item.count} requests`}
                  aria-label={`${item.label}: ${item.count} requests`}
                  className={`h-full rounded-full ${item.color} transition-all duration-200 hover:brightness-110`}
                  style={{
                    width: `${(item.count / maxCount) * 100}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
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

// CUSTOM WELCOME COMPONENT WITH UPPER RIGHT NOTIFICATION BELL
function CustomDashboardWelcome({
  name,
  description,
  notifications = [],
  onNotificationClick,

  onNotificationFollowUp,
  actions = [],
}) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [readNotificationIds, setReadNotificationIds] = useState(() => new Set());
  const [followUpRequestId, setFollowUpRequestId] = useState(null);
  const [followUpSentIds, setFollowUpSentIds] = useState(() => new Set());
  const [followUpError, setFollowUpError] = useState('');
  const [followUpErrorId, setFollowUpErrorId] = useState(null);
  const unreadCount = notifications.filter(
    (notification) => !readNotificationIds.has(notification.id)
  ).length;


  return (
    <div className="relative bg-white rounded-2xl p-6 sm:p-8 border border-slate-200/80 shadow-sm space-y-6">
      
      {/* TOP RIGHT ACTION BAR (NOTIFICATION BELL & ONLINE BADGE) */}
      <div className="absolute top-6 right-6 flex items-center gap-3 z-20">
        
        {/* NOTIFICATION BELL BUTTON WITH DROPDOWN */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowNotifications(!showNotifications)}
            className="w-10 h-10 rounded-full bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 transition shadow-sm relative"
            aria-label="Notifications"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-extrabold rounded-full flex items-center justify-center shadow-sm">
                {unreadCount}
              </span>
            )}
          </button>

          {/* NOTIFICATION DROPDOWN MENU */}
          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-2xl p-3 z-50 text-xs">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 font-bold text-slate-800">
                <span>Branch Notifications</span>
                <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full text-[10px]">
                  {unreadCount} Unread
                </span>
              </div>
              {notifications.length > 0 && (
                <button
                  type="button"
                  disabled={unreadCount === 0}
                  onClick={() => setReadNotificationIds((current) => new Set([
                    ...current,
                    ...notifications.map((notification) => notification.id),
                  ]))}
                  className="mb-2 text-[10px] font-bold text-blue-700 hover:underline disabled:opacity-50"
                >
                  Mark all read
                </button>
              )}
              
              <div className="max-h-60 overflow-y-auto space-y-2">
                {notifications.length === 0 ? (
                  <p className="text-slate-400 py-3 text-center">No new notifications</p>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`rounded-lg border border-slate-100 p-2.5 transition ${
                        readNotificationIds.has(n.id)
                          ? 'bg-white'
                          : 'bg-blue-50/70'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setReadNotificationIds((current) => new Set([...current, n.id]));
                          onNotificationClick?.(n);
                          setShowNotifications(false);
                        }}
                        className="block w-full text-left"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-bold text-slate-800">{n.title}</span>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${
                            followUpSentIds.has(n.id)
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {n.followUp
                              ? followUpSentIds.has(n.id) ? 'Followed up' : 'Pending follow-up'
                              : n.status || 'Pending'}
                          </span>
                        </span>
                        <span className="mt-0.5 block line-clamp-1 text-slate-500">{n.message}</span>
                        <span className="mt-1 block text-[10px] text-slate-400">
                          {n.timeLabel}{' · '}{readNotificationIds.has(n.id) ? 'Read' : 'Unread'}
                        </span>
                      </button>

                      {n.followUp && onNotificationFollowUp && (
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <p className="min-w-0 text-[10px] text-red-700" role="status">
                            {followUpErrorId === n.requestId
                              ? followUpError
                              : followUpSentIds.has(n.id)
                                ? 'Follow-up sent today.'
                                : ''}
                          </p>
                          <button
                            type="button"
                            disabled={
                              followUpRequestId === n.requestId ||
                              followUpSentIds.has(n.id)
                            }
                            onClick={async (event) => {
                              event.stopPropagation();
                              setFollowUpRequestId(n.requestId);
                              setFollowUpError('');
                              setFollowUpErrorId(null);

                              try {
                                await onNotificationFollowUp(n);
                                setFollowUpSentIds(
                                  (current) => new Set([...current, n.id])
                                );
                              } catch (error) {
                                setFollowUpError(
                                  error?.message || 'Unable to send follow-up.'
                                );
                                setFollowUpErrorId(n.requestId);
                              } finally {
                                setFollowUpRequestId(null);
                              }
                            }}
                            className="shrink-0 rounded-md border border-red-200 px-2 py-1 text-[10px] font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {followUpRequestId === n.requestId
                              ? 'Sending...'
                              : followUpSentIds.has(n.id)
                                ? 'Sent'
                                : 'Follow up'}
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* ONLINE STATUS BADGE */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200/80 rounded-full text-xs font-bold shadow-sm">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Online</span>
        </div>
      </div>

      {/* WELCOME TEXT CONTENT */}
      <div className="space-y-3 max-w-2xl pr-28 sm:pr-0">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold uppercase tracking-wider">
          <Sparkles size={13} className="text-amber-600" />
          SHELF ILMS
        </span>

        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
          Good morning, <span className="text-blue-950">{name || 'Maria'}!</span>
        </h1>

        <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-500">
          <span className="flex items-center gap-1.5">
            <Calendar size={14} className="text-amber-500" />
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock size={14} className="text-amber-500" />
            {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          </span>
        </div>

        <p className="text-xs sm:text-sm text-slate-500 leading-relaxed pt-1">
          {description}
        </p>
      </div>

      {/* QUICK ACTIONS BUTTONS */}
      {actions.length > 0 && (
        <div className="pt-4 border-t border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">
            Quick Actions
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {actions.map((act, idx) => {
              const ActionIcon = act.Icon || Activity;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={act.onClick}
                  className="flex items-center justify-between p-3.5 bg-slate-50 hover:bg-blue-50/60 border border-slate-200/80 hover:border-blue-300 rounded-xl text-left transition group shadow-sm"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-600 group-hover:text-blue-600 group-hover:border-blue-200 transition">
                      <ActionIcon size={16} />
                    </div>
                    <span className="text-xs font-bold text-slate-700 group-hover:text-blue-700 transition">
                      {act.label}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-transform">
                    ↗
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function QRBookBorrowing({
  user,
  onBorrowConfirmed,
  confirmPickup,
  confirmReturn,
}) {
  const { borrowRequests = [] } = useLibraryData();
  const scannerRef = useRef(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [visitor, setVisitor] = useState(null);
  const [visitorRequests, setVisitorRequests] = useState([]);
  const [manualQrValue, setManualQrValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const stopScanner = async () => {
    try {
      if (scannerRef.current) {
        try {
          await scannerRef.current.stop();
        } catch (err) {
          console.warn('QR scanner stop warning:', err?.message || err);
        }
        try {
          await scannerRef.current.clear();
        } catch (err) {
          console.warn('QR scanner clear warning:', err?.message || err);
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

  const handleQrScan = useCallback(async (qrValue) => {
    setLoading(true);
    setError('');
    setMessage('');
    setVisitor(null);
    setVisitorRequests([]);
    try {
      const currentLibraryId = user?.libraryId || user?.assignedBranch;
      const foundVisitor = await findVisitorByQr(qrValue, currentLibraryId);
      if (!foundVisitor) {
        throw new Error(
          'Visitor not found. Please scan a valid SHELF ILMS visitor QR code.'
        );
      }
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
            return_confirmed_by,
            books!inner(library_id, title, author, isbn, cover_url)
          `
        )
        .eq('visitor_id', foundVisitor.id)
        .eq('books.library_id', currentLibraryId)
        .in('status', ['ready_for_pickup', 'borrowed'])
        .order('request_date', { ascending: false });

      if (requestError) throw requestError;

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
        bookAuthor: r.books?.author || '',
        bookIsbn: r.books?.isbn || '',
        bookCoverUrl: r.books?.cover_url || '',
      }));

      setVisitor(foundVisitor);
      setManualQrValue('');
      setVisitorRequests(requests);

      const readyRequests = requests.filter((r) => r.status === 'ready_for_pickup');
      if (readyRequests.length === 0) {
        if (requests.some((r) => r.status === 'borrowed')) {
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
      setError(err?.message || 'Unable to process the visitor QR code.');
    } finally {
      setLoading(false);
    }
  }, [user]);

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
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const size = Math.floor(
                Math.min(viewfinderWidth, viewfinderHeight, 280) * 0.8
              );
              return { width: size, height: size };
            },
          },
          async (decodedText) => {
            if (cancelled) return;
            const qrValue = decodedText.trim();
            if (!qrValue) return;
            try {
              await scanner.stop();
            } catch (err) {
              console.warn('QR scanner stop after scan warning:', err?.message || err);
            }
            try {
              await scanner.clear();
            } catch (err) {
              console.warn('QR scanner clear after scan warning:', err?.message || err);
            }
            scannerRef.current = null;
            setScanning(false);
            setShowScanner(false);
            await handleQrScan(qrValue);
          },
          () => {}
        );
      } catch (err) {
        console.error('Unable to start QR scanner:', err);
        if (!cancelled) {
          setScanning(false);
          setError('Unable to open the camera. Please allow camera access and try again.');
        }
      }
    };
    startCamera();
    return () => {
      cancelled = true;
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {}).finally(() => {
          scannerRef.current?.clear().catch(() => {});
          scannerRef.current = null;
        });
      }
    };
  }, [showScanner, handleQrScan]);

  const handleConfirmBorrow = async (request) => {
    if (!request?.id) return;
    setConfirming(true);
    setError('');
    setMessage('');
    try {
      const staffName = user?.name || user?.fullName || user?.email || 'Sub-Admin';
      await confirmPickup(request.id, staffName);
      setVisitorRequests((current) =>
        current.map((item) =>
          item.id === request.id
            ? { ...item, status: 'borrowed', confirmedBy: staffName }
            : item
        )
      );
      setMessage(`"${request.bookTitle}" has been successfully borrowed by ${request.visitorName}.`);
      if (onBorrowConfirmed) onBorrowConfirmed(request.id);
    } catch (err) {
      console.error('Book borrowing confirmation error:', err);
      setError(err?.message || 'Unable to confirm this book borrowing.');
    } finally {
      setConfirming(false);
    }
  };

  const handleConfirmReturn = async (request) => {
    if (!request?.id) return;
    setConfirming(true);
    setError('');
    setMessage('');
    try {
      const staffName = user?.name || user?.fullName || user?.email || 'Sub-Admin';
      await confirmReturn(request.id, staffName);
      setVisitorRequests((current) =>
        current.map((item) =>
          item.id === request.id
            ? { ...item, status: 'returned', returnConfirmedBy: staffName }
            : item
        )
      );
      setMessage(`"${request.bookTitle}" has been returned. The copy is available again.`);
    } catch (err) {
      console.error('Book return confirmation error:', err);
      setError(err?.message || 'Unable to confirm this book return.');
    } finally {
      setConfirming(false);
    }
  };

  const handleManualQrSubmit = async (event) => {
    event.preventDefault();
    if (loading) return;
    await handleQrScan(manualQrValue);
  };

  const clearVisitor = async () => {
    await stopScanner();
    setVisitor(null);
    setVisitorRequests([]);
    setMessage('');
    setError('');
  };

  const displayedVisitorRequests = visitorRequests.map((request) => {
    const sharedRequest = borrowRequests.find(
      (item) => String(item.id) === String(request.id)
    );
    if (!sharedRequest) return request;
    return {
      ...request,
      requestDate: sharedRequest.requestDate || request.requestDate,
      pickupDeadline: sharedRequest.pickupDeadline || request.pickupDeadline,
      borrowDate: sharedRequest.borrowDate || request.borrowDate,
      dueDate: sharedRequest.dueDate || request.dueDate,
      returnDate: sharedRequest.returnDate || request.returnDate,
      fineAmount: sharedRequest.fineAmount ?? request.fineAmount,
    };
  });

  const activeVisitorRequests = displayedVisitorRequests.filter(
    (request) => ['ready_for_pickup', 'borrowed'].includes(request.status)
  );
  const readyRequests = activeVisitorRequests.filter((r) => r.status === 'ready_for_pickup');

  return (
    <div className="space-y-6">
      {/* QR BORROWING HEADER */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-lg font-extrabold text-slate-800">
              Book Borrowing &amp; Returning
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Step 1 — scan the visitor's QR code or enter the QR value manually.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <form onSubmit={handleManualQrSubmit} className="flex gap-2">
              <label className="sr-only" htmlFor="subadmin-visitor-qr">Visitor QR value</label>
              <input
                id="subadmin-visitor-qr"
                value={manualQrValue}
                onChange={(event) => setManualQrValue(event.target.value)}
                placeholder="Enter visitor QR value"
                autoComplete="off"
                className="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <button
                type="submit"
                disabled={loading || !manualQrValue.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-500 disabled:opacity-50"
              >
                {loading ? 'Checking...' : 'Submit'}
              </button>
            </form>
            <button
              type="button"
              onClick={startScanner}
              disabled={scanning || loading}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {scanning ? 'Scanner Active' : 'Scan with Camera'}
            </button>
          </div>
        </div>

        {/* CAMERA SCANNER */}
        {showScanner && (
          <div className="p-5 bg-slate-50 border-b border-slate-200">
            <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-800">Scan Visitor QR Code</p>
                  <p className="text-xs text-slate-500 mt-1">Position the visitor QR code inside the box.</p>
                </div>
                <button type="button" onClick={stopScanner} className="text-xs font-bold text-red-600 hover:text-red-800">Close</button>
              </div>
              <div className="p-4">
                <div className="mx-auto aspect-[4/3] w-full max-w-96 overflow-hidden rounded-lg border border-slate-300 bg-black">
                  <div
                    id="book-borrowing-qr-reader"
                    className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover [&_canvas]:h-full [&_canvas]:w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STATUS MESSAGE */}
        {message && (
          <div role="status" className="mx-5 mt-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 font-sans text-sm text-blue-800">
            {message}
          </div>
        )}
        {error && (
          <div role="alert" className="mx-5 mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 font-sans text-sm text-red-700">
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
                    Step 2 — Review requests for verified visitor
                  </p>
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
              <VisitorScanDetails visitor={visitor} />
            </div>

            {/* READY FOR PICKUP */}
            {readyRequests.length > 0 && (
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-800">
                    Books Ready for Pickup
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Confirm the book only after checking the physical book and the visitor's identity.
                  </p>
                </div>
                {readyRequests.map((request) => {
                  const expired = request.pickupDeadline && new Date(request.pickupDeadline) < new Date();
                  return (
                    <div key={request.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-3">
                          {request.bookCoverUrl && (
                            <img src={request.bookCoverUrl} alt={`${request.bookTitle} cover`} className="h-20 w-14 shrink-0 rounded border border-slate-200 object-cover" />
                          )}
                          <div className="min-w-0">
                            <p className="text-base font-extrabold text-slate-800">{request.bookTitle}</p>
                            <div className="mt-2 space-y-1 text-xs text-slate-500">
                              {request.bookAuthor && <p>Author: {request.bookAuthor}</p>}
                              {request.bookIsbn && <p>ISBN: {request.bookIsbn}</p>}
                              <p>Status: <span className="font-semibold text-amber-700">Ready for pickup</span></p>
                              <p>Request Date: {formatDateTime(request.requestDate)}</p>
                              <p className={expired ? 'text-red-600 font-bold' : ''}>Pickup Deadline: {formatDateTime(request.pickupDeadline)}</p>
                            </div>
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
                              onClick={() => handleConfirmBorrow(request)}
                              disabled={confirming}
                              className="bg-blue-600 text-white px-5 py-2.5 rounded-lg text-xs font-bold hover:bg-blue-500 transition disabled:opacity-50"
                            >
                              {confirming ? 'Confirming...' : 'Confirm Borrowing'}
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
            {activeVisitorRequests.some((r) => r.status === 'borrowed') && (
              <div className="space-y-3">
                <h3 className="text-sm font-extrabold text-slate-800">Active Borrowed Books</h3>
                {activeVisitorRequests.filter((r) => r.status === 'borrowed').map((request) => (
                  <div key={request.id} className="rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        {request.bookCoverUrl && (
                          <img src={request.bookCoverUrl} alt={`${request.bookTitle} cover`} className="h-20 w-14 shrink-0 rounded border border-blue-200 object-cover" />
                        )}
                        <div className="min-w-0">
                          <p className="font-extrabold text-blue-900">{request.bookTitle}</p>
                          {request.bookAuthor && <p className="mt-1 text-xs text-blue-700">Author: {request.bookAuthor}</p>}
                          {request.bookIsbn && <p className="text-xs text-blue-700">ISBN: {request.bookIsbn}</p>}
                          <p className="mt-1 text-xs font-semibold text-blue-700">Status: Borrowed</p>
                          <p className="mt-1 text-xs text-blue-700">Borrowed: {formatDateTime(request.borrowDate)}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-start gap-2 md:items-end">
                        <div className="text-left md:text-right">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Due Date</p>
                          <p className="text-sm font-extrabold text-blue-900">{formatDateTime(request.dueDate)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleConfirmReturn(request)}
                          disabled={confirming}
                          className="rounded-lg bg-emerald-700 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50"
                        >
                          {confirming ? 'Confirming...' : 'Confirm Return'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!activeVisitorRequests.length && (
              <div className="border border-dashed border-slate-300 rounded-xl p-8 text-center">
                <p className="text-sm font-bold text-slate-600">No active book requests found.</p>
                <p className="text-xs text-slate-400 mt-1">This visitor does not currently have a book ready for pickup or an active borrowed book.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* EXISTING BOOK TRANSACTIONS */}
      <div>
        <div className="mb-3">
          <h2 className="text-lg font-extrabold text-slate-800">Transaction Records</h2>
          <p className="text-xs text-slate-500 mt-1">View and manage existing book transaction records.</p>
        </div>
        <BookTransactions />
      </div>
    </div>
  );
}

export default function SubAdminDashboard() {
  const { user, logout } = useAuth();
  const { books, borrowRequests, attendanceLogs, libraries } = useLibraryData();
  const [section, setSection] = useState('overview');
  const [focusRequestId, setFocusRequestId] = useState(null);
  const [focusNotificationType, setFocusNotificationType] = useState(null);
  const [notificationTargetMessage, setNotificationTargetMessage] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({ reports: true, communication: false });
  const [workspaceTab, setWorkspaceTab] = useState('reports');
  const [showImportGuide, setShowImportGuide] = useState(false);
  const { addBooksBulk, confirmPickup, confirmReturn } = useLibrary();

  useEffect(() => {
    if (!focusRequestId || section === 'overview') return;
    const frame = requestAnimationFrame(() => {
      const target =
        document.getElementById(`reservation-queue-request-${focusRequestId}`) ||
        document.getElementById(`admin-request-${focusRequestId}`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequestId, section]);

  const navigateToSection = (nextSection) => {
    setFocusRequestId(null);
    setFocusNotificationType(null);
    setNotificationTargetMessage('');
    setSection(nextSection);
  };
  const currentLibraryId = user?.libraryId || user?.assignedBranch || '';

  const currentBranchName = useMemo(() => {
    const assignedId = String(currentLibraryId || '');
    if (!assignedId) return '';
    const assignedLibrary = libraries.find(
      (library) =>
        String(library.id) === assignedId ||
        String(library.libraryId) === assignedId ||
        String(library.library_id) === assignedId
    );
    return (
      assignedLibrary?.name ||
      assignedLibrary?.libraryName ||
      assignedLibrary?.library_name ||
      ''
    );
  }, [libraries, currentLibraryId]);

  const branchBooks = useMemo(() => {
    if (!currentLibraryId) return [];
    return books.filter(
      (b) => b.libraryId === currentLibraryId || b.library_id === currentLibraryId
    );
  }, [books, currentLibraryId]);

  const branchAttendance = useMemo(() => {
    if (!currentLibraryId) return [];
    return attendanceLogs.filter(
      (a) => a.libraryId === currentLibraryId || a.library_id === currentLibraryId
    );
  }, [attendanceLogs, currentLibraryId]);

  const branchBookIds = useMemo(
    () => new Set(branchBooks.map((book) => String(book.id))),
    [branchBooks]
  );

  const branchBorrowRequests = useMemo(
    () =>
      borrowRequests.filter((request) =>
        branchBookIds.has(String(request.bookId || request.book_id))
      ),
    [borrowRequests, branchBookIds]
  );

  const [notificationNow, setNotificationNow] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = setInterval(() => setNotificationNow(Date.now()), 60_000);
    return () => clearInterval(intervalId);
  }, []);

  const branchNotifications = useMemo(() => {
    if (!currentLibraryId) return [];
    const now = notificationNow;
    const oneDay = 24 * 60 * 60 * 1000;
    const items = [];
    const formatTime = (value) => {
      if (!value) return 'Date unavailable';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return 'Date unavailable';
      return date.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
    };
    const todayDateKey = new Date(now).toISOString().slice(0, 10);

    branchBorrowRequests.forEach((request) => {
      const bookTitle = request.bookTitle || 'Untitled book';
      const visitorName = request.visitorName || 'Visitor';
      const requestDate = request.requestDate ? new Date(request.requestDate).getTime() : NaN;
      const pickupDeadline = request.pickupDeadline ? new Date(request.pickupDeadline).getTime() : NaN;
      const dueDate = request.dueDate ? new Date(request.dueDate).getTime() : NaN;
      const dueDateKey = Number.isFinite(dueDate)
        ? new Date(dueDate).toISOString().slice(0, 10)
        : '';

      if (
        ['queued', 'pending'].includes(String(request.status || '').toLowerCase()) &&
        Number.isFinite(requestDate) && requestDate <= now && requestDate >= now - oneDay
      ) {
        items.push({
          id: `reservation-${request.id}`,
          requestId: request.id,
          recordId: request.id,
          type: 'reservation',
          targetSection: 'queue',
          status: 'Pending',
          title: 'New reservation request',
          message: `${visitorName} — ${bookTitle}`,
          timeLabel: `Requested ${formatTime(request.requestDate)}`,
          timestamp: requestDate,
          priority: 3,
        });
      }

      if (
        request.status === 'ready_for_pickup' &&
        Number.isFinite(pickupDeadline) && pickupDeadline >= now && pickupDeadline <= now + oneDay
      ) {
        items.push({
          id: `pickup-${request.id}`,
          requestId: request.id,
          recordId: request.id,
          type: 'pickup',
          targetSection: 'queue',
          status: 'Pending',
          title: 'Pickup deadline approaching',
          message: `${bookTitle} for ${visitorName}`,
          timeLabel: `Deadline ${formatTime(request.pickupDeadline)}`,
          timestamp: pickupDeadline,
          priority: 2,
        });
      }

      if (
        request.status === 'borrowed' &&
        Number.isFinite(dueDate) &&
        dueDateKey < todayDateKey
      ) {
        items.push({
          id: `overdue-${request.id}`,
          requestId: request.id,
          recordId: request.id,
          type: 'overdue',
          targetSection: 'transactions',
          followUp: true,
          title: 'Overdue book',
          message: `${bookTitle} — ${visitorName}`,
          timeLabel: `Due ${formatTime(request.dueDate)}`,
          timestamp: dueDate,
          priority: 1,
        });
      }
    });

    return items.sort((a, b) => a.priority - b.priority || b.timestamp - a.timestamp).slice(0, 20);
  }, [branchBorrowRequests, currentLibraryId, notificationNow]);

  const handleOverdueFollowUp = async (notification) => {
    await sendDueDateFollowUp(notification.requestId);
  };
  const [importError, setImportError] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [importingBooks, setImportingBooks] = useState(false);

  const handleFileUpload = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportError('');
    setImportMessage('');
    if (!currentLibraryId) {
      setImportError('Your account has no assigned branch. Contact a super-admin.');
      return;
    }
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'json'].includes(extension)) {
      setImportError('Choose a .csv or .json book file.');
      return;
    }
    setImportingBooks(true);
    const importRows = async (records) => {
      try {
        if (!Array.isArray(records)) {
          throw new Error('The file must contain a JSON array of book records.');
        }
        const booksToInsert = records.map((record) => ({
          ...record,
          library_id: currentLibraryId,
        }));
        await addBooksBulk(booksToInsert);
        setImportMessage(`${records.length} book${records.length === 1 ? '' : 's'} imported to your branch.`);
      } catch (error) {
        setImportError(error.message || 'Unable to import books.');
      } finally {
        setImportingBooks(false);
      }
    };
    if (extension === 'json') {
      file.text()
        .then((text) => importRows(JSON.parse(text)))
        .catch((error) => {
          setImportError(error.message || 'The JSON file could not be parsed.');
          setImportingBooks(false);
        });
      return;
    }
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data, errors }) => {
        if (errors.length) {
          setImportError(`CSV parsing failed on row ${errors[0].row + 1}: ${errors[0].message}`);
          setImportingBooks(false);
          return;
        }
        importRows(data);
      },
      error: (error) => {
        setImportError(error.message || 'The CSV file could not be parsed.');
        setImportingBooks(false);
      },
    });
  };

  const [locallyConfirmedPickups, setLocallyConfirmedPickups] = useState([]);
  const today = new Date().toDateString();
  const todaysVisits = branchAttendance.filter(
    (a) => new Date(a.timeIn).toDateString() === today
  ).length;
  const pendingPickups = branchBorrowRequests.filter(
    (r) => r.status === 'ready_for_pickup' && !locallyConfirmedPickups.includes(r.id)
  ).length;
  const activeBorrows = branchBorrowRequests.filter(
    (r) => r.status === 'borrowed' || locallyConfirmedPickups.includes(r.id)
  ).length;
  const overdue = branchBorrowRequests.filter(
    (r) => r.status === 'borrowed' && new Date(r.dueDate) < new Date()
  ).length;

  const handleBorrowConfirmed = (requestId) => {
    setLocallyConfirmedPickups((current) =>
      current.includes(requestId) ? current : [...current, requestId]
    );
  };

  return (
    <div className="subadmin-dashboard flex h-screen overflow-hidden bg-slate-100 text-slate-800">
      {/* SIDEBAR */}
      <aside className="subadmin-sidebar sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-slate-800 bg-[#0a192f] text-white shadow-lg">
        <div className="p-5 border-b border-white/10">
          <p className="font-extrabold tracking-wider">SHELF ILMS</p>
          <p className="text-xs text-slate-400 mt-1">Sub-Admin Console</p>
        </div>
        <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
          {NAV.map(({ Icon, ...item }) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigateToSection(item.id)}
              className={`w-full text-left text-sm px-3 py-2.5 rounded-lg transition ${
                section === item.id
                  ? 'bg-blue-600/30 font-bold text-amber-300 shadow-[inset_3px_0_0_0_#f59e0b]'
                  : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              <Icon size={18} className="mr-3 inline-block align-[-3px]" aria-hidden="true" />
              {item.label}
            </button>
          ))}

          {/* REPORTS & SERVICES */}
          <button
            type="button"
            onClick={() => setExpandedGroups((prev) => ({ ...prev, reports: !prev.reports }))}
            aria-expanded={expandedGroups.reports}
            className="w-full flex items-center justify-between text-left text-sm px-3 py-2.5 rounded-lg text-slate-300 hover:bg-white/5 transition"
          >
            <span>Reports &amp; Services</span>
            <ChevronDown size={16} className={`transition-transform ${expandedGroups.reports ? 'rotate-180' : ''}`} />
          </button>
          {expandedGroups.reports && (
            <div className="ml-3 border-l border-white/15 pl-2 space-y-1">
              {[{ id: 'reports', label: 'Reports' }, { id: 'analytics', label: 'Analytics' }].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { setWorkspaceTab(item.id); navigateToSection('workspace'); }}
                  className={`w-full text-left text-sm px-3 py-2 rounded-lg transition ${
                    section === 'workspace' && workspaceTab === item.id
                      ? 'bg-blue-600/30 font-bold text-amber-300'
                      : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}

          {/* COMMUNICATION */}
          <button
            type="button"
            onClick={() => setExpandedGroups((prev) => ({ ...prev, communication: !prev.communication }))}
            aria-expanded={expandedGroups.communication}
            className="w-full flex items-center justify-between text-left text-sm px-3 py-2.5 rounded-lg text-slate-300 hover:bg-white/5 transition"
          >
            <span>Communication</span>
            <ChevronDown size={16} className={`transition-transform ${expandedGroups.communication ? 'rotate-180' : ''}`} />
          </button>
          {expandedGroups.communication && (
            <div className="ml-3 border-l border-white/15 pl-2 space-y-1">
              {[{ id: 'feedback', label: 'Feedback' }, { id: 'announcements', label: 'Announcements' }].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { setWorkspaceTab(item.id); navigateToSection('workspace'); }}
                  className={`w-full text-left text-sm px-3 py-2 rounded-lg transition ${
                    section === 'workspace' && workspaceTab === item.id
                      ? 'bg-blue-600/30 font-bold text-amber-300'
                      : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </nav>
       
        <div className="p-4 border-t border-white/10 space-y-3">
          <p className="text-xs text-slate-400">Signed in as</p>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white wrap-break-words">{user?.name || 'Sub-Admin'}</p>
            <div className="mt-1 flex items-start gap-2">
              <Building2 size={14} className="mt-0.5 shrink-0 text-amber-300" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-amber-300">Sub-Admin</p>
                <p className="text-xs text-slate-300 wrap-break-words">{currentBranchName || 'Branch not found'}</p>
              </div>
            </div>
          </div>
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
      <main className="h-screen min-w-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6 lg:p-8">
        
        {/* CUSTOMIZED WELCOME HERO WITH UPPER RIGHT NOTIFICATIONS */}
        <CustomDashboardWelcome
          name={user?.name?.split(' ')[0]}
          description={`Manage circulation, reservations, and inventory${currentBranchName ? ` for ${currentBranchName}` : ' for your assigned branch'}.`}
          notifications={branchNotifications}
          onNotificationFollowUp={handleOverdueFollowUp}
          onNotificationClick={(notification) => {
            const requestId = notification.recordId || notification.requestId;
            const target = branchBorrowRequests.find(
              (request) => String(request.id) === String(requestId)
            );
            setFocusRequestId(requestId);
            setFocusNotificationType(notification.type);
            setNotificationTargetMessage(
              target
                ? ''
                : 'This notification refers to a request that no longer exists in your assigned branch or has already been removed.'
            );
            setSection(notification.targetSection);
          }}
          actions={[
            { label: 'Scan Visitor QR', Icon: QrCode, onClick: () => navigateToSection('attendance') },
            { label: 'Open Inventory', Icon: BookOpen, onClick: () => navigateToSection('inventory') },
            { label: 'Review Queue', Icon: Clock3, onClick: () => navigateToSection('queue') },
          ]}
        />

        {/* OVERVIEW SECTION */}
        {section === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <StatCard label="Visits Today" value={todaysVisits} tone="blue" />
              <StatCard label="Pending Pickups" value={pendingPickups} tone="amber" />
              <StatCard label="Active Borrows" value={activeBorrows} />
              <StatCard label="Overdue Items" value={overdue} tone="red" />
              <StatCard label="Branch Books" value={branchBooks.length} tone="book" />
            </div>

            {/* OVERVIEW CHARTS */}
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <AttendanceTrendChart attendance={branchAttendance} />
              <BorrowingStatusChart requests={branchBorrowRequests} />
            </div>

            {/* BRANCH DATA MANAGEMENT CARD */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
              <div className="border-b border-slate-100 pb-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    Branch Data Management &amp; Reports
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Export records or import data specifically for your assigned library branch.
                  </p>
                </div>
                
                {/* IMPORT BUTTON WITH TOOLTIP */}
                <div
                  className="relative inline-block"
                  onMouseEnter={() => setShowImportGuide(true)}
                  onMouseLeave={() => setShowImportGuide(false)}
                >
                  <label className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3.5 py-2 rounded-lg cursor-pointer transition flex items-center shadow-sm">
                    <Upload size={14} className="mr-1.5 inline-block" aria-hidden="true" />
                    {importingBooks ? 'Importing...' : 'Import Books'}
                    <input
                      type="file"
                      accept=".csv,.json,text/csv,application/json"
                      onChange={handleFileUpload}
                      disabled={importingBooks}
                      className="hidden"
                    />
                  </label>

                  {showImportGuide && (
                    <div className="absolute right-0 bottom-full mb-2 w-80 p-4 bg-sky-50 border border-sky-200 rounded-xl shadow-2xl z-50 text-xs text-sky-950 pointer-events-none transition-all">
                      <div className="flex items-center gap-1.5 font-bold text-sky-900 mb-2">
                        <Info size={16} className="text-sky-600" />
                        <span>Book Import Guide</span>
                      </div>
                     
                      <div className="space-y-1.5 leading-relaxed">
                        <p>
                          <span className="font-semibold text-rose-600">Required:</span>{' '}
                          <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">title</code>,{' '}
                          <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">author</code>,{' '}
                          <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">ISBN</code>,{' '}
                          <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">category</code>,{' '}
                          <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">stock count</code>
                        </p>
                        <p>
                          <span className="font-semibold text-slate-600">Optional:</span>{' '}
                          <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">shelf_location</code>,{' '}
                          <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">summary</code>,{' '}
                          <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">cover_url</code>
                        </p>
                        <p className="pt-1.5 text-[11px] text-sky-700 italic border-t border-sky-200/80 mt-2">
                          Accepts .CSV format or JSON array files.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {importError && (
                <p role="alert" className="border border-red-200 bg-red-50 p-3 text-sm text-red-800 rounded-lg">{importError}</p>
              )}
              {importMessage && (
                <p role="status" className="border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 rounded-lg">{importMessage}</p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                {/* EXPORT BRANCH BOOKS */}
                <div className="p-3.5 border border-slate-100 bg-slate-50/50 rounded-lg flex items-center justify-between">
                  <div>
                    <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700"><BookOpen size={14} aria-hidden="true" /> Branch Books Inventory</p>
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

                {/* EXPORT BRANCH ATTENDANCE */}
                <div className="p-3.5 border border-slate-100 bg-slate-50/50 rounded-lg flex items-center justify-between">
                  <div>
                    <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700"><Activity size={14} aria-hidden="true" /> Branch Visitor Attendance</p>
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

        {focusRequestId && section !== 'overview' && (() => {
          const request = branchBorrowRequests.find((item) => String(item.id) === String(focusRequestId));
          const status = String(request?.status || '').toLowerCase();
          const handled =
            (focusNotificationType === 'reservation' &&
              !['pending', 'queued'].includes(status)) ||
            (focusNotificationType === 'pickup' &&
              status !== 'ready_for_pickup') ||
            (focusNotificationType === 'overdue' &&
              status !== 'borrowed');
          return request ? (
            <section id={`admin-request-${request.id}`} className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
              <h2 className="text-sm font-bold text-amber-900">
                Selected request: {request.bookTitle || 'Untitled book'}
              </h2>
              <p className="mt-1 text-xs text-amber-800">
                {request.visitorName || 'Visitor'} · {request.status}
                {request.dueDate ? ` · Due ${formatDateTime(request.dueDate)}` : ''}
                {request.pickupDeadline ? ` · Pickup deadline ${formatDateTime(request.pickupDeadline)}` : ''}
              </p>
              {handled && (
                <p className="mt-2 text-xs font-semibold text-amber-900">
                  This notification has already been handled or is no longer actionable.
                </p>
              )}
            </section>
          ) : (
            <section id={`admin-request-${focusRequestId}`} role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              {notificationTargetMessage || 'This request was removed or is no longer available in your assigned branch.'}
            </section>
          );
        })()}

        {/* SECTION ROUTING */}
        {section === 'attendance' && <AttendanceScanner />}
        {section === 'transactions' && (
          <QRBookBorrowing
            user={user}
            onBorrowConfirmed={handleBorrowConfirmed}
            confirmPickup={confirmPickup}
            confirmReturn={confirmReturn}
          />
        )}
        {section === 'inventory' && <BookInventory />}
        {section === 'queue' && (
          <ReservationQueue user={user} focusRequestId={focusRequestId} />
        )}
        {section === 'map' && (
          <LibraryMap
            libraryScopeId={currentLibraryId}
            focusBranchId={currentLibraryId || null}
          />
        )}
        {section === 'workspace' && (
          <AdminWorkspace
            key={`${workspaceTab}-${['feedback', 'announcements'].includes(workspaceTab) ? 'communication' : 'reports'}`}
            mode={['feedback', 'announcements'].includes(workspaceTab) ? 'communication' : 'reports'}
            initialTab={workspaceTab}
            user={user}
            libraries={libraries}
            books={branchBooks}
            borrowRequests={borrowRequests}
            attendanceLogs={branchAttendance}
          />
        )}
      </main>
    </div>
  );
}