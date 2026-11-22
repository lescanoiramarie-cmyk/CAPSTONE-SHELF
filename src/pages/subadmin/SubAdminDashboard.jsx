import { lazy, Suspense, useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { Bar, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
} from 'chart.js';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ClipboardList,
  Clock3,
  CircleDollarSign,
  MapPinned,
  QrCode,
  Building2,
  Upload,
  UsersRound,
  Info,
  MessageSquare,
  Sparkles,
  ArrowUpRight,
  Calendar,
  Clock,
  FileText,
  X,
  Settings,
} from 'lucide-react';
import VisitorScanDetails from '../../component/VisitorScanDetails.jsx';
import PreferredLanguageSetting from '../../component/PreferredLanguageSetting.jsx';
import SubAdminTermsContent, {
  SUBADMIN_TERMS_VERSION,
} from '../../component/SubAdminTermsContent.jsx';
import { useAuth } from '../../context/useAuth.js';
import { useLanguage } from '../../context/LanguageContext.jsx';
import ShelfHeader from '../../component/ShelfHeader.jsx';
import { useLibrary, useLibraryData } from '../../context/useLibrary.js';
import AttendanceScanner from '../../component/AttendanceScanner.jsx';
import BookInventory from '../../component/BookInventory.jsx';
import ReservationQueue from '../../component/ReservationQueue.jsx';
import AdminWorkspace from '../../component/AdminWorkspace.jsx';
import ExportConfirmationDialog from '../../component/ExportConfirmationDialog.jsx';
import BookRatingsChart from '../../component/BookRatingsChart.jsx';
import LibraryMap from '../../component/LibraryMap.jsx';
import DashboardDataBoundary from '../../component/DashboardDataBoundary.jsx';
import AdminAnalyticsPanel from '../../component/AdminAnalyticsPanel.jsx';
import FinePayments from '../../component/FinePayments.jsx';
import SubscriptionManagement from '../../component/SubscriptionManagement.jsx';
import PremiumFeatureGate from '../../component/PremiumFeatureGate.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import Papa from 'papaparse';
import { findVisitorByQr } from '../../data/store.js';
import { validateImportedBookFineRates } from '../../lib/bookFineRate.js';
import { sendDueDateFollowUp } from '../../lib/dueDateFollowUp.js';
import {
  buildBranchAuditAnalytics,
  buildBranchAuditRows,
} from '../../lib/inventoryReportUtils.js';
import {
  buildAttendanceRows,
  buildAttendanceSummary,
  buildSubAdminAttendanceAnalytics,
} from '../../lib/attendanceReportUtils.js';
import {
  filterRequestsForLibrary,
  filterRowsForLibrary,
  getAnalyticsMonthKey,
  getAnalyticsMonthOptionsForYear,
  getAnalyticsYearOptions,
  getAnalyticsMonthWindow,
} from '../../lib/dashboardAnalytics.js';

const VisitorAccountManagement = lazy(
  () => import('../../component/VisitorAccountManagement.jsx')
);

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend);

const NAV = [
  { id: 'overview', label: 'Overview', Icon: Activity },
  { id: 'visitors', label: 'Visitor Accounts', Icon: UsersRound },
  { id: 'attendance', label: 'Attendance', Icon: QrCode },
  { id: 'transactions', label: 'Book Transactions', Icon: BookOpen },
  { id: 'fines', label: 'Fine Payments', Icon: CircleDollarSign },
  { id: 'subscription', label: 'Plan & Subscription', Icon: Building2 },
  { id: 'inventory', label: 'Inventory', Icon: ClipboardList },
  { id: 'queue', label: 'Reservation Queue', Icon: Clock3 },
  { id: 'map', label: 'Branch Map', Icon: MapPinned },
  { id: 'settings', label: 'Settings', Icon: Settings },
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

function getSubAdminTermsErrorMessage(error, action) {
  if (['PGRST202', '42883', '42P01'].includes(error?.code)) {
    return 'The terms acknowledgment setup is not available yet. Please ask your system administrator to apply the terms acknowledgment database migration.';
  }

  return action === 'verify'
    ? 'We could not verify your terms acceptance. Please try again or contact your system administrator.'
    : 'We could not save your acceptance. Please check your connection and try again.';
}

function AttendanceTrendChart({ attendance = [], monthKey }) {
  const monthWindow = getAnalyticsMonthWindow(monthKey);
  if (!monthWindow) return null;
  const { start: firstDayOfMonth, endExclusive: firstDayOfNextMonth, days: daysInMonth, monthLabel } = monthWindow;
  const dailyCounts = Array.from({ length: daysInMonth }, (_, index) => ({
    day: index + 1,
    count: 0,
  }));

  attendance.forEach((record) => {
    const timestamp = record.timeIn || record.time_in;
    if (!timestamp) return;
    const recordDate = new Date(timestamp);
    if (
      Number.isNaN(recordDate.getTime()) ||
      recordDate < firstDayOfMonth ||
      recordDate >= firstDayOfNextMonth
    ) return;
    dailyCounts[recordDate.getDate() - 1].count += 1;
  });
  const attendanceTotal = dailyCounts.reduce((total, day) => total + day.count, 0);
  const maxCount = Math.max(1, ...dailyCounts.map((day) => day.count));
  const calendarCells = [
    ...Array(firstDayOfMonth.getDay()).fill(null),
    ...dailyCounts,
  ];
  const getIntensityClass = (count) => {
    if (count === 0) return 'border-slate-100 bg-slate-50 text-slate-400';
    const ratio = count / maxCount;
    if (ratio >= 0.75) return 'border-blue-500 bg-blue-500 text-white';
    if (ratio >= 0.5) return 'border-blue-300 bg-blue-200 text-blue-900';
    if (ratio >= 0.25) return 'border-blue-200 bg-blue-100 text-blue-800';
    return 'border-blue-100 bg-blue-50 text-blue-700';
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-blue-700">Descriptive analytics</p>
          <h3 className="text-sm font-bold text-slate-800">Library visits</h3>
          <p className="mt-1 text-xs text-slate-500">Daily check-ins · {monthLabel}</p>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Visits this month</p>
          <p className="text-lg font-bold leading-tight tabular-nums text-slate-800">{attendanceTotal.toLocaleString()}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1.5" role="grid" aria-label={`Daily visitor check-ins for ${monthLabel}`}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((weekday) => (
          <div key={weekday} role="columnheader" className="pb-1 text-center text-xs font-semibold uppercase tracking-wide text-slate-400 sm:text-xs">
            {weekday}
          </div>
        ))}
        {calendarCells.map((day, index) => day ? (
          <div
            key={day.day}
            role="gridcell"
            title={`${monthLabel} ${day.day}: ${day.count} check-ins`}
            aria-label={`${monthLabel} ${day.day}: ${day.count} check-ins`}
            className={`flex min-h-9 flex-col justify-between rounded-md border p-1 transition-colors sm:min-h-10 sm:p-1.5 ${getIntensityClass(day.count)}`}
          >
            <span className="text-[10px] font-semibold leading-none text-slate-500">Day {day.day}</span>
            <span className="mt-1 inline-flex w-fit items-center rounded-full bg-white/80 px-1.5 py-1 text-xs font-bold leading-none tabular-nums text-shelf-primary shadow-sm sm:text-sm">
              {day.count}<span className="ml-1 text-[9px] font-semibold">visits</span>
            </span>
          </div>
        ) : (
          <div key={`empty-${index}`} aria-hidden="true" />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-slate-500" aria-label="Attendance chart legend">
        <span className="mr-auto font-medium">Day number <span className="text-slate-300">/</span> visits</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm border border-slate-100 bg-slate-50" />0</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm border border-blue-100 bg-blue-50" />Low</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm border border-blue-300 bg-blue-200" />Medium</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm border border-blue-500 bg-blue-500" />High</span>
      </div>
      {attendanceTotal === 0 && (
        <p className="mt-2 text-center text-xs text-slate-500">No attendance records for {monthLabel}.</p>
      )}
    </div>
  );
}

function BorrowingActivityTrendChart({ requests = [], monthKey, loadError = '' }) {
  const monthWindow = getAnalyticsMonthWindow(monthKey);
  if (!monthWindow) return null;
  const { start: firstDayOfMonth, endExclusive: firstDayOfNextMonth, days: daysInMonth, monthLabel } = monthWindow;
  const firstWeekday = firstDayOfMonth.getDay();
  const weekCount = Math.ceil((firstWeekday + daysInMonth) / 7);
  const weeks = Array.from({ length: weekCount }, (_, index) => {
    const firstDate = Math.max(1, index * 7 - firstWeekday + 1);
    const lastDate = Math.min(daysInMonth, (index + 1) * 7 - firstWeekday);
    return {
      label: `${firstDayOfMonth.toLocaleDateString('en-US', { month: 'short' })} ${firstDate}–${lastDate}`,
      requests: 0,
      borrows: 0,
      returns: 0,
    };
  });

  const addEventsForDate = (dateValue, eventType) => {
    if (!dateValue) return;
    const date = new Date(dateValue);
    if (
      Number.isNaN(date.getTime()) ||
      date < firstDayOfMonth ||
      date >= firstDayOfNextMonth
    ) return;
    const weekIndex = Math.floor((date.getDate() - 1 + firstWeekday) / 7);
    weeks[weekIndex][eventType] += 1;
  };

  requests.forEach((request) => {
    addEventsForDate(request.requestDate || request.request_date, 'requests');
    addEventsForDate(request.borrowDate || request.borrow_date, 'borrows');
    addEventsForDate(request.returnDate || request.return_date, 'returns');
  });

  const totals = weeks.reduce((sum, week) => ({
    requests: sum.requests + week.requests,
    borrows: sum.borrows + week.borrows,
    returns: sum.returns + week.returns,
  }), { requests: 0, borrows: 0, returns: 0 });
  const hasActivity = totals.requests + totals.borrows + totals.returns > 0;
  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-blue-700">Descriptive analytics</p>
          <h3 className="text-sm font-bold text-slate-800">Borrowing activity by week</h3>
          <p className="mt-1 text-xs text-slate-500">Compares requests, confirmed pickups, and returns by week in {monthLabel}.</p>
        </div>
      </div>
      {loadError ? (
        <p role="status" className="my-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900">Borrowing analytics could not load. Check the borrowing-history RPC error before using these numbers.</p>
      ) : !hasActivity ? (
        <p className="py-10 text-center text-sm text-slate-500">
          No borrowing activity recorded for {monthLabel}.
        </p>
      ) : (
        <div className="mt-4 flex min-h-55 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <Line
            data={{
              labels: weeks.map((week) => week.label),
              datasets: [
                { label: 'Requests', data: weeks.map((week) => week.requests), borderColor: '#2563eb', backgroundColor: '#2563eb', tension: 0.3, pointRadius: 3 },
                { label: 'Borrows', data: weeks.map((week) => week.borrows), borderColor: '#d97706', backgroundColor: '#d97706', tension: 0.3, pointRadius: 3 },
                { label: 'Returns', data: weeks.map((week) => week.returns), borderColor: '#059669', backgroundColor: '#059669', tension: 0.3, pointRadius: 3 },
              ],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
              plugins: {
                legend: { position: 'bottom' },
                tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${context.raw} records` } },
              },
            }}
            />
          </div>
          <p className="mt-1 text-right text-xs text-slate-400">Weekly activity for {monthLabel}</p>
        </div>
      )}
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
        <div><p className="text-sm font-bold tabular-nums text-blue-700">{loadError ? '—' : totals.requests.toLocaleString()}</p><p className="text-xs text-slate-500">Requests</p></div>
        <div><p className="text-sm font-bold tabular-nums text-amber-600">{loadError ? '—' : totals.borrows.toLocaleString()}</p><p className="text-xs text-slate-500">Borrows</p></div>
        <div><p className="text-sm font-bold tabular-nums text-emerald-600">{loadError ? '—' : totals.returns.toLocaleString()}</p><p className="text-xs text-slate-500">Returns</p></div>
      </div>
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

// CUSTOM WELCOME COMPONENT
function CustomDashboardWelcome({
  name,
  description,
  actions = [],
}) {
  return (
    <div className="relative bg-white rounded-2xl p-6 sm:p-8 border border-slate-200/80 shadow-sm space-y-6">
      
      {/* TOP RIGHT ACTION BAR (ONLINE BADGE) */}
      <div className="absolute top-6 right-4 z-20 flex items-center gap-3">
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
          SHELF
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
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
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
                  <span className="text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-transform">
                    <ArrowUpRight size={16} aria-hidden="true" />
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
  const { t } = useLanguage();
  const { borrowRequests = [] } = useLibraryData();
  const scannerRef = useRef(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [visitor, setVisitor] = useState(null);
  const [visitorRequests, setVisitorRequests] = useState([]);
  const [manualQrValue, setManualQrValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmingRequestId, setConfirmingRequestId] = useState(null);
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
          'Visitor not found. Please scan a valid SHELF visitor QR code.'
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
            fine_rate_snapshot,
            fine_review_required,
            fine_review_resolved_at,
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
        fineRateSnapshot: r.fine_rate_snapshot,
        fineReviewRequired: r.fine_review_required === true,
        fineReviewResolvedAt: r.fine_review_resolved_at || null,
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
            fps: 15,
            videoConstraints: { width: { ideal: 1280 }, height: { ideal: 960 } },
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const size = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.92);
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
    setConfirmingRequestId(request.id);
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
      setConfirmingRequestId(null);
    }
  };

  const handleConfirmReturn = async (request) => {
    if (!request?.id) return;
    setConfirmingRequestId(request.id);
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
      setConfirmingRequestId(null);
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
      <header className="flex flex-col gap-2 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Circulation</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-shelf-primary">Book transactions</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">Review visitor requests and record book pickups and returns.</p>
        </div>
        <span className="inline-flex w-fit items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">{visitor ? 'Visitor verified' : 'Ready to scan'}</span>
      </header>

      {/* QR BORROWING HEADER */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50/70 p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">Borrowing and returns</p>
            <h3 className="mt-1 text-lg font-semibold text-slate-900">Start with the visitor's QR pass</h3>
            <p className="mt-1 text-sm leading-5 text-slate-600">Scan the pass to find what they can pick up or return.</p>
          </div>
          <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50/80 p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-shelf-primary text-white"><QrCode size={24} aria-hidden="true" /></span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">Step 1 of 3</p>
                  <h3 className="mt-1 text-xl font-semibold leading-7 text-slate-900">Scan the visitor's QR pass</h3>
                  <p className="mt-1 max-w-xl text-sm leading-5 text-slate-600">This loads the visitor's ready pickups and active loans.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={startScanner}
                disabled={scanning || loading}
                className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-shelf-primary px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-blue-900 focus:outline-none focus:ring-4 focus:ring-blue-300/60 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <QrCode size={20} aria-hidden="true" />
                {scanning ? 'Camera is shown below' : 'Scan visitor QR with camera'}
              </button>
            </div>
            <ol className="mt-5 grid gap-3 border-t border-blue-200 pt-4 text-sm sm:grid-cols-3">
              <li className="flex items-start gap-2.5"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-xs font-bold text-blue-800">1</span><span className="leading-5 text-slate-700">Scan the visitor pass.</span></li>
              <li className="flex items-start gap-2.5"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-xs font-bold text-blue-800">2</span><span className="leading-5 text-slate-700">Check the visitor and their book requests.</span></li>
              <li className="flex items-start gap-2.5"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-xs font-bold text-blue-800">3</span><span className="leading-5 text-slate-700">Confirm pickup or return after checking the book.</span></li>
            </ol>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-semibold text-slate-700">Or enter the visitor QR value manually</p>
            <form onSubmit={handleManualQrSubmit} className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor="subadmin-visitor-qr">Visitor QR value</label>
              <input
                id="subadmin-visitor-qr"
                value={manualQrValue}
                onChange={(event) => setManualQrValue(event.target.value)}
                placeholder="Enter visitor QR value"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <button
                type="submit"
                disabled={loading || !manualQrValue.trim()}
                className="rounded-lg bg-slate-800 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
              >
                {loading ? 'Checking...' : 'Find visitor'}
              </button>
            </form>
          </div>
        </div>

        {/* CAMERA SCANNER */}
        {showScanner && (
          <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/75 p-4 backdrop-blur-sm">
            <div className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-blue-200 bg-white shadow-2xl">
              <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-800">Scan Visitor QR Code</p>
                  <p className="text-sm text-slate-600 mt-1">Hold the visitor pass in front of the camera. It will scan automatically.</p>
                </div>
                <button type="button" onClick={stopScanner} className="text-xs font-bold text-red-600 hover:text-red-800">{t('Close')}</button>
              </div>
              <div className="p-4">
                <div className="mx-auto aspect-4/3 w-full max-w-3xl overflow-hidden rounded-xl border-2 border-shelf-primary bg-black">
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
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
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
                    {t('Clear')}
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
                    Confirm the book only after checking the physical book and the visitor’s identity.
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
                            <p className="font-display text-lg font-semibold text-slate-800">{request.bookTitle}</p>
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
                              disabled={Boolean(confirmingRequestId)}
                              className="bg-shelf-accent text-white px-5 py-2.5 rounded-lg text-xs font-bold hover:brightness-90 transition disabled:opacity-50"
                            >
                              {confirmingRequestId === request.id ? 'Confirming...' : 'Confirm borrowing'}
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
                          <p className="font-display text-lg font-semibold text-blue-900">{request.bookTitle}</p>
                          {request.bookAuthor && <p className="mt-1 text-xs text-blue-700">Author: {request.bookAuthor}</p>}
                          {request.bookIsbn && <p className="text-xs text-blue-700">ISBN: {request.bookIsbn}</p>}
                          <p className="mt-1 text-xs font-semibold text-blue-700">Status: Borrowed</p>
                          <p className="mt-1 text-xs text-blue-700">Borrowed: {formatDateTime(request.borrowDate)}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-start gap-2 md:items-end">
                        <div className="text-left md:text-right">
                          <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Due Date</p>
                          <p className="text-sm font-extrabold text-blue-900">{formatDateTime(request.dueDate)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleConfirmReturn(request)}
                          disabled={Boolean(confirmingRequestId)}
                          className="rounded-lg bg-emerald-700 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50"
                        >
                          {confirmingRequestId === request.id ? 'Confirming...' : 'Confirm return'}
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
      </section>

    </div>
  );
}

export default function SubAdminDashboard() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { books, borrowRequests, attendanceLogs, libraries, visitorCount } = useLibraryData();
  const [section, setSection] = useState(() => {
    const saved = window.localStorage.getItem('shelf_subadmin_start_page');
    return NAV.some((item) => item.id === saved && item.id !== 'settings') ? saved : 'overview';
  });
  const [overviewMonth, setOverviewMonth] = useState(() => getAnalyticsMonthKey());
  const [overviewYear, setOverviewYear] = useState(() => new Date().getFullYear());
  const overviewMonthOptions = getAnalyticsMonthOptionsForYear(overviewYear);
  const mainContentRef = useRef(null);
  const [focusRequestId, setFocusRequestId] = useState(null);
  const [focusNotificationType, setFocusNotificationType] = useState(null);
  const [notificationTargetMessage, setNotificationTargetMessage] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({ reports: true, communication: false });
  const [workspaceTab, setWorkspaceTab] = useState('reports');
  const [showImportGuide, setShowImportGuide] = useState(false);
  const [showSubAdminTerms, setShowSubAdminTerms] = useState(false);
  const [subAdminTermsStatus, setSubAdminTermsStatus] = useState('loading');
  const [subAdminTermsContent, setSubAdminTermsContent] = useState('');
  const [subAdminTermsVersion, setSubAdminTermsVersion] = useState(SUBADMIN_TERMS_VERSION);
  const [subAdminTermsAcceptedAt, setSubAdminTermsAcceptedAt] = useState(null);
  const [subAdminTermsError, setSubAdminTermsError] = useState('');
  const [isAcceptingSubAdminTerms, setIsAcceptingSubAdminTerms] = useState(false);
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [confirmAdminPassword, setConfirmAdminPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState({ error: '', message: '' });
  const [feedbackPreview, setFeedbackPreview] = useState({ items: [], total: 0, newCount: 0, loading: false, error: '' });
  const [feedbackPreviewLibraryId, setFeedbackPreviewLibraryId] = useState('');
  const {
    addBooksBulk,
    confirmPickup,
    confirmReturn,
    borrowRequestsLoadError,
    retryBorrowRequests,
    loading: libraryLoading,
    initialDataReady,
    attendanceLoadError,
    connectionError,
    refreshAll,
  } = useLibrary();

  const loadSubAdminTermsAcceptance = useCallback(async () => {
    setSubAdminTermsStatus('loading');
    setSubAdminTermsError('');
    try {
      if (!supabase) {
        throw new Error('Terms acceptance cannot be verified because Supabase is unavailable.');
      }

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData?.session?.user?.id) {
        throw new Error('A signed-in staff session is required to verify terms acceptance.');
      }

      const { data: termsDocument, error: termsDocumentError } = await supabase
        .from('system_terms_documents')
        .select('version, content')
        .eq('document_key', 'subadmin')
        .maybeSingle();
      if (termsDocumentError) throw termsDocumentError;
      setSubAdminTermsContent(termsDocument?.content || '');
      setSubAdminTermsVersion(termsDocument?.version || SUBADMIN_TERMS_VERSION);

      const { data, error } = await supabase.rpc(
        'get_subadmin_terms_accepted_at'
      );
      if (error) throw error;

      setSubAdminTermsAcceptedAt(data || null);
      setSubAdminTermsStatus(data ? 'accepted' : 'required');
    } catch (error) {
      console.error('Unable to verify sub-admin terms acceptance:', error);
      setSubAdminTermsError(getSubAdminTermsErrorMessage(error, 'verify'));
      setSubAdminTermsStatus('error');
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadSubAdminTermsAcceptance();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadSubAdminTermsAcceptance]);

  const closeSubAdminTerms = useCallback(async () => {
    if (isAcceptingSubAdminTerms) return;

    if (subAdminTermsStatus === 'accepted') {
      setShowSubAdminTerms(false);
      return;
    }

    await logout();
    navigate('/', { replace: true });
  }, [
    isAcceptingSubAdminTerms,
    logout,
    navigate,
    subAdminTermsStatus,
  ]);

  useEffect(() => {
    if (subAdminTermsStatus === 'accepted' && !showSubAdminTerms) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void closeSubAdminTerms();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeSubAdminTerms, showSubAdminTerms, subAdminTermsStatus]);

  const handleAcceptSubAdminTerms = async () => {
    if (isAcceptingSubAdminTerms) return;

    setIsAcceptingSubAdminTerms(true);
    setSubAdminTermsError('');
    try {
      if (!supabase) {
        throw new Error('Terms acceptance cannot be saved because Supabase is unavailable.');
      }
      const { data, error } = await supabase.rpc('accept_subadmin_terms');
      if (error) throw error;
      if (!data) {
        throw new Error('The system did not confirm that your acceptance was saved.');
      }

      setSubAdminTermsAcceptedAt(data);
      setSubAdminTermsStatus('accepted');
      setShowSubAdminTerms(false);
    } catch (error) {
      console.error('Unable to save sub-admin terms acceptance:', error);
      setSubAdminTermsError(getSubAdminTermsErrorMessage(error, 'save'));
    } finally {
      setIsAcceptingSubAdminTerms(false);
    }
  };

  const updateSubAdminPassword = async (event) => {
    event.preventDefault();
    setPasswordFeedback({ error: '', message: '' });
    if (newAdminPassword.length < 12 || !/[A-Z]/.test(newAdminPassword) || !/[a-z]/.test(newAdminPassword) || !/\d/.test(newAdminPassword) || !/[^A-Za-z0-9]/.test(newAdminPassword)) {
      setPasswordFeedback({ error: 'Use at least 12 characters with uppercase, lowercase, a number, and a symbol.', message: '' });
      return;
    }
    if (newAdminPassword !== confirmAdminPassword) {
      setPasswordFeedback({ error: 'The password confirmation does not match.', message: '' });
      return;
    }
    setPasswordSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newAdminPassword });
      if (error) throw error;
      setNewAdminPassword('');
      setConfirmAdminPassword('');
      setPasswordFeedback({ error: '', message: 'Your password has been updated.' });
    } catch (error) {
      setPasswordFeedback({ error: error?.message || 'Password could not be updated. Please try again.', message: '' });
    } finally {
      setPasswordSaving(false);
    }
  };

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

  useEffect(() => {
    if (mainContentRef.current) mainContentRef.current.scrollTop = 0;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [section, workspaceTab]);

  const navigateToSection = (nextSection) => {
    setFocusRequestId(null);
    setFocusNotificationType(null);
    setNotificationTargetMessage('');
    setSection(nextSection);
  };
  const currentLibraryId = user?.libraryId || user?.assignedBranch || '';
  const [subscriptionRenewalNotifications, setSubscriptionRenewalNotifications] = useState([]);

  useEffect(() => {
    if (section !== 'overview' || !currentLibraryId || !supabase) return undefined;
    let cancelled = false;
    let lastRefreshAt = Date.now();
    const loadSubscriptionNotifications = async () => {
      const { data, error } = await supabase
        .from('staff_notifications')
        .select('id, title, message, created_at')
        .eq('library_id', currentLibraryId)
        .eq('notification_type', 'subscription_renewal')
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(10);
      if (!cancelled) setSubscriptionRenewalNotifications(error ? [] : (data || []));
    };
    void loadSubscriptionNotifications();
    const refreshNotifications = () => {
      const now = Date.now();
      if (document.visibilityState === 'visible' && now - lastRefreshAt >= 30_000) {
        lastRefreshAt = now;
        void loadSubscriptionNotifications();
      }
    };
    const timer = setInterval(refreshNotifications, 5 * 60_000);
    document.addEventListener('visibilitychange', refreshNotifications);
    window.addEventListener('focus', refreshNotifications);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshNotifications);
      window.removeEventListener('focus', refreshNotifications);
    };
  }, [section, currentLibraryId]);

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
      (b) => String(b.libraryId ?? b.library_id ?? '') === String(currentLibraryId)
    );
  }, [books, currentLibraryId]);

  const branchAttendance = useMemo(() => {
    return filterRowsForLibrary(attendanceLogs, currentLibraryId);
  }, [attendanceLogs, currentLibraryId]);

  const branchBooksById = useMemo(
    () => new Map(books.map((book) => [String(book.id), book])),
    [books]
  );

  const branchBorrowRequests = useMemo(
    () => filterRequestsForLibrary(borrowRequests, branchBooksById, currentLibraryId),
    [borrowRequests, branchBooksById, currentLibraryId]
  );

  const branchOverviewMetrics = useMemo(() => {
    const monthWindow = getAnalyticsMonthWindow(overviewMonth);
    if (!monthWindow) return { topBorrowed: [], categoryBorrowing: [], totalBorrowEvents: 0, comparableBorrowEvents: null, projectedNextMonth: null, pressureTitles: 0, monthLabel: '', comparisonAvailable: false };
    const now = new Date();
    const isCurrentMonth = getAnalyticsMonthKey(now) === overviewMonth;
    const elapsedDays = isCurrentMonth ? now.getDate() : monthWindow.days;
    const previousStart = new Date(monthWindow.start.getFullYear(), monthWindow.start.getMonth() - 1, 1);
    const previousEnd = new Date(previousStart.getFullYear(), previousStart.getMonth(), Math.min(elapsedDays, new Date(previousStart.getFullYear(), previousStart.getMonth() + 1, 0).getDate()) + 1);
    const historyStart = new Date();
    historyStart.setHours(0, 0, 0, 0);
    historyStart.setDate(historyStart.getDate() - 65);
    const comparisonAvailable = previousStart >= historyStart;
    const borrowedCounts = new Map();
    const previousBorrowedCounts = new Map();
    branchBorrowRequests.forEach((request) => {
      const borrowedAt = request.borrowDate || request.borrow_date;
      const timestamp = new Date(borrowedAt || '').getTime();
      if (!Number.isFinite(timestamp)) return;
      const bookId = String(request.bookId ?? request.book_id ?? '');
      if (!bookId) return;
      if (timestamp >= monthWindow.start.getTime() && timestamp < monthWindow.endExclusive.getTime() && new Date(borrowedAt).getDate() <= elapsedDays) {
        borrowedCounts.set(bookId, (borrowedCounts.get(bookId) || 0) + 1);
      } else if (comparisonAvailable && timestamp >= previousStart.getTime() && timestamp < previousEnd.getTime()) {
        previousBorrowedCounts.set(bookId, (previousBorrowedCounts.get(bookId) || 0) + 1);
      }
    });
    const topBorrowed = [...borrowedCounts.entries()]
      .map(([bookId, count]) => {
        const book = branchBooksById.get(bookId);
        const previousCount = comparisonAvailable ? previousBorrowedCounts.get(bookId) || 0 : null;
        const available = Number(book?.availableCopies ?? book?.available_copies ?? 0);
        return {
          book,
          count,
          previousCount,
          projectedNextMonth: count >= 3 ? Math.max(0, Math.round((count / Math.max(1, elapsedDays)) * 30)) : null,
          changePercent: previousCount > 0 ? Math.round(((count - previousCount) / previousCount) * 100) : null,
          available: Number.isFinite(available) ? available : 0,
        };
      })
      .filter((entry) => entry.book)
      .sort((left, right) => right.count - left.count || String(left.book.title).localeCompare(String(right.book.title)))
      .slice(0, 5);
    const categoryBorrowCounts = [...borrowedCounts.entries()].reduce((counts, [bookId, count]) => {
      const book = branchBooksById.get(bookId);
      const category = String(book?.category || book?.bookCategory || book?.book_category || 'Uncategorized').trim() || 'Uncategorized';
      counts.set(category, (counts.get(category) || 0) + count);
      return counts;
    }, new Map());
    const categoryBorrowing = [...categoryBorrowCounts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));
    const totalBorrowEvents = [...borrowedCounts.values()].reduce((total, count) => total + count, 0);
    const comparableBorrowEvents = comparisonAvailable
      ? [...previousBorrowedCounts.values()].reduce((total, count) => total + count, 0)
      : null;
    const projectedNextMonth = totalBorrowEvents >= 3
      ? Math.max(0, Math.round((totalBorrowEvents / Math.max(1, elapsedDays)) * 30))
      : null;
    const pressureTitles = topBorrowed.filter((entry) => entry.count >= 3 && entry.available <= 1).length;
    return { topBorrowed, categoryBorrowing, totalBorrowEvents, comparableBorrowEvents, projectedNextMonth, pressureTitles, monthLabel: monthWindow.monthLabel, comparisonAvailable };
  }, [branchBooks, branchBooksById, branchBorrowRequests, overviewMonth]);

  useEffect(() => {
    if (section !== 'overview') return undefined;
    if (!supabase || !currentLibraryId) return undefined;

    let active = true;
    Promise.all([
      supabase
        .from('visitor_feedback')
        .select('id, visitor_name, subject, message, status, created_at', { count: 'exact' })
        .eq('library_id', currentLibraryId)
        .order('created_at', { ascending: false })
        .limit(3),
      supabase
        .from('visitor_feedback')
        .select('id', { count: 'exact', head: true })
        .eq('library_id', currentLibraryId)
        .eq('status', 'new'),
    ])
      .then(([recentResult, newResult]) => {
        if (!active) return;
        if (recentResult.error) {
          console.error('Sub-admin overview feedback query failed:', recentResult.error);
        }
        if (newResult.error) {
          console.error('Sub-admin overview new-feedback count failed:', newResult.error);
        }
        setFeedbackPreviewLibraryId(currentLibraryId);
        setFeedbackPreview({
          items: recentResult.data || [],
          total: recentResult.count || 0,
          newCount: newResult.error
            ? (recentResult.data || []).filter((item) => item.status === 'new').length
            : newResult.count || 0,
          loading: false,
          error: recentResult.error?.message || '',
        });
      })
      .catch((error) => {
        if (!active) return;
        setFeedbackPreviewLibraryId(currentLibraryId);
        setFeedbackPreview((current) => ({ ...current, loading: false, error: error.message || 'Unable to load feedback.' }));
      });

    return () => { active = false; };
  }, [section, currentLibraryId]);

  const visibleFeedbackPreview = !supabase || !currentLibraryId
    ? { items: [], total: 0, newCount: 0, loading: false, error: '' }
    : feedbackPreviewLibraryId === currentLibraryId
      ? feedbackPreview
      : { items: [], total: 0, newCount: 0, loading: true, error: '' };

  const [notificationNow, setNotificationNow] = useState(() => Date.now());
  const branchNotificationStorageKey = `shelf-read-branch-notifications:${user?.id || 'staff'}:${currentLibraryId || 'unassigned'}`;
  const [storedReadBranchNotifications, setStoredReadBranchNotifications] = useState(() => {
    try {
      const stored = localStorage.getItem(branchNotificationStorageKey);
      return { key: branchNotificationStorageKey, ids: new Set(JSON.parse(stored || '[]').map(String)) };
    } catch {
      return { key: branchNotificationStorageKey, ids: new Set() };
    }
  });
  const readBranchNotificationIds = useMemo(
    () => storedReadBranchNotifications.key === branchNotificationStorageKey
      ? storedReadBranchNotifications.ids
      : new Set(),
    [storedReadBranchNotifications, branchNotificationStorageKey],
  );
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

    subscriptionRenewalNotifications.forEach((notification) => {
      const timestamp = new Date(notification.created_at).getTime();
      items.push({
        id: `subscription-reminder-${notification.id}`,
        notificationId: notification.id,
        type: 'subscription_renewal',
        targetSection: 'subscription',
        title: notification.title,
        message: notification.message,
        timeLabel: Number.isFinite(timestamp) ? formatTime(notification.created_at) : 'Recently',
        timestamp: Number.isFinite(timestamp) ? timestamp : now,
        priority: 0,
      });
    });

    return items.sort((a, b) => a.priority - b.priority || b.timestamp - a.timestamp).slice(0, 20);
  }, [branchBorrowRequests, currentLibraryId, notificationNow, subscriptionRenewalNotifications]);

  const unreadBranchNotifications = useMemo(
    () => branchNotifications.filter((notification) => !readBranchNotificationIds.has(String(notification.id))),
    [branchNotifications, readBranchNotificationIds],
  );

  const handleBranchNotificationClick = async (notification) => {
    const id = String(notification.id || '');
    if (id && notification.type !== 'subscription_renewal') {
      const next = new Set(readBranchNotificationIds);
      next.add(id);
      setStoredReadBranchNotifications({ key: branchNotificationStorageKey, ids: next });
      try {
        localStorage.setItem(
          branchNotificationStorageKey,
          JSON.stringify([...next]),
        );
      } catch { /* private browsing may disable storage */ }
    }

    if (notification.type === 'subscription_renewal') {
      const { error } = await supabase.rpc('mark_subscription_renewal_notification_read', {
        p_notification_id: notification.notificationId,
      });
      if (!error) setSubscriptionRenewalNotifications((current) => current.filter((item) => item.id !== notification.notificationId));
      setSection('subscription');
      return;
    }

    const requestId = notification.recordId || notification.requestId;
    const target = branchBorrowRequests.find((request) => String(request.id) === String(requestId));
    setFocusRequestId(requestId);
    setFocusNotificationType(notification.type);
    setNotificationTargetMessage(
      target ? '' : 'This notification refers to a request that no longer exists in your assigned branch or has already been removed.',
    );
    if (notification.targetSection) setSection(notification.targetSection);
    if (notification.targetTab) setWorkspaceTab(notification.targetTab);
  };

  const handleOverdueFollowUp = async (notification) => {
    await sendDueDateFollowUp(notification.requestId);
  };
  const [importError, setImportError] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [importingBooks, setImportingBooks] = useState(false);
  const [exportingReport, setExportingReport] = useState('');
  const [exportMessage, setExportMessage] = useState('');
  const [exportError, setExportError] = useState('');
  const [pendingExportFile, setPendingExportFile] = useState(null);

  const exportBranchReport = async (report, format) => {
    const reportKey = `${report}-${format}`;
    setExportingReport(reportKey);
    setExportMessage('');
    setExportError('');
    try {
      const { exportReport } = await import('../../lib/excelUtils.js');
      const isBooksReport = report === 'books';
      const reportRows = isBooksReport ? buildBranchAuditRows(branchBooks) : buildAttendanceRows(branchAttendance);
      const reportOptions = {
        reportType: isBooksReport ? 'Branch-Physical-Shelf-Audit' : 'Branch-Visitor-Traffic-Attendance-Log',
        title: isBooksReport ? 'Branch Physical Shelf Audit Report' : 'SHELF Visitor Attendance Summary',
        detailSheetName: isBooksReport ? 'Books' : 'Attendance Raw Data',
        libraryName: currentBranchName || 'Assigned Branch',
        libraries,
        generatedBy: `${user?.name || 'Admin'} (Sub-Admin)`,
        startDate: new Date(),
        endDate: new Date(),
        asOf: isBooksReport,
        ...(report === 'attendance' ? { dateRange: 'All loaded branch attendance records' } : {}),
        summary: [[isBooksReport ? 'Total Titles' : 'Total Visits', reportRows.length]],
        ...(isBooksReport ? {
          columns: [
            { key: 'id', label: 'Book ID' },
            { key: 'title', label: 'Title' },
            { key: 'author', label: 'Author' },
            { key: 'category', label: 'Category' },
            { key: 'isbn', label: 'ISBN' },
            { key: 'shelfLocation', label: 'Shelf Location' },
            { key: 'totalCopies', label: 'Total Copies', type: 'number' },
            { key: 'availableCopies', label: 'Available Copies', type: 'number' },
            { key: 'borrowedCopies', label: 'Borrowed Copies', type: 'number' },
            { key: 'condition', label: 'Condition' },
          ],
          orientation: 'landscape',
          pdfFontSize: 10,
          pdfAnalytics: buildBranchAuditAnalytics(reportRows),
          csvReportType: 'Branch-Physical-Shelf-Audit-Report',
          csvRole: 'Sub-Admin',
        } : {
          attendanceReport: true,
          attendanceSummary: buildAttendanceSummary(reportRows),
          attendanceTotal: reportRows.length,
          attendanceCompleted: reportRows.filter((row) => row.sessionStatus === 'Completed').length,
          attendanceActive: reportRows.filter((row) => row.sessionStatus !== 'Completed').length,
          pdfAnalytics: buildSubAdminAttendanceAnalytics(reportRows),
          pdfRoleBadge: 'SUB-ADMIN',
          pdfFontSize: 10,
          csvReportType: 'Visitor-Attendance',
          csvRole: 'Sub-Admin',
          columns: [
            { key: 'id', label: 'Session ID' },
            { key: 'visitorId', label: 'Visitor ID' },
            { key: 'visitorName', label: 'Visitor Name' },
            { key: 'timeIn', label: 'Time In', type: 'date', dateFormat: 'attendance' },
            { key: 'checkedOutAt', label: 'Time Out', type: 'date', dateFormat: 'attendance', includeDate: false, missingValue: 'Still Inside' },
            { key: 'duration', label: 'Visit Duration' },
            { key: 'sessionStatus', label: 'Status' },
          ],
        }),
      };
      const label = format === 'xlsx' ? 'Excel' : format.toUpperCase();
      const generatedFile = await exportReport(
        reportRows,
        format,
        { ...reportOptions, download: false }
      );
      setPendingExportFile({ ...generatedFile, label });
      setExportMessage(`${label} file is ready. Confirm whether to download it.`);
    } catch {
      setExportError('The report could not be exported. Please try again.');
    } finally {
      setExportingReport('');
    }
  };

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
        const booksWithValidatedFineRates = validateImportedBookFineRates(records);
        const booksToInsert = booksWithValidatedFineRates.map((record) => ({
          ...record,
          library_id: currentLibraryId,
        }));
        const { books, rateMismatches } = await addBooksBulk(booksToInsert);
        const mismatchMessage = rateMismatches.length
          ? ` Existing fine rates were preserved; manual review required for: ${rateMismatches
              .map(({ title, existingRate, importedRate }) =>
                `${title} (existing ₱${existingRate ?? 'unassigned'}, imported ₱${importedRate ?? 'unassigned'})`
              )
              .join(', ')}.`
          : '';
        setImportMessage(
          `${books.length} book${books.length === 1 ? '' : 's'} imported to your branch.${mismatchMessage}`
        );
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
  const registeredVisitors = visitorCount ?? '—';
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

  if (!initialDataReady) {
    return (
      <DashboardDataBoundary
        loading={libraryLoading}
        error={connectionError}
        onRetry={() =>
          refreshAll().catch((error) => {
            console.error('SHELF initial dashboard retry failed:', error);
          })
        }
      />
    );
  }

  return (
    <div className="subadmin-dashboard flex h-dvh min-h-0 w-full overflow-hidden bg-shelf-bg text-slate-800 dark:bg-slate-900 dark:text-slate-100 flex-row">
      {/* SIDEBAR (FULL HEIGHT TO TOP) */}
      <aside className="subadmin-sidebar relative flex h-full w-60 shrink-0 flex-col border-r border-white/10 bg-shelf-primary text-white shadow-lg z-20">
        {/* SHELF BRAND LOGO IN SIDEBAR */}
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
          <button
            type="button"
            onClick={() => navigateToSection('overview')}
            className="flex items-center gap-2.5 text-left cursor-pointer transition hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded-lg"
            aria-label="Go to Sub-Admin dashboard"
          >
            <img src="/shelf-logo.png" alt="" className="h-8 w-8 object-contain" />
            <span className="text-lg font-extrabold tracking-wider text-white">
              SHELF
            </span>
          </button>
        </div>

        {/* SUBADMIN INFO */}
        <div className="p-4 border-b border-white/10">
          <div className="min-w-0 border-l-[3px] border-blue-400 pl-3">
              <div className="flex min-w-0 items-center gap-2">
                <p className="min-w-0 truncate text-sm font-bold leading-tight text-white">{user?.name || 'Sub-admin'}</p>
                <span className="shrink-0 rounded-full border border-blue-200/40 bg-blue-400/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-100">Sub-admin</span>
              </div>
              <p className="mt-1 text-xs font-medium text-blue-100/75">{t('Library console')}</p>
              <div className="mt-2 flex items-start gap-2">
                <Building2 size={13} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
                <p className="min-w-0 text-xs text-slate-300 wrap-break-words">{currentBranchName || 'Branch not found'}</p>
              </div>
            </div>
          </div>
          <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
            {NAV.map(({ Icon, ...item }) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateToSection(item.id)}
                className={`w-full text-left text-sm px-3 py-2.5 rounded-lg transition ${
                  section === item.id
                    ? 'bg-shelf-accent font-bold text-white ring-1 ring-inset ring-blue-200/40 shadow-[0_4px_14px_rgba(37,99,235,0.38)]'
                    : 'text-slate-300 hover:bg-white/5'
                }`}
              >
                <Icon size={18} className="mr-3 inline-block align-[-3px]" aria-hidden="true" />
                {t(item.label)}
              </button>
            ))}

            {/* REPORTS & SERVICES */}
            <button
              type="button"
              onClick={() => setExpandedGroups((prev) => ({ ...prev, reports: !prev.reports }))}
              aria-expanded={expandedGroups.reports}
              className="w-full flex items-center justify-between text-left text-sm px-3 py-2.5 rounded-lg text-slate-300 hover:bg-white/5 transition"
            >
              <span>{t('Reports & services')}</span>
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
                        ? 'bg-shelf-accent/25 font-bold text-white shadow-[inset_2px_0_0_0_#bfdbfe]'
                        : 'text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    {t(item.label)}
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
              <span>{t('Communication')}</span>
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
                        ? 'bg-shelf-accent/25 font-bold text-white shadow-[inset_2px_0_0_0_#bfdbfe]'
                        : 'text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    {t(item.label)}
                  </button>
                ))}
              </div>
            )}
        </nav>
      </aside>

      {/* MAIN WORKSPACE COLUMN */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {/* TOP BAR WITH SHELFHEADER */}
        <ShelfHeader
          showLogo={false}
          notificationCount={unreadBranchNotifications.length}
          notificationItems={branchNotifications.map((item) => ({
            ...item,
            created_at: new Date(item.timestamp).toISOString(),
            read: readBranchNotificationIds.has(String(item.id)),
          }))}
          onNotificationClick={handleBranchNotificationClick}
          profileMenuContent={
            <>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setShowSubAdminTerms(true)}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50"
                >
                  <FileText size={16} aria-hidden="true" />
                  Terms and conditions
                </button>
              </li>
              <li>
                <hr className="my-1 border-slate-200 dark:border-slate-700" />
              </li>
            </>
          }
          showDarkModeToggle={true}
        >
          {/* Breadcrumb & Library Badge in Center */}
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => navigateToSection('overview')}
              className="shrink-0 font-medium text-slate-500 transition hover:text-shelf-accent dark:text-slate-400"
            >
              {t('Dashboard')}
            </button>
            {section !== 'overview' && (
              <>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">/</span>
                <span className="truncate font-semibold text-shelf-primary dark:text-white">
                  {t(section === 'workspace'
                    ? ({ reports: 'Reports', analytics: 'Analytics' }[workspaceTab] || 'Reports')
                    : ({ visitors: 'Visitor Accounts', attendance: 'Attendance', transactions: 'Book Transactions', fines: 'Fine Payments', subscription: 'Plan & Subscription', inventory: 'Inventory', queue: 'Reservation Queue', map: 'Branch Map', settings: 'Settings' }[section] || 'Dashboard'))}
                </span>
              </>
            )}
            <span className="hidden md:inline-flex ml-2 max-w-xs min-w-0 items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <Building2 size={13} className="shrink-0 text-shelf-accent" aria-hidden="true" />
              <span className="truncate">{currentBranchName || 'Assigned library'}</span>
            </span>
          </div>
        </ShelfHeader>

        {/* MAIN CONTENT AREA */}
        <main ref={mainContentRef} className="min-h-0 min-w-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4 sm:p-6 lg:p-8">
        
        {/* Keep the welcome panel on the overview so other sections start at the top. */}
        {section === 'overview' && <CustomDashboardWelcome
          name={user?.name?.split(' ')[0]}
          description={`Manage circulation, reservations, and inventory${currentBranchName ? ` for ${currentBranchName}` : ' for your assigned branch'}.`}
          notifications={branchNotifications}
          onNotificationFollowUp={handleOverdueFollowUp}
          onNotificationClick={handleBranchNotificationClick}
          actions={[
            { label: 'Scan Visitor QR', Icon: QrCode, onClick: () => navigateToSection('attendance') },
            { label: 'Open Inventory', Icon: BookOpen, onClick: () => navigateToSection('inventory') },
            { label: 'Review Queue', Icon: Clock3, onClick: () => navigateToSection('queue') },
          ]}
        />}

        {/* OVERVIEW SECTION */}
        {section === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <StatCard label="Registered Visitors" value={registeredVisitors} tone="blue" />
              <StatCard label="Pending Pickups" value={pendingPickups} tone="amber" />
              <StatCard label="Active Borrows" value={activeBorrows} />
              <StatCard label="Overdue Items" value={overdue} tone="red" />
              <StatCard label="Branch Books" value={branchBooks.length} tone="book" />
            </div>

            {/* OVERVIEW CHARTS */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div><h3 className="text-sm font-bold text-slate-800">Branch activity</h3><p className="mt-0.5 text-xs text-slate-500">Library visits and confirmed book borrows for the selected month.</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">Year<select aria-label="Filter overview charts by year" value={overviewYear} onChange={(event) => { const year = Number(event.target.value); setOverviewYear(year); const lastMonth = year === new Date().getFullYear() ? new Date().getMonth() + 1 : 12; setOverviewMonth(`${year}-${String(lastMonth).padStart(2, '0')}`); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">{getAnalyticsYearOptions().map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">Month<select aria-label="Filter overview charts by month" value={overviewMonth} onChange={(event) => setOverviewMonth(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">{overviewMonthOptions.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}</select></label>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <AttendanceTrendChart attendance={branchAttendance} monthKey={overviewMonth} />
              <BorrowingActivityTrendChart requests={branchBorrowRequests} monthKey={overviewMonth} loadError={borrowRequestsLoadError} />
            </div>
            <div className="space-y-4">
              <AdminAnalyticsPanel
                title="Book borrowing summary"
                description={`${branchOverviewMetrics.monthLabel}. Compare this month with the same number of days last month.`}
                metrics={[
                  { label: 'Books borrowed this month', value: borrowRequestsLoadError ? '—' : branchOverviewMetrics.totalBorrowEvents, note: 'Confirmed book pickups.' },
                  { label: 'Books borrowed in the same days last month', value: borrowRequestsLoadError ? '—' : branchOverviewMetrics.comparableBorrowEvents ?? 'Not available', note: branchOverviewMetrics.comparisonAvailable ? 'The same number of days is compared.' : 'There is not enough past data to compare.' },
                  { label: 'Expected borrows in the next 30 days', value: borrowRequestsLoadError ? '—' : branchOverviewMetrics.projectedNextMonth ?? '—', note: 'Based on borrowing so far this month.' },
                  { label: 'Often borrowed books with 0-1 copies left', value: borrowRequestsLoadError ? '—' : branchOverviewMetrics.pressureTitles, note: 'Borrowed at least 3 times this month, with 0-1 copies available.' },
                ]}
                prediction={borrowRequestsLoadError
                  ? 'Borrowing records could not be loaded, so no estimate is available.'
                  : branchOverviewMetrics.projectedNextMonth == null
                  ? 'There are not enough confirmed borrows yet to estimate the next 30 days. Check again after more borrows are recorded.'
                  : `If borrowing continues at the current pace, the branch may have about ${branchOverviewMetrics.projectedNextMonth} borrows in the next 30 days${branchOverviewMetrics.comparableBorrowEvents >= 3 ? ` (${Math.abs(Math.round(((branchOverviewMetrics.totalBorrowEvents - branchOverviewMetrics.comparableBorrowEvents) / branchOverviewMetrics.comparableBorrowEvents) * 100))}% ${branchOverviewMetrics.totalBorrowEvents >= branchOverviewMetrics.comparableBorrowEvents ? 'more' : 'fewer'} than the same days last month)` : ''}.`}
                recommendation={borrowRequestsLoadError
                  ? 'Try loading borrowing records again before changing copy counts or staff schedules.'
                  : branchOverviewMetrics.pressureTitles
                  ? `Check available copies and pending requests for ${branchOverviewMetrics.topBorrowed.find((entry) => entry.count >= 3 && entry.available <= 1)?.book.title || 'often borrowed books'} before buying or moving copies.`
                  : branchOverviewMetrics.topBorrowed.length
                    ? `Check available copies and pending requests for ${branchOverviewMetrics.topBorrowed[0].book.title} before changing its copy count.`
                    : 'Keep borrowing records up to date and review book availability after each busy month.'}
              />
            </div>
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800" aria-labelledby="branch-top-borrowed-title">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-blue-700">Descriptive analytics</p>
                <h3 id="branch-top-borrowed-title" className="text-sm font-bold text-slate-900 dark:text-white">Most borrowed books - {branchOverviewMetrics.monthLabel}</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Ranked by confirmed pickups during the selected month.</p>
                {borrowRequestsLoadError ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p>Could not load borrowing records: {borrowRequestsLoadError}</p><button type="button" onClick={() => void retryBorrowRequests()} className="mt-2 rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-bold text-white">Try again</button></div> : branchOverviewMetrics.topBorrowed.length ? <ol className="mt-2 space-y-1.5">{branchOverviewMetrics.topBorrowed.map(({ book, count, available }, index) => <li key={book.id} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"><span className="grid h-7 w-7 place-items-center rounded-full bg-blue-50 text-xs font-extrabold text-blue-800 dark:bg-blue-950 dark:text-blue-200">{index + 1}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{book.title || 'Untitled book'}</span><span className="text-xs text-slate-500 dark:text-slate-400">{available} copies available</span></span><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-200">{count} {count === 1 ? 'borrow' : 'borrows'}</span></li>)}</ol> : <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">No confirmed book borrows were recorded this month.</p>}
              </section>
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 xl:self-stretch" aria-labelledby="branch-borrowed-category-title">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-blue-700">Descriptive analytics</p>
                <h3 id="branch-borrowed-category-title" className="text-sm font-bold text-slate-900 dark:text-white">Borrows by category</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Compares confirmed pickups across book categories in {branchOverviewMetrics.monthLabel}.</p>
                {borrowRequestsLoadError ? <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">Category chart is unavailable because borrowing records could not be loaded.</p> : branchOverviewMetrics.categoryBorrowing.length ? <div className="mt-2 h-56"><Bar data={{ labels: branchOverviewMetrics.categoryBorrowing.map(({ category }) => category), datasets: [{ label: 'Books borrowed', data: branchOverviewMetrics.categoryBorrowing.map(({ count }) => count), backgroundColor: '#2563eb', borderRadius: 6, maxBarThickness: 20 }] }} options={{ indexAxis: 'y', responsive: true, maintainAspectRatio: false, color: document.documentElement.classList.contains('dark') ? '#cbd5e1' : '#475569', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => `${context.parsed.x} ${context.parsed.x === 1 ? 'borrow' : 'borrows'}` } } }, scales: { x: { beginAtZero: true, ticks: { precision: 0, stepSize: 1 }, grid: { color: document.documentElement.classList.contains('dark') ? 'rgba(148,163,184,.15)' : 'rgba(148,163,184,.2)' } }, y: { grid: { display: false } } } }} /></div> : <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">No confirmed book borrows were recorded this month.</p>}
              </section>
            </div>
            <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-3">
              <div className="h-full lg:col-span-1 [&>section]:h-full">
                <BookRatingsChart books={branchBooks} fillHeight />
              </div>

              <section className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2" aria-labelledby="feedback-highlight-title">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div className="flex items-start gap-3">
                  <span className="rounded-lg bg-blue-50 p-2 text-blue-700"><MessageSquare size={18} /></span>
                  <div>
                    <h3 id="feedback-highlight-title" className="text-sm font-bold text-slate-800">Feedback highlight</h3>
                    <p className="mt-1 text-xs text-slate-500">Recent visitor feedback for {currentBranchName || 'your branch'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                    {visibleFeedbackPreview.newCount} new
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setWorkspaceTab('feedback');
                      setExpandedGroups((current) => ({ ...current, communication: true }));
                      navigateToSection('workspace');
                    }}
                    className="text-xs font-semibold text-blue-700 hover:text-blue-900"
                  >
                    View all{visibleFeedbackPreview.total ? ` (${visibleFeedbackPreview.total})` : ''}
                  </button>
                </div>
              </div>
              {visibleFeedbackPreview.loading ? (
                <p className="py-5 text-center text-sm text-slate-500">Loading feedback…</p>
              ) : visibleFeedbackPreview.error ? (
                <p role="status" className="py-5 text-center text-sm text-amber-700">Feedback is temporarily unavailable.</p>
              ) : visibleFeedbackPreview.items.length === 0 ? (
                <p className="py-5 text-center text-sm text-slate-500">No visitor feedback for this branch yet.</p>
              ) : (
                <ul className="flex flex-1 flex-col justify-between divide-y divide-slate-100">
                  {visibleFeedbackPreview.items.map((item) => {
                    const status = String(item.status || 'new').replaceAll('_', ' ');
                    return (
                      <li key={item.id} className="flex flex-col gap-2 py-3 first:pt-4 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="truncate text-sm font-semibold text-slate-800">{item.subject || 'Visitor feedback'}</p>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${item.status === 'new' ? 'bg-amber-50 text-amber-800' : item.status === 'answered' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                              {status}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 wrap-break-words text-xs text-slate-500">{item.visitor_name || 'Visitor'} · {item.message || ''}</p>
                        </div>
                        <time className="shrink-0 text-xs text-slate-400" dateTime={item.created_at}>
                          {item.created_at ? new Date(item.created_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'Date unavailable'}
                        </time>
                      </li>
                    );
                  })}
                </ul>
              )}
              </section>
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
                  <label className="bg-shelf-accent hover:brightness-90 text-white text-xs font-bold px-3.5 py-2 rounded-lg cursor-pointer transition flex items-center shadow-sm">
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
                          a positive whole-number{' '}
                          <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">stock_count</code>
                          , <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">fine_rate</code>, and <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">lending_period_days</code>
                        </p>
                        <p>
                          <span className="font-semibold text-slate-600">Optional:</span>{' '}
                          <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">isbn</code>,{' '}
                          <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">category</code>,{' '}
                          <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">shelf_location</code>,{' '}
                          <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">summary</code>,{' '}
                          <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">cover_url</code>
                        </p>
                        <p>
                          You can also use <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">stock</code>,{' '}
                          <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">total_copies</code>, or{' '}
                          <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">copies</code> for stock. If supplied, ISBN must be valid ISBN-10 or ISBN-13.
                        </p>
                        <p>
                          Enter <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">fine_rate</code> as a whole number from 1 to 100 pesos per overdue day, and <code className="bg-sky-100 px-1 py-0.5 rounded text-sky-800 font-mono">lending_period_days</code> as a whole number from 1 to 30. Both are set per book; fine rates are not derived from category. The selected branch is assigned automatically.
                        </p>
                        <p className="pt-1.5 text-xs text-sky-700 italic border-t border-sky-200/80 mt-2">
                          Accepts CSV files with a header row or a JSON array of book records.
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
                    <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700"><BookOpen size={14} aria-hidden="true" /> Branch Physical Shelf Audit</p>
                    <p className="text-xs text-slate-500">Total Books: {branchBooks.length}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => exportBranchReport('books', 'xlsx')}
                      disabled={Boolean(exportingReport)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded transition"
                    >
                      {exportingReport === 'books-xlsx' ? 'Exporting…' : 'Excel'}
                    </button>
                    <button
                      type="button"
                      onClick={() => exportBranchReport('books', 'csv')}
                      disabled={Boolean(exportingReport)}
                      className="bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold px-3 py-1.5 rounded transition"
                    >
                      {exportingReport === 'books-csv' ? 'Exporting…' : 'CSV'}
                    </button>
                    <button
                      type="button"
                      onClick={() => exportBranchReport('books', 'pdf')}
                      disabled={Boolean(exportingReport)}
                      className="bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold px-3 py-1.5 rounded transition"
                    >
                      {exportingReport === 'books-pdf' ? 'Exporting…' : 'PDF'}
                    </button>
                  </div>
                </div>

                {/* EXPORT BRANCH ATTENDANCE */}
                <div className="p-3.5 border border-slate-100 bg-slate-50/50 rounded-lg flex items-center justify-between">
                  <div>
                    <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700"><Activity size={14} aria-hidden="true" /> Branch Visitor Attendance</p>
                    <p className="text-xs text-slate-500">Branch attendance records loaded: {branchAttendance.length.toLocaleString()}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => exportBranchReport('attendance', 'xlsx')}
                      disabled={Boolean(exportingReport)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded transition"
                    >
                      {exportingReport === 'attendance-xlsx' ? 'Exporting…' : 'Excel'}
                    </button>
                    <button
                      type="button"
                      onClick={() => exportBranchReport('attendance', 'csv')}
                      disabled={Boolean(exportingReport)}
                      className="bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold px-3 py-1.5 rounded transition"
                    >
                      {exportingReport === 'attendance-csv' ? 'Exporting…' : 'CSV'}
                    </button>
                    <button
                      type="button"
                      onClick={() => exportBranchReport('attendance', 'pdf')}
                      disabled={Boolean(exportingReport)}
                      className="bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold px-3 py-1.5 rounded transition"
                    >
                      {exportingReport === 'attendance-pdf' ? 'Exporting…' : 'PDF'}
                    </button>
                  </div>
                </div>
              </div>
              {exportMessage && <p role="status" className="mt-3 text-sm text-emerald-700">{exportMessage}</p>}
              {exportError && <p role="alert" className="mt-3 text-sm text-rose-700">{exportError}</p>}
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
        {section === 'fines' && <FinePayments libraryId={currentLibraryId} libraryName={currentBranchName} />}
        {section === 'subscription' && <SubscriptionManagement mode="subadmin" libraryId={currentLibraryId} libraryName={currentBranchName} />}
        {section === 'inventory' && <BookInventory />}
        {section === 'queue' && (
          <ReservationQueue user={user} focusRequestId={focusRequestId} />
        )}
        {section === 'visitors' && (
          <Suspense
            fallback={
              <div role="status" className="rounded-lg bg-white p-5 text-sm text-slate-500">
                Loading visitor accounts…
              </div>
            }
          >
            <VisitorAccountManagement
              mode="subadmin"
              libraryId={currentLibraryId}
              libraryName={currentBranchName}
            />
          </Suspense>
        )}
        {section === 'map' && (
          <LibraryMap
            libraryScopeId={currentLibraryId}
            focusBranchId={currentLibraryId || null}
          />
        )}
        {section === 'settings' && (
          <section className="w-full max-w-6xl space-y-4">
            <header>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">{t('Library console')}</p>
              <h2 className="mt-1 text-2xl font-bold text-shelf-primary">{t('Settings')}</h2>
              <p className="mt-1 text-sm text-slate-600">{t('Manage your dashboard preference and review your account access.')}</p>
            </header>
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <div className="grid min-w-0 content-start gap-4">
                <PreferredLanguageSetting darkMode />
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white">{t('Account security')}</h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('Sub-admin sign-ins require an authenticator code. During setup, scan the same QR code on each phone you want to use.')}</p>
              <form onSubmit={updateSubAdminPassword} className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t('New password')}<input type="password" required autoComplete="new-password" value={newAdminPassword} onChange={(event) => setNewAdminPassword(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal text-slate-900 focus:border-shelf-primary focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white" /></label>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t('Confirm password')}<input type="password" required autoComplete="new-password" value={confirmAdminPassword} onChange={(event) => setConfirmAdminPassword(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal text-slate-900 focus:border-shelf-primary focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white" /></label>
                <p className="text-xs text-slate-500 dark:text-slate-400 sm:col-span-2">{t('At least 12 characters, with uppercase and lowercase letters, a number, and a symbol.')}</p>
                <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><button type="submit" disabled={passwordSaving || !newAdminPassword || !confirmAdminPassword} className="rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{passwordSaving ? 'Updating…' : 'Update password'}</button>{passwordFeedback.message && <p role="status" className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{passwordFeedback.message}</p>}{passwordFeedback.error && <p role="alert" className="text-sm font-semibold text-rose-700 dark:text-rose-400">{passwordFeedback.error}</p>}</div>
              </form>
            </section>
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-blue-50 p-3 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300"><Building2 size={20} aria-hidden="true" /></span>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white">{t('Assigned Branch Overview')}</h3>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('Library profile details and system assignment for this console.')}</p>
                </div>
              </div>
              <dl className="mt-4 divide-y divide-slate-100 text-sm dark:divide-slate-700">
                <div className="flex justify-between gap-4 py-2.5"><dt className="text-slate-500 dark:text-slate-400">{t('Branch Name')}</dt><dd className="text-right font-semibold text-slate-800 dark:text-slate-200">{currentBranchName || 'Assigned Library'}</dd></div>
                <div className="flex justify-between gap-4 py-2.5"><dt className="text-slate-500 dark:text-slate-400">{t('Branch ID')}</dt><dd className="font-mono text-xs text-right font-semibold text-slate-600 dark:text-slate-300">{currentLibraryId || '—'}</dd></div>
                <div className="flex justify-between gap-4 py-2.5"><dt className="text-slate-500 dark:text-slate-400">{t('System Role')}</dt><dd className="text-right font-semibold text-blue-600 dark:text-blue-400">{t('Sub-Administrator')}</dd></div>
              </dl>
            </section>
              </div>
              <div className="grid min-w-0 content-start gap-4">
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white">{t('Administrator account')}</h3>
              <dl className="mt-3 divide-y divide-slate-100 text-sm dark:divide-slate-700">
                <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500 dark:text-slate-400">{t('Name')}</dt><dd className="text-right font-semibold text-slate-800 dark:text-slate-200">{user?.name || 'Sub-Admin'}</dd></div>
                <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500 dark:text-slate-400">{t('Email')}</dt><dd className="break-all text-right font-semibold text-slate-800 dark:text-slate-200">{user?.email || 'Not available'}</dd></div>
                <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500 dark:text-slate-400">{t('Assigned library')}</dt><dd className="text-right font-semibold text-slate-800 dark:text-slate-200">{currentBranchName || 'Not assigned'}</dd></div>
              </dl>
            </section>
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white">{t('Dashboard preferences')}</h3>
              <label htmlFor="subadmin-start-page" className="mt-3 block text-sm font-semibold text-slate-700 dark:text-slate-300">{t('Open this page when I sign in')}</label>
              <select id="subadmin-start-page" defaultValue={window.localStorage.getItem('shelf_subadmin_start_page') || 'overview'} onChange={(event) => window.localStorage.setItem('shelf_subadmin_start_page', event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 focus:border-shelf-primary focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white">
                {NAV.filter((item) => item.id !== 'settings').map((item) => <option key={item.id} value={item.id}>{t(item.label)}</option>)}
              </select>
              <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{t('This preference is saved on this device and used on your next sign-in.')}</p>
            </section>
              </div>
            </div>
          </section>
        )}
        {section === 'workspace' && (
          workspaceTab === 'analytics' ? (
            <PremiumFeatureGate
              libraryId={currentLibraryId}
              onUpgrade={() => navigateToSection('subscription')}
            >
              <AdminWorkspace
                key={`${workspaceTab}-analytics`}
                mode="reports"
                initialTab="analytics"
                user={user}
                libraries={libraries}
                books={branchBooks}
                borrowRequests={borrowRequests}
                attendanceLogs={branchAttendance}
                attendanceDataComplete={initialDataReady && !attendanceLoadError}
              />
            </PremiumFeatureGate>
          ) : (
            <AdminWorkspace
              key={`${workspaceTab}-${['feedback', 'announcements'].includes(workspaceTab) ? 'communication' : 'reports'}`}
              mode={['feedback', 'announcements'].includes(workspaceTab) ? 'communication' : 'reports'}
              initialTab={workspaceTab}
              user={user}
              libraries={libraries}
              books={branchBooks}
              borrowRequests={borrowRequests}
              attendanceLogs={branchAttendance}
              attendanceDataComplete={initialDataReady && !attendanceLoadError}
            />
          )
        )}
      </main>
      {(subAdminTermsStatus !== 'accepted' || showSubAdminTerms) && (
        <div
          className="fixed inset-0 z-110 flex items-center justify-center bg-slate-950/70 p-0 sm:p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              void closeSubAdminTerms();
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="subadmin-terms-title"
            className="flex h-full max-h-full w-full max-w-2xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800 sm:h-auto sm:max-h-[90vh] sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-4 bg-shelf-primary px-5 py-5 text-white sm:px-6">
              <div>
                <h2 id="subadmin-terms-title" className="text-lg font-extrabold">
                  {t('Terms and Conditions')}
                </h2>
                <p className="mt-1 text-sm text-slate-200">
                  Responsibilities for accessing branch and visitor information.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void closeSubAdminTerms()}
                disabled={isAcceptingSubAdminTerms}
                aria-label={
                  subAdminTermsStatus === 'accepted'
                    ? 'Close Terms and Conditions'
                    : 'Close and sign out'
                }
                className="rounded-lg p-2 text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 text-sm leading-6 text-slate-700 dark:text-slate-200 sm:px-6">
              {subAdminTermsStatus === 'loading' ? (
                <p role="status">Verifying terms acceptance…</p>
              ) : subAdminTermsStatus === 'error' ? (
                <div role="alert" className="space-y-3">
                  <p>{subAdminTermsError}</p>
                  <button
                    type="button"
                    onClick={() => void loadSubAdminTermsAcceptance()}
                    className="font-bold text-shelf-primary underline"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Version {subAdminTermsVersion}
                    {subAdminTermsAcceptedAt && (
                      <> · Acknowledged {formatDateTime(subAdminTermsAcceptedAt)}</>
                    )}
                  </p>
              <SubAdminTermsContent content={subAdminTermsContent} />
                  {subAdminTermsError && (
                    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      {subAdminTermsError}
                    </p>
                  )}
                </>
              )}
            </div>
            {subAdminTermsStatus === 'required' && (
              <div className="shrink-0 border-t border-slate-200 px-5 py-4 dark:border-slate-700 sm:px-6">
                <p className="mb-3 text-center text-xs text-slate-500 dark:text-slate-400">
                  Closing these terms before agreeing will sign you out.
                </p>
                <button
                  type="button"
                  onClick={handleAcceptSubAdminTerms}
                  disabled={isAcceptingSubAdminTerms}
                  className="min-h-11 w-full rounded-lg bg-shelf-primary px-5 py-3 text-sm font-bold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isAcceptingSubAdminTerms
                    ? 'Saving…'
                    : 'I Agree to the Terms and Conditions'}
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
    <ExportConfirmationDialog
      file={pendingExportFile}
      onCancel={() => setPendingExportFile(null)}
      onSaved={() => { setPendingExportFile(null); setExportMessage('Report saved successfully.'); }}
    />
  </div>
  );
}
