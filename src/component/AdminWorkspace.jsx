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

import { supabase } from '../lib/supabaseClient.js';
import {
  exportToCSV,
  exportToExcel,
} from '../lib/excelUtils.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend
);

const TABS = [
  { id: 'reports', label: 'Reports' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'announcements', label: 'Announcements' },
];

function startOfPeriod(period) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);

  if (period === 'daily') {
    return date;
  }

  if (period === 'weekly') {
    date.setDate(
      date.getDate() -
        ((date.getDay() + 6) % 7)
    );
    return date;
  }

  if (period === 'monthly') {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      1
    );
  }

  return new Date(
    date.getFullYear(),
    0,
    1
  );
}

function getLibraryName(libraries, id) {
  return (
    libraries.find(
      (library) => library.id === id
    )?.name || 'System-wide'
  );
}

function formatRole(role) {
  const labels = {
    superadmin: 'Super Admin',
    subadmin: 'Sub-Admin',
    librarian: 'Library Staff',
    circulation: 'Circulation Staff',
  };

  return (
    labels[role] ||
    String(role || '')
      .replaceAll('_', ' ')
      .replace(/\b\w/g, (char) =>
        char.toUpperCase()
      ) ||
    'Staff'
  );
}

function AdminWorkspace({
  user,
  libraries = [],
  books = [],
  attendanceLogs = [],
  borrowRequests = [],
}) {
  const isSubAdmin =
    user?.role === 'subadmin';

  const currentLibraryId =
    user?.libraryId ||
    user?.assignedBranch ||
    '';

  const [tab, setTab] =
    useState('reports');

  const [selectedLibraryId, setSelectedLibraryId] =
    useState('');

  const [period, setPeriod] =
    useState('daily');

  const [reportSort, setReportSort] =
    useState('time');

  const [feedback, setFeedback] =
    useState([]);

  const [announcements, setAnnouncements] =
    useState([]);

  const [staff, setStaff] =
    useState([]);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState('');

  const [message, setMessage] =
    useState('');

  const [announcementForm, setAnnouncementForm] =
    useState({
      title: '',
      message: '',
    });

  const [
    editingAnnouncementId,
    setEditingAnnouncementId,
  ] = useState(null);

  const [feedbackReply, setFeedbackReply] =
    useState({});

  const [staffForm, setStaffForm] =
    useState({
      email: '',
      fullName: '',
      password: '',
      libraryId: currentLibraryId,
    });

  const [forecast, setForecast] =
    useState(null);

  const [forecastLoading, setForecastLoading] =
    useState(false);

  const booksById = useMemo(
    () =>
      new Map(
        books.map((book) => [
          book.id,
          book,
        ])
      ),
    [books]
  );

  // -------------------------------------------------------------------------
  // Branch-scoped attendance
  // -------------------------------------------------------------------------

  const scopedAttendance = useMemo(
    () =>
      attendanceLogs.filter((item) =>
        isSubAdmin
          ? item.libraryId ===
            currentLibraryId
          : !selectedLibraryId ||
            item.libraryId ===
              selectedLibraryId
      ),
    [
      attendanceLogs,
      currentLibraryId,
      isSubAdmin,
      selectedLibraryId,
    ]
  );

  // -------------------------------------------------------------------------
  // Branch-scoped borrow transactions
  // -------------------------------------------------------------------------

  const scopedBorrows = useMemo(
    () =>
      borrowRequests.filter((item) =>
        isSubAdmin
          ? booksById.get(item.bookId)
              ?.libraryId ===
            currentLibraryId
          : !selectedLibraryId ||
            booksById.get(item.bookId)
              ?.libraryId ===
              selectedLibraryId
      ),
    [
      booksById,
      borrowRequests,
      currentLibraryId,
      isSubAdmin,
      selectedLibraryId,
    ]
  );

  // -------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------

  const reportRows = useMemo(() => {
    const start = startOfPeriod(period);

    const attendanceRows =
      scopedAttendance
        .filter(
          (item) =>
            new Date(item.timeIn) >= start
        )
        .map((item) => ({
          type: 'Visitor',
          time: item.timeIn,
          person: item.visitorName,
          detail: 'Library visit',
          branch: getLibraryName(
            libraries,
            item.libraryId
          ),
          status: item.checkedOutAt
            ? 'Checked out'
            : 'Checked in',
        }));

    const transactionRows =
      scopedBorrows
        .filter(
          (item) =>
            new Date(item.requestDate) >=
            start
        )
        .map((item) => ({
          type: 'Book transaction',
          time: item.requestDate,
          person: item.visitorName,
          detail: item.bookTitle,
          branch: getLibraryName(
            libraries,
            booksById.get(item.bookId)
              ?.libraryId
          ),
          status: String(
            item.status || ''
          ).replaceAll('_', ' '),
        }));

    return [
      ...attendanceRows,
      ...transactionRows,
    ].sort((a, b) => {
      if (reportSort === 'name') {
        return a.person.localeCompare(
          b.person
        );
      }

      if (reportSort === 'type') {
        return a.type.localeCompare(
          b.type
        );
      }

      return (
        new Date(b.time) -
        new Date(a.time)
      );
    });
  }, [
    booksById,
    libraries,
    period,
    reportSort,
    scopedAttendance,
    scopedBorrows,
  ]);

  // -------------------------------------------------------------------------
  // Load database-backed sections
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (
      !supabase ||
      ![
        'feedback',
        'announcements',
        'staff',
      ].includes(tab)
    ) {
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
          .order('created_at', {
            ascending: false,
          });

        if (isSubAdmin) {
          query = query.eq(
            'library_id',
            currentLibraryId
          );
        } else if (selectedLibraryId) {
          query = query.eq(
            'library_id',
            selectedLibraryId
          );
        }

        result = await query;
      } else if (tab === 'announcements') {
        result = await supabase
          .from('announcements')
          .select('*')
          .order('created_at', {
            ascending: false,
          });
      } else {
        // -------------------------------------------------------------------
        // STAFF ACCOUNTS
        // -------------------------------------------------------------------
        // This is now loaded directly from staff_profiles.
        // No hardcoded credential array is used here.
        // -------------------------------------------------------------------

        result = await supabase
          .from('staff_profiles')
          .select(
            'id, email, full_name, role, library_id, is_active, created_at'
          )
          .order('created_at', {
            ascending: false,
          });
      }

      if (!active) return;

      if (result.error) {
        setError(result.error.message);
      } else if (tab === 'feedback') {
        setFeedback(result.data || []);
      } else if (tab === 'announcements') {
        setAnnouncements(
          result.data || []
        );
      } else {
        setStaff(result.data || []);
      }

      setLoading(false);
    }

    loadData().catch((loadError) => {
      if (active) {
        setError(
          loadError.message ||
            'Unable to load this section.'
        );
        setLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [
    currentLibraryId,
    isSubAdmin,
    selectedLibraryId,
    tab,
  ]);

  // -------------------------------------------------------------------------
  // Analytics period counts
  // -------------------------------------------------------------------------

  const periodCounts = useMemo(() => {
    const labels = Array.from(
      { length: 7 },
      (_, index) => {
        const date = new Date();

        date.setDate(
          date.getDate() -
            (6 - index)
        );

        return date;
      }
    );

    return {
      labels: labels.map((date) =>
        date.toLocaleDateString(
          undefined,
          {
            month: 'short',
            day: 'numeric',
          }
        )
      ),

      visits: labels.map((date) =>
        scopedAttendance.filter(
          (item) =>
            new Date(
              item.timeIn
            ).toDateString() ===
            date.toDateString()
        ).length
      ),

      transactions: labels.map(
        (date) =>
          scopedBorrows.filter(
            (item) =>
              new Date(
                item.requestDate
              ).toDateString() ===
              date.toDateString()
          ).length
      ),
    };
  }, [
    scopedAttendance,
    scopedBorrows,
  ]);

  // -------------------------------------------------------------------------
  // Most requested categories
  // -------------------------------------------------------------------------

  const topCategories = useMemo(() => {
    const counts = new Map();

    scopedBorrows.forEach(
      (request) => {
        const category =
          booksById.get(
            request.bookId
          )?.category ||
          'Uncategorized';

        counts.set(
          category,
          (counts.get(category) || 0) +
            1
        );
      }
    );

    return [...counts]
      .sort(
        (a, b) => b[1] - a[1]
      )
      .slice(0, 5);
  }, [
    booksById,
    scopedBorrows,
  ]);

  // -------------------------------------------------------------------------
  // Operational recommendations
  // -------------------------------------------------------------------------

  const demandRecommendations =
    useMemo(() => {
      const latestVisit = Math.max(
        ...scopedAttendance.map(
          (item) =>
            new Date(
              item.timeIn
            ).getTime()
        ),
        0
      );

      const recent =
        scopedAttendance.filter(
          (item) =>
            latestVisit -
              new Date(
                item.timeIn
              ).getTime() <
            7 * 86400000
        ).length;

      const prior =
        scopedAttendance.filter(
          (item) => {
            const age =
              latestVisit -
              new Date(
                item.timeIn
              ).getTime();

            return (
              age >=
                7 * 86400000 &&
              age <
                14 * 86400000
            );
          }
        ).length;

      const suggestions = [];

      if (
        recent >
          prior * 1.2 &&
        recent >= 5
      ) {
        suggestions.push(
          'Visitor volume is up at least 20% week over week. Consider adding front-desk coverage during peak hours.'
        );
      }

      if (topCategories[0]) {
        suggestions.push(
          `Review copy levels for ${topCategories[0][0]}, the highest-demand category in the transaction data.`
        );
      }

      if (
        suggestions.length === 0
      ) {
        suggestions.push(
          'Demand is steady or there is not yet enough activity to recommend a staffing change. Continue collecting branch activity.'
        );
      }

      return suggestions;
    }, [
      scopedAttendance,
      topCategories,
    ]);

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  const handleExport = (format) => {
    const rows = reportRows.map(
      (row) => ({
        ...row,
        time: new Date(
          row.time
        ).toISOString(),
      })
    );

    const suffix = `${period}_${
      (isSubAdmin
        ? currentLibraryId
        : selectedLibraryId) ||
      'all-libraries'
    }`;

    if (format === 'xlsx') {
      exportToExcel(
        rows,
        `SHELF_Report_${suffix}.xlsx`
      );
    } else {
      exportToCSV(
        rows,
        `SHELF_Report_${suffix}.csv`
      );
    }
  };

  // -------------------------------------------------------------------------
  // Announcements
  // -------------------------------------------------------------------------

  const handleAnnouncementSave =
    async (event) => {
      event.preventDefault();

      setError('');

      const values = {
        title:
          announcementForm.title.trim(),
        message:
          announcementForm.message.trim(),
        created_by:
          user?.name ||
          user?.email,
      };

      const result =
        editingAnnouncementId
          ? await supabase
              .from('announcements')
              .update({
                ...values,
                updated_at:
                  new Date().toISOString(),
              })
              .eq(
                'id',
                editingAnnouncementId
              )
          : await supabase
              .from('announcements')
              .insert(values);

      if (result.error) {
        setError(
          result.error.message
        );
        return;
      }

      setAnnouncementForm({
        title: '',
        message: '',
      });

      setEditingAnnouncementId(
        null
      );

      setMessage(
        'Announcement saved.'
      );

      setTab('announcements');

      const { data } =
        await supabase
          .from('announcements')
          .select('*')
          .order('created_at', {
            ascending: false,
          });

      setAnnouncements(data || []);
    };

  const handleAnnouncementEdit = (
    announcement
  ) => {
    setAnnouncementForm({
      title: announcement.title,
      message:
        announcement.message,
    });

    setEditingAnnouncementId(
      announcement.id
    );

    globalThis.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  };

  const handleAnnouncementDelete =
    async (id) => {
      if (
        !globalThis.confirm(
          'Delete this announcement?'
        )
      ) {
        return;
      }

      const {
        error: deleteError,
      } = await supabase
        .from('announcements')
        .delete()
        .eq('id', id);

      if (deleteError) {
        setError(
          deleteError.message
        );
      } else {
        setAnnouncements(
          (current) =>
            current.filter(
              (item) =>
                item.id !== id
            )
        );
      }
    };

  // -------------------------------------------------------------------------
  // Feedback
  // -------------------------------------------------------------------------

  const handleFeedbackReply =
    async (item) => {
      const reply = String(
        feedbackReply[item.id] || ''
      ).trim();

      if (!reply) return;

      const {
        error: replyError,
      } = await supabase
        .from('visitor_feedback')
        .update({
          admin_reply: reply,
          replied_by:
            user?.name ||
            user?.email,
          replied_at:
            new Date().toISOString(),
          status: 'answered',
          updated_at:
            new Date().toISOString(),
        })
        .eq('id', item.id);

      if (replyError) {
        setError(
          replyError.message
        );
      } else {
        setFeedback(
          (current) =>
            current.map(
              (entry) =>
                entry.id === item.id
                  ? {
                      ...entry,
                      admin_reply:
                        reply,
                      status:
                        'answered',
                    }
                  : entry
            )
        );

        setFeedbackReply(
          (current) => ({
            ...current,
            [item.id]: '',
          })
        );

        setMessage(
          'Reply saved.'
        );
      }
    };

  // -------------------------------------------------------------------------
  // Visitor Forecast
  // -------------------------------------------------------------------------

  const runForecast = async () => {
    const endpoint =
      import.meta.env
        .VITE_ANALYTICS_API_URL;

    if (!endpoint) {
      setError(
        'Set VITE_ANALYTICS_API_URL to the Python analytics service URL to enable forecasts.'
      );
      return;
    }

    setForecastLoading(true);
    setError('');

    try {
      const now = Date.now();

      const categorySeries =
        topCategories.map(
          ([category]) => {
            const weeklyDemand = [
              0,
              0,
              0,
              0,
            ];

            scopedBorrows.forEach(
              (request) => {
                if (
                  booksById.get(
                    request.bookId
                  )?.category !==
                  category
                ) {
                  return;
                }

                const ageDays =
                  Math.floor(
                    (now -
                      new Date(
                        request.requestDate
                      ).getTime()) /
                      86400000
                  );

                const weekIndex =
                  3 -
                  Math.floor(
                    ageDays / 7
                  );

                if (
                  weekIndex >= 0 &&
                  weekIndex <
                    weeklyDemand.length
                ) {
                  weeklyDemand[
                    weekIndex
                  ] += 1;
                }
              }
            );

            return {
              category,
              weekly_demand:
                weeklyDemand,
            };
          }
        );

      const response =
        await fetch(
          `${endpoint.replace(
            /\/$/,
            ''
          )}/forecast`,
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify({
              daily_visitors:
                periodCounts.visits,
              categories:
                categorySeries,
              horizon_days: 7,
            }),
          }
        );

      if (!response.ok) {
        throw new Error(
          `Forecast service returned ${response.status}.`
        );
      }

      setForecast(
        await response.json()
      );
    } catch (forecastError) {
      setError(
        forecastError.message ||
          'Forecast request failed.'
      );
    } finally {
      setForecastLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Create staff
  // -------------------------------------------------------------------------

  const handleCreateStaff =
    async (event) => {
      event.preventDefault();

      if (!supabase) {
        setError(
          'Supabase is not configured.'
        );
        return;
      }

      setError('');
      setMessage('');

      const email =
        staffForm.email
          .trim()
          .toLowerCase();

      const fullName =
        staffForm.fullName.trim();

      const password =
        staffForm.password;

      const libraryId =
        staffForm.libraryId;

      if (
        !email ||
        !fullName ||
        !password ||
        !libraryId
      ) {
        setError(
          'Please complete all staff account fields.'
        );
        return;
      }

      if (password.length < 10) {
        setError(
          'Temporary password must contain at least 10 characters.'
        );
        return;
      }

      const {
        data,
        error: provisionError,
      } = await supabase.functions.invoke(
        'manage-staff',
        {
          body: {
            operation: 'create',
            email,
            fullName,
            password,
            libraryId,
          },
        }
      );

      if (
        provisionError ||
        data?.error
      ) {
        setError(
          provisionError?.message ||
            data?.error ||
            'Unable to create the staff account.'
        );
        return;
      }

      setStaffForm({
        email: '',
        fullName: '',
        password: '',
        libraryId:
          currentLibraryId || '',
      });

      setMessage(
        'Sub-admin account created successfully. Share its temporary password securely.'
      );

      // Refresh directly from staff_profiles.
      const {
        data: updatedStaff,
        error: queryError,
      } = await supabase
        .from('staff_profiles')
        .select(
          'id, email, full_name, role, library_id, is_active, created_at'
        )
        .order('created_at', {
          ascending: false,
        });

      if (queryError) {
        setError(
          queryError.message
        );
      } else {
        setStaff(
          updatedStaff || []
        );
      }
    };

  // -------------------------------------------------------------------------
  // Enable / Disable staff
  // -------------------------------------------------------------------------

  const toggleStaffActive =
    async (profile) => {
      setError('');
      setMessage('');

      const {
        data,
        error: updateError,
      } = await supabase.functions.invoke(
        'manage-staff',
        {
          body: {
            operation: 'set-active',
            userId: profile.id,
            isActive:
              !profile.is_active,
          },
        }
      );

      if (
        updateError ||
        data?.error
      ) {
        setError(
          updateError?.message ||
            data?.error ||
            'Unable to update the staff account.'
        );
        return;
      }

      setStaff(
        (current) =>
          current.map(
            (item) =>
              item.id === profile.id
                ? {
                    ...item,
                    is_active:
                      !profile.is_active,
                  }
                : item
          )
      );

      setMessage(
        `${profile.full_name} is now ${
          !profile.is_active
            ? 'active'
            : 'disabled'
        }.`
      );
    };

  // -------------------------------------------------------------------------
  // Supabase guard
  // -------------------------------------------------------------------------

  if (!supabase) {
    return (
      <p className="border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Configure Supabase to use reports
        and management tools.
      </p>
    );
  }

  // -------------------------------------------------------------------------
  // UI
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------------- */}
      {/* Library scope                                                       */}
      {/* ------------------------------------------------------------------- */}

      {!isSubAdmin && (
        <label className="flex w-fit items-center gap-3 text-sm font-semibold text-slate-700">
          Library scope

          <select
            value={selectedLibraryId}
            onChange={(event) =>
              setSelectedLibraryId(
                event.target.value
              )
            }
            className="border border-slate-300 bg-white px-3 py-2 font-normal"
          >
            <option value="">
              All libraries
            </option>

            {libraries.map(
              (library) => (
                <option
                  key={library.id}
                  value={library.id}
                >
                  {library.name}
                </option>
              )
            )}
          </select>
        </label>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Navigation                                                          */}
      {/* ------------------------------------------------------------------- */}

      <nav
        className="flex gap-2 overflow-x-auto border-b border-slate-200"
        aria-label="Admin workspace"
      >
        {[
          ...TABS,
          ...(!isSubAdmin
            ? [
                {
                  id: 'staff',
                  label: 'Staff accounts',
                },
              ]
            : []),
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
              setError('');
              setMessage('');

              setLoading(
                [
                  'feedback',
                  'announcements',
                  'staff',
                ].includes(
                  item.id
                )
              );
            }}
            aria-current={
              tab === item.id
                ? 'page'
                : undefined
            }
            className={`shrink-0 border-b-2 px-3 py-3 text-sm font-semibold ${
              tab === item.id
                ? 'border-shelf-primary text-shelf-primary'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* ------------------------------------------------------------------- */}
      {/* Messages                                                            */}
      {/* ------------------------------------------------------------------- */}

      {error && (
        <p
          role="alert"
          className="border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      {message && (
        <p
          role="status"
          className="border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {message}
        </p>
      )}

      {loading && (
        <p className="text-sm text-slate-500">
          Loading records...
        </p>
      )}

      {/* =================================================================== */}
      {/* REPORTS                                                             */}
      {/* =================================================================== */}

      {tab === 'reports' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Activity reports
              </h2>

              <p className="text-sm text-slate-500">
                {isSubAdmin
                  ? getLibraryName(
                      libraries,
                      currentLibraryId
                    )
                  : getLibraryName(
                      libraries,
                      selectedLibraryId
                    )}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <label className="text-xs font-semibold text-slate-600">
                Period

                <select
                  value={period}
                  onChange={(event) =>
                    setPeriod(
                      event.target.value
                    )
                  }
                  className="ml-2 border border-slate-300 bg-white px-2 py-2 text-sm"
                >
                  <option value="daily">
                    Daily
                  </option>
                  <option value="weekly">
                    Weekly
                  </option>
                  <option value="monthly">
                    Monthly
                  </option>
                  <option value="annual">
                    Annual
                  </option>
                </select>
              </label>

              <label className="text-xs font-semibold text-slate-600">
                Sort

                <select
                  value={reportSort}
                  onChange={(event) =>
                    setReportSort(
                      event.target.value
                    )
                  }
                  className="ml-2 border border-slate-300 bg-white px-2 py-2 text-sm"
                >
                  <option value="time">
                    Newest
                  </option>
                  <option value="name">
                    Visitor
                  </option>
                  <option value="type">
                    Activity type
                  </option>
                </select>
              </label>

              <button
                type="button"
                onClick={() =>
                  handleExport('xlsx')
                }
                className="bg-shelf-primary px-3 py-2 text-sm font-semibold text-white"
              >
                Export Excel
              </button>

              <button
                type="button"
                onClick={() =>
                  handleExport('csv')
                }
                className="border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
              >
                Export CSV
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Metric
              label="Visitor check-ins"
              value={
                scopedAttendance.filter(
                  (item) =>
                    new Date(
                      item.timeIn
                    ) >=
                    startOfPeriod(
                      period
                    )
                ).length
              }
            />

            <Metric
              label="Book requests"
              value={
                scopedBorrows.filter(
                  (item) =>
                    new Date(
                      item.requestDate
                    ) >=
                    startOfPeriod(
                      period
                    )
                ).length
              }
            />

            <Metric
              label="Active loans"
              value={
                scopedBorrows.filter(
                  (item) =>
                    item.status ===
                    'borrowed'
                ).length
              }
            />
          </div>

          <div className="overflow-x-auto border border-slate-200 bg-white">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-3">
                    Time
                  </th>
                  <th className="p-3">
                    Activity
                  </th>
                  <th className="p-3">
                    Visitor
                  </th>
                  <th className="p-3">
                    Details
                  </th>
                  <th className="p-3">
                    Branch
                  </th>
                  <th className="p-3">
                    Status
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {reportRows.map(
                  (
                    row,
                    index
                  ) => (
                    <tr
                      key={`${row.type}-${row.time}-${index}`}
                    >
                      <td className="p-3 text-xs">
                        {new Date(
                          row.time
                        ).toLocaleString()}
                      </td>

                      <td className="p-3">
                        {row.type}
                      </td>

                      <td className="p-3">
                        {row.person}
                      </td>

                      <td className="p-3">
                        {row.detail}
                      </td>

                      <td className="p-3">
                        {row.branch}
                      </td>

                      <td className="p-3 capitalize">
                        {row.status}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>

            {reportRows.length ===
              0 && (
              <p className="p-6 text-center text-sm text-slate-500">
                No activity found
                for this period.
              </p>
            )}
          </div>
        </section>
      )}

      {/* =================================================================== */}
      {/* ANALYTICS                                                           */}
      {/* =================================================================== */}

      {tab === 'analytics' && (
        <section className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
          <div className="border border-slate-200 bg-white p-4">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-slate-900">
                Branch demand, last 7
                days
              </h2>

              <p className="text-sm text-slate-500">
                Counts are calculated
                from live attendance
                and transaction
                records.
              </p>
            </div>

            <Bar
              data={{
                labels:
                  periodCounts.labels,
                datasets: [
                  {
                    label: 'Visitors',
                    data:
                      periodCounts.visits,
                    backgroundColor:
                      '#0f766e',
                  },
                  {
                    label:
                      'Book transactions',
                    data:
                      periodCounts.transactions,
                    backgroundColor:
                      '#d97706',
                  },
                ],
              }}
              options={{
                responsive: true,
                scales: {
                  y: {
                    beginAtZero: true,
                    ticks: {
                      precision: 0,
                    },
                  },
                },
              }}
            />

            <div className="mt-4">
              <h3 className="text-sm font-bold">
                Most requested
                categories
              </h3>

              <ol className="mt-2 space-y-1 text-sm text-slate-600">
                {topCategories.map(
                  ([
                    category,
                    count,
                  ]) => (
                    <li
                      key={category}
                      className="flex justify-between"
                    >
                      <span>
                        {category}
                      </span>

                      <span className="font-semibold">
                        {count}
                      </span>
                    </li>
                  )
                )}
              </ol>
            </div>
          </div>

          <aside className="space-y-4">
            <section className="border border-slate-200 bg-white p-4">
              <h2 className="text-base font-bold">
                Operational
                recommendations
              </h2>

              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600">
                {demandRecommendations.map(
                  (item) => (
                    <li key={item}>
                      {item}
                    </li>
                  )
                )}
              </ul>
            </section>

            <section className="border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-bold">
                  Visitor forecast
                </h2>

                <button
                  type="button"
                  onClick={
                    runForecast
                  }
                  disabled={
                    forecastLoading
                  }
                  className="bg-shelf-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {forecastLoading
                    ? 'Forecasting...'
                    : 'Run forecast'}
                </button>
              </div>

              {forecast
                ?.forecasts
                ?.length ? (
                <ol className="mt-3 space-y-1 text-sm text-slate-600">
                  {forecast.forecasts.map(
                    (item) => (
                      <li
                        key={
                          item.date
                        }
                        className="flex justify-between"
                      >
                        <span>
                          {item.date}
                        </span>

                        <span>
                          {
                            item.visitorCount
                          }{' '}
                          visitors
                        </span>
                      </li>
                    )
                  )}
                </ol>
              ) : (
                <p className="mt-2 text-xs text-slate-500">
                  Connect the Python
                  analytics service
                  to generate a
                  seven-day forecast.
                </p>
              )}

              {forecast?.highDemandCategories?.map(
                (item) => (
                  <p
                    key={
                      item.category
                    }
                    className="mt-2 flex justify-between text-xs text-slate-600"
                  >
                    <span>
                      {
                        item.category
                      }{' '}
                      projected
                      demand
                    </span>

                    <span>
                      {
                        item.projectedDemand
                      }
                    </span>
                  </p>
                )
              )}

              {forecast?.recommendations?.map(
                (item) => (
                  <p
                    key={item}
                    className="mt-2 text-sm text-emerald-800"
                  >
                    {item}
                  </p>
                )
              )}
            </section>
          </aside>
        </section>
      )}

      {/* =================================================================== */}
      {/* FEEDBACK                                                            */}
      {/* =================================================================== */}

      {tab === 'feedback' && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold">
              Visitor feedback
            </h2>

            <p className="text-sm text-slate-500">
              Review submissions
              and add a manual
              reply.
            </p>
          </div>

          {feedback.map(
            (item) => (
              <article
                key={item.id}
                className="space-y-3 border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {item.subject}
                    </p>

                    <p className="text-xs text-slate-500">
                      {item.visitor_name}{' '}
                      ·{' '}
                      {item.category}{' '}
                      ·{' '}
                      {getLibraryName(
                        libraries,
                        item.library_id
                      )}{' '}
                      ·{' '}
                      {new Date(
                        item.created_at
                      ).toLocaleString()}
                    </p>
                  </div>

                  <span className="h-fit bg-slate-100 px-2 py-1 text-xs capitalize">
                    {String(
                      item.status ||
                        ''
                    ).replaceAll(
                      '_',
                      ' '
                    )}
                  </span>
                </div>

                <p className="whitespace-pre-wrap text-sm text-slate-700">
                  {item.message}
                </p>

                {item.admin_reply && (
                  <p className="border-l-2 border-emerald-600 bg-emerald-50 p-3 text-sm text-emerald-900">
                    <strong>
                      Reply:
                    </strong>{' '}
                    {item.admin_reply}
                  </p>
                )}

                <div className="flex flex-col gap-2 sm:flex-row">
                  <textarea
                    rows={2}
                    value={
                      feedbackReply[
                        item.id
                      ] || ''
                    }
                    onChange={(
                      event
                    ) =>
                      setFeedbackReply(
                        (current) => ({
                          ...current,
                          [item.id]:
                            event.target
                              .value,
                        })
                      )
                    }
                    placeholder="Write a manual reply..."
                    className="min-w-0 flex-1 border border-slate-300 p-2 text-sm"
                  />

                  <button
                    type="button"
                    onClick={() =>
                      handleFeedbackReply(
                        item
                      )
                    }
                    className="bg-shelf-primary px-4 py-2 text-sm font-semibold text-white"
                  >
                    Save reply
                  </button>
                </div>
              </article>
            )
          )}

          {!loading &&
            feedback.length ===
              0 && (
              <p className="border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                No feedback
                submissions found.
              </p>
            )}
        </section>
      )}

      {/* =================================================================== */}
      {/* ANNOUNCEMENTS                                                       */}
      {/* =================================================================== */}

      {tab === 'announcements' && (
        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-bold">
                Published and draft
                announcements
              </h2>

              <p className="text-sm text-slate-500">
                Published notices
                are visible to
                all visitors.
              </p>
            </div>

            {announcements.map(
              (item) => (
                <article
                  key={item.id}
                  className="border border-slate-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">
                        {item.title}
                      </h3>

                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                        {item.message}
                      </p>

                      <p className="mt-2 text-xs text-slate-400">
                        {item.published
                          ? 'Published'
                          : 'Draft'}{' '}
                        ·{' '}
                        {new Date(
                          item.created_at
                        ).toLocaleString()}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          handleAnnouncementEdit(
                            item
                          )
                        }
                        className="text-sm font-semibold text-shelf-primary"
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleAnnouncementDelete(
                            item.id
                          )
                        }
                        className="text-sm font-semibold text-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </article>
              )
            )}

            {!loading &&
              announcements.length ===
                0 && (
                <p className="border border-dashed border-slate-300 p-5 text-sm text-slate-500">
                  No announcements
                  have been
                  created.
                </p>
              )}
          </div>

          <form
            onSubmit={
              handleAnnouncementSave
            }
            className="h-fit space-y-3 border border-slate-200 bg-white p-4"
          >
            <h2 className="font-bold">
              {editingAnnouncementId
                ? 'Edit announcement'
                : 'New announcement'}
            </h2>

            <label className="block text-sm font-medium">
              Title

              <input
                required
                maxLength={160}
                value={
                  announcementForm.title
                }
                onChange={(event) =>
                  setAnnouncementForm(
                    {
                      ...announcementForm,
                      title:
                        event.target
                          .value,
                    }
                  )
                }
                className="mt-1 w-full border border-slate-300 px-3 py-2"
              />
            </label>

            <label className="block text-sm font-medium">
              Message

              <textarea
                required
                rows={6}
                maxLength={5000}
                value={
                  announcementForm.message
                }
                onChange={(event) =>
                  setAnnouncementForm(
                    {
                      ...announcementForm,
                      message:
                        event.target
                          .value,
                    }
                  )
                }
                className="mt-1 w-full border border-slate-300 px-3 py-2"
              />
            </label>

            <div className="flex gap-2">
              <button
                type="submit"
                className="bg-shelf-primary px-4 py-2 text-sm font-semibold text-white"
              >
                {editingAnnouncementId
                  ? 'Save changes'
                  : 'Publish announcement'}
              </button>

              {editingAnnouncementId && (
                <button
                  type="button"
                  onClick={() => {
                    setAnnouncementForm(
                      {
                        title: '',
                        message: '',
                      }
                    );
                    setEditingAnnouncementId(
                      null
                    );
                  }}
                  className="border border-slate-300 px-4 py-2 text-sm"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </section>
      )}

      {/* =================================================================== */}
      {/* STAFF ACCOUNTS                                                      */}
      {/* =================================================================== */}

      {tab === 'staff' &&
        !isSubAdmin && (
          <section className="space-y-5">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Staff accounts
              </h2>

              <p className="text-sm text-slate-500">
                Staff records are loaded
                directly from the
                <code className="mx-1 rounded bg-slate-100 px-1 py-0.5">
                  staff_profiles
                </code>
                table. Authentication is
                handled by Supabase Auth.
              </p>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* CREATE SUB-ADMIN                                              */}
            {/* ------------------------------------------------------------- */}

            <form
              onSubmit={
                handleCreateStaff
              }
              className="grid gap-3 border border-slate-200 bg-white p-4 sm:grid-cols-2"
            >
              <div className="sm:col-span-2">
                <h3 className="font-semibold text-slate-900">
                  Create sub-admin
                </h3>

                <p className="mt-1 text-xs text-slate-500">
                  This creates a Supabase
                  Auth account and its
                  corresponding staff
                  profile.
                </p>
              </div>

              <label className="text-sm font-medium">
                Full name

                <input
                  required
                  value={
                    staffForm.fullName
                  }
                  onChange={(event) =>
                    setStaffForm(
                      (current) => ({
                        ...current,
                        fullName:
                          event.target
                            .value,
                      })
                    )
                  }
                  className="mt-1 w-full border border-slate-300 px-3 py-2"
                />
              </label>

              <label className="text-sm font-medium">
                Email

                <input
                  required
                  type="email"
                  value={
                    staffForm.email
                  }
                  onChange={(event) =>
                    setStaffForm(
                      (current) => ({
                        ...current,
                        email:
                          event.target
                            .value,
                      })
                    )
                  }
                  className="mt-1 w-full border border-slate-300 px-3 py-2"
                />
              </label>

              <label className="text-sm font-medium">
                Temporary password

                <input
                  required
                  minLength={10}
                  type="password"
                  value={
                    staffForm.password
                  }
                  onChange={(event) =>
                    setStaffForm(
                      (current) => ({
                        ...current,
                        password:
                          event.target
                            .value,
                      })
                    )
                  }
                  className="mt-1 w-full border border-slate-300 px-3 py-2"
                />

                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Minimum 10 characters.
                </span>
              </label>

              <label className="text-sm font-medium">
                Assigned branch

                <select
                  required
                  value={
                    staffForm.libraryId
                  }
                  onChange={(event) =>
                    setStaffForm(
                      (current) => ({
                        ...current,
                        libraryId:
                          event.target
                            .value,
                      })
                    )
                  }
                  className="mt-1 w-full border border-slate-300 bg-white px-3 py-2"
                >
                  <option value="">
                    Select branch
                  </option>

                  {libraries.map(
                    (library) => (
                      <option
                        key={
                          library.id
                        }
                        value={
                          library.id
                        }
                      >
                        {library.name}
                      </option>
                    )
                  )}
                </select>
              </label>

              <button
                type="submit"
                className="w-fit bg-shelf-primary px-4 py-2 text-sm font-semibold text-white sm:col-span-2"
              >
                Create sub-admin
              </button>
            </form>

            {/* ------------------------------------------------------------- */}
            {/* STAFF TABLE                                                    */}
            {/* ------------------------------------------------------------- */}

            <div className="overflow-x-auto border border-slate-200 bg-white">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">
                      Staff member
                    </th>

                    <th className="p-3">
                      Email
                    </th>

                    <th className="p-3">
                      Role
                    </th>

                    <th className="p-3">
                      Assigned branch
                    </th>

                    <th className="p-3">
                      Status
                    </th>

                    <th className="p-3">
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {staff.map(
                    (item) => (
                      <tr
                        key={
                          item.id
                        }
                      >
                        <td className="p-3 font-medium text-slate-900">
                          {
                            item.full_name
                          }
                        </td>

                        <td className="p-3 text-slate-600">
                          {
                            item.email
                          }
                        </td>

                        <td className="p-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                              item.role ===
                              'superadmin'
                                ? 'bg-purple-100 text-purple-800'
                                : item.role ===
                                  'subadmin'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {formatRole(
                              item.role
                            )}
                          </span>
                        </td>

                        <td className="p-3 text-slate-600">
                          {getLibraryName(
                            libraries,
                            item.library_id
                          )}
                        </td>

                        <td className="p-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                              item.is_active
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {item.is_active
                              ? 'Active'
                              : 'Disabled'}
                          </span>
                        </td>

                        <td className="p-3">
                          {item.role ===
                          'superadmin' ? (
                            <span className="text-xs text-slate-400">
                              Protected
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                toggleStaffActive(
                                  item
                                )
                              }
                              className="font-semibold text-shelf-primary"
                            >
                              {item.is_active
                                ? 'Disable'
                                : 'Enable'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>

              {!loading &&
                staff.length ===
                  0 && (
                  <p className="p-6 text-center text-sm text-slate-500">
                    No staff accounts
                    were found in
                    staff_profiles.
                  </p>
                )}
            </div>
          </section>
        )}
    </div>
  );
}

// ============================================================================
// Metric component
// ============================================================================

function Metric({
  label,
  value,
}) {
  return (
    <div className="border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase text-slate-500">
        {label}
      </p>

      <p className="mt-1 text-2xl font-bold text-slate-900">
        {value}
      </p>
    </div>
  );
}

export default AdminWorkspace;
