import { useMemo, useState } from 'react';
import { useLibraryData } from '../context/LibraryContext';

/**
 * Library Map & Location page (per Chapter 3, Figure 14):
 *  1. Search bar   2. Map view toggle   3. Filter bar (campus)
 *  4. Library status list (open/closed, address, hours)
 *  5. "Browse Catalog" button per library
 *
 * No Google Maps API key is configured for this project yet, so this uses a
 * key-free OpenStreetMap embed for the visual map. Swap the iframe below for
 * `@react-google-maps/api` (per the Chapter 3 design) once a billing-enabled
 * Google Maps API key is available — the lat/lng data already matches what
 * that library expects.
 */
export default function LibraryMap({ onBrowseLibrary }) {
  const { libraries } = useLibraryData();
  const [search, setSearch] = useState('');
  const [campusFilter, setCampusFilter] = useState('All');
  const [showMap, setShowMap] = useState(true);
  const [selected, setSelected] = useState(libraries[0] || null);

  const campuses = useMemo(() => ['All', ...new Set(libraries.map((l) => l.campus))], [libraries]);

  const filtered = libraries.filter((l) => {
    const matchesSearch =
      l.name.toLowerCase().includes(search.toLowerCase()) || l.address.toLowerCase().includes(search.toLowerCase());
    const matchesCampus = campusFilter === 'All' || l.campus === campusFilter;
    return matchesSearch && matchesCampus;
  });

  const mapCenter = selected || libraries[0];
  const bbox = mapCenter
    ? [mapCenter.lng - 0.03, mapCenter.lat - 0.02, mapCenter.lng + 0.03, mapCenter.lat + 0.02].join(',')
    : null;
  const mapSrc = mapCenter
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${mapCenter.lat},${mapCenter.lng}`
    : null;

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs px-4 py-2 rounded-lg">
        Sample/demo branch coordinates for the Tanauan City integrated network — replace with each partner
        library's surveyed GPS coordinates before go-live.
      </div>

      {/* 1. Search + 3. Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search libraries by name or address…"
          className="flex-1 px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
        />
        <select
          value={campusFilter}
          onChange={(e) => setCampusFilter(e.target.value)}
          className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm bg-white text-slate-700"
        >
          {campuses.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowMap((s) => !s)}
          className="px-4 py-2.5 rounded-lg text-sm font-bold border border-slate-300 text-slate-700 hover:bg-slate-50 transition whitespace-nowrap"
        >
          {showMap ? 'Hide Map View' : 'Show Map View'}
        </button>
      </div>

      <div className={`grid grid-cols-1 ${showMap ? 'lg:grid-cols-5' : ''} gap-4`}>
        {/* 2. Map View Panel */}
        {showMap && (
          <div className="lg:col-span-2 rounded-xl overflow-hidden border border-slate-200 shadow-sm h-80 lg:h-auto">
            {mapSrc ? (
              <iframe
                title="Library location map"
                src={mapSrc}
                className="w-full h-full min-h-80"
                style={{ border: 0 }}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">No location selected.</div>
            )}
          </div>
        )}

        {/* 4. Library Status Section */}
        <div className={showMap ? 'lg:col-span-3 space-y-3' : 'space-y-3'}>
          {filtered.length === 0 && (
            <p className="text-sm text-slate-500">No libraries match your search.</p>
          )}
          {filtered.map((lib) => (
            <div
              key={lib.id}
              onClick={() => setSelected(lib)}
              className={`bg-white rounded-xl border p-4 shadow-sm cursor-pointer transition ${
                selected?.id === lib.id ? 'border-[#002046] ring-2 ring-[#002046]/10' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex justify-between items-start gap-3">
                <div>
                  <h3 className="font-bold text-sm text-slate-800">{lib.name}</h3>
                  <p className="text-xs text-slate-500">{lib.campus}</p>
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                    lib.status === 'Open' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {lib.status}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-2">{lib.address}</p>
              <p className="text-xs text-slate-400 mt-1">Hours: {lib.hours}</p>

              {/* 5. Browse Library Catalog Button */}
              {onBrowseLibrary && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onBrowseLibrary(lib.id);
                  }}
                  className="mt-3 text-xs font-bold text-[#002046] hover:underline"
                >
                  Browse Library Catalog →
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
