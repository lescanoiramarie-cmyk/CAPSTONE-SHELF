import { useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { FileSpreadsheet, FileCode, FileText } from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';
import {
  exportToCSV,
  exportToExcel,
} from '../lib/excelUtils.js';
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
  Tooltip,
  Legend
);

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

export default function AdminWorkspace({
  initialTab = 'reports',
  mode = 'reports',
  user,
  libraries = [],
  books = [],
  attendanceLogs = [],
  borrowRequests = [],
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
  const [timeframe, setTimeframe] = useState('7d');
  const [activityTypeFilter, setActivityTypeFilter] = useState('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [reportSort, setReportSort] = useState('time');
  const [feedback, setFeedback] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [announcementForm, setAnnouncementForm] = useState({
    title: '',
    message: '',
  });
  const [editingAnnouncementId, setEditingAnnouncementId] = useState(null);
  const [feedbackReply, setFeedbackReply] = useState({});
  const [forecast, setForecast] = useState(null);
  const [forecastLoading, setForecastLoading] = useState(false);

  const booksById = useMemo(
    () => new Map(books.map((book) => [book.id, book])),
    [books]
  );

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
        person: item.visitorName || 'Unknown visitor',
        detail: 'Library visit',
        branch: getLibraryName(libraries, item.libraryId),
        status: item.checkedOutAt ? 'Checked out' : 'Checked in',
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
    () => activityTypeFilter === 'all'
      ? reportRows
      : reportRows.filter((row) => row.type === activityTypeFilter),
    [activityTypeFilter, reportRows]
  );

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
          .select('*')
          .order('created_at', { ascending: false });
        if (isSubAdmin) {
          query = query.eq('library_id', currentLibraryId);
        }
        result = await query;
      } else if (tab === 'announcements') {
        let query = supabase
          .from('announcements')
          .select('*')
          .order('created_at', { ascending: false });
        if (isSubAdmin) {
          query = query.eq('library_id', currentLibraryId);
        }
        result = await query;
      }
      if (!active) return;
      if (result.error) {
        setError(result.error.message);
      } else if (tab === 'feedback') {
        setFeedback(result.data || []);
      } else if (tab === 'announcements') {
        setAnnouncements(result.data || []);
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
  }, [currentLibraryId, isSubAdmin, tab]);

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

  const forecastDailyVisitorCounts = useMemo(() => {
    if (!analyticsWindow.valid) return [];
    const buckets = getTimeframeBuckets('custom', analyticsWindow).slice(-366);
    const counts = new Map();
    analyticsAttendance.forEach((item) => {
      const key = getDateKey(item.timeIn, 'custom');
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return buckets.map((bucket) => counts.get(bucket.key) || 0);
  }, [analyticsAttendance, analyticsWindow]);

  const topCategories = useMemo(() => {
    const counts = new Map();
    analyticsBorrows.forEach((request) => {
      const category = booksById.get(request.bookId)?.category || 'Uncategorized';
      counts.set(category, (counts.get(category) || 0) + 1);
    });
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [booksById, analyticsBorrows]);

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
    const rows = filteredReportRows.map((row) => ({
      ...row,
      time: new Date(row.time).toISOString(),
    }));
    const suffix = `${timeframe}_${isSubAdmin ? currentLibraryId : 'all-libraries'}`;

    if (format === 'pdf') {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ]);
      const document = new jsPDF({ orientation: 'landscape' });
      const branchLabel = isSubAdmin
        ? getLibraryName(libraries, currentLibraryId)
        : 'All libraries';

      document.setFontSize(16);
      document.text('SHELF ILMS Circulation Report', 14, 16);
      document.setFontSize(10);
      document.text(`${branchLabel} | ${analyticsWindow.label}`, 14, 23);

      autoTable(document, {
        startY: 29,
        head: [['Time', 'Activity', 'Visitor', 'Details', 'Branch', 'Status']],
        body: rows.map((row) => [
          new Date(row.time).toLocaleString(),
          row.type,
          row.person,
          row.detail,
          row.branch,
          row.status,
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [15, 74, 82] },
      });
      document.save(`SHELF_Report_${suffix}.pdf`);
      return;
    }

    if (format === 'xlsx') {
      exportToExcel(rows, `SHELF_Report_${suffix}.xlsx`);
    } else {
      exportToCSV(rows, `SHELF_Report_${suffix}.csv`);
    }
  };

  const handleAnnouncementEdit = (item) => {
    setError('');
    setMessage('');
    setAnnouncementForm({
      title: item.title || '',
      message: item.message || '',
    });
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
    try {
      const values = {
        title,
        message: messageText,
        library_id: isSubAdmin ? currentLibraryId : null,
        created_by: user?.name || user?.email || 'Admin',
        published: true,
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

      let query = supabase
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false });
      if (isSubAdmin) {
        query = query.eq('library_id', currentLibraryId);
      }
      const { data, error: fetchError } = await query;

      if (fetchError) {
        setError(`Saved, but list could not refresh: ${fetchError.message}`);
        return;
      }

      setAnnouncements(data || []);
      setAnnouncementForm({ title: '', message: '' });
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

    setForecastLoading(true);
    setError('');
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

      {/* REPORTS TAB */}
      {tab === 'reports' && (
        <section className="space-y-6">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
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
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold shadow-sm transition hover:-translate-y-0.5 cursor-pointer"
                >
                  <FileSpreadsheet size={15} className="text-emerald-400" />
                  <span>Export Excel</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('csv')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold shadow-sm transition hover:-translate-y-0.5 hover:border-slate-400 cursor-pointer"
                >
                  <FileCode size={15} className="text-blue-600" />
                  <span>Export CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('pdf')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-rose-50/50 text-rose-700 border border-rose-200 hover:border-rose-300 rounded-lg text-xs font-bold shadow-sm transition hover:-translate-y-0.5 cursor-pointer"
                >
                  <FileText size={15} className="text-rose-600" />
                  <span>Export PDF</span>
                </button>
              </div>

              {!analyticsWindow.valid && (
                <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  {analyticsWindow.error}
                </p>
              )}
            </div>
          </div>

          {/* STAT CARDS WITH HOVER ANIMATION */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
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
                    <th className="px-5 py-4 font-semibold">Details</th>
                    <th className="px-5 py-4 font-semibold">Branch</th>
                    <th className="px-5 py-4 font-semibold text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredReportRows.map((row, index) => (
                    <tr
                      key={`${row.type}-${row.time}-${index}`}
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
                onCustomStartChange={setCustomStartDate}
                customEnd={customEndDate}
                onCustomEndChange={setCustomEndDate}
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

          <section className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
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
              <div className="mt-5">
                <h3 className="text-sm font-bold text-slate-800">Most requested categories</h3>
                {topCategories.length > 0 ? (
                  <ol className="mt-2 space-y-1 text-sm text-slate-600">
                    {topCategories.map(([category, count]) => (
                      <li key={category} className="flex justify-between border-b border-slate-100 py-1.5">
                        <span>{category}</span>
                        <span className="font-bold text-slate-800">{count}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">
                    No book transaction data found for the selected filters.
                  </p>
                )}
              </div>
            </div>

            <aside className="space-y-4">
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
                    disabled={forecastLoading || !analyticsWindow.valid}
                    className="bg-shelf-primary px-3 py-2 text-xs font-bold text-white rounded-lg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {forecastLoading ? 'Forecasting...' : 'Run forecast'}
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Forecast input follows the selected analytics branch and date range.
                </p>
                {forecast?.forecasts?.length ? (
                  <ol className="mt-3 space-y-1 text-sm text-slate-600">
                    {forecast.forecasts.map((item) => (
                      <li key={item.date} className="flex justify-between border-b border-slate-50 py-1">
                        <span>{item.date}</span>
                        <span className="font-bold">{item.visitorCount} visitors</span>
                      </li>
                    ))}
                  </ol>
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
            </aside>
          </section>
        </section>
      )}

      {/* FEEDBACK TAB */}
      {tab === 'feedback' && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Visitor feedback</h2>
            <p className="text-sm text-slate-500">Review submissions and add a manual reply.</p>
          </div>
          {feedback.map((item) => (
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
          {!loading && feedback.length === 0 && (
            <p className="border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 rounded-xl">
              No feedback submissions found.
            </p>
          )}
        </section>
      )}

      {/* ANNOUNCEMENTS TAB */}
      {tab === 'announcements' && (
        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Published and draft announcements</h2>
              <p className="text-sm text-slate-500">Published notices are visible to all visitors.</p>
            </div>
            {announcements.map((item) => (
              <article key={item.id} className="border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-slate-900">{item.title}</h3>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-600 leading-relaxed">{item.message}</p>
                    <p className="mt-3 text-xs font-medium text-slate-400">
                      {item.published ? 'Published' : 'Draft'} · {new Date(item.created_at).toLocaleString()}
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
            {!loading && announcements.length === 0 && (
              <p className="border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 rounded-xl">
                No announcements have been created.
              </p>
            )}
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
            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                className="bg-shelf-primary px-4 py-2 text-sm font-bold text-white rounded-lg transition hover:opacity-90"
              >
                {editingAnnouncementId ? 'Save changes' : 'Publish announcement'}
              </button>
              {editingAnnouncementId && (
                <button
                  type="button"
                  onClick={() => {
                    setAnnouncementForm({ title: '', message: '' });
                    setEditingAnnouncementId(null);
                  }}
                  className="border border-slate-300 px-4 py-2 text-sm font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
              )}
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