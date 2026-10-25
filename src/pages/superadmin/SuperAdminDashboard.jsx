import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Bar,
  Line,
} from 'react-chartjs-2';
import LocationPickerMap from '../../component/LocationPickerMap.jsx';
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
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Globe,
  MapPinned,
  MessageSquare,
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
import { sendDueDateFollowUp } from '../../lib/dueDateFollowUp.js';
import {
  exportReport,
  parseImportFile,
} from '../../lib/excelUtils.js';
import {
  buildAssetAllocationAnalytics,
  buildAssetAllocationRows,
  buildMasterCatalogAnalytics,
  buildMasterCatalogRows,
} from '../../lib/inventoryReportUtils.js';
import {
  buildAttendanceRows,
  buildAttendanceSummary,
  buildSystemAttendanceAnalytics,
} from '../../lib/attendanceReportUtils.js';

const VisitorAccountManagement = lazy(
  () => import('../../component/VisitorAccountManagement.jsx')
);

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
  const mainScrollRef = useRef(null);
  const {
    user,
    logout,
  } = useAuth();
  const superAdminName =
    user?.role === 'superadmin'
      ? 'Jeffrey Castillo'
      : user?.name || 'System Super Administrator';

  const handleSuperAdminLogout = async () => {
    mainScrollRef.current?.scrollTo({
      top: 0,
      left: 0,
      behavior: 'instant',
    });
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: 'instant',
    });
    await logout();
  };

  const {
    addLibrary,
    updateLibrary,
    deleteLibrary,
  } = useLibrary();

  const {
    books,
    visitors,
    borrowRequests,
    attendanceLogs,
    libraries,
  } = useLibraryData();

  const [section, setSection] = useState('overview');
  const [activeTab, setActiveTab] = useState('reports');
  const [focusedNotificationRequestId, setFocusedNotificationRequestId] = useState(null);
  const [focusedNotificationType, setFocusedNotificationType] = useState(null);
  const [notificationFocusVersion, setNotificationFocusVersion] = useState(0);
  const [exportingReport, setExportingReport] = useState('');
  const [exportMessage, setExportMessage] = useState('');
  const [exportError, setExportError] = useState('');

  const exportSystemReport = async (report, format) => {
    const reportKey = `${report}-${format}`;
    setExportingReport(reportKey);
    setExportMessage('');
    setExportError('');
    try {
      const isCatalog = report === 'books' || report === 'catalog';
      const isAllocation = report === 'allocation';
      const isInventory = isCatalog || isAllocation;
      const isAttendance = report === 'attendance';
      const data = isCatalog
        ? buildMasterCatalogRows(books)
        : isAllocation
          ? buildAssetAllocationRows(books)
          : buildAttendanceRows(attendanceLogs);
      const reportOptions = {
        reportType: isCatalog ? 'Master-Library-Catalog' : isAllocation ? 'Multi-Branch-Asset-Allocation' : 'System-Wide-Multi-Branch-Attendance-Audit',
        title: isCatalog ? 'Master Library Catalog Report' : isAllocation ? 'Multi-Branch Asset Allocation Report' : 'SHELF Visitor Attendance Summary',
        detailSheetName: isCatalog ? 'Books' : isAllocation ? 'Allocation' : 'Attendance',
        libraryName: 'All Libraries',
        libraries,
        generatedBy: `${user?.name || superAdminName} (Super Admin)`,
        startDate: new Date(),
        endDate: new Date(),
        asOf: isInventory,
        ...(isAttendance ? { dateRange: 'All available dates' } : {}),
        summary: [[isInventory ? 'Total Titles' : 'Total Visits', data.length]],
        ...(isInventory ? {
          orientation: 'landscape',
          pdfFontSize: 10,
          preserveLibraryIds: true,
          pdfAnalytics: isCatalog
            ? buildMasterCatalogAnalytics(data)
            : buildAssetAllocationAnalytics(data, libraries),
          csvReportType: isCatalog ? 'Master-Library-Catalog-Report' : 'Multi-Branch-Asset-Allocation-Report',
          csvRole: 'Super-Admin',
          columns: isCatalog ? [
            { key: 'id', label: 'Book ID' },
            { key: 'title', label: 'Title' },
            { key: 'author', label: 'Author' },
            { key: 'isbn', label: 'ISBN' },
            { key: 'category', label: 'Category' },
            { key: 'libraryId', label: 'Library Branch ID' },
            { key: 'totalCopies', label: 'Total Copies', type: 'number' },
            { key: 'availableCopies', label: 'Available Copies', type: 'number' },
            { key: 'createdAt', label: 'Created Date', type: 'date', dateFormat: 'iso' },
            { key: 'updatedAt', label: 'Last Updated', type: 'date', dateFormat: 'iso' },
          ] : [
            { key: 'id', label: 'Book ID' },
            { key: 'title', label: 'Title' },
            { key: 'author', label: 'Author' },
            { key: 'libraryId', label: 'Library Branch ID' },
            { key: 'totalCopies', label: 'Total Copies', type: 'number' },
            { key: 'availableCopies', label: 'Available Copies', type: 'number' },
            { key: 'borrowedCopies', label: 'Borrowed Copies', type: 'number' },
            { key: 'utilizationRate', label: 'Utilization Rate %', type: 'number' },
            { key: 'createdAt', label: 'Acquisition Date', type: 'date', dateFormat: 'iso' },
          ],
        } : isAttendance ? {
          detailSheetName: 'Attendance Raw Data',
          attendanceReport: true,
          attendanceSummary: buildAttendanceSummary(data),
          attendanceTotal: data.length,
          attendanceCompleted: data.filter((row) => row.sessionStatus === 'Completed').length,
          attendanceActive: data.filter((row) => row.sessionStatus !== 'Completed').length,
          orientation: 'landscape',
          pdfFontSize: 10,
          pdfAnalytics: buildSystemAttendanceAnalytics(data),
          pdfRoleBadge: 'SUPER-ADMIN',
          csvReportType: 'Visitor-Attendance',
          csvRole: 'Super-Admin',
          preserveLibraryIds: true,
          columns: [
            { key: 'id', label: 'Session ID' },
            { key: 'visitorId', label: 'Visitor ID' },
            { key: 'visitorName', label: 'Visitor Name' },
            { key: 'libraryId', label: 'Library Branch ID' },
            { key: 'timeIn', label: 'Time In', type: 'date', dateFormat: 'attendance' },
            { key: 'checkedOutAt', label: 'Time Out', type: 'date', dateFormat: 'attendance', missingValue: 'Still Inside' },
            { key: 'duration', label: 'Visit Duration' },
            { key: 'sessionStatus', label: 'Status' },
          ],
        } : {}),
      };
      await exportReport(data, format, reportOptions);
      setExportMessage('Report exported successfully.');
    } catch {
      setExportError('The report could not be exported. Please try again.');
    } finally {
      setExportingReport('');
    }
  };

  // Sidebar Collapsible States
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [communicationOpen, setCommunicationOpen] = useState(true);

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
  // ADD LIBRARY & MAP STATE
  // ============================================================
  const [
    showAddLibrary,
    setShowAddLibrary,
  ] = useState(false);

  const [editingLibraryId, setEditingLibraryId] = useState(null);

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
    emailDomain: '',
    lat: '14.085000',
    lng: '121.149000',
    hours: '8:00 AM - 5:00 PM',
    status: 'Open',
  });
  const [mapPosition, setMapPosition] = useState([14.0850, 121.1490]);

  const handleCoordinateChange = (lat, lng) => {
    setLibraryForm((previous) => ({
      ...previous,
      lat: String(lat),
      lng: String(lng),
    }));
  };

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

  const [editingStaffId, setEditingStaffId] = useState(null);

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

const handleCreateStaff = async (event) => {
  event.preventDefault();

  if (!supabase) {
    setStaffError('Supabase is not configured.');
    return;
  }

  setStaffError('');
  setStaffMessage('');

  const fullName = staffForm.fullName.trim();
  const email = staffForm.email.trim().toLowerCase();
  const password = staffForm.password;
  const libraryId = staffForm.libraryId;
  const isEditing = Boolean(editingStaffId);

  if (!fullName || !email || !libraryId) {
    setStaffError(
      'Please complete the name, email, and assigned library fields.'
    );
    return;
  }

  if (!isEditing && !password) {
    setStaffError('Password is required for a new account.');
    return;
  }

  if (password && password.length < 10) {
    setStaffError('Password must contain at least 10 characters.');
    return;
  }

  try {
    setStaffLoading(true);

    const { data, error } = await supabase.functions.invoke(
      'manage-staff',
      {
        body: isEditing
          ? {
              operation: 'update',
              userId: editingStaffId,
              fullName,
              email,
              libraryId,
              password,
            }
          : {
              operation: 'create',
              email,
              fullName,
              password,
              libraryId,
              role: 'subadmin',
            },
      }
    );

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    setStaffForm({
      fullName: '',
      email: '',
      password: '',
      libraryId: '',
    });

    setEditingStaffId(null);

    await loadStaffAccounts();

    setStaffMessage(
      isEditing
        ? 'Sub-admin account updated successfully.'
        : 'Sub-admin account created successfully.'
    );
  } catch (error) {
    console.error('Save staff account error:', error);
    setStaffError(
      error.message || 'Unable to save staff account.'
    );
  } finally {
    setStaffLoading(false);
  }
};

  // ============================================================
  // ENABLE / DISABLE STAFF
  // ============================================================


const handleToggleStaff = async (staff) => {
  if (staff.role === 'superadmin') {
    setStaffError('Super-admin accounts are protected.');
    return;
  }

  const nextIsActive = !staff.is_active;
  const action = nextIsActive ? 'enable' : 'disable';

  const confirmed = window.confirm(
    `Are you sure you want to ${action} ${staff.full_name}'s account?`
  );

  if (!confirmed) return;

  try {
    setStaffLoading(true);
    setStaffError('');
    setStaffMessage('');

    const { data, error } = await supabase.functions.invoke(
      'manage-staff',
      {
        body: {
          operation: 'set-active',
          userId: staff.id,
          isActive: nextIsActive,
        },
      }
    );

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    await loadStaffAccounts();

    setStaffMessage(
      `Sub-admin account ${nextIsActive ? 'enabled' : 'disabled'} successfully.`
    );
  } catch (error) {
    console.error('Toggle staff account error:', error);
    setStaffError(
      error.message || 'Unable to update the sub-admin account status.'
    );
  } finally {
    setStaffLoading(false);
  }
};

  // EDIT SUB-ADMIN ACCOUNT

const handleEditStaff = (staff) => {
  setEditingStaffId(staff.id);

  setStaffForm({
    fullName: staff.full_name || '',
    email: staff.email || '',
    password: '',
    libraryId: staff.library_id || '',
  });

  setStaffError('');
  setStaffMessage(
    `Editing ${staff.full_name}. Update the fields and save your changes.`
  );
};

  // DELETE SUB-ADMIN ACCOUNT
  const handleDeleteStaff = async (staff) => {
    if (staff.role === 'superadmin') {
      setStaffError('Super-admin accounts are protected.');
      return;
    }

    const confirmed = window.confirm(
      `Permanently delete the Sub-admin account for ${staff.full_name}?`
    );

    if (!confirmed) return;

    try {
      setStaffLoading(true);
      setStaffError('');
      setStaffMessage('');

      const { data, error } = await supabase.functions.invoke(
        'manage-staff',
        {
          body: {
            operation: 'delete',
            userId: staff.id,
          },
        }
      );

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      await loadStaffAccounts();
      setStaffMessage('Sub-admin account deleted successfully.');
    } catch (error) {
      console.error('Delete staff account error:', error);
      setStaffError(
        error.message || 'Unable to delete staff account.'
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
          const latitude = position.coords.latitude;
          const longitude = position.coords.longitude;
          setMapPosition([latitude, longitude]);
          handleCoordinateChange(latitude.toFixed(6), longitude.toFixed(6));
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
            'Unable to get your location. Please select on the map.'
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
          'Please enter the library name, address, and pin exact location on the map.'
        );
        return;
      }
      try {
        setSavingLibrary(true);
        setLibraryMessage('');

        const formattedDomain = libraryForm.emailDomain ? libraryForm.emailDomain.toLowerCase().trim() : null;
        const payload = {
          name: libraryForm.name.trim(),
          campus: libraryForm.campus.trim(),
          address: libraryForm.address.trim(),
          email_domain: formattedDomain,
          emailDomain: formattedDomain,
          lat: libraryForm.lat,
          lng: libraryForm.lng,
          hours: libraryForm.hours,
          status: libraryForm.status,
        };

        await addLibrary(payload);

        const { error: directInsertError } = await supabase
          .from('libraries')
          .update({ email_domain: formattedDomain })
          .eq('name', libraryForm.name.trim());

        if (directInsertError) {
          console.warn('Direct domain update notice:', directInsertError.message);
        }

        setLibraryMessage(
          'Library added successfully.'
        );
        setLibraryForm({
          name: '',
          campus: '',
          address: '',
          emailDomain: '',
          lat: '14.085000',
          lng: '121.149000',
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
  // EDIT LIBRARY
  // ============================================================
  const handleEditLibrary = async (event) => {
    event.preventDefault();

    if (
      !editingLibraryId ||
      !libraryForm.name.trim() ||
      !libraryForm.address.trim() ||
      !libraryForm.lat ||
      !libraryForm.lng
    ) {
      setLibraryMessage(
        'Please enter the library name, address, and exact map coordinates.'
      );
      return;
    }

    try {
      setSavingLibrary(true);
      setLibraryMessage('');

      const formattedDomain = libraryForm.emailDomain
        ? libraryForm.emailDomain.toLowerCase().trim()
        : null;

      await updateLibrary(editingLibraryId, {
        name: libraryForm.name.trim(),
        campus: libraryForm.campus.trim(),
        address: libraryForm.address.trim(),
        email_domain: formattedDomain,
        lat: libraryForm.lat,
        lng: libraryForm.lng,
        hours: libraryForm.hours,
        status: libraryForm.status,
      });

      setLibraryMessage('Library updated successfully.');
      setEditingLibraryId(null);
      setShowAddLibrary(false);
      setLibraryForm({
        name: '',
        campus: '',
        address: '',
        emailDomain: '',
        lat: '14.085000',
        lng: '121.149000',
        hours: '8:00 AM - 5:00 PM',
        status: 'Open',
      });
    } catch (error) {
      console.error('Update library error:', error);
      setLibraryMessage(error.message || 'Failed to update library.');
    } finally {
      setSavingLibrary(false);
    }
  };


  // ============================================================
  // OPEN LIBRARY FOR EDITING
  // ============================================================
  const startEditLibrary = (library) => {
    setEditingLibraryId(library.id);

    setLibraryForm({
      name: library.name || '',
      campus: library.campus || '',
      address: library.address || '',
      emailDomain: library.email_domain || library.emailDomain || '',
      lat: String(library.lat ?? ''),
      lng: String(library.lng ?? ''),
      hours: library.hours || '8:00 AM - 5:00 PM',
      status: library.status || 'Open',
    });

    setMapPosition([
      Number(library.lat) || 14.085,
      Number(library.lng) || 121.149,
    ]);

    setLibraryMessage('');
    setShowAddLibrary(true);
  };


  // ============================================================
  // DELETE LIBRARY
  // ============================================================
  const handleDeleteLibrary = async (library) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${library.name}"? This action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      setLibraryMessage('');
      await deleteLibrary(library.id);
      setLibraryMessage('Library deleted successfully.');
    } catch (error) {
      console.error('Delete library error:', error);
      setLibraryMessage(
        error.message || 'Failed to delete library.'
      );
    }
  };

  // ============================================================
  // DASHBOARD DATA
  // ============================================================
  const [notificationNow, setNotificationNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNotificationNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const superAdminNotifications = useMemo(() => {
    const now = notificationNow;
    const todayDateKey = new Date(now).toISOString().slice(0, 10);
    const notifications = [];

    borrowRequests.forEach((request) => {
      const bookTitle = request.bookTitle || 'Untitled book';
      const visitorName = request.visitorName || 'Visitor';
      const status = String(request.status || '').toLowerCase();
      const requestDate = new Date(request.requestDate || request.request_date).getTime();
      const dueDate = new Date(request.dueDate || request.due_date).getTime();
      const pickupDeadline = new Date(request.pickupDeadline || request.pickup_deadline).getTime();
      const dueDateKey = Number.isFinite(dueDate)
        ? new Date(dueDate).toISOString().slice(0, 10)
        : '';

      if (
        ['queued', 'pending'].includes(status) &&
        Number.isFinite(requestDate) &&
        requestDate <= now &&
        requestDate >= now - 24 * 60 * 60 * 1000
      ) {
        notifications.push({
          id: `request-${request.id}`,
          requestId: request.id,
          recordId: request.id,
          type: 'reservation',
          targetSection: 'workspace',
          targetTab: 'reports',
          status: 'Pending',
          title: 'New reservation request',
          message: `${visitorName} — ${bookTitle}`,
          timeLabel: `Requested ${new Date(requestDate).toLocaleString()}`,
          timestamp: requestDate,
        });
      }

      if (
        status === 'borrowed' &&
        Number.isFinite(dueDate) &&
        dueDateKey < todayDateKey
      ) {
        notifications.push({
          id: `overdue-${request.id}`,
          requestId: request.id,
          recordId: request.id,
          type: 'overdue',
          targetSection: 'workspace',
          targetTab: 'reports',
          followUp: true,
          title: 'Overdue book',
          message: `${bookTitle} — ${visitorName}`,
          timeLabel: `Due ${new Date(dueDate).toLocaleString()}`,
          timestamp: dueDate,
        });
      }

      if (
        status === 'ready_for_pickup' &&
        Number.isFinite(pickupDeadline) &&
        pickupDeadline >= now &&
        pickupDeadline <= now + 24 * 60 * 60 * 1000
      ) {
        notifications.push({
          id: `pickup-${request.id}`,
          requestId: request.id,
          recordId: request.id,
          type: 'pickup',
          targetSection: 'workspace',
          targetTab: 'reports',
          status: 'Pending',
          title: 'Pickup deadline approaching',
          message: `${bookTitle} for ${visitorName}`,
          timeLabel: `Deadline ${new Date(pickupDeadline).toLocaleString()}`,
          timestamp: pickupDeadline,
        });
      }
    });

    return notifications
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, 20);
  }, [borrowRequests, notificationNow]);

  const handleOverdueFollowUp = async (notification) => {
    await sendDueDateFollowUp(notification.requestId);
  };

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
    <div className="superadmin-dashboard flex h-screen overflow-hidden bg-shelf-bg text-slate-800">
      {/* SIDEBAR */}
      <aside className="fixed inset-y-0 left-0 z-40 flex h-screen w-60 shrink-0 flex-col overflow-y-auto bg-shelf-primary text-white">
        <div className="border-b border-white/10 p-5">
          <p className="font-extrabold tracking-wider">
            SHELF ILMS
          </p>
          <p className="mt-1 text-xs text-slate-300">
            Super-Admin Console
          </p>
        </div>

        {/* NAVIGATION */}
        <nav className="flex-1 space-y-1 p-3">
          {/* OVERVIEW */}
          <button
            type="button"
            onClick={() => {
              setSection('overview');
              setStaffError('');
              setStaffMessage('');
            }}
            className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition ${
              section === 'overview'
                ? 'bg-white/15 font-bold text-amber-300 shadow-[inset_3px_0_0_0_#f59e0b]'
                : 'text-slate-300 hover:bg-white/5'
            }`}
          >
            <Activity size={18} className="mr-3 inline-block align-[-3px]" />
            Overview & Analytics
          </button>

          {/* INVENTORY */}
          <button
            type="button"
            onClick={() => {
              setSection('inventory');
              setStaffError('');
              setStaffMessage('');
            }}
            className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition ${
              section === 'inventory'
                ? 'bg-white/15 font-bold text-amber-300 shadow-[inset_3px_0_0_0_#f59e0b]'
                : 'text-slate-300 hover:bg-white/5'
            }`}
          >
            <BookOpen size={18} className="mr-3 inline-block align-[-3px]" />
            Inventory
          </button>

          {/* LIBRARIES & MAP */}
          <button
            type="button"
            onClick={() => {
              setSection('map');
              setStaffError('');
              setStaffMessage('');
            }}
            className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition ${
              section === 'map'
                ? 'bg-white/15 font-bold text-amber-300 shadow-[inset_3px_0_0_0_#f59e0b]'
                : 'text-slate-300 hover:bg-white/5'
            }`}
          >
            <MapPinned size={18} className="mr-3 inline-block align-[-3px]" />
            Libraries & Map
          </button>

          {/* STAFF ACCOUNTS */}
          <button
            type="button"
            onClick={() => {
              setSection('accounts');
              setStaffError('');
              setStaffMessage('');
            }}
            className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition ${
              section === 'accounts'
                ? 'bg-white/15 font-bold text-amber-300 shadow-[inset_3px_0_0_0_#f59e0b]'
                : 'text-slate-300 hover:bg-white/5'
            }`}
          >
            <ShieldCheck size={18} className="mr-3 inline-block align-[-3px]" />
            Staff Accounts
          </button>

          <button
            type="button"
            onClick={() => {
              setSection('visitor-accounts');
              setStaffError('');
              setStaffMessage('');
            }}
            className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition ${
              section === 'visitor-accounts'
                ? 'bg-white/15 font-bold text-amber-300 shadow-[inset_3px_0_0_0_#f59e0b]'
                : 'text-slate-300 hover:bg-white/5'
            }`}
          >
            <UsersRound size={18} className="mr-3 inline-block align-[-3px]" />
            Visitor Accounts
          </button>

          {/* REPORTS & SERVICES COLLAPSIBLE */}
          <div>
            <button
              type="button"
              onClick={() => setWorkspaceOpen((prev) => !prev)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition ${
                section === 'workspace'
                  ? 'bg-white/15 font-bold text-amber-300 shadow-[inset_3px_0_0_0_#f59e0b]'
                  : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              <span className="flex items-center gap-3">
                <FileSpreadsheet size={18} />
                Reports & Services
              </span>
              {workspaceOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {workspaceOpen && (
              <div className="ml-5 mt-1 space-y-1 border-l border-white/20 pl-3">
                <button
                  type="button"
                  onClick={() => {
                    setSection('workspace');
                    setActiveTab('reports');
                  }}
                  className={`w-full rounded-md px-3 py-1.5 text-left text-xs transition ${
                    section === 'workspace' && activeTab === 'reports'
                      ? 'font-bold text-amber-300 bg-white/10'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Reports
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSection('workspace');
                    setActiveTab('analytics');
                  }}
                  className={`w-full rounded-md px-3 py-1.5 text-left text-xs transition ${
                    section === 'workspace' && activeTab === 'analytics'
                      ? 'font-bold text-amber-300 bg-white/10'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Analytics
                </button>
              </div>
            )}
          </div>

          {/* COMMUNICATION COLLAPSIBLE */}
          <div>
            <button
              type="button"
              onClick={() => setCommunicationOpen((prev) => !prev)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition ${
                section === 'communication'
                  ? 'bg-white/15 font-bold text-amber-300 shadow-[inset_3px_0_0_0_#f59e0b]'
                  : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              <span className="flex items-center gap-3">
                <MessageSquare size={18} />
                Communication
              </span>
              {communicationOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {communicationOpen && (
              <div className="ml-5 mt-1 space-y-1 border-l border-white/20 pl-3">
                <button
                  type="button"
                  onClick={() => {
                    setSection('communication');
                    setActiveTab('feedback');
                  }}
                  className={`w-full rounded-md px-3 py-1.5 text-left text-xs transition ${
                    section === 'communication' && activeTab === 'feedback'
                      ? 'font-bold text-amber-300 bg-white/10'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Feedback
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSection('communication');
                    setActiveTab('announcements');
                  }}
                  className={`w-full rounded-md px-3 py-1.5 text-left text-xs transition ${
                    section === 'communication' && activeTab === 'announcements'
                      ? 'font-bold text-amber-300 bg-white/10'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Announcements
                </button>
              </div>
            )}
          </div>
        </nav>

        <div className="space-y-2 border-t border-white/10 p-4">
          <p className="text-xs text-slate-300">
            Signed in as
          </p>
          <p className="text-sm font-bold">
            {superAdminName}
          </p>
          <p className="text-xs font-semibold text-amber-300">
            Super Admin
          </p>
          <button
            type="button"
            onClick={handleSuperAdminLogout}
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs transition hover:bg-white/20"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main
        ref={mainScrollRef}
        className="ml-60 min-w-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6 lg:p-8"
      >
        <DashboardWelcome
          name={superAdminName.split(' ')[0]}
          description="System metrics, library operations, staff accounts, and reports at a glance."
          notifications={superAdminNotifications}
          onNotificationFollowUp={handleOverdueFollowUp}
          onNotificationClick={(notification) => {
            setFocusedNotificationRequestId(
              notification.recordId || notification.requestId
            );
            setFocusedNotificationType(notification.type);
            setNotificationFocusVersion((version) => version + 1);
            setSection(notification.targetSection);
            setActiveTab(notification.targetTab);
          }}
          actions={[
            { label: 'View Inventory', Icon: BookOpen, onClick: () => setSection('inventory') },
            { label: 'Manage Staff', Icon: ShieldCheck, onClick: () => setSection('accounts') },
            { label: 'Open Reports', Icon: FileSpreadsheet, onClick: () => { setSection('workspace'); setActiveTab('reports'); } },
          ]}
        />

        {/* OVERVIEW */}
        {section === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <StatCard label="Registered Visitors" value={visitors.length} tone="blue" />
              <StatCard label="Titles in Catalog" value={books.length} />
              <StatCard label="Active Borrows" value={activeBorrows} />
              <StatCard label="Overdue Items" value={overdue} tone="red" />
              <StatCard label="Branches Open" value={`${openLibraries}/${libraries.length}`} tone="amber" />
            </div>

            {/* DATA MANAGEMENT */}
            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col justify-between gap-2 border-b border-slate-100 pb-3 md:flex-row md:items-center">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Data Management & Reports</h3>
                  <p className="mt-0.5 text-xs text-slate-500">Export system records or import new entries into the database.</p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={importTarget}
                    onChange={(event) => setImportTarget(event.target.value)}
                    className="rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-2 text-xs font-semibold text-slate-700"
                  >
                    <option value="books">Import to Books Table</option>
                    <option value="attendance_logs">Import to Attendance Logs</option>
                  </select>
                  <label className="cursor-pointer rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-blue-700">
                    <Upload size={14} className="mr-1.5 inline-block align-[-2px]" aria-hidden="true" />
                    Import File
                    <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 pt-1 sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 p-3.5">
                  <div>
                    <p className="text-xs font-bold text-slate-700">
                      <BookOpen size={14} className="mr-1.5 inline-block align-[-2px]" aria-hidden="true" />
                       Master Library Catalog
                    </p>
                    <p className="text-[11px] text-slate-500">Total Titles: {books.length}</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" disabled={Boolean(exportingReport)} onClick={() => exportSystemReport('books', 'xlsx')} className="rounded bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-emerald-700">{exportingReport === 'books-xlsx' ? 'Exporting…' : 'Excel'}</button>
                    <button type="button" disabled={Boolean(exportingReport)} onClick={() => exportSystemReport('books', 'csv')} className="rounded bg-slate-700 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-slate-800">{exportingReport === 'books-csv' ? 'Exporting…' : 'CSV'}</button>
                    <button type="button" disabled={Boolean(exportingReport)} onClick={() => exportSystemReport('books', 'pdf')} className="rounded bg-rose-700 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-rose-800">{exportingReport === 'books-pdf' ? 'Exporting…' : 'PDF'}</button>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 p-3.5">
                  <div>
                    <p className="text-xs font-bold text-slate-700"><Building2 size={14} className="mr-1.5 inline-block align-[-2px]" aria-hidden="true" />Multi-Branch Asset Allocation</p>
                    <p className="text-[11px] text-slate-500">Institutional stock by branch</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" disabled={Boolean(exportingReport)} onClick={() => exportSystemReport('allocation', 'xlsx')} className="rounded bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-emerald-700">Excel</button>
                    <button type="button" disabled={Boolean(exportingReport)} onClick={() => exportSystemReport('allocation', 'csv')} className="rounded bg-slate-700 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-slate-800">CSV</button>
                    <button type="button" disabled={Boolean(exportingReport)} onClick={() => exportSystemReport('allocation', 'pdf')} className="rounded bg-rose-700 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-rose-800">PDF</button>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 p-3.5">
                  <div>
                    <p className="text-xs font-bold text-slate-700">
                      <Activity size={14} className="mr-1.5 inline-block align-[-2px]" aria-hidden="true" />
                      Total Attendance
                    </p>
                    <p className="text-[11px] text-slate-500">Total Visits: {attendanceLogs.length}</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" disabled={Boolean(exportingReport)} onClick={() => exportSystemReport('attendance', 'xlsx')} className="rounded bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-emerald-700">{exportingReport === 'attendance-xlsx' ? 'Exporting…' : 'Excel'}</button>
                    <button type="button" disabled={Boolean(exportingReport)} onClick={() => exportSystemReport('attendance', 'csv')} className="rounded bg-slate-700 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-slate-800">{exportingReport === 'attendance-csv' ? 'Exporting…' : 'CSV'}</button>
                    <button type="button" disabled={Boolean(exportingReport)} onClick={() => exportSystemReport('attendance', 'pdf')} className="rounded bg-rose-700 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-rose-800">{exportingReport === 'attendance-pdf' ? 'Exporting…' : 'PDF'}</button>
                  </div>
                </div>
              </div>
              {exportMessage && <p role="status" className="mt-3 text-sm text-emerald-700">{exportMessage}</p>}
              {exportError && <p role="alert" className="mt-3 text-sm text-rose-700">{exportError}</p>}
            </div>

            {/* CHARTS */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-sm font-bold text-slate-800">Visits & Borrows — Last 7 Days</h3>
                <Line
                  data={{
                    labels: trendData.labels,
                    datasets: [
                      { label: 'Attendance', data: trendData.visitCounts, borderColor: '#2563eb', backgroundColor: '#2563eb', tension: 0.3 },
                      { label: 'Books Borrowed', data: trendData.borrowCounts, borderColor: '#002046', backgroundColor: '#002046', tension: 0.3 },
                    ],
                  }}
                  options={{ responsive: true, plugins: { legend: { position: 'bottom' } } }}
                />
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-sm font-bold text-slate-800">Catalog by Category</h3>
                {categoryData.labels.length === 0 ? (
                  <p className="text-xs text-slate-500">No books in the catalog yet.</p>
                ) : (
                  <Bar
                    data={{
                      labels: categoryData.labels,
                      datasets: [{ label: 'Titles', data: categoryData.values, backgroundColor: '#2563eb' }],
                    }}
                    options={{ responsive: true, plugins: { legend: { display: false } } }}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {/* INVENTORY */}
        {section === 'inventory' && <BookInventory />}

        {/* LIBRARIES & MAP */}
        {section === 'map' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Libraries & Map</h2>
                  <p className="mt-1 text-xs text-slate-500">Manage library branches and their locations.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddLibrary((current) => !current);
                    setLibraryMessage('');
                  }}
                  className="rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#003568]"
                >
                  {showAddLibrary ? 'Cancel' : '+ Add Library'}
                </button>
              </div>
            </div>

            {libraryMessage && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-800">
                {libraryMessage}
              </div>
            )}

            {/* MODAL OVERLAY FOR ADD LIBRARY */}
            {showAddLibrary && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
                <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
                  {/* MODAL HEADER */}
                  <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <h3 className="text-base font-bold text-slate-800">
                        {editingLibraryId ? 'Edit Library' : 'Add New Library'}
                      </h3>
                      <p className="text-xs text-slate-500">
                        Enter library info and pin exact location on map.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAddLibrary(false)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
                    >
                      ✕
                    </button>
                  </div>

                  {/* FORM */}
                  <form onSubmit={editingLibraryId ? handleEditLibrary : handleAddLibrary}>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {/* NAME */}
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">
                          Library Name *
                        </label>
                        <input
                          type="text"
                          value={libraryForm.name}
                          onChange={(e) =>
                            setLibraryForm((prev) => ({
                              ...prev,
                              name: e.target.value,
                            }))
                          }
                          placeholder="e.g. Tanauan City Public Library"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
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
                          value={libraryForm.campus}
                          onChange={(e) =>
                            setLibraryForm((prev) => ({
                              ...prev,
                              campus: e.target.value,
                            }))
                          }
                          placeholder="e.g. Tanauan City"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>

                      {/* ADDRESS */}
                      <div className="md:col-span-2">
                        <label className="mb-1 block text-xs font-semibold text-slate-600">
                          Address *
                        </label>
                        <input
                          type="text"
                          value={libraryForm.address}
                          onChange={(e) =>
                            setLibraryForm((prev) => ({
                              ...prev,
                              address: e.target.value,
                            }))
                          }
                          placeholder="Complete library address"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                          required
                        />
                      </div>

                      {/* Allowed Student Email Domain */}
                      <div className="md:col-span-2">
                        <label className="mb-1 block text-xs font-medium text-slate-700">
                          Allowed Student Email Domain
                        </label>
                        <div className="relative rounded-lg shadow-sm">
                          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                            <Globe size={16} />
                          </div>
                          <input
                            type="text"
                            name="email_domain"
                            value={libraryForm.emailDomain}
                            onChange={(e) =>
                              setLibraryForm((prev) => ({
                                ...prev,
                                emailDomain: e.target.value,
                              }))
                            }
                            placeholder="e.g. g.batstate-u.edu.ph"
                            className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1.5 leading-normal">
                          Leave this field blank to allow registration from all email domains, or enter a specific institutional domain (e.g., g.batstate-u.edu.ph) to restrict registration exclusively to verified partner school students.
                        </p>
                      </div>

                      {/* MAP PICKER COMPONENT */}
                      <div className="md:col-span-2 my-1">
                        <label className="mb-1 block text-xs font-semibold text-slate-600">
                          Pin Exact Location on Map (Click or Drag marker) *
                        </label>
                        <LocationPickerMap
                          position={mapPosition}
                          setPosition={setMapPosition}
                          onChangeCoordinates={handleCoordinateChange}
                        />
                      </div>

                      {/* LATITUDE (READ ONLY) */}
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">
                          Latitude *
                        </label>
                        <input
                          type="text"
                          readOnly
                          value={libraryForm.lat}
                          className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2.5 text-sm text-slate-600 cursor-not-allowed"
                          required
                        />
                      </div>

                      {/* LONGITUDE (READ ONLY) */}
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">
                          Longitude *
                        </label>
                        <input
                          type="text"
                          readOnly
                          value={libraryForm.lng}
                          className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2.5 text-sm text-slate-600 cursor-not-allowed"
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
                          value={libraryForm.hours}
                          onChange={(e) =>
                            setLibraryForm((prev) => ({
                              ...prev,
                              hours: e.target.value,
                            }))
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
                          value={libraryForm.status}
                          onChange={(e) =>
                            setLibraryForm((prev) => ({
                              ...prev,
                              status: e.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
                        >
                          <option value="Open">Open</option>
                          <option value="Closed">Closed</option>
                        </select>
                      </div>
                    </div>

                    {/* BUTTONS */}
                    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end border-t border-slate-100 pt-4">
                      <button
                        type="button"
                        onClick={useCurrentLocation}
                        className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-1.5"
                      >
                        <MapPinned size={14} aria-hidden="true" />
                        Use Current Location
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAddLibrary(false)}
                        className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={savingLibrary}
                        className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {savingLibrary ? 'Adding...' : 'Add Library'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* MAIN LIBRARY MAP */}
{!showAddLibrary && (
  <LibraryMap showLibraryList={false} />
)}

            {/* LIBRARY MANAGEMENT LIST */}
            {!showAddLibrary && (
              <div className="space-y-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-base font-bold text-slate-800">
                    Manage Libraries
                  </h3>
                  <p className="text-sm text-slate-500">
                    {libraries.length} registered librar{libraries.length === 1 ? 'y' : 'ies'}
                  </p>
                </div>

                {libraries.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                    No libraries have been added yet.
                  </div>
                ) : (
                  libraries.map((library) => (
                    <div
                      key={library.id}
                      className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <h4 className="font-bold text-slate-800">
                          {library.name}
                        </h4>

                        {library.campus && (
                          <p className="mt-1 text-sm text-slate-600">
                            Campus: {library.campus}
                          </p>
                        )}

                        {library.address && (
                          <p className="mt-1 wrap-break-words text-sm text-slate-500">
                            {library.address}
                          </p>
                        )}

                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
                            {library.status || 'Status not set'}
                          </span>

                          {library.lat != null && library.lng != null && (
                            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">
                              Coordinates: {library.lat}, {library.lng}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => startEditLibrary(library)}
                          className="rounded-lg border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteLibrary(library)}
                          className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* STAFF ACCOUNTS */}
        {section === 'visitor-accounts' && (
          <Suspense
            fallback={
              <div role="status" className="rounded-lg bg-white p-5 text-sm text-slate-500">
                Loading visitor accounts…
              </div>
            }
          >
            <VisitorAccountManagement
              mode="superadmin"
              libraries={libraries}
            />
          </Suspense>
        )}

        {section === 'accounts' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-slate-800">Staff Accounts</h2>
              <p className="mt-1 text-sm text-slate-500">Manage database-backed sub-admin and circulation staff accounts.</p>
            </div>
            {staffError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{staffError}</div>
            )}
            {staffMessage && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{staffMessage}</div>
            )}
            <form onSubmit={handleCreateStaff} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5">
                <h3 className="text-sm font-bold text-slate-800">
                  {editingStaffId ? 'Edit Sub-Admin Account' : 'Create Sub-Admin Account'}
                </h3>
                <p className="mt-1 text-xs text-slate-500">Creates a Supabase Auth account and the corresponding staff_profiles record.</p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Full Name</label>
                  <input type="text" value={staffForm.fullName} onChange={(e) => setStaffForm((prev) => ({ ...prev, fullName: e.target.value }))} placeholder="e.g. Juan Dela Cruz" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" required />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Email</label>
                  <input type="email" value={staffForm.email} onChange={(e) => setStaffForm((prev) => ({ ...prev, email: e.target.value }))} placeholder="staff@shelf.edu" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" required />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    {editingStaffId ? 'New Password (Optional)' : 'Temporary Password'}
                  </label>
                  <input
                    type="password"
                    value={staffForm.password}
                    onChange={(e) =>
                      setStaffForm((prev) => ({
                        ...prev,
                        password: e.target.value,
                      }))
                    }
                    placeholder={
                      editingStaffId
                        ? 'Leave blank to keep current password'
                        : 'Minimum 10 characters'
                    }
                    minLength={staffForm.password ? 10 : undefined}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                    required={!editingStaffId}
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    {editingStaffId
                      ? 'Leave blank if you do not want to change the password.'
                      : 'Passwords are handled by Supabase Auth.'}
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Assigned Branch</label>
                  <select value={staffForm.libraryId} onChange={(e) => setStaffForm((prev) => ({ ...prev, libraryId: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" required>
                    <option value="">Select a library</option>
                    {libraries.map((library) => (
                      <option key={library.id} value={library.id}>{library.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={staffLoading}
                className="rounded-lg bg-shelf-primary px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#003568] disabled:opacity-50"
              >
                {staffLoading
                  ? 'Saving...'
                  : editingStaffId
                    ? 'Save Changes'
                    : 'Create Sub-Admin'}
              </button>

              {editingStaffId && (
                <button
                  type="button"
                  disabled={staffLoading}
                  onClick={() => {
                    setEditingStaffId(null);
                    setStaffForm({
                      fullName: '',
                      email: '',
                      password: '',
                      libraryId: '',
                    });
                    setStaffError('');
                    setStaffMessage('');
                  }}
                  className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel Edit
                </button>
              )}
            </div>
            </form>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Registered Staff Accounts</h3>
                  <p className="mt-1 text-xs text-slate-500">Records are loaded directly from staff_profiles.</p>
                </div>
                <button type="button" onClick={loadStaffAccounts} disabled={staffLoading} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  {staffLoading ? 'Loading...' : 'Refresh'}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-225 text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="p-3">Name</th>
                      <th className="p-3">Email</th>
                      <th className="p-3">Role</th>
                      <th className="p-3">Assigned Branch</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {staffAccounts.map((staff) => (
                      <tr key={staff.id} className="hover:bg-slate-50">
                        <td className="p-3 font-semibold text-slate-700">{staff.full_name}</td>
                        <td className="p-3 text-xs font-mono text-slate-500">{staff.email}</td>
                        <td className="p-3">
                          <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-bold ${staff.role === 'superadmin' ? 'bg-purple-100 text-purple-800' : staff.role === 'subadmin' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'}`}>
                            {formatStaffRole(staff.role)}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-slate-500">{getLibraryName(libraries, staff.library_id)}</td>
                        <td className="p-3">
                          <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-bold ${staff.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                            {staff.is_active ? 'Active' : 'Disabled'}
                          </span>
                        </td>
                        <td className="p-3">
                          {staff.role === 'superadmin' ? (
                            <span className="text-xs font-semibold text-slate-400">
                              Protected
                            </span>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleEditStaff(staff)}
                                disabled={staffLoading}
                                className="rounded-md border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                              >
                                Edit
                              </button>

                              <button
                                type="button"
                                onClick={() => handleToggleStaff(staff)}
                                disabled={staffLoading}
                                className={`rounded-md border px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${
                                  staff.is_active
                                    ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
                                    : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                                }`}
                              >
                                {staff.is_active ? 'Disable' : 'Enable'}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteStaff(staff)}
                                disabled={staffLoading}
                                className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!staffLoading && staffAccounts.length === 0 && (
                <div className="p-8 text-center text-sm text-slate-500">
                  No staff accounts were found in staff_profiles.
                </div>
              )}
            </div>
          </div>
        )}

        {/* REPORTS AND SERVICES */}
        {section === 'workspace' && (
          <AdminWorkspace
            key={`${focusedNotificationRequestId || 'none'}-${notificationFocusVersion}`}
            initialTab={activeTab}
            mode="reports"
            user={user}
            libraries={libraries}
            books={books}
            visitors={visitors}
            borrowRequests={borrowRequests}
            attendanceLogs={attendanceLogs}
            focusedNotificationRequestId={focusedNotificationRequestId}
            focusedNotificationType={focusedNotificationType}
          />
        )}

        {/* COMMUNICATION (FEEDBACK & ANNOUNCEMENTS) */}
        {section === 'communication' && (
          <AdminWorkspace
            initialTab={activeTab}
            mode="communication"
            user={user}
            libraries={libraries}
            books={books}
            visitors={visitors}
            borrowRequests={borrowRequests}
            attendanceLogs={attendanceLogs}
          />
        )}
      </main>
    </div>
  );
}
