import { useEffect, useMemo, useState } from 'react';
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
import { FileSpreadsheet, FileCode, FileText } from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';
import { exportReport } from '../lib/excelUtils.js';
import AnalyticsDateFilter from './AnalyticsDateFilter.jsx';
import AuditLogViewer from './AuditLogViewer.jsx';
import {
  getTimeframeBuckets,
  getTimeframeRange,
} from '../lib/analyticsDateRange.js';

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

function getDateKey(value, timeframe) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  if (timeframe === 'year') {
    return monthKey;
  }
  return `${monthKey}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatLocalDateInput(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
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
  borrowRequests = [],
  focusedNotificationRequestId = null,
  focusedNotificationType = null,
}) {
  const isSubAdmin = user?.role === 'subadmin';
  const currentLibraryId = user?.libraryId || user?.assignedBranch || '';
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
  const [timeframe, setTimeframe] = useState('this_month');
  const [activityTypeFilter, setActivityTypeFilter] = useState('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [reportSort, setReportSort] = useState('time');
  const [activityHistoryPage, setActivityHistoryPage] = useState(1);
  const [feedback, setFeedback] = useState([]);
  const [feedbackTotal, setFeedbackTotal] = useState(0);
  const [feedbackPage, setFeedbackPage] = useState(1);
  const [feedbackSearch, setFeedbackSearch] = useState('');
  const [feedbackStatusFilter, setFeedbackStatusFilter] = useState('all');
  const [announcements, setAnnouncements] = useState([]);
  const [announcementsTotal, setAnnouncementsTotal] = useState(0);
  const [announcementsPage, setAnnouncementsPage] = useState(1);
  const [announcementsSearch, setAnnouncementsSearch] = useState('');
  const [announcementsStatusFilter, setAnnouncementsStatusFilter] = useState('all');
  const [sectionRefreshTick, setSectionRefreshTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [announcementForm, setAnnouncementForm] = useState({
    title: '',
    message: '',
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

  const booksById = useMemo(
    () => new Map(books.map((book) => [book.id, book])),
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
      attendanceLogs.filter((item) =>
        isSubAdmin ? String(item.libraryId) === String(currentLibraryId) : true
      ),
    [attendanceLogs, currentLibraryId, isSubAdmin]
  );

  const scopedBorrows = useMemo(
    () =>
      borrowRequests.filter((item) => {
        const book = booksById.get(item.bookId);
        if (isSubAdmin) {
          return String(book?.libraryId) === String(currentLibraryId);
        }
        return true;
      }),
    [booksById, borrowRequests, currentLibraryId, isSubAdmin]
  );

  const reportRows = useMemo(() => {
    const attendanceRows = scopedAttendance
      .filter((item) => isDateInsideWindow(item.timeIn, analyticsWindow))
      .map((item) => ({
        type: 'Visitor',
        time: item.timeIn,
        person: isSubAdmin
          ? item.visitorName || 'Unknown visitor'
          : (item.visitorName || 'Unknown visitor').replace(/^\[TEST\]\s*/i, ''),
        detail: 'Library visit',
        branch: getLibraryName(libraries, item.libraryId),
        status: item.checkedOutAt ? 'Checked out' : 'Checked in',
        dataClassification: String(item.visitorName || '').startsWith('[TEST] ')
          ? 'Test data'
          : 'Operational data',
      }));

    const transactionRows = scopedBorrows
      .filter((item) => isDateInsideWindow(item.requestDate, analyticsWindow))
      .map((item) => ({
        type: 'Book transaction',
        time: item.requestDate,
        person: item.visitorName || 'Unknown visitor',
        detail: item.bookTitle || 'Book transaction',
        branch: getLibraryName(libraries, booksById.get(item.bookId)?.libraryId),
        status: formatStatus(item.status),
        dataClassification: 'Operational data',
      }));

    const returnRows = scopedBorrows
      .filter((item) => isDateInsideWindow(item.returnDate, analyticsWindow))
      .map((item) => ({
        type: 'Book return',
        time: item.returnDate,
        person: item.visitorName || 'Unknown visitor',
        detail: item.bookTitle || 'Book return',
        branch: getLibraryName(libraries, booksById.get(item.bookId)?.libraryId),
        status: `Returned${Number(item.fineAmount) > 0 ? `; Fine ₱${item.fineAmount}` : ''}`,
        dataClassification: 'Operational data',
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
    isSubAdmin,
  ]);

  const filteredReportRows = useMemo(
    () => activityTypeFilter === 'all'
      ? reportRows
      : reportRows.filter((row) => row.type === activityTypeFilter),
    [activityTypeFilter, reportRows]
  );
  const activityHistoryPageSize = 20;
  const activityHistoryPageCount = Math.max(1, Math.ceil(filteredReportRows.length / activityHistoryPageSize));
  const visibleActivityHistoryPage = Math.min(activityHistoryPage, activityHistoryPageCount);
  const visibleFeedbackPage = Math.min(feedbackPage, Math.max(1, Math.ceil(feedbackTotal / 10)));
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
        let query = supabase
          .from('visitor_feedback')
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false });
        if (isSubAdmin) {
          query = query.eq('library_id', currentLibraryId);
        }
        if (feedbackStatusFilter !== 'all') {
          query = feedbackStatusFilter === 'new'
            ? query.in('status', ['new', 'in_review'])
            : query.eq('status', feedbackStatusFilter);
        }
        const search = feedbackSearch.trim().replace(/[(),]/g, ' ');
        if (search) {
          query = query.or(`subject.ilike.%${search}%,visitor_name.ilike.%${search}%,visitor_email.ilike.%${search}%`);
        }
        query = query.range((visibleFeedbackPage - 1) * 10, visibleFeedbackPage * 10 - 1);
        result = await query;
      } else if (tab === 'announcements') {
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
        result = await query;
      }
      if (!active) return;
      if (result.error) {
        setError(result.error.message);
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
    currentLibraryId,
    feedbackPage,
    feedbackSearch,
    feedbackStatusFilter,
    isSubAdmin,
    sectionRefreshTick,
    tab,
    visibleAnnouncementsPage,
    visibleFeedbackPage,
  ]);

  const effectiveAnalyticsLibraryId = isSubAdmin ? currentLibraryId : analyticsLibraryId;

  const analyticsScopedAttendance = useMemo(
    () =>
      attendanceLogs.filter((item) => {
        if (isSubAdmin) {
          return String(item.libraryId) === String(currentLibraryId);
        }
        if (!analyticsLibraryId) return true;
        return String(item.libraryId) === String(analyticsLibraryId);
      }),
    [attendanceLogs, currentLibraryId, isSubAdmin, analyticsLibraryId]
  );

  const analyticsScopedBorrows = useMemo(
    () =>
      borrowRequests.filter((item) => {
        const book = booksById.get(item.bookId);
        if (isSubAdmin) {
          return String(book?.libraryId) === String(currentLibraryId);
        }
        if (!analyticsLibraryId) return true;
        return String(book?.libraryId) === String(analyticsLibraryId);
      }),
    [booksById, borrowRequests, currentLibraryId, isSubAdmin, analyticsLibraryId]
  );

  const analyticsAttendance = useMemo(
    () =>
      analyticsScopedAttendance.filter((item) =>
        isDateInsideWindow(item.timeIn, analyticsWindow)
      ),
    [analyticsScopedAttendance, analyticsWindow]
  );

  const analyticsBorrows = useMemo(
    () =>
      analyticsScopedBorrows.filter((item) =>
        isDateInsideWindow(item.requestDate, analyticsWindow)
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
      const key = getDateKey(item.timeIn, timeframe);
      visitCounts.set(key, (visitCounts.get(key) || 0) + 1);
    });
    analyticsBorrows.forEach((item) => {
      const key = getDateKey(item.requestDate, timeframe);
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
    return getTimeframeBuckets('custom', analyticsWindow).slice(-366);
  }, [analyticsWindow]);

  const forecastHistoryDays = forecastHistoryBuckets.length;
  const forecastDailyVisitorCounts = useMemo(() => {
    if (!forecastHistoryDays) return [];
    const counts = new Map();
    analyticsAttendance.forEach((item) => {
      const key = getDateKey(item.timeIn, 'custom');
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return forecastHistoryBuckets.map((bucket) => counts.get(bucket.key) || 0);
  }, [analyticsAttendance, forecastHistoryBuckets, forecastHistoryDays]);

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
          label: 'Forecast visitors',
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
      const category = booksById.get(request.bookId)?.category || 'Uncategorized';
      counts.set(category, (counts.get(category) || 0) + 1);
    });
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [booksById, analyticsBorrows]);

  const topCategories = categoryDemand.slice(0, 5);
  const otherCategoryRequestCount = categoryDemand
    .slice(5)
    .reduce((sum, [, count]) => sum + count, 0);
  const categoryChartRows = otherCategoryRequestCount > 0
    ? [...topCategories, ['Other categories', otherCategoryRequestCount]]
    : topCategories;
  const totalCategoryRequests = categoryDemand.reduce((sum, [, count]) => sum + count, 0);

  const demandRecommendations = useMemo(() => {
    if (!analyticsWindow.valid) {
      return [analyticsWindow.error || 'Select a valid analytics date range.'];
    }
    const visitTimes = analyticsAttendance
      .map((item) => new Date(item.timeIn).getTime())
      .filter((value) => Number.isFinite(value));
    const latestVisit = Math.max(...visitTimes, 0);

    if (!latestVisit) {
      return [
        'There is not yet enough visitor activity in the selected date range to generate a demand recommendation.',
      ];
    }
    const recent = analyticsAttendance.filter(
      (item) => latestVisit - new Date(item.timeIn).getTime() < 7 * 86400000
    ).length;
    const prior = analyticsAttendance.filter((item) => {
      const age = latestVisit - new Date(item.timeIn).getTime();
      return age >= 7 * 86400000 && age < 14 * 86400000;
    }).length;

    const suggestions = [];
    if (recent > prior * 1.2 && recent >= 5) {
      suggestions.push(
        'Visitor volume is up at least 20% week over week. Consider adding front-desk coverage during peak hours.'
      );
    }
    if (topCategories[0]) {
      suggestions.push(
        `Review copy levels for ${topCategories[0][0]}, the highest-demand category in the selected transaction data.`
      );
    }
    if (suggestions.length === 0) {
      suggestions.push(
        'Demand is steady or there is not yet enough activity to recommend a staffing change. Continue collecting branch activity.'
      );
    }
    return suggestions;
  }, [analyticsAttendance, analyticsWindow, topCategories]);

  const handleExport = async (format) => {
    if (!analyticsWindow.valid) {
      setError(analyticsWindow.error);
      return;
    }
    setExporting(true);
    setError('');
    setMessage('');
    try {
      const branchLabel = isSubAdmin
        ? getLibraryName(libraries, currentLibraryId)
        : analyticsLibraryId
          ? getLibraryName(libraries, analyticsLibraryId)
          : 'All Libraries';
      await exportReport(filteredReportRows, format, {
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
          ['Total Borrows', analyticsBorrows.length],
        ],
      });
      setMessage('Report exported successfully.');
    } catch {
      setError('The report could not be exported. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleAnalyticsExport = async (format) => {
    if (!analyticsWindow.valid) {
      setError(analyticsWindow.error);
      return;
    }
    setExporting(true);
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
      await exportReport(rows, format, {
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
          { key: 'bookTransactions', label: 'Book Transactions', type: 'number' },
        ],
        totalRow: {
          period: 'Total',
          visitors: analyticsAttendance.length,
          bookTransactions: analyticsBorrows.length,
        },
        totalColumns: ['visitors', 'bookTransactions'],
        summary: [
          ['Visitors', analyticsAttendance.length],
          ['Book Transactions', analyticsBorrows.length],
          ['Active Loans', analyticsBorrows.filter((item) => item.status === 'borrowed').length],
        ],
        chartImages,
        chartTitles: ['Branch demand'],
      });
      setMessage('Report exported successfully.');
    } catch {
      setError('The report could not be exported. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleAnnouncementEdit = (item) => {
    setError('');
    setMessage('');
    const expiryDate = item.expires_at ? new Date(item.expires_at) : null;
    setAnnouncementForm({
      title: item.title || '',
      message: item.message || '',
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
    if (!supabase) {
      setError('Supabase connection is unavailable.');
      return;
    }
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
      const values = {
        title,
        message: messageText,
        library_id: isSubAdmin ? currentLibraryId : null,
        created_by: user?.name || user?.email || 'Admin',
        published: true,
        expires_at: expiresAt,
      };
      const result = editingAnnouncementId
        ? await supabase
            .from('announcements')
            .update({ ...values, updated_at: new Date().toISOString() })
            .eq('id', editingAnnouncementId)
        : await supabase.from('announcements').insert(values);

      if (result.error) {
        setError(`Unable to publish announcement: ${result.error.message}`);
        return;
      }

      setAnnouncementsPage(1);
      setSectionRefreshTick((tick) => tick + 1);
      setAnnouncementForm({
        title: '',
        message: '',
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
    if (!supabase) {
      setError('Supabase connection is unavailable.');
      return;
    }
    if (!globalThis.confirm('Delete this announcement?')) return;

    setError('');
    setMessage('');
    try {
      const { error: deleteError } = await supabase
        .from('announcements')
        .delete()
        .eq('id', id);

      if (deleteError) {
        setError(`Unable to delete announcement: ${deleteError.message}`);
        return;
      }
      setAnnouncements((current) => current.filter((item) => item.id !== id));
      setAnnouncementsTotal((current) => Math.max(0, current - 1));
      setMessage('Announcement deleted successfully.');
    } catch (err) {
      setError(err?.message || 'An unexpected error occurred while deleting.');
    }
  };

  const handleFeedbackReply = async (item) => {
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
    const { error: replyError } = await supabase
      .from('visitor_feedback')
      .update({
        admin_reply: reply,
        replied_by: user?.name || user?.email,
        replied_at: new Date().toISOString(),
        status: 'answered',
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id);

    if (replyError) {
      setError(replyError.message);
    } else {
      setFeedback((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, admin_reply: reply, status: 'answered' }
            : entry
        )
      );
      setFeedbackReply((current) => ({ ...current, [item.id]: '' }));
      setSectionRefreshTick((tick) => tick + 1);
      setMessage('Reply saved successfully.');
    }
  };

  const runForecast = async () => {
    const endpoint = import.meta.env.VITE_ANALYTICS_API_URL;
    if (!endpoint) {
      setError('Set VITE_ANALYTICS_API_URL to the Python analytics service URL.');
      return;
    }
    if (!analyticsWindow.valid) {
      setError(analyticsWindow.error || 'Please select a valid date range.');
      return;
    }
    if (forecastHistoryDays < 14) {
      setError('Select at least 14 days of history to generate a visitor forecast.');
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
          const requestCategory = booksById.get(request.bookId)?.category || 'Uncategorized';
          if (requestCategory !== category) return;
          const requestTime = new Date(request.requestDate).getTime();
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

      const response = await fetch(
        `${endpoint.replace(/\/$/, '')}/forecast?timeframe=${encodeURIComponent(timeframe)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
      setForecast(await response.json());
    } catch (forecastError) {
      const errorMessage = forecastError instanceof Error ? forecastError.message : '';
      setError(errorMessage || 'Forecast request failed.');
    } finally {
      setForecastLoading(false);
    }
  };

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
              <p className="mt-2 text-[11px] text-amber-800">
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
        <section className="flex flex-col gap-6">
          <div className="order-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-100 bg-linear-to-r from-slate-50 to-white p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-shelf-primary">
                  SHELF ILMS
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
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                <div className="min-w-0">
                  <p className="mb-2 text-sm font-semibold text-slate-700">Date range</p>
                  <AnalyticsDateFilter
                    timeframe={timeframe}
                    onTimeframeChange={(value) => {
                      setTimeframe(value);
                      setForecast(null);
                    }}
                    customStart={customStartDate}
                    onCustomStartChange={setCustomStartDate}
                    customEnd={customEndDate}
                    onCustomEndChange={setCustomEndDate}
                    range={analyticsWindow}
                  />
                </div>
                <label className="block text-sm font-semibold text-slate-700">
                  Activity type
                  <select
                    value={activityTypeFilter}
                    onChange={(event) => setActivityTypeFilter(event.target.value)}
                    className="mt-2 block w-full min-w-44 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-700 outline-none transition focus:border-shelf-primary focus:ring-2 focus:ring-shelf-primary/20"
                  >
                    <option value="all">All activities</option>
                    <option value="Visitor">Visitor check-ins</option>
                    <option value="Book transaction">Book transactions</option>
                    <option value="Book return">Book returns</option>
                  </select>
                </label>
                <label className="block text-sm font-semibold text-slate-700">
                  Sort activities
                  <select
                    value={reportSort}
                    onChange={(event) => setReportSort(event.target.value)}
                    className="mt-2 block w-full min-w-44 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-700 outline-none transition focus:border-shelf-primary focus:ring-2 focus:ring-shelf-primary/20"
                  >
                    <option value="time">Newest first</option>
                    <option value="name">Visitor name</option>
                  </select>
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
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold shadow-sm transition hover:-translate-y-0.5 cursor-pointer"
                >
                  <FileSpreadsheet size={15} className="text-emerald-400" />
                  <span>{exporting ? 'Exporting…' : 'Export Excel'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('csv')}
                  disabled={exporting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold shadow-sm transition hover:-translate-y-0.5 hover:border-slate-400 cursor-pointer"
                >
                  <FileCode size={15} className="text-blue-600" />
                  <span>{exporting ? 'Exporting…' : 'Export CSV'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('pdf')}
                  disabled={exporting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-rose-50/50 text-rose-700 border border-rose-200 hover:border-rose-300 rounded-lg text-xs font-bold shadow-sm transition hover:-translate-y-0.5 cursor-pointer"
                >
                  <FileText size={15} className="text-rose-600" />
                  <span>{exporting ? 'Exporting…' : 'Export PDF'}</span>
                </button>
              </div>

              {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
              {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
              {!analyticsWindow.valid && (
                <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  {analyticsWindow.error}
                </p>
              )}
              {analyticsAttendance.some((item) =>
                String(item.visitorName || '').startsWith('[TEST] ')
              ) && (
                <p role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
                  This report includes test attendance records. They are included in the totals and charts, and are marked as test data in the activity table and exported reports. Do not interpret them as real visitor activity.
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
                    {filteredReportRows.filter((row) => row.type === 'Book transaction').length}
                  </p>
                </div>
                <span className="rounded-xl bg-violet-50 px-3 py-2 text-lg font-extrabold text-violet-700 group-hover:bg-violet-600 group-hover:text-white transition-colors">
                  B
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">Recorded book transactions</p>
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
                  <p className="text-sm font-medium text-slate-500">Active loans</p>
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
                <p className="mt-1 text-sm text-slate-500">Review visits, book transactions, and returns.</p>
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
                        <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${
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
                <p className="mt-1 text-sm text-slate-500">Try selecting a different date range.</p>
              </div>
            )}

            {filteredReportRows.length > 0 && (
              <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-600">
                  Showing {activityHistoryStart + 1}–{Math.min(activityHistoryStart + activityHistoryPageSize, filteredReportRows.length)} of {filteredReportRows.length} activities
                </p>
                <nav className="flex flex-wrap items-center gap-1.5" aria-label="Activity history pages">
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
                </nav>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ANALYTICS TAB */}
      {tab === 'analytics' && (
        <section className="space-y-5">
          <section className="border border-slate-200 bg-white p-4 rounded-xl shadow-sm">
            <div className="mb-4">
              <h2 className="text-base font-bold text-slate-900">Analytics filters</h2>
              <p className="mt-1 text-sm text-slate-500">
                {isSubAdmin
                  ? 'Analytics are automatically limited to your assigned branch. Select a date range to view activity.'
                  : 'Filter analytics by library or branch and date range.'}
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
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <div className="border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
              <div className="mb-4">
                <h2 className="text-lg font-bold text-slate-900">Branch demand</h2>
                <p className="text-sm text-slate-500">
                  {isSubAdmin
                    ? getLibraryName(libraries, currentLibraryId)
                    : effectiveAnalyticsLibraryId
                    ? getLibraryName(libraries, effectiveAnalyticsLibraryId)
                    : 'All libraries'}
                  {' · '}
                  {analyticsWindow.label}
                </p>
              </div>
              {analyticsWindow.valid ? (
                <Bar
                  data={{
                    labels: periodCounts.labels,
                    datasets: [
                      {
                        label: 'Visitors',
                        data: periodCounts.visits,
                        backgroundColor: '#0f766e',
                      },
                      {
                        label: 'Book transactions',
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
                  Select a valid date range to display analytics.
                </div>
              )}
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <Metric label="Visitors" value={analyticsAttendance.length} />
                <Metric label="Book transactions" value={analyticsBorrows.length} />
                <Metric
                  label="Active loans"
                  value={analyticsBorrows.filter((item) => item.status === 'borrowed').length}
                />
              </div>
            </div>

            <section className="flex min-h-0 min-w-0 flex-col border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Most requested categories</h2>
                  <p className="mt-1 text-sm text-slate-500">Top categories from book requests in the selected range.</p>
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
                        labels: categoryChartRows.map(([category]) => category),
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
                            ticks: { precision: 0, stepSize: 1 },
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
                          <span className="truncate">{category}</span>
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

            <div className="space-y-4 xl:col-span-2">
              <section className="border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
                <h2 className="text-base font-bold text-slate-800">Operational recommendations</h2>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600">
                  {demandRecommendations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>

              <section className="border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-bold text-slate-800">Visitor forecast</h2>
                  <button
                    type="button"
                    onClick={runForecast}
                    disabled={forecastLoading || !analyticsWindow.valid || forecastHistoryDays < 14}
                    className="bg-shelf-primary px-3 py-2 text-xs font-bold text-white rounded-lg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {forecastLoading ? 'Forecasting...' : 'Run forecast'}
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Uses daily visits from the selected range, then projects the following 7 days. At least 14 days of history are needed.
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  History available: {forecastHistoryDays} day{forecastHistoryDays === 1 ? '' : 's'}.
                </p>
                {forecast?.forecasts?.length ? (
                  <>
                    {forecastChartData && (
                      <div className="mt-4">
                        <Line
                          data={forecastChartData}
                          options={{
                            responsive: true,
                            maintainAspectRatio: true,
                            scales: {
                              y: { beginAtZero: true, ticks: { precision: 0 } },
                            },
                            plugins: { legend: { position: 'bottom' } },
                          }}
                        />
                      </div>
                    )}
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
                    Run the forecast to generate a seven-day visitor forecast.
                  </p>
                )}
                {forecast?.insights?.length > 0 && (
                  <div className="mt-4 border-t border-slate-200 pt-3">
                    <h3 className="text-sm font-bold text-slate-800">System Analytics Insights</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                      {forecast.insights.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {forecast?.recommendations?.length > 0 && (
                  <div className="mt-4 border-t border-slate-200 pt-3">
                    <h3 className="text-sm font-bold text-emerald-900">Predictive Recommendations</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-emerald-800">
                      {forecast.recommendations.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            </div>
          </section>
          <div className="flex flex-wrap items-center gap-2.5 border-t border-slate-200 pt-4">
            <span className="mr-1 text-xs font-bold uppercase tracking-wider text-slate-500">
              Export analytics:
            </span>
            <button
              type="button"
              onClick={() => handleAnalyticsExport('xlsx')}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FileSpreadsheet size={15} className="text-emerald-400" />
              <span>{exporting ? 'Exporting…' : 'Export Excel'}</span>
            </button>
            <button
              type="button"
              onClick={() => handleAnalyticsExport('csv')}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FileCode size={15} className="text-blue-600" />
              <span>{exporting ? 'Exporting…' : 'Export CSV'}</span>
            </button>
            <button
              type="button"
              onClick={() => handleAnalyticsExport('pdf')}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-4 py-2 text-xs font-bold text-rose-700 shadow-sm transition hover:bg-rose-50/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <FileText size={15} className="text-rose-600" />
              <span>{exporting ? 'Exporting…' : 'Export PDF'}</span>
            </button>
          </div>
          {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        </section>
      )}

      {/* FEEDBACK TAB */}
      {tab === 'feedback' && (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Visitor feedback</h2>
              <p className="text-sm text-slate-500">Review submissions and add a manual reply.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(14rem,1fr)_auto]">
              <input
                type="search"
                value={feedbackSearch}
                onChange={(event) => {
                  setFeedbackSearch(event.target.value);
                  setFeedbackPage(1);
                }}
                placeholder="Search visitor, email, or subject"
                aria-label="Search feedback"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-shelf-primary focus:ring-2 focus:ring-shelf-primary/20"
              />
              <select
                value={feedbackStatusFilter}
                onChange={(event) => {
                  setFeedbackStatusFilter(event.target.value);
                  setFeedbackPage(1);
                }}
                aria-label="Filter feedback by status"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-shelf-primary focus:ring-2 focus:ring-shelf-primary/20"
              >
                <option value="all">All statuses</option>
                <option value="new">New</option>
                <option value="answered">Answered</option>
              </select>
            </div>
          </div>
          {loading && <p className="text-sm text-slate-500">Loading feedback…</p>}
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
          {!loading && feedback.map((item) => (
            <article key={item.id} className="space-y-3 border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <p className="font-bold text-slate-900">{item.subject}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {item.visitor_name} · {item.category} · {getLibraryName(libraries, item.library_id)} ·{' '}
                    {new Date(item.created_at).toLocaleString()}
                  </p>
                </div>
                <span className="h-fit bg-slate-100 px-3 py-1 text-xs font-bold rounded-full capitalize text-slate-700">
                  {String(item.status || '').replaceAll('_', ' ')}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed">{item.message}</p>
              {item.admin_reply && (
                <p className="border-l-4 border-emerald-600 bg-emerald-50 p-3.5 text-sm text-emerald-900 rounded-r-lg">
                  <strong>Reply:</strong> {item.admin_reply}
                </p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <textarea
                  rows={2}
                  value={feedbackReply[item.id] || ''}
                  onChange={(event) =>
                    setFeedbackReply((current) => ({
                      ...current,
                      [item.id]: event.target.value,
                    }))
                  }
                  placeholder="Write a manual reply..."
                  className="min-w-0 flex-1 border border-slate-300 p-2.5 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
                />
                <button
                  type="button"
                  onClick={() => handleFeedbackReply(item)}
                  className="bg-shelf-primary px-4 py-2 text-sm font-bold text-white rounded-lg transition hover:opacity-90"
                >
                  Save reply
                </button>
              </div>
            </article>
          ))}
          {!loading && feedbackTotal === 0 && (
            <p className="border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 rounded-xl">
              {feedbackSearch || feedbackStatusFilter !== 'all'
                ? 'No feedback matches these filters.'
                : 'No feedback submissions found.'}
            </p>
          )}
          <AdminListPagination
            page={visibleFeedbackPage}
            pageSize={10}
            total={feedbackTotal}
            onPageChange={setFeedbackPage}
            itemLabel="feedback submissions"
          />
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
