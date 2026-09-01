import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLibraryData } from '../../context/LibraryContext';
import AttendanceScanner from '../../component/AttendanceScanner';
import BookTransactions from '../../component/BookTransactions';
import BookInventory from '../../component/BookInventory';
import ReservationQueue from '../../component/ReservationQueue';

const NAV = [
  { id: 'overview', label: '📊 Overview' },
  { id: 'attendance', label: '🪪 Attendance' },
  { id: 'transactions', label: '🔁 Book Transactions' },
  { id: 'inventory', label: '📚 Inventory' },
  { id: 'queue', label: '⏳ Reservation Queue' },
];

function StatCard({ label, value, tone = 'default' }) {
  const tones = {
    default: 'bg-white border-slate-200 text-slate-800',
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
    red: 'bg-red-50 border-red-200 text-red-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-800',
  };
  return (
    <div className={`rounded-xl border p-5 shadow-sm ${tones[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-3xl font-extrabold mt-1">{value}</p>
    </div>
  );
}

export default function SubAdminDashboard() {
  const { user, logout } = useAuth();
  const { books, borrowRequests, attendanceLogs } = useLibraryData();
  const [section, setSection] = useState('overview');

  const today = new Date().toDateString();
  const todaysVisits = attendanceLogs.filter((a) => new Date(a.timeIn).toDateString() === today).length;
  const pendingPickups = borrowRequests.filter((r) => r.status === 'ready_for_pickup').length;
  const activeBorrows = borrowRequests.filter((r) => r.status === 'borrowed').length;
  const overdue = borrowRequests.filter((r) => r.status === 'borrowed' && new Date(r.dueDate) < new Date()).length;

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 flex">
      {/* Sidebar */}
      <aside className="w-60 bg-[#002046] text-white flex flex-col shrink-0">
        <div className="p-5 border-b border-white/10">
          <p className="font-extrabold tracking-wider">SHELF ILMS</p>
          <p className="text-xs text-slate-300 mt-1">Sub-Admin Console</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={`w-full text-left text-sm px-3 py-2.5 rounded-lg transition ${
                section === item.id ? 'bg-white/15 font-bold' : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-white/10 space-y-2">
          <p className="text-xs text-slate-300">Signed in as</p>
          <p className="text-sm font-bold">{user?.name}</p>
          <button
            onClick={logout}
            className="w-full bg-white/10 hover:bg-white/20 text-xs px-3 py-2 rounded-lg border border-white/20 transition"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 p-8 space-y-6 overflow-y-auto">
        <div>
          <h1 className="text-2xl font-bold text-[#0f172a]">{NAV.find((n) => n.id === section)?.label.replace(/^\S+\s/, '')}</h1>
          <p className="text-xs text-slate-500 mt-1">Manage book inventories, issue books, and process returns.</p>
        </div>

        {section === 'overview' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Visits Today" value={todaysVisits} tone="blue" />
            <StatCard label="Pending Pickups" value={pendingPickups} tone="amber" />
            <StatCard label="Active Borrows" value={activeBorrows} />
            <StatCard label="Overdue Items" value={overdue} tone="red" />
            <StatCard label="Titles in Catalog" value={books.length} />
          </div>
        )}

        {section === 'attendance' && <AttendanceScanner />}
        {section === 'transactions' && <BookTransactions />}
        {section === 'inventory' && <BookInventory />}
        {section === 'queue' && <ReservationQueue />}
      </main>
    </div>
  );
}
