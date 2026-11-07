import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Draggable from 'react-draggable';
import { QRCodeSVG } from 'qrcode.react';
import { Bar } from 'react-chartjs-2';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { ThemeProvider } from '../../context/ThemeContext.jsx';
import { useTheme } from '../../context/useTheme.js';
import './visitorDashboard.css';
import {
  Bell,
  BookMarked,
  BookOpen,
  CalendarDays,
  AlertTriangle,
  Bookmark,
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  CircleDollarSign,
  ChevronDown,
  FileText,
  Fingerprint,
  LogOut,
  Mail,
  MapPinned,
  Pencil,
  Megaphone,
  MessageCircle,
  Moon,
  MapPin,
  Phone,
  QrCode,
  Save,
  Search,
  ShieldCheck,
  Sun,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';

import { useAuth } from '../../context/useAuth.js';
import { getDashboardPath } from '../../routes/roleHome.js';
import { useLibrary, useLibraryData } from '../../context/useLibrary.js';
import { supabase } from '../../lib/supabaseClient.js';
import {
  fetchAttendanceLogsPage,
  updateVisitorProfile,
} from '../../data/store.js';

import OPACCatalog from '../../component/OPACCatalog.jsx';
import LibraryMap from '../../component/LibraryMap.jsx';
import FAQ from '../../component/FAQ.jsx';
import VisitorServices from '../../component/VisitorServices.jsx';
import AIRecommendations from '../../component/AIRecommendations.jsx';
import DashboardWelcome from '../../component/DashboardWelcome.jsx';
import VisitorTermsContent, {
  VISITOR_TERMS_VERSION,
} from '../../component/VisitorTermsContent.jsx';
import DashboardDataBoundary from '../../component/DashboardDataBoundary.jsx';
import VisitorProfilePhotoCropDialog from '../../component/VisitorProfilePhotoCropDialog.jsx';

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);

function formatDateTime(iso) {
  if (!iso) {
    return '—';
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

const ATTENDANCE_PERIOD_FILTERS = [
  { value: 'this-week', label: 'This Week' },
  { value: 'last-week', label: 'Last Week' },
  { value: 'this-month', label: 'This Month' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'all-time', label: 'All Time' },
];

function getAttendancePeriodBounds(period) {
  if (period === 'all-time') return { fromTime: null, beforeTime: null };

  const now = new Date();
  const startOfThisWeek = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - ((now.getDay() + 6) % 7)
  );
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  let start;
  let end;

  switch (period) {
    case 'this-week':
      start = startOfThisWeek;
      end = new Date(startOfThisWeek.getFullYear(), startOfThisWeek.getMonth(), startOfThisWeek.getDate() + 7);
      break;
    case 'last-week':
      start = new Date(startOfThisWeek.getFullYear(), startOfThisWeek.getMonth(), startOfThisWeek.getDate() - 7);
      end = startOfThisWeek;
      break;
    case 'this-month':
      start = startOfThisMonth;
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      break;
    case 'last-month':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = startOfThisMonth;
      break;
    default:
      return { fromTime: null, beforeTime: null };
  }

  return { fromTime: start.toISOString(), beforeTime: end.toISOString() };
}

const MAX_VISITOR_PROFILE_IMAGE_SIZE = 2 * 1024 * 1024;
const PASSKEYS_DISABLED_MESSAGE = 'Passkeys are not enabled for this SHELF site yet. You can continue signing in with your password.';

function isPasskeysDisabled(error) {
  return /passkey_disabled|passkeys? (?:are )?disabled/i.test(String(error?.message || error || ''));
}

const VISITOR_PROFILE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function getVisitorProfileImageStoragePath(url, visitorId) {
  const path = String(url || '').trim();
  const [ownerId, filename] = path.split('/');
  return ownerId === String(visitorId) && filename ? path : null;
}

function getVisitorInitials(name) {
  return String(name || 'Visitor')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function getCommunityReturnReminder(dueDate) {
  const due = new Date(dueDate);

  if (Number.isNaN(due.getTime())) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  const daysUntilDue = Math.ceil(
    (due.getTime() - today.getTime()) /
      (1000 * 60 * 60 * 24)
  );

  if (daysUntilDue < 0) {
    return {
      label: `Overdue by ${Math.abs(daysUntilDue)} day${
        Math.abs(daysUntilDue) === 1 ? '' : 's'
      }`,
      urgent: true,
    };
  }

  if (daysUntilDue === 0) {
    return { label: 'Due today', urgent: true };
  }

  if (daysUntilDue <= 2) {
    return { label: 'Due soon', urgent: false };
  }

  return null;
}

function VisitorDashboardContent() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const {
  borrowRequests = [],
  libraries = [],
  visitors = [],
  ownerCommunityBookRequests = [],
} = useLibraryData();
  const {
    borrowRequestsLoading,
    borrowRequestsLoadError,
    retryBorrowRequests,
    loading: libraryLoading,
    initialDataReady,
    connectionError,
    refreshAll,
  } = useLibrary();
  const visitorDetails = visitors.find(
    (visitor) => visitor.id === user?.id
  );
  const assignedLibraryId =
    visitorDetails?.libraryId ?? user?.libraryId ?? null;
  const registeredLibraryName = assignedLibraryId
    ? libraries.find(
        (library) => String(library.id) === String(assignedLibraryId)
      )?.name || 'Assigned library'
    : 'Outside Visitor';

  const [tab, setTab] = useState('catalog');
  const activeVisitorNavTabRef = useRef(null);
  const [catalogResetKey, setCatalogResetKey] = useState(0);
  const [libraryFilter, setLibraryFilter] = useState(null);
  const [isSavingQr, setIsSavingQr] = useState(false);
  const [qrSaveMessage, setQrSaveMessage] = useState('');
  const [qrSaveError, setQrSaveError] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuSection, setMenuSection] = useState('profile');
  const [attendanceHistory, setAttendanceHistory] = useState([]);
  const [attendanceHistoryLoading, setAttendanceHistoryLoading] = useState(false);
  const [attendanceHistoryError, setAttendanceHistoryError] = useState('');
  const [attendanceHistoryHasMore, setAttendanceHistoryHasMore] = useState(false);
  const [attendanceHistoryScrollTop, setAttendanceHistoryScrollTop] = useState(0);
  const [attendanceHistoryTotal, setAttendanceHistoryTotal] = useState(null);
  const [attendancePeriod, setAttendancePeriod] = useState('all-time');
  const [attendanceLibraryFilter, setAttendanceLibraryFilter] = useState('all');
  const attendanceHistoryContainerRef = useRef(null);
  const attendanceHistorySentinelRef = useRef(null);
  const attendanceHistoryCursorRef = useRef(null);
  const attendanceHistoryHasMoreRef = useRef(false);
  const attendanceHistoryLoadingRef = useRef(false);
  const attendanceHistoryGenerationRef = useRef(0);
  const [dismissedReminderIds, setDismissedReminderIds] = useState(() => new Set());
  const [isFaqOpen, setIsFaqOpen] = useState(false);
  const faqDragRef = useRef(null);

  const [announcements, setAnnouncements] = useState([]);
  const [announcementIndex, setAnnouncementIndex] = useState(0);
  const [isAnnouncementOpen, setIsAnnouncementOpen] = useState(false);
  const markAnnouncementRead = (announcement) => {
    if (!announcement || !user?.id) return;
    const storageKey = `shelf_visitor_dismissed_announcements_${user.id}`;
    try {
      const dismissed = JSON.parse(globalThis.localStorage.getItem(storageKey) || '[]');
      const dismissedIds = new Set(Array.isArray(dismissed) ? dismissed.map(String) : []);
      dismissedIds.add(String(announcement.id));
      globalThis.localStorage.setItem(storageKey, JSON.stringify([...dismissedIds]));
    } catch {
      // The announcement can still be dismissed for the current session.
    }
  };
  const dismissCurrentAnnouncement = () => {
    const currentAnnouncement = announcements[announcementIndex];
    markAnnouncementRead(currentAnnouncement);
    setIsAnnouncementOpen(false);
  };

  const [isNotificationsOpen, setIsNotificationsOpen] =
  useState(false);
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false);
  const [isTermsReviewOpen, setIsTermsReviewOpen] = useState(false);
  const [focusRequestId, setFocusRequestId] = useState(null);
  const [communityRequestNotice, setCommunityRequestNotice] = useState(null);
  const previousCommunityRequestStatusesRef = useRef(null);
  const [termsStatus, setTermsStatus] = useState('loading');
  const [termsDocumentContent, setTermsDocumentContent] = useState('');
  const [termsDocumentVersion, setTermsDocumentVersion] = useState(VISITOR_TERMS_VERSION);
  const [termsError, setTermsError] = useState('');
  const [isAcceptingTerms, setIsAcceptingTerms] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [profileForm, setProfileForm] = useState({ contactNumber: '' });
  const [profileImageFile, setProfileImageFile] = useState(null);
  const [profileImagePreview, setProfileImagePreview] = useState('');
  const [pendingProfileImageFile, setPendingProfileImageFile] = useState(null);
  const [removeProfileImage, setRemoveProfileImage] = useState(false);
  const [failedProfileImageSrc, setFailedProfileImageSrc] = useState('');
  const [signedProfileImage, setSignedProfileImage] = useState({
    path: '',
    url: '',
  });
  const [visitorMfaFactor, setVisitorMfaFactor] = useState(null);
  const [visitorMfaSetup, setVisitorMfaSetup] = useState(null);
  const [visitorMfaDisableConfirm, setVisitorMfaDisableConfirm] = useState(false);
  const [visitorMfaCode, setVisitorMfaCode] = useState('');
  const [visitorMfaLoading, setVisitorMfaLoading] = useState(false);
  const [visitorMfaError, setVisitorMfaError] = useState('');
  const [visitorMfaMessage, setVisitorMfaMessage] = useState('');
  const [visitorPasskeys, setVisitorPasskeys] = useState([]);
  const [visitorPasskeyLoading, setVisitorPasskeyLoading] = useState(false);
  const [visitorPasskeyBusy, setVisitorPasskeyBusy] = useState(false);
  const [visitorPasskeyError, setVisitorPasskeyError] = useState('');
  const [visitorPasskeyMessage, setVisitorPasskeyMessage] = useState('');
  const avatarMenuRef = useRef(null);
  const avatarButtonRef = useRef(null);

  const refreshVisitorMfa = useCallback(async () => {
    if (!supabase?.auth?.mfa) return;
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw error;
    setVisitorMfaFactor((data?.totp || data?.all || []).find((factor) => factor.status === 'verified') || null);
  }, []);

  useEffect(() => {
    if (user?.role !== 'visitor') return;
    // Fetching the factor list updates the async security status for this session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshVisitorMfa().catch((error) => {
      console.error('Unable to load visitor MFA status:', error);
      setVisitorMfaError('Multi-factor authentication status could not be loaded. Please refresh and try again.');
    });
  }, [refreshVisitorMfa, user?.id, user?.role]);

  const refreshVisitorPasskeys = useCallback(async () => {
    if (!supabase?.auth?.passkey?.list) {
      throw new Error('Passkey management is unavailable. Please refresh the page.');
    }
    const { data, error } = await supabase.auth.passkey.list();
    if (error) throw error;
    setVisitorPasskeys(data || []);
  }, []);

  useEffect(() => {
    if (user?.role !== 'visitor') return;
    // Fetching passkeys updates the async security status for this session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisitorPasskeyLoading(true);
    refreshVisitorPasskeys()
      .catch((error) => {
        if (!isPasskeysDisabled(error)) {
          console.error('Unable to load visitor passkeys:', error);
        }
        setVisitorPasskeyError(isPasskeysDisabled(error)
          ? PASSKEYS_DISABLED_MESSAGE
          : error?.message || 'Could not load passkeys for this account.');
      })
      .finally(() => setVisitorPasskeyLoading(false));
  }, [refreshVisitorPasskeys, user?.id, user?.role]);

  const registerVisitorPasskey = async () => {
    if (!supabase?.auth?.registerPasskey) {
      setVisitorPasskeyError('Passkey setup is unavailable in this browser.');
      return;
    }
    setVisitorPasskeyBusy(true);
    setVisitorPasskeyError('');
    setVisitorPasskeyMessage('');
    try {
      const { error } = await supabase.auth.registerPasskey();
      if (error) throw error;
      await refreshVisitorPasskeys();
      setVisitorPasskeyMessage('Passkey added. You can use this phone’s fingerprint, Face ID, or screen lock to sign in.');
    } catch (error) {
      setVisitorPasskeyError(isPasskeysDisabled(error)
        ? PASSKEYS_DISABLED_MESSAGE
        : error?.message || 'Could not add a passkey. Please try again.');
    } finally {
      setVisitorPasskeyBusy(false);
    }
  };

  const removeVisitorPasskey = async (passkey) => {
    if (!window.confirm('Remove this passkey from your SHELF account? You can add it again later.')) return;
    setVisitorPasskeyBusy(true);
    setVisitorPasskeyError('');
    setVisitorPasskeyMessage('');
    try {
      const { error } = await supabase.auth.passkey.delete({ passkeyId: passkey.id });
      if (error) throw error;
      await refreshVisitorPasskeys();
      setVisitorPasskeyMessage('Passkey removed from your account.');
    } catch (error) {
      setVisitorPasskeyError(error?.message || 'Could not remove this passkey. Please try again.');
    } finally {
      setVisitorPasskeyBusy(false);
    }
  };

  const startVisitorMfaSetup = async () => {
    setVisitorMfaLoading(true);
    setVisitorMfaError('');
    setVisitorMfaMessage('');
    try {
      const { data: factorData, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;
      const factors = factorData?.totp || factorData?.all || [];
      const pending = factors.filter((factor) => factor.status === 'unverified');
      for (const factor of pending) {
        const { error: cleanupError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (cleanupError) throw cleanupError;
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `SHELF visitor sign-in ${Date.now()}` });
      if (error) throw error;
      setVisitorMfaSetup({ id: data.id, qrCode: data.totp?.qr_code, secret: data.totp?.secret });
      setVisitorMfaCode('');
    } catch (error) {
      setVisitorMfaError(error?.message || 'Could not start MFA setup.');
    } finally {
      setVisitorMfaLoading(false);
    }
  };

  const confirmVisitorMfaSetup = async (event) => {
    event.preventDefault();
    if (!visitorMfaSetup || visitorMfaCode.length !== 6) return;
    setVisitorMfaLoading(true);
    setVisitorMfaError('');
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: visitorMfaSetup.id, code: visitorMfaCode });
      if (error) throw error;
      setVisitorMfaSetup(null);
      setVisitorMfaCode('');
      await refreshVisitorMfa();
      setVisitorMfaMessage('MFA enabled. Your next sign-in will require an authenticator code.');
    } catch (error) {
      setVisitorMfaError(error?.message || 'The authenticator code was not accepted.');
    } finally {
      setVisitorMfaLoading(false);
    }
  };

  const disableVisitorMfa = async (event) => {
    event.preventDefault();
    if (!visitorMfaFactor || visitorMfaCode.length !== 6) return;
    setVisitorMfaLoading(true);
    setVisitorMfaError('');
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: visitorMfaFactor.id, code: visitorMfaCode });
      if (verifyError) throw verifyError;
      const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId: visitorMfaFactor.id });
      if (removeError) throw removeError;
      setVisitorMfaFactor(null);
      setVisitorMfaCode('');
      setVisitorMfaDisableConfirm(false);
      setVisitorMfaMessage('MFA disabled for this account.');
    } catch (error) {
      setVisitorMfaError(error?.message || 'MFA could not be turned off. Check the code and try again.');
    } finally {
      setVisitorMfaLoading(false);
    }
  };

  const { isDarkAppearance, setIsDarkAppearance } = useTheme();
  const profileImageSrc = profileImagePreview ||
    (removeProfileImage || signedProfileImage.path !== visitorDetails?.profileImagePath
      ? ''
      : signedProfileImage.url);
  const profileImageFailed = Boolean(
    profileImageSrc && failedProfileImageSrc === profileImageSrc
  );

  const loadAttendanceHistory = useCallback(async (reset = false) => {
    if (String(user?.role || '').toLowerCase() !== 'visitor') return;

    if (
      !reset &&
      (attendanceHistoryLoadingRef.current ||
        !attendanceHistoryHasMoreRef.current)
    ) return;

    if (reset) {
      attendanceHistoryGenerationRef.current += 1;
      attendanceHistoryLoadingRef.current = false;
      attendanceHistoryCursorRef.current = null;
      attendanceHistoryHasMoreRef.current = false;
      setAttendanceHistory([]);
      setAttendanceHistoryHasMore(false);
      setAttendanceHistoryTotal(null);
      setAttendanceHistoryScrollTop(0);
      if (attendanceHistoryContainerRef.current) {
        attendanceHistoryContainerRef.current.scrollTop = 0;
      }
      setAttendanceHistoryError('');
    }

    const generation = attendanceHistoryGenerationRef.current;
    if (attendanceHistoryLoadingRef.current) return;
    attendanceHistoryLoadingRef.current = true;
    setAttendanceHistoryLoading(true);
    setAttendanceHistoryError('');

    try {
      const page = await fetchAttendanceLogsPage({
        cursor: reset ? null : attendanceHistoryCursorRef.current,
        pageSize: 100,
        ...getAttendancePeriodBounds(attendancePeriod),
        libraryId: attendanceLibraryFilter === 'all'
          ? null
          : attendanceLibraryFilter,
      });
      if (generation !== attendanceHistoryGenerationRef.current) return;

      setAttendanceHistory((current) => {
        const next = reset ? page.logs : [...current, ...page.logs];
        const seen = new Set();
        return next.filter((log) => {
          const key = String(log.id);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      });
      attendanceHistoryCursorRef.current = page.nextCursor;
      attendanceHistoryHasMoreRef.current = page.hasMore;
      setAttendanceHistoryHasMore(page.hasMore);
      if (page.totalCount !== null) setAttendanceHistoryTotal(page.totalCount);
    } catch (error) {
      if (generation === attendanceHistoryGenerationRef.current) {
        setAttendanceHistoryError(
          error instanceof Error ? error.message : 'Unable to load attendance history. Please retry.'
        );
      }
    } finally {
      if (generation === attendanceHistoryGenerationRef.current) {
        attendanceHistoryLoadingRef.current = false;
        setAttendanceHistoryLoading(false);
      }
    }
  }, [attendancePeriod, attendanceLibraryFilter, user?.role]);

  useEffect(() => {
    if (String(user?.role || '').toLowerCase() !== 'visitor') return undefined;
    // Start the initial paged attendance request when the filter/session changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAttendanceHistory(true);
    return () => {
      attendanceHistoryGenerationRef.current += 1;
      attendanceHistoryLoadingRef.current = false;
      setAttendanceHistoryLoading(false);
    };
  }, [loadAttendanceHistory, user?.role]);

  useEffect(() => {
    const root = attendanceHistoryContainerRef.current;
    const sentinel = attendanceHistorySentinelRef.current;
    if (
      !root || !sentinel || !attendanceHistoryHasMore ||
      attendanceHistoryLoading || attendanceHistoryError ||
      typeof IntersectionObserver === 'undefined'
    ) return undefined;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadAttendanceHistory(false);
      }
    }, { root, rootMargin: '120px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [attendanceHistoryHasMore, attendanceHistoryError, attendanceHistoryLoading, loadAttendanceHistory]);

  useEffect(() => {
    const path = visitorDetails?.profileImagePath;
    if (!path || !supabase) return undefined;

    let active = true;
    let refreshTimer;
    const refreshSignedUrl = async () => {
      try {
        const { data, error } = await supabase.storage
          .from('visitor-profile-images')
          .createSignedUrl(path, 60 * 60);
        if (error) throw error;
        if (active) {
          setSignedProfileImage({ path, url: data.signedUrl });
          refreshTimer = window.setTimeout(
            refreshSignedUrl,
            55 * 60 * 1000
          );
        }
      } catch (error) {
        if (active) {
          console.error('Unable to load visitor profile photo:', error);
          setSignedProfileImage({ path, url: '' });
        }
      }
    };

    void refreshSignedUrl();
    return () => {
      active = false;
      window.clearTimeout(refreshTimer);
    };
  }, [visitorDetails?.id, visitorDetails?.profileImagePath]);

  useEffect(() => {
    if (!profileImageFile) {
      // Clear a stale preview after the selected file is removed.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfileImagePreview('');
      return undefined;
    }

    const previewUrl = URL.createObjectURL(profileImageFile);
    setProfileImagePreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [profileImageFile]);

  useEffect(() => {
    activeVisitorNavTabRef.current?.scrollIntoView({
      inline: 'nearest',
      block: 'nearest',
    });
  }, [tab]);

  useEffect(() => {
    if (libraryLoading) return;

    const communityRequestStatuses = new Map(
      borrowRequests
        .filter((request) => request.isCommunityBook)
        .map((request) => [
          String(request.id),
          {
            status: String(request.status || '').toLowerCase(),
            title: request.bookTitle || 'Community book',
            ownerResponse: request.ownerResponse || '',
          },
        ])
    );
    const previousStatuses = previousCommunityRequestStatusesRef.current;
    if (previousStatuses) {
      const newlyRejectedUnavailableRequests = [...communityRequestStatuses].filter(
        ([requestId, request]) =>
          previousStatuses.get(requestId)?.status === 'pending' &&
          request.status === 'rejected' &&
          /no available copies/i.test(request.ownerResponse)
      );

      if (newlyRejectedUnavailableRequests.length > 0) {
        const rejectedTitles = newlyRejectedUnavailableRequests.map(([, request]) => `“${request.title}”`);
        setCommunityRequestNotice({
          type: 'rejected',
          message: rejectedTitles.length === 1
            ? `Your request for ${rejectedTitles[0]} was rejected because no copies are available.`
            : `Your requests for ${rejectedTitles.join(', ')} were rejected because no copies are available.`,
        });
      } else {
        for (const [requestId, request] of communityRequestStatuses) {
          const previousStatus = previousStatuses.get(requestId)?.status;
          if (previousStatus === 'pending' && request.status === 'approved') {
            setCommunityRequestNotice({
              type: 'approved',
              message: `Your request for “${request.title}” was approved. Check My Requests & Borrows to see the full information.`,
            });
            break;
          }
        }
      }
    }
    previousCommunityRequestStatusesRef.current = communityRequestStatuses;
  }, [borrowRequests, libraryLoading]);

  const loadTermsAcceptance = useCallback(async () => {
    if (libraryLoading) return;
    if (String(user?.role || '').toLowerCase() !== 'visitor') {
      setTermsStatus('accepted');
      return;
    }
    if (!user?.id) {
      setTermsStatus('accepted');
      return;
    }

    setTermsStatus('loading');
    setTermsError('');

    try {
      const { data: termsDocument, error: termsDocumentError } = await supabase
        .from('system_terms_documents')
        .select('version, content')
        .eq('document_key', 'visitor')
        .maybeSingle();
      if (termsDocumentError) throw termsDocumentError;
      setTermsDocumentContent(termsDocument?.content || '');
      setTermsDocumentVersion(termsDocument?.version || VISITOR_TERMS_VERSION);

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      if (sessionError) throw sessionError;

      if (!sessionData?.session) {
        const acceptedAt = globalThis.localStorage.getItem(
          `shelf_visitor_terms_accepted_${user.id}_${termsDocument?.version || VISITOR_TERMS_VERSION}`
        );
        setTermsStatus(acceptedAt ? 'accepted' : 'required');
        return;
      }

      const { data, error } = await supabase.rpc(
        'get_visitor_terms_accepted_at'
      );
      if (error) throw error;
      setTermsStatus(data ? 'accepted' : 'required');
    } catch (error) {
      console.error('Unable to load visitor terms acceptance:', error);
      setTermsError(
        'We could not verify whether you have accepted the Terms and Conditions. Please try again.'
      );
      setTermsStatus('error');
    }
  }, [libraryLoading, user]);

  useEffect(() => {
    const termsTimer = setTimeout(() => {
      void loadTermsAcceptance();
    }, 0);

    return () => clearTimeout(termsTimer);
  }, [loadTermsAcceptance]);

  useEffect(() => {
    if (!isAvatarMenuOpen && !isTermsReviewOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsAvatarMenuOpen(false);
        setIsTermsReviewOpen(false);
        avatarButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isAvatarMenuOpen, isTermsReviewOpen]);

  useEffect(() => {
    if (!isAvatarMenuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!avatarMenuRef.current?.contains(event.target)) {
        setIsAvatarMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isAvatarMenuOpen]);

  useEffect(() => {
    if (isAvatarMenuOpen) {
      avatarMenuRef.current
        ?.querySelector('[role="menuitem"]')
        ?.focus();
    }
  }, [isAvatarMenuOpen]);

  const handleAcceptTerms = async () => {
    if (isAcceptingTerms) return;

    setIsAcceptingTerms(true);
    setTermsError('');
    try {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      if (sessionError) throw sessionError;

      if (sessionData?.session) {
        const { error } = await supabase.rpc('accept_visitor_terms');
        if (error) throw error;
      } else {
        const acceptedAt = new Date().toISOString();
        globalThis.localStorage.setItem(
          `shelf_visitor_terms_accepted_${user.id}_${termsDocumentVersion}`,
          acceptedAt
        );
      }
      setTermsStatus('accepted');
    } catch (error) {
      console.error('Unable to save visitor terms acceptance:', error);
      setTermsError(
        'We could not save your acceptance. Please check your connection and try again.'
      );
    } finally {
      setIsAcceptingTerms(false);
    }
  };

  const ownerPendingRequests = ownerCommunityBookRequests.filter(
    (request) =>
      String(request.status || '').toLowerCase() === 'pending'
  );

  const ownerNotificationCount = ownerPendingRequests.length;


  useEffect(() => {
    try {
      globalThis.localStorage.setItem(
        'shelf_visitor_appearance',
        isDarkAppearance ? 'dark' : 'light'
      );
    } catch {
      // Appearance still applies for this session.
    }
  }, [isDarkAppearance]);

      // LOAD LATEST PUBLISHED ANNOUNCEMENT

      useEffect(() => {
        let active = true;

        async function loadAnnouncements() {
          if (!supabase || !user?.id) return;

          try {
            const { data, error } = await supabase
              .from('announcements')
              .select('id, title, message, created_at')
              .eq('published', true)
              .in('audience', ['visitor', 'both'])
              .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
              .order('created_at', { ascending: false });

            if (!active) return;

            if (error) {
              console.error('Unable to load announcements:', error.message);
              return;
            }

            let dismissedIds = new Set();
            try {
              const dismissed = JSON.parse(globalThis.localStorage.getItem(
                `shelf_visitor_dismissed_announcements_${user.id}`
              ) || '[]');
              dismissedIds = new Set(Array.isArray(dismissed) ? dismissed.map(String) : []);
            } catch {
              dismissedIds = new Set();
            }
            const items = (data || []).filter(
              (item) => !dismissedIds.has(String(item.id))
            );
            setAnnouncements(items);
            setAnnouncementIndex(0);
            setIsAnnouncementOpen(items.length > 0);
          } catch (error) {
            if (active) {
              console.error('Announcement loading failed:', error);
            }
          }
        }

        loadAnnouncements();

        return () => {
          active = false;
        };
      }, [user?.id]);


  // =========================================================
  // QR CODE REFERENCE
  // =========================================================

  const qrCodeRef = useRef(null);
  const visitorQrCode =
    /^SHELF-QR-[0-9]{6}$/.test(String(user?.qrCode || ''))
      ? user.qrCode
      : null;

  // =========================================================
  // SAVE QR CODE AS IMAGE
  // =========================================================

  const handleSaveQrAsImage = async () => {
    if (!visitorQrCode) {
      return;
    }

    setIsSavingQr(true);
    setQrSaveMessage('');
    setQrSaveError('');

    try {
      const svgElement = qrCodeRef.current?.querySelector('svg');

      if (!svgElement) {
        throw new Error('QR code could not be found.');
      }

      const serializer = new XMLSerializer();

      let svgData = serializer.serializeToString(svgElement);

      if (!svgData.includes('xmlns="http://www.w3.org/2000/svg"')) {
        svgData = svgData.replace(
          '<svg',
          '<svg xmlns="http://www.w3.org/2000/svg"'
        );
      }

      const canvas = document.createElement('canvas');

      const canvasWidth = 900;
      const canvasHeight = 1050;

      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      const context = canvas.getContext('2d');

      if (!context) {
        throw new Error('Unable to create image canvas.');
      }

      // Background
      context.fillStyle = '#ffffff';

      context.fillRect(0, 0, canvasWidth, canvasHeight);

      // SHELF ILMS title
      context.fillStyle = '#002046';

      context.font = 'bold 36px Arial, sans-serif';

      context.textAlign = 'center';

      context.fillText('SHELF', canvasWidth / 2, 65);

      // Subtitle
      context.fillStyle = '#334155';

      context.font = 'bold 24px Arial, sans-serif';

      context.fillText('Digital Library Pass', canvasWidth / 2, 105);

      // Convert SVG to image
      const svgBlob = new Blob([svgData], {
        type: 'image/svg+xml;charset=utf-8',
      });

      const svgUrl = URL.createObjectURL(svgBlob);

      const qrImage = new Image();

      try {
        await new Promise((resolve, reject) => {
          qrImage.onload = resolve;

          qrImage.onerror = () => {
            reject(new Error('Unable to generate the QR image.'));
          };

          qrImage.src = svgUrl;
        });
      } finally {
        URL.revokeObjectURL(svgUrl);
      }

      const qrSize = 700;

      const qrX = (canvasWidth - qrSize) / 2;

      const qrY = 145;

      context.fillStyle = '#ffffff';

      context.fillRect(
        qrX - 25,
        qrY - 25,
        qrSize + 50,
        qrSize + 50
      );

      context.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

      // QR pass ID
      context.fillStyle = '#002046';

      context.font = 'bold 30px monospace';

      context.textAlign = 'center';

      context.fillText(visitorQrCode, canvasWidth / 2, 900);

      // Visitor name
      context.fillStyle = '#475569';

      context.font = 'bold 22px Arial, sans-serif';

      context.fillText(user?.name || 'Visitor', canvasWidth / 2, 945);

      // Instruction
      context.fillStyle = '#64748b';

      context.font = '18px Arial, sans-serif';

      context.fillText(
        'Present this QR pass for library access and attendance.',
        canvasWidth / 2,
        995
      );

      // Convert canvas to PNG
      const imageUrl = canvas.toDataURL('image/png');

      const link = document.createElement('a');

      link.href = imageUrl;

      link.download = `${visitorQrCode}-QR-Pass.png`;

      document.body.appendChild(link);

      link.click();

      document.body.removeChild(link);
      setQrSaveMessage('QR pass downloaded successfully.');
    } catch (error) {
      console.error('Save QR image error:', error);

      setQrSaveError('Unable to save the QR code as an image. Please try again.');
    } finally {
      setIsSavingQr(false);
    }
  };

  const handleProfileImageChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!VISITOR_PROFILE_IMAGE_TYPES.has(file.type)) {
      setProfileError('Choose a JPG, PNG, or WEBP image for your profile photo.');
      return;
    }
    if (file.size > MAX_VISITOR_PROFILE_IMAGE_SIZE) {
      setProfileError('Profile photos must be 2 MB or smaller.');
      return;
    }

    setProfileError('');
    setProfileMessage('');
    setPendingProfileImageFile(file);
  };

  const handleProfileImageCrop = (file) => {
    setProfileImageFile(file);
    setPendingProfileImageFile(null);
    setRemoveProfileImage(false);
    setFailedProfileImageSrc('');
  };

  const cancelProfileEdit = () => {
    setProfileForm({
      contactNumber: visitorDetails?.contactNumber || '',
    });
    setProfileImageFile(null);
    setProfileImagePreview('');
    setPendingProfileImageFile(null);
    setRemoveProfileImage(false);
    setFailedProfileImageSrc('');
    setProfileError('');
    setIsEditingProfile(false);
  };

  const handleSaveVisitorProfile = async (event) => {
    event.preventDefault();
    if (isSavingProfile) return;

    const contactNumber = profileForm.contactNumber.trim();
    if (contactNumber.length > 50) {
      setProfileError('Contact number must not exceed 50 characters.');
      return;
    }
    if (!visitorDetails?.id) {
      setProfileError('Your visitor profile is still loading. Please try again.');
      return;
    }

    setIsSavingProfile(true);
    setProfileError('');
    setProfileMessage('');
    let uploadedImagePath = null;
    try {
      let profileImagePath = removeProfileImage
        ? null
        : visitorDetails.profileImagePath || null;

      if (profileImageFile) {
        if (!supabase) {
          throw new Error('Profile photo upload is unavailable because Supabase is not configured.');
        }
        const extensionByType = {
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/webp': 'webp',
        };
        uploadedImagePath = `${visitorDetails.id}/${crypto.randomUUID()}.${extensionByType[profileImageFile.type]}`;
        const { error: uploadError } = await supabase.storage
          .from('visitor-profile-images')
          .upload(uploadedImagePath, profileImageFile, {
            cacheControl: '3600',
            contentType: profileImageFile.type,
            upsert: false,
          });
        if (uploadError) {
          throw new Error(`Profile photo upload failed: ${uploadError.message}`);
        }

        profileImagePath = uploadedImagePath;
      }

      const savedProfile = await updateVisitorProfile({
        visitorId: visitorDetails.id,
        contactNumber,
        profileImagePath,
      });

      const previousImagePath = getVisitorProfileImageStoragePath(
        visitorDetails.profileImagePath,
        visitorDetails.id
      );
      const savedImagePath = getVisitorProfileImageStoragePath(
        savedProfile.profileImagePath,
        visitorDetails.id
      );
      if (previousImagePath && previousImagePath !== savedImagePath) {
        try {
          const { error: removeError } = await supabase.storage
            .from('visitor-profile-images')
            .remove([previousImagePath]);
          if (removeError) {
            console.error('Unable to remove the replaced visitor profile photo:', removeError);
          }
        } catch (removeError) {
          console.error('Unable to remove the replaced visitor profile photo:', removeError);
        }
      }

      setProfileImageFile(null);
      setProfileImagePreview('');
      setRemoveProfileImage(false);
      setIsEditingProfile(false);
      setProfileMessage('Your profile was updated successfully.');
      try {
        await refreshAll();
      } catch (refreshError) {
        console.error('Visitor profile saved, but dashboard refresh failed:', refreshError);
        setProfileMessage('Your profile was saved. Refresh the dashboard to see the latest information.');
      }
    } catch (error) {
      if (uploadedImagePath && supabase) {
        try {
          const { error: cleanupError } = await supabase.storage
            .from('visitor-profile-images')
            .remove([uploadedImagePath]);
          if (cleanupError) {
            console.error('Unable to clean up an unsaved visitor profile photo:', cleanupError);
          }
        } catch (cleanupError) {
          console.error('Unable to clean up an unsaved visitor profile photo:', cleanupError);
        }
      }
      setProfileError(
        error instanceof Error ? error.message : 'Unable to update your profile. Please try again.'
      );
    } finally {
      setIsSavingProfile(false);
    }
  };

  // =========================================================
  // VISITOR ATTENDANCE
  // =========================================================

  const myVisits = attendanceHistory;
  const attendanceRowHeight = 44;
  const attendanceOverscan = 5;
  const attendanceVisibleStart = Math.max(
    0,
    Math.floor(attendanceHistoryScrollTop / attendanceRowHeight) - attendanceOverscan
  );
  const attendanceVisibleEnd = Math.min(
    myVisits.length,
    attendanceVisibleStart + 18 + attendanceOverscan * 2
  );
  const visibleAttendanceVisits = myVisits.slice(
    attendanceVisibleStart,
    attendanceVisibleEnd
  );
  const attendanceLibraryChartData = useMemo(() => {
    const counts = new Map();
    myVisits.forEach((visit) => {
      const id = String(visit.libraryId || 'unknown');
      const library = libraries.find((item) => String(item.id) === id);
      const label = library?.name || (id === 'unknown' ? 'Unknown library' : id);
      const current = counts.get(id) || { label, count: 0 };
      current.count += 1;
      counts.set(id, current);
    });
    const rows = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 5);
    return {
      labels: rows.map(({ label }) => label),
      datasets: [{
        label: 'Visits',
        data: rows.map(({ count }) => count),
        backgroundColor: '#1d4ed8',
        borderRadius: 6,
      }],
    };
  }, [myVisits, libraries]);
  const attendanceMonthlyChartData = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setDate(1);
      date.setMonth(date.getMonth() - (5 - index));
      return {
        key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
        label: date.toLocaleDateString('en-PH', { month: 'short', year: '2-digit' }),
      };
    });
    const counts = new Map(months.map(({ key }) => [key, 0]));
    myVisits.forEach((visit) => {
      const date = new Date(visit.timeIn || '');
      if (Number.isNaN(date.getTime())) return;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (counts.has(key)) counts.set(key, counts.get(key) + 1);
    });
    return {
      labels: months.map(({ label }) => label),
      datasets: [{
        label: 'Visits',
        data: months.map(({ key }) => counts.get(key)),
        backgroundColor: '#002046',
        borderRadius: 6,
      }],
    };
  }, [myVisits]);
  const attendanceChartOptions = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { beginAtZero: true, ticks: { precision: 0 } },
      y: { grid: { display: false } },
    },
  };
  const attendanceMonthlyChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      y: { beginAtZero: true, ticks: { precision: 0 } },
      x: { grid: { display: false } },
    },
  };

  // =========================================================
  // VISITOR TRANSACTION HISTORY
  // =========================================================

  const myTransactions = borrowRequests
    .filter((request) => request.visitorId === user?.id)
    .sort(
      (a, b) =>
        new Date(b.requestDate || 0) -
        new Date(a.requestDate || 0)
    );

  const communityReturnReminders = myTransactions
    .filter(
      (transaction) =>
        (transaction.isCommunityBook === true ||
          transaction.requestType === 'community') &&
        String(transaction.status || '').toLowerCase() ===
          'borrowed' &&
        transaction.dueDate
    )
    .map((transaction) => ({
      ...transaction,
      reminder: getCommunityReturnReminder(
        transaction.dueDate
      ),
    }))
    .filter((transaction) => transaction.reminder);

  const visibleCommunityReturnReminders = communityReturnReminders.filter(
    (transaction) => !dismissedReminderIds.has(String(transaction.id))
  );

  // =========================================================
  // LIBRARY NAME
  // =========================================================

  const libraryName = (id) =>
    libraries.find((library) => library.id === id)?.name || id;

  // =========================================================
  // OPAC VIEWS
  // =========================================================

  const opacViews = [
    'catalog',
    'categories',
    'communityBooks',
    'personalBooks',
    'readingList',
    'myBorrows',
  ];

  // =========================================================
  // UI
  // =========================================================

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
    <div
      className={`visitor-dashboard min-h-screen transition-colors duration-200 ${
        isDarkAppearance
          ? 'theme-dark bg-slate-900 text-slate-100'
          : 'bg-shelf-bg text-slate-800'
      }`}
    >
      {termsStatus === 'required' && (
        <div className="fixed inset-0 z-110 flex items-center justify-center bg-slate-950/70 p-0 sm:p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="visitor-terms-title"
            className="flex h-full max-h-full w-full max-w-2xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800 sm:h-auto sm:max-h-[90vh] sm:rounded-2xl"
          >
            <div className="flex shrink-0 items-start justify-between gap-4 bg-shelf-primary px-5 py-5 text-white sm:px-6">
              <div>
                <h2 id="visitor-terms-title" className="text-lg font-extrabold">
                  Terms and Conditions
                </h2>
                <p className="mt-1 text-sm text-slate-200">
                  Please review these terms before using your visitor account.
                </p>
                <p className="mt-1 text-xs text-slate-300">
                  Version {termsDocumentVersion}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void logout()}
                aria-label="Close Terms and Conditions and sign out"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 text-sm leading-6 text-slate-700 dark:text-slate-200 sm:px-6">
              <VisitorTermsContent content={termsDocumentContent} />
              {termsError && (
                <div role="alert" className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <p>{termsError}</p>
                  <button
                    type="button"
                    onClick={handleAcceptTerms}
                    disabled={isAcceptingTerms}
                    className="font-bold text-red-800 underline disabled:opacity-60"
                  >
                    Retry saving acceptance
                  </button>
                </div>
              )}
            </div>

            {termsStatus === 'required' && (
              <div className="visitor-terms-accept-footer shrink-0 border-t border-slate-200 px-5 py-4 dark:border-slate-700 sm:px-6">
                <button
                  type="button"
                  onClick={handleAcceptTerms}
                  disabled={isAcceptingTerms}
                  className="min-h-11 w-full rounded-lg bg-shelf-primary px-5 py-3 text-sm font-bold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isAcceptingTerms ? 'Saving...' : 'I agree'}
                </button>
              </div>
            )}
            {termsStatus === 'error' && (
              <div className="fixed inset-0 z-110 flex items-center justify-center bg-slate-950/70 p-4">
                <section
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="visitor-terms-check-title"
                  className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-800 sm:p-6"
                >
                  <h2 id="visitor-terms-check-title" className="text-lg font-bold text-slate-900 dark:text-white">
                    Terms and Conditions
                  </h2>
                  <p role="alert" className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-200">
                    {termsError}
                  </p>
                  <button
                    type="button"
                    onClick={loadTermsAcceptance}
                    className="mt-5 min-h-11 w-full rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary focus-visible:ring-offset-2"
                  >
                    Try again
                  </button>
                </section>
              </div>
            )}
          </section>
        </div>
      )}

            {/* ANNOUNCEMENT POPUP */}
            {isAnnouncementOpen && announcements[announcementIndex] && (
              <div className="fixed inset-0 z-90 flex items-center justify-center p-4">
                <button
                  type="button"
                  className="absolute inset-0 bg-slate-950/60"
                  onClick={dismissCurrentAnnouncement}
                  aria-label="Close announcement"
                />

                <section
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="visitor-announcement-title"
                  className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-800"
                >
                  <div className="flex items-center justify-between gap-3 bg-shelf-primary px-5 py-4 text-white">
                    <div className="flex items-center gap-3">
                      <Megaphone size={22} aria-hidden="true" />
                      <h2
                        id="visitor-announcement-title"
                        className="text-lg font-bold"
                      >
                        Library Announcement
                      </h2>
                    </div>

                    <button
                      type="button"
                      onClick={dismissCurrentAnnouncement}
                      className="rounded-lg p-2 transition hover:bg-white/15"
                      aria-label="Close announcement"
                    >
                      <X size={20} aria-hidden="true" />
                    </button>
                  </div>

                  <div className="space-y-3 p-5">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      {announcements[announcementIndex].title}
                    </h3>

                    <p className="whitespace-pre-wrap wrap-break-word text-sm leading-6 text-slate-600 dark:text-slate-300">
                      {announcements[announcementIndex].message}
                    </p>

                    <p className="text-xs text-slate-400">
                      {formatDateTime(
                        announcements[announcementIndex].created_at
                      )}
                    </p>

                    {/* ANNOUNCEMENT NAVIGATION */}
                    <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
                      <button
                        type="button"
                        disabled={announcementIndex === 0}
                        onClick={() => {
                          markAnnouncementRead(announcements[announcementIndex]);
                          setAnnouncementIndex((index) => index - 1);
                        }}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600"
                      >
                        Previous
                      </button>

                      <span className="text-xs text-slate-500 dark:text-slate-300">
                        {announcementIndex + 1} of {announcements.length}
                      </span>

                      {announcementIndex < announcements.length - 1 ? (
                        <button
                          type="button"
                          onClick={() => {
                            markAnnouncementRead(announcements[announcementIndex]);
                            setAnnouncementIndex((index) => index + 1);
                          }}
                          className="rounded-lg bg-shelf-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#003366]"
                        >
                          Next
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={dismissCurrentAnnouncement}
                          className="rounded-lg bg-shelf-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#003366]"
                        >
                          Got it
                        </button>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            )}


      {/* =====================================================
          HEADER
      ====================================================== */}
      <header className="visitor-header sticky top-0 z-40 border-b border-white/10 bg-shelf-primary px-3 py-2 text-white shadow-md sm:px-6">
        <div className="flex min-w-0 items-center justify-between gap-3">

          {/* LEFT: LOGO AND PORTAL LABEL */}
            <button
              type="button"
              onClick={() => navigate(user?.id ? getDashboardPath(user.role) : '/')}
              aria-label="Go to SHELF home"
              className="flex min-w-0 items-center gap-2 text-left sm:gap-3"
            >
            <img src="/shelf-logo.png" alt="" className="h-8 w-8 shrink-0 object-contain" />
            <span className="shrink-0 text-base font-extrabold tracking-wider sm:text-lg">
              SHELF
            </span>

            <span className="visitor-portal-label hidden text-xs font-medium sm:inline">
              Library Visitor
            </span>
            </button>

          {/* RIGHT: USER CONTROLS */}
          <div className="flex shrink-0 items-center justify-end gap-1.5 sm:ml-auto sm:gap-3">

            {/* DARK MODE */}
            <button
              type="button"
              onClick={() => setIsDarkAppearance((prev) => !prev)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-transparent text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label={
                isDarkAppearance
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
              }
              aria-pressed={isDarkAppearance}
              title={
                isDarkAppearance
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
              }
            >
              {isDarkAppearance ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
            </button>

{/* COMMUNITY BOOK REQUEST NOTIFICATIONS */}
<div className="relative">
  <button
    type="button"
    onClick={() => setIsNotificationsOpen((open) => !open)}
    className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-transparent text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
    aria-label={`Book request notifications: ${ownerNotificationCount} pending`}
    aria-expanded={isNotificationsOpen}
    title="Book request notifications"
  >
    <Bell size={19} aria-hidden="true" />

    {ownerNotificationCount > 0 && (
      <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
        {ownerNotificationCount > 99
          ? '99+'
          : ownerNotificationCount}
      </span>
    )}
  </button>

  {isNotificationsOpen && (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 cursor-default"
        aria-label="Close notifications"
        onClick={() => setIsNotificationsOpen(false)}
      />

      <section
        className="visitor-notifications-panel absolute right-0 z-50 mt-3 w-[min(92vw,380px)] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        aria-label="Community book notifications"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div>
            <h3 className="text-sm font-bold">
              Book Request Notifications
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {ownerNotificationCount} pending request
              {ownerNotificationCount === 1 ? '' : 's'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsNotificationsOpen(false)}
            className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-700"
            aria-label="Close notifications"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto p-3">
          {ownerPendingRequests.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <Bell
                size={26}
                className="mx-auto mb-2 text-slate-400"
                aria-hidden="true"
              />
              <p className="text-sm font-semibold">
                No pending book requests
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Requests for your community books will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {ownerPendingRequests.map((request) => (
                <button
                  key={request.id}
                  type="button"
                  onClick={() => {
                    setIsNotificationsOpen(false);
                    setTab('personalBooks');
                    setFocusRequestId(request.id);
                  }}
                  className="w-full rounded-lg border border-slate-200 p-3 text-left transition hover:border-blue-300 hover:bg-blue-50/50 dark:border-slate-700 dark:hover:bg-slate-700/60"
                  aria-label={`Open request for ${request.bookTitle || 'book'}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-blue-50 p-2 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                      <BookOpen size={18} aria-hidden="true" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="wrap-break-word text-sm font-semibold">
                        {request.requesterName || 'A SHELF visitor'} requested your book
                      </p>

                      <p className="mt-1 wrap-break-word text-sm">
                        {request.bookTitle || 'Untitled book'}
                      </p>

                      {request.requestDate && (
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {formatDateTime(request.requestDate)}
                        </p>
                      )}

                      <span className="mt-2 inline-flex rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
                        Pending approval
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  )}
</div>
            <div className="relative" ref={avatarMenuRef}>
              <button
                ref={avatarButtonRef}
                type="button"
                onClick={() => setIsAvatarMenuOpen((open) => !open)}
                className="visitor-profile-chip inline-flex h-10 items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-2 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:px-3"
                aria-label="Open account menu"
                aria-haspopup="menu"
                aria-expanded={isAvatarMenuOpen}
                title="Account menu"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/15 text-xs font-bold">
                  {profileImageSrc && !profileImageFailed ? (
                    <img
                      src={profileImageSrc}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={() => setFailedProfileImageSrc(profileImageSrc)}
                    />
                  ) : (
                    getVisitorInitials(user?.name || visitorDetails?.fullName)
                  )}
                </span>
                <span className="hidden max-w-24 truncate text-xs font-semibold md:inline">
                  {(user?.name || visitorDetails?.fullName || 'Visitor')
                    .trim()
                    .split(/\s+/)[0]}
                </span>
                <ChevronDown size={14} className="hidden md:block" aria-hidden="true" />
              </button>
              {isAvatarMenuOpen && (
                <div
                  role="menu"
                  aria-label="Account menu"
                  onKeyDown={(event) => {
                    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const items = Array.from(
                      avatarMenuRef.current?.querySelectorAll('[role="menuitem"]') || []
                    );
                    if (!items.length) return;
                    const currentIndex = items.indexOf(document.activeElement);
                    const nextIndex =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? items.length - 1
                          : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                    items[nextIndex]?.focus();
                  }}
                  className="visitor-account-menu absolute right-0 z-50 mt-2 w-[min(90vw,15rem)] overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsAvatarMenuOpen(false);
                      setMenuSection('profile');
                      setIsMenuOpen(true);
                    }}
                    className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary dark:hover:bg-slate-700"
                  >
                    <UserRound size={17} aria-hidden="true" />
                    View profile
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsAvatarMenuOpen(false);
                      setIsTermsReviewOpen(true);
                    }}
                    className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary dark:hover:bg-slate-700"
                  >
                    <FileText size={17} aria-hidden="true" />
                    Terms and conditions
                  </button>
                  <div role="separator" className="my-1 border-t border-slate-200 dark:border-slate-700" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsAvatarMenuOpen(false);
                      logout();
                    }}
                    className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-slate-700 hover:bg-red-50 hover:text-red-700 focus-visible:bg-red-50 focus-visible:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 dark:text-slate-200 dark:hover:bg-red-950/40 dark:hover:text-red-300 dark:focus-visible:bg-red-950/40 dark:focus-visible:text-red-300"
                  >
                    <LogOut size={17} aria-hidden="true" />
                    Sign out
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>
      </header>

      {/* =====================================================
          MAIN CONTENT
      ====================================================== */}
        <main className="mx-auto min-w-0 max-w-7xl space-y-7 px-3 py-5 sm:px-6 sm:py-8 lg:space-y-8">

        {/* =================================================
            PAGE HEADER
        ================================================== */}

        <div className="space-y-3">
          <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <MapPin size={14} className="shrink-0 text-blue-600 dark:text-blue-300" aria-hidden="true" />
            <span className="shrink-0">Your library:</span>
            <span className="truncate">{registeredLibraryName}</span>
          </div>
          <DashboardWelcome
          name={user?.name?.split(' ')[0]}
          visitorAppearance
          description="Search books, check availability, manage requests, and keep track of your library visits."
          showNotifications={false}
          actions={[
            {
              label: 'Scan QR Pass',
              Icon: QrCode,
              onClick: () => {
                setMenuSection('profile');
                setIsMenuOpen(true);
              },
            },
            {
              label: 'Search Catalog',
              Icon: Search,
              onClick: () => {
                setTab('catalog');

                document
                  .getElementById('visitor-catalog')
                  ?.scrollIntoView({
                    behavior: 'smooth',
                  });
              },
            },
            {
              label: 'View Fines',
              Icon: CircleDollarSign,
              onClick: () => {
                setTab('myBorrows');

                document
                  .getElementById('visitor-catalog')
                  ?.scrollIntoView({
                    behavior: 'smooth',
                  });
              },
            },
          ]}
          />
        </div>

        {visibleCommunityReturnReminders.length > 0 && (
          <section
            role="alert"
            aria-label="Community book return reminders"
            className="visitor-feedback visitor-feedback-warning rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm dark:border-amber-700 dark:bg-amber-950/40"
          >
            <span className="visitor-feedback-icon" aria-hidden="true">
              <AlertTriangle size={16} />
            </span>
            <div className="flex items-start gap-3">
              <AlertTriangle
                size={20}
                className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                  Community book return reminder
                </h2>
                <ul className="mt-2 space-y-2">
                  {visibleCommunityReturnReminders.map((transaction) => (
                    <li
                      key={transaction.id}
                      className="text-xs text-amber-900 dark:text-amber-100"
                    >
                      <span className="font-semibold">
                        {transaction.bookTitle || 'Community book'}
                      </span>
                      {' — '}
                      {transaction.reminder.label}. Please return it to
                      {' '}
                      {transaction.ownerName || 'the owner'} by
                      {' '}
                      {formatDateTime(transaction.dueDate)}.
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => {
                    setTab('myBorrows');
                    document
                      .getElementById('visitor-catalog')
                      ?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className="mt-3 text-xs font-bold text-amber-900 underline hover:no-underline dark:text-amber-200"
                >
                  View my requests and borrows
                </button>
              </div>
              <button
                type="button"
                onClick={() =>
                  setDismissedReminderIds(
                    (current) =>
                      new Set([
                        ...current,
                        ...visibleCommunityReturnReminders.map(
                          (transaction) => String(transaction.id)
                        ),
                      ])
                  )
                }
                className="rounded-lg p-2 text-slate-700 transition hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary dark:text-slate-100 dark:hover:bg-slate-700"
                aria-label="Dismiss community book return reminder"
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>
          </section>
        )}

        {communityRequestNotice && (
          <section
            role="status"
            aria-live="polite"
            className={`visitor-feedback flex items-start gap-3 rounded-xl border p-4 shadow-sm ${communityRequestNotice.type === 'rejected' ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40' : 'visitor-feedback-success border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40'}`}
          >
            {communityRequestNotice.type === 'rejected' ? <CircleAlert
              size={20}
              className="mt-0.5 shrink-0 text-red-700 dark:text-red-300"
              aria-hidden="true"
            /> : <CheckCircle2
              size={20}
              className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-300"
              aria-hidden="true"
            />}
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold ${communityRequestNotice.type === 'rejected' ? 'text-red-950 dark:text-red-100' : 'text-emerald-950 dark:text-emerald-100'}`}>
                {communityRequestNotice.message}
              </p>
              <button
                type="button"
                onClick={() => {
                  setTab('myBorrows');
                  setCommunityRequestNotice(null);
                  document
                    .getElementById('visitor-catalog')
                    ?.scrollIntoView({ behavior: 'smooth' });
                }}
                className={`mt-2 text-xs font-bold underline hover:no-underline ${communityRequestNotice.type === 'rejected' ? 'text-red-900 dark:text-red-200' : 'text-emerald-900 dark:text-emerald-200'}`}
              >
                Open my requests & borrows
              </button>
            </div>
            <button
              type="button"
              onClick={() => setCommunityRequestNotice(null)}
              className={`rounded-lg p-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary ${communityRequestNotice.type === 'rejected' ? 'text-red-900 hover:bg-red-100 dark:text-red-200 dark:hover:bg-red-900/50' : 'text-emerald-900 hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900/50'}`}
              aria-label="Dismiss community book request notification"
            >
              <X size={17} aria-hidden="true" />
            </button>
          </section>
        )}

        {/* =================================================
            PRIMARY NAVIGATION
        ================================================== */}
        <nav
          aria-label="Visitor dashboard"
          className="relative z-30 flex min-w-0 flex-nowrap gap-2 overflow-x-auto overflow-y-hidden scroll-px-3 snap-x snap-proximity border-b border-slate-200 bg-shelf-bg/95 px-3 pb-3 pt-2 backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/95 sm:sticky sm:top-20 sm:rounded-2xl sm:border sm:px-3 sm:py-2.5"
        >
          {[
            { id: 'catalog', label: 'Catalog', Icon: BookOpen },
            { id: 'categories', label: 'Book Categories', Icon: Bookmark },
            { id: 'communityBooks', label: 'Community Books', Icon: UsersRound },
            { id: 'personalBooks', label: 'My Personal Books', Icon: BookMarked },
            { id: 'readingList', label: 'My Reading List', Icon: ClipboardList },
            { id: 'myBorrows', label: 'My Requests & Borrows', Icon: CalendarDays },
            { id: 'map', label: 'Library Map', Icon: MapPinned },
            { id: 'services', label: 'Announcements & Feedback', Icon: Megaphone },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              ref={tab === id ? activeVisitorNavTabRef : null}
              onClick={() => {
                setTab(id);

                if (id === 'catalog') {
                  setCatalogResetKey((key) => key + 1);
                }
              }}
              className={`inline-flex min-h-12 shrink-0 snap-start items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm font-bold transition sm:px-5 sm:text-base ${
                tab === id
                  ? 'bg-shelf-primary text-white shadow-sm dark:bg-shelf-primary'
                  : 'border border-transparent text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white'
              }`}
              aria-current={tab === id ? 'page' : undefined}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {/* =================================================
            OPAC VIEWS
        ================================================== */}

        {opacViews.includes(tab) && (
          <div
            id="visitor-catalog"
            className="space-y-6 scroll-mt-5"
          >
            {/* =================================================
                AI RECOMMENDATIONS
            ================================================== */}

            {tab === 'catalog' && <AIRecommendations />}

            {/* =================================================
                LIBRARY FILTER
            ================================================== */}

            {libraryFilter &&
              (
                tab === 'catalog' ||
                tab === 'categories' ||
                tab === 'myBorrows'
              ) && (
                <div className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
                  <span>
                    Filtered to <b>{libraryName(libraryFilter)}</b>
                  </span>

                  <button
                    type="button"
                    onClick={() => setLibraryFilter(null)}
                    className="text-shelf-primary dark:text-blue-400 font-bold hover:underline"
                  >
                    Clear filter
                  </button>
                </div>
              )}

            {/* =================================================
                OPAC
            ================================================== */}

            <OPACCatalog
              embedded
              libraryFilter={
                tab === 'communityBooks' ||
                tab === 'personalBooks'
                  ? null
                  : libraryFilter
              }
              activeView={tab}
              onViewChange={setTab}
              catalogResetKey={catalogResetKey}
              focusRequestId={focusRequestId}
              borrowRequestsLoading={borrowRequestsLoading}
              borrowRequestsLoadError={borrowRequestsLoadError}
              onRetryBorrowRequests={retryBorrowRequests}
            />
          </div>
        )}

        {/* =================================================
            LIBRARY MAP
        ================================================== */}

        {tab === 'map' && (
          <LibraryMap
            onBrowseLibrary={(libraryId) => {
              setLibraryFilter(libraryId);
              setTab('catalog');
            }}
          />
        )}

        {/* =================================================
            SERVICES
        ================================================== */}

        {tab === 'services' && (
          <VisitorServices
            user={user}
            libraries={libraries}
          />
        )}
      </main>

      {/* =====================================================
          VISITOR MENU
      ====================================================== */}

      {isMenuOpen && (
        <div
          className={`fixed inset-0 z-50 flex ${menuSection === 'profile' ? 'justify-center' : 'justify-end'}`}
          role="dialog"
          aria-modal="true"
          aria-label={menuSection === 'profile' ? 'My profile' : 'Visitor menu'}
        >
          {/* BACKDROP */}

          <button
            type="button"
            className={`absolute inset-0 ${menuSection === 'profile' ? 'bg-slate-100 dark:bg-slate-950' : 'bg-slate-950/45'}`}
            onClick={() => setIsMenuOpen(false)}
            aria-label="Close visitor menu"
          />

          {/* SIDE MENU */}

          <aside className={`visitor-profile-drawer relative flex h-full w-full flex-col bg-white dark:bg-slate-800 shadow-2xl ${menuSection === 'profile' ? 'visitor-profile-page max-w-none' : 'max-w-md'}`}>
            {/* MENU HEADER */}

            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Visitor Portal
                </p>

                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  {menuSection === 'profile' ? 'My Profile' : 'Your Menu'}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setIsMenuOpen(false)}
                className="rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white"
                aria-label="Close visitor menu"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            {/* MENU CONTENT */}

            <div className="visitor-profile-content min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {/* =================================================
                  PROFILE
              ================================================== */}

              {menuSection === 'profile' && (
                <div className="space-y-6">
                  <section className="visitor-profile-summary flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/60 sm:flex-nowrap">
                    <span className="relative flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-full bg-shelf-primary text-2xl font-bold text-white ring-4 ring-white shadow-md dark:ring-slate-800">
                      {profileImageSrc && !profileImageFailed ? (
                        <img
                          src={profileImageSrc}
                          alt=""
                          className="h-full w-full object-cover"
                          onError={() => setFailedProfileImageSrc(profileImageSrc)}
                        />
                      ) : (
                        getVisitorInitials(visitorDetails?.fullName || user?.name)
                      )}
                      {isEditingProfile && (
                        <label className="absolute inset-x-0 bottom-0 flex cursor-pointer items-center justify-center bg-shelf-primary/95 py-1.5 text-xs font-bold text-white shadow-sm" title="Change profile photo">
                          Change
                          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleProfileImageChange} className="sr-only" />
                        </label>
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                        {visitorDetails?.fullName || user?.name || 'Visitor'}
                      </p>
                      <p className="truncate text-xs text-slate-600 dark:text-slate-300">
                        {visitorDetails?.email || user?.email || '—'}
                      </p>
                      {isEditingProfile && (
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <p className="text-xs text-slate-500 dark:text-slate-400">JPG, PNG, or WEBP up to 2 MB</p>
                          {(profileImageSrc || visitorDetails?.profileImagePath) && (
                            <button type="button" onClick={() => { setProfileImageFile(null); setProfileImagePreview(''); setRemoveProfileImage(true); setProfileError(''); }} className="text-xs font-semibold text-red-700 hover:underline dark:text-red-300">Remove photo</button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-4 p-1">
                      {visitorQrCode ? (
                        <div className="visitor-qr-frame rounded-xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-600">
                          <div ref={qrCodeRef}>
                            <QRCodeSVG value={visitorQrCode} size={104} level="H" includeMargin fgColor="#000000" bgColor="#FFFFFF" />
                          </div>
                        </div>
                      ) : <div className="flex h-[120px] w-[120px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-400 dark:border-slate-600 dark:bg-slate-900"><QrCode size={32} aria-hidden="true" /></div>}
                      <div className="min-w-0">
                        <p className="font-sans text-[10px] font-bold uppercase tracking-[0.16em] text-shelf-primary">Visitor pass</p>
                        <h3 className="mt-1 font-sans text-base font-bold text-slate-900 dark:text-white">Library QR Pass</h3>
                        <p className="mt-1 max-w-40 text-xs leading-relaxed text-slate-600 dark:text-slate-300">Show this code at the library desk.</p>
                        {visitorQrCode && <button type="button" onClick={handleSaveQrAsImage} disabled={isSavingQr} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-shelf-primary px-3 py-2 font-sans text-xs font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"><Save size={13} aria-hidden="true" />{isSavingQr ? 'Saving…' : 'Save pass'}</button>}
                        {qrSaveMessage && <p role="status" className="mt-2 max-w-44 text-xs text-emerald-700 dark:text-emerald-300">{qrSaveMessage}</p>}
                        {qrSaveError && <p role="alert" className="mt-2 max-w-44 text-xs text-red-700 dark:text-red-300">{qrSaveError}</p>}
                        {!visitorQrCode && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">QR code is refreshing…</p>}
                      </div>
                    </div>
                  </section>

                  {profileMessage && (
                    <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                      {profileMessage}
                    </p>
                  )}

                  <form onSubmit={handleSaveVisitorProfile}>
                    <section>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Personal Information</h3>
                        {isEditingProfile ? (
                          <div className="flex gap-2">
                            <button type="button" onClick={cancelProfileEdit} disabled={isSavingProfile} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">Cancel</button>
                            <button type="submit" disabled={isSavingProfile || Boolean(pendingProfileImageFile)} className="inline-flex items-center gap-1.5 rounded-lg bg-shelf-primary px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"><Save size={14} aria-hidden="true" />{isSavingProfile ? 'Saving…' : 'Save'}</button>
                          </div>
                        ) : (
                          <button type="button" onClick={() => { setProfileForm({ contactNumber: visitorDetails?.contactNumber || '' }); setProfileError(''); setProfileMessage(''); setIsEditingProfile(true); }} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"><Pencil size={14} aria-hidden="true" />Edit profile</button>
                        )}
                      </div>
                      <dl className="divide-y divide-slate-100 border-y border-slate-100 text-sm dark:divide-slate-700 dark:border-slate-700">
                        {[
                          [UserRound, 'Full name', visitorDetails?.fullName || user?.name],
                          [Mail, 'Email', visitorDetails?.email || user?.email],
                          [Phone, 'Contact number', visitorDetails?.contactNumber],
                          [MapPin, 'Address', visitorDetails?.address],
                        ].map(([Icon, label, value]) => (
                          <div key={label} className="grid grid-cols-[7rem_1fr] gap-3 py-2.5">
                            <dt className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><Icon size={14} aria-hidden="true" />{label}</dt>
                            <dd className="wrap-break-word font-medium text-slate-800 dark:text-slate-200">
                              {isEditingProfile && label === 'Contact number' ? <input type="tel" maxLength={50} value={profileForm.contactNumber} onChange={(event) => setProfileForm((current) => ({ ...current, contactNumber: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal text-slate-900 focus:border-shelf-primary focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white" aria-label="Contact number" /> : value || '—'}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      {isEditingProfile && profileError && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{profileError}</p>}
                    </section>
                  </form>
                  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                    <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-4">
                        <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${visitorMfaFactor ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-slate-100 text-shelf-primary dark:bg-slate-700 dark:text-blue-200'}`}><ShieldCheck size={23} aria-hidden="true" /></div>
                        <div><h3 className="text-base font-bold text-slate-900 dark:text-white">Account security</h3><p className="mt-1 max-w-xl text-sm leading-5 text-slate-600 dark:text-slate-300">Add an authenticator code as a second step when signing in.</p><span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${visitorMfaFactor ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200'}`}><span className={`h-1.5 w-1.5 rounded-full ${visitorMfaFactor ? 'bg-emerald-500' : 'bg-slate-400'}`} />{visitorMfaFactor ? 'Two-step verification is on' : 'Two-step verification is off'}</span></div>
                      </div>
                      {visitorMfaFactor ? <button type="button" onClick={() => { setVisitorMfaDisableConfirm(true); setVisitorMfaCode(''); setVisitorMfaError(''); setVisitorMfaMessage(''); }} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">Turn off MFA</button> : <button type="button" onClick={startVisitorMfaSetup} disabled={visitorMfaLoading || Boolean(visitorMfaSetup)} className="rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50">{visitorMfaLoading ? 'Preparing setup…' : 'Set up MFA'}</button>}
                    </div>
                    {visitorMfaMessage && <p role="status" className="border-t border-emerald-100 bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">{visitorMfaMessage}</p>}
                    {visitorMfaError && !visitorMfaSetup && <p role="alert" className="border-t border-rose-100 bg-rose-50 px-5 py-3 text-sm font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{visitorMfaError}</p>}
                  </section>
                  <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                    <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-4">
                        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-blue-50 text-shelf-primary dark:bg-blue-950/50 dark:text-blue-200"><Fingerprint size={23} aria-hidden="true" /></div>
                        <div>
                          <h3 className="text-base font-bold text-slate-900 dark:text-white">Passkey sign-in</h3>
                          <p className="mt-1 max-w-xl text-sm leading-5 text-slate-600 dark:text-slate-300">Add a passkey on your own phone to sign in with fingerprint, Face ID, or its screen lock. Each visitor can register their own devices.</p>
                          {visitorPasskeys.map((passkey) => (
                            <div key={passkey.id} className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                              <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">{passkey.friendly_name || 'Passkey added'}</span>
                              {passkey.created_at && <span>Added {new Date(passkey.created_at).toLocaleDateString()}</span>}
                              <button type="button" disabled={visitorPasskeyBusy} onClick={() => removeVisitorPasskey(passkey)} className="font-semibold text-rose-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-rose-300">Remove</button>
                            </div>
                          ))}
                        </div>
                      </div>
                      <button type="button" onClick={registerVisitorPasskey} disabled={visitorPasskeyBusy || visitorPasskeyLoading || isPasskeysDisabled(visitorPasskeyError)} className="shrink-0 rounded-lg bg-shelf-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
                        {isPasskeysDisabled(visitorPasskeyError) ? 'Passkeys unavailable' : visitorPasskeyBusy ? 'Working…' : visitorPasskeys.length ? 'Add another passkey' : 'Set up passkey'}
                      </button>
                    </div>
                    {visitorPasskeyLoading && <p className="border-t border-slate-100 px-5 py-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-300">Loading passkeys…</p>}
                    {visitorPasskeyMessage && <p role="status" className="border-t border-emerald-100 bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">{visitorPasskeyMessage}</p>}
                    {visitorPasskeyError && <p role="alert" className="border-t border-rose-100 bg-rose-50 px-5 py-3 text-sm font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{visitorPasskeyError}</p>}
                  </section>
                  {(visitorMfaSetup?.qrCode || visitorMfaDisableConfirm) && <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !visitorMfaLoading) { setVisitorMfaSetup(null); setVisitorMfaDisableConfirm(false); setVisitorMfaError(''); setVisitorMfaCode(''); } }}><section role="dialog" aria-modal="true" aria-labelledby="visitor-mfa-dialog-title" className="my-auto w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-800">
                    {visitorMfaSetup?.qrCode ? <><div className="mb-5"><p className="text-xs font-bold uppercase tracking-wider text-shelf-primary">Secure your account</p><h3 id="visitor-mfa-dialog-title" className="mt-1 text-xl font-bold text-slate-900 dark:text-white">Set up two-step verification</h3><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Use an authenticator app such as Google Authenticator or Microsoft Authenticator.</p></div><div className="grid gap-5 sm:grid-cols-[180px_1fr]"><div className="mx-auto rounded-xl border border-slate-200 bg-white p-3"><img src={visitorMfaSetup.qrCode} alt="Scan this QR code with your authenticator app" className="h-[156px] w-[156px]" /></div><div><ol className="space-y-2 text-sm text-slate-700 dark:text-slate-200"><li><b className="mr-2 text-shelf-primary">1.</b>Open your authenticator app and scan this QR code.</li><li><b className="mr-2 text-shelf-primary">2.</b>Enter the six-digit code shown in the app.</li></ol><details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-300">Can't scan? Show setup key</summary><p className="mt-2 break-all rounded-lg bg-slate-50 p-2 font-mono text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-200">{visitorMfaSetup.secret}</p></details><form onSubmit={confirmVisitorMfaSetup} className="mt-4"><label htmlFor="visitor-mfa-setup-code" className="block text-xs font-semibold text-slate-700 dark:text-slate-200">Authenticator code</label><input id="visitor-mfa-setup-code" value={visitorMfaCode} onChange={(event) => setVisitorMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center font-mono text-lg tracking-[0.5em] dark:border-slate-600 dark:bg-slate-900 dark:text-white" />{visitorMfaError && <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">{visitorMfaError}</p>}<div className="mt-4 flex justify-end gap-2"><button type="button" disabled={visitorMfaLoading} onClick={() => { setVisitorMfaSetup(null); setVisitorMfaError(''); setVisitorMfaCode(''); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-600 dark:text-slate-200">Cancel</button><button disabled={visitorMfaLoading || visitorMfaCode.length !== 6} className="rounded-lg bg-shelf-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{visitorMfaLoading ? 'Verifying…' : 'Confirm and enable'}</button></div></form></div></div></> : <form onSubmit={disableVisitorMfa}><p className="text-xs font-bold uppercase tracking-wider text-rose-700">Confirm security change</p><h3 id="visitor-mfa-dialog-title" className="mt-1 text-xl font-bold text-slate-900 dark:text-white">Turn off MFA?</h3><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Your account will no longer require an authenticator code at sign-in. Enter a current code to confirm.</p><label htmlFor="visitor-mfa-disable-code" className="mt-5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Authenticator code</label><input id="visitor-mfa-disable-code" value={visitorMfaCode} onChange={(event) => setVisitorMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center font-mono text-lg tracking-[0.5em] dark:border-slate-600 dark:bg-slate-900 dark:text-white" />{visitorMfaError && <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">{visitorMfaError}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" disabled={visitorMfaLoading} onClick={() => { setVisitorMfaDisableConfirm(false); setVisitorMfaError(''); setVisitorMfaCode(''); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-600 dark:text-slate-200">Cancel</button><button disabled={visitorMfaLoading || visitorMfaCode.length !== 6} className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{visitorMfaLoading ? 'Updating…' : 'Confirm and turn off'}</button></div></form>}
                  </section></div>}
                  {/* =================================================
                      ATTENDANCE HISTORY
                  ================================================== */}

                  <section>
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                      <CalendarDays
                        size={16}
                        aria-hidden="true"
                      />
                      Attendance History
                    </h3>

                    <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Attendance date filter">
                      {ATTENDANCE_PERIOD_FILTERS.map((filter) => (
                        <button
                          key={filter.value}
                          type="button"
                          onClick={() => setAttendancePeriod(filter.value)}
                          aria-pressed={attendancePeriod === filter.value}
                          className={`rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                            attendancePeriod === filter.value
                              ? 'border-shelf-primary bg-shelf-primary text-white'
                              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                          }`}
                        >
                          {filter.label}
                        </button>
                      ))}
                    </div>
                    <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                      <span className="font-semibold text-slate-600 dark:text-slate-300">Total attendance</span>
                      <span className="tabular-nums font-bold text-slate-900 dark:text-white" aria-live="polite">
                        {attendanceHistoryTotal === null ? '—' : attendanceHistoryTotal}
                      </span>
                    </div>
                    <div className="mb-3">
                      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Library
                        <select
                          value={attendanceLibraryFilter}
                          onChange={(event) => setAttendanceLibraryFilter(event.target.value)}
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                        >
                          <option value="all">All libraries</option>
                          {libraries.map((library) => (
                            <option key={library.id} value={library.id}>{library.name}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {myVisits.length > 0 && (
                      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/40">
                          <h4 className="mb-2 text-xs font-bold text-slate-700 dark:text-slate-200">Most visited libraries</h4>
                          <div className="h-48">
                            <Bar data={attendanceLibraryChartData} options={attendanceChartOptions} />
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/40">
                          <h4 className="mb-2 text-xs font-bold text-slate-700 dark:text-slate-200">Visits per month · last 6 months</h4>
                          <div className="h-48">
                            <Bar data={attendanceMonthlyChartData} options={attendanceMonthlyChartOptions} />
                          </div>
                        </div>
                        {attendanceHistoryHasMore && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 md:col-span-2">Charts update as more attendance history loads.</p>
                        )}
                      </div>
                    )}
                    <div
                      ref={attendanceHistoryContainerRef}
                      onScroll={(event) => setAttendanceHistoryScrollTop(event.currentTarget.scrollTop)}
                      className="max-h-72 overflow-y-auto overscroll-contain pr-1"
                      aria-label="Attendance history records"
                    >
                      {myVisits.length > 0 && (
                        <ul
                          aria-label={`Attendance history, ${attendanceHistoryTotal ?? myVisits.length} total records; ${myVisits.length} loaded`}
                          className="divide-y divide-slate-100 border-y border-slate-100 dark:divide-slate-700 dark:border-slate-700"
                          style={{
                            paddingTop: attendanceVisibleStart * attendanceRowHeight,
                            paddingBottom: (myVisits.length - attendanceVisibleEnd) * attendanceRowHeight,
                          }}
                        >
                          {visibleAttendanceVisits.map((visit, index) => (
                            <li
                              key={visit.id}
                              aria-posinset={attendanceVisibleStart + index + 1}
                              aria-setsize={attendanceHistoryTotal ?? myVisits.length}
                              className="flex h-11 items-center justify-between gap-3 overflow-hidden py-2.5 text-xs"
                            >
                              <span className="min-w-0 truncate font-medium text-slate-700 dark:text-slate-300">
                                {libraryName(visit.libraryId)}
                              </span>
                              <time className="shrink-0 text-slate-500 dark:text-slate-400">
                                {formatDateTime(visit.timeIn)}
                              </time>
                            </li>
                          ))}
                        </ul>
                      )}
                      {attendanceHistoryLoading && (
                        <p role="status" className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">Loading attendance history...</p>
                      )}
                      {!attendanceHistoryLoading && !attendanceHistoryError && myVisits.length === 0 && (
                        <div className="rounded-lg border border-dashed border-slate-300 px-4 py-5 text-center dark:border-slate-600">
                          <CalendarDays size={20} className="mx-auto text-slate-600 dark:text-slate-300" aria-hidden="true" />
                          <p className="mt-2 text-xs text-slate-700 dark:text-slate-200">No attendance history for these filters.</p>
                        </div>
                      )}
                      {attendanceHistoryError && (
                        <div role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                          <p>{attendanceHistoryError}</p>
                          <button type="button" onClick={() => void loadAttendanceHistory(myVisits.length === 0)} className="mt-2 font-bold underline">Retry</button>
                        </div>
                      )}
                      <div ref={attendanceHistorySentinelRef} aria-hidden="true" className="h-1" />
                      {attendanceHistoryHasMore && typeof IntersectionObserver === 'undefined' && (
                        <button type="button" onClick={() => void loadAttendanceHistory(false)} disabled={attendanceHistoryLoading} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">Load more attendance</button>
                      )}
                      {!attendanceHistoryHasMore && myVisits.length > 0 && !attendanceHistoryLoading && (
                        <p className="py-2 text-center text-[11px] text-slate-400">You have reached the end of your attendance history.</p>
                      )}
                    </div>
                  </section>

                </div>
              )}
            </div>
          </aside>
        </div>
      )}
      {pendingProfileImageFile && (
          <VisitorProfilePhotoCropDialog
            file={pendingProfileImageFile}
            onCancel={() => setPendingProfileImageFile(null)}
            onApply={handleProfileImageCrop}
          />
      )}

      {isTermsReviewOpen && (
        <div
          className="visitor-terms-review fixed inset-0 z-90 flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-4"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setIsTermsReviewOpen(false);
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="visitor-terms-review-title"
            className="flex h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800 sm:h-auto sm:max-h-[85vh] sm:max-w-2xl sm:rounded-2xl"
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700 sm:px-6">
              <h2 id="visitor-terms-review-title" className="text-lg font-bold text-slate-900 dark:text-white">
                Terms and Conditions
              </h2>
              <button
                type="button"
                onClick={() => setIsTermsReviewOpen(false)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary dark:text-slate-200 dark:hover:bg-slate-700"
                aria-label="Close Terms and Conditions"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 text-sm leading-6 text-slate-700 dark:text-slate-200 sm:px-6">
              <VisitorTermsContent content={termsDocumentContent} />
            </div>
            <footer className="visitor-terms-review-footer shrink-0 border-t border-slate-200 px-5 py-4 dark:border-slate-700 sm:px-6">
              <button
                type="button"
                onClick={() => setIsTermsReviewOpen(false)}
                className="min-h-11 w-full rounded-lg bg-shelf-primary px-5 py-3 text-sm font-bold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary focus-visible:ring-offset-2 sm:w-auto sm:min-w-28"
              >
                Close
              </button>
            </footer>
          </section>
        </div>
      )}

      {/* Floating FAQ Chatbot */}
      <Draggable
        nodeRef={faqDragRef}
        handle=".faq-drag-handle"
        cancel="button, input, textarea"
        bounds="body"
      >
        <div
          ref={faqDragRef}
          className={`faq-chat-shell fixed bottom-5 right-5 z-100 w-fit${isFaqOpen ? ' faq-chat-open' : ''}`}
        >
          {/* FAQ Chatbot Window */}
          {isFaqOpen && (
            <div className="faq-chat-panel mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800">
              {/* Draggable Header */}
              <div className="faq-drag-handle flex cursor-move items-center justify-between gap-3 bg-shelf-primary px-4 py-3 text-white">
                <div className="min-w-0">
                  <h3 className="font-bold">
                    SHELF FAQ Assistant
                  </h3>

                  <p className="text-xs text-slate-200">
                    Ask questions about SHELF and library services
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setIsFaqOpen(false)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  aria-label="Close FAQ chatbot"
                  title="Close chatbot"
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>

              {/* FAQ Content */}
              <div className="faq-chat-content max-h-[70vh] overflow-y-auto bg-white p-3 dark:bg-slate-800">
                <FAQ />
              </div>
            </div>
          )}

          {/* Floating Chatbot Button */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setIsFaqOpen((open) => !open)}
              className="faq-floating-button flex h-14 w-14 items-center justify-center rounded-full bg-shelf-primary text-white shadow-xl transition hover:scale-105 hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300"
              aria-label={
                isFaqOpen
                  ? 'Close FAQ chatbot'
                  : 'Open FAQ chatbot'
              }
              aria-expanded={isFaqOpen}
              title="SHELF FAQ Assistant"
            >
              {isFaqOpen ? (
                <X size={24} aria-hidden="true" />
              ) : (
                <MessageCircle size={24} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </Draggable>
    </div>
  );
}
export default function VisitorDashboard() {
  return (
    <ThemeProvider>
      <VisitorDashboardContent />
    </ThemeProvider>
  );
}
