import { useState, useMemo } from 'react';
import { Bar, Line } from 'react-chartjs-2';
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

import { useAuth } from '../../context/AuthContext';
import { useLibraryData, useLibrary } from '../../context/LibraryContext';
import { SUB_ADMIN_CREDENTIALS } from '../../data/store';

import BookInventory from '../../component/BookInventory';
import LibraryMap from '../../component/LibraryMap';

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

const NAV = [
  { id: 'overview', label: '📊 Overview & Analytics' },
  { id: 'inventory', label: '📚 Inventory' },
  { id: 'map', label: '🗺️ Libraries & Map' },
  { id: 'accounts', label: '🔐 Staff Accounts' },
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
      <p className="text-xs font-semibold uppercase tracking-wider opacity-70">
        {label}
      </p>
      <p className="text-3xl font-extrabold mt-1">{value}</p>
    </div>
  );
}

function lastNDaysLabels(n) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (n - 1 - i));

    return d.toLocaleDateString('en-PH', {
      month: 'short',
      day: 'numeric',
    });
  });
}

export default function SuperAdminDashboard() {
  const { user, logout } = useAuth();

  const { addLibrary } = useLibrary();

  const {
    books,
    visitors,
    borrowRequests,
    attendanceLogs,
    libraries,
  } = useLibraryData();

  const [section, setSection] = useState('overview');

  // ============================================================
  // ADD LIBRARY STATES
  // ============================================================

  const [showAddLibrary, setShowAddLibrary] = useState(false);
  const [savingLibrary, setSavingLibrary] = useState(false);
  const [libraryMessage, setLibraryMessage] = useState('');

  const [libraryForm, setLibraryForm] = useState({
    name: '',
    campus: '',
    address: '',
    lat: '',
    lng: '',
    hours: '8:00 AM - 5:00 PM',
    status: 'Open',
  });

  // ============================================================
  // USE CURRENT LOCATION
  // ============================================================

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLibraryMessage(
        'Geolocation is not supported by this browser.'
      );
      return;
    }

    setLibraryMessage('Getting your current location...');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLibraryForm((prev) => ({
          ...prev,
          lat: position.coords.latitude.toFixed(6),
          lng: position.coords.longitude.toFixed(6),
        }));

        setLibraryMessage(
          'Location captured successfully.'
        );
      },
      (error) => {
        console.error('Geolocation error:', error);

        setLibraryMessage(
          'Unable to get your location. Please enter latitude and longitude manually.'
        );
      }
    );
  };

  // ============================================================
  // ADD LIBRARY
  // ============================================================

  const handleAddLibrary = async (event) => {
    event.preventDefault();

    if (
      !libraryForm.name.trim() ||
      !libraryForm.address.trim() ||
      !libraryForm.lat ||
      !libraryForm.lng
    ) {
      setLibraryMessage(
        'Please enter the library name, address, latitude, and longitude.'
      );
      return;
    }

    try {
      setSavingLibrary(true);
      setLibraryMessage('');

      await addLibrary(libraryForm);

      setLibraryMessage(
        'Library added successfully.'
      );

      setLibraryForm({
        name: '',
        campus: '',
        address: '',
        lat: '',
        lng: '',
        hours: '8:00 AM - 5:00 PM',
        status: 'Open',
      });

      setShowAddLibrary(false);
    } catch (error) {
      console.error('Add library error:', error);

      setLibraryMessage(
        error.message || 'Failed to add library.'
      );
    } finally {
      setSavingLibrary(false);
    }
  };

  // ============================================================
  // DASHBOARD DATA
  // ============================================================

  const activeBorrows = borrowRequests.filter(
    (r) => r.status === 'borrowed'
  ).length;

  const overdue = borrowRequests.filter(
    (r) =>
      r.status === 'borrowed' &&
      new Date(r.dueDate) < new Date()
  ).length;

  const openLibraries = libraries.filter(
    (l) => l.status === 'Open'
  ).length;

  const trendData = useMemo(() => {
    const days = 7;

    const labels = lastNDaysLabels(days);

    const dayKey = (iso) =>
      new Date(iso).toDateString();

    const keys = Array.from(
      { length: days },
      (_, i) => {
        const d = new Date();

        d.setDate(
          d.getDate() - (days - 1 - i)
        );

        return d.toDateString();
      }
    );

    const visitCounts = keys.map((k) =>
      attendanceLogs.filter(
        (a) => dayKey(a.timeIn) === k
      ).length
    );

    const borrowCounts = keys.map((k) =>
      borrowRequests.filter(
        (r) =>
          r.borrowDate &&
          dayKey(r.borrowDate) === k
      ).length
    );

    return {
      labels,
      visitCounts,
      borrowCounts,
    };
  }, [attendanceLogs, borrowRequests]);

  const categoryData = useMemo(() => {
    const counts = {};

    books.forEach((b) => {
      counts[b.category] =
        (counts[b.category] || 0) + 1;
    });

    return {
      labels: Object.keys(counts),
      values: Object.values(counts),
    };
  }, [books]);

  // ============================================================
  // UI
  // ============================================================

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 flex">

      {/* ======================================================
          SIDEBAR
      ====================================================== */}

      <aside className="w-60 bg-[#002046] text-white flex flex-col shrink-0">

        <div className="p-5 border-b border-white/10">
          <p className="font-extrabold tracking-wider">
            SHELF ILMS
          </p>

          <p className="text-xs text-slate-300 mt-1">
            Super-Admin Console
          </p>
        </div>

        <nav className="flex-1 p-3 space-y-1">

          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setSection(item.id);

                if (item.id !== 'map') {
                  setShowAddLibrary(false);
                  setLibraryMessage('');
                }
              }}
              className={`w-full text-left text-sm px-3 py-2.5 rounded-lg transition ${
                section === item.id
                  ? 'bg-white/15 font-bold'
                  : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              {item.label}
            </button>
          ))}

        </nav>

        <div className="p-4 border-t border-white/10 space-y-2">

          <p className="text-xs text-slate-300">
            Signed in as
          </p>

          <p className="text-sm font-bold">
            {user?.name}
          </p>

          <button
            onClick={logout}
            className="w-full bg-white/10 hover:bg-white/20 text-xs px-3 py-2 rounded-lg border border-white/20 transition"
          >
            Sign Out
          </button>

        </div>

      </aside>

      {/* ======================================================
          MAIN CONTENT
      ====================================================== */}

      <main className="flex-1 p-8 space-y-6 overflow-y-auto">

        <div>
          <h1 className="text-2xl font-bold text-[#0f172a]">
            {NAV
              .find((n) => n.id === section)
              ?.label.replace(/^\S+\s/, '')}
          </h1>

          <p className="text-xs text-slate-500 mt-1">
            System metrics, user management, and analytics overview.
          </p>
        </div>

        {/* ====================================================
            OVERVIEW
        ==================================================== */}

        {section === 'overview' && (
          <div className="space-y-6">

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">

              <StatCard
                label="Registered Visitors"
                value={visitors.length}
                tone="blue"
              />

              <StatCard
                label="Titles in Catalog"
                value={books.length}
              />

              <StatCard
                label="Active Borrows"
                value={activeBorrows}
              />

              <StatCard
                label="Overdue Items"
                value={overdue}
                tone="red"
              />

              <StatCard
                label="Branches Open"
                value={`${openLibraries}/${libraries.length}`}
                tone="amber"
              />

            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">

                <h3 className="text-sm font-bold text-slate-800 mb-3">
                  Visits & Borrows — Last 7 Days
                </h3>

                <Line
                  data={{
                    labels: trendData.labels,
                    datasets: [
                      {
                        label: 'Attendance',
                        data: trendData.visitCounts,
                        borderColor: '#2563eb',
                        backgroundColor: '#2563eb',
                        tension: 0.3,
                      },
                      {
                        label: 'Books Borrowed',
                        data: trendData.borrowCounts,
                        borderColor: '#002046',
                        backgroundColor: '#002046',
                        tension: 0.3,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    plugins: {
                      legend: {
                        position: 'bottom',
                      },
                    },
                  }}
                />

              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">

                <h3 className="text-sm font-bold text-slate-800 mb-3">
                  Catalog by Category
                </h3>

                {categoryData.labels.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No books in the catalog yet.
                  </p>
                ) : (
                  <Bar
                    data={{
                      labels: categoryData.labels,
                      datasets: [
                        {
                          label: 'Titles',
                          data: categoryData.values,
                          backgroundColor: '#2563eb',
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      plugins: {
                        legend: {
                          display: false,
                        },
                      },
                    }}
                  />
                )}

              </div>

            </div>

          </div>
        )}

        {/* ====================================================
            INVENTORY
        ==================================================== */}

        {section === 'inventory' && (
          <BookInventory />
        )}

        {/* ====================================================
            LIBRARIES & MAP
        ==================================================== */}

        {section === 'map' && (
          <div className="space-y-4">

            {/* HEADER */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">

                <div>
                  <h2 className="text-lg font-bold text-slate-800">
                    Libraries & Map
                  </h2>

                  <p className="text-xs text-slate-500 mt-1">
                    Manage library branches and their locations.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowAddLibrary(
                      !showAddLibrary
                    );

                    setLibraryMessage('');
                  }}
                  className="bg-[#002046] hover:bg-[#003568] text-white text-sm font-bold px-4 py-2.5 rounded-lg transition"
                >
                  {showAddLibrary
                    ? '✕ Cancel'
                    : '+ Add Library'}
                </button>

              </div>

            </div>

            {/* MESSAGE */}
            {libraryMessage && (
              <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs font-semibold px-4 py-3 rounded-lg">
                {libraryMessage}
              </div>
            )}

            {/* ADD LIBRARY FORM */}
            {showAddLibrary && (
              <form
                onSubmit={handleAddLibrary}
                className="bg-white rounded-xl border border-slate-200 shadow-sm p-5"
              >

                <div className="mb-5">

                  <h3 className="text-sm font-bold text-slate-800">
                    Add New Library
                  </h3>

                  <p className="text-xs text-slate-500 mt-1">
                    Enter the library information and map coordinates.
                  </p>

                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                  {/* LIBRARY NAME */}
                  <div>

                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Library Name *
                    </label>

                    <input
                      type="text"
                      value={libraryForm.name}
                      onChange={(e) =>
                        setLibraryForm({
                          ...libraryForm,
                          name: e.target.value,
                        })
                      }
                      placeholder="e.g. Tanauan City Public Library"
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
                      required
                    />

                  </div>

                  {/* CAMPUS */}
                  <div>

                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Campus / Branch
                    </label>

                    <input
                      type="text"
                      value={libraryForm.campus}
                      onChange={(e) =>
                        setLibraryForm({
                          ...libraryForm,
                          campus: e.target.value,
                        })
                      }
                      placeholder="e.g. Tanauan City"
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
                    />

                  </div>

                  {/* ADDRESS */}
                  <div className="md:col-span-2">

                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Address *
                    </label>

                    <input
                      type="text"
                      value={libraryForm.address}
                      onChange={(e) =>
                        setLibraryForm({
                          ...libraryForm,
                          address: e.target.value,
                        })
                      }
                      placeholder="Complete library address"
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
                      required
                    />

                  </div>

                  {/* LATITUDE */}
                  <div>

                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Latitude *
                    </label>

                    <input
                      type="number"
                      step="any"
                      value={libraryForm.lat}
                      onChange={(e) =>
                        setLibraryForm({
                          ...libraryForm,
                          lat: e.target.value,
                        })
                      }
                      placeholder="14.085000"
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
                      required
                    />

                  </div>

                  {/* LONGITUDE */}
                  <div>

                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Longitude *
                    </label>

                    <input
                      type="number"
                      step="any"
                      value={libraryForm.lng}
                      onChange={(e) =>
                        setLibraryForm({
                          ...libraryForm,
                          lng: e.target.value,
                        })
                      }
                      placeholder="121.149000"
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
                      required
                    />

                  </div>

                  {/* HOURS */}
                  <div>

                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Operating Hours
                    </label>

                    <input
                      type="text"
                      value={libraryForm.hours}
                      onChange={(e) =>
                        setLibraryForm({
                          ...libraryForm,
                          hours: e.target.value,
                        })
                      }
                      placeholder="8:00 AM - 5:00 PM"
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm"
                    />

                  </div>

                  {/* STATUS */}
                  <div>

                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Status
                    </label>

                    <select
                      value={libraryForm.status}
                      onChange={(e) =>
                        setLibraryForm({
                          ...libraryForm,
                          status: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white"
                    >

                      <option value="Open">
                        Open
                      </option>

                      <option value="Closed">
                        Closed
                      </option>

                    </select>

                  </div>

                </div>

                {/* BUTTONS */}
                <div className="mt-5 flex flex-col sm:flex-row gap-3">

                  <button
                    type="button"
                    onClick={useCurrentLocation}
                    className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-4 py-2.5 rounded-lg text-sm font-bold"
                  >
                    📍 Use Current Location
                  </button>

                  <button
                    type="submit"
                    disabled={savingLibrary}
                    className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-bold"
                  >
                    {savingLibrary
                      ? 'Adding...'
                      : 'Add Library'}
                  </button>

                </div>

              </form>
            )}

            {/* EXISTING LIBRARY MAP */}
            <LibraryMap />

          </div>
        )}

        {/* ====================================================
            STAFF ACCOUNTS
        ==================================================== */}

        {section === 'accounts' && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">

            <div className="px-5 py-3 border-b border-slate-200">

              <h3 className="text-sm font-bold text-slate-800">
                Sub-Admin / Circulation Staff Accounts
              </h3>

              <p className="text-xs text-slate-500">
                Credentials are hardcoded for this deployment
                (no user-management backend yet). To support real
                onboarding, replace this list with a staff-accounts
                table and a password hashing/auth service.
              </p>

            </div>

            <table className="w-full text-left text-sm">

              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">

                <tr>
                  <th className="p-3">Name</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">Assigned Branch</th>
                </tr>

              </thead>

              <tbody className="divide-y divide-slate-100">

                {SUB_ADMIN_CREDENTIALS.map((s) => (
                  <tr key={s.email}>

                    <td className="p-3 font-semibold text-slate-700">
                      {s.name}
                    </td>

                    <td className="p-3 text-xs font-mono text-slate-500">
                      {s.email}
                    </td>

                    <td className="p-3 text-xs text-slate-500">
                      {libraries.find(
                        (l) => l.id === s.libraryId
                      )?.name || s.libraryId}
                    </td>

                  </tr>
                ))}

              </tbody>

            </table>

          </div>
        )}

      </main>

    </div>
  );
}
