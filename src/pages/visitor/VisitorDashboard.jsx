import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  CalendarDays,
  CircleHelp,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  UserRound,
  X,
} from 'lucide-react';

import { useAuth } from '../../context/useAuth.js';
import { useLibraryData } from '../../context/useLibrary.js';

import OPACCatalog from '../../component/OPACCatalog.jsx';
import LibraryMap from '../../component/LibraryMap.jsx';
import FAQ from '../../component/FAQ.jsx';
import VisitorServices from '../../component/VisitorServices.jsx';
import AIRecommendations from '../../component/AIRecommendations.jsx';

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

export default function VisitorDashboard() {
  const { user, logout } = useAuth();

  const {
    attendanceLogs,
    borrowRequests,
    libraries,
    visitors,
  } = useLibraryData();

  const [tab, setTab] = useState('catalog');
  const [catalogResetKey, setCatalogResetKey] = useState(0);
  const [libraryFilter, setLibraryFilter] = useState(null);
  const [isSavingQr, setIsSavingQr] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuSection, setMenuSection] = useState('profile');

  const [isDarkAppearance, setIsDarkAppearance] = useState(() => {
    try {
      return (
        globalThis.localStorage.getItem(
          'shelf_visitor_appearance'
        ) === 'dark'
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

      context.fillRect(
        0,
        0,
        canvasWidth,
        canvasHeight
      );

      // SHELF ILMS title
      context.fillStyle = '#002046';

      context.font = 'bold 36px Arial, sans-serif';

      context.textAlign = 'center';

      context.fillText(
        'SHELF ILMS',
        canvasWidth / 2,
        65
      );

      // Subtitle
      context.fillStyle = '#334155';

      context.font = 'bold 24px Arial, sans-serif';

      context.fillText(
        'Digital Library Pass',
        canvasWidth / 2,
        105
      );

      // Convert SVG to image
      const svgBlob = new Blob(
        [svgData],
        {
          type: 'image/svg+xml;charset=utf-8',
        }
      );

      const svgUrl = URL.createObjectURL(svgBlob);

      const qrImage = new Image();

      await new Promise((resolve, reject) => {
        qrImage.onload = resolve;

        qrImage.onerror = () => {
          reject(
            new Error(
              'Unable to generate the QR image.'
            )
          );
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

      context.drawImage(
        qrImage,
        qrX,
        qrY,
        qrSize,
        qrSize
      );

      URL.revokeObjectURL(svgUrl);

      // QR pass ID
      context.fillStyle = '#002046';

      context.font = 'bold 30px monospace';

      context.textAlign = 'center';

      context.fillText(
        user.qrCode,
        canvasWidth / 2,
        900
      );

      // Visitor name
      context.fillStyle = '#475569';

      context.font = 'bold 22px Arial, sans-serif';

      context.fillText(
        user?.name || 'Visitor',
        canvasWidth / 2,
        945
      );

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
      console.error(
        'Save QR image error:',
        error
      );

      alert(
        'Unable to save the QR code as an image. Please try again.'
      );
    } finally {
      setIsSavingQr(false);
    }
  };

  // =========================================================
  // VISITOR ATTENDANCE
  // =========================================================

  const myVisits = attendanceLogs
    .filter(
      (attendance) =>
        attendance.visitorId === user?.id
    )
    .sort(
      (a, b) =>
        new Date(b.timeIn) -
        new Date(a.timeIn)
    );

  // =========================================================
  // VISITOR DETAILS
  // =========================================================

  const visitorDetails = visitors.find(
    (visitor) =>
      visitor.id === user?.id
  );

  // =========================================================
  // VISITOR TRANSACTION HISTORY
  // =========================================================

  const myTransactions = borrowRequests
    .filter(
      (request) =>
        request.visitorId === user?.id
    )
    .sort(
      (a, b) =>
        new Date(b.requestDate || 0) -
        new Date(a.requestDate || 0)
    );

  // =========================================================
  // LIBRARY NAME
  // =========================================================

  const libraryName = (id) =>
    libraries.find(
      (library) =>
        library.id === id
    )?.name || id;

  // =========================================================
  // UI
  // =========================================================

  return (
    <div
      className={`visitor-dashboard min-h-screen bg-[#f8fafc] text-slate-800${
        isDarkAppearance ? ' theme-dark' : ''
      }`}
    >
      {/* =====================================================
          HEADER
      ====================================================== */}

      <header className="bg-[#002046] text-white px-4 sm:px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shadow-md">
        <div className="flex items-center gap-3">
          <span className="font-extrabold text-lg tracking-wider">
            SHELF ILMS
          </span>

          <span className="bg-white/10 text-xs px-2.5 py-1 rounded-full border border-white/20">
            Visitor Portal
          </span>
        </div>

        <div className="flex items-center justify-between w-full sm:w-auto gap-4">
          <span className="text-xs text-slate-300">
            Welcome,{' '}
            <b>
              {user?.name || 'Visitor'}
            </b>
          </span>

          <button
            type="button"
            onClick={() => {
              setMenuSection('profile');
              setIsMenuOpen(true);
            }}
            className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-lg border border-white/20 transition"
            aria-label="Open visitor menu"
            title="Open visitor menu"
          >
            <Menu
              size={18}
              aria-hidden="true"
            />
          </button>
        </div>
      </header>

      {/* =====================================================
          MAIN CONTENT
      ====================================================== */}

      <main className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">

        {/* PAGE HEADER */}

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#0f172a]">
              Online Library Catalog & Management
            </h1>

            <p className="text-xs text-slate-500 mt-1">
              Search books, check real-time availability,
              borrow or reserve items, and track fines.
            </p>
          </div>
        </div>

        {/* =================================================
            PRIMARY NAVIGATION
        ================================================== */}

        <nav
          aria-label="Visitor dashboard"
          className="flex border-b border-slate-200 gap-6 overflow-x-auto whitespace-nowrap pb-1"
        >
          {[
            {
              id: 'catalog',
              label: 'Catalog',
            },
            {
              id: 'categories',
              label: 'Book Categories',
            },
            {
              id: 'myBorrows',
              label: 'My Requests & Borrows',
            },
            {
              id: 'map',
              label: 'Library Map',
            },
            {
              id: 'services',
              label: 'Announcements & Feedback',
            },
          ].map((tabItem) => (
            <button
              type="button"
              key={tabItem.id}
              onClick={() => {
                setTab(tabItem.id);

                if (tabItem.id === 'catalog') {
                  setCatalogResetKey(
                    (key) => key + 1
                  );
                }
              }}
              className={`pb-3 text-sm font-bold transition flex-shrink-0 ${
                tab === tabItem.id
                  ? 'text-[#002046] border-b-2 border-[#002046]'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {tabItem.label}
            </button>
          ))}
        </nav>

        {/* =================================================
            CATALOG / CATEGORY / BORROW TAB
        ================================================== */}

        {[
          'catalog',
          'categories',
          'myBorrows',
        ].includes(tab) && (
          <div className="space-y-6">

            {/* AI RECOMMENDATIONS */}

            {tab === 'catalog' && (
              <AIRecommendations />
            )}

            {/* LIBRARY FILTER */}

            {libraryFilter && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>
                  Filtered to{' '}
                  <b>
                    {libraryName(
                      libraryFilter
                    )}
                  </b>
                </span>

                <button
                  type="button"
                  onClick={() =>
                    setLibraryFilter(null)
                  }
                  className="text-[#002046] font-bold hover:underline"
                >
                  Clear filter
                </button>
              </div>
            )}

            {/* OPAC */}

            <OPACCatalog
              libraryFilter={
                libraryFilter
              }
              activeView={tab}
              onViewChange={setTab}
              catalogResetKey={
                catalogResetKey
              }
            />
          </div>
        )}

        {/* =================================================
            LIBRARY MAP
        ================================================== */}

        {tab === 'map' && (
          <LibraryMap
            onBrowseLibrary={(libraryId) => {
              setLibraryFilter(
                libraryId
              );

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
            onClick={() =>
              setIsMenuOpen(false)
            }
            aria-label="Close visitor menu"
          />

          {/* SIDE MENU */}

          <aside className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">

            {/* MENU HEADER */}

            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">
                  Visitor Portal
                </p>

                <h2 className="text-lg font-bold text-slate-900">
                  Your Menu
                </h2>
              </div>

              <button
                type="button"
                onClick={() =>
                  setIsMenuOpen(false)
                }
                className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close visitor menu"
              >
                <X
                  size={20}
                  aria-hidden="true"
                />
              </button>
            </div>

            {/* MENU SECTIONS */}

            <nav
              className="grid grid-cols-3 border-b border-slate-200"
              aria-label="Visitor menu sections"
            >
              {[
                {
                  id: 'profile',
                  label: 'Profile',
                  Icon: UserRound,
                },
                {
                  id: 'faq',
                  label: 'FAQ',
                  Icon: CircleHelp,
                },
                {
                  id: 'settings',
                  label: 'Settings',
                  Icon: Settings,
                },
              ].map(
                ({
                  id,
                  label,
                  Icon,
                }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() =>
                      setMenuSection(id)
                    }
                    aria-current={
                      menuSection === id
                        ? 'page'
                        : undefined
                    }
                    className={`flex flex-col items-center gap-1 border-b-2 px-2 py-3 text-xs font-semibold ${
                      menuSection === id
                        ? 'border-[#002046] text-[#002046]'
                        : 'border-transparent text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Icon
                      size={18}
                      aria-hidden="true"
                    />

                    {label}
                  </button>
                )
              )}
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
                    <h3 className="mb-3 text-sm font-bold text-slate-900">
                      Personal Information
                    </h3>

                    <dl className="divide-y divide-slate-100 border-y border-slate-100 text-sm">
                      {[
                        [
                          'Full name',
                          visitorDetails?.fullName ||
                            user?.name,
                        ],
                        [
                          'Email',
                          visitorDetails?.email ||
                            user?.email,
                        ],
                        [
                          'Contact number',
                          visitorDetails?.contactNumber,
                        ],
                        [
                          'Address',
                          visitorDetails?.address,
                        ],
                      ].map(
                        ([label, value]) => (
                          <div
                            key={label}
                            className="grid grid-cols-[7rem_1fr] gap-3 py-2.5"
                          >
                            <dt className="text-slate-500">
                              {label}
                            </dt>

                            <dd className="break-words font-medium text-slate-800">
                              {value ||
                                'Not provided'}
                            </dd>
                          </div>
                        )
                      )}
                    </dl>
                  </section>

                  {/* =================================================
                      QR PASS
                  ================================================== */}

                  <section className="text-center">
                    <h3 className="mb-3 text-sm font-bold text-slate-900">
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

                        <p className="mt-2 break-all font-mono text-xs font-bold text-[#002046]">
                          {user.qrCode}
                        </p>

                        <button
                          type="button"
                          onClick={
                            handleSaveQrAsImage
                          }
                          disabled={
                            isSavingQr
                          }
                          className="mt-3 w-full rounded-md bg-[#002046] px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {isSavingQr
                            ? 'Saving QR image...'
                            : 'Save QR pass as image'}
                        </button>
                      </>
                    ) : (
                      <p className="text-sm text-slate-500">
                        No QR pass is available
                        for this account.
                      </p>
                    )}
                  </section>

                  {/* =================================================
                      ATTENDANCE HISTORY
                  ================================================== */}

                  <section>
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
                      <CalendarDays
                        size={16}
                        aria-hidden="true"
                      />

                      Attendance History
                    </h3>

                    {myVisits.length ? (
                      <ul className="divide-y divide-slate-100 border-y border-slate-100">
                        {myVisits
                          .slice(0, 10)
                          .map((visit) => (
                            <li
                              key={visit.id}
                              className="flex justify-between gap-3 py-2.5 text-xs"
                            >
                              <span className="font-medium text-slate-700">
                                {libraryName(
                                  visit.libraryId
                                )}
                              </span>

                              <time className="shrink-0 text-slate-500">
                                {formatDateTime(
                                  visit.timeIn
                                )}
                              </time>
                            </li>
                          ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-500">
                        No attendance history yet.
                      </p>
                    )}
                  </section>

                  {/* =================================================
                      TRANSACTION HISTORY
                  ================================================== */}

                  <section>
                    <h3 className="mb-3 text-sm font-bold text-slate-900">
                      Transaction History
                    </h3>

                    {myTransactions.length ? (
                      <div className="space-y-3">
                        {myTransactions
                          .slice(0, 10)
                          .map((transaction) => {
                            const status =
                              String(
                                transaction.status ||
                                  ''
                              ).toLowerCase();

                            const statusLabel =
                              formatStatus(
                                transaction.status
                              );

                            const statusClass =
                              getStatusClass(
                                transaction.status
                              );

                            const fineAmount =
                              Number(
                                transaction.fineAmount
                              );

                            return (
                              <article
                                key={
                                  transaction.id
                                }
                                className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                              >
                                {/* BOOK + STATUS */}

                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <h4 className="break-words text-xs font-bold text-slate-800">
                                      {transaction.bookTitle ||
                                        'Book transaction'}
                                    </h4>

                                    {transaction.requestDate && (
                                      <p className="mt-1 text-[11px] text-slate-500">
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
                                    {statusLabel ||
                                      'Unknown'}
                                  </span>
                                </div>

                                {/* TRANSACTION DETAILS */}

                                <div className="mt-3 grid grid-cols-1 gap-1.5 text-[11px] sm:grid-cols-2">

                                  {/* BORROW DATE */}

                                  {transaction.borrowDate && (
                                    <div>
                                      <span className="font-semibold text-slate-600">
                                        Borrowed:{' '}
                                      </span>

                                      <span className="text-slate-500">
                                        {formatDateTime(
                                          transaction.borrowDate
                                        )}
                                      </span>
                                    </div>
                                  )}

                                  {/* DUE DATE */}

                                  {transaction.dueDate && (
                                    <div>
                                      <span className="font-semibold text-slate-600">
                                        Due:{' '}
                                      </span>

                                      <span className="text-slate-500">
                                        {formatDateTime(
                                          transaction.dueDate
                                        )}
                                      </span>
                                    </div>
                                  )}

                                  {/* RETURN DATE */}

                                  {transaction.returnDate && (
                                    <div>
                                      <span className="font-semibold text-slate-600">
                                        Returned:{' '}
                                      </span>

                                      <span className="text-slate-500">
                                        {formatDateTime(
                                          transaction.returnDate
                                        )}
                                      </span>
                                    </div>
                                  )}

                                  {/* FINE */}

                                  {!Number.isNaN(
                                    fineAmount
                                  ) &&
                                    fineAmount > 0 && (
                                      <div>
                                        <span className="font-semibold text-red-600">
                                          Fine:{' '}
                                        </span>

                                        <span className="font-bold text-red-600">
                                          ₱
                                          {fineAmount.toFixed(
                                            2
                                          )}
                                        </span>
                                      </div>
                                    )}
                                </div>

                                {/* PICKUP DEADLINE */}

                                {transaction.pickupDeadline &&
                                  status !== 'cancelled' && (
                                    <p className="mt-2 text-[11px] text-amber-700">
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
                                  transaction.queuePosition !==
                                    null &&
                                  transaction.queuePosition !==
                                    undefined && (
                                    <p className="mt-2 text-[11px] font-semibold text-purple-700">
                                      Queue position: #
                                      {
                                        transaction.queuePosition
                                      }
                                    </p>
                                  )}

                                {/* CANCELLATION REASON */}

                                {status === 'cancelled' &&
                                  transaction.cancelReason && (
                                    <p className="mt-2 text-[11px] text-red-600">
                                      <span className="font-semibold">
                                        Cancellation reason:{' '}
                                      </span>

                                      {
                                        transaction.cancelReason
                                      }
                                    </p>
                                  )}

                                {/* STAFF CONFIRMATION */}

                                {transaction.confirmedBy && (
                                  <p className="mt-2 text-[10px] text-slate-400">
                                    Pickup confirmed by:{' '}
                                    {
                                      transaction.confirmedBy
                                    }
                                  </p>
                                )}

                                {transaction.returnConfirmedBy && (
                                  <p className="mt-1 text-[10px] text-slate-400">
                                    Return confirmed by:{' '}
                                    {
                                      transaction.returnConfirmedBy
                                    }
                                  </p>
                                )}
                              </article>
                            );
                          })}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">
                        No book transactions yet.
                      </p>
                    )}
                  </section>
                </div>
              )}

              {/* =================================================
                  FAQ
              ================================================== */}

              {menuSection === 'faq' && (
                <FAQ />
              )}

              {/* =================================================
                  SETTINGS
              ================================================== */}

              {menuSection === 'settings' && (
                <div className="space-y-7">

                  {/* ACCOUNT SETTINGS */}

                  <section>
                    <h3 className="mb-3 text-sm font-bold text-slate-900">
                      Account Settings
                    </h3>

                    <p className="mb-3 text-xs text-slate-500">
                      Account information currently
                      comes from your registered profile.
                    </p>

                    <dl className="divide-y divide-slate-100 border-y border-slate-100 text-sm">
                      {[
                        [
                          'Name',
                          visitorDetails?.fullName ||
                            user?.name,
                        ],
                        [
                          'Email',
                          visitorDetails?.email ||
                            user?.email,
                        ],
                        [
                          'Contact',
                          visitorDetails?.contactNumber,
                        ],
                        [
                          'Address',
                          visitorDetails?.address,
                        ],
                      ].map(
                        ([label, value]) => (
                          <div
                            key={label}
                            className="grid grid-cols-[6rem_1fr] gap-3 py-2.5"
                          >
                            <dt className="text-slate-500">
                              {label}
                            </dt>

                            <dd className="break-words font-medium text-slate-800">
                              {value ||
                                'Not provided'}
                            </dd>
                          </div>
                        )
                      )}
                    </dl>
                  </section>

                  {/* APPEARANCE */}

                  <section>
                    <h3 className="mb-3 text-sm font-bold text-slate-900">
                      Appearance
                    </h3>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={
                        isDarkAppearance
                      }
                      onClick={() =>
                        setIsDarkAppearance(
                          (current) =>
                            !current
                        )
                      }
                      className="flex w-full items-center justify-between border-y border-slate-100 py-3 text-sm font-medium text-slate-800"
                    >
                      <span className="flex items-center gap-2">
                        {isDarkAppearance ? (
                          <Moon
                            size={17}
                            aria-hidden="true"
                          />
                        ) : (
                          <Sun
                            size={17}
                            aria-hidden="true"
                          />
                        )}

                        Dark appearance
                      </span>

                      <span
                        className={`relative h-6 w-11 rounded-full transition ${
                          isDarkAppearance
                            ? 'bg-[#002046]'
                            : 'bg-slate-300'
                        }`}
                      >
                        <span
                          className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${
                            isDarkAppearance
                              ? 'left-6'
                              : 'left-1'
                          }`}
                        />
                      </span>
                    </button>
                  </section>
                </div>
              )}
            </div>

            {/* =================================================
                LOGOUT
            ================================================== */}

            <div className="border-t border-slate-200 p-4">
              <button
                type="button"
                onClick={logout}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-red-700 px-4 py-3 text-sm font-bold text-white hover:bg-red-800"
              >
                <LogOut
                  size={17}
                  aria-hidden="true"
                />

                Sign Out
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
