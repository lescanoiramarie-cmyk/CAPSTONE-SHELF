import { lazy, Suspense, useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
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
  MapPinned,
  QrCode,
  Building2,
  Upload,
  UsersRound,
  Info,
  Bell,
  MessageSquare,
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
import BookRatingsChart from '../../component/BookRatingsChart.jsx';
import LibraryMap from '../../component/LibraryMap.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { exportReport } from '../../lib/excelUtils.js';
import Papa from 'papaparse';
import { findVisitorByQr } from '../../data/store.js';
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

const VisitorAccountManagement = lazy(
  () => import('../../component/VisitorAccountManagement.jsx')
);

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend);

const NAV = [
  { id: 'overview', label: 'Overview', Icon: Activity },
  { id: 'visitors', label: 'Visitor Accounts', Icon: UsersRound },
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
  const today = new Date();
  const firstDayOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstDayOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthDays = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
  const monthLabel = firstDayOfLastMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const dailyCounts = Array.from({ length: lastMonthDays }, (_, index) => ({
    day: index + 1,
    count: 0,
  }));

  attendance.forEach((record) => {
    const timestamp = record.timeIn || record.time_in;
    if (!timestamp) return;
    const recordDate = new Date(timestamp);
    if (
      Number.isNaN(recordDate.getTime()) ||
      recordDate < firstDayOfLastMonth ||
      recordDate >= firstDayOfThisMonth
    ) return;
    dailyCounts[recordDate.getDate() - 1].count += 1;
  });
  const attendanceTotal = dailyCounts.reduce((total, day) => total + day.count, 0);
  const maxCount = Math.max(1, ...dailyCounts.map((day) => day.count));
  const calendarCells = [
    ...Array(firstDayOfLastMonth.getDay()).fill(null),
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
          <h3 className="text-sm font-bold text-slate-800">Visitor Attendance</h3>
          <p className="mt-1 text-xs text-slate-500">Daily check-ins · {monthLabel}</p>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Monthly total</p>
          <p className="text-lg font-bold leading-tight tabular-nums text-slate-800">{attendanceTotal.toLocaleString()}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1.5" role="grid" aria-label={`Daily visitor check-ins for ${monthLabel}`}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((weekday) => (
          <div key={weekday} role="columnheader" className="pb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:text-[11px]">
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
            <span className="text-[10px] font-medium leading-none opacity-80">{day.day}</span>
            <span className="text-xs font-bold leading-none tabular-nums sm:text-sm">{day.count}</span>
          </div>
        ) : (
          <div key={`empty-${index}`} aria-hidden="true" />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[10px] text-slate-500" aria-label="Attendance intensity legend">
        <span className="mr-auto font-medium">Check-ins per day</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm border border-slate-100 bg-slate-50" />0</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm border border-blue-100 bg-blue-50" />Low</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm border border-blue-300 bg-blue-200" />Medium</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm border border-blue-500 bg-blue-500" />High</span>
      </div>
      {attendanceTotal === 0 && (
        <p className="mt-2 text-center text-xs text-slate-500">No attendance records for this month.</p>
      )}
    </div>
  );
}

function BorrowingActivityTrendChart({ requests = [] }) {
  const today = new Date();
  const firstDayOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstDayOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthDays = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
  const firstWeekday = firstDayOfLastMonth.getDay();
  const weekCount = Math.ceil((firstWeekday + lastMonthDays) / 7);
  const monthLabel = firstDayOfLastMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const weeks = Array.from({ length: weekCount }, (_, index) => {
    const firstDate = Math.max(1, index * 7 - firstWeekday + 1);
    const lastDate = Math.min(lastMonthDays, (index + 1) * 7 - firstWeekday);
    return {
      label: `${firstDayOfLastMonth.toLocaleDateString('en-US', { month: 'short' })} ${firstDate}–${lastDate}`,
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
      date < firstDayOfLastMonth ||
      date >= firstDayOfThisMonth
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
          <h3 className="text-sm font-bold text-slate-800">Borrowing Activity Trend</h3>
          <p className="mt-1 text-xs text-slate-500">Requests, borrows, and returns by week · {monthLabel}</p>
        </div>
        <div className="hidden shrink-0 gap-3 text-right sm:flex">
          <div><p className="text-sm font-bold tabular-nums text-blue-700">{totals.requests}</p><p className="text-[10px] text-slate-500">Requests</p></div>
          <div><p className="text-sm font-bold tabular-nums text-amber-600">{totals.borrows}</p><p className="text-[10px] text-slate-500">Borrows</p></div>
          <div><p className="text-sm font-bold tabular-nums text-emerald-600">{totals.returns}</p><p className="text-[10px] text-slate-500">Returns</p></div>
        </div>
      </div>
      {!hasActivity ? (
        <p className="py-10 text-center text-sm text-slate-500">
          No borrowing activity recorded for {monthLabel}.
        </p>
      ) : (
        <div className="mt-4 flex min-h-[220px] flex-1 flex-col">
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
          <p className="mt-1 text-right text-[10px] text-slate-400">Weekly activity for {monthLabel}</p>
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
      <div className="absolute top-6 right-6 z-20 flex items-center gap-3">
        
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
            <div className="absolute right-0 top-full z-50 mt-2 flex max-h-[min(70vh,32rem)] w-[min(20rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-2xl">
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
              
              <div className="min-h-0 max-h-[min(20rem,60vh)] flex-1 space-y-2 overflow-y-auto overscroll-contain">
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
  const { books, borrowRequests, attendanceLogs, libraries, visitors } = useLibraryData();
  const [section, setSection] = useState('overview');
  const [focusRequestId, setFocusRequestId] = useState(null);
  const [focusNotificationType, setFocusNotificationType] = useState(null);
  const [notificationTargetMessage, setNotificationTargetMessage] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({ reports: true, communication: false });
  const [workspaceTab, setWorkspaceTab] = useState('reports');
  const [showImportGuide, setShowImportGuide] = useState(false);
  const [feedbackPreview, setFeedbackPreview] = useState({ items: [], total: 0, newCount: 0, loading: false, error: '' });
  const [feedbackPreviewLibraryId, setFeedbackPreviewLibraryId] = useState('');
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

  const branchVisitors = useMemo(() => {
    if (!currentLibraryId) return [];
    return visitors.filter(
      (visitor) => visitor.libraryId === currentLibraryId || visitor.library_id === currentLibraryId
    );
  }, [visitors, currentLibraryId]);

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
  const [exportingReport, setExportingReport] = useState('');
  const [exportMessage, setExportMessage] = useState('');
  const [exportError, setExportError] = useState('');

  const exportBranchReport = async (report, format) => {
    const reportKey = `${report}-${format}`;
    setExportingReport(reportKey);
    setExportMessage('');
    setExportError('');
    try {
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
        ...(report === 'attendance' ? { dateRange: 'All available dates' } : {}),
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
      await exportReport(
        reportRows,
        format,
        reportOptions
      );
      setExportMessage('Report exported successfully.');
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
  const registeredVisitors = branchVisitors.length;
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
              <StatCard label="Registered Visitors" value={registeredVisitors} tone="blue" />
              <StatCard label="Pending Pickups" value={pendingPickups} tone="amber" />
              <StatCard label="Active Borrows" value={activeBorrows} />
              <StatCard label="Overdue Items" value={overdue} tone="red" />
              <StatCard label="Branch Books" value={branchBooks.length} tone="book" />
            </div>

            {/* OVERVIEW CHARTS */}
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <AttendanceTrendChart attendance={branchAttendance} />
              <BorrowingActivityTrendChart requests={branchBorrowRequests} />
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
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${item.status === 'new' ? 'bg-amber-50 text-amber-800' : item.status === 'answered' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                              {status}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 break-words text-xs text-slate-500">{item.visitor_name || 'Visitor'} · {item.message || ''}</p>
                        </div>
                        <time className="shrink-0 text-[11px] text-slate-400" dateTime={item.created_at}>
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
                    <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700"><BookOpen size={14} aria-hidden="true" /> Branch Physical Shelf Audit</p>
                    <p className="text-[11px] text-slate-500">Total Books: {branchBooks.length}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => exportBranchReport('books', 'xlsx')}
                      disabled={Boolean(exportingReport)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-3 py-1.5 rounded transition"
                    >
                      {exportingReport === 'books-xlsx' ? 'Exporting…' : 'Excel'}
                    </button>
                    <button
                      type="button"
                      onClick={() => exportBranchReport('books', 'csv')}
                      disabled={Boolean(exportingReport)}
                      className="bg-slate-700 hover:bg-slate-800 text-white text-[11px] font-bold px-3 py-1.5 rounded transition"
                    >
                      {exportingReport === 'books-csv' ? 'Exporting…' : 'CSV'}
                    </button>
                    <button
                      type="button"
                      onClick={() => exportBranchReport('books', 'pdf')}
                      disabled={Boolean(exportingReport)}
                      className="bg-rose-700 hover:bg-rose-800 text-white text-[11px] font-bold px-3 py-1.5 rounded transition"
                    >
                      {exportingReport === 'books-pdf' ? 'Exporting…' : 'PDF'}
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
                      onClick={() => exportBranchReport('attendance', 'xlsx')}
                      disabled={Boolean(exportingReport)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-3 py-1.5 rounded transition"
                    >
                      {exportingReport === 'attendance-xlsx' ? 'Exporting…' : 'Excel'}
                    </button>
                    <button
                      type="button"
                      onClick={() => exportBranchReport('attendance', 'csv')}
                      disabled={Boolean(exportingReport)}
                      className="bg-slate-700 hover:bg-slate-800 text-white text-[11px] font-bold px-3 py-1.5 rounded transition"
                    >
                      {exportingReport === 'attendance-csv' ? 'Exporting…' : 'CSV'}
                    </button>
                    <button
                      type="button"
                      onClick={() => exportBranchReport('attendance', 'pdf')}
                      disabled={Boolean(exportingReport)}
                      className="bg-rose-700 hover:bg-rose-800 text-white text-[11px] font-bold px-3 py-1.5 rounded transition"
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
