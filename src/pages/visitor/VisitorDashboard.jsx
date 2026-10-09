import { useEffect, useRef, useState } from 'react';
import Draggable from 'react-draggable';
import { QRCodeSVG } from 'qrcode.react';
import {
  BookMarked,
  BookOpen,
  CalendarDays,
  AlertTriangle,
  Bookmark,
  CircleDollarSign,
  LogOut,
  MapPinned,
  Megaphone,
  MessageCircle,
  Moon,
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

function formatDateTime(iso) {
  if (!iso) {
    return '';
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
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
      return 'bg-green-100 text-green-700';

    case 'borrowed':
      return 'bg-blue-100 text-blue-700';

    case 'ready_for_pickup':
      return 'bg-amber-100 text-amber-700';

    case 'queued':
      return 'bg-purple-100 text-purple-700';

    case 'cancelled':
      return 'bg-red-100 text-red-700';

    default:
      return 'bg-slate-100 text-slate-600';
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

export default function VisitorDashboard() {
  const { user, logout } = useAuth();

  const {
    attendanceLogs = [],
    borrowRequests = [],
    libraries = [],
    visitors = [],
  } = useLibraryData();

  const [tab, setTab] = useState('catalog');
  const [catalogResetKey, setCatalogResetKey] = useState(0);
  const [libraryFilter, setLibraryFilter] = useState(null);
  const [isSavingQr, setIsSavingQr] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuSection, setMenuSection] = useState('profile');
  const [isFaqOpen, setIsFaqOpen] = useState(false);
  const faqDragRef = useRef(null);

  const [announcements, setAnnouncements] = useState([]);
  const [announcementIndex, setAnnouncementIndex] = useState(0);
  const [isAnnouncementOpen, setIsAnnouncementOpen] = useState(false);


  const [isDarkAppearance, setIsDarkAppearance] = useState(() => {
    try {
      return (
        globalThis.localStorage.getItem('shelf_visitor_appearance') === 'dark'
      );
    } catch {
      return false;
    }
  });

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

  // =========================================================
  // SAVE QR CODE AS IMAGE
  // =========================================================

  const handleSaveQrAsImage = async () => {
    if (!user?.qrCode) {
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

      await new Promise((resolve, reject) => {
        qrImage.onload = resolve;

        qrImage.onerror = () => {
          reject(new Error('Unable to generate the QR image.'));
        };

        qrImage.src = svgUrl;
      });

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

      URL.revokeObjectURL(svgUrl);

      // QR pass ID
      context.fillStyle = '#002046';

      context.font = 'bold 30px monospace';

      context.textAlign = 'center';

      context.fillText(user.qrCode, canvasWidth / 2, 900);

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

      link.download = `${user.qrCode}-QR-Pass.png`;

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
  // VISITOR DETAILS
  // =========================================================

  const visitorDetails = visitors.find(
    (visitor) => visitor.id === user?.id
  );

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
    'myBorrows',
  ];

  // =========================================================
  // UI
  // =========================================================

  return (
    <div
      className={`visitor-dashboard min-h-screen bg-[#f8fafc] text-slate-800 ${
        isDarkAppearance ? 'dark bg-slate-900 text-slate-100' : ''
      }`}
    >

      
            {/* ANNOUNCEMENT POPUP */}
            {isAnnouncementOpen && announcements[announcementIndex] && (
              <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
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
                  <div className="flex items-center justify-between gap-3 bg-[#002046] px-5 py-4 text-white">
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

                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-600 dark:text-slate-300">
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
                          className="rounded-lg bg-[#002046] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#003366]"
                        >
                          Next
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setIsAnnouncementOpen(false)}
                          className="rounded-lg bg-[#002046] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#003366]"
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
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#002046] px-4 py-3 text-white shadow-md sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">

          {/* LEFT: LOGO AND PORTAL LABEL */}
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-lg font-extrabold tracking-wider">
              SHELF ILMS
            </span>

            <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-xs">
              Visitor Portal
            </span>
          </div>

          {/* RIGHT: WELCOME AND USER CONTROLS */}
          <div className="flex flex-wrap items-center justify-start gap-2 sm:ml-auto sm:justify-end sm:gap-3">

            {/* WELCOME */}
            <span className="mr-1 text-xs text-slate-300">
              Welcome, <b>{user?.name || 'Visitor'}</b>
            </span>

            {/* PROFILE */}
            <button
              type="button"
              onClick={() => {
                setMenuSection('profile');
                setIsMenuOpen(true);
              }}
              className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white transition hover:bg-white/20"
              aria-label="Open profile"
              title="Profile"
            >
              <UserRound size={18} aria-hidden="true" />
              <span className="text-xs font-semibold">Profile</span>
            </button>

            {/* DARK MODE */}
            <button
              type="button"
              onClick={() => setIsDarkAppearance((prev) => !prev)}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
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
              {isDarkAppearance ? (
                <Sun size={18} aria-hidden="true" />
              ) : (
                <Moon size={18} aria-hidden="true" />
              )}

              <span className="text-xs font-semibold">
                {isDarkAppearance ? 'Light Mode' : 'Dark Mode'}
              </span>

              <span
                aria-hidden="true"
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  isDarkAppearance ? 'bg-blue-500' : 'bg-slate-400'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    isDarkAppearance ? 'translate-x-4' : 'translate-x-1'
                  }`}
                />
              </span>
            </button>

            {/* SIGN OUT */}
            <button
              type="button"
              onClick={logout}
              className="flex items-center gap-2 rounded-lg border border-red-300/40 bg-red-500/10 px-3 py-2 text-red-200 transition hover:bg-red-500/20"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={18} aria-hidden="true" />
              <span className="text-xs font-semibold">Sign Out</span>
            </button>

          </div>
        </div>
      </header>

      {/* =====================================================
          MAIN CONTENT
      ====================================================== */}
        <main className="mx-auto max-w-7xl space-y-7 px-4 py-6 sm:px-6 sm:py-8 lg:space-y-8">

        {/* =================================================
            PAGE HEADER
        ================================================== */}

        <DashboardWelcome
          name={user?.name?.split(' ')[0]}
          description="Search books, check availability, manage requests, and keep track of your library visits."
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

        {communityReturnReminders.length > 0 && (
          <section
            aria-label="Community book return reminders"
            className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm dark:border-amber-700 dark:bg-amber-950/40"
          >
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
                  {communityReturnReminders.map((transaction) => (
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
            </div>
          </section>
        )}

        {/* =================================================
            PRIMARY NAVIGATION
        ================================================== */}
        <nav
          aria-label="Visitor dashboard"
          className="sticky top-[76px] z-30 -mx-4 flex gap-2 overflow-x-auto border-b border-slate-200 bg-[#f8fafc]/95 px-4 pb-3 pt-2 backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/95 sm:top-[80px] sm:mx-0 sm:rounded-2xl sm:border sm:p-3"
        >
          {[
            { id: 'catalog', label: 'Catalog', Icon: BookOpen },
            { id: 'categories', label: 'Book Categories', Icon: Bookmark },
            { id: 'communityBooks', label: 'Community Books', Icon: UsersRound },
            { id: 'personalBooks', label: 'My Personal Books', Icon: BookMarked },
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
                  ? 'bg-[#002046] text-white shadow-sm dark:bg-blue-600'
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
                    className="text-[#002046] dark:text-blue-400 font-bold hover:underline"
                  >
                    Clear filter
                  </button>
                </div>
              )}

            {/* =================================================
                OPAC
            ================================================== */}

            <OPACCatalog
              libraryFilter={
                tab === 'communityBooks' ||
                tab === 'personalBooks'
                  ? null
                  : libraryFilter
              }
              activeView={tab}
              onViewChange={setTab}
              catalogResetKey={catalogResetKey}
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

          <aside className="relative flex h-full w-full max-w-md flex-col bg-white dark:bg-slate-800 shadow-2xl">
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

            {/* MENU SECTIONS */}

            {/* MENU SECTIONS */}
<nav
  className="grid grid-cols-1 border-b border-slate-200 dark:border-slate-700"
  aria-label="Visitor menu sections"
>
  {[
    {
      id: 'profile',
      label: 'Profile',
      Icon: UserRound,
    },
  ].map(({ id, label, Icon }) => (
    <button
      key={id}
      type="button"
      onClick={() => setMenuSection(id)}
      aria-current={menuSection === id ? 'page' : undefined}
      className={`flex items-center justify-center gap-2 border-b-2 px-2 py-3 text-xs font-semibold ${
        menuSection === id
          ? 'border-[#002046] text-[#002046] dark:border-blue-400 dark:text-blue-400'
          : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
      }`}
    >
      <Icon size={18} aria-hidden="true" />
      {label}
    </button>
  ))}
</nav>

            {/* MENU CONTENT */}

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {/* =================================================
                  PROFILE
              ================================================== */}

              {menuSection === 'profile' && (
                <div className="space-y-6">
                  {/* PERSONAL INFORMATION */}

                  <section>
                    <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">
                      Personal Information
                    </h3>

                    <dl className="divide-y divide-slate-100 dark:divide-slate-700 border-y border-slate-100 dark:border-slate-700 text-sm">
                      {[
                        [
                          'Full name',
                          visitorDetails?.fullName || user?.name,
                        ],
                        [
                          'Email',
                          visitorDetails?.email || user?.email,
                        ],
                        [
                          'Contact number',
                          visitorDetails?.contactNumber,
                        ],
                        [
                          'Address',
                          visitorDetails?.address,
                        ],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="grid grid-cols-[7rem_1fr] gap-3 py-2.5"
                        >
                          <dt className="text-slate-500 dark:text-slate-400">
                            {label}
                          </dt>

                          <dd className="break-words font-medium text-slate-800 dark:text-slate-200">
                            {value || 'Not provided'}
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

                    {user?.qrCode ? (
                      <>
                        <div className="mx-auto w-fit rounded-md border border-slate-200 bg-white p-3">
                          <div ref={qrCodeRef}>
                            <QRCodeSVG
                              value={user.qrCode}
                              size={148}
                              level="H"
                              includeMargin
                            />
                          </div>
                        </div>

                        <p className="mt-2 break-all font-mono text-xs font-bold text-[#002046] dark:text-blue-400">
                          {user.qrCode}
                        </p>

                        <button
                          type="button"
                          onClick={handleSaveQrAsImage}
                          disabled={isSavingQr}
                          className="mt-3 w-full rounded-md bg-[#002046] dark:bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {isSavingQr
                            ? 'Saving QR image...'
                            : 'Save QR pass as image'}
                        </button>
                      </>
                    ) : (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        No QR pass is available for this account.
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
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        No attendance history yet.
                      </p>
                    )}
                  </section>

                  {/* =================================================
                      TRANSACTION HISTORY
                  ================================================== */}

                  <section>
                    <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">
                      Transaction History
                    </h3>

                    {myTransactions.length ? (
                      <div className="space-y-3">
                        {myTransactions
                          .slice(0, 10)
                          .map((transaction) => {
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

                            return (
                              <article
                                key={transaction.id}
                                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50 p-3"
                              >
                                {/* BOOK + STATUS */}

                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <h4 className="break-words text-xs font-bold text-slate-800 dark:text-slate-200">
                                      {transaction.bookTitle ||
                                        'Book transaction'}
                                    </h4>

                                    {transaction.requestDate && (
                                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                        Requested:{' '}
                                        {formatDateTime(
                                          transaction.requestDate
                                        )}
                                      </p>
                                    )}
                                  </div>

                                  <span
                                    className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${statusClass}`}
                                  >
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
                                          ₱{fineAmount.toFixed(2)}
                                        </span>
                                      </div>
                                    )}
                                </div>

                                {/* PICKUP DEADLINE */}

                                {transaction.pickupDeadline &&
                                  status !== 'cancelled' && (
                                    <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                                      <span className="font-semibold">
                                        Pickup deadline:{' '}
                                      </span>

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
                                    <p className="mt-2 text-[11px] font-semibold text-purple-700 dark:text-purple-400">
                                      Queue position: #
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
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        No transaction history found.
                      </p>
                    )}
                  </section>
                </div>
              )}
            </div>
          </aside>
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
          className="fixed bottom-5 right-5 z-[100] w-fit"
        >
          {/* FAQ Chatbot Window */}
          {isFaqOpen && (
            <div className="mb-4 w-[min(92vw,400px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800">
              {/* Draggable Header */}
              <div className="faq-drag-handle flex cursor-move items-center justify-between gap-3 bg-[#002046] px-4 py-3 text-white">
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
              className="faq-floating-button flex h-14 w-14 items-center justify-center rounded-full bg-[#002046] text-white shadow-xl transition hover:scale-105 hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300"
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
