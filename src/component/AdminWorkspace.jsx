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
  {
    id: 'reports',
    label: 'Reports',
  },
  {
    id: 'analytics',
    label: 'Analytics',
  },
  {
    id: 'feedback',
    label: 'Feedback',
  },
  {
    id: 'announcements',
    label: 'Announcements',
  },
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
  if (!id) {
    return 'All libraries';
  }

  return (
    libraries.find(
      (library) =>
        String(library.id) ===
        String(id)
    )?.name ||
    'Unknown library'
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
      .replace(
        /\b\w/g,
        (char) => char.toUpperCase()
      ) ||
    'Staff'
  );
}

function toStartOfDay(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setHours(0, 0, 0, 0);

  return date;
}

function toEndOfDay(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setHours(
    23,
    59,
    59,
    999
  );

  return date;
}

function formatDateInput(date) {
  const year = date.getFullYear();

  const month = String(
    date.getMonth() + 1
  ).padStart(2, '0');

  const day = String(
    date.getDate()
  ).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getAnalyticsDateRange(
  range,
  customStartDate,
  customEndDate
) {
  const today = new Date();

  today.setHours(0, 0, 0, 0);

  if (range === 'today') {
    const end = new Date(today);

    end.setHours(
      23,
      59,
      59,
      999
    );

    return {
      start: today,
      end,
    };
  }

  if (range === '7d') {
    const start = new Date(today);

    start.setDate(
      start.getDate() - 6
    );

    const end = new Date(today);

    end.setHours(
      23,
      59,
      59,
      999
    );

    return {
      start,
      end,
    };
  }

  if (range === '30d') {
    const start = new Date(today);

    start.setDate(
      start.getDate() - 29
    );

    const end = new Date(today);

    end.setHours(
      23,
      59,
      59,
      999
    );

    return {
      start,
      end,
    };
  }

  if (range === 'month') {
    const start = new Date(
      today.getFullYear(),
      today.getMonth(),
      1
    );

    const end = new Date(today);

    end.setHours(
      23,
      59,
      59,
      999
    );

    return {
      start,
      end,
    };
  }

  if (range === 'custom') {
    const start =
      customStartDate
        ? toStartOfDay(
            `${customStartDate}T00:00:00`
          )
        : null;

    const end =
      customEndDate
        ? toEndOfDay(
            `${customEndDate}T23:59:59`
          )
        : null;

    return {
      start,
      end,
    };
  }

  const start = new Date(today);

  start.setDate(
    start.getDate() - 6
  );

  const end = new Date(today);

  end.setHours(
    23,
    59,
    59,
    999
  );

  return {
    start,
    end,
  };
}

function formatAnalyticsRangeLabel(
  range,
  customStartDate,
  customEndDate
) {
  if (range === 'today') {
    return 'Today';
  }

  if (range === '7d') {
    return 'Last 7 Days';
  }

  if (range === '30d') {
    return 'Last 30 Days';
  }

  if (range === 'month') {
    return 'This Month';
  }

  if (
    range === 'custom' &&
    customStartDate &&
    customEndDate
  ) {
    return `${customStartDate} to ${customEndDate}`;
  }

  return 'Custom Date Range';
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

  /*
   * -------------------------------------------------------------------------
   * Analytics filters
   *
   * IMPORTANT:
   * These states are used ONLY by the Analytics tab.
   * They do not control Reports, Feedback, Announcements, or Staff Accounts.
   * -------------------------------------------------------------------------
   */

  const [
    analyticsLibraryId,
    setAnalyticsLibraryId,
  ] = useState('');

  const [
    analyticsDateRange,
    setAnalyticsDateRange,
  ] = useState('7d');

  const [
    customStartDate,
    setCustomStartDate,
  ] = useState(() => {
    const date = new Date();

    date.setDate(
      date.getDate() - 6
    );

    return formatDateInput(date);
  });

  const [
    customEndDate,
    setCustomEndDate,
  ] = useState(() =>
    formatDateInput(new Date())
  );

  /*
   * -------------------------------------------------------------------------
   * Reports
   * -------------------------------------------------------------------------
   */

  const [period, setPeriod] =
    useState('daily');

  const [reportSort, setReportSort] =
    useState('time');

  /*
   * -------------------------------------------------------------------------
   * Database-backed sections
   * -------------------------------------------------------------------------
   */

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

  const [
    announcementForm,
    setAnnouncementForm,
  ] = useState({
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

  /*
   * -------------------------------------------------------------------------
   * Forecast
   * -------------------------------------------------------------------------
   */

  const [forecast, setForecast] =
    useState(null);

  const [forecastLoading, setForecastLoading] =
    useState(false);

  /*
   * -------------------------------------------------------------------------
   * Keep staff form branch aligned with current sub-admin assignment.
   * -------------------------------------------------------------------------
   */

  useEffect(() => {
    if (isSubAdmin) {
      setStaffForm((current) => ({
        ...current,
        libraryId:
          currentLibraryId || '',
      }));
    }
  }, [
    currentLibraryId,
    isSubAdmin,
  ]);

  /*
   * -------------------------------------------------------------------------
   * Books lookup
   * -------------------------------------------------------------------------
   */

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

  /*
   * -------------------------------------------------------------------------
   * Reports:
   * Sub-admin = assigned branch
   * Super-admin = all libraries
   *
   * NOTE:
   * Analytics has its OWN filters below.
   * -------------------------------------------------------------------------
   */

  const reportAttendance =
    useMemo(
      () =>
        attendanceLogs.filter((item) =>
          isSubAdmin
            ? String(item.libraryId) ===
              String(currentLibraryId)
            : true
        ),
      [
        attendanceLogs,
        currentLibraryId,
        isSubAdmin,
      ]
    );

  const reportBorrows =
    useMemo(
      () =>
        borrowRequests.filter((item) => {
          if (isSubAdmin) {
            return (
              String(
                booksById.get(
                  item.bookId
                )?.libraryId
              ) ===
              String(currentLibraryId)
            );
          }

          return true;
        }),
      [
        booksById,
        borrowRequests,
        currentLibraryId,
        isSubAdmin,
      ]
    );

  /*
   * -------------------------------------------------------------------------
   * Reports
   * -------------------------------------------------------------------------
   */

  const reportRows = useMemo(() => {
    const start =
      startOfPeriod(period);

    const attendanceRows =
      reportAttendance
        .filter((item) => {
          const value = new Date(
            item.timeIn
          );

          return (
            !Number.isNaN(
              value.getTime()
            ) &&
            value >= start
          );
        })
        .map((item) => ({
          type: 'Visitor',
          time: item.timeIn,
          person:
            item.visitorName ||
            'Unknown visitor',
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
      reportBorrows
        .filter((item) => {
          const value = new Date(
            item.requestDate
          );

          return (
            !Number.isNaN(
              value.getTime()
            ) &&
            value >= start
          );
        })
        .map((item) => ({
          type: 'Book transaction',
          time: item.requestDate,
          person:
            item.visitorName ||
            'Unknown visitor',
          detail:
            item.bookTitle ||
            'Book transaction',
          branch: getLibraryName(
            libraries,
            booksById.get(
              item.bookId
            )?.libraryId
          ),
          status: String(
            item.status || ''
          ).replaceAll(
            '_',
            ' '
          ),
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
    reportAttendance,
    reportBorrows,
    reportSort,
  ]);

  /*
   * -------------------------------------------------------------------------
   * Load database-backed sections
   *
   * Feedback:
   * - Sub-admin sees assigned branch.
   * - Super-admin sees all feedback.
   *
   * Announcements:
   * - Existing behavior retained.
   *
   * Staff:
   * - Existing behavior retained.
   * -------------------------------------------------------------------------
   */

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
        }

        result = await query;
      } else if (
        tab === 'announcements'
      ) {
        result = await supabase
          .from('announcements')
          .select('*')
          .order('created_at', {
            ascending: false,
          });
      } else {
        result = await supabase
          .from('staff_profiles')
          .select(
            'id, email, full_name, role, library_id, is_active, created_at'
          )
          .order('created_at', {
            ascending: false,
          });
      }

      if (!active) {
        return;
      }

      if (result.error) {
        setError(
          result.error.message
        );
      } else if (
        tab === 'feedback'
      ) {
        setFeedback(
          result.data || []
        );
      } else if (
        tab === 'announcements'
      ) {
        setAnnouncements(
          result.data || []
        );
      } else {
        setStaff(
          result.data || []
        );
      }

      setLoading(false);
    }

    loadData().catch(
      (loadError) => {
        if (active) {
          setError(
            loadError.message ||
              'Unable to load this section.'
          );

          setLoading(false);
        }
      }
    );

    return () => {
      active = false;
    };
  }, [
    currentLibraryId,
    isSubAdmin,
    tab,
  ]);

  /*
   * -------------------------------------------------------------------------
   * ANALYTICS LIBRARY SCOPE
   *
   * Super-admin:
   *   '' = All libraries
   *   UUID = selected library
   *
   * Sub-admin:
   *   Always assigned branch.
   * -------------------------------------------------------------------------
   */

  const effectiveAnalyticsLibraryId =
    isSubAdmin
      ? currentLibraryId
      : analyticsLibraryId;

  /*
   * -------------------------------------------------------------------------
   * Analytics date range
   * -------------------------------------------------------------------------
   */

  const analyticsDateRangeValues =
    useMemo(
      () =>
        getAnalyticsDateRange(
          analyticsDateRange,
          customStartDate,
          customEndDate
        ),
      [
        analyticsDateRange,
        customEndDate,
        customStartDate,
      ]
    );

  const analyticsStart =
    analyticsDateRangeValues.start;

  const analyticsEnd =
    analyticsDateRangeValues.end;

  /*
   * -------------------------------------------------------------------------
   * Analytics scoped attendance
   * -------------------------------------------------------------------------
   */

  const analyticsAttendance =
    useMemo(() => {
      return attendanceLogs.filter(
        (item) => {
          const itemLibraryId =
            item.libraryId;

          const time = new Date(
            item.timeIn
          );

          if (
            Number.isNaN(
              time.getTime()
            )
          ) {
            return false;
          }

          const matchesLibrary =
            !effectiveAnalyticsLibraryId ||
            String(itemLibraryId) ===
              String(
                effectiveAnalyticsLibraryId
              );

          const matchesDate =
            (!analyticsStart ||
              time >=
                analyticsStart) &&
            (!analyticsEnd ||
              time <= analyticsEnd);

          return (
            matchesLibrary &&
            matchesDate
          );
        }
      );
    }, [
      analyticsEnd,
      analyticsStart,
      attendanceLogs,
      effectiveAnalyticsLibraryId,
    ]);

  /*
   * -------------------------------------------------------------------------
   * Analytics scoped borrow transactions
   * -------------------------------------------------------------------------
   */

  const analyticsBorrows =
    useMemo(() => {
      return borrowRequests.filter(
        (item) => {
          const book =
            booksById.get(
              item.bookId
            );

          const time = new Date(
            item.requestDate
          );

          if (
            Number.isNaN(
              time.getTime()
            )
          ) {
            return false;
          }

          const matchesLibrary =
            !effectiveAnalyticsLibraryId ||
            String(
              book?.libraryId
            ) ===
              String(
                effectiveAnalyticsLibraryId
              );

          const matchesDate =
            (!analyticsStart ||
              time >=
                analyticsStart) &&
            (!analyticsEnd ||
              time <= analyticsEnd);

          return (
            matchesLibrary &&
            matchesDate
          );
        }
      );
    }, [
      analyticsEnd,
      analyticsStart,
      booksById,
      borrowRequests,
      effectiveAnalyticsLibraryId,
    ]);

  /*
   * -------------------------------------------------------------------------
   * Analytics chart period
   * -------------------------------------------------------------------------
   */

  const analyticsChartData =
    useMemo(() => {
      if (
        !analyticsStart ||
        !analyticsEnd
      ) {
        return {
          labels: [],
          visits: [],
          transactions: [],
        };
      }

      const start = new Date(
        analyticsStart
      );

      start.setHours(0, 0, 0, 0);

      const end = new Date(
        analyticsEnd
      );

      end.setHours(
        0,
        0,
        0,
        0
      );

      const difference =
        Math.floor(
          (end.getTime() -
            start.getTime()) /
            86400000
        ) + 1;

      /*
       * For large custom ranges, keep the chart readable by grouping
       * into monthly buckets.
       *
       * Normal ranges up to 31 days remain daily.
       */
      if (difference > 62) {
        const months = [];
        const cursor = new Date(
          start.getFullYear(),
          start.getMonth(),
          1
        );

        const lastMonth =
          new Date(
            end.getFullYear(),
            end.getMonth(),
            1
          );

        while (
          cursor <= lastMonth
        ) {
          months.push(
            new Date(cursor)
          );

          cursor.setMonth(
            cursor.getMonth() + 1
          );
        }

        const labels =
          months.map((date) =>
            date.toLocaleDateString(
              undefined,
              {
                month: 'short',
                year: 'numeric',
              }
            )
          );

        const visits =
          months.map(
            (monthStart) => {
              const monthEnd =
                new Date(
                  monthStart.getFullYear(),
                  monthStart.getMonth() +
                    1,
                  0
                );

              monthEnd.setHours(
                23,
                59,
                59,
                999
              );

              return analyticsAttendance.filter(
                (item) => {
                  const time =
                    new Date(
                      item.timeIn
                    );

                  return (
                    time >=
                      monthStart &&
                    time <=
                      monthEnd
                  );
                }
              ).length;
            }
          );

        const transactions =
          months.map(
            (monthStart) => {
              const monthEnd =
                new Date(
                  monthStart.getFullYear(),
                  monthStart.getMonth() +
                    1,
                  0
                );

              monthEnd.setHours(
                23,
                59,
                59,
                999
              );

              return analyticsBorrows.filter(
                (item) => {
                  const time =
                    new Date(
                      item.requestDate
                    );

                  return (
                    time >=
                      monthStart &&
                    time <=
                      monthEnd
                  );
                }
              ).length;
            }
          );

        return {
          labels,
          visits,
          transactions,
        };
      }

      const dates =
        Array.from(
          {
            length:
              Math.max(
                difference,
                1
              ),
          },
          (_, index) => {
            const date =
              new Date(start);

            date.setDate(
              start.getDate() +
                index
            );

            return date;
          }
        );

      return {
        labels: dates.map(
          (date) =>
            date.toLocaleDateString(
              undefined,
              {
                month: 'short',
                day: 'numeric',
              }
            )
        ),

        visits: dates.map(
          (date) =>
            analyticsAttendance.filter(
              (item) => {
                const time =
                  new Date(
                    item.timeIn
                  );

                return (
                  time.toDateString() ===
                  date.toDateString()
                );
              }
            ).length
        ),

        transactions:
          dates.map(
            (date) =>
              analyticsBorrows.filter(
                (item) => {
                  const time =
                    new Date(
                      item.requestDate
                    );

                  return (
                    time.toDateString() ===
                    date.toDateString()
                  );
                }
              ).length
          ),
      };
    }, [
      analyticsAttendance,
      analyticsBorrows,
      analyticsEnd,
      analyticsStart,
    ]);

  /*
   * -------------------------------------------------------------------------
   * Most requested categories
   * -------------------------------------------------------------------------
   */

  const topCategories =
    useMemo(() => {
      const counts = new Map();

      analyticsBorrows.forEach(
        (request) => {
          const category =
            booksById.get(
              request.bookId
            )?.category ||
            'Uncategorized';

          counts.set(
            category,
            (counts.get(
              category
            ) || 0) + 1
          );
        }
      );

      return [...counts]
        .sort(
          (a, b) =>
            b[1] - a[1]
        )
        .slice(0, 5);
    }, [
      analyticsBorrows,
      booksById,
    ]);

  /*
   * -------------------------------------------------------------------------
   * Operational recommendations
   * -------------------------------------------------------------------------
   */

  const demandRecommendations =
    useMemo(() => {
      const suggestions = [];

      if (
        analyticsAttendance.length ===
        0
      ) {
        suggestions.push(
          'There is not enough attendance activity in the selected period to recommend a staffing change.'
        );
      } else if (
        analyticsAttendance.length >=
        20
      ) {
        suggestions.push(
          'Visitor activity is relatively high for the selected period. Review peak attendance times when planning front-desk coverage.'
        );
      } else {
        suggestions.push(
          'Visitor demand is currently moderate based on the selected analytics period.'
        );
      }

      if (topCategories[0]) {
        suggestions.push(
          `Review copy levels for ${topCategories[0][0]}, the highest-demand category in the selected transaction data.`
        );
      }

      if (
        analyticsBorrows.length ===
        0
      ) {
        suggestions.push(
          'No book transactions were recorded in the selected period. Continue monitoring activity before making inventory changes.'
        );
      }

      return suggestions;
    }, [
      analyticsAttendance.length,
      analyticsBorrows.length,
      topCategories,
    ]);

  /*
   * -------------------------------------------------------------------------
   * Export
   * -------------------------------------------------------------------------
   */

  const handleExport = (
    format
  ) => {
    const rows =
      reportRows.map(
        (row) => ({
          ...row,
          time: new Date(
            row.time
          ).toISOString(),
        })
      );

    const suffix = `${period}_${
      isSubAdmin
        ? currentLibraryId
        : 'all-libraries'
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

  /*
   * -------------------------------------------------------------------------
   * Announcements
   * -------------------------------------------------------------------------
   */

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

      const {
        data,
        error: reloadError,
      } = await supabase
        .from('announcements')
        .select('*')
        .order('created_at', {
          ascending: false,
        });

      if (reloadError) {
        setError(
          reloadError.message
        );

        return;
      }

      setAnnouncements(
        data || []
      );
    };

  const handleAnnouncementEdit = (
    announcement
  ) => {
    setAnnouncementForm({
      title:
        announcement.title || '',
      message:
        announcement.message ||
        '',
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

        setMessage(
          'Announcement deleted.'
        );
      }
    };

  /*
   * -------------------------------------------------------------------------
   * Feedback
   * -------------------------------------------------------------------------
   */

  const handleFeedbackReply =
    async (item) => {
      const reply = String(
        feedbackReply[item.id] ||
          ''
      ).trim();

      if (!reply) {
        return;
      }

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

  /*
   * -------------------------------------------------------------------------
   * Visitor Forecast
   * -------------------------------------------------------------------------
   */

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

    if (
      analyticsAttendance.length ===
        0 &&
      analyticsBorrows.length === 0
    ) {
      setError(
        'There is not enough data in the selected Analytics filters to generate a forecast.'
      );

      return;
    }

    setForecastLoading(true);
    setError('');

    try {
      const categorySeries =
        topCategories.map(
          ([category]) => {
            const weeklyDemand = [
              0,
              0,
              0,
              0,
            ];

            const now = Date.now();

            analyticsBorrows.forEach(
              (request) => {
                const requestCategory =
                  booksById.get(
                    request.bookId
                  )?.category ||
                  'Uncategorized';

                if (
                  requestCategory !==
                  category
                ) {
                  return;
                }

                const requestTime =
                  new Date(
                    request.requestDate
                  ).getTime();

                if (
                  Number.isNaN(
                    requestTime
                  )
                ) {
                  return;
                }

                const ageDays =
                  Math.floor(
                    (now -
                      requestTime) /
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
                analyticsChartData.visits,
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
    } catch (
      forecastError
    ) {
      setError(
        forecastError.message ||
          'Forecast request failed.'
      );
    } finally {
      setForecastLoading(false);
    }
  };

  /*
   * -------------------------------------------------------------------------
   * Create staff
   * -------------------------------------------------------------------------
   */

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
      } =
        await supabase.functions.invoke(
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

  /*
   * -------------------------------------------------------------------------
   * Enable / Disable staff
   * -------------------------------------------------------------------------
   */

  const toggleStaffActive =
    async (profile) => {
      setError('');
      setMessage('');

      const {
        data,
        error: updateError,
      } =
        await supabase.functions.invoke(
          'manage-staff',
          {
            body: {
              operation:
                'set-active',
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

  /*
   * -------------------------------------------------------------------------
   * Supabase guard
   * -------------------------------------------------------------------------
   */

  if (!supabase) {
    return (
      <p className="border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Configure Supabase to use
        reports and management tools.
      </p>
    );
  }

  /*
   * -------------------------------------------------------------------------
   * UI
   * -------------------------------------------------------------------------
   */

  return (
    <div className="space-y-5">
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
                  : 'All libraries'}
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
                reportAttendance.filter(
                  (item) => {
                    const time =
                      new Date(
                        item.timeIn
                      );

                    return (
                      !Number.isNaN(
                        time.getTime()
                      ) &&
                      time >=
                        startOfPeriod(
                          period
                        )
                    );
                  }
                ).length
              }
            />

            <Metric
              label="Book requests"
              value={
                reportBorrows.filter(
                  (item) => {
                    const time =
                      new Date(
                        item.requestDate
                      );

                    return (
                      !Number.isNaN(
                        time.getTime()
                      ) &&
                      time >=
                        startOfPeriod(
                          period
                        )
                    );
                  }
                ).length
              }
            />

            <Metric
              label="Active loans"
              value={
                reportBorrows.filter(
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
        <section className="space-y-5">
          {/* ---------------------------------------------------------------- */}
          {/* ANALYTICS FILTERS ONLY                                          */}
          {/* ---------------------------------------------------------------- */}

          <section className="border border-slate-200 bg-white p-4">
            <div className="mb-3">
              <h2 className="text-base font-bold text-slate-900">
                Analytics filters
              </h2>

              <p className="text-xs text-slate-500">
                Filter the analytics data
                by branch and date range.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              {!isSubAdmin && (
                <label className="text-xs font-semibold text-slate-600">
                  Library / Branch

                  <select
                    value={
                      analyticsLibraryId
                    }
                    onChange={(
                      event
                    ) => {
                      setAnalyticsLibraryId(
                        event.target
                          .value
                      );

                      setForecast(
                        null
                      );
                    }}
                    className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                  >
                    <option value="">
                      All Libraries
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
                          {
                            library.name
                          }
                        </option>
                      )
                    )}
                  </select>
                </label>
              )}

              <label className="text-xs font-semibold text-slate-600">
                Date Range

                <select
                  value={
                    analyticsDateRange
                  }
                  onChange={(
                    event
                  ) => {
                    setAnalyticsDateRange(
                      event.target
                        .value
                    );

                    setForecast(
                      null
                    );
                  }}
                  className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                >
                  <option value="today">
                    Today
                  </option>

                  <option value="7d">
                    Last 7 Days
                  </option>

                  <option value="30d">
                    Last 30 Days
                  </option>

                  <option value="month">
                    This Month
                  </option>

                  <option value="custom">
                    Custom Date Range
                  </option>
                </select>
              </label>

              {analyticsDateRange ===
                'custom' && (
                <>
                  <label className="text-xs font-semibold text-slate-600">
                    Start Date

                    <input
                      type="date"
                      value={
                        customStartDate
                      }
                      max={
                        customEndDate ||
                        undefined
                      }
                      onChange={(
                        event
                      ) => {
                        setCustomStartDate(
                          event.target
                            .value
                        );

                        setForecast(
                          null
                        );
                      }}
                      className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    />
                  </label>

                  <label className="text-xs font-semibold text-slate-600">
                    End Date

                    <input
                      type="date"
                      value={
                        customEndDate
                      }
                      min={
                        customStartDate ||
                        undefined
                      }
                      onChange={(
                        event
                      ) => {
                        setCustomEndDate(
                          event.target
                            .value
                        );

                        setForecast(
                          null
                        );
                      }}
                      className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                    />
                  </label>
                </>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
              <span className="rounded-full bg-slate-100 px-3 py-1">
                Branch:{' '}
                <strong className="text-slate-700">
                  {isSubAdmin
                    ? getLibraryName(
                        libraries,
                        currentLibraryId
                      )
                    : getLibraryName(
                        libraries,
                        analyticsLibraryId
                      )}
                </strong>
              </span>

              <span className="rounded-full bg-slate-100 px-3 py-1">
                Period:{' '}
                <strong className="text-slate-700">
                  {formatAnalyticsRangeLabel(
                    analyticsDateRange,
                    customStartDate,
                    customEndDate
                  )}
                </strong>
              </span>
            </div>
          </section>

          {/* ---------------------------------------------------------------- */}
          {/* ANALYTICS CONTENT                                               */}
          {/* ---------------------------------------------------------------- */}

          <section className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
            <div className="border border-slate-200 bg-white p-4">
              <div className="mb-4">
                <h2 className="text-lg font-bold text-slate-900">
                  {isSubAdmin
                    ? getLibraryName(
                        libraries,
                        currentLibraryId
                      )
                    : analyticsLibraryId
                    ? getLibraryName(
                        libraries,
                        analyticsLibraryId
                      )
                    : 'All libraries'}{' '}
                  demand
                </h2>

                <p className="text-sm text-slate-500">
                  {formatAnalyticsRangeLabel(
                    analyticsDateRange,
                    customStartDate,
                    customEndDate
                  )}
                  . Counts are
                  calculated from
                  attendance and
                  transaction
                  records.
                </p>
              </div>

              {analyticsDateRange ===
                'custom' &&
                (!customStartDate ||
                  !customEndDate ||
                  customStartDate >
                    customEndDate) && (
                  <p className="mb-4 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    Please select a
                    valid custom date
                    range.
                  </p>
                )}

              <Bar
                data={{
                  labels:
                    analyticsChartData.labels,

                  datasets: [
                    {
                      label: 'Visitors',
                      data:
                        analyticsChartData.visits,
                      backgroundColor:
                        '#0f766e',
                    },

                    {
                      label:
                        'Book transactions',
                      data:
                        analyticsChartData.transactions,
                      backgroundColor:
                        '#d97706',
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio:
                    true,

                  plugins: {
                    legend: {
                      display: true,
                    },
                  },

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

                {topCategories.length >
                0 ? (
                  <ol className="mt-2 space-y-1 text-sm text-slate-600">
                    {topCategories.map(
                      ([
                        category,
                        count,
                      ]) => (
                        <li
                          key={
                            category
                          }
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
                ) : (
                  <p className="mt-2 text-sm text-slate-500">
                    No book transaction
                    data found for
                    the selected
                    filters.
                  </p>
                )}
              </div>
            </div>

            <aside className="space-y-4">
              {/* ------------------------------------------------------------ */}
              {/* Recommendations                                              */}
              {/* ------------------------------------------------------------ */}

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

              {/* ------------------------------------------------------------ */}
              {/* Forecast                                                     */}
              {/* ------------------------------------------------------------ */}

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
                      forecastLoading ||
                      (analyticsAttendance.length ===
                        0 &&
                        analyticsBorrows.length ===
                          0)
                    }
                    className="bg-shelf-primary px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {forecastLoading
                      ? 'Forecasting...'
                      : 'Run forecast'}
                  </button>
                </div>

                <p className="mt-2 text-xs text-slate-500">
                  Forecast is based
                  on the currently
                  selected Analytics
                  filters.
                </p>

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
                            {
                              item.date
                            }
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
                    Select an
                    Analytics scope
                    and run the
                    forecast to
                    generate a
                    seven-day
                    visitor
                    forecast.
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
