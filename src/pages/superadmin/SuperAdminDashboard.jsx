import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  Bar,
  Line,
} from 'react-chartjs-2';

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Building2,
  FileSpreadsheet,
  MapPinned,
  ShieldCheck,
  Upload,
  UsersRound,
} from 'lucide-react';

import { useAuth } from '../../context/useAuth.js';
import {
  useLibraryData,
  useLibrary,
} from '../../context/useLibrary.js';

import BookInventory from '../../component/BookInventory.jsx';
import LibraryMap from '../../component/LibraryMap.jsx';
import AdminWorkspace from '../../component/AdminWorkspace.jsx';
import DashboardWelcome from '../../component/DashboardWelcome.jsx';

import { supabase } from '../../lib/supabaseClient.js';

import {
  exportToExcel,
  exportToCSV,
  parseImportFile,
} from '../../lib/excelUtils.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend
);

const NAV = [
  {
    id: 'overview',
    label: 'Overview & Analytics',
    Icon: Activity,
  },
  {
    id: 'inventory',
    label: 'Inventory',
    Icon: BookOpen,
  },
  {
    id: 'map',
    label: 'Libraries & Map',
    Icon: MapPinned,
  },
  {
    id: 'accounts',
    label: 'Staff Accounts',
    Icon: ShieldCheck,
  },
  {
    id: 'workspace',
    label: 'Reports & Services',
    Icon: FileSpreadsheet,
  },
];

function StatCard({
  label,
  value,
  tone = 'default',
}) {
  const tones = {
    default:
      'bg-white border-slate-200 border-l-slate-300 text-slate-800',

    amber:
      'bg-amber-50 border-amber-200 border-l-amber-500 text-amber-800',

    red:
      'bg-red-50 border-red-200 border-l-red-500 text-red-700',

    blue:
      'bg-blue-50 border-blue-200 border-l-blue-500 text-blue-800',
  };

  return (
    <div
      className={`rounded-r-xl border border-l-4 p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${tones[tone]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider opacity-70">{label}</p>
          <p className="mt-1 text-3xl font-extrabold">{value}</p>
        </div>
        <span className="rounded-lg bg-white/70 p-2 text-current shadow-sm" aria-hidden="true">
          {tone === 'amber' ? <Building2 size={18} /> : tone === 'red' ? <AlertTriangle size={18} /> : tone === 'blue' ? <UsersRound size={18} /> : <Activity size={18} />}
        </span>
      </div>
    </div>
  );
}

function lastNDaysLabels(n) {
  return Array.from(
    { length: n },
    (_, index) => {
      const date = new Date();

      date.setDate(
        date.getDate() -
          (n - 1 - index)
      );

      return date.toLocaleDateString(
        'en-PH',
        {
          month: 'short',
          day: 'numeric',
        }
      );
    }
  );
}

function getLibraryName(
  libraries,
  libraryId
) {
  return (
    libraries.find(
      (library) =>
        library.id === libraryId
    )?.name ||
    libraryId ||
    'System-wide'
  );
}

function formatStaffRole(role) {
  if (role === 'superadmin') {
    return 'Super Admin';
  }

  if (role === 'subadmin') {
    return 'Sub-Admin';
  }

  if (role === 'librarian') {
    return 'Library Staff';
  }

  if (role === 'circulation') {
    return 'Circulation Staff';
  }

  return (
    String(role || '')
      .replaceAll('_', ' ')
      .replace(
        /\b\w/g,
        (character) =>
          character.toUpperCase()
      ) || 'Staff'
  );
}

export default function SuperAdminDashboard() {
  const {
    user,
    logout,
  } = useAuth();

  const {
    addLibrary,
  } = useLibrary();

  const {
    books,
    visitors,
    borrowRequests,
    attendanceLogs,
    libraries,
  } = useLibraryData();

  const [section, setSection] =
    useState('overview');

  // ============================================================
  // IMPORT / EXPORT
  // ============================================================

  const [
    importTarget,
    setImportTarget,
  ] = useState('books');

  const handleFileUpload = (
    event
  ) => {
    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

    parseImportFile(
      file,
      async (importedJSON) => {
        try {
          const {
            error,
          } = await supabase
            .from(importTarget)
            .insert(importedJSON);

          if (error) {
            window.alert(
              `Failed to import data: ${error.message}`
            );
            return;
          }

          window.alert(
            `Data successfully imported to ${importTarget}!`
          );

          window.location.reload();
        } catch (error) {
          console.error(
            'Import error:',
            error
          );

          window.alert(
            error.message ||
              'Failed to import data.'
          );
        }
      }
    );

    event.target.value = '';
  };

  // ============================================================
  // ADD LIBRARY
  // ============================================================

  const [
    showAddLibrary,
    setShowAddLibrary,
  ] = useState(false);

  const [
    savingLibrary,
    setSavingLibrary,
  ] = useState(false);

  const [
    libraryMessage,
    setLibraryMessage,
  ] = useState('');

  const [
    libraryForm,
    setLibraryForm,
  ] = useState({
    name: '',
    campus: '',
    address: '',
    lat: '',
    lng: '',
    hours: '8:00 AM - 5:00 PM',
    status: 'Open',
  });

  // ============================================================
  // STAFF ACCOUNTS
  // ============================================================

  const [
    staffAccounts,
    setStaffAccounts,
  ] = useState([]);

  const [
    staffLoading,
    setStaffLoading,
  ] = useState(false);

  const [
    staffError,
    setStaffError,
  ] = useState('');

  const [
    staffMessage,
    setStaffMessage,
  ] = useState('');

  const [
    staffForm,
    setStaffForm,
  ] = useState({
    fullName: '',
    email: '',
    password: '',
    libraryId: '',
  });

  // ============================================================
  // LOAD STAFF ACCOUNTS
  // ============================================================

  const loadStaffAccounts =
    async () => {
      if (!supabase) {
        setStaffError(
          'Supabase is not configured.'
        );
        return;
      }

      try {
        setStaffLoading(true);
        setStaffError('');

        const {
          data,
          error,
        } = await supabase
          .from('staff_profiles')
          .select(
            'id, email, full_name, role, library_id, is_active, created_at'
          )
          .order('created_at', {
            ascending: false,
          });

        if (error) {
          throw error;
        }

        setStaffAccounts(
          data || []
        );
      } catch (error) {
        console.error(
          'Load staff accounts error:',
          error
        );

        setStaffError(
          error.message ||
            'Unable to load staff accounts.'
        );
      } finally {
        setStaffLoading(false);
      }
    };

  useEffect(() => {
    if (
      section === 'accounts'
    ) {
      void Promise.resolve().then(loadStaffAccounts);
    }
  }, [section]);

  // ============================================================
  // CREATE STAFF ACCOUNT
  // ============================================================

  const handleCreateStaff =
    async (event) => {
      event.preventDefault();

      if (!supabase) {
        setStaffError(
          'Supabase is not configured.'
        );
        return;
      }

      setStaffError('');
      setStaffMessage('');

      const fullName =
        staffForm.fullName.trim();

      const email =
        staffForm.email
          .trim()
          .toLowerCase();

      const password =
        staffForm.password;

      const libraryId =
        staffForm.libraryId;

      if (
        !fullName ||
        !email ||
        !password ||
        !libraryId
      ) {
        setStaffError(
          'Please complete all staff account fields.'
        );
        return;
      }

      if (password.length < 10) {
        setStaffError(
          'Password must contain at least 10 characters.'
        );
        return;
      }

      try {
        setStaffLoading(true);

        const {
          data,
          error,
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
                role: 'subadmin',
              },
            }
          );

        if (error) {
          throw error;
        }

        if (data?.error) {
          throw new Error(
            data.error
          );
        }

        setStaffForm({
          fullName: '',
          email: '',
          password: '',
          libraryId: '',
        });

        await loadStaffAccounts();

        setStaffMessage(
          'Sub-admin account created successfully.'
        );
      } catch (error) {
        console.error(
          'Create staff account error:',
          error
        );

        setStaffError(
          error.message ||
            'Unable to create staff account.'
        );
      } finally {
        setStaffLoading(false);
      }
    };

  // ============================================================
  // ENABLE / DISABLE STAFF
  // ============================================================

  const handleToggleStaff =
    async (staff) => {
      if (!supabase) {
        setStaffError(
          'Supabase is not configured.'
        );
        return;
      }

      if (
        staff.role ===
        'superadmin'
      ) {
        setStaffError(
          'Super-admin accounts are protected.'
        );
        return;
      }

      const nextState =
        !staff.is_active;

      const action =
        nextState
          ? 'enable'
          : 'disable';

      const confirmed =
        window.confirm(
          `Are you sure you want to ${action} ${staff.full_name}?`
        );

      if (!confirmed) {
        return;
      }

      try {
        setStaffLoading(true);
        setStaffError('');
        setStaffMessage('');

        const {
          data,
          error,
        } =
          await supabase.functions.invoke(
            'manage-staff',
            {
              body: {
                operation:
                  'set-active',
                userId:
                  staff.id,
                isActive:
                  nextState,
              },
            }
          );

        if (error) {
          throw error;
        }

        if (data?.error) {
          throw new Error(
            data.error
          );
        }

        await loadStaffAccounts();

        setStaffMessage(
          `${staff.full_name} is now ${
            nextState
              ? 'active'
              : 'disabled'
          }.`
        );
      } catch (error) {
        console.error(
          'Toggle staff account error:',
          error
        );

        setStaffError(
          error.message ||
            'Unable to update staff account.'
        );
      } finally {
        setStaffLoading(false);
      }
    };

  // ============================================================
  // CURRENT LOCATION
  // ============================================================

  const useCurrentLocation =
    () => {
      if (
        !navigator.geolocation
      ) {
        setLibraryMessage(
          'Geolocation is not supported by this browser.'
        );
        return;
      }

      setLibraryMessage(
        'Getting your current location...'
      );

      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLibraryForm(
            (previous) => ({
              ...previous,
              lat: position.coords.latitude.toFixed(
                6
              ),
              lng: position.coords.longitude.toFixed(
                6
              ),
            })
          );

          setLibraryMessage(
            'Location captured successfully.'
          );
        },
        (error) => {
          console.error(
            'Geolocation error:',
            error
          );

          setLibraryMessage(
            'Unable to get your location. Please enter latitude and longitude manually.'
          );
        }
      );
    };

  // ============================================================
  // ADD LIBRARY
  // ============================================================

  const handleAddLibrary =
    async (event) => {
      event.preventDefault();

      if (
        !libraryForm.name.trim() ||
        !libraryForm.address.trim() ||
        !libraryForm.lat ||
        !libraryForm.lng
      ) {
        setLibraryMessage(
          'Please enter the library name, address, latitude, and longitude.'
        );
        return;
      }

      try {
        setSavingLibrary(true);
        setLibraryMessage('');

        await addLibrary(
          libraryForm
        );

        setLibraryMessage(
          'Library added successfully.'
        );

        setLibraryForm({
          name: '',
          campus: '',
          address: '',
          lat: '',
          lng: '',
          hours:
            '8:00 AM - 5:00 PM',
          status: 'Open',
        });

        setShowAddLibrary(false);
      } catch (error) {
        console.error(
          'Add library error:',
          error
        );

        setLibraryMessage(
          error.message ||
            'Failed to add library.'
        );
      } finally {
        setSavingLibrary(false);
      }
    };

  // ============================================================
  // DASHBOARD DATA
  // ============================================================

  const activeBorrows =
    borrowRequests.filter(
      (request) =>
        request.status ===
        'borrowed'
    ).length;

  const overdue =
    borrowRequests.filter(
      (request) =>
        request.status ===
          'borrowed' &&
        request.dueDate &&
        new Date(
          request.dueDate
        ) < new Date()
    ).length;

  const openLibraries =
    libraries.filter(
      (library) =>
        library.status === 'Open'
    ).length;

  // ============================================================
  // TREND DATA
  // ============================================================

  const trendData = useMemo(() => {
    const days = 7;

    const labels =
      lastNDaysLabels(days);

    const dayKey = (value) =>
      new Date(
        value
      ).toDateString();

    const keys = Array.from(
      { length: days },
      (_, index) => {
        const date =
          new Date();

        date.setDate(
          date.getDate() -
            (days - 1 - index)
        );

        return date.toDateString();
      }
    );

    const visitCounts =
      keys.map((key) =>
        attendanceLogs.filter(
          (attendance) =>
            attendance.timeIn &&
            dayKey(
              attendance.timeIn
            ) === key
        ).length
      );

    const borrowCounts =
      keys.map((key) =>
        borrowRequests.filter(
          (request) =>
            request.borrowDate &&
            dayKey(
              request.borrowDate
            ) === key
        ).length
      );

    return {
      labels,
      visitCounts,
      borrowCounts,
    };
  }, [
    attendanceLogs,
    borrowRequests,
  ]);

  // ============================================================
  // CATEGORY DATA
  // ============================================================

  const categoryData =
    useMemo(() => {
      const counts = {};

      books.forEach(
        (book) => {
          const category =
            book.category ||
            'Uncategorized';

          counts[category] =
            (counts[category] ||
              0) + 1;
        }
      );

      return {
        labels:
          Object.keys(
            counts
          ),
        values:
          Object.values(
            counts
          ),
      };
    }, [books]);

  // ============================================================
  // UI
  // ============================================================

  return (
    <div className="flex min-h-screen bg-[#f8fafc] text-slate-800">

      {/* ======================================================
          SIDEBAR
      ====================================================== */}

      <aside className="flex w-60 shrink-0 flex-col bg-[#002046] text-white">

        <div className="border-b border-white/10 p-5">
          <p className="font-extrabold tracking-wider">
            SHELF ILMS
          </p>

          <p className="mt-1 text-xs text-slate-300">
            Super-Admin Console
          </p>
        </div>

        <nav className="flex-1 space-y-1 p-3">

          {NAV.map(
            ({ Icon, ...item }) => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  setSection(
                    item.id
                  );

                  setStaffError('');
                  setStaffMessage('');

                  if (
                    item.id !==
                    'map'
                  ) {
                    setShowAddLibrary(
                      false
                    );

                    setLibraryMessage(
                      ''
                    );
                  }
                }}
                className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition ${
                  section ===
                  item.id
                    ? 'bg-white/15 font-bold text-amber-300 shadow-[inset_3px_0_0_0_#f59e0b]'
                    : 'text-slate-300 hover:bg-white/5'
                }`}
              >
                <Icon size={18} className="mr-3 inline-block align-[-3px]" aria-hidden="true" />
                {item.label}
              </button>
            )
          )}

        </nav>

        <div className="space-y-2 border-t border-white/10 p-4">

          <p className="text-xs text-slate-300">
            Signed in as
          </p>

          <p className="text-sm font-bold">
            {user?.name ||
              'System Super Administrator'}
          </p>

          <button
            type="button"
            onClick={logout}
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs transition hover:bg-white/20"
          >
            Sign Out
          </button>

        </div>

      </aside>

      {/* ======================================================
          MAIN CONTENT
      ====================================================== */}

      <main className="min-w-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <DashboardWelcome
          name={user?.name?.split(' ')[0]}
          description="System metrics, library operations, staff accounts, and reports at a glance."
          actions={[
            { label: 'View Inventory', Icon: BookOpen, onClick: () => setSection('inventory') },
            { label: 'Manage Staff', Icon: ShieldCheck, onClick: () => setSection('accounts') },
            { label: 'Open Reports', Icon: FileSpreadsheet, onClick: () => setSection('workspace') },
          ]}
        />

        {/* ====================================================
            OVERVIEW
        ==================================================== */}

        {section ===
          'overview' && (
          <div className="space-y-6">

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">

              <StatCard
                label="Registered Visitors"
                value={
                  visitors.length
                }
                tone="blue"
              />

              <StatCard
                label="Titles in Catalog"
                value={
                  books.length
                }
              />

              <StatCard
                label="Active Borrows"
                value={
                  activeBorrows
                }
              />

              <StatCard
                label="Overdue Items"
                value={overdue}
                tone="red"
              />

              <StatCard
                label="Branches Open"
                value={`${openLibraries}/${libraries.length}`}
                tone="amber"
              />

            </div>

            {/* ==================================================
                DATA MANAGEMENT
            ================================================== */}

            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">

              <div className="flex flex-col justify-between gap-2 border-b border-slate-100 pb-3 md:flex-row md:items-center">

                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    Data Management &
                    Reports
                  </h3>

                  <p className="mt-0.5 text-xs text-slate-500">
                    Export system records
                    or import new entries
                    into the database.
                  </p>
                </div>

                <div className="flex items-center gap-2">

                  <select
                    value={
                      importTarget
                    }
                    onChange={(
                      event
                    ) =>
                      setImportTarget(
                        event.target
                          .value
                      )
                    }
                    className="rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-2 text-xs font-semibold text-slate-700"
                  >
                    <option value="books">
                      Import to Books
                      Table
                    </option>

                    <option value="attendance_logs">
                      Import to
                      Attendance
                      Logs
                    </option>
                  </select>

                  <label className="cursor-pointer rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-blue-700">

                    <Upload size={14} className="mr-1.5 inline-block align-[-2px]" aria-hidden="true" />
                    Import File

                    <input
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={
                        handleFileUpload
                      }
                      className="hidden"
                    />

                  </label>

                </div>

              </div>

              <div className="grid grid-cols-1 gap-4 pt-1 sm:grid-cols-2">

                {/* BOOK EXPORT */}

                <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 p-3.5">

                  <div>
                    <p className="text-xs font-bold text-slate-700">
                      <BookOpen size={14} className="mr-1.5 inline-block align-[-2px]" aria-hidden="true" />
                      All Books
                      Catalog
                    </p>

                    <p className="text-[11px] text-slate-500">
                      Total Titles:{' '}
                      {books.length}
                    </p>
                  </div>

                  <div className="flex gap-2">

                    <button
                      type="button"
                      onClick={() =>
                        exportToExcel(
                          books,
                          'All_Libraries_Books.xlsx'
                        )
                      }
                      className="rounded bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-emerald-700"
                    >
                      Excel
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        exportToCSV(
                          books,
                          'All_Libraries_Books.csv'
                        )
                      }
                      className="rounded bg-slate-700 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-slate-800"
                    >
                      CSV
                    </button>

                  </div>

                </div>

                {/* ATTENDANCE EXPORT */}

                <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 p-3.5">

                  <div>
                    <p className="text-xs font-bold text-slate-700">
                      <Activity size={14} className="mr-1.5 inline-block align-[-2px]" aria-hidden="true" />
                      Total
                      Attendance
                    </p>

                    <p className="text-[11px] text-slate-500">
                      Total Visits:{' '}
                      {
                        attendanceLogs.length
                      }
                    </p>
                  </div>

                  <div className="flex gap-2">

                    <button
                      type="button"
                      onClick={() =>
                        exportToExcel(
                          attendanceLogs,
                          'Total_Attendance_All_Libraries.xlsx'
                        )
                      }
                      className="rounded bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-emerald-700"
                    >
                      Excel
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        exportToCSV(
                          attendanceLogs,
                          'Total_Attendance_All_Libraries.csv'
                        )
                      }
                      className="rounded bg-slate-700 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-slate-800"
                    >
                      CSV
                    </button>

                  </div>

                </div>

              </div>

            </div>

            {/* CHARTS */}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">

                <h3 className="mb-3 text-sm font-bold text-slate-800">
                  Visits & Borrows —
                  Last 7 Days
                </h3>

                <Line
                  data={{
                    labels:
                      trendData.labels,

                    datasets: [
                      {
                        label:
                          'Attendance',

                        data:
                          trendData.visitCounts,

                        borderColor:
                          '#2563eb',

                        backgroundColor:
                          '#2563eb',

                        tension: 0.3,
                      },

                      {
                        label:
                          'Books Borrowed',

                        data:
                          trendData.borrowCounts,

                        borderColor:
                          '#002046',

                        backgroundColor:
                          '#002046',

                        tension: 0.3,
                      },
                    ],
                  }}
                  options={{
                    responsive:
                      true,

                    plugins: {
                      legend: {
                        position:
                          'bottom',
                      },
                    },
                  }}
                />

              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">

                <h3 className="mb-3 text-sm font-bold text-slate-800">
                  Catalog by Category
                </h3>

                {categoryData
                  .labels
                  .length ===
                0 ? (
                  <p className="text-xs text-slate-500">
                    No books in the
                    catalog yet.
                  </p>
                ) : (
                  <Bar
                    data={{
                      labels:
                        categoryData.labels,

                      datasets: [
                        {
                          label:
                            'Titles',

                          data:
                            categoryData.values,

                          backgroundColor:
                            '#2563eb',
                        },
                      ],
                    }}
                    options={{
                      responsive:
                        true,

                      plugins: {
                        legend: {
                          display:
                            false,
                        },
                      },
                    }}
                  />
                )}

              </div>

            </div>

          </div>
        )}

        {/* ====================================================
            INVENTORY
        ==================================================== */}

        {section ===
          'inventory' && (
          <BookInventory />
        )}

        {/* ====================================================
            LIBRARIES & MAP
        ==================================================== */}

        {section === 'map' && (
          <div className="space-y-4">

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">

              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">

                <div>
                  <h2 className="text-lg font-bold text-slate-800">
                    Libraries & Map
                  </h2>

                  <p className="mt-1 text-xs text-slate-500">
                    Manage library branches
                    and their locations.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowAddLibrary(
                      (current) =>
                        !current
                    );

                    setLibraryMessage(
                      ''
                    );
                  }}
                  className="rounded-lg bg-[#002046] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#003568]"
                >
                  {showAddLibrary
                    ? 'Cancel'
                    : '+ Add Library'}
                </button>

              </div>

            </div>

            {libraryMessage && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-800">
                {libraryMessage}
              </div>
            )}

            {showAddLibrary && (
              <form
                onSubmit={
                  handleAddLibrary
                }
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              >

                <div className="mb-5">
                  <h3 className="text-sm font-bold text-slate-800">
                    Add New Library
                  </h3>

                  <p className="mt-1 text-xs text-slate-500">
                    Enter the library
                    information and map
                    coordinates.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">

                  {/* NAME */}

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Library Name *
                    </label>

                    <input
                      type="text"
                      value={
                        libraryForm.name
                      }
                      onChange={(
                        event
                      ) =>
                        setLibraryForm(
                          (
                            current
                          ) => ({
                            ...current,
                            name:
                              event
                                .target
                                .value,
                          })
                        )
                      }
                      placeholder="e.g. Tanauan City Public Library"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                      required
                    />
                  </div>

                  {/* CAMPUS */}

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Campus / Branch
                    </label>

                    <input
                      type="text"
                      value={
                        libraryForm.campus
                      }
                      onChange={(
                        event
                      ) =>
                        setLibraryForm(
                          (
                            current
                          ) => ({
                            ...current,
                            campus:
                              event
                                .target
                                .value,
                          })
                        )
                      }
                      placeholder="e.g. Tanauan City"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                    />
                  </div>

                  {/* ADDRESS */}

                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Address *
                    </label>

                    <input
                      type="text"
                      value={
                        libraryForm.address
                      }
                      onChange={(
                        event
                      ) =>
                        setLibraryForm(
                          (
                            current
                          ) => ({
                            ...current,
                            address:
                              event
                                .target
                                .value,
                          })
                        )
                      }
                      placeholder="Complete library address"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                      required
                    />
                  </div>

                  {/* LATITUDE */}

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Latitude *
                    </label>

                    <input
                      type="number"
                      step="any"
                      value={
                        libraryForm.lat
                      }
                      onChange={(
                        event
                      ) =>
                        setLibraryForm(
                          (
                            current
                          ) => ({
                            ...current,
                            lat:
                              event
                                .target
                                .value,
                          })
                        )
                      }
                      placeholder="14.085000"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                      required
                    />
                  </div>

                  {/* LONGITUDE */}

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Longitude *
                    </label>

                    <input
                      type="number"
                      step="any"
                      value={
                        libraryForm.lng
                      }
                      onChange={(
                        event
                      ) =>
                        setLibraryForm(
                          (
                            current
                          ) => ({
                            ...current,
                            lng:
                              event
                                .target
                                .value,
                          })
                        )
                      }
                      placeholder="121.149000"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                      required
                    />
                  </div>

                  {/* HOURS */}

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Operating Hours
                    </label>

                    <input
                      type="text"
                      value={
                        libraryForm.hours
                      }
                      onChange={(
                        event
                      ) =>
                        setLibraryForm(
                          (
                            current
                          ) => ({
                            ...current,
                            hours:
                              event
                                .target
                                .value,
                          })
                        )
                      }
                      placeholder="8:00 AM - 5:00 PM"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                    />
                  </div>

                  {/* STATUS */}

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Status
                    </label>

                    <select
                      value={
                        libraryForm.status
                      }
                      onChange={(
                        event
                      ) =>
                        setLibraryForm(
                          (
                            current
                          ) => ({
                            ...current,
                            status:
                              event
                                .target
                                .value,
                          })
                        )
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                    >
                      <option value="Open">
                        Open
                      </option>

                      <option value="Closed">
                        Closed
                      </option>
                    </select>
                  </div>

                </div>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row">

                  <button
                    type="button"
                    onClick={
                      useCurrentLocation
                    }
                    className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <MapPinned size={14} className="mr-1.5 inline-block align-[-2px]" aria-hidden="true" />
                    Use Current
                    Location
                  </button>

                  <button
                    type="submit"
                    disabled={
                      savingLibrary
                    }
                    className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {savingLibrary
                      ? 'Adding...'
                      : 'Add Library'}
                  </button>

                </div>

              </form>
            )}

            <LibraryMap />

          </div>
        )}

        {/* ====================================================
            STAFF ACCOUNTS
        ==================================================== */}

        {section ===
          'accounts' && (
          <div className="space-y-6">

            {/* HEADER */}

            <div>
              <h2 className="text-lg font-bold text-slate-800">
                Staff Accounts
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Manage database-backed
                sub-admin and circulation
                staff accounts.
              </p>
            </div>

            {/* ERROR */}

            {staffError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {staffError}
              </div>
            )}

            {/* SUCCESS */}

            {staffMessage && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {staffMessage}
              </div>
            )}

            {/* CREATE ACCOUNT */}

            <form
              onSubmit={
                handleCreateStaff
              }
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >

              <div className="mb-5">
                <h3 className="text-sm font-bold text-slate-800">
                  Create Sub-Admin
                  Account
                </h3>

                <p className="mt-1 text-xs text-slate-500">
                  Creates a Supabase Auth
                  account and the
                  corresponding
                  staff_profiles record.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">

                {/* FULL NAME */}

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    Full Name
                  </label>

                  <input
                    type="text"
                    value={
                      staffForm.fullName
                    }
                    onChange={(
                      event
                    ) =>
                      setStaffForm(
                        (
                          current
                        ) => ({
                          ...current,
                          fullName:
                            event
                              .target
                              .value,
                        })
                      )
                    }
                    placeholder="e.g. Juan Dela Cruz"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                    required
                  />
                </div>

                {/* EMAIL */}

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    Email
                  </label>

                  <input
                    type="email"
                    value={
                      staffForm.email
                    }
                    onChange={(
                      event
                    ) =>
                      setStaffForm(
                        (
                          current
                        ) => ({
                          ...current,
                          email:
                            event
                              .target
                              .value,
                        })
                      )
                    }
                    placeholder="staff@shelf.edu"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                    required
                  />
                </div>

                {/* PASSWORD */}

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    Temporary Password
                  </label>

                  <input
                    type="password"
                    value={
                      staffForm.password
                    }
                    onChange={(
                      event
                    ) =>
                      setStaffForm(
                        (
                          current
                        ) => ({
                          ...current,
                          password:
                            event
                              .target
                              .value,
                        })
                      )
                    }
                    placeholder="Minimum 10 characters"
                    minLength={10}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                    required
                  />

                  <p className="mt-1 text-[11px] text-slate-400">
                    Passwords are handled by
                    Supabase Auth.
                  </p>
                </div>

                {/* BRANCH */}

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    Assigned Branch
                  </label>

                  <select
                    value={
                      staffForm.libraryId
                    }
                    onChange={(
                      event
                    ) =>
                      setStaffForm(
                        (
                          current
                        ) => ({
                          ...current,
                          libraryId:
                            event
                              .target
                              .value,
                        })
                      )
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                    required
                  >
                    <option value="">
                      Select a library
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
                </div>

              </div>

              <div className="mt-5">

                <button
                  type="submit"
                  disabled={
                    staffLoading
                  }
                  className="rounded-lg bg-[#002046] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#003568] disabled:opacity-50"
                >
                  {staffLoading
                    ? 'Creating Account...'
                    : 'Create Sub-Admin'}
                </button>

              </div>

            </form>

            {/* STAFF TABLE */}

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">

              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">

                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    Registered Staff
                    Accounts
                  </h3>

                  <p className="mt-1 text-xs text-slate-500">
                    Records are loaded
                    directly from
                    staff_profiles.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={
                    loadStaffAccounts
                  }
                  disabled={
                    staffLoading
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {staffLoading
                    ? 'Loading...'
                    : 'Refresh'}
                </button>

              </div>

              <div className="overflow-x-auto">

                <table className="w-full min-w-[900px] text-left text-sm">

                  <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">

                    <tr>
                      <th className="p-3">
                        Name
                      </th>

                      <th className="p-3">
                        Email
                      </th>

                      <th className="p-3">
                        Role
                      </th>

                      <th className="p-3">
                        Assigned Branch
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

                    {staffAccounts.map(
                      (staff) => (
                        <tr
                          key={
                            staff.id
                          }
                          className="hover:bg-slate-50"
                        >

                          <td className="p-3 font-semibold text-slate-700">
                            {
                              staff.full_name
                            }
                          </td>

                          <td className="p-3 text-xs font-mono text-slate-500">
                            {
                              staff.email
                            }
                          </td>

                          <td className="p-3">

                            <span
                              className={`inline-flex rounded-full px-2 py-1 text-[11px] font-bold ${
                                staff.role ===
                                'superadmin'
                                  ? 'bg-purple-100 text-purple-800'
                                  : staff.role ===
                                    'subadmin'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {formatStaffRole(
                                staff.role
                              )}
                            </span>

                          </td>

                          <td className="p-3 text-xs text-slate-500">
                            {getLibraryName(
                              libraries,
                              staff.library_id
                            )}
                          </td>

                          <td className="p-3">

                            <span
                              className={`inline-flex rounded-full px-2 py-1 text-[11px] font-bold ${
                                staff.is_active
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {staff.is_active
                                ? 'Active'
                                : 'Disabled'}
                            </span>

                          </td>

                          <td className="p-3">

                            {staff.role ===
                            'superadmin' ? (
                              <span className="text-xs font-semibold text-slate-400">
                                Protected
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  handleToggleStaff(
                                    staff
                                  )
                                }
                                disabled={
                                  staffLoading
                                }
                                className={`text-xs font-bold disabled:opacity-50 ${
                                  staff.is_active
                                    ? 'text-red-600 hover:text-red-800'
                                    : 'text-emerald-600 hover:text-emerald-800'
                                }`}
                              >
                                {staff.is_active
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

              </div>

              {!staffLoading &&
                staffAccounts.length ===
                  0 && (
                  <div className="p-8 text-center text-sm text-slate-500">
                    No staff accounts
                    were found in
                    staff_profiles.
                  </div>
                )}

            </div>

          </div>
        )}

        {/* ====================================================
            REPORTS & SERVICES
        ==================================================== */}

        {section ===
          'workspace' && (
          <AdminWorkspace
            user={user}
            libraries={libraries}
            books={books}
            visitors={visitors}
            borrowRequests={
              borrowRequests
            }
            attendanceLogs={
              attendanceLogs
            }
          />
        )}

      </main>

    </div>
  );
}
