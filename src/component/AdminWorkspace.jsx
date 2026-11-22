import { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import { FileSpreadsheet, FileCode, FileText, ShieldCheck } from 'lucide-react';
import {
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from '../data/store.js';
import { supabase } from '../lib/supabaseClient.js';
import AnalyticsDateFilter from './AnalyticsDateFilter.jsx';
import PageJump from './PageJump.jsx';
import AuditLogViewer from './AuditLogViewer.jsx';
import {
  getTimeframeBucketKey,
  getTimeframeBuckets,
  getTimeframeRange,
} from '../lib/analyticsDateRange.js';
import { getForecastNarrative } from '../lib/forecastNarrative.js';
import { getAnalyticsApiUrl } from '../lib/analyticsApi.js';
import { formatBookCategory } from '../lib/bookCategory.js';
import {
  buildOperationalRecommendations,
  canRunVisitorForecast,
  filterAttendanceForAnalytics,
  filterRequestsForLibrary,
  filterRowsForLibrary,
  getRequestDate,
  getRequestStatus,
} from '../lib/dashboardAnalytics.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend
);

const CATEGORY_CHART_COLORS = ['#0f766e', '#d97706', '#2563eb', '#9333ea', '#e11d48', '#64748b'];

function getLibraryName(libraries, id) {
  if (!id) {
    return 'All libraries';
  }
  return (
    libraries.find(
      (library) =>
        String(library.id) === String(id)
    )?.name || 'Unknown library'
  );
}

function getReportVisitorName(value) {
  return String(value || '').trim() || 'Unknown visitor';
}

function formatStatus(status) {
  if (!status) return '—';
  const clean = String(status).toLowerCase().replace(/_/g, ' ').trim();
  if (clean === 'ready for pickup') return 'Ready for Pickup';
  if (clean === 'borrowed') return 'Borrowed';
  if (clean === 'returned') return 'Returned';
  if (clean === 'pending') return 'Pending';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function getStatusBadgeClass(status) {
  const clean = String(status).toLowerCase().replace(/_/g, ' ').trim();
  switch (clean) {
    case 'ready for pickup':
      return 'bg-amber-100 text-amber-800 border border-amber-200 font-bold';
    case 'borrowed':
    case 'checked in':
      return 'bg-blue-100 text-blue-800 border border-blue-200 font-bold';
    case 'returned':
    case 'checked out':
      return 'bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold';
    case 'overdue':
    case 'rejected':
      return 'bg-rose-100 text-rose-800 border border-rose-200 font-bold';
    default:
      return 'bg-slate-100 text-slate-700 border border-slate-200 font-bold';
  }
}

function isDateInsideWindow(value, window) {
  if (!window?.valid || !value) {
    return false;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  return date >= window.start && date < window.endExclusive;
}

function formatLocalDateInput(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function roundNarrativeDecimals(value) {
  return String(value).replace(/-?\d+\.\d+/g, (number) => String(Math.round(Number(number))));
}

function getDaysUntilExpiration(expiryDate) {
  return Math.max(1, Math.ceil((expiryDate.getTime() - Date.now()) / 86400000));
}

function isAnnouncementExpired(expiresAt) {
  return new Date(expiresAt).getTime() <= Date.now();
}

export default function AdminWorkspace({
  initialTab = 'reports',
  mode = 'reports',
  user,
  libraries = [],
  books = [],
  attendanceLogs = [],
  attendanceDataComplete = false,
  borrowRequests = [],
  borrowRequestsLoadError = '',
  retryBorrowRequests = null,
  focusedNotificationRequestId = null,
  focusedNotificationType = null,
}) {
  const isSubAdmin = user?.role === 'subadmin';
  const currentLibraryId = user?.libraryId || user?.library_id || user?.assignedBranch || user?.assigned_branch || '';
  const [tab, setTab] = useState(initialTab);
  const [previousInitialTab, setPreviousInitialTab] = useState(initialTab);

  if (previousInitialTab !== initialTab) {
    setPreviousInitialTab(initialTab);
    setTab(initialTab);
  }

  const activeTabs = useMemo(() => {
    if (mode === 'communication') {
      return [
        { id: 'feedback', label: 'Feedback' },
        { id: 'announcements', label: 'Announcements' },
      ];
    }
    return [
      { id: 'reports', label: 'Reports' },
      { id: 'analytics', label: 'Analytics' },
    ];
  }, [mode]);

  const [analyticsLibraryId, setAnalyticsLibraryId] = useState('');
  const [timeframe, setTimeframe] = useState('last_month');
  const [activityTypeFilter, setActivityTypeFilter] = useState('all');
  const [activitySearch, setActivitySearch] = useState('');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [reportSort, setReportSort] = useState('time');
  const [activityHistoryPage, setActivityHistoryPage] = useState(1);
  const [activityHistoryPageSize, setActivityHistoryPageSize] = useState(20);
  const [feedback, setFeedback] = useState([]);
  const [feedbackTotal, setFeedbackTotal] = useState(0);
  const [feedbackPage, setFeedbackPage] = useState(1);
  const [answeredFeedback, setAnsweredFeedback] = useState([]);
  const [answeredFeedbackTotal, setAnsweredFeedbackTotal] = useState(0);
  const [answeredFeedbackPage, setAnsweredFeedbackPage] = useState(1);
  const [, setOldestUnansweredAt] = useState(null);
  const [, setOldestUnansweredUnavailable] = useState(false);
  const [feedbackSearch, setFeedbackSearch] = useState('');
  const feedbackPageSize = 5;
  const [announcements, setAnnouncements] = useState([]);
  const [announcementsTotal, setAnnouncementsTotal] = useState(0);
  const [, setAnnouncementsExpiringCount] = useState(null);
  const [announcementsPage, setAnnouncementsPage] = useState(1);
  const [announcementsSearch, setAnnouncementsSearch] = useState('');
  const [announcementsStatusFilter, setAnnouncementsStatusFilter] = useState('all');
  const [sectionRefreshTick, setSectionRefreshTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingFormat, setExportingFormat] = useState('');
  const [pendingReportExport, setPendingReportExport] = useState(null);
  const [savingReportExport, setSavingReportExport] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [announcementForm, setAnnouncementForm] = useState({
    title: '',
    message: '',
    audience: 'visitor',
    expirationMode: 'permanent',
    duration: '7',
    durationUnit: 'days',
    expiresAt: null,
  });
  const [announcementExpirationChanged, setAnnouncementExpirationChanged] = useState(false);
  const [editingAnnouncementId, setEditingAnnouncementId] = useState(null);
  const [feedbackReply, setFeedbackReply] = useState({});
  const [forecast, setForecast] = useState(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const exportLockRef = useRef(false);

  const booksById = useMemo(
    () => new Map(books.map((book) => [String(book.id), book])),
    [books]
  );
  const focusedNotificationRequest = borrowRequests.find(
    (request) =>
      String(request.id) === String(focusedNotificationRequestId)
  );
  const focusedRequestStatus = String(
    focusedNotificationRequest?.status || ''
  ).toLowerCase();
  const focusedNotificationHandled =
    (focusedNotificationType === 'reservation' &&
      !['pending', 'queued'].includes(focusedRequestStatus)) ||
    (focusedNotificationType === 'pickup' &&
      focusedRequestStatus !== 'ready_for_pickup') ||
    (focusedNotificationType === 'overdue' &&
      focusedRequestStatus !== 'borrowed');

  useEffect(() => {
    if (
      !focusedNotificationRequestId ||
      mode !== 'reports' ||
      tab !== 'reports'
    ) {
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      document
        .getElementById(`admin-notification-request-${focusedNotificationRequestId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedNotificationRequestId, mode, tab]);

  const analyticsWindow = useMemo(
    () => getTimeframeRange(timeframe, customStartDate, customEndDate),
    [timeframe, customStartDate, customEndDate]
  );

  const scopedAttendance = useMemo(
    () =>
      isSubAdmin ? filterRowsForLibrary(attendanceLogs, currentLibraryId) : attendanceLogs,
    [attendanceLogs, currentLibraryId, isSubAdmin]
  );

  const scopedBorrows = useMemo(
    () =>
      isSubAdmin
        ? filterRequestsForLibrary(borrowRequests, booksById, currentLibraryId)
        : borrowRequests,
    [booksById, borrowRequests, currentLibraryId, isSubAdmin]
  );

  const reportRows = useMemo(() => {
    const attendanceRows = scopedAttendance
      .filter((item) => isDateInsideWindow(item.timeIn, analyticsWindow))
      .map((item) => ({
        type: 'Visitor',
        time: item.timeIn,
        person: getReportVisitorName(item.visitorName),
        detail: 'Library visit',
        branch: getLibraryName(libraries, item.libraryId),
        status: item.checkedOutAt ? 'Checked out' : 'Checked in',
        dataClassification: item.isTestData
          ? 'Test data'
          : 'Operational data',
      }));

    const transactionRows = scopedBorrows
      .filter((item) => isDateInsideWindow(item.requestDate, analyticsWindow))
      .map((item) => ({
        type: 'Book request',
        time: getRequestDate(item),
        person: getReportVisitorName(item.visitorName),
        detail: item.bookTitle || 'Book request',
        branch: getLibraryName(libraries, booksById.get(String(item.bookId ?? item.book_id ?? ''))?.libraryId),
        status: formatStatus(item.status),
        dataClassification: item.isTestData ? 'Test data' : 'Operational data',
      }));

    const returnRows = scopedBorrows
      .filter((item) => isDateInsideWindow(item.returnDate, analyticsWindow))
      .map((item) => ({
        type: 'Book return',
        time: item.returnDate,
        person: getReportVisitorName(item.visitorName),
        detail: item.bookTitle || 'Book return',
        branch: getLibraryName(libraries, booksById.get(item.bookId)?.libraryId),
        status: `Returned${Number(item.fineAmount) > 0 ? `; Fine ₱${item.fineAmount}` : ''}`,
        dataClassification: item.isTestData ? 'Test data' : 'Operational data',
      }));

    return [...attendanceRows, ...transactionRows, ...returnRows].sort((a, b) => {
      if (reportSort === 'name') {
        return a.person.localeCompare(b.person);
      }
      return new Date(b.time) - new Date(a.time);
    });
  }, [
    booksById,
    libraries,
    analyticsWindow,
    reportSort,
    scopedAttendance,
    scopedBorrows,
  ]);

  const filteredReportRows = useMemo(
    () => {
      const term = activitySearch.trim().toLocaleLowerCase();
      return reportRows.filter((row) =>
        (activityTypeFilter === 'all' || row.type === activityTypeFilter) &&
        (!term || `${row.person} ${row.detail} ${row.branch} ${row.status}`.toLocaleLowerCase().includes(term))
      );
    },
    [activitySearch, activityTypeFilter, reportRows]
  );
  const activityHistoryPageCount = Math.max(1, Math.ceil(filteredReportRows.length / activityHistoryPageSize));
  const visibleActivityHistoryPage = Math.min(activityHistoryPage, activityHistoryPageCount);
  const visibleFeedbackPage = Math.min(feedbackPage, Math.max(1, Math.ceil(feedbackTotal / feedbackPageSize)));
  const visibleAnsweredFeedbackPage = Math.min(answeredFeedbackPage, Math.max(1, Math.ceil(answeredFeedbackTotal / feedbackPageSize)));
  const visibleAnnouncementsPage = Math.min(announcementsPage, Math.max(1, Math.ceil(announcementsTotal / 10)));
  const activityHistoryStart = (visibleActivityHistoryPage - 1) * activityHistoryPageSize;
  const paginatedReportRows = filteredReportRows.slice(
    activityHistoryStart,
    activityHistoryStart + activityHistoryPageSize
  );
  const activityHistoryPages = activityHistoryPageCount <= 5
    ? Array.from({ length: activityHistoryPageCount }, (_, index) => index + 1)
    : [
        1,
        ...(visibleActivityHistoryPage > 3 ? ['ellipsis-left'] : []),
        ...Array.from(
          { length: Math.max(0, Math.min(activityHistoryPageCount - 1, visibleActivityHistoryPage + 1) - Math.max(2, visibleActivityHistoryPage - 1) + 1) },
          (_, index) => Math.max(2, visibleActivityHistoryPage - 1) + index
        ),
        ...(visibleActivityHistoryPage < activityHistoryPageCount - 2 ? ['ellipsis-right'] : []),
        activityHistoryPageCount,
      ];

  useEffect(() => {
    if (!supabase || !['feedback', 'announcements'].includes(tab)) {
      return undefined;
    }
    let active = true;
    async function loadData() {
      setLoading(true);
      setError('');
      let result;
      if (tab === 'feedback') {
        const search = feedbackSearch.trim().replace(/[(),]/g, ' ');
        const feedbackQuery = (answered, page) => {
          let query = supabase
            .from('visitor_feedback')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false });
          if (isSubAdmin) query = query.eq('library_id', currentLibraryId);
          query = answered
            ? query.not('admin_reply', 'is', null)
            : query.is('admin_reply', null);
          if (search) {
            query = query.or(`subject.ilike.%${search}%,visitor_name.ilike.%${search}%,visitor_email.ilike.%${search}%`);
          }
          return query.range((page - 1) * feedbackPageSize, page * feedbackPageSize - 1);
        };
        let oldestPendingQuery = supabase
          .from('visitor_feedback')
          .select('created_at')
          .is('admin_reply', null)
          .order('created_at', { ascending: true })
          .limit(1);
        if (isSubAdmin) oldestPendingQuery = oldestPendingQuery.eq('library_id', currentLibraryId);
        const [pendingResult, answeredResult, oldestPendingResult] = await Promise.all([
          feedbackQuery(false, visibleFeedbackPage),
          feedbackQuery(true, visibleAnsweredFeedbackPage),
          oldestPendingQuery.maybeSingle(),
        ]);
        if (!active) return;
        if (pendingResult.error || answeredResult.error) {
          setError(pendingResult.error?.message || answeredResult.error?.message);
          setFeedback([]);
          setFeedbackTotal(0);
          setAnsweredFeedback([]);
          setAnsweredFeedbackTotal(0);
          setOldestUnansweredAt(null);
          setOldestUnansweredUnavailable(true);
        } else {
          setFeedback(pendingResult.data || []);
          setFeedbackTotal(pendingResult.count || 0);
          setAnsweredFeedback(answeredResult.data || []);
          setAnsweredFeedbackTotal(answeredResult.count || 0);
          setOldestUnansweredAt(oldestPendingResult.data?.created_at || null);
          setOldestUnansweredUnavailable(Boolean(oldestPendingResult.error));
        }
        setLoading(false);
        return;
      } else if (tab === 'announcements') {
        const now = new Date();
        const nextWeek = new Date(now);
        nextWeek.setDate(nextWeek.getDate() + 7);
        let query = supabase
          .from('announcements')
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false });
        if (isSubAdmin) {
          query = query.eq('library_id', currentLibraryId);
        }
        query = query.eq('published', true);
        if (announcementsStatusFilter !== 'all') {
          if (announcementsStatusFilter === 'expired') {
            query = query
              .not('expires_at', 'is', null)
              .lte('expires_at', new Date().toISOString());
          } else if (announcementsStatusFilter === 'published') {
            query = query.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
          }
        }
        if (announcementsSearch.trim()) {
          query = query.ilike('title', `%${announcementsSearch.trim()}%`);
        }
        query = query.range((visibleAnnouncementsPage - 1) * 10, visibleAnnouncementsPage * 10 - 1);
        let expiringQuery = supabase
          .from('announcements')
          .select('id', { count: 'exact', head: true })
          .eq('published', true)
          .not('expires_at', 'is', null)
          .gte('expires_at', now.toISOString())
          .lte('expires_at', nextWeek.toISOString());
        if (isSubAdmin) expiringQuery = expiringQuery.eq('library_id', currentLibraryId);
        const [announcementResult, expiringResult] = await Promise.all([query, expiringQuery]);
        result = announcementResult;
        setAnnouncementsExpiringCount(expiringResult.error ? null : expiringResult.count || 0);
      }
      if (!active) return;
      if (result.error) {
        setError(result.error.message);
        if (tab === 'announcements') {
          setAnnouncements([]);
          setAnnouncementsTotal(0);
        }
      } else if (tab === 'feedback') {
        setFeedback(result.data || []);
        setFeedbackTotal(result.count || 0);
      } else if (tab === 'announcements') {
        setAnnouncements(result.data || []);
        setAnnouncementsTotal(result.count || 0);
      }
      setLoading(false);
    }
    loadData().catch((loadError) => {
      if (active) {
        setError(loadError.message || 'Unable to load this section.');
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [
    announcementsPage,
    announcementsSearch,
    announcementsStatusFilter,
    answeredFeedbackPage,
    currentLibraryId,
    feedbackPage,
    feedbackSearch,
    isSubAdmin,
    sectionRefreshTick,
    tab,
    visibleAnnouncementsPage,
    visibleAnsweredFeedbackPage,
    visibleFeedbackPage,
  ]);

  const effectiveAnalyticsLibraryId = isSubAdmin ? currentLibraryId : analyticsLibraryId;

  const analyticsScopedBorrows = useMemo(
    () =>
      isSubAdmin
        ? filterRequestsForLibrary(borrowRequests, booksById, currentLibraryId)
        : analyticsLibraryId
          ? filterRequestsForLibrary(borrowRequests, booksById, analyticsLibraryId)
          : borrowRequests,
    [booksById, borrowRequests, currentLibraryId, isSubAdmin, analyticsLibraryId]
  );

  const analyticsAttendance = useMemo(
    () => analyticsWindow.valid
      ? filterAttendanceForAnalytics(attendanceLogs, {
          libraryId: effectiveAnalyticsLibraryId,
          requireLibraryId: isSubAdmin || Boolean(analyticsLibraryId),
          start: analyticsWindow.start,
          endExclusive: analyticsWindow.endExclusive,
        })
      : [],
    [attendanceLogs, analyticsLibraryId, analyticsWindow, effectiveAnalyticsLibraryId, isSubAdmin]
  );

  const analyticsBorrows = useMemo(
    () =>
      analyticsScopedBorrows.filter((item) =>
        isDateInsideWindow(getRequestDate(item), analyticsWindow)
      ),
    [analyticsScopedBorrows, analyticsWindow]
  );

  const periodCounts = useMemo(() => {
    if (!analyticsWindow.valid) {
      return { labels: [], visits: [], transactions: [] };
    }
    const buckets = getTimeframeBuckets(timeframe, analyticsWindow);
    const visitCounts = new Map();
    const transactionCounts = new Map();

    analyticsAttendance.forEach((item) => {
      const key = getTimeframeBucketKey(item.timeIn ?? item.time_in, timeframe);
      visitCounts.set(key, (visitCounts.get(key) || 0) + 1);
    });
    analyticsBorrows.forEach((item) => {
      const key = getTimeframeBucketKey(getRequestDate(item), timeframe);
      transactionCounts.set(key, (transactionCounts.get(key) || 0) + 1);
    });

    return {
      labels: buckets.map((bucket) => bucket.label),
      visits: buckets.map((bucket) => visitCounts.get(bucket.key) || 0),
      transactions: buckets.map((bucket) => transactionCounts.get(bucket.key) || 0),
    };
  }, [analyticsAttendance, analyticsBorrows, analyticsWindow, timeframe]);

  const forecastHistoryBuckets = useMemo(() => {
    if (!analyticsWindow.valid) return [];
    const todayEnd = new Date();
    todayEnd.setHours(0, 0, 0, 0);
    todayEnd.setDate(todayEnd.getDate() + 1);
    const endExclusive = new Date(Math.min(analyticsWindow.endExclusive.getTime(), todayEnd.getTime()));
    const earliestForecastDate = new Date(endExclusive);
    earliestForecastDate.setDate(earliestForecastDate.getDate() - 366);
    const start = analyticsWindow.start > earliestForecastDate
      ? analyticsWindow.start
      : earliestForecastDate;
    return getTimeframeBuckets('custom', {
      ...analyticsWindow,
      start,
      endExclusive,
    }).slice(-366);
  }, [analyticsWindow]);

  const forecastHistoryDays = forecastHistoryBuckets.length;
  const forecastDailyVisitorCounts = useMemo(() => {
    if (!forecastHistoryDays) return [];
    const counts = new Map();
    analyticsAttendance.forEach((item) => {
      const key = getTimeframeBucketKey(item.timeIn ?? item.time_in, 'custom');
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return forecastHistoryBuckets.map((bucket) => counts.get(bucket.key) || 0);
  }, [analyticsAttendance, forecastHistoryBuckets, forecastHistoryDays]);

  const automaticForecastChartData = useMemo(() => {
    const historyLength = forecastHistoryBuckets.length;
    if (historyLength < 7 || !forecastDailyVisitorCounts.some((count) => count > 0)) return null;

    const recentStart = Math.max(0, historyLength - 28);
    const weekdayTotals = Array(7).fill(0);
    const weekdayDays = Array(7).fill(0);
    for (let index = recentStart; index < historyLength; index += 1) {
      const weekday = forecastHistoryBuckets[index].start.getDay();
      weekdayTotals[weekday] += forecastDailyVisitorCounts[index] || 0;
      weekdayDays[weekday] += 1;
    }

    const historyBuckets = forecastHistoryBuckets.slice(-28);
    const historyValues = forecastDailyVisitorCounts.slice(-28);
    const futureDates = [];
    const lastDay = new Date(forecastHistoryBuckets.at(-1).start);
    for (let offset = 1; offset <= 7; offset += 1) {
      const date = new Date(lastDay);
      date.setDate(date.getDate() + offset);
      futureDates.push(date);
    }
    const projectedValues = futureDates.map((date) => {
      const weekday = date.getDay();
      return weekdayDays[weekday]
        ? Math.round(weekdayTotals[weekday] / weekdayDays[weekday])
        : 0;
    });
    const anchor = historyValues.at(-1) || 0;
    return {
      labels: [
        ...historyBuckets.map((bucket) => bucket.label),
        ...futureDates.map((date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
      ],
      datasets: [
        {
          label: 'Recorded check-ins',
          data: [...historyValues, ...futureDates.map(() => null)],
          borderColor: '#0f766e',
          backgroundColor: '#0f766e',
          tension: 0.25,
          pointRadius: 2,
        },
        {
          label: 'Estimated check-ins',
          data: [
            ...historyValues.slice(0, -1).map(() => null),
            anchor,
            ...projectedValues,
          ],
          borderColor: '#d97706',
          backgroundColor: '#d97706',
          borderDash: [6, 4],
          tension: 0.25,
          pointRadius: 3,
        },
      ],
    };
  }, [forecastDailyVisitorCounts, forecastHistoryBuckets]);

  const forecastObservedVisitDays = forecastDailyVisitorCounts.filter((count) => count > 0).length;
  const forecastTotalVisits = forecastDailyVisitorCounts.reduce((total, count) => total + count, 0);
  const forecastCanRun = canRunVisitorForecast({
    historyDays: forecastHistoryDays,
    observedVisitDays: forecastObservedVisitDays,
    totalVisits: forecastTotalVisits,
    attendanceComplete: attendanceDataComplete,
  });

  const forecastChartData = useMemo(() => {
    if (!forecast?.forecasts?.length || !forecastDailyVisitorCounts.length) return null;
    const labels = [
      ...forecastHistoryBuckets.map((bucket) => bucket.label),
      ...forecast.forecasts.map((item) => new Date(`${item.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
    ];
    const anchor = forecastDailyVisitorCounts.at(-1) ?? 0;
    return {
      labels,
      datasets: [
        {
          label: 'Actual visitors',
          data: [...forecastDailyVisitorCounts, ...forecast.forecasts.map(() => null)],
          borderColor: '#0f766e',
          backgroundColor: '#0f766e',
          tension: 0.25,
          pointRadius: 2,
        },
        {
          label: 'Expected visits',
          data: [
            ...forecastDailyVisitorCounts.slice(0, -1).map(() => null),
            anchor,
            ...forecast.forecasts.map((item) => item.visitorCount),
          ],
          borderColor: '#d97706',
          backgroundColor: '#d97706',
          borderDash: [6, 4],
          tension: 0.25,
          pointRadius: 3,
        },
      ],
    };
  }, [forecast, forecastDailyVisitorCounts, forecastHistoryBuckets]);

  const categoryDemand = useMemo(() => {
    const counts = new Map();
    analyticsBorrows.forEach((request) => {
      const bookId = String(request.bookId ?? request.book_id ?? '');
      const category = booksById.get(bookId)?.category || 'Uncategorized';
      counts.set(category, (counts.get(category) || 0) + 1);
    });
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [booksById, analyticsBorrows]);

  const demandAndAvailabilityRows = useMemo(() => {
    const availableByCategory = new Map();
    books.forEach((book) => {
      const bookLibraryId = String(book.libraryId ?? book.library_id ?? '');
      if (effectiveAnalyticsLibraryId && bookLibraryId !== String(effectiveAnalyticsLibraryId)) return;
      const category = book.category || 'Uncategorized';
      const available = Number(book.availableCopies ?? book.available_copies ?? 0);
      availableByCategory.set(category, (availableByCategory.get(category) || 0) + (Number.isFinite(available) ? available : 0));
    });
    return categoryDemand.slice(0, 6).map(([category, requests]) => ({
      category,
      requests,
      available: availableByCategory.get(category) || 0,
    }));
  }, [books, categoryDemand, effectiveAnalyticsLibraryId]);

  const topCategories = categoryDemand.slice(0, 5);
  const otherCategoryRequestCount = categoryDemand
    .slice(5)
    .reduce((sum, [, count]) => sum + count, 0);
  const categoryChartRows = otherCategoryRequestCount > 0
    ? [...topCategories, ['Other categories', otherCategoryRequestCount]]
    : topCategories;
  const totalCategoryRequests = categoryDemand.reduce((sum, [, count]) => sum + count, 0);
  const maxCategoryRequestCount = Math.max(0, ...categoryChartRows.map(([, count]) => count));
  const getCategoryAxisStep = (value) => {
    if (value <= 150) return 25;
    const roughStep = value / 5;
    const magnitude = 10 ** Math.floor(Math.log10(roughStep));
    const normalizedStep = roughStep / magnitude;
    const niceStep = normalizedStep <= 1
      ? 1
      : normalizedStep <= 2
        ? 2
        : normalizedStep <= 2.5
          ? 2.5
          : normalizedStep <= 5
            ? 5
            : 10;
    return niceStep * magnitude;
  };
  const categoryAxisStep = getCategoryAxisStep(maxCategoryRequestCount);
  const categoryAxisMax = Math.max(categoryAxisStep, Math.ceil(maxCategoryRequestCount / categoryAxisStep) * categoryAxisStep);

  const forecastNarrative = useMemo(() => {
    const narrative = getForecastNarrative(forecast);
    return {
      insights: narrative.insights.map(roundNarrativeDecimals),
      recommendations: narrative.recommendations.map(roundNarrativeDecimals),
    };
  }, [forecast]);

  const demandRecommendations = useMemo(() => {
    if (!analyticsWindow.valid) return [analyticsWindow.error || 'Select a valid year and month.'];
    return buildOperationalRecommendations({
      attendance: analyticsAttendance,
      categoryDemand,
      windowEnd: analyticsWindow.endExclusive,
      attendanceComplete: attendanceDataComplete,
    });
  }, [analyticsAttendance, analyticsWindow, attendanceDataComplete, categoryDemand]);

  const handleExport = async (format) => {
    if (!analyticsWindow.valid) {
      setError(analyticsWindow.error);
      return;
    }
    if (exportLockRef.current) return;
    exportLockRef.current = true;
    setExporting(true);
    setExportingFormat(format);
    setError('');
    setMessage('');
    try {
      const { exportReport } = await import('../lib/excelUtils.js');
      const branchLabel = isSubAdmin
        ? getLibraryName(libraries, currentLibraryId)
        : analyticsLibraryId
          ? getLibraryName(libraries, analyticsLibraryId)
          : 'All Libraries';
      const label = format === 'xlsx' ? 'Excel' : format === 'csv' ? 'CSV' : 'PDF';
      const generatedFile = await exportReport(filteredReportRows, format, {
        reportType: 'Circulation',
        title: 'Circulation Report',
        libraryName: branchLabel,
        libraries,
        startDate: analyticsWindow.start,
        endDate: new Date(analyticsWindow.endExclusive.getTime() - 1),
        generatedBy: `${user?.name || 'Admin'} (${isSubAdmin ? 'Sub-Admin' : 'Super Admin'})`,
        columns: [
          { key: 'person', label: 'Visitor' },
          { key: 'time', label: 'Date and Time', type: 'date' },
          { key: 'type', label: 'Activity' },
          { key: 'status', label: 'Status' },
          { key: 'detail', label: 'Details' },
          { key: 'branch', label: 'Library' },
          { key: 'dataClassification', label: 'Data Classification' },
        ],
        summary: [
          ['Total Visits', analyticsAttendance.length],
          ['Total Book Requests', analyticsBorrows.length],
        ],
        download: false,
      });
      setPendingReportExport({ format, label, ...generatedFile });
      setMessage(`${label} report is ready. Confirm whether to download it.`);
    } catch {
      setError('The report could not be exported. Please try again.');
    } finally {
      exportLockRef.current = false;
      setExporting(false);
      setExportingFormat('');
    }
  };

  const savePendingReportExport = async () => {
    if (!pendingReportExport?.blob || !pendingReportExport?.fileName) return;
    setSavingReportExport(true);
    try {
      if (typeof window.showSaveFilePicker === 'function') {
        const extension = pendingReportExport.fileName.split('.').pop()?.toLowerCase();
        const mimeType = extension === 'pdf'
          ? 'application/pdf'
          : extension === 'csv'
            ? 'text/csv'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: pendingReportExport.fileName,
            types: [{ description: `${pendingReportExport.label} report`, accept: { [mimeType]: [`.${extension}`] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(pendingReportExport.blob);
          await writable.close();
        } catch (pickerError) {
          if (pickerError?.name === 'AbortError') throw pickerError;
          const url = URL.createObjectURL(pendingReportExport.blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = pendingReportExport.fileName;
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      } else {
        const url = URL.createObjectURL(pendingReportExport.blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = pendingReportExport.fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setPendingReportExport(null);
      setMessage('Report saved successfully.');
    } catch (saveError) {
      if (saveError?.name !== 'AbortError') setError('The report could not be saved. Please try again.');
    } finally {
      setSavingReportExport(false);
    }
  };

  const handleAnalyticsExport = async (format) => {
    if (!analyticsWindow.valid) {
      setError(analyticsWindow.error);
      return;
    }
    if (exportLockRef.current) return;
    exportLockRef.current = true;
    setExporting(true);
    setExportingFormat(format);
    setError('');
    setMessage('');
    try {
      const rows = periodCounts.labels.map((period, index) => ({
        period,
        visitors: periodCounts.visits[index],
        bookTransactions: periodCounts.transactions[index],
      }));
      const chartImages = format === 'pdf'
        ? [...document.querySelectorAll('canvas')]
          .map((canvas) => {
            try {
              return canvas.toDataURL('image/png');
            } catch {
              return null;
            }
          })
          .filter(Boolean)
        : [];
      const branchLabel = isSubAdmin
        ? getLibraryName(libraries, currentLibraryId)
        : analyticsLibraryId
          ? getLibraryName(libraries, analyticsLibraryId)
          : 'All Libraries';
      const exportOptions = {
        reportType: 'Analytics',
        title: 'Analytics Summary',
        libraryName: branchLabel,
        libraries,
        startDate: analyticsWindow.start,
        endDate: new Date(analyticsWindow.endExclusive.getTime() - 1),
        generatedBy: `${user?.name || 'Admin'} (${isSubAdmin ? 'Sub-Admin' : 'Super Admin'})`,
        columns: [
          { key: 'period', label: 'Period' },
          { key: 'visitors', label: 'Visitors', type: 'number' },
          { key: 'bookTransactions', label: 'Book Requests', type: 'number' },
        ],
        totalRow: {
          period: 'Total',
          visitors: analyticsAttendance.length,
          bookTransactions: analyticsBorrows.length,
        },
        totalColumns: ['visitors', 'bookTransactions'],
        summary: [
          ['Visitors', analyticsAttendance.length],
          ['Book Requests', analyticsBorrows.length],
          ['Active Loans', analyticsBorrows.filter((item) => getRequestStatus(item) === 'borrowed').length],
        ],
        chartImages,
        chartTitles: ['Branch demand', 'Most requested categories', 'Visitor forecast'],
        chartDescriptions: [
          'Compares visitor attendance with book requests across the selected reporting periods.',
          'Shows which book categories received the most requests during the selected month.',
          'Projects visitor activity for the next seven days using the selected history period.',
        ],
      };
      const label = format === 'xlsx' ? 'Excel' : format === 'csv' ? 'CSV' : 'PDF';
      const { exportReport } = await import('../lib/excelUtils.js');
      const generatedFile = await exportReport(rows, format, {
        ...exportOptions,
        chartImages: format === 'pdf' ? chartImages : [],
        download: false,
      });
      setPendingReportExport({ format, label, ...generatedFile });
      setMessage(`${label} file is ready. Confirm whether to download it.`);
    } catch {
      setError('The report could not be exported. Please try again.');
    } finally {
      exportLockRef.current = false;
      setExporting(false);
      setExportingFormat('');
    }
  };

  const handleAnnouncementEdit = (item) => {
    setError('');
    setMessage('');
    const expiryDate = item.expires_at ? new Date(item.expires_at) : null;
    setAnnouncementForm({
      title: item.title || '',
      message: item.message || '',
      audience: item.audience || 'visitor',
      expirationMode: expiryDate ? 'temporary' : 'permanent',
      duration: expiryDate
        ? String(getDaysUntilExpiration(expiryDate))
        : '7',
      durationUnit: 'days',
      expiresAt: item.expires_at || null,
    });
    setAnnouncementExpirationChanged(false);
    setEditingAnnouncementId(item.id);
  };

  const handleAnnouncementSave = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const title = announcementForm.title.trim();
    const messageText = announcementForm.message.trim();
    if (!title || !messageText) {
      setError('Please enter both the title and message.');
      return;
    }
    if (isSubAdmin && !currentLibraryId) {
      setError('Your account is not assigned to a library branch.');
      return;
    }
    const duration = Number(announcementForm.duration);
    if (
      announcementForm.expirationMode === 'temporary' &&
      (!Number.isInteger(duration) || duration < 1 || duration > (announcementForm.durationUnit === 'months' ? 120 : 3650))
    ) {
      setError(`Enter a duration from 1 to ${announcementForm.durationUnit === 'months' ? '120 months' : '3650 days'}.`);
      return;
    }
    try {
      const expiresAt = announcementForm.expirationMode === 'permanent'
        ? null
        : editingAnnouncementId && !announcementExpirationChanged
          ? announcementForm.expiresAt
          : getAnnouncementExpirationDate(duration, announcementForm.durationUnit);

      if (editingAnnouncementId) {
        await updateAnnouncement(editingAnnouncementId, {
          title,
          message: messageText,
          audience: isSubAdmin ? 'visitor' : announcementForm.audience,
          libraryId: isSubAdmin ? currentLibraryId : null,
          expiresAt,
        });
      } else {
        await createAnnouncement({
          title,
          message: messageText,
          audience: isSubAdmin ? 'visitor' : announcementForm.audience,
          libraryId: isSubAdmin ? currentLibraryId : null,
          createdBy: user?.name || user?.email || 'Admin',
          expiresAt,
        });
      }

      setAnnouncementsPage(1);
      setSectionRefreshTick((tick) => tick + 1);
      setAnnouncementForm({
        title: '',
        message: '',
        audience: 'visitor',
        expirationMode: 'permanent',
        duration: '7',
        durationUnit: 'days',
        expiresAt: null,
      });
      setAnnouncementExpirationChanged(false);
      setEditingAnnouncementId(null);
      setMessage(
        editingAnnouncementId
          ? 'Announcement updated successfully.'
          : 'Announcement published successfully.'
      );
      setTab('announcements');
    } catch (err) {
      setError(err?.message || 'An unexpected error occurred while publishing.');
    }
  };

  const handleAnnouncementDelete = async (id) => {
    setError('');
    setMessage('');
    try {
      await deleteAnnouncement(id);

      setAnnouncements((current) => current.filter((item) => item.id !== id));
      setAnnouncementsTotal((current) => Math.max(0, current - 1));
      setMessage('Announcement deleted successfully.');
    } catch (err) {
      setError(err?.message || 'An unexpected error occurred while deleting.');
    }
  };

  const handleFeedbackReply = async (item) => {
    if (user?.role === 'superadmin') return;
    const reply = String(feedbackReply[item.id] || '').trim();
    if (!reply) {
      setError('Please enter a reply message before saving.');
      setMessage('');
      return;
    }
    if (reply.length < 3) {
      setError('Please write a valid reply (at least 3 characters long).');
      setMessage('');
      return;
    }

    setError('');
    setMessage('');
    const repliedAt = new Date().toISOString();
    const updatedFeedback = {
      ...item,
      admin_reply: reply,
      replied_by: user?.name || user?.email,
      replied_at: repliedAt,
      status: 'answered',
      updated_at: repliedAt,
    };

    let replyError = null;
    const { error: rpcError } = await supabase.rpc('respond_to_visitor_feedback', {
      p_feedback_id: item.id,
      p_reply: reply,
    });

    if (rpcError) {
      const { error: directError } = await supabase
        .from('visitor_feedback')
        .update({
          admin_reply: reply,
          replied_by: user?.name || user?.email,
          replied_at: repliedAt,
          status: 'answered',
          updated_at: repliedAt,
        })
        .eq('id', item.id);
      replyError = directError;
    }

    if (replyError) {
      setError(replyError.message);
    } else {
      setFeedback((current) => current.filter((entry) => entry.id !== item.id));
      setFeedbackTotal((current) => Math.max(0, current - 1));
      setAnsweredFeedbackTotal((current) => current + 1);
      if (visibleAnsweredFeedbackPage === 1) {
        setAnsweredFeedback((current) => [
          updatedFeedback,
          ...current.filter((entry) => entry.id !== item.id),
        ].slice(0, feedbackPageSize));
      }
      setFeedbackReply((current) => ({ ...current, [item.id]: '' }));
      setSectionRefreshTick((tick) => tick + 1);
      setMessage('Reply saved successfully.');
    }
  };

  const runForecast = async () => {
    const endpoint = getAnalyticsApiUrl(
      import.meta.env.VITE_ANALYTICS_API_URL
    );
    if (!analyticsWindow.valid) {
      setError(analyticsWindow.error || 'Please select a valid year and month.');
      return;
    }
    if (!forecastCanRun) {
      setError(!attendanceDataComplete
        ? 'Forecasting is unavailable because the attendance history did not load completely.'
        : 'Insufficient actual attendance history. Forecasting requires at least 7 calendar days, 3 visits across 2 active days, and a complete feed.');
      return;
    }

    setForecastLoading(true);
    setError('');
    setForecast(null);
    try {
      const categorySeries = topCategories.map(([category]) => {
        const weekCount = Math.max(
          1,
          Math.min(
            52,
            Math.ceil(
              (analyticsWindow.endExclusive.getTime() - analyticsWindow.start.getTime()) /
                (7 * 86400000)
            )
          )
        );
        const weeklyDemand = Array(weekCount).fill(0);
        analyticsBorrows.forEach((request) => {
          const requestCategory = booksById.get(String(request.bookId ?? request.book_id ?? ''))?.category || 'Uncategorized';
          if (requestCategory !== category) return;
          const requestTime = new Date(getRequestDate(request) ?? '').getTime();
          if (!Number.isFinite(requestTime)) return;

          const ageDays = Math.floor(
            (analyticsWindow.endExclusive.getTime() - requestTime) / 86400000
          );
          const weekIndex = Math.floor(ageDays / 7);
          if (weekIndex >= 0 && weekIndex < weeklyDemand.length) {
            weeklyDemand[weekIndex] += 1;
          }
        });
        return { category, weekly_demand: [...weeklyDemand].reverse() };
      });

      const { data: { session } = {} } = await supabase?.auth.getSession() ?? {};
      if (!session?.access_token) throw new Error('An authenticated staff session is required for forecasting.');
      const response = await fetch(
        `${endpoint.replace(/\/$/, '')}/forecast?timeframe=${encodeURIComponent(timeframe)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            daily_visitors: forecastDailyVisitorCounts,
            categories: categorySeries,
            horizon_days: 7,
            forecast_start_date: formatLocalDateInput(analyticsWindow.endExclusive),
          }),
        }
      );

      if (!response.ok) {
        const errorResponse = await response.json().catch(() => ({}));
        throw new Error(errorResponse.detail || `Forecast service returned ${response.status}.`);
      }
      const forecastResult = await response.json();
      if (forecastResult?.analyticsSource !== 'gemini') {
        const geminiDetails = [
          ...(Array.isArray(forecastResult?.insights) ? forecastResult.insights : []),
          ...(Array.isArray(forecastResult?.recommendations) ? forecastResult.recommendations : []),
        ].filter((item) => typeof item === 'string' && item.trim());
        throw new Error(geminiDetails.join(' ') || 'Gemini did not return forecast insights. Check the analytics service and try again.');
      }
      if (!Array.isArray(forecastResult?.forecasts) || forecastResult.forecasts.length !== 7) {
        throw new Error('Forecast service did not return exactly seven daily estimates.');
      }
      const validForecasts = forecastResult.forecasts.every((item, index) => {
        const expectedDate = new Date(analyticsWindow.endExclusive);
        expectedDate.setDate(expectedDate.getDate() + index);
        return item?.date === formatLocalDateInput(expectedDate) &&
          Number.isFinite(Number(item?.visitorCount)) && Number(item.visitorCount) >= 0;
      });
      if (!validForecasts) throw new Error('Forecast service returned invalid dates or visitor counts.');
      setForecast({
        ...forecastResult,
        source: 'gemini',
        forecasts: forecastResult.forecasts.map((item) => ({ ...item, visitorCount: Number(item.visitorCount) })),
      });
    } catch (forecastError) {
      console.error('Gemini forecast request failed.', forecastError);
      const errorMessage = forecastError instanceof Error ? forecastError.message : '';
      setForecast(null);
      setError(errorMessage || 'Gemini could not run the forecast. Check the analytics service and try again.');
    } finally {
      setForecastLoading(false);
    }
  };

  const renderFeedbackCard = (item, isAnswered) => (
    <article key={item.id} className={`space-y-3 rounded-xl border bg-white p-4 shadow-sm ${isAnswered ? 'border-emerald-200' : 'border-amber-200'}`}>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="break-words font-bold text-slate-900">{item.subject || 'Visitor feedback'}</p>
          <p className="mt-1 break-words text-xs text-slate-500">
            {item.visitor_name} · {formatBookCategory(item.category)} · {getLibraryName(libraries, item.library_id)}
          </p>
          <p className="mt-1 break-words text-xs text-slate-500">
            {item.visitor_email} · {new Date(item.created_at).toLocaleString()}
          </p>
        </div>
        <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${isAnswered ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
          {isAnswered ? 'Replied' : 'Needs reply'}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{item.message}</p>
      {isAnswered ? (
        <div className="rounded-lg border-l-4 border-emerald-600 bg-emerald-50 p-3.5 text-sm text-emerald-900">
          <strong>Reply:</strong> {item.admin_reply}
          {item.replied_at && <p className="mt-1 text-xs text-emerald-700">Replied {new Date(item.replied_at).toLocaleString()}</p>}
        </div>
      ) : user?.role === 'superadmin' ? (
        <div className="rounded-lg border border-slate-200 bg-slate-100/70 p-3 text-xs text-slate-500 italic">
          Feedback replies are managed by the branch library staff.
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <textarea
            rows={2}
            value={feedbackReply[item.id] || ''}
            onChange={(event) => setFeedbackReply((current) => ({ ...current, [item.id]: event.target.value }))}
            placeholder="Write a reply..."
            aria-label={`Reply to ${item.visitor_name || 'visitor'} feedback`}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
          />
          <button
            type="button"
            onClick={() => handleFeedbackReply(item)}
            className="self-start whitespace-nowrap rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90"
          >
            Save reply
          </button>
        </div>
      )}
    </article>
  );

  const renderFeedbackSection = ({ title, description, items, total, page, onPageChange, isAnswered }) => (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${isAnswered ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
          {total} {total === 1 ? 'item' : 'items'}
        </span>
      </div>
      <div className="space-y-3">
        {items.map((item) => renderFeedbackCard(item, isAnswered))}
        {!loading && items.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            {feedbackSearch ? 'No feedback matches your search.' : isAnswered ? 'No replied feedback yet.' : 'No feedback is waiting for a reply.'}
          </p>
        )}
      </div>
      <AdminListPagination
        page={page}
        pageSize={feedbackPageSize}
        total={total}
        onPageChange={onPageChange}
        itemLabel={isAnswered ? 'replied submissions' : 'submissions needing a reply'}
      />
    </section>
  );

  if (!supabase) {
    return (
      <p className="border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Configure Supabase to use reports and management tools.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {/* NAVIGATION TABS */}
      <nav className="flex gap-2 overflow-x-auto border-b border-slate-200" aria-label="Admin workspace">
        {activeTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
              setError('');
              setMessage('');
              setLoading(['feedback', 'announcements'].includes(item.id));
            }}
            aria-current={tab === item.id ? 'page' : undefined}
            className={`shrink-0 border-b-2 px-3 py-3 text-sm font-semibold transition ${
              tab === item.id
                ? 'border-shelf-primary text-shelf-primary'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* ALERT MESSAGES */}
      {error && <p role="alert" className="border border-red-200 bg-red-50 p-3 text-sm text-red-800 rounded-lg">{error}</p>}
      {message && <p role="status" className="border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 rounded-lg">{message}</p>}

      {pendingReportExport && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/50 p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="report-export-confirm-title" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <h2 id="report-export-confirm-title" className="text-lg font-bold text-slate-900 dark:text-white">Download this report?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Your {pendingReportExport.label} report is ready. Continue to choose where to save <span className="font-semibold">{pendingReportExport.fileName}</span>.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={savingReportExport} onClick={() => setPendingReportExport(null)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200">Cancel</button>
              <button type="button" disabled={savingReportExport} onClick={() => void savePendingReportExport()} className="rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{savingReportExport ? 'Opening save dialog…' : 'Confirm and choose location'}</button>
            </div>
          </section>
        </div>
      )}
      {loading && <p className="text-sm text-slate-500">Loading records...</p>}
      {focusedNotificationRequestId && mode === 'reports' && tab === 'reports' && (
        <section
          id={`admin-notification-request-${focusedNotificationRequestId}`}
          role="status"
          className="scroll-mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm"
        >
          {focusedNotificationRequest ? (
            <>
              <h2 className="text-sm font-bold text-amber-950">
                Notification target: {focusedNotificationRequest.bookTitle || 'Untitled book'}
              </h2>
              <p className="mt-1 text-xs text-amber-900">
                {focusedNotificationRequest.visitorName || 'Visitor'}
                {' · Status: '}
                {formatStatus(focusedNotificationRequest.status)}
                {(focusedNotificationRequest.dueDate || focusedNotificationRequest.due_date) && ` · Due ${new Date(focusedNotificationRequest.dueDate || focusedNotificationRequest.due_date).toLocaleString()}`}
                {focusedNotificationRequest.pickupDeadline && ` · Pickup deadline ${new Date(focusedNotificationRequest.pickupDeadline).toLocaleString()}`}
              </p>
              <p className="mt-2 text-xs text-amber-800">
                Request ID: {focusedNotificationRequest.id}
                {focusedNotificationHandled && ' · This notification has already been handled or is no longer actionable.'}
              </p>
            </>
          ) : (
            <p className="text-sm font-semibold text-amber-950">
              The request associated with this notification no longer exists or is no longer available.
            </p>
          )}
        </section>
      )}

      {/* REPORTS TAB */}
      {tab === 'reports' && (
        <section className="admin-reports-workspace flex flex-col gap-6">
          {borrowRequestsLoadError && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <span>Borrowing history could not be loaded, so reports may not include book activity: {borrowRequestsLoadError}</span>
              {retryBorrowRequests && <button type="button" onClick={() => void retryBorrowRequests()} className="rounded-lg bg-amber-900 px-3 py-2 text-xs font-bold text-white">Try again</button>}
            </div>
          )}
          <div className="order-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-100 bg-linear-to-r from-slate-50 to-white p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-shelf-primary">
                  SHELF
                </p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
                  Activity Reports
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {isSubAdmin ? getLibraryName(libraries, currentLibraryId) : 'All libraries'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs font-medium text-slate-500">Selected period</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{analyticsWindow.label}</p>
              </div>
            </div>

            <div className="space-y-4 p-5">
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(10rem,0.7fr)_minmax(10rem,0.7fr)_minmax(12rem,1fr)] xl:items-end">
                <div className="min-w-0">
                  <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Filter by year and month</p>
                  <AnalyticsDateFilter
                    timeframe={timeframe}
                    onTimeframeChange={(value) => {
                      setTimeframe(value);
                      setForecast(null);
                    }}
                    customStart={customStartDate}
                    onCustomStartChange={(value) => { setCustomStartDate(value); setForecast(null); }}
                    customEnd={customEndDate}
                    onCustomEndChange={(value) => { setCustomEndDate(value); setForecast(null); }}
                    range={analyticsWindow}
                  />
                </div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Activity type
                  <select
                    value={activityTypeFilter}
                    onChange={(event) => setActivityTypeFilter(event.target.value)}
                    className="mt-2 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-700 outline-none transition focus:border-shelf-primary focus:ring-2 focus:ring-shelf-primary/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="all">All activities</option>
                    <option value="Visitor">Visitor check-ins</option>
                    <option value="Book request">Book requests</option>
                    <option value="Book return">Book returns</option>
                  </select>
                </label>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Sort activities
                  <select
                    value={reportSort}
                    onChange={(event) => setReportSort(event.target.value)}
                    className="mt-2 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-700 outline-none transition focus:border-shelf-primary focus:ring-2 focus:ring-shelf-primary/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="time">Newest first</option>
                    <option value="name">Visitor name</option>
                  </select>
                </label>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Search activity
                  <input type="search" value={activitySearch} onChange={(event) => { setActivitySearch(event.target.value); setActivityHistoryPage(1); }} placeholder="Visitor, book, branch…" className="mt-2 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-700 outline-none focus:border-shelf-primary focus:ring-2 focus:ring-shelf-primary/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white" />
                </label>
              </div>

              {/* STYLED EXPORT BUTTONS WITH ICONS */}
              <div className="flex flex-wrap items-center gap-2.5 border-t border-slate-100 pt-4">
                <span className="mr-1 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Export report:
                </span>
                <button
                  type="button"
                  onClick={() => handleExport('xlsx')}
                  disabled={exporting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-lg text-xs font-bold shadow-sm transition hover:-translate-y-0.5 cursor-pointer dark:bg-slate-800 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-slate-700"
                >
                  <FileSpreadsheet size={15} className="text-emerald-400" />
                  <span>{exportingFormat === 'xlsx' ? 'Exporting…' : 'Export Excel'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('csv')}
                  disabled={exporting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold shadow-sm transition hover:-translate-y-0.5 hover:border-slate-400 cursor-pointer"
                >
                  <FileCode size={15} className="text-blue-600" />
                  <span>{exportingFormat === 'csv' ? 'Exporting…' : 'Export CSV'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('pdf')}
                  disabled={exporting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-rose-50/50 text-rose-700 border border-rose-200 hover:border-rose-300 rounded-lg text-xs font-bold shadow-sm transition hover:-translate-y-0.5 cursor-pointer"
                >
                  <FileText size={15} className="text-rose-600" />
                  <span>{exportingFormat === 'pdf' ? 'Exporting…' : 'Export PDF'}</span>
                </button>
              </div>

              {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
              {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
              {!analyticsWindow.valid && (
                <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  {analyticsWindow.error}
                </p>
              )}
              {filteredReportRows.some((row) => row.dataClassification === 'Test data') && (
                <p role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
                  This report includes test records. They are included in the totals and charts, and are marked as test data in the activity table and exported reports. Do not interpret them as real visitor activity.
                </p>
              )}
            </div>
          </div>

          {/* STAT CARDS WITH HOVER ANIMATION */}
          <div className="order-1 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-200 cursor-pointer group">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-500">Visitor check-ins</p>
                  <p className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
                    {filteredReportRows.filter((row) => row.type === 'Visitor').length}
                  </p>
                </div>
                <span className="rounded-xl bg-blue-50 px-3 py-2 text-lg font-extrabold text-blue-700 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                  V
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">Recorded library visits</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-200 cursor-pointer group">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-500">Book requests</p>
                  <p className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
                    {filteredReportRows.filter((row) => row.type === 'Book request').length}
                  </p>
                </div>
                <span className="rounded-xl bg-violet-50 px-3 py-2 text-lg font-extrabold text-violet-700 group-hover:bg-violet-600 group-hover:text-white transition-colors">
                  B
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">Recorded book requests</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-200 cursor-pointer group">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-500">Book returns</p>
                  <p className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
                    {filteredReportRows.filter((row) => row.type === 'Book return').length}
                  </p>
                </div>
                <span className="rounded-xl bg-emerald-50 px-3 py-2 text-lg font-extrabold text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                  R
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">Returns recorded in this period</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-200 cursor-pointer group">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-500">Books currently borrowed</p>
                  <p className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
                    {scopedBorrows.filter(
                      (item) =>
                        item.status === 'borrowed' &&
                        isDateInsideWindow(item.borrowDate || item.requestDate, analyticsWindow)
                    ).length}
                  </p>
                </div>
                <span className="rounded-xl bg-amber-50 px-3 py-2 text-lg font-extrabold text-amber-700 group-hover:bg-amber-500 group-hover:text-white transition-colors">
                  L
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">Loans currently marked as borrowed</p>
            </div>
          </div>

          {/* ACTIVITY HISTORY TABLE WITH TITLE CASE STATUS & HOVER */}
          <div className="order-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-1 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">Activity history</h3>
                <p className="mt-1 text-sm text-slate-500">Review visitor check-ins, book requests, and returns.</p>
              </div>
              <span className="mt-2 inline-flex w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 sm:mt-0">
                {filteredReportRows.length} records
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-190 text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500 border-b border-slate-100">
                  <tr>
                    <th className="px-5 py-4 font-semibold">Time</th>
                    <th className="px-5 py-4 font-semibold">Activity</th>
                    <th className="px-5 py-4 font-semibold">Visitor</th>
                    <th className="px-5 py-4 font-semibold">Data source</th>
                    <th className="px-5 py-4 font-semibold">Details</th>
                    <th className="px-5 py-4 font-semibold">Branch</th>
                    <th className="px-5 py-4 font-semibold text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedReportRows.map((row, index) => (
                    <tr
                      key={`${row.type}-${row.time}-${activityHistoryStart + index}`}
                      className="transition-colors hover:bg-blue-50/40 cursor-pointer group"
                    >
                      <td className="whitespace-nowrap px-5 py-4 text-xs text-slate-500 font-medium">
                        {new Date(row.time).toLocaleString('en-PH', {
                          dateStyle: 'short',
                          timeStyle: 'medium',
                        })}
                      </td>
                      <td className="px-5 py-4">
                        <span className="font-bold text-slate-800 group-hover:text-blue-900 transition-colors">
                          {row.type}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-bold text-slate-800">{row.person}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${
                          row.dataClassification === 'Test data'
                            ? 'border border-amber-200 bg-amber-50 text-amber-900'
                            : 'border border-slate-200 bg-slate-50 text-slate-600'
                        }`}>
                          {row.dataClassification}
                        </span>
                      </td>
                      <td className="max-w-xs px-5 py-4 text-slate-600">
                        <span className="line-clamp-2">{row.detail}</span>
                      </td>
                      <td className="px-5 py-4 text-slate-600 font-medium">{row.branch}</td>
                      <td className="px-5 py-4 text-center">
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs transition-all ${getStatusBadgeClass(row.status)}`}>
                          {formatStatus(row.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredReportRows.length === 0 && (
              <div className="px-6 py-14 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-lg font-bold text-slate-500">
                  —
                </div>
                <h4 className="mt-3 text-sm font-semibold text-slate-800">No activity found</h4>
                <p className="mt-1 text-sm text-slate-500">Try selecting a different month.</p>
              </div>
            )}

            {filteredReportRows.length > 0 && (
              <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-600">
                  Showing {activityHistoryStart + 1}–{Math.min(activityHistoryStart + activityHistoryPageSize, filteredReportRows.length)} of {filteredReportRows.length} activities
                </p>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <label htmlFor="activity-history-page-size" className="flex items-center gap-2 text-xs font-medium text-slate-600">
                    Rows per page
                    <select
                      id="activity-history-page-size"
                      value={activityHistoryPageSize}
                      onChange={(event) => {
                        setActivityHistoryPageSize(Number(event.target.value));
                        setActivityHistoryPage(1);
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-700"
                    >
                      {[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
                    </select>
                  </label>
                  {activityHistoryPageCount > 1 && <nav className="flex flex-wrap items-center gap-1.5" aria-label="Activity history pages">
                  <button
                    type="button"
                    onClick={() => setActivityHistoryPage((page) => Math.max(1, page - 1))}
                    disabled={visibleActivityHistoryPage === 1}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Previous
                  </button>
                  {activityHistoryPages.map((page) => (
                    typeof page === 'string' ? (
                      <span key={page} className="px-2 text-sm text-slate-500" aria-hidden="true">…</span>
                    ) : (
                      <button
                        key={page}
                        type="button"
                        onClick={() => setActivityHistoryPage(page)}
                        aria-label={`Go to activity history page ${page}`}
                        aria-current={page === visibleActivityHistoryPage ? 'page' : undefined}
                        className={`min-w-10 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                          page === visibleActivityHistoryPage
                            ? 'border-shelf-primary bg-shelf-primary text-white'
                            : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {page}
                      </button>
                    )
                  ))}
                  <button
                    type="button"
                    onClick={() => setActivityHistoryPage((page) => Math.min(activityHistoryPageCount, page + 1))}
                    disabled={visibleActivityHistoryPage === activityHistoryPageCount}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </nav>}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ANALYTICS TAB */}
      {tab === 'analytics' && (
        <section className="space-y-5">
          {borrowRequestsLoadError && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <span>Borrowing history could not be loaded, so borrowing charts may be incomplete: {borrowRequestsLoadError}</span>
              {retryBorrowRequests && <button type="button" onClick={() => void retryBorrowRequests()} className="rounded-lg bg-amber-900 px-3 py-2 text-xs font-bold text-white">Try again</button>}
            </div>
          )}
          <section className="border border-slate-200 bg-white p-4 rounded-xl shadow-sm">
            <div className="mb-4">
              <h2 className="text-base font-bold text-slate-900">Analytics filters</h2>
              <p className="mt-1 text-sm text-slate-500">
                {isSubAdmin
                  ? 'Analytics are automatically limited to your assigned branch. Select a year and month to view activity.'
                  : 'Filter analytics by library or branch, year, and month.'}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {!isSubAdmin && (
                <label className="block text-sm font-semibold text-slate-700">
                  Library / Branch
                  <select
                    value={analyticsLibraryId}
                    onChange={(event) => {
                      setAnalyticsLibraryId(event.target.value);
                      setForecast(null);
                    }}
                    className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                  >
                    <option value="">All libraries</option>
                    {libraries.map((library) => (
                      <option key={library.id} value={library.id}>
                        {library.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <AnalyticsDateFilter
                timeframe={timeframe}
                onTimeframeChange={(value) => {
                  setTimeframe(value);
                  setForecast(null);
                }}
                customStart={customStartDate}
                onCustomStartChange={(value) => {
                  setCustomStartDate(value);
                  setForecast(null);
                }}
                customEnd={customEndDate}
                onCustomEndChange={(value) => {
                  setCustomEndDate(value);
                  setForecast(null);
                }}
                range={analyticsWindow}
              />
            </div>
            {isSubAdmin && (
              <div className="mt-4">
                <p className="text-sm font-semibold text-slate-700">Assigned branch</p>
                <div className="mt-1 border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 rounded-lg font-medium">
                  {getLibraryName(libraries, currentLibraryId)}
                </div>
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-slate-500">Showing:</span>
              <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                {isSubAdmin
                  ? getLibraryName(libraries, currentLibraryId)
                  : effectiveAnalyticsLibraryId
                  ? getLibraryName(libraries, effectiveAnalyticsLibraryId)
                  : 'All libraries'}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">
                {analyticsWindow.label}
              </span>
            </div>
            {!analyticsWindow.valid && (
              <p className="mt-3 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 rounded-lg">
                {analyticsWindow.error}
              </p>
            )}
            {!attendanceDataComplete && (
              <p className="mt-3 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 rounded-lg">
                Attendance data is still loading or incomplete. Charts use the records currently loaded; Gemini insights remain unavailable until the full attendance list is ready.
              </p>
            )}
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <div className="border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
              <div className="mb-4">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-blue-700">Descriptive analytics</p>
                <h2 className="text-lg font-bold text-slate-900">Library visits and book borrowing</h2>
                <p className="text-sm text-slate-500">
                  {isSubAdmin
                    ? getLibraryName(libraries, currentLibraryId)
                    : effectiveAnalyticsLibraryId
                    ? getLibraryName(libraries, effectiveAnalyticsLibraryId)
                    : 'All libraries'}
                  {' · '}
                  {analyticsWindow.label}
                </p>
                <p className="mt-1 text-xs text-slate-500">Compares recorded library check-ins with book requests across the selected date range.</p>
              </div>
              {analyticsWindow.valid ? (
                <Bar
                  data={{
                    labels: periodCounts.labels,
                    datasets: [
                      {
                        label: 'Library visits',
                        data: periodCounts.visits,
                        backgroundColor: '#0f766e',
                      },
                      {
                        label: 'Book requests',
                        data: periodCounts.transactions,
                        backgroundColor: '#d97706',
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: true,
                    scales: {
                      y: {
                        beginAtZero: true,
                        ticks: { precision: 0 },
                      },
                    },
                    plugins: { legend: { display: true } },
                  }}
                />
              ) : (
                <div className="border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 rounded-lg">
                  Select a valid year and month to display analytics.
                </div>
              )}
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <Metric label="Visitors" value={analyticsAttendance.length} />
                <Metric label="Book requests" value={analyticsBorrows.length} />
                <Metric
                  label="Books currently borrowed"
                  value={analyticsBorrows.filter((item) => getRequestStatus(item) === 'borrowed').length}
                />
              </div>
            </div>

            <section className="flex min-h-0 min-w-0 flex-col border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-blue-700">Descriptive analytics</p>
                  <h2 className="text-lg font-bold text-slate-900">Most requested book categories</h2>
                  <p className="mt-1 text-sm text-slate-500">Categories visitors requested most during the selected month.</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                  Total: {totalCategoryRequests} requests
                </span>
              </div>
              {topCategories.length > 0 ? (
                <>
                  <div className="relative mt-4 min-h-72 min-w-0 w-full flex-1">
                    <Bar
                      data={{
                        labels: categoryChartRows.map(([category]) => formatBookCategory(category)),
                        datasets: [{
                          label: 'Book requests',
                          data: categoryChartRows.map(([, count]) => count),
                          backgroundColor: categoryChartRows.map((_, index) => CATEGORY_CHART_COLORS[index % CATEGORY_CHART_COLORS.length]),
                          borderRadius: 5,
                          barThickness: 28,
                        }],
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        indexAxis: 'y',
                        plugins: {
                          legend: { display: false },
                          tooltip: {
                            callbacks: {
                              label: (context) => ` ${context.label}: ${context.parsed.x} requests`,
                            },
                          },
                        },
                        scales: {
                          x: {
                            beginAtZero: true,
                            max: categoryAxisMax,
                            ticks: { precision: 0, stepSize: categoryAxisStep, autoSkip: false, maxRotation: 0 },
                            grid: { color: '#e2e8f0' },
                          },
                          y: {
                            grid: { display: false },
                            ticks: { color: '#475569' },
                          },
                        },
                      }}
                    />
                  </div>
                  <ul className="mt-3 grid gap-x-5 gap-y-2 border-t border-slate-100 pt-3 sm:grid-cols-2">
                    {categoryChartRows.map(([category, count], index) => (
                      <li key={category} className="flex min-w-0 items-center justify-between gap-3 text-xs">
                        <span className="flex min-w-0 items-center gap-2 text-slate-600">
                          <span
                            aria-hidden="true"
                            className="h-2.5 w-2.5 shrink-0 rounded-sm"
                            style={{ backgroundColor: CATEGORY_CHART_COLORS[index % CATEGORY_CHART_COLORS.length] }}
                          />
                          <span className="truncate">{formatBookCategory(category)}</span>
                        </span>
                        <span className="shrink-0 font-bold text-slate-800">{count} requests</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-2 text-sm text-slate-500">
                  No book transaction data found for the selected filters.
                </p>
              )}
            </section>

            <div className="grid gap-4 xl:col-span-2 xl:grid-cols-2">
              <section className="border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
                <h2 className="text-base font-bold text-slate-800">Prescriptive analytics · Demand and available copies</h2>
                <p className="mt-1 text-xs text-slate-500">Compare book requests with copies currently available in each category to help identify where to review stock.</p>
                {demandAndAvailabilityRows.length > 0 ? (
                  <div className="mt-4 min-h-64">
                    <Bar
                      data={{
                        labels: demandAndAvailabilityRows.map((row) => formatBookCategory(row.category)),
                        datasets: [
                          { label: 'Book requests', data: demandAndAvailabilityRows.map((row) => row.requests), backgroundColor: '#2563eb', borderRadius: 4 },
                          { label: 'Available copies', data: demandAndAvailabilityRows.map((row) => row.available), backgroundColor: '#10b981', borderRadius: 4 },
                        ],
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        indexAxis: 'y',
                        scales: {
                          x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#e2e8f0' } },
                          y: { grid: { display: false }, ticks: { color: '#475569' } },
                        },
                        plugins: { legend: { position: 'bottom' } },
                      }}
                    />
                  </div>
                ) : <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No book requests match this reporting period yet.</p>}
                <h3 className="mt-4 text-sm font-semibold text-slate-800">Suggested actions</h3>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600">
                  {demandRecommendations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>

              <section className="border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-bold text-slate-800">Predictive analytics · Estimate upcoming library visits</h2>
                  <button
                    type="button"
                    onClick={runForecast}
                    disabled={forecastLoading || !analyticsWindow.valid || !forecastCanRun}
                    className="bg-shelf-primary px-3 py-2 text-xs font-bold text-white rounded-lg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {forecastLoading ? 'Generating insights...' : 'Generate Insights'}
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  The chart appears automatically from recent check-ins. It estimates each weekday from up to four recent weeks; Gemini can add a separate interpretation when requested.
                </p>
                {forecast?.source === 'gemini' && <p className="mt-1 text-xs text-emerald-700">Gemini reviewed the selected records and generated these insights and suggested actions. Visitor counts are estimated from the attendance history.</p>}
                <p className="mt-1 text-xs text-slate-500">
                  Records included: {forecastHistoryDays} days - {forecastTotalVisits.toLocaleString()} check-ins on {forecastObservedVisitDays} days.
                </p>
                {!attendanceDataComplete && <p className="mt-1 text-xs font-medium text-amber-700">The attendance list is incomplete, so this automatic estimate uses only the records loaded so far.</p>}
                {(forecastChartData || automaticForecastChartData) ? (
                  <div className="mt-4">
                    <p className="mb-2 text-xs text-slate-500">{forecastChartData ? 'Gemini forecast with recent attendance history.' : 'Recent attendance and an automatic weekday-based estimate for the next seven days.'}</p>
                    <Line
                      data={forecastChartData || automaticForecastChartData}
                      options={{
                        responsive: true,
                        maintainAspectRatio: true,
                        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
                        plugins: { legend: { position: 'bottom' } },
                      }}
                    />
                  </div>
                ) : (
                  <p className="mt-3 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">
                    The chart will appear automatically once at least one check-in is available in the selected period.
                  </p>
                )}
                {forecast?.forecasts?.length ? (
                  <>
                    <ol className="mt-3 space-y-1 text-sm text-slate-600">
                      {forecast.forecasts.map((item) => (
                        <li key={item.date} className="flex justify-between border-b border-slate-50 py-1">
                          <span>{new Date(`${item.date}T00:00:00`).toLocaleDateString()}</span>
                          <span className="font-bold">{item.visitorCount} visitors</span>
                        </li>
                      ))}
                    </ol>
                  </>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">
                    {forecastCanRun
                      ? 'Generate Insights is optional and adds Gemini commentary to the automatic chart.'
                    : 'Not enough complete attendance records yet. Add more check-ins, then try again.'}
                  </p>
                )}
                <div className="mt-5 grid gap-4 border-t border-slate-200 pt-4 lg:grid-cols-2">
                    <section
                    className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/40"
                    aria-labelledby="forecast-insights-heading"
                  >
                    <h3
                      id="forecast-insights-heading"
                      className="text-sm font-bold text-slate-800"
                    >
                      Recent pattern
                    </h3>
                    <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
                      {forecastNarrative.insights.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                    <section
                    className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40"
                    aria-labelledby="forecast-recommendations-heading"
                  >
                    <h3
                      id="forecast-recommendations-heading"
                      className="text-sm font-bold text-amber-950 dark:text-amber-100"
                    >
                      Suggested next step
                    </h3>
                    <ul className="mt-2 list-disc space-y-2 pl-5 text-sm font-medium leading-6 text-amber-950 dark:text-amber-100">
                      {forecastNarrative.recommendations.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  These estimates use the selected month and filters. Compare them with your branch records before changing staff schedules or book copy counts.
                </p>
              </section>
            </div>
          </section>
          <div className="flex flex-wrap items-center gap-2.5 border-t border-slate-200 pt-4">
            <span className="mr-1 text-xs font-bold uppercase tracking-wider text-slate-500">
              Analytics export:
            </span>
            {[
              { format: 'xlsx', label: 'Excel', Icon: FileSpreadsheet, tone: 'text-emerald-700' },
              { format: 'csv', label: 'CSV', Icon: FileCode, tone: 'text-blue-700' },
              { format: 'pdf', label: 'PDF', Icon: FileText, tone: 'text-rose-700' },
            ].map(({ format, label, Icon, tone }) => (
              <button
                key={format}
                type="button"
                onClick={() => handleAnalyticsExport(format)}
                disabled={exporting || !analyticsWindow.valid}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-shelf-primary hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Icon size={16} className={tone} aria-hidden="true" />
                <span>{exportingFormat === format ? `Preparing ${label}…` : `Prepare ${label}`}</span>
              </button>
            ))}
          </div>
          {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        </section>
      )}

      {/* FEEDBACK TAB */}
      {tab === 'feedback' && (
        <section className="space-y-4">
          {user?.role === 'superadmin' && (
            <div className="flex items-center gap-2.5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-200">
              <ShieldCheck size={18} className="shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span>System-wide feedback oversight (Read-only). Message replies are handled by branch library staff.</span>
            </div>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Visitor feedback</h2>
              <p className="text-sm text-slate-500">Reply to new messages and review replies in separate sections.</p>
            </div>
            <div className="w-full sm:max-w-sm">
              <input
                type="search"
                value={feedbackSearch}
                onChange={(event) => {
                  setFeedbackSearch(event.target.value);
                  setFeedbackPage(1);
                  setAnsweredFeedbackPage(1);
                }}
                placeholder="Search visitor, email, or subject"
                aria-label="Search feedback"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-shelf-primary focus:ring-2 focus:ring-shelf-primary/20"
              />
            </div>
          </div>
          {loading && <p className="text-sm text-slate-500">Loading feedback…</p>}
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            {renderFeedbackSection({
              title: 'Needs reply',
              description: 'Visitor messages that still need a response.',
              items: feedback,
              total: feedbackTotal,
              page: visibleFeedbackPage,
              onPageChange: setFeedbackPage,
              isAnswered: false,
            })}
            {renderFeedbackSection({
              title: 'Replied',
              description: 'Visitor messages that already have a response.',
              items: answeredFeedback,
              total: answeredFeedbackTotal,
              page: visibleAnsweredFeedbackPage,
              onPageChange: setAnsweredFeedbackPage,
              isAnswered: true,
            })}
          </div>
        </section>
      )}

      {/* ANNOUNCEMENTS TAB */}
      {tab === 'announcements' && (
        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
          <div className="space-y-3">
            <div className="space-y-3">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Announcements</h2>
                <p className="text-sm text-slate-500">Published notices stay visible until their expiration date.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(14rem,1fr)_auto]">
                <input
                  type="search"
                  value={announcementsSearch}
                  onChange={(event) => {
                    setAnnouncementsSearch(event.target.value);
                    setAnnouncementsPage(1);
                  }}
                  placeholder="Search announcement title"
                  aria-label="Search announcements"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-shelf-primary focus:ring-2 focus:ring-shelf-primary/20"
                />
                <select
                  value={announcementsStatusFilter}
                  onChange={(event) => {
                    setAnnouncementsStatusFilter(event.target.value);
                    setAnnouncementsPage(1);
                  }}
                  aria-label="Filter announcements by status"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-shelf-primary focus:ring-2 focus:ring-shelf-primary/20"
                >
                  <option value="all">All announcements</option>
                  <option value="published">Published</option>
                  <option value="expired">Expired</option>
                </select>
              </div>
            </div>
            {loading && <p className="text-sm text-slate-500">Loading announcements…</p>}
            {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
            {!loading && announcements.map((item) => (
              <article key={item.id} className="border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-slate-900">{item.title}</h3>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-600 leading-relaxed">{item.message}</p>
                    <p className="mt-3 text-xs font-medium text-slate-400">
                  <span className="mr-1 rounded-full bg-blue-50 px-2 py-1 font-semibold text-blue-700">
                    {item.audience === 'general'
                      ? 'General · Landing page'
                      : item.audience === 'both'
                        ? 'Both · Landing page + Visitors'
                        : 'Visitor'}
                  </span>
                  {item.published && item.expires_at && isAnnouncementExpired(item.expires_at)
                        ? 'Expired'
                        : 'Published'} · {new Date(item.created_at).toLocaleString()}
                      {item.expires_at && (
                        <> · Expires {new Date(item.expires_at).toLocaleDateString()}</>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleAnnouncementEdit(item)}
                      className="text-xs font-bold text-shelf-primary hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      data-confirm-message={`Delete announcement "${item.title || 'this announcement'}"? This cannot be undone.`}
                      onClick={() => handleAnnouncementDelete(item.id)}
                      className="text-xs font-bold text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
            {!loading && announcementsTotal === 0 && (
              <p className="border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 rounded-xl">
                {announcementsSearch || announcementsStatusFilter !== 'all'
                  ? 'No announcements match these filters.'
                  : 'No announcements have been created.'}
              </p>
            )}
            <AdminListPagination
              page={visibleAnnouncementsPage}
              pageSize={10}
              total={announcementsTotal}
              onPageChange={setAnnouncementsPage}
              itemLabel="announcements"
            />
          </div>

          <form onSubmit={handleAnnouncementSave} className="h-fit space-y-3 border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
            <h2 className="font-bold text-slate-800">
              {editingAnnouncementId ? 'Edit announcement' : 'New announcement'}
            </h2>
            {isSubAdmin && (
              <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-normal text-sky-800">
                Sub-admin announcements appear on visitor dashboards only, not on the public landing page.
              </p>
            )}
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              Title
              <input
                required
                maxLength={160}
                value={announcementForm.title}
                onChange={(event) =>
                  setAnnouncementForm({ ...announcementForm, title: event.target.value })
                }
                className="mt-1 w-full border border-slate-300 px-3 py-2 text-sm font-normal rounded-lg focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
              />
            </label>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              Message
              <textarea
                required
                rows={6}
                maxLength={5000}
                value={announcementForm.message}
                onChange={(event) =>
                  setAnnouncementForm({ ...announcementForm, message: event.target.value })
                }
                className="mt-1 w-full border border-slate-300 px-3 py-2 text-sm font-normal rounded-lg focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
              />
            </label>
            {!isSubAdmin && (
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Announcement audience
                <select
                  value={announcementForm.audience}
                  onChange={(event) => setAnnouncementForm({ ...announcementForm, audience: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal normal-case text-slate-700 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                >
                  <option value="general">General — Landing page</option>
                  <option value="visitor">Visitor — Visitor dashboard</option>
                  <option value="both">Both — Landing page + Visitors</option>
                </select>
                <span className="mt-1 block text-xs font-normal normal-case text-slate-500">
                  General announcements appear on the landing page, Visitor announcements appear to signed-in visitors, and Both announcements appear in both places.
                </span>
              </label>
            )}
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              Announcement duration
              <select
                value={announcementForm.expirationMode}
                onChange={(event) => {
                  setAnnouncementForm({ ...announcementForm, expirationMode: event.target.value });
                  setAnnouncementExpirationChanged(true);
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal normal-case text-slate-700 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
              >
                <option value="permanent">Permanent</option>
                <option value="temporary">Temporary</option>
              </select>
            </label>
            {announcementForm.expirationMode === 'temporary' && (
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(8rem,0.8fr)] gap-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Duration
                  <input
                    type="number"
                    min="1"
                    max={announcementForm.durationUnit === 'months' ? 120 : 3650}
                    required
                    value={announcementForm.duration}
                    onChange={(event) => {
                      setAnnouncementForm({ ...announcementForm, duration: event.target.value });
                      setAnnouncementExpirationChanged(true);
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal normal-case text-slate-700 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                  />
                </label>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Unit
                  <select
                    value={announcementForm.durationUnit}
                    onChange={(event) => {
                      setAnnouncementForm({ ...announcementForm, durationUnit: event.target.value });
                      setAnnouncementExpirationChanged(true);
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal normal-case text-slate-700 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                  >
                    <option value="days">Days</option>
                    <option value="months">Months</option>
                  </select>
                </label>
              </div>
            )}
            <p className="text-xs leading-5 text-slate-500">
              {announcementForm.expirationMode === 'temporary'
                ? 'Visitors will no longer see this announcement after its expiration date.'
                : 'This announcement will remain visible until you unpublish or delete it.'}
            </p>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              {editingAnnouncementId && (
                <button
                  type="button"
                  onClick={() => {
                    setAnnouncementForm({
                      title: '',
                      message: '',
                      audience: 'visitor',
                      expirationMode: 'permanent',
                      duration: '7',
                      durationUnit: 'days',
                      expiresAt: null,
                    });
                    setAnnouncementExpirationChanged(false);
                    setEditingAnnouncementId(null);
                  }}
                  className="border border-slate-300 px-4 py-2 text-sm font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                data-confirm-message={editingAnnouncementId ? undefined : `Publish announcement "${announcementForm.title || 'Untitled announcement'}" for visitors now?`}
                className="bg-shelf-primary px-4 py-2 text-sm font-bold text-white rounded-lg transition hover:opacity-90"
              >
                {editingAnnouncementId ? 'Save changes' : 'Publish announcement'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* AUDIT TRAIL TAB */}
      {tab === 'audit' && !isSubAdmin && <AuditLogViewer libraries={libraries} />}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="border border-slate-200 bg-white p-4 rounded-xl shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-slate-900">{value}</p>
    </div>
  );
}

function getAnnouncementExpirationDate(duration, unit) {
  const expirationDate = new Date();
  if (unit === 'months') {
    const originalDay = expirationDate.getDate();
    expirationDate.setDate(1);
    expirationDate.setMonth(expirationDate.getMonth() + duration);
    const lastDayOfMonth = new Date(
      expirationDate.getFullYear(),
      expirationDate.getMonth() + 1,
      0
    ).getDate();
    expirationDate.setDate(Math.min(originalDay, lastDayOfMonth));
  } else {
    expirationDate.setDate(expirationDate.getDate() + duration);
  }
  return expirationDate.toISOString();
}

function AdminListPagination({ page, pageSize, total, onPageChange, itemLabel }) {
  if (total === 0) return null;
  const pageCount = Math.ceil(total / pageSize);
  const pages = pageCount <= 5
    ? Array.from({ length: pageCount }, (_, index) => index + 1)
    : [
        1,
        ...(page > 3 ? ['ellipsis-left'] : []),
        ...Array.from(
          { length: Math.max(0, Math.min(pageCount - 1, page + 1) - Math.max(2, page - 1) + 1) },
          (_, index) => Math.max(2, page - 1) + index
        ),
        ...(page < pageCount - 2 ? ['ellipsis-right'] : []),
        pageCount,
      ];
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const buttonClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-slate-600">Showing {start}–{end} of {total} {itemLabel}</p>
      <nav className="flex flex-wrap items-center gap-1.5" aria-label={`${itemLabel} pages`}>
        <button type="button" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1} className={buttonClass}>
          Previous
        </button>
        <PageJump page={page} pageCount={pageCount} onPageChange={onPageChange} />
        {pages.map((number) => typeof number === 'string' ? (
          <span key={number} className="px-2 text-sm text-slate-500" aria-hidden="true">…</span>
        ) : (
          <button
            key={number}
            type="button"
            onClick={() => onPageChange(number)}
            aria-label={`Go to ${itemLabel} page ${number}`}
            aria-current={number === page ? 'page' : undefined}
            className={`min-w-10 rounded-lg border px-3 py-2 text-sm font-semibold transition ${number === page ? 'border-shelf-primary bg-shelf-primary text-white' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
          >
            {number}
          </button>
        ))}
        <button type="button" onClick={() => onPageChange(Math.min(pageCount, page + 1))} disabled={page === pageCount} className={buttonClass}>
          Next
        </button>
      </nav>
    </div>
  );
}
