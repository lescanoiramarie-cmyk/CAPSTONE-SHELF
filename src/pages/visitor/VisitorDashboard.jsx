import { useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLibraryData } from '../../context/LibraryContext.jsx';
import OPACCatalog from '../../component/OPACCatalog.jsx';
import LibraryMap from '../../component/LibraryMap.jsx';

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function VisitorDashboard() {
  const { user, logout } = useAuth();
  const { attendanceLogs, libraries } = useLibraryData();

  const [tab, setTab] = useState('catalog');
  const [libraryFilter, setLibraryFilter] = useState(null);
  const [isSavingQr, setIsSavingQr] = useState(false);

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

      // -----------------------------------------------------
      // Get the SVG QR code
      // -----------------------------------------------------

      const serializer =
        new XMLSerializer();

      let svgData =
        serializer.serializeToString(
          svgElement
        );

      // Make sure SVG has the proper namespace
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

      // -----------------------------------------------------
      // Create a clean high-resolution canvas
      // -----------------------------------------------------

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

      // White background
      context.fillStyle = '#ffffff';

      context.fillRect(
        0,
        0,
        canvasWidth,
        canvasHeight
      );

      // -----------------------------------------------------
      // SHELF title
      // -----------------------------------------------------

      context.fillStyle = '#002046';

      context.font =
        'bold 36px Arial, sans-serif';

      context.textAlign = 'center';

      context.fillText(
        'SHELF ILMS',
        canvasWidth / 2,
        65
      );

      // -----------------------------------------------------
      // QR pass title
      // -----------------------------------------------------

      context.fillStyle = '#334155';

      context.font =
        'bold 24px Arial, sans-serif';

      context.fillText(
        'Digital Library Pass',
        canvasWidth / 2,
        105
      );

      // -----------------------------------------------------
      // Convert SVG to image
      // -----------------------------------------------------

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

      // -----------------------------------------------------
      // Draw QR code
      // -----------------------------------------------------

      const qrSize = 700;

      const qrX =
        (canvasWidth - qrSize) / 2;

      const qrY = 145;

      // White QR background / margin
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

      // -----------------------------------------------------
      // QR identifier
      // -----------------------------------------------------

      context.fillStyle = '#002046';

      context.font =
        'bold 30px monospace';

      context.textAlign = 'center';

      context.fillText(
        user.qrCode,
        canvasWidth / 2,
        900
      );

      // -----------------------------------------------------
      // Visitor name
      // -----------------------------------------------------

      context.fillStyle = '#475569';

      context.font =
        'bold 22px Arial, sans-serif';

      context.fillText(
        user?.name || 'Visitor',
        canvasWidth / 2,
        945
      );

      // -----------------------------------------------------
      // Footer
      // -----------------------------------------------------

      context.fillStyle = '#64748b';

      context.font =
        '18px Arial, sans-serif';

      context.fillText(
        'Present this QR pass for library access and attendance.',
        canvasWidth / 2,
        995
      );

      // -----------------------------------------------------
      // Convert canvas to PNG
      // -----------------------------------------------------

      const imageUrl =
        canvas.toDataURL(
          'image/png'
        );

      // -----------------------------------------------------
      // Download PNG
      // -----------------------------------------------------

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

  // =========================================================
  // LIBRARY NAME
  // =========================================================

  const libraryName = (id) =>
    libraries.find(
      (library) => library.id === id
    )?.name || id;

  // =========================================================
  // UI
  // =========================================================

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800">

      {/* =====================================================
          HEADER
      ====================================================== */}

      <header className="bg-[#002046] text-white px-6 py-4 flex justify-between items-center shadow-md">

        <div className="flex items-center gap-3">

          <span className="font-extrabold text-lg tracking-wider">
            SHELF ILMS
          </span>

          <span className="bg-white/10 text-xs px-2.5 py-1 rounded-full border border-white/20">
            Visitor Portal
          </span>

        </div>

        <div className="flex items-center gap-4">

          <span className="text-xs text-slate-300">
            Welcome,{' '}
            <b>{user?.name || 'Visitor'}</b>
          </span>

          <button
            type="button"
            onClick={logout}
            className="bg-white/10 hover:bg-white/20 text-white text-xs px-3 py-1.5 rounded-lg border border-white/20 transition"
          >
            Sign Out
          </button>

        </div>

      </header>

      {/* =====================================================
          MAIN CONTENT
      ====================================================== */}

      <main className="max-w-7xl mx-auto p-6 space-y-6">

        {/* PAGE HEADER */}

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">

          <div>

            <h1 className="text-2xl font-bold text-[#0f172a]">
              Online Library Catalog & Management
            </h1>

            <p className="text-xs text-slate-500">
              Search books, check real-time availability,
              borrow or reserve items, and track fines.
            </p>

          </div>

        </div>

        {/* ===================================================
            TABS
        ==================================================== */}

        <div className="flex border-b border-slate-200 gap-6">

          {[
            {
              id: 'catalog',
              label: '📚 Catalog',
            },
            {
              id: 'pass',
              label: '🪪 My QR Pass & Attendance',
            },
            {
              id: 'map',
              label: '🗺️ Library Map & Location',
            },
          ].map((tabItem) => (
            <button
              type="button"
              key={tabItem.id}
              onClick={() =>
                setTab(tabItem.id)
              }
              className={`pb-3 text-sm font-bold transition ${
                tab === tabItem.id
                  ? 'text-[#002046] border-b-2 border-[#002046]'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {tabItem.label}
            </button>
          ))}

        </div>

        {/* ===================================================
            CATALOG
        ==================================================== */}

        {tab === 'catalog' && (
          <div className="space-y-3">

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
            />

          </div>
        )}

        {/* ===================================================
            QR PASS + ATTENDANCE
        ==================================================== */}

        {tab === 'pass' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* ===============================================
                QR PASS
            ================================================ */}

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center space-y-4">

              <h3 className="text-sm font-bold text-[#0f172a]">
                Your Digital Library Pass
              </h3>

              {user?.qrCode ? (
                <>
                  {/* QR CODE */}

                  <div
                    ref={qrCodeRef}
                    className="flex justify-center"
                  >
                    <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm">

                      <QRCodeSVG
                        value={user.qrCode}
                        size={220}
                        level="H"
                        includeMargin
                      />

                    </div>
                  </div>

                  {/* QR ID */}

                  <p className="text-sm font-mono font-bold text-[#002046]">
                    {user.qrCode}
                  </p>

                  {/* SAVE BUTTON */}

                  <button
                    type="button"
                    onClick={
                      handleSaveQrAsImage
                    }
                    disabled={isSavingQr}
                    className="w-full bg-[#002046] text-white py-2.5 rounded-lg text-sm font-bold hover:opacity-95 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >

                    {isSavingQr ? (
                      <>
                        <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        Saving QR Image...
                      </>
                    ) : (
                      <>
                        <span className="text-base">
                          ↓
                        </span>
                        Save QR as Image
                      </>
                    )}

                  </button>

                  {/* DESCRIPTION */}

                  <p className="text-xs text-slate-500 leading-relaxed">
                    Save your QR pass as a PNG image
                    on your device. You can use the
                    saved image for QR scanning at the
                    library entrance or upload it as a
                    QR login image.
                  </p>

                </>
              ) : (
                <p className="text-xs text-slate-500">
                  No QR pass on file for this session.
                </p>
              )}

            </div>

            {/* ===============================================
                RECENT VISITS
            ================================================ */}

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-3">

              <h3 className="text-sm font-bold text-[#0f172a]">
                Recent Library Visits
              </h3>

              {myVisits.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No visits logged yet. Scan your QR
                  pass at the library entrance to check
                  in.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">

                  {myVisits
                    .slice(0, 10)
                    .map((visit) => (
                      <li
                        key={visit.id}
                        className="py-2 flex justify-between text-xs gap-4"
                      >

                        <span className="font-semibold text-slate-700">
                          {libraryName(
                            visit.libraryId
                          )}
                        </span>

                        <span className="text-slate-400 text-right">
                          {formatDateTime(
                            visit.timeIn
                          )}
                        </span>

                      </li>
                    ))}

                </ul>
              )}

            </div>

          </div>
        )}

        {/* ===================================================
            LIBRARY MAP
        ==================================================== */}

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

      </main>
    </div>
  );
}
