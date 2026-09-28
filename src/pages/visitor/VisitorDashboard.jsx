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
  return new Date(iso).toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
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
      return globalThis.localStorage.getItem('shelf_visitor_appearance') === 'dark';
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
      // Appearance still applies for this session when storage is unavailable.
    }
  }, [isDarkAppearance]);

  // Reference to the visible QR code
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
      const svgElement =
        qrCodeRef.current?.querySelector('svg');

      if (!svgElement) {
        throw new Error(
          'QR code could not be found.'
        );
      }

      const serializer =
        new XMLSerializer();

      let svgData =
        serializer.serializeToString(
          svgElement
        );

      if (
        !svgData.includes(
          'xmlns="http://www.w3.org/2000/svg"'
        )
      ) {
        svgData = svgData.replace(
          '<svg',
          '<svg xmlns="http://www.w3.org/2000/svg"'
        );
      }

      const canvas =
        document.createElement('canvas');

      const canvasWidth = 900;
      const canvasHeight = 1050;

      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      const context =
        canvas.getContext('2d');

      if (!context) {
        throw new Error(
          'Unable to create image canvas.'
        );
      }

      context.fillStyle = '#ffffff';

      context.fillRect(
        0,
        0,
        canvasWidth,
        canvasHeight
      );

      context.fillStyle = '#002046';

      context.font =
        'bold 36px Arial, sans-serif';

      context.textAlign = 'center';

      context.fillText(
        'SHELF ILMS',
        canvasWidth / 2,
        65
      );

      context.fillStyle = '#334155';

      context.font =
        'bold 24px Arial, sans-serif';

      context.fillText(
        'Digital Library Pass',
        canvasWidth / 2,
        105
      );

      const svgBlob = new Blob(
        [svgData],
        {
          type: 'image/svg+xml;charset=utf-8',
        }
      );

      const svgUrl =
        URL.createObjectURL(svgBlob);

      const qrImage =
        new Image();

      await new Promise(
        (resolve, reject) => {
          qrImage.onload = resolve;

          qrImage.onerror = () => {
            reject(
              new Error(
                'Unable to generate the QR image.'
              )
            );
          };

          qrImage.src = svgUrl;
        }
      );

      const qrSize = 700;

      const qrX =
        (canvasWidth - qrSize) / 2;

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

      context.fillStyle = '#002046';

      context.font =
        'bold 30px monospace';

      context.textAlign = 'center';

      context.fillText(
        user.qrCode,
        canvasWidth / 2,
        900
      );

      context.fillStyle = '#475569';

      context.font =
        'bold 22px Arial, sans-serif';

      context.fillText(
        user?.name || 'Visitor',
        canvasWidth / 2,
        945
      );

      context.fillStyle = '#64748b';

      context.font =
        '18px Arial, sans-serif';

      context.fillText(
        'Present this QR pass for library access and attendance.',
        canvasWidth / 2,
        995
      );

      const imageUrl =
        canvas.toDataURL(
          'image/png'
        );

      const link =
        document.createElement('a');

      link.href = imageUrl;

      link.download =
        `${user.qrCode}-QR-Pass.png`;

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

  const visitorDetails = visitors.find(
    (visitor) => visitor.id === user?.id
  );

  const myTransactions = borrowRequests
    .filter((request) => request.visitorId === user?.id)
    .sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));

  // =========================================================
  // LIBRARY NAME
  // =========================================================

  const libraryName = (id) =>
    libraries.find(
      (library) => library.id === id
    )?.name || id;

  // =========================================================
  // UI - Visitor Dashboard Layout
  // =========================================================

  return (
    <div className={`visitor-dashboard min-h-screen bg-[#f8fafc] text-slate-800${isDarkAppearance ? ' theme-dark' : ''}`}>

      {/* HEADER */}
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
            <b>{user?.name || 'Visitor'}</b>
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
            <Menu size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* MAIN CONTENT */}
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

        {/* PRIMARY NAVIGATION */}
        <nav aria-label="Visitor dashboard" className="flex border-b border-slate-200 gap-6 overflow-x-auto whitespace-nowrap pb-1">
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
                  setCatalogResetKey((key) => key + 1);
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

        {/* CATALOG TAB */}
        {['catalog', 'categories', 'myBorrows'].includes(tab) && (
          <div className="space-y-6">
            
            {/* AI RECOMMENDATIONS SECTION */}
            {tab === 'catalog' && <AIRecommendations />}

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

            <OPACCatalog
              libraryFilter={
                libraryFilter
              }
              activeView={tab}
              onViewChange={setTab}
              catalogResetKey={catalogResetKey}
            />
          </div>
        )}

        {/* LIBRARY MAP TAB */}
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

        {tab === 'services' && (
          <VisitorServices user={user} libraries={libraries} />
        )}

      </main>

      {isMenuOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Visitor menu">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/45"
            onClick={() => setIsMenuOpen(false)}
            aria-label="Close visitor menu"
          />

          <aside className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Visitor Portal</p>
                <h2 className="text-lg font-bold text-slate-900">Your Menu</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsMenuOpen(false)}
                className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close visitor menu"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <nav className="grid grid-cols-3 border-b border-slate-200" aria-label="Visitor menu sections">
              {[
                { id: 'profile', label: 'Profile', Icon: UserRound },
                { id: 'faq', label: 'FAQ', Icon: CircleHelp },
                { id: 'settings', label: 'Settings', Icon: Settings },
              ].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMenuSection(id)}
                  aria-current={menuSection === id ? 'page' : undefined}
                  className={`flex flex-col items-center gap-1 border-b-2 px-2 py-3 text-xs font-semibold ${menuSection === id ? 'border-[#002046] text-[#002046]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                >
                  <Icon size={18} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {menuSection === 'profile' && (
                <div className="space-y-6">
                  <section>
                    <h3 className="mb-3 text-sm font-bold text-slate-900">Personal Information</h3>
                    <dl className="divide-y divide-slate-100 border-y border-slate-100 text-sm">
                      {[
                        ['Full name', visitorDetails?.fullName || user?.name],
                        ['Email', visitorDetails?.email || user?.email],
                        ['Contact number', visitorDetails?.contactNumber],
                        ['Address', visitorDetails?.address],
                      ].map(([label, value]) => (
                        <div key={label} className="grid grid-cols-[7rem_1fr] gap-3 py-2.5">
                          <dt className="text-slate-500">{label}</dt>
                          <dd className="break-words font-medium text-slate-800">{value || 'Not provided'}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>

                  <section className="text-center">
                    <h3 className="mb-3 text-sm font-bold text-slate-900">Library QR Pass</h3>
                    {user?.qrCode ? (
                      <>
                        <div className="mx-auto w-fit rounded-md border border-slate-200 bg-white p-3">
                          <div ref={qrCodeRef}>
                            <QRCodeSVG value={user.qrCode} size={148} level="H" includeMargin />
                          </div>
                        </div>
                        <p className="mt-2 break-all font-mono text-xs font-bold text-[#002046]">{user.qrCode}</p>
                        <button
                          type="button"
                          onClick={handleSaveQrAsImage}
                          disabled={isSavingQr}
                          className="mt-3 w-full rounded-md bg-[#002046] px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {isSavingQr ? 'Saving QR image...' : 'Save QR pass as image'}
                        </button>
                      </>
                    ) : (
                      <p className="text-sm text-slate-500">No QR pass is available for this account.</p>
                    )}
                  </section>

                  <section>
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
                      <CalendarDays size={16} aria-hidden="true" /> Attendance History
                    </h3>
                    {myVisits.length ? (
                      <ul className="divide-y divide-slate-100 border-y border-slate-100">
                        {myVisits.slice(0, 10).map((visit) => (
                          <li key={visit.id} className="flex justify-between gap-3 py-2.5 text-xs">
                            <span className="font-medium text-slate-700">{libraryName(visit.libraryId)}</span>
                            <time className="shrink-0 text-slate-500">{formatDateTime(visit.timeIn)}</time>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-500">No attendance history yet.</p>
                    )}
                  </section>

                  <section>
                    <h3 className="mb-3 text-sm font-bold text-slate-900">Past Transactions</h3>
                    {myTransactions.length ? (
                      <ul className="divide-y divide-slate-100 border-y border-slate-100">
                        {myTransactions.slice(0, 10).map((transaction) => (
                          <li key={transaction.id} className="py-2.5">
                            <div className="flex justify-between gap-3 text-xs">
                              <span className="font-semibold text-slate-800">{transaction.bookTitle || 'Book request'}</span>
                              <span className="shrink-0 capitalize text-slate-500">{String(transaction.status || '').replaceAll('_', ' ')}</span>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {transaction.dueDate ? `Due ${formatDateTime(transaction.dueDate)}` : formatDateTime(transaction.requestDate)}
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-slate-500">No book transactions yet.</p>
                    )}
                  </section>
                </div>
              )}

              {menuSection === 'faq' && <FAQ />}

              {menuSection === 'settings' && (
                <div className="space-y-7">
                  <section>
                    <h3 className="mb-3 text-sm font-bold text-slate-900">Account Settings</h3>
                    <p className="mb-3 text-xs text-slate-500">Account information currently comes from your registered profile.</p>
                    <dl className="divide-y divide-slate-100 border-y border-slate-100 text-sm">
                      {[
                        ['Name', visitorDetails?.fullName || user?.name],
                        ['Email', visitorDetails?.email || user?.email],
                        ['Contact', visitorDetails?.contactNumber],
                        ['Address', visitorDetails?.address],
                      ].map(([label, value]) => (
                        <div key={label} className="grid grid-cols-[6rem_1fr] gap-3 py-2.5">
                          <dt className="text-slate-500">{label}</dt>
                          <dd className="break-words font-medium text-slate-800">{value || 'Not provided'}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>

                  <section>
                    <h3 className="mb-3 text-sm font-bold text-slate-900">Appearance</h3>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isDarkAppearance}
                      onClick={() => setIsDarkAppearance((current) => !current)}
                      className="flex w-full items-center justify-between border-y border-slate-100 py-3 text-sm font-medium text-slate-800"
                    >
                      <span className="flex items-center gap-2">
                        {isDarkAppearance ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}
                        Dark appearance
                      </span>
                      <span className={`relative h-6 w-11 rounded-full transition ${isDarkAppearance ? 'bg-[#002046]' : 'bg-slate-300'}`}>
                        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${isDarkAppearance ? 'left-6' : 'left-1'}`} />
                      </span>
                    </button>
                  </section>
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 p-4">
              <button
                type="button"
                onClick={logout}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-red-700 px-4 py-3 text-sm font-bold text-white hover:bg-red-800"
              >
                <LogOut size={17} aria-hidden="true" />
                Sign Out
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}