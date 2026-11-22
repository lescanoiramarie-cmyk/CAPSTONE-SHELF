import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import LocationPickerMap from '../../component/LocationPickerMap.jsx';
import GeoapifyAddressInput from '../../component/GeoapifyAddressInput.jsx';
import { geocodeGeoapifyAddress, getGeoapifyApiKey } from '../../lib/geoapify.js';
import AdminAnalyticsPanel from '../../component/AdminAnalyticsPanel.jsx';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Building2,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Globe,
  MapPinned,
  MessageSquare,
  ShieldCheck,
  Settings,
  Upload,
  UsersRound,
} from 'lucide-react';
import { useAuth } from '../../context/useAuth.js';
import { useLanguage } from '../../context/LanguageContext.jsx';
import ShelfHeader from '../../component/ShelfHeader.jsx';
import {
  useLibraryData,
  useLibrary,
} from '../../context/useLibrary.js';
import BookInventory from '../../component/BookInventory.jsx';
import DeferredChart from '../../component/DeferredChart.jsx';
import LibraryMap from '../../component/LibraryMap.jsx';
import ExportConfirmationDialog from '../../component/ExportConfirmationDialog.jsx';
import DashboardWelcome from '../../component/DashboardWelcome.jsx';
import DashboardDataBoundary from '../../component/DashboardDataBoundary.jsx';
import PreferredLanguageSetting from '../../component/PreferredLanguageSetting.jsx';
import PageJump from '../../component/PageJump.jsx';
import FinePayments from '../../component/FinePayments.jsx';
import SubscriptionManagement from '../../component/SubscriptionManagement.jsx';
import VisitorTermsContent, { VISITOR_TERMS_VERSION } from '../../component/VisitorTermsContent.jsx';
import SubAdminTermsContent, { SUBADMIN_TERMS_VERSION } from '../../component/SubAdminTermsContent.jsx';
import {
  upsertSystemTermsDocument,
} from '../../data/store.js';
import { supabase } from '../../lib/supabaseClient.js';
import { formatBookCategory } from '../../lib/bookCategory.js';
import { sendDueDateFollowUp } from '../../lib/dueDateFollowUp.js';
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
import {
  getRequestLibraryId,
  getAnalyticsMonthKey,
  getAnalyticsMonthOptionsForYear,
  getAnalyticsYearOptions,
  getAnalyticsMonthWindow,
  getMonthlyBorrowingProjection,
} from '../../lib/dashboardAnalytics.js';

const VisitorAccountManagement = lazy(
  () => import('../../component/VisitorAccountManagement.jsx')
);
const AdminWorkspace = lazy(() => import('../../component/AdminWorkspace.jsx'));
const BookRatingsChart = lazy(() => import('../../component/BookRatingsChart.jsx'));

async function getStaffFunctionErrorMessage(error) {
  const response = error?.context;
  if (response && typeof response.clone === 'function') {
    try {
      const payload = await response.clone().json();
      const message = payload?.error || payload?.message || payload?.msg;
      if (message && /AAL2 authentication \(MFA\) is required/i.test(message)) {
        return 'Staff changes need a verified Super Admin session. Sign in again with your authenticator code, then save the change.';
      }
      if (message) return message;
    } catch {
      // Keep the SDK message when the response body is empty or not JSON.
    }
  }
  return error?.message || 'The staff account action could not be completed.';
}

function AdminSectionInsights({ title, description, metrics, recommendation, prediction, predictionSeries }) {
  return <AdminAnalyticsPanel title={title} description={description} metrics={metrics} recommendation={recommendation} prediction={prediction} predictionSeries={predictionSeries} />;
}

function hasValidLibraryCoordinates(library) {
  if (library?.lat == null || library?.lng == null || String(library.lat).trim() === '' || String(library.lng).trim() === '') return false;
  const lat = Number(library.lat);
  const lng = Number(library.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

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
  const { t } = useLanguage();
  const {
    user,
  } = useAuth();
  const superAdminName =
    user?.role === 'superadmin'
      ? 'Jeffrey Castillo'
      : user?.name || 'System Super Administrator';

  const {
    importBooksBulk,
    addLibrary,
    updateLibrary,
    deleteLibrary,
    loading: libraryLoading,
    initialDataReady,
    attendanceLoadError,
    borrowRequestsLoadError,
    retryBorrowRequests,
    connectionError,
    refreshAll,
  } = useLibrary();

  const {
    books,
    visitorCount,
    borrowRequests,
    attendanceLogs,
    libraries,
  } = useLibraryData();

  const superAdminStartPages = ['overview', 'inventory', 'map', 'accounts', 'visitor-accounts'];
  const [section, setSection] = useState(() => {
    const saved = window.localStorage.getItem('shelf_superadmin_start_page');
    return superAdminStartPages.includes(saved) ? saved : 'overview';
  });
  const [overviewMonth, setOverviewMonth] = useState(() => getAnalyticsMonthKey());
  const [overviewYear, setOverviewYear] = useState(() => new Date().getFullYear());
  const overviewMonthOptions = getAnalyticsMonthOptionsForYear(overviewYear);
  const [termsDocumentKey, setTermsDocumentKey] = useState('visitor');
  const [termsDocumentContent, setTermsDocumentContent] = useState('');
  const [termsDocumentVersion, setTermsDocumentVersion] = useState('');
  const [termsEditorLoading, setTermsEditorLoading] = useState(false);
  const [termsEditorSaving, setTermsEditorSaving] = useState(false);
  const [termsEditorError, setTermsEditorError] = useState('');
  const [termsEditorMessage, setTermsEditorMessage] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [confirmAdminPassword, setConfirmAdminPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState({ error: '', message: '' });
  const [showStaffTemporaryPassword, setShowStaffTemporaryPassword] = useState(false);
  const visitorTermsPreviewRef = useRef(null);
  const subAdminTermsPreviewRef = useRef(null);
  const [activeTab, setActiveTab] = useState('reports');
  useEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [section, activeTab]);
  const [focusedNotificationRequestId, setFocusedNotificationRequestId] = useState(null);
  const [focusedNotificationType, setFocusedNotificationType] = useState(null);
  const [notificationFocusVersion, setNotificationFocusVersion] = useState(0);
  const superAdminNotificationStorageKey = `shelf-read-superadmin-notifications:${user?.id || 'staff'}`;
  const [storedReadSuperAdminNotifications, setStoredReadSuperAdminNotifications] = useState(() => {
    try {
      return {
        key: superAdminNotificationStorageKey,
        ids: new Set(JSON.parse(localStorage.getItem(superAdminNotificationStorageKey) || '[]').map(String)),
      };
    } catch {
      return { key: superAdminNotificationStorageKey, ids: new Set() };
    }
  });
  const readSuperAdminNotificationIds = useMemo(
    () => storedReadSuperAdminNotifications.key === superAdminNotificationStorageKey
      ? storedReadSuperAdminNotifications.ids
      : new Set(),
    [storedReadSuperAdminNotifications, superAdminNotificationStorageKey],
  );
  const [exportingReport, setExportingReport] = useState('');
  const [exportMessage, setExportMessage] = useState('');
  const [exportError, setExportError] = useState('');
  const [pendingExportFile, setPendingExportFile] = useState(null);
  const exportLockRef = useRef(false);

  const exportSystemReport = async (report, format) => {
    if (exportLockRef.current) return;
    exportLockRef.current = true;
    const reportKey = `${report}-${format}`;
    setExportingReport(reportKey);
    setExportMessage('');
    setExportError('');
    try {
      const { exportReport } = await import('../../lib/excelUtils.js');
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
        ...(isAttendance ? { dateRange: 'All loaded attendance records' } : {}),
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
      const generatedFile = await exportReport(data, format, { ...reportOptions, download: false });
      setPendingExportFile({ ...generatedFile, label: format === 'xlsx' ? 'Excel' : format.toUpperCase() });
      setExportMessage('The report is ready. Confirm whether to download it.');
    } catch {
      setExportError('The report could not be exported. Please try again.');
    } finally {
      exportLockRef.current = false;
      setExportingReport('');
    }
  };

  const loadTermsEditor = useCallback(async (key = termsDocumentKey) => {
    setTermsEditorLoading(true);
    setTermsEditorError('');
    setTermsEditorMessage('');
    try {
      const { data, error } = await supabase
        .from('system_terms_documents')
        .select('version, content')
        .eq('document_key', key)
        .maybeSingle();
      if (error) throw error;
      const previewText = (key === 'visitor' ? visitorTermsPreviewRef.current : subAdminTermsPreviewRef.current)?.innerText?.trim() || '';
      setTermsDocumentContent(data?.content || previewText);
      setTermsDocumentVersion(data?.version || (key === 'visitor' ? VISITOR_TERMS_VERSION : SUBADMIN_TERMS_VERSION));
    } catch (error) {
      console.error('Unable to load terms document for editing:', error);
      setTermsEditorError('Could not load the terms document. Confirm that the latest database migration has been applied.');
    } finally {
      setTermsEditorLoading(false);
    }
  }, [termsDocumentKey]);

  const saveTermsEditor = async (event) => {
    event.preventDefault();
    if (!termsDocumentContent.trim() || termsEditorSaving) return;
    setTermsEditorSaving(true);
    setTermsEditorError('');
    setTermsEditorMessage('');
    try {
      const nextVersion = `v-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
      await upsertSystemTermsDocument({
        documentKey: termsDocumentKey,
        version: nextVersion,
        content: termsDocumentContent.trim(),
        updatedBy: user?.id || null,
      });
      setTermsDocumentVersion(nextVersion);
      setTermsEditorMessage('Terms saved. Users will be asked to acknowledge this updated version.');
    } catch (error) {
      console.error('Unable to save terms document:', error);
      setTermsEditorError('Could not save the terms. Confirm your Super Admin access and try again.');
    } finally {
      setTermsEditorSaving(false);
    }
  };

  const updateAdminPassword = async (event) => {
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
    // Loading the terms editor synchronizes the settings view with Supabase.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (section === 'settings') void loadTermsEditor(termsDocumentKey);
  }, [loadTermsEditor, section, termsDocumentKey]);

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

  const handleFileUpload = async (
    event
  ) => {
    const file =
      event.target.files?.[0];
    if (!file) {
      return;
    }
    let parseImportFile;
    try {
      ({ parseImportFile } = await import('../../lib/excelUtils.js'));
    } catch {
      window.alert('The import tools could not be loaded. Please try again.');
      event.target.value = '';
      return;
    }
    parseImportFile(
      file,
      async (importedJSON) => {
        try {
          if (importTarget === 'books') {
            const { books: importedBooks, rateMismatches } =
              await importBooksBulk(importedJSON);
            const mismatchMessage = rateMismatches.length
              ? `\nExisting rates were preserved. Manual review required:\n${rateMismatches
                  .map(({ title, existingRate, importedRate }) =>
                    `${title}: existing ${existingRate ?? 'unclassified'}, imported ${importedRate}`
                  )
                  .join('\n')}`
              : '';
            window.alert(
              `${importedBooks.length} book${importedBooks.length === 1 ? '' : 's'} imported.${mismatchMessage}`
            );
            window.location.reload();
            return;
          }

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
    visitorAccessMode: 'institutional',
    lat: '',
    lng: '',
    hours: '8:00 AM - 5:00 PM',
    status: 'Open',
  });
  const [mapPosition, setMapPosition] = useState([14.5995, 120.9842]); // Manila center
  const [geocodingAddress, setGeocodingAddress] = useState(false);
  const [geocodingMessage, setGeocodingMessage] = useState('');
  const geocodeRequestId = useRef(0);
  const geocodingPromiseRef = useRef(null);
  const [libraryPage, setLibraryPage] = useState(1);
  const [librariesPerPage, setLibrariesPerPage] = useState(10);
  const libraryPageCount = Math.max(1, Math.ceil(libraries.length / librariesPerPage));
  const visibleLibraryPage = Math.min(libraryPage, libraryPageCount);
  const paginatedLibraries = libraries.slice(
    (visibleLibraryPage - 1) * librariesPerPage,
    visibleLibraryPage * librariesPerPage
  );

  const handleCoordinateChange = useCallback((lat, lng) => {
    setLibraryForm((previous) => ({
      ...previous,
      lat: String(lat),
      lng: String(lng),
    }));
  }, []);

  const geocodeLibraryAddress = useCallback(async ({ showFailure = true } = {}) => {
    const address = libraryForm.address.trim();
    if (!address) return null;
    if (geocodingPromiseRef.current?.address === address) {
      return geocodingPromiseRef.current.promise;
    }

    const requestId = ++geocodeRequestId.current;
    setGeocodingAddress(true);
    setGeocodingMessage('Finding this address on the map…');
    const promise = (async () => {
      try {
      const addressParts = address.split(',').map((part) => part.trim()).filter(Boolean);
      const queryCandidates = [...new Set([
        address,
        addressParts.slice(1).join(', '),
        addressParts.slice(-2).join(', '),
      ].filter((query) => query.length >= 5))];
      let match = null;
      let matchedAddressExactly = true;
      if (getGeoapifyApiKey()) {
        for (const [index, query] of queryCandidates.entries()) {
          match = await geocodeGeoapifyAddress(query);
          if (requestId !== geocodeRequestId.current) return null;
          matchedAddressExactly = index === 0;
          if (match) break;
        }
      } else {
        for (const [index, query] of queryCandidates.entries()) {
          if (index > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, 1100));
            if (requestId !== geocodeRequestId.current) return null;
          }
          const params = new URLSearchParams({
            format: 'jsonv2',
            limit: '1',
            countrycodes: 'ph',
            q: query,
          });
          const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
          if (!response.ok) throw new Error('Address lookup is temporarily unavailable.');
          const results = await response.json();
          if (requestId !== geocodeRequestId.current) return null;
          match = results[0];
          matchedAddressExactly = index === 0;
          if (match) break;
        }
      }
      if (!match || !Number.isFinite(Number(match.lat)) || !Number.isFinite(Number(match.lon))) {
        if (showFailure) setGeocodingMessage('Could not find that address. Add the city/municipality and province, then leave the address field to try again.');
        return null;
      }

      const lat = Number(match.lat);
      const lng = Number(match.lon);
      setMapPosition([lat, lng]);
      handleCoordinateChange(lat.toFixed(6), lng.toFixed(6));
      setGeocodingMessage(matchedAddressExactly
        ? 'Address located and map pin updated automatically.'
        : `Exact address not found; pinned the closest matching area: ${match.formatted || match.display_name || 'review the map pin'}.`);
      return { lat: lat.toFixed(6), lng: lng.toFixed(6) };
    } catch (error) {
      if (requestId === geocodeRequestId.current) {
        setGeocodingMessage(showFailure ? (error.message || 'Could not locate this address. Please try again.') : '');
      }
      return null;
    } finally {
      if (requestId === geocodeRequestId.current) setGeocodingAddress(false);
      }
    })();
    geocodingPromiseRef.current = { address, promise };
    try {
      return await promise;
    } finally {
      if (geocodingPromiseRef.current?.promise === promise) geocodingPromiseRef.current = null;
    }
  }, [handleCoordinateChange, libraryForm.address]);

  // Place the map pin automatically after the user pauses while entering an
  // address. Existing/manual coordinates are preserved until the address is
  // edited, and the debounce avoids sending a lookup for every keystroke.
  useEffect(() => {
    const address = libraryForm.address.trim();
    if (libraryForm.lat && libraryForm.lng) return undefined;
    if (address.length < 10) return undefined;
    const timer = window.setTimeout(() => {
      void geocodeLibraryAddress({ showFailure: false });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [geocodeLibraryAddress, libraryForm.address, libraryForm.lat, libraryForm.lng]);

  // ============================================================
  // STAFF ACCOUNTS
  // ============================================================
  const [
    staffAccounts,
    setStaffAccounts,
  ] = useState([]);
  const [staffSearch, setStaffSearch] = useState('');
  const [staffMfaChallenge, setStaffMfaChallenge] = useState(null);
  const [staffMfaCode, setStaffMfaCode] = useState('');
  const [staffBranchFilter, setStaffBranchFilter] = useState('all');
  const [staffRoleFilter, setStaffRoleFilter] = useState('all');
  const [staffStatusFilter, setStaffStatusFilter] = useState('all');
  const [staffPage, setStaffPage] = useState(1);
  const [staffPageSize, setStaffPageSize] = useState(10);
  const [
    staffLoading,
    setStaffLoading,
  ] = useState(false);
  const staffHasLoadedRef = useRef(false);
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

  useEffect(() => {
    if (!editingStaffId) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [editingStaffId]);

  const staffBranchCounts = useMemo(() => {
    const counts = new Map(
      libraries.map((library) => [String(library.id), {
        id: String(library.id),
        name: library.name,
        count: 0,
      }])
    );
    let unassignedCount = 0;

    staffAccounts
      .filter((staff) => staff.role === 'subadmin')
      .forEach((staff) => {
        const branchId = String(staff.library_id || '');
        const branch = counts.get(branchId);
        if (branch) {
          branch.count += 1;
        } else if (branchId) {
          const existing = counts.get(`unknown:${branchId}`);
          if (existing) existing.count += 1;
          else counts.set(`unknown:${branchId}`, {
            id: `unknown:${branchId}`,
            name: getLibraryName(libraries, branchId),
            count: 1,
          });
        } else {
          unassignedCount += 1;
        }
      });

    const branches = [...counts.values()];
    if (unassignedCount > 0) {
      branches.push({ id: 'unassigned', name: 'Unassigned', count: unassignedCount });
    }
    return branches.sort((a, b) => a.name.localeCompare(b.name));
  }, [libraries, staffAccounts]);

  const staffRoles = useMemo(
    () => [...new Set(staffAccounts.map((staff) => staff.role).filter(Boolean))]
      .sort((a, b) => formatStaffRole(a).localeCompare(formatStaffRole(b))),
    [staffAccounts]
  );

  const filteredStaffAccounts = useMemo(() => {
    const search = staffSearch.trim().toLocaleLowerCase();
    const knownBranchIds = new Set(libraries.map((library) => String(library.id)));

    return staffAccounts.filter((staff) => {
      const matchesSearch = !search ||
        `${staff.full_name || ''} ${staff.email || ''}`.toLocaleLowerCase().includes(search);
      const branchId = String(staff.library_id || '');
      const matchesBranch = staffBranchFilter === 'all' ||
        (staffBranchFilter === 'unassigned'
          ? !branchId || !knownBranchIds.has(branchId)
          : branchId === staffBranchFilter);
      const matchesRole = staffRoleFilter === 'all' || staff.role === staffRoleFilter;
      const matchesStatus = staffStatusFilter === 'all' ||
        (staffStatusFilter === 'active' ? staff.is_active : !staff.is_active);

      return matchesSearch && matchesBranch && matchesRole && matchesStatus;
    });
  }, [libraries, staffAccounts, staffBranchFilter, staffRoleFilter, staffSearch, staffStatusFilter]);

  const staffPageCount = Math.max(1, Math.ceil(filteredStaffAccounts.length / staffPageSize));
  const visibleStaffPage = Math.min(staffPage, staffPageCount);
  const visibleStaffAccounts = filteredStaffAccounts.slice(
    (visibleStaffPage - 1) * staffPageSize,
    visibleStaffPage * staffPageSize
  );

  useEffect(() => {
    if (section !== 'accounts' || focusedNotificationType !== 'staff_review' || !focusedNotificationRequestId) return undefined;
    const rowIndex = filteredStaffAccounts.findIndex(
      (staff) => String(staff.id) === String(focusedNotificationRequestId),
    );
    if (rowIndex < 0) return undefined;
    const targetPage = Math.floor(rowIndex / staffPageSize) + 1;
    if (staffPage !== targetPage) {
      const frame = requestAnimationFrame(() => setStaffPage(targetPage));
      return () => cancelAnimationFrame(frame);
    }
    const frame = requestAnimationFrame(() => {
      document.getElementById(`superadmin-staff-account-${focusedNotificationRequestId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [filteredStaffAccounts, focusedNotificationRequestId, focusedNotificationType, section, staffPage, staffPageSize]);

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
        staffHasLoadedRef.current = true;
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
    if (section === 'accounts' || !staffHasLoadedRef.current) {
      void Promise.resolve().then(loadStaffAccounts);
    }
  }, [section]);

  // ============================================================
  // CREATE STAFF ACCOUNT
  // ============================================================

const saveStaffAccountOperation = async (operation) => {
  const { data, error } = await supabase.functions.invoke('manage-staff', { body: operation.payload });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);

  setStaffForm({ fullName: '', email: '', password: '', libraryId: '' });
  setEditingStaffId(null);
  setStaffPage(1);
  await loadStaffAccounts();
  setStaffMessage(operation.isEditing ? 'Sub-admin account updated successfully.' : 'Sub-admin account created successfully.');
};

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
    const operation = {
      isEditing,
      payload: isEditing
        ? { operation: 'update', userId: editingStaffId, fullName, email, libraryId, password }
        : { operation: 'create', email, fullName, password, libraryId, role: 'subadmin' },
    };
    const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw assuranceError;

    if (assurance?.currentLevel !== 'aal2') {
      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
      if (factorsError) throw factorsError;
      const verifiedFactor = factors?.totp?.find((factor) => factor.status === 'verified');
      if (!verifiedFactor) {
        throw new Error('Set up an authenticator for this Super Admin account before managing staff.');
      }
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: verifiedFactor.id });
      if (challengeError) throw challengeError;
      setStaffMfaCode('');
      setStaffMfaChallenge({ ...operation, factorId: verifiedFactor.id, challengeId: challenge.id });
      setStaffMessage('Enter the current authenticator code to continue saving this staff account.');
      return;
    }

    await saveStaffAccountOperation(operation);
  } catch (error) {
    const message = await getStaffFunctionErrorMessage(error);
    console.error(`Save staff account error (HTTP ${error?.context?.status ?? 'unknown'}): ${message}`);
    setStaffError(message);
  } finally {
    setStaffLoading(false);
  }
};

const handleVerifyStaffMfa = async (event) => {
  event.preventDefault();
  if (!staffMfaChallenge || !/^\d{6}$/.test(staffMfaCode)) {
    setStaffError('Enter the 6-digit code from your authenticator app.');
    return;
  }
  setStaffLoading(true);
  setStaffError('');
  try {
    const { error } = await supabase.auth.mfa.verify({
      factorId: staffMfaChallenge.factorId,
      challengeId: staffMfaChallenge.challengeId,
      code: staffMfaCode,
    });
    if (error) throw error;
    await saveStaffAccountOperation(staffMfaChallenge);
    setStaffMfaChallenge(null);
    setStaffMfaCode('');
  } catch (error) {
    const message = await getStaffFunctionErrorMessage(error);
    setStaffError(message);
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
    const message = await getStaffFunctionErrorMessage(error);
    console.error(`Toggle staff account error (HTTP ${error?.context?.status ?? 'unknown'}): ${message}`);
    setStaffError(message);
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
  setStaffMessage('');
};

  // DELETE SUB-ADMIN ACCOUNT
  const handleDeleteStaff = async (staff) => {
    if (staff.role === 'superadmin') {
      setStaffError('Super-admin accounts are protected.');
      return;
    }

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
      const message = await getStaffFunctionErrorMessage(error);
      console.error(`Delete staff account error (HTTP ${error?.context?.status ?? 'unknown'}): ${message}`);
      setStaffError(message);
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
        !libraryForm.address.trim()
      ) {
        setLibraryMessage(
          'Please enter the library name and complete address.'
        );
        return;
      }
      let coordinates = { lat: libraryForm.lat, lng: libraryForm.lng };
      if (!coordinates.lat || !coordinates.lng) {
        coordinates = await geocodeLibraryAddress();
        if (!coordinates) {
          setLibraryMessage('The address could not be located automatically. Add more address details and try again.');
          return;
        }
      }
      const formattedDomain = libraryForm.emailDomain
        .toLowerCase()
        .trim()
        .replace(/^@+/, '')
        .replace(/\.+$/, '');
      const invalidDomain = formattedDomain && (
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(formattedDomain) ||
        formattedDomain === 'gmail.com'
      );
      if ((libraryForm.visitorAccessMode !== 'public' && !formattedDomain) || invalidDomain) {
        setLibraryMessage(libraryForm.visitorAccessMode === 'public'
          ? 'Enter a valid official email domain, or leave it blank for a public library.'
          : 'Enter the official email domain for this partner institution.');
        return;
      }
      try {
        setSavingLibrary(true);
        setLibraryMessage('');

        const payload = {
          name: libraryForm.name.trim(),
          campus: libraryForm.campus.trim(),
          address: libraryForm.address.trim(),
          email_domain: formattedDomain,
          emailDomain: formattedDomain,
          visitor_access_mode: libraryForm.visitorAccessMode,
          lat: coordinates.lat,
          lng: coordinates.lng,
          hours: libraryForm.hours,
          status: libraryForm.status,
        };

        await addLibrary(payload);

        setLibraryMessage(
          'Library added successfully.'
        );
        setLibraryForm({
          name: '',
          campus: '',
          address: '',
          emailDomain: '',
          visitorAccessMode: 'institutional',
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
  // EDIT LIBRARY
  // ============================================================
  const handleEditLibrary = async (event) => {
    event.preventDefault();

    if (
      !editingLibraryId ||
      !libraryForm.name.trim() ||
      !libraryForm.address.trim()
    ) {
      setLibraryMessage(
        'Please enter the library name and complete address.'
      );
      return;
    }
    let coordinates = { lat: libraryForm.lat, lng: libraryForm.lng };
    if (!coordinates.lat || !coordinates.lng) {
      coordinates = await geocodeLibraryAddress();
      if (!coordinates) {
        setLibraryMessage('The address could not be located automatically. Add more address details and try again.');
        return;
      }
    }

    const formattedDomain = libraryForm.emailDomain
      .toLowerCase()
      .trim()
      .replace(/^@+/, '')
      .replace(/\.+$/, '');
    const invalidDomain = formattedDomain && (
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(formattedDomain) ||
      formattedDomain === 'gmail.com'
    );
    if ((libraryForm.visitorAccessMode !== 'public' && !formattedDomain) || invalidDomain) {
      setLibraryMessage(libraryForm.visitorAccessMode === 'public'
        ? 'Enter a valid official email domain, or leave it blank for a public library.'
        : 'Enter the official email domain for this partner institution.');
      return;
    }

    try {
      setSavingLibrary(true);
      setLibraryMessage('');

      await updateLibrary(editingLibraryId, {
        name: libraryForm.name.trim(),
        campus: libraryForm.campus.trim(),
        address: libraryForm.address.trim(),
        email_domain: formattedDomain,
        visitor_access_mode: libraryForm.visitorAccessMode,
        lat: coordinates.lat,
        lng: coordinates.lng,
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
        visitorAccessMode: 'institutional',
        lat: '',
        lng: '',
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
      visitorAccessMode: library.visitor_access_mode || library.visitorAccessMode || 'institutional',
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
    const notifications = [];

    // System Oversight: Inactive / unverified staff accounts requiring review
    staffAccounts.forEach((account) => {
      if (account.is_active === false || account.isActive === false) {
        notifications.push({
          id: `staff-inactive-${account.id}`,
          recordId: account.id,
          type: 'staff_review',
          targetSection: 'accounts',
          status: 'Inactive',
          title: 'Staff account inactive',
          message: `${account.full_name || account.fullName || 'Staff'} (${account.email}) requires review`,
          timeLabel: 'Needs review',
          timestamp: new Date(account.created_at || account.createdAt || notificationNow).getTime(),
        });
      }
    });

    return notifications
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, 20);
  }, [staffAccounts, notificationNow]);

  const handleSuperAdminNotificationClick = (item) => {
    const id = String(item?.id || '');
    if (id) {
      const next = new Set(readSuperAdminNotificationIds);
      next.add(id);
      setStoredReadSuperAdminNotifications({ key: superAdminNotificationStorageKey, ids: next });
      try {
        localStorage.setItem(superAdminNotificationStorageKey, JSON.stringify([...next]));
      } catch { /* private browsing may disable storage */ }
    }
    if (item.type === 'staff_review' && item.recordId) {
      setSection('accounts');
      setStaffSearch('');
      setStaffBranchFilter('all');
      setStaffRoleFilter('all');
      setStaffStatusFilter('all');
      setStaffPage(1);
      setFocusedNotificationRequestId(item.recordId);
      setFocusedNotificationType(item.type);
      setNotificationFocusVersion((version) => version + 1);
    }
  };

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
  const inventorySummary = useMemo(() => books.reduce((totals, book) => {
    const total = Number(book.totalCopies ?? book.total_copies ?? 0);
    const available = Number(book.availableCopies ?? book.available_copies ?? total);
    totals.copies += Number.isFinite(total) ? total : 0;
    totals.available += Number.isFinite(available) ? available : 0;
    if (available <= 0) totals.unavailableTitles += 1;
    if (!book.libraryId && !book.library_id) totals.unassignedTitles += 1;
    return totals;
  }, { copies: 0, available: 0, unavailableTitles: 0, unassignedTitles: 0 }), [books]);
  const branchInventoryData = useMemo(() => {
    const branchCopies = new Map(libraries.map((library) => [String(library.id), {
      id: String(library.id),
      name: library.name || 'Unnamed branch',
      available: 0,
      unavailable: 0,
      total: 0,
    }]));
    books.forEach((book) => {
      const branch = branchCopies.get(String(book.libraryId ?? book.library_id ?? ''));
      if (!branch) return;
      const total = Math.max(0, Number(book.totalCopies ?? book.total_copies ?? 0) || 0);
      const available = Math.min(total, Math.max(0, Number(book.availableCopies ?? book.available_copies ?? total) || 0));
      branch.available += available;
      branch.unavailable += total - available;
      branch.total += total;
    });
    const branches = [...branchCopies.values()]
      .filter((branch) => branch.total > 0)
      .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name))
      .slice(0, 8);
    return {
      labels: branches.map((branch) => branch.name),
      available: branches.map((branch) => branch.available),
      unavailable: branches.map((branch) => branch.unavailable),
    };
  }, [books, libraries]);
  const mapSummary = useMemo(() => ({
    geocoded: libraries.filter(hasValidLibraryCoordinates).length,
    missingCoordinates: libraries.filter((library) => !hasValidLibraryCoordinates(library)).length,
  }), [libraries]);
  const staffSummary = useMemo(() => ({
    active: staffAccounts.filter((staff) => staff.is_active !== false && staff.isActive !== false).length,
    inactive: staffAccounts.filter((staff) => staff.is_active === false || staff.isActive === false).length,
    uncoveredOpenBranchNames: libraries.filter((library) => library.status === 'Open' && !staffAccounts.some((staff) => {
      const staffLibraryId = staff.library_id ?? staff.libraryId;
      return String(staffLibraryId || '') === String(library.id) && staff.is_active !== false && staff.isActive !== false;
    })).map((library) => library.name || 'Unnamed branch'),
    uncoveredOpenLibraries: libraries.filter((library) => library.status === 'Open' && !staffAccounts.some((staff) => {
      const staffLibraryId = staff.library_id ?? staff.libraryId;
      return String(staffLibraryId || '') === String(library.id) && staff.is_active !== false && staff.isActive !== false;
    })).length,
  }), [staffAccounts, libraries]);
  const inventoryDemand = useMemo(() => {
    const monthWindow = getAnalyticsMonthWindow(overviewMonth);
    if (!monthWindow) return { atRiskTitles: [], periodLabel: '' };
    if (borrowRequestsLoadError) return { atRiskTitles: [], periodLabel: monthWindow.monthLabel };
    const demand = new Map();
    borrowRequests.forEach((request) => {
      if (String(request.status || '').toLowerCase() !== 'borrowed' && String(request.status || '').toLowerCase() !== 'returned') return;
      const borrowedAt = request.borrowDate ?? request.borrow_date;
      const timestamp = new Date(borrowedAt ?? '').getTime();
      if (!Number.isFinite(timestamp) || timestamp < monthWindow.start.getTime() || timestamp >= monthWindow.endExclusive.getTime()) return;
      const bookId = String(request.bookId ?? request.book_id ?? '');
      if (bookId) demand.set(bookId, (demand.get(bookId) || 0) + 1);
    });
    const atRiskTitles = [...demand.entries()].map(([bookId, count]) => {
      const book = books.find((item) => String(item.id) === bookId);
      const available = Number(book?.availableCopies ?? book?.available_copies ?? 0);
      return { book, count, available: Number.isFinite(available) ? available : 0 };
    }).filter((item) => item.book && item.count >= 3 && item.available <= 1)
      .sort((left, right) => right.count - left.count)
      .slice(0, 5);
    return { atRiskTitles, periodLabel: monthWindow.monthLabel };
  }, [books, borrowRequests, overviewMonth, borrowRequestsLoadError]);
  const inventoryBorrowingProjection = useMemo(
    () => getMonthlyBorrowingProjection(borrowRequests, new Date(`${overviewMonth}-01T00:00:00`)),
    [borrowRequests, overviewMonth]
  );

  // ============================================================
  // TREND DATA
  // ============================================================
  const trendData = useMemo(() => {
    const monthWindow = getAnalyticsMonthWindow(overviewMonth);
    if (!monthWindow) return { monthLabel: '', labels: [], visitCounts: [], borrowCounts: [], hasActivity: false };
    const { start: firstDayOfMonth, endExclusive: firstDayOfNextMonth, days: daysInMonth, monthLabel } = monthWindow;
    const firstWeekday = firstDayOfMonth.getDay();
    const weekCount = Math.ceil((firstWeekday + daysInMonth) / 7);
    const weeks = Array.from({ length: weekCount }, (_, index) => {
      const firstDate = Math.max(1, index * 7 - firstWeekday + 1);
      const lastDate = Math.min(daysInMonth, (index + 1) * 7 - firstWeekday);
      return {
        label: `${firstDayOfMonth.toLocaleDateString('en-US', { month: 'short' })} ${firstDate}–${lastDate}`,
        visitCount: 0,
        borrowCount: 0,
      };
    });
    const addToWeek = (value, field) => {
      if (!value) return;
      const date = new Date(value);
      if (
        Number.isNaN(date.getTime()) ||
        date < firstDayOfMonth ||
        date >= firstDayOfNextMonth
      ) return;
      const weekIndex = Math.floor((date.getDate() - 1 + firstWeekday) / 7);
      weeks[weekIndex][field] += 1;
    };

    attendanceLogs.forEach((attendance) => addToWeek(attendance.timeIn || attendance.time_in, 'visitCount'));
    if (!borrowRequestsLoadError) borrowRequests.forEach((request) => addToWeek(request.borrowDate || request.borrow_date, 'borrowCount'));
    return {
      monthLabel,
      labels: weeks.map((week) => week.label),
      visitCounts: weeks.map((week) => week.visitCount),
      borrowCounts: weeks.map((week) => week.borrowCount),
      totalVisits: weeks.reduce((total, week) => total + week.visitCount, 0),
      totalBorrows: borrowRequestsLoadError ? null : weeks.reduce((total, week) => total + week.borrowCount, 0),
      borrowDataAvailable: !borrowRequestsLoadError,
      hasActivity: weeks.some((week) => week.visitCount > 0 || (!borrowRequestsLoadError && week.borrowCount > 0)),
    };
  }, [attendanceLogs, borrowRequests, overviewMonth, borrowRequestsLoadError]);

  const branchActivityData = useMemo(() => {
    const monthWindow = getAnalyticsMonthWindow(overviewMonth);
    if (!monthWindow) return { labels: [], checkIns: [], transactions: [] };
    const { start, endExclusive: end } = monthWindow;
    const isInRange = (value) => {
      const timestamp = new Date(value).getTime();
      return Number.isFinite(timestamp) && timestamp >= start.getTime() && timestamp < end.getTime();
    };

    const counts = new Map(
      libraries.map((library) => [String(library.id), {
        id: String(library.id),
        name: library.name || 'Unnamed branch',
        checkIns: 0,
        transactions: 0,
      }])
    );

    attendanceLogs.forEach((attendance) => {
      const branch = counts.get(String(attendance.libraryId || attendance.library_id || ''));
      if (branch && isInRange(attendance.timeIn || attendance.time_in)) branch.checkIns += 1;
    });

    const booksById = new Map(books.map((book) => [String(book.id), book]));
    if (!borrowRequestsLoadError) borrowRequests.forEach((request) => {
      const transactionDate = request.borrowDate || request.borrow_date || request.requestDate || request.request_date;
      if (!isInRange(transactionDate)) return;
      const branchId = getRequestLibraryId(request, booksById);
      const branch = counts.get(branchId);
      if (branch) branch.transactions += 1;
    });

    const topBranches = [...counts.values()]
      .filter((branch) => branch.checkIns > 0 || branch.transactions > 0)
      .sort((a, b) => (b.checkIns + b.transactions) - (a.checkIns + a.transactions) || a.name.localeCompare(b.name))
      .slice(0, 5);

    return {
      labels: topBranches.map((branch) => branch.name),
      checkIns: topBranches.map((branch) => branch.checkIns),
      transactions: borrowRequestsLoadError ? topBranches.map(() => null) : topBranches.map((branch) => branch.transactions),
    };
  }, [libraries, attendanceLogs, borrowRequests, books, overviewMonth, borrowRequestsLoadError]);

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
          Object.keys(counts).map(formatBookCategory),
        values:
          Object.values(
            counts
          ),
      };
    }, [books]);

  // ============================================================
  // UI
  // ============================================================
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
    <div className="superadmin-dashboard flex h-dvh min-h-0 w-full overflow-hidden bg-shelf-bg text-slate-800 dark:bg-slate-900 dark:text-slate-100 flex-row">
      {/* SIDEBAR (FULL HEIGHT TO TOP) */}
      <aside className="superadmin-sidebar relative flex h-full w-60 shrink-0 flex-col overflow-hidden bg-shelf-primary text-white z-20">
        {/* SHELF BRAND LOGO IN SIDEBAR */}
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
          <button
            type="button"
            onClick={() => {
              setSection('overview');
              setStaffError('');
              setStaffMessage('');
            }}
            className="flex items-center gap-2.5 text-left cursor-pointer transition hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded-lg"
            aria-label="Go to Super-Admin dashboard"
          >
            <img src="/shelf-logo.png" alt="" className="h-8 w-8 object-contain" />
            <span className="text-lg font-extrabold tracking-wider text-white">
              SHELF
            </span>
          </button>
        </div>

        <div className="border-b border-white/10 p-4">
          <div className="border-l-[3px] border-blue-400 pl-3">
            <p className="text-sm font-bold leading-tight text-white">{superAdminName}</p>
            <span className="mt-1 inline-flex rounded-full border border-blue-200/40 bg-blue-400/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-100">Super-admin</span>
            <p className="mt-1 text-xs font-medium text-blue-100/75">{t('System console')}</p>
          </div>
        </div>

          {/* NAVIGATION */}
          <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
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
                  ? 'bg-shelf-accent font-bold text-white ring-1 ring-inset ring-blue-200/40 shadow-[0_4px_14px_rgba(37,99,235,0.38)]'
                  : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              <Activity size={18} className="mr-3 inline-block align-[-3px]" />
              {t('Overview & analytics')}
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
                  ? 'bg-shelf-accent font-bold text-white ring-1 ring-inset ring-blue-200/40 shadow-[0_4px_14px_rgba(37,99,235,0.38)]'
                  : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              <BookOpen size={18} className="mr-3 inline-block align-[-3px]" />
              {t('Inventory')}
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
                  ? 'bg-shelf-accent font-bold text-white ring-1 ring-inset ring-blue-200/40 shadow-[0_4px_14px_rgba(37,99,235,0.38)]'
                  : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              <MapPinned size={18} className="mr-3 inline-block align-[-3px]" />
              {t('Libraries & map')}
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
                  ? 'bg-shelf-accent font-bold text-white ring-1 ring-inset ring-blue-200/40 shadow-[0_4px_14px_rgba(37,99,235,0.38)]'
                  : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              <ShieldCheck size={18} className="mr-3 inline-block align-[-3px]" />
              {t('Staff accounts')}
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
                  ? 'bg-shelf-accent font-bold text-white ring-1 ring-inset ring-blue-200/40 shadow-[0_4px_14px_rgba(37,99,235,0.38)]'
                  : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              <UsersRound size={18} className="mr-3 inline-block align-[-3px]" />
              {t('Visitor accounts')}
            </button>

            <button
              type="button"
              onClick={() => setSection('fines')}
              className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition ${section === 'fines' ? 'bg-shelf-accent font-bold text-white ring-1 ring-inset ring-blue-200/40 shadow-[0_4px_14px_rgba(37,99,235,0.38)]' : 'text-slate-300 hover:bg-white/5'}`}
            >
              <CircleDollarSign size={18} className="mr-3 inline-block align-[-3px]" />
              {t('Fine Payments')}
            </button>
            <button
              type="button"
              onClick={() => setSection('subscriptions')}
              className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition ${section === 'subscriptions' ? 'bg-shelf-accent font-bold text-white ring-1 ring-inset ring-blue-200/40 shadow-[0_4px_14px_rgba(37,99,235,0.38)]' : 'text-slate-300 hover:bg-white/5'}`}
            >
              <Building2 size={18} className="mr-3 inline-block align-[-3px]" aria-hidden="true" />
              {t('Subscriptions')}
            </button>

            <button
              type="button"
              onClick={() => setSection('settings')}
              className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition ${section === 'settings' ? 'bg-shelf-accent font-bold text-white ring-1 ring-inset ring-blue-200/40 shadow-[0_4px_14px_rgba(37,99,235,0.38)]' : 'text-slate-300 hover:bg-white/5'}`}
            >
              <Settings size={18} className="mr-3 inline-block align-[-3px]" />
              {t('Settings')}
            </button>

            {/* REPORTS & SERVICES COLLAPSIBLE */}
            <div>
              <button
                type="button"
                onClick={() => setWorkspaceOpen((prev) => !prev)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition ${
                  section === 'workspace'
                    ? 'bg-shelf-accent font-bold text-white ring-1 ring-inset ring-blue-200/40 shadow-[0_4px_14px_rgba(37,99,235,0.38)]'
                    : 'text-slate-300 hover:bg-white/5'
                }`}
              >
                <span className="flex items-center gap-3">
                  <FileSpreadsheet size={18} />
                  {t('Reports & services')}
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
                        ? 'bg-shelf-accent/25 font-bold text-white shadow-[inset_2px_0_0_0_#bfdbfe]'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {t('Reports')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSection('workspace');
                      setActiveTab('analytics');
                    }}
                    className={`w-full rounded-md px-3 py-1.5 text-left text-xs transition ${
                      section === 'workspace' && activeTab === 'analytics'
                        ? 'bg-shelf-accent/25 font-bold text-white shadow-[inset_2px_0_0_0_#bfdbfe]'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {t('Analytics')}
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
                    ? 'bg-shelf-accent font-bold text-white ring-1 ring-inset ring-blue-200/40 shadow-[0_4px_14px_rgba(37,99,235,0.38)]'
                    : 'text-slate-300 hover:bg-white/5'
                }`}
              >
                <span className="flex items-center gap-3">
                  <MessageSquare size={18} />
                  {t('Communication')}
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
                        ? 'bg-shelf-accent/25 font-bold text-white shadow-[inset_2px_0_0_0_#bfdbfe]'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {t('Feedback')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSection('communication');
                      setActiveTab('announcements');
                    }}
                    className={`w-full rounded-md px-3 py-1.5 text-left text-xs transition ${
                      section === 'communication' && activeTab === 'announcements'
                        ? 'bg-shelf-accent/25 font-bold text-white shadow-[inset_2px_0_0_0_#bfdbfe]'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {t('Announcements')}
                  </button>
                </div>
              )}
            </div>
          </nav>

        </aside>

        {/* MAIN WORKSPACE COLUMN */}
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {/* TOP BAR WITH SHELFHEADER */}
          <ShelfHeader
            showLogo={false}
            notificationCount={superAdminNotifications.filter((item) => !readSuperAdminNotificationIds.has(String(item.id))).length}
            notificationItems={superAdminNotifications.map((n) => ({
              ...n,
              created_at: new Date(n.timestamp).toISOString(),
              read: readSuperAdminNotificationIds.has(String(n.id)),
              readAt: readSuperAdminNotificationIds.has(String(n.id)) ? new Date(n.timestamp).toISOString() : null,
            }))}
            onNotificationClick={handleSuperAdminNotificationClick}
            showDarkModeToggle={true}
          >
            {/* Breadcrumb & Global Badge in Center */}
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <button
                type="button"
                onClick={() => setSection('overview')}
                className="shrink-0 font-medium text-slate-500 transition hover:text-shelf-accent dark:text-slate-400"
              >
                {t('Dashboard')}
              </button>
              {section !== 'overview' && (
                <>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">/</span>
                  <span className="truncate font-semibold text-shelf-primary dark:text-white">
                    {t(section === 'workspace'
                      ? (activeTab === 'analytics' ? 'Analytics' : 'Reports')
                      : section === 'communication'
                        ? (activeTab === 'announcements' ? 'Announcements' : 'Feedback')
                        : ({ inventory: 'Inventory', map: 'Libraries & map', accounts: 'Staff accounts', 'visitor-accounts': 'Visitor accounts', fines: 'Fine Payments', subscriptions: 'Subscriptions', settings: 'Settings' }[section] || 'Dashboard'))}
                  </span>
                </>
              )}
              <span className="hidden md:inline-flex ml-2 max-w-xs min-w-0 items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <Globe size={13} className="shrink-0 text-shelf-accent" aria-hidden="true" />
                <span className="truncate">{t('All libraries')}</span>
              </span>
            </div>
          </ShelfHeader>

          {/* MAIN CONTENT */}
          <main
            ref={mainScrollRef}
            className="min-h-0 min-w-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4 sm:p-6 lg:p-8"
          >
            {section === 'overview' && <DashboardWelcome
              name={superAdminName.split(' ')[0]}
              description="System metrics, library operations, staff accounts, and reports at a glance."
              showNotifications={false}
              onNotificationFollowUp={handleOverdueFollowUp}
              actions={[
                { label: 'View Inventory', Icon: BookOpen, onClick: () => setSection('inventory') },
                { label: 'Manage Staff', Icon: ShieldCheck, onClick: () => setSection('accounts') },
                { label: 'Open Reports', Icon: FileSpreadsheet, onClick: () => { setSection('workspace'); setActiveTab('reports'); } },
              ]}
            />}

          {/* OVERVIEW */}
          {section === 'overview' && (
            <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <StatCard label="Registered Visitors" value={visitorCount ?? '—'} tone="blue" />
              <StatCard label="Titles in Catalog" value={books.length} />
              <StatCard label="Active Borrows" value={activeBorrows} />
              <StatCard label="Overdue Items" value={overdue} tone="red" />
              <StatCard label="Branches Open" value={openLibraries} tone="amber" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div><h3 className="text-sm font-bold text-slate-800">System activity analytics</h3><p className="mt-0.5 text-xs text-slate-500">Counts reflect recorded events in the selected calendar month.</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">Year<select aria-label="Filter overview charts by year" value={overviewYear} onChange={(event) => { const year = Number(event.target.value); setOverviewYear(year); const lastMonth = year === new Date().getFullYear() ? new Date().getMonth() + 1 : 12; setOverviewMonth(`${year}-${String(lastMonth).padStart(2, '0')}`); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">{getAnalyticsYearOptions().map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">Month<select aria-label="Filter overview charts by month" value={overviewMonth} onChange={(event) => setOverviewMonth(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">{overviewMonthOptions.map((month) => <option key={month.value} value={month.value}>{month.label.replace(/\s+\d{4}$/, '')}</option>)}</select></label>
              </div>
            </div>
            {borrowRequestsLoadError && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><span>Borrowing history failed to load: {borrowRequestsLoadError}</span><button type="button" onClick={() => void retryBorrowRequests()} className="rounded-lg bg-amber-900 px-3 py-2 text-xs font-bold text-white">Try again</button></div>}

            {/* CHARTS */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-blue-700">Descriptive analytics</p>
                <h3 className="mt-1 text-sm font-bold text-slate-800">Check-ins & Confirmed Borrows · {trendData.monthLabel}</h3>
                <p className="mb-3 mt-1 text-xs text-slate-500">Daily comparison of visitor check-ins and completed book pickups across all libraries.</p>
                <div className="h-82.5">
                  <DeferredChart type="line"
                    data={{
                      labels: trendData.labels,
                      datasets: [
                        { label: 'Visitor check-ins', data: trendData.visitCounts, borderColor: '#2563eb', backgroundColor: '#2563eb', tension: 0.3 },
                        { label: trendData.borrowDataAvailable ? 'Confirmed borrow events' : 'Confirmed borrow events (unavailable)', data: trendData.borrowDataAvailable ? trendData.borrowCounts : trendData.borrowCounts.map(() => null), borderColor: '#002046', backgroundColor: '#002046', tension: 0.3 },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      scales: {
                        x: { ticks: { autoSkip: true, maxTicksLimit: 10, maxRotation: 0 } },
                        y: { beginAtZero: true, ticks: { precision: 0 } },
                      },
                      plugins: {
                        legend: { position: 'bottom' },
                        tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${context.raw}` } },
                      },
                    }}
                  />
                </div>
                {!trendData.hasActivity && (
                  <p className="mt-2 text-center text-xs text-slate-500">
                    {borrowRequestsLoadError ? `No attendance was recorded for ${trendData.monthLabel}; borrowing activity is unavailable because its history request failed.` : `No attendance or completed borrowing activity was recorded for ${trendData.monthLabel}.`}
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-blue-700">Descriptive analytics</p>
                <h3 className="mt-1 text-sm font-bold text-slate-800">All-Time Catalog Titles by Category</h3>
                <p className="mb-3 mt-1 text-xs text-slate-500">Shows the current catalog title count in each category.</p>
                {categoryData.labels.length === 0 ? (
                  <p className="text-xs text-slate-500">No books in the catalog yet.</p>
                ) : (
                  <div className="h-82.5">
                    <DeferredChart type="bar"
                      data={{
                        labels: categoryData.labels,
                        datasets: [{ label: 'Titles', data: categoryData.values, backgroundColor: '#2563eb' }],
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                          y: { beginAtZero: true, ticks: { precision: 0 } },
                          x: {
                            ticks: {
                              autoSkip: false,
                              maxRotation: 50,
                              minRotation: 50,
                              font: { size: 9 },
                              callback(value) {
                                const label = this.getLabelForValue(value);
                                return label.length > 12 ? `${label.slice(0, 11)}…` : label;
                              },
                            },
                          },
                        },
                        plugins: {
                          legend: { display: false },
                          tooltip: {
                            callbacks: {
                              title: (items) => categoryData.labels[items[0]?.dataIndex] || '',
                              label: (context) => `${context.parsed.y} titles`,
                            },
                          },
                        },
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-3">
              <div className="h-full lg:col-span-1 [&>section]:h-full">
                <Suspense fallback={<p className="p-4 text-sm text-slate-500">Loading ratings chart…</p>}>
                  <BookRatingsChart books={books} fillHeight />
                </Suspense>
              </div>
              <div className="h-full rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
                <div className="mb-3">
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-blue-700">Descriptive analytics</p>
                  <h3 className="text-sm font-bold text-slate-800">Branch visits and book borrows</h3>
                <p className="mt-1 text-xs text-slate-500">{trendData.monthLabel}. Each borrow request is counted once. Records with conflicting branch details are left out{borrowRequestsLoadError ? ', and borrowing data is currently unavailable.' : '.'}</p>
                </div>
                {branchActivityData.labels.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500">{borrowRequestsLoadError ? `No branch check-ins were recorded in ${trendData.monthLabel}; request/borrow activity is unavailable because its history request failed.` : `No branch check-ins or request/borrow activity was recorded in ${trendData.monthLabel}.`}</p>
                ) : (
                  <div className="h-80">
                    <DeferredChart type="bar"
                      data={{
                        labels: branchActivityData.labels,
                        datasets: [
                          { label: 'Visitor check-ins', data: branchActivityData.checkIns, backgroundColor: '#2563eb', borderRadius: 5 },
                          { label: 'Book request/borrow records', data: branchActivityData.transactions, backgroundColor: '#f59e0b', borderRadius: 5 },
                        ],
                      }}
                      options={{
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
                        plugins: {
                          legend: { position: 'bottom' },
                          tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${context.raw} records` } },
                        },
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-blue-700">Descriptive analytics</p>
                <h3 className="text-sm font-bold text-slate-800">Book copies by branch</h3>
                <p className="mt-1 text-xs text-slate-500">Current copy counts; “not available” includes copies currently on loan or otherwise unavailable.</p>
              </div>
              {branchInventoryData.labels.length ? <div className="h-80">
                <DeferredChart type="bar"
                  data={{
                    labels: branchInventoryData.labels,
                    datasets: [
                      { label: 'Available now', data: branchInventoryData.available, backgroundColor: '#16a34a', borderRadius: 4 },
                      { label: 'Not available now', data: branchInventoryData.unavailable, backgroundColor: '#f59e0b', borderRadius: 4 },
                    ],
                  }}
                  options={{
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { x: { beginAtZero: true, stacked: true, ticks: { precision: 0 } }, y: { stacked: true } },
                    plugins: {
                      legend: { position: 'bottom' },
                      tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${context.raw} copies` } },
                    },
                  }}
                />
              </div> : <p className="py-8 text-center text-sm text-slate-500">No branch book copies are available to compare.</p>}
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
                  <label className="cursor-pointer rounded-lg bg-shelf-accent px-3.5 py-2 text-xs font-bold text-white transition hover:brightness-90">
                    <Upload size={14} className="mr-1.5 inline-block align-[-2px]" aria-hidden="true" />
                    Import File
                    <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>
              </div>
              {importTarget === 'books' && (
                <p className="text-xs text-slate-600">
                  Book imports require a <code>fine_rate</code> whole number from 1 to 100 pesos per overdue day and <code>lending_period_days</code> from 1 to 30. Both values are saved per book; fine rates are not derived from category.
                </p>
              )}
              <div className="grid grid-cols-1 gap-4 pt-1 sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 p-3.5">
                  <div>
                    <p className="text-xs font-bold text-slate-700">
                      <BookOpen size={14} className="mr-1.5 inline-block align-[-2px]" aria-hidden="true" />
                       Master Library Catalog
                    </p>
                    <p className="text-xs text-slate-500">Total Titles: {books.length}</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" disabled={Boolean(exportingReport)} onClick={() => exportSystemReport('books', 'xlsx')} className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-700">{exportingReport === 'books-xlsx' ? 'Exporting…' : 'Excel'}</button>
                    <button type="button" disabled={Boolean(exportingReport)} onClick={() => exportSystemReport('books', 'csv')} className="rounded bg-slate-700 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-slate-800">{exportingReport === 'books-csv' ? 'Exporting…' : 'CSV'}</button>
                    <button type="button" disabled={Boolean(exportingReport)} onClick={() => exportSystemReport('books', 'pdf')} className="rounded bg-rose-700 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-rose-800">{exportingReport === 'books-pdf' ? 'Exporting…' : 'PDF'}</button>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 p-3.5">
                  <div>
                    <p className="text-xs font-bold text-slate-700"><Building2 size={14} className="mr-1.5 inline-block align-[-2px]" aria-hidden="true" />Multi-Branch Asset Allocation</p>
                    <p className="text-xs text-slate-500">Institutional stock by branch</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" disabled={Boolean(exportingReport)} onClick={() => exportSystemReport('allocation', 'xlsx')} className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-700">Excel</button>
                    <button type="button" disabled={Boolean(exportingReport)} onClick={() => exportSystemReport('allocation', 'csv')} className="rounded bg-slate-700 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-slate-800">CSV</button>
                    <button type="button" disabled={Boolean(exportingReport)} onClick={() => exportSystemReport('allocation', 'pdf')} className="rounded bg-rose-700 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-rose-800">PDF</button>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 p-3.5">
                  <div>
                    <p className="text-xs font-bold text-slate-700">
                      <Activity size={14} className="mr-1.5 inline-block align-[-2px]" aria-hidden="true" />
                      Total Attendance
                    </p>
                    <p className="text-xs text-slate-500">Attendance records loaded: {attendanceLogs.length.toLocaleString()}</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" disabled={Boolean(exportingReport)} onClick={() => exportSystemReport('attendance', 'xlsx')} className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-700">{exportingReport === 'attendance-xlsx' ? 'Exporting…' : 'Excel'}</button>
                    <button type="button" disabled={Boolean(exportingReport)} onClick={() => exportSystemReport('attendance', 'csv')} className="rounded bg-slate-700 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-slate-800">{exportingReport === 'attendance-csv' ? 'Exporting…' : 'CSV'}</button>
                    <button type="button" disabled={Boolean(exportingReport)} onClick={() => exportSystemReport('attendance', 'pdf')} className="rounded bg-rose-700 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-rose-800">{exportingReport === 'attendance-pdf' ? 'Exporting…' : 'PDF'}</button>
                  </div>
                </div>
              </div>
              {exportMessage && <p role="status" className="mt-3 text-sm text-emerald-700">{exportMessage}</p>}
              {exportError && <p role="alert" className="mt-3 text-sm text-rose-700">{exportError}</p>}
            </div>

          </div>
        )}

        {/* INVENTORY */}
        {section === 'inventory' && <div className="space-y-4"><AdminSectionInsights title="Books that may run low" description={`Borrowing history through ${inventoryDemand.periodLabel || 'the selected month'}; the next-month estimate uses the recent monthly average.`} metrics={[{ label: 'Titles in catalog', value: books.length.toLocaleString() }, { label: 'Copies available now', value: inventorySummary.available.toLocaleString() }, { label: 'Titles with no copies available', value: inventorySummary.unavailableTitles.toLocaleString() }, { label: `Often borrowed, 0–1 copies left · ${inventoryDemand.periodLabel}`, value: borrowRequestsLoadError ? '—' : inventoryDemand.atRiskTitles.length.toLocaleString() }]} prediction={borrowRequestsLoadError ? 'Borrowing records could not be loaded, so the system cannot estimate demand.' : inventoryBorrowingProjection.projectedNextMonth == null ? 'There is not enough confirmed borrowing history to estimate next month.' : `If recent borrowing continues, about ${inventoryBorrowingProjection.projectedNextMonth} books may be borrowed next month.`} predictionSeries={borrowRequestsLoadError ? null : inventoryBorrowingProjection} recommendation={borrowRequestsLoadError ? 'Load borrowing history before changing copy counts.' : inventoryDemand.atRiskTitles.length ? `Check current loans and branch copies for ${inventoryDemand.atRiskTitles[0].book.title}; add or move copies if needed.` : inventorySummary.unavailableTitles ? 'Review books with no copies available against current loans and returns before ordering more.' : 'Keep copy counts updated and review the borrowing trend after each month.'} /><BookInventory /></div>}

        {section === 'settings' && (
          <section className="w-full max-w-6xl space-y-5">
            <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-shelf-primary">
                  <Settings size={21} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">{t('System console')}</p>
                  <h2 className="mt-1 text-2xl font-bold text-shelf-primary">{t('Settings')}</h2>
                  <p className="mt-1 text-sm text-slate-600">{t('Manage your account security, terms documents, and dashboard preferences.')}</p>
                </div>
              </div>
            </header>
            <div className="grid gap-5 xl:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-base font-bold text-slate-900">{t('Administrator account')}</h3>
                <dl className="mt-4 divide-y divide-slate-100 text-sm">
                  <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500">{t('Name')}</dt><dd className="text-right font-semibold text-slate-800">{user?.name || superAdminName}</dd></div>
                  <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500">{t('Email')}</dt><dd className="break-all text-right font-semibold text-slate-800">{user?.email || 'Not available'}</dd></div>
                  <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500">Access level</dt><dd className="text-right font-semibold text-slate-800">Super Admin · All libraries</dd></div>
                </dl>
              </section>
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-base font-bold text-slate-900">{t('Dashboard preferences')}</h3>
                <label className="mt-4 block text-sm font-semibold text-slate-700" htmlFor="superadmin-start-page">{t('Open this page when I sign in')}</label>
                <select id="superadmin-start-page" defaultValue={window.localStorage.getItem('shelf_superadmin_start_page') || 'overview'} onChange={(event) => window.localStorage.setItem('shelf_superadmin_start_page', event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 focus:border-shelf-primary focus:outline-none focus:ring-2 focus:ring-shelf-primary/20">
                  <option value="overview">{t('Overview & analytics')}</option><option value="inventory">{t('Inventory')}</option><option value="map">{t('Libraries & map')}</option><option value="accounts">{t('Staff accounts')}</option><option value="visitor-accounts">Visitor accounts</option>
                </select>
                <p className="mt-2 text-xs leading-5 text-slate-500">{t('This preference is saved on this device and used on your next sign-in.')}</p>
              </section>
            </div>
            <PreferredLanguageSetting />
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <h3 className="text-base font-bold text-slate-900">{t('Account security')}</h3>
              <p className="mt-1 text-sm text-slate-600">{t('Super Admin sign-ins require an authenticator code. You can update your password here.')}</p>
              <form onSubmit={updateAdminPassword} className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-700">{t('New password')}<input type="password" required autoComplete="new-password" value={newAdminPassword} onChange={(event) => setNewAdminPassword(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal text-slate-900 focus:border-shelf-primary focus:outline-none focus:ring-2 focus:ring-shelf-primary/20" /></label>
                <label className="text-xs font-semibold text-slate-700">{t('Confirm password')}<input type="password" required autoComplete="new-password" value={confirmAdminPassword} onChange={(event) => setConfirmAdminPassword(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal text-slate-900 focus:border-shelf-primary focus:outline-none focus:ring-2 focus:ring-shelf-primary/20" /></label>
                <p className="text-xs text-slate-500 sm:col-span-2">{t('At least 12 characters, with uppercase and lowercase letters, a number, and a symbol.')}</p>
                <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><button type="submit" disabled={passwordSaving || !newAdminPassword || !confirmAdminPassword} className="rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{passwordSaving ? 'Updating…' : 'Update password'}</button>{passwordFeedback.message && <p role="status" className="text-sm font-semibold text-emerald-700">{passwordFeedback.message}</p>}{passwordFeedback.error && <p role="alert" className="text-sm font-semibold text-rose-700">{passwordFeedback.error}</p>}</div>
              </form>
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="text-base font-bold text-slate-900">{t('Terms and Conditions')}</h3><p className="mt-1 text-sm text-slate-600">Edit the terms shown to visitors or sub-admins. Saving a revision requires users to acknowledge the new version.</p></div>
                {termsDocumentVersion && <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">Current version: {termsDocumentVersion}</span>}
              </div>
              <form onSubmit={saveTermsEditor} className="mt-4 space-y-3">
                <label htmlFor="admin-terms-document" className="block text-sm font-semibold text-slate-700">Document to edit</label>
                <select id="admin-terms-document" value={termsDocumentKey} onChange={(event) => { setTermsDocumentKey(event.target.value); void loadTermsEditor(event.target.value); }} className="w-full max-w-sm rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 focus:border-shelf-primary focus:outline-none focus:ring-2 focus:ring-shelf-primary/20">
                  <option value="visitor">Visitor Terms and Conditions</option>
                  <option value="subadmin">Sub-admin Terms and Conditions</option>
                </select>
                <textarea value={termsDocumentContent} onChange={(event) => setTermsDocumentContent(event.target.value)} rows={16} disabled={termsEditorLoading} aria-label="Terms document content" className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm leading-6 text-slate-800 focus:border-shelf-primary focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 disabled:bg-slate-50" placeholder={termsEditorLoading ? 'Loading terms…' : 'Terms text will appear here.'} />
                <p className="text-xs text-slate-500">Use a blank line between paragraphs. Keep the terms clear and review privacy or legal changes before publishing.</p>
                <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={termsEditorSaving || termsEditorLoading || !termsDocumentContent.trim()} className="rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">{termsEditorSaving ? 'Saving terms…' : 'Save and publish revision'}</button>{termsEditorMessage && <p role="status" className="text-sm font-semibold text-emerald-700">{termsEditorMessage}</p>}</div>
                {termsEditorError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">{termsEditorError}</p>}
              </form>
              <div className="sr-only" aria-hidden="true"><div ref={visitorTermsPreviewRef}><VisitorTermsContent /></div><div ref={subAdminTermsPreviewRef}><SubAdminTermsContent /></div></div>
            </section>
          </section>
        )}

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
                  {showAddLibrary ? 'Cancel' : '+ Add library'}
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
                          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
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
                          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                        />
                      </div>

                      {/* ADDRESS */}
                      <div className="md:col-span-2">
                        <label className="mb-1 block text-xs font-semibold text-slate-600">
                          Address *
                        </label>
                        <GeoapifyAddressInput
                          value={libraryForm.address}
                          onChange={(address) => {
                            geocodeRequestId.current += 1;
                            setGeocodingAddress(false);
                            setGeocodingMessage('');
                            setLibraryForm((prev) => ({ ...prev, address, lat: '', lng: '' }));
                          }}
                          onPlaceSelected={({ address, lat, lng }) => {
                            geocodeRequestId.current += 1;
                            setGeocodingAddress(false);
                            setGeocodingMessage('Place selected; map pin updated automatically.');
                            setMapPosition([lat, lng]);
                            setLibraryForm((prev) => ({
                              ...prev,
                              address,
                              lat: lat.toFixed(6),
                              lng: lng.toFixed(6),
                            }));
                          }}
                          onBlur={() => {
                            if (!libraryForm.lat || !libraryForm.lng) void geocodeLibraryAddress();
                          }}
                          placeholder="Complete library address"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                          required
                        />
                        {(geocodingAddress || geocodingMessage) && (
                          <p className={`mt-1 text-xs ${geocodingMessage.startsWith('Could not') || geocodingMessage.includes('unavailable') ? 'text-rose-600' : 'text-slate-500'}`} aria-live="polite">
                            {geocodingAddress ? 'Finding this address on the map…' : geocodingMessage}
                          </p>
                        )}
                      </div>

                      {/* Library visitor access mode */}
                      <div className="md:col-span-2">
                        <label htmlFor="library-visitor-access-mode" className="mb-1 block text-xs font-semibold text-slate-600">
                          Library Type *
                        </label>
                        <select
                          id="library-visitor-access-mode"
                          value={libraryForm.visitorAccessMode}
                          onChange={(event) => setLibraryForm((prev) => ({
                            ...prev,
                            visitorAccessMode: event.target.value,
                          }))}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                          required
                        >
                          <option value="institutional">Institutional Library (email domain required)</option>
                          <option value="public">Public Library (open registration)</option>
                        </select>
                        <p className="mt-1.5 text-xs leading-normal text-slate-500">
                          Public libraries allow visitors to register with any verified email and activate automatically after email verification.
                        </p>
                      </div>

                      {/* Partner email domain */}
                      <div className="md:col-span-2">
                        <label className="mb-1 block text-xs font-medium text-slate-700">
                          Allowed Partner Email Domain {libraryForm.visitorAccessMode !== 'public' ? '*' : '(optional)'}
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
                            placeholder="e.g. library.example.gov.ph"
                            className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2.5 text-sm focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                            required={libraryForm.visitorAccessMode !== 'public'}
                          />
                        </div>
                        <p className="text-xs text-slate-500 mt-1.5 leading-normal">
                          {libraryForm.visitorAccessMode === 'public'
                            ? 'No school or organization domain is needed. If you provide one, it must be an official domain; personal email providers such as Gmail are not accepted.'
                            : 'Enter the official domain used by the institution or its parent organization. Personal email providers such as Gmail are not accepted.'}
                        </p>
                      </div>

                      {/* MAP PICKER COMPONENT */}
                      <div className="md:col-span-2 my-1">
                          <label className="mb-1 block text-xs font-semibold text-slate-600">
                            Automatically located pin (adjust only if needed)
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
                          Latitude
                        </label>
                        <input
                          type="text"
                          readOnly
                          value={libraryForm.lat}
                          className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2.5 text-sm text-slate-600 cursor-not-allowed"
                        />
                      </div>

                      {/* LONGITUDE (READ ONLY) */}
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">
                          Longitude
                        </label>
                        <input
                          type="text"
                          readOnly
                          value={libraryForm.lng}
                          className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2.5 text-sm text-slate-600 cursor-not-allowed"
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
                          {t('Status')}
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
                        Use current location
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAddLibrary(false)}
                        className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100"
                      >
                        {t('Cancel')}
                      </button>
                      <button
                        type="submit"
                        disabled={savingLibrary || geocodingAddress}
                        className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {savingLibrary ? (editingLibraryId ? 'Saving...' : 'Adding...') : (editingLibraryId ? 'Save Changes' : 'Add library')}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* MAIN LIBRARY MAP */}
{!showAddLibrary && (
  <LibraryMap
    showLibraryList={false}
    showRowsPerPageControl
    rowsPerPage={librariesPerPage}
    onRowsPerPageChange={(value) => {
      setLibrariesPerPage(value);
      setLibraryPage(1);
    }}
  />
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
                  paginatedLibraries.map((library) => (
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
                          {t('Edit')}
                        </button>

                        <button
                          type="button"
                          data-confirm-message={`Delete library "${library.name || 'this library'}"? This cannot be undone.`}
                          onClick={() => handleDeleteLibrary(library)}
                          className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
                {libraries.length > 0 && (
                  <div className="flex flex-col gap-3 rounded-xl border border-shelf-border bg-white px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-slate-600">
                      Showing {(visibleLibraryPage - 1) * librariesPerPage + 1}–{Math.min(visibleLibraryPage * librariesPerPage, libraries.length)} of {libraries.length} libraries
                    </p>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <button
                        type="button"
                        onClick={() => setLibraryPage((page) => Math.max(1, Math.min(page, libraryPageCount) - 1))}
                        disabled={visibleLibraryPage === 1}
                        className="rounded-lg border border-shelf-border px-3 py-2 font-semibold text-shelf-primary transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Previous
                      </button>
                      <PageJump page={visibleLibraryPage} pageCount={libraryPageCount} onPageChange={setLibraryPage} className="whitespace-nowrap text-slate-600" />
                      <button
                        type="button"
                        onClick={() => setLibraryPage((page) => Math.min(libraryPageCount, Math.min(page, libraryPageCount) + 1))}
                        disabled={visibleLibraryPage === libraryPageCount}
                        className="rounded-lg border border-shelf-border px-3 py-2 font-semibold text-shelf-primary transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  </div>
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

        {section === 'fines' && <FinePayments isSuperAdmin libraries={libraries} />}
        {section === 'subscriptions' && <SubscriptionManagement mode="superadmin" />}

        {section === 'accounts' && (
          <div className="space-y-6">
            <header className="border-b border-slate-200 pb-4">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">Administration</p>
              <h2 className="text-lg font-bold text-slate-800">Staff Accounts</h2>
              <p className="mt-1 text-sm text-slate-500">Manage database-backed sub-admin and circulation staff accounts.</p>
            </header>
            <section aria-labelledby="staff-account-guide-title" className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
              <h3 id="staff-account-guide-title" className="text-sm font-bold text-shelf-primary">How staff accounts work</h3>
              <ol className="mt-3 grid gap-3 sm:grid-cols-3">
                <li className="flex gap-3 rounded-lg bg-white/80 p-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-shelf-primary text-xs font-bold text-white">1</span>
                  <span><strong className="block text-sm text-slate-800">Create an account</strong><span className="mt-1 block text-xs leading-5 text-slate-600">Enter the staff member’s details, set a temporary password, and assign a library.</span></span>
                </li>
                <li className="flex gap-3 rounded-lg bg-white/80 p-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-shelf-primary text-xs font-bold text-white">2</span>
                  <span><strong className="block text-sm text-slate-800">Staff signs in</strong><span className="mt-1 block text-xs leading-5 text-slate-600">They use their account credentials and work in the assigned library’s console.</span></span>
                </li>
                <li className="flex gap-3 rounded-lg bg-white/80 p-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-shelf-primary text-xs font-bold text-white">3</span>
                  <span><strong className="block text-sm text-slate-800">Manage access</strong><span className="mt-1 block text-xs leading-5 text-slate-600">Edit account details or disable the account when staff access is no longer needed.</span></span>
                </li>
              </ol>
            </section>
            {staffError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{staffError}</div>
            )}
            {staffMessage && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{staffMessage}</div>
            )}
            {editingStaffId && <div className="fixed inset-0 z-40 bg-shelf-primary/55 backdrop-blur-[2px]" aria-hidden="true" />}
            <form
              onSubmit={handleCreateStaff}
              aria-labelledby="staff-account-form-title"
              role={editingStaffId ? 'dialog' : undefined}
              aria-modal={editingStaffId ? 'true' : undefined}
              className={editingStaffId
                ? 'fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-blue-200 bg-white p-5 shadow-2xl'
                : 'rounded-xl border border-blue-200 bg-white p-5 shadow-sm'}
            >
              <div className="mb-5">
                <h3 id="staff-account-form-title" className="font-serif text-xl font-bold text-shelf-primary">
                  {editingStaffId ? 'Edit Sub-Admin Account' : 'Create Sub-Admin Account'}
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Full Name</label>
                  <input type="text" value={staffForm.fullName} onChange={(e) => setStaffForm((prev) => ({ ...prev, fullName: e.target.value }))} placeholder="e.g. Juan Dela Cruz" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" required />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">{t('Email')}</label>
                  <input type="email" value={staffForm.email} onChange={(e) => setStaffForm((prev) => ({ ...prev, email: e.target.value }))} placeholder="staff@shelf.edu" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" required />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    {editingStaffId ? 'New Password (Optional)' : 'Temporary Password'}
                  </label>
                  <div className="relative">
                    <input
                      type={showStaffTemporaryPassword ? 'text' : 'password'}
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
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-11 text-sm"
                      required={!editingStaffId}
                    />
                    <button
                      type="button"
                      onClick={() => setShowStaffTemporaryPassword((shown) => !shown)}
                      aria-label={showStaffTemporaryPassword ? 'Hide temporary password' : 'Show temporary password'}
                      aria-pressed={showStaffTemporaryPassword}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-500 hover:text-shelf-primary"
                    >
                      {showStaffTemporaryPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
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
            <div className={`mt-5 flex flex-wrap gap-3 ${editingStaffId ? 'justify-end' : ''}`}>
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
                  {t('Cancel')}
                </button>
              )}
              <button
                type="submit"
                disabled={staffLoading}
                className="rounded-lg bg-shelf-primary px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#003568] disabled:opacity-50"
              >
                {staffLoading
                  ? 'Saving...'
                  : editingStaffId
                    ? 'Save changes'
                    : 'Create sub-admin'}
              </button>
            </div>
            </form>
            <section aria-labelledby="staff-directory-title" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Section 2</p>
                  <h3 id="staff-directory-title" className="mt-1 text-sm font-bold text-slate-800">Registered Staff Accounts</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Showing {filteredStaffAccounts.length} of {staffAccounts.length} accounts.
                  </p>
                </div>
                <button type="button" onClick={loadStaffAccounts} disabled={staffLoading} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  {staffLoading ? 'Loading...' : 'Refresh'}
                </button>
              </div>
              <div className="grid gap-3 border-b border-slate-100 bg-slate-50/70 p-4 sm:grid-cols-2 lg:grid-cols-5">
                <input
                  type="search"
                  value={staffSearch}
                  onChange={(event) => {
                    setStaffSearch(event.target.value);
                    setStaffPage(1);
                  }}
                  placeholder="Search name or email"
                  aria-label="Search staff accounts by name or email"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-shelf-primary focus:ring-2 focus:ring-shelf-primary/20"
                />
                <select
                  value={staffBranchFilter}
                  onChange={(event) => {
                    setStaffBranchFilter(event.target.value);
                    setStaffPage(1);
                  }}
                  aria-label="Filter staff accounts by branch"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-shelf-primary focus:ring-2 focus:ring-shelf-primary/20"
                >
                  <option value="all">All branches</option>
                  {staffBranchCounts
                    .filter((branch) => branch.count > 0 && !branch.id.startsWith('unknown:') && branch.id !== 'unassigned')
                    .map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                  {staffBranchCounts.some((branch) => branch.id === 'unassigned' || branch.id.startsWith('unknown:')) && (
                    <option value="unassigned">Unassigned / unmatched branch</option>
                  )}
                </select>
                <select
                  value={staffRoleFilter}
                  onChange={(event) => {
                    setStaffRoleFilter(event.target.value);
                    setStaffPage(1);
                  }}
                  aria-label="Filter staff accounts by role"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-shelf-primary focus:ring-2 focus:ring-shelf-primary/20"
                >
                  <option value="all">All roles</option>
                  {staffRoles.map((role) => (
                    <option key={role} value={role}>{formatStaffRole(role)}</option>
                  ))}
                </select>
                <select
                  value={staffStatusFilter}
                  onChange={(event) => {
                    setStaffStatusFilter(event.target.value);
                    setStaffPage(1);
                  }}
                  aria-label="Filter staff accounts by status"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-shelf-primary focus:ring-2 focus:ring-shelf-primary/20"
                >
                  <option value="all">{t('All statuses')}</option>
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
                <select
                  value={staffPageSize}
                  onChange={(event) => {
                    setStaffPage(1);
                    setStaffPageSize(Number(event.target.value));
                  }}
                  aria-label="Rows per page"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-shelf-primary focus:ring-2 focus:ring-shelf-primary/20"
                >
                  <option value={10}>10 per page</option>
                  <option value={20}>20 per page</option>
                  <option value={30}>30 per page</option>
                  <option value={40}>40 per page</option>
                  <option value={50}>50 per page</option>
                  <option value={100}>100 per page</option>
                </select>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-225 text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="p-3">{t('Name')}</th>
                      <th className="p-3">{t('Email')}</th>
                      <th className="p-3">Role</th>
                      <th className="p-3">Assigned Branch</th>
                      <th className="p-3">{t('Status')}</th>
                      <th className="w-64 p-3">{t('Action')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleStaffAccounts.map((staff) => (
                      <tr
                        key={staff.id}
                        id={`superadmin-staff-account-${staff.id}`}
                        className={`hover:bg-slate-50 ${String(focusedNotificationType) === 'staff_review' && String(focusedNotificationRequestId) === String(staff.id) ? 'bg-amber-50 ring-2 ring-inset ring-amber-300' : ''}`}
                      >
                        <td className="p-3 font-semibold text-slate-700">{staff.full_name}</td>
                        <td className="p-3 text-xs tabular-nums wrap-anywhere text-slate-500">{staff.email}</td>
                        <td className="align-middle p-3">
                          <span className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${staff.role === 'superadmin' ? 'bg-purple-100 text-purple-800' : staff.role === 'subadmin' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'}`}>
                            {formatStaffRole(staff.role)}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-slate-500">{getLibraryName(libraries, staff.library_id)}</td>
                        <td className="p-3">
                          <span className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${staff.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                            {staff.is_active ? 'Active' : 'Disabled'}
                          </span>
                        </td>
                        <td className="align-middle p-3">
                          {staff.role === 'superadmin' ? (
                            <span className="text-xs font-semibold text-slate-400">
                              Protected
                            </span>
                          ) : (
                            <div className="grid w-60 grid-cols-3 items-stretch gap-2">
                              <button
                                type="button"
                                onClick={() => handleEditStaff(staff)}
                                disabled={staffLoading}
                                className="inline-flex min-h-9 w-full items-center justify-center rounded-md border border-blue-200 px-2 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                              >
                                {t('Edit')}
                              </button>

                              <button
                                type="button"
                                data-confirm-message={`${staff.is_active ? 'Disable' : 'Enable'} the sub-admin account for "${staff.full_name || staff.email}"?`}
                                onClick={() => handleToggleStaff(staff)}
                                disabled={staffLoading}
                                className={`inline-flex min-h-9 w-full items-center justify-center rounded-md border px-2 py-1.5 text-xs font-bold disabled:opacity-50 ${
                                  staff.is_active
                                    ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
                                    : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                                }`}
                              >
                                {staff.is_active ? 'Disable' : 'Enable'}
                              </button>

                              <button
                                type="button"
                                data-confirm-message={`Delete the sub-admin account for "${staff.full_name || staff.email}"? This cannot be undone.`}
                                onClick={() => handleDeleteStaff(staff)}
                                disabled={staffLoading}
                                className="inline-flex min-h-9 w-full items-center justify-center rounded-md border border-red-200 px-2 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
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
              {!staffLoading && filteredStaffAccounts.length === 0 && (
                <div className="p-8 text-center text-sm text-slate-500">
                  {staffAccounts.length === 0
                    ? 'No staff accounts were found in staff_profiles.'
                    : 'No staff accounts match these filters.'}
                </div>
              )}
              <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-slate-500">
                  Showing {filteredStaffAccounts.length === 0 ? 0 : (visibleStaffPage - 1) * staffPageSize + 1} to {Math.min(visibleStaffPage * staffPageSize, filteredStaffAccounts.length)} of {filteredStaffAccounts.length} staff accounts
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStaffPage((page) => Math.max(1, page - 1))}
                    disabled={visibleStaffPage <= 1 || staffLoading}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="min-w-20 text-center text-xs font-semibold text-slate-600">
                    <PageJump page={visibleStaffPage} pageCount={staffPageCount} onPageChange={setStaffPage} />
                  </span>
                  <button
                    type="button"
                    onClick={() => setStaffPage((page) => Math.min(staffPageCount, page + 1))}
                    disabled={visibleStaffPage >= staffPageCount || staffLoading}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* REPORTS AND SERVICES */}
        {section === 'workspace' && (
          <Suspense fallback={<div role="status" className="p-6 text-sm text-slate-500">Loading reports and analytics…</div>}>
          <AdminWorkspace
            key={`${focusedNotificationRequestId || 'none'}-${notificationFocusVersion}`}
            initialTab={activeTab}
            mode="reports"
            user={user}
            libraries={libraries}
            books={books}
            borrowRequests={borrowRequests}
            borrowRequestsLoadError={borrowRequestsLoadError}
            retryBorrowRequests={retryBorrowRequests}
            attendanceLogs={attendanceLogs}
            attendanceDataComplete={initialDataReady && !attendanceLoadError}
            focusedNotificationRequestId={focusedNotificationRequestId}
            focusedNotificationType={focusedNotificationType}
          />
          </Suspense>
        )}

        {/* COMMUNICATION (FEEDBACK & ANNOUNCEMENTS) */}
        {section === 'communication' && (
          <Suspense fallback={<div role="status" className="p-6 text-sm text-slate-500">Loading communication tools…</div>}>
          <AdminWorkspace
            initialTab={activeTab}
            mode="communication"
            user={user}
            libraries={libraries}
            books={books}
            borrowRequests={borrowRequests}
            borrowRequestsLoadError={borrowRequestsLoadError}
            retryBorrowRequests={retryBorrowRequests}
            attendanceLogs={attendanceLogs}
            attendanceDataComplete={initialDataReady && !attendanceLoadError}
          />
          </Suspense>
        )}
      </main>
    </div>
    <ExportConfirmationDialog
      file={pendingExportFile}
      onCancel={() => setPendingExportFile(null)}
      onSaved={() => { setPendingExportFile(null); setExportMessage('Report saved successfully.'); }}
    />
    {staffMfaChallenge && (
      <div className="fixed inset-0 z-[130] grid place-items-center bg-slate-950/50 p-4" role="presentation">
        <form onSubmit={handleVerifyStaffMfa} role="dialog" aria-modal="true" aria-labelledby="staff-mfa-title" className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <h2 id="staff-mfa-title" className="text-lg font-bold text-slate-900 dark:text-white">Verify it’s you</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Enter the 6-digit code from your authenticator app to save this staff account.</p>
          <label className="mt-4 block text-sm font-semibold text-slate-700 dark:text-slate-200" htmlFor="staff-mfa-code">Authenticator code</label>
          <input id="staff-mfa-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={staffMfaCode} onChange={(event) => setStaffMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-center text-lg tracking-[0.35em] text-slate-900 outline-none focus:border-shelf-primary focus:ring-2 focus:ring-shelf-primary/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white" required />
          {staffError && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{staffError}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={staffLoading} onClick={() => { setStaffMfaChallenge(null); setStaffMfaCode(''); }} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">Cancel</button>
            <button type="submit" disabled={staffLoading || staffMfaCode.length !== 6} className="rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{staffLoading ? 'Verifying…' : 'Verify and save'}</button>
          </div>
        </form>
      </div>
    )}
  </div>
  );
}
