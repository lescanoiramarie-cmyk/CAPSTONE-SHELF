import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../../context/AuthContext';
import { useLibraryData } from '../../context/LibraryContext';
import OPACCatalog from '../../component/OPACCatalog';
import LibraryMap from '../../component/LibraryMap';

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function VisitorDashboard() {
  const { user, logout } = useAuth();
  const { attendanceLogs, libraries } = useLibraryData();
  const [tab, setTab] = useState('catalog'); // catalog | pass | map
  const [libraryFilter, setLibraryFilter] = useState(null);

  const myVisits = attendanceLogs
    .filter((a) => a.visitorId === user?.id)
    .sort((a, b) => new Date(b.timeIn) - new Date(a.timeIn));

  const libraryName = (id) => libraries.find((l) => l.id === id)?.name || id;

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800">
      <header className="bg-[#002046] text-white px-6 py-4 flex justify-between items-center shadow-md">
        <div className="flex items-center gap-3">
          <span className="font-extrabold text-lg tracking-wider">SHELF ILMS</span>
          <span className="bg-white/10 text-xs px-2.5 py-1 rounded-full border border-white/20">Visitor Portal</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-300">
            Welcome, <b>{user?.name || 'Visitor'}</b>
          </span>
          <button
            onClick={logout}
            className="bg-white/10 hover:bg-white/20 text-white text-xs px-3 py-1.5 rounded-lg border border-white/20 transition"
          >
            Sign Out
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#0f172a]">Online Library Catalog & Management</h1>
            <p className="text-xs text-slate-500">Search books, check real-time availability, borrow or reserve items, and track fines.</p>
          </div>
        </div>

        <div className="flex border-b border-slate-200 gap-6">
          {[
            { id: 'catalog', label: '📚 Catalog' },
            { id: 'pass', label: '🪪 My QR Pass & Attendance' },
            { id: 'map', label: '🗺️ Library Map & Location' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`pb-3 text-sm font-bold transition ${
                tab === t.id ? 'text-[#002046] border-b-2 border-[#002046]' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'catalog' && (
          <div className="space-y-3">
            {libraryFilter && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                Filtered to <b>{libraryName(libraryFilter)}</b>
                <button onClick={() => setLibraryFilter(null)} className="text-[#002046] font-bold hover:underline">
                  Clear filter
                </button>
              </div>
            )}
            <OPACCatalog libraryFilter={libraryFilter} />
          </div>
        )}

        {tab === 'pass' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center space-y-3">
              <h3 className="text-sm font-bold text-[#0f172a]">Your Digital Library Pass</h3>
              {user?.qrCode ? (
                <>
                  <div className="flex justify-center p-3 bg-white rounded-lg shadow-sm inline-block border border-slate-200">
                    <QRCodeSVG value={user.qrCode} size={160} />
                  </div>
                  <p className="text-xs font-mono font-bold text-[#002046]">{user.qrCode}</p>
                  <p className="text-xs text-slate-500">
                    Present this at the library entrance scanner for attendance, and at the circulation desk for
                    borrowing or returning books.
                  </p>
                </>
              ) : (
                <p className="text-xs text-slate-500">No QR pass on file for this session.</p>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-3">
              <h3 className="text-sm font-bold text-[#0f172a]">Recent Library Visits</h3>
              {myVisits.length === 0 ? (
                <p className="text-xs text-slate-500">No visits logged yet. Scan your QR pass at the library entrance to check in.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {myVisits.slice(0, 10).map((v) => (
                    <li key={v.id} className="py-2 flex justify-between text-xs">
                      <span className="font-semibold text-slate-700">{libraryName(v.libraryId)}</span>
                      <span className="text-slate-400">{formatDateTime(v.timeIn)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {tab === 'map' && (
          <LibraryMap
            onBrowseLibrary={(libraryId) => {
              setLibraryFilter(libraryId);
              setTab('catalog');
            }}
          />
        )}
      </main>
    </div>
  );
}
