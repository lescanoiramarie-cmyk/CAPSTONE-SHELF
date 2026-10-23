import { useCallback, useEffect, useRef, useState } from 'react';
import Draggable from 'react-draggable';
import { QRCodeSVG } from 'qrcode.react';
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
  Clock3,
  ClipboardList,
  CircleDollarSign,
  ChevronDown,
  ChevronRight,
  FileText,
  LogOut,
  Mail,
  MapPinned,
  Megaphone,
  MessageCircle,
  Moon,
  MapPin,
  Phone,
  QrCode,
  Search,
  Sun,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';

import { useAuth } from '../../context/useAuth.js';
import { useLibraryData } from '../../context/useLibrary.js';
import { supabase } from '../../lib/supabaseClient.js';

import OPACCatalog from '../../component/OPACCatalog.jsx';
import LibraryMap from '../../component/LibraryMap.jsx';
import FAQ from '../../component/FAQ.jsx';
import VisitorServices from '../../component/VisitorServices.jsx';
import AIRecommendations from '../../component/AIRecommendations.jsx';
import DashboardWelcome from '../../component/DashboardWelcome.jsx';
import VisitorTermsContent from '../../component/VisitorTermsContent.jsx';

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

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-PH', {
        dateStyle: 'medium',
      });
}

function formatStatus(status) {
  return String(status || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getStatusClass(status) {
  const normalizedStatus = String(status || '').toLowerCase();

  switch (normalizedStatus) {
    case 'returned':
      return 'visitor-status visitor-status-success';

    case 'borrowed':
      return 'visitor-status visitor-status-navy';

    case 'ready_for_pickup':
      return 'visitor-status visitor-status-navy';

    case 'queued':
    case 'expired':
    case 'cancelled':
      return 'visitor-status visitor-status-neutral';

    case 'rejected':
    case 'overdue':
      return 'visitor-status visitor-status-danger';

    case 'pending':
    case 'pending_approval':
    case 'to_confirm':
      return 'visitor-status visitor-status-warning';

    case 'available':
    case 'success':
      return 'visitor-status visitor-status-success';

    default:
      return 'visitor-status visitor-status-neutral';
  }
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

  const {
  attendanceLogs = [],
  borrowRequests = [],
  libraries = [],
  visitors = [],
  ownerCommunityBookRequests = [],
  loading: libraryLoading = true,
} = useLibraryData();
  const visitorDetails = visitors.find(
    (visitor) => visitor.id === user?.id
  );

  const [tab, setTab] = useState('catalog');
  const [catalogResetKey, setCatalogResetKey] = useState(0);
  const [libraryFilter, setLibraryFilter] = useState(null);
  const [isSavingQr, setIsSavingQr] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuSection, setMenuSection] = useState('profile');
  const [showAllTransactions, setShowAllTransactions] = useState(false);
  const [dismissedReminderIds, setDismissedReminderIds] = useState(() => new Set());
  const [isFaqOpen, setIsFaqOpen] = useState(false);
  const faqDragRef = useRef(null);

  const [announcements, setAnnouncements] = useState([]);
  const [announcementIndex, setAnnouncementIndex] = useState(0);
  const [isAnnouncementOpen, setIsAnnouncementOpen] = useState(false);

  const [isNotificationsOpen, setIsNotificationsOpen] =
  useState(false);
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false);
  const [isTermsReviewOpen, setIsTermsReviewOpen] = useState(false);
  const [focusRequestId, setFocusRequestId] = useState(null);
  const [termsStatus, setTermsStatus] = useState('loading');
  const [termsAcceptedAt, setTermsAcceptedAt] = useState(null);
  const [termsError, setTermsError] = useState('');
  const [isAcceptingTerms, setIsAcceptingTerms] = useState(false);
  const avatarMenuRef = useRef(null);
  const avatarButtonRef = useRef(null);

  const { isDarkAppearance, setIsDarkAppearance } = useTheme();

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
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      if (sessionError) throw sessionError;

      if (!sessionData?.session) {
        const acceptedAt = globalThis.localStorage.getItem(
          `shelf_visitor_terms_accepted_${user.id}`
        );
        setTermsAcceptedAt(acceptedAt || null);
        setTermsStatus(acceptedAt ? 'accepted' : 'required');
        return;
      }

      const { data, error } = await supabase.rpc(
        'get_visitor_terms_accepted_at'
      );
      if (error) throw error;
      setTermsAcceptedAt(data || null);
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
        const { data, error } = await supabase.rpc('accept_visitor_terms');
        if (error) throw error;
        setTermsAcceptedAt(data || new Date().toISOString());
      } else {
        const acceptedAt = new Date().toISOString();
        globalThis.localStorage.setItem(
          `shelf_visitor_terms_accepted_${user.id}`,
          acceptedAt
        );
        setTermsAcceptedAt(acceptedAt);
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
          if (!supabase) return;

          try {
            const { data, error } = await supabase
              .from('announcements')
              .select('id, title, message, created_at')
              .eq('published', true)
              .order('created_at', { ascending: false });

            if (!active) return;

            if (error) {
              console.error('Unable to load announcements:', error.message);
              return;
            }

            const items = data || [];
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
      }, []);


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

      context.fillText('SHELF ILMS', canvasWidth / 2, 65);

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
    } catch (error) {
      console.error('Save QR image error:', error);

      alert('Unable to save the QR code as an image. Please try again.');
    } finally {
      setIsSavingQr(false);
    }
  };

  // =========================================================
  // VISITOR ATTENDANCE
  // =========================================================

  const myVisits = attendanceLogs
    .filter((attendance) => attendance.visitorId === user?.id)
    .sort((a, b) => new Date(b.timeIn) - new Date(a.timeIn));

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

  const pastTransactionStatuses = new Set([
    'returned',
    'cancelled',
    'expired',
    'rejected',
  ]);
  const transactionGroups = [
    {
      label: 'Active',
      entries: myTransactions.filter(
        (transaction) =>
          !pastTransactionStatuses.has(
            String(transaction.status || '').toLowerCase()
          )
      ),
    },
    {
      label: 'Past',
      entries: myTransactions.filter((transaction) =>
        pastTransactionStatuses.has(
          String(transaction.status || '').toLowerCase()
        )
      ),
    },
  ];
  const visibleTransactionIds = new Set(
    myTransactions
      .slice(0, showAllTransactions ? myTransactions.length : 5)
      .map((transaction) => String(transaction.id))
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
            <div className="shrink-0 bg-shelf-primary px-5 py-5 text-white sm:px-6">
              <h2 id="visitor-terms-title" className="text-lg font-extrabold">
                Terms and Conditions
              </h2>
              <p className="mt-1 text-sm text-slate-200">
                Please review these terms before using your visitor account.
              </p>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 text-sm leading-6 text-slate-700 dark:text-slate-200 sm:px-6">
              <VisitorTermsContent />
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
                  {isAcceptingTerms ? 'Saving...' : 'I Agree'}
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
                  onClick={() => setIsAnnouncementOpen(false)}
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
                      onClick={() => setIsAnnouncementOpen(false)}
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
                        onClick={() =>
                          setAnnouncementIndex((index) => index - 1)
                        }
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
                          onClick={() =>
                            setAnnouncementIndex((index) => index + 1)
                          }
                          className="rounded-lg bg-shelf-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#003366]"
                        >
                          Next
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setIsAnnouncementOpen(false)}
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
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <span className="shrink-0 text-base font-extrabold tracking-wider sm:text-lg">
              SHELF ILMS
            </span>

            <span className="visitor-portal-label hidden text-xs font-medium sm:inline">
              Library Visitor
            </span>
          </div>

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
      <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
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
        className="absolute right-0 z-50 mt-3 w-[min(92vw,380px)] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
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
                        {request.bookTitle || 'Untitled Book'}
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
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] font-bold">
                  {(user?.name || visitorDetails?.fullName || 'Visitor')
                    .trim()
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join('')
                    .toUpperCase()}
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
                    View Profile
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
                    Terms and Conditions
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
                    Sign Out
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

        {/* =================================================
            PRIMARY NAVIGATION
        ================================================== */}
        <nav
          aria-label="Visitor dashboard"
          className="relative z-30 -mx-4 flex min-w-0 gap-2 overflow-x-auto border-b border-slate-200 bg-shelf-bg/95 px-4 pb-3 pt-2 backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/95 sm:sticky sm:top-20 sm:mx-0 sm:rounded-2xl sm:border sm:p-3"
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
              onClick={() => {
                setTab(id);

                if (id === 'catalog') {
                  setCatalogResetKey((key) => key + 1);
                }
              }}
              className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold transition sm:px-4 sm:text-sm ${
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
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
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
          className="fixed inset-0 z-50 flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="Visitor menu"
        >
          {/* BACKDROP */}

          <button
            type="button"
            className="absolute inset-0 bg-slate-950/45"
            onClick={() => setIsMenuOpen(false)}
            aria-label="Close visitor menu"
          />

          {/* SIDE MENU */}

          <aside className="visitor-profile-drawer relative flex h-full w-full max-w-md flex-col bg-white dark:bg-slate-800 shadow-2xl">
            {/* MENU HEADER */}

            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  Visitor Portal
                </p>

                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  Your Menu
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
                  <section className="visitor-profile-summary flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-shelf-primary text-sm font-bold text-white">
                      {(visitorDetails?.fullName || user?.name || 'Visitor')
                        .trim()
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((part) => part[0])
                        .join('')
                        .toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                        {visitorDetails?.fullName || user?.name || 'Visitor'}
                      </p>
                      <p className="truncate text-xs text-slate-600 dark:text-slate-300">
                        {visitorDetails?.email || user?.email || '—'}
                      </p>
                    </div>
                  </section>

                  {/* PERSONAL INFORMATION */}

                  <section>
                    <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">
                      Personal Information
                    </h3>

                    <dl className="divide-y divide-slate-100 dark:divide-slate-700 border-y border-slate-100 dark:border-slate-700 text-sm">
                      {[
                        [
                          UserRound,
                          'Full name',
                          visitorDetails?.fullName || user?.name,
                        ],
                        [
                          Mail,
                          'Email',
                          visitorDetails?.email || user?.email,
                        ],
                        [
                          Phone,
                          'Contact number',
                          visitorDetails?.contactNumber,
                        ],
                        [
                          MapPin,
                          'Address',
                          visitorDetails?.address,
                        ],
                      ].map(([Icon, label, value]) => (
                        <div
                          key={label}
                          className="grid grid-cols-[7rem_1fr] gap-3 py-2.5"
                        >
                          <dt className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                            <Icon size={14} aria-hidden="true" />
                            {label}
                          </dt>

                          <dd className="wrap-break-word font-medium text-slate-800 dark:text-slate-200">
                            {value || '—'}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>

                  {/* =================================================
                      QR PASS
                  ================================================== */}

                  <section className="text-center">
                    <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">
                      Library QR Pass
                    </h3>

                    {visitorQrCode ? (
                      <>
                        <div className="visitor-qr-frame mx-auto w-fit rounded-lg border border-slate-200 bg-white p-2">
                          <div ref={qrCodeRef}>
                            <QRCodeSVG
                              value={visitorQrCode}
                              size={176}
                              level="H"
                              includeMargin
                              fgColor="#000000"
                              bgColor="#FFFFFF"
                            />
                          </div>
                        </div>

                        <p className="mt-2 text-xs text-slate-700 dark:text-slate-200">
                          Show this at the library desk
                        </p>

                        <button
                          type="button"
                          onClick={handleSaveQrAsImage}
                          disabled={isSavingQr}
                          className="mt-3 w-full rounded-lg bg-shelf-primary px-3 py-2.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {isSavingQr
                            ? 'Saving QR image...'
                            : 'Save QR pass as image'}
                        </button>
                      </>
                    ) : (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Your QR pass is refreshing. If it does not appear, sign
                        out and sign in again to load the current visitor pass.
                      </p>
                    )}
                  </section>

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

                    {myVisits.length ? (
                      <ul className="divide-y divide-slate-100 dark:divide-slate-700 border-y border-slate-100 dark:border-slate-700">
                        {myVisits.slice(0, 10).map((visit) => (
                          <li
                            key={visit.id}
                            className="flex justify-between gap-3 py-2.5 text-xs"
                          >
                            <span className="font-medium text-slate-700 dark:text-slate-300">
                              {libraryName(visit.libraryId)}
                            </span>

                            <time className="shrink-0 text-slate-500 dark:text-slate-400">
                              {formatDateTime(visit.timeIn)}
                            </time>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-300 px-4 py-5 text-center dark:border-slate-600">
                        <CalendarDays size={20} className="mx-auto text-slate-600 dark:text-slate-300" aria-hidden="true" />
                        <p className="mt-2 text-xs text-slate-700 dark:text-slate-200">
                          No attendance history yet.
                        </p>
                      </div>
                    )}
                  </section>

                  {/* =================================================
                      TRANSACTION HISTORY
                  ================================================== */}

                  <section>
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                      <ClipboardList size={16} aria-hidden="true" />
                      Transaction History
                    </h3>

                    {myTransactions.length ? (
                      <div className="space-y-4">
                        {transactionGroups.map((group) => {
                          const visibleEntries = group.entries.filter(
                            (transaction) =>
                              visibleTransactionIds.has(
                                String(transaction.id)
                              )
                          );
                          if (!visibleEntries.length) return null;

                          return (
                            <section key={group.label} className="space-y-2">
                              <h4 className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200">
                                <span>{group.label}</span>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                                  {group.entries.length}
                                </span>
                              </h4>
                              {visibleEntries.map((transaction) => {
                            const status = String(
                              transaction.status || ''
                            ).toLowerCase();

                            const statusLabel = formatStatus(
                              transaction.status
                            );

                            const statusClass = getStatusClass(
                              transaction.status
                            );

                            const fineAmount = Number(
                              transaction.fineAmount
                            );
                            const StatusIcon =
                              status === 'returned'
                                ? CheckCircle2
                                : status === 'rejected' || status === 'overdue'
                                  ? AlertTriangle
                                  : status === 'pending' ||
                                      status === 'queued' ||
                                      status === 'ready_for_pickup'
                                    ? Clock3
                                    : BookOpen;
                            const transactionType =
                              transaction.isCommunityBook === true ||
                              transaction.requestType === 'community'
                                ? 'Community book'
                                : 'Library book';

                            return (
                              <article
                                key={transaction.id}
                                className="visitor-transaction-row rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-700/50"
                              >
                                {/* BOOK + STATUS */}

                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <h4
                                      title={transaction.bookTitle || 'Book transaction'}
                                      className="truncate text-xs font-bold text-slate-900 dark:text-white"
                                    >
                                      {transaction.bookTitle ||
                                        'Book transaction'}
                                    </h4>

                                    <p className="mt-1 text-xs text-slate-700 dark:text-slate-200">
                                      {transactionType}
                                      {transaction.requestDate
                                        ? ` · ${new Date(
                                            transaction.requestDate
                                          ).toLocaleDateString('en-PH', {
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric',
                                          })}`
                                        : ''}
                                    </p>
                                  </div>

                                  <span
                                    className={`shrink-0 ${statusClass}`}
                                  >
                                    <StatusIcon size={12} aria-hidden="true" />
                                    {statusLabel || 'Unknown'}
                                  </span>
                                </div>

                                {/* TRANSACTION DETAILS */}

                                <div className="mt-3 grid grid-cols-1 gap-1.5 text-[11px] sm:grid-cols-2">
                                  {/* BORROW DATE */}

                                  {transaction.borrowDate && (
                                    <div>
                                      <span className="font-semibold text-slate-600 dark:text-slate-400">
                                        Borrowed:{' '}
                                      </span>

                                      <span className="text-slate-500 dark:text-slate-300">
                                        {formatDateTime(
                                          transaction.borrowDate
                                        )}
                                      </span>
                                    </div>
                                  )}

                                  {/* DUE DATE */}

                                  {transaction.dueDate && (
                                    <div>
                                      <span className="font-semibold text-slate-600 dark:text-slate-400">
                                        Due:{' '}
                                      </span>

                                      <span className="text-slate-500 dark:text-slate-300">
                                        {formatDateTime(
                                          transaction.dueDate
                                        )}
                                      </span>
                                    </div>
                                  )}

                                  {/* RETURN DATE */}

                                  {transaction.returnDate && (
                                    <div>
                                      <span className="font-semibold text-slate-600 dark:text-slate-400">
                                        Returned:{' '}
                                      </span>

                                      <span className="text-slate-500 dark:text-slate-300">
                                        {formatDateTime(
                                          transaction.returnDate
                                        )}
                                      </span>
                                    </div>
                                  )}

                                  {/* FINE */}

                                  {!Number.isNaN(fineAmount) &&
                                    fineAmount > 0 && (
                                      <div>
                                        <span className="font-semibold text-red-600 dark:text-red-400">
                                          Fine:{' '}
                                        </span>

                                        <span className="font-bold text-red-600 dark:text-red-400">
                                          ₱<span className="tabular-nums">{fineAmount.toFixed(2)}</span>
                                        </span>
                                      </div>
                                    )}
                                </div>

                                {/* PICKUP DEADLINE */}

                                {transaction.pickupDeadline &&
                                  status !== 'cancelled' && (
                                    <p className="mt-2 flex items-center gap-1 text-xs text-slate-700 dark:text-slate-200">
                                      <Clock3 size={13} aria-hidden="true" />
                                      <span className="font-semibold">Pickup deadline:</span>

                                      {formatDateTime(
                                        transaction.pickupDeadline
                                      )}
                                    </p>
                                  )}

                                {/* QUEUE POSITION */}

                                {status === 'queued' &&
                                  transaction.queuePosition !== null &&
                                  transaction.queuePosition !==
                                    undefined && (
                                    <p className="visitor-status visitor-status-neutral mt-2 w-fit">
                                      Queue #
                                      {transaction.queuePosition}
                                    </p>
                                  )}

                                {/* CANCELLATION REASON */}

                                {status === 'cancelled' &&
                                  transaction.cancelReason && (
                                    <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">
                                      <span className="font-semibold">
                                        Cancellation reason:{' '}
                                      </span>

                                      {transaction.cancelReason}
                                    </p>
                                  )}

                                {/* STAFF CONFIRMATION */}

                                {transaction.confirmedBy && (
                                  <p className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">
                                    Pickup confirmed by:{' '}
                                    {transaction.confirmedBy}
                                  </p>
                                )}
                              </article>
                            );
                              })}
                            </section>
                          );
                        })}
                        {myTransactions.length > 5 && (
                          <button
                            type="button"
                            onClick={() =>
                              setShowAllTransactions((show) => !show)
                            }
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-700"
                          >
                            {showAllTransactions ? 'Show less' : 'Show more'}
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        No transaction history found.
                      </p>
                    )}
                  </section>
                  <section>
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                      <FileText size={16} aria-hidden="true" />
                      Legal
                    </h3>
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        setIsTermsReviewOpen(true);
                      }}
                      className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-900/60 dark:hover:border-slate-600 dark:hover:bg-slate-700"
                    >
                      <FileText size={18} className="shrink-0 text-slate-700 dark:text-slate-200" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                          Terms and Conditions
                        </span>
                        {termsAcceptedAt && (
                          <span className="mt-1 block text-xs text-slate-600 dark:text-slate-300">
                            Accepted on {formatDate(termsAcceptedAt)}
                          </span>
                        )}
                      </span>
                      <ChevronRight size={18} className="shrink-0 text-slate-500 dark:text-slate-300" aria-hidden="true" />
                    </button>
                  </section>
                </div>
              )}
            </div>
          </aside>
        </div>
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
              <VisitorTermsContent />
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
        handle=".faq-drag-handle, .faq-floating-button"
        bounds="body"
      >
        <div
          ref={faqDragRef}
          className="fixed bottom-5 right-5 z-100 w-fit"
        >
          {/* FAQ Chatbot Window */}
          {isFaqOpen && (
            <div className="mb-4 w-[min(92vw,400px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800">
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
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  aria-label="Close FAQ chatbot"
                  title="Close chatbot"
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>

              {/* FAQ Content */}
              <div className="max-h-[70vh] overflow-y-auto bg-white p-3 dark:bg-slate-800">
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