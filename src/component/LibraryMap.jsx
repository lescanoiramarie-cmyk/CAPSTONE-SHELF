import { useEffect, useRef, useState } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import '../lib/leafletIcons.js';
import {
  Building2,
  Clock3,
  MapPin,
  Maximize2,
  Minimize2,
  Search,
} from 'lucide-react';
import { useLibraryData } from '../context/useLibrary.js';
import { loadGoogleMaps, hasGoogleMapsKey } from '../lib/googleMaps.js';

function createLibraryInfoWindowContent(library, bookContext = null) {
  const content = document.createElement('div');
  content.style.fontFamily = 'inherit';
  content.style.padding = '4px';
  content.style.minWidth = '180px';

  const title = document.createElement('h3');
  title.textContent = library.name || 'Library';
  title.style.fontWeight = 'bold';
  title.style.fontSize = '14px';
  title.style.margin = '0 0 4px';
  content.append(title);

  for (const [value, prefix] of [
    [library.campus, ''],
    [library.address, '📍 '],
    [library.hours, '⏰ '],
    [library.status, ''],
  ]) {
    if (!value) continue;
    const detail = document.createElement('p');
    detail.textContent = `${prefix}${value}`;
    detail.style.fontSize = '12px';
    detail.style.color = '#475569';
    detail.style.margin = '0 0 4px';
    content.append(detail);
  }

  if (bookContext?.title) {
    const book = document.createElement('p');
    book.textContent = `📖 ${bookContext.title} (${bookContext.availableCopies} available)`;
    book.style.fontSize = '12px';
    book.style.fontWeight = 'bold';
    book.style.color = '#1e3a8a';
    book.style.margin = '4px 0 0';
    content.append(book);
  }

  return content;
}

function LibraryMapFocus({ selectedLibrary, libraries }) {
  const map = useMap();
  useEffect(() => {
    if (selectedLibrary) {
      map.flyTo([Number(selectedLibrary.lat), Number(selectedLibrary.lng)], 15, { duration: 0.6 });
    } else if (libraries.length > 0) {
      map.fitBounds(libraries.map((library) => [Number(library.lat), Number(library.lng)]), { padding: [28, 28], maxZoom: 12 });
    }
  }, [map, selectedLibrary, libraries]);
  return null;
}

function LeafletLibraryMap({ libraries, activeFocusBranchId, onSelect, bookContext }) {
  const focused = libraries.find((library) => String(library.id) === String(activeFocusBranchId));
  const initialCenter = focused ? [Number(focused.lat), Number(focused.lng)] : [13.9, 121.1];
  return (
    <MapContainer center={initialCenter} zoom={focused ? 14 : 8} scrollWheelZoom className="h-full w-full min-h-[inherit]">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <LibraryMapFocus selectedLibrary={focused} libraries={libraries} />
      {libraries.map((library) => (
        <Marker key={library.id} position={[Number(library.lat), Number(library.lng)]} eventHandlers={{ click: () => onSelect(library.id) }}>
          <Popup>
            <strong>{library.name}</strong>
            {library.address && <div>{library.address}</div>}
            {library.hours && <div>Hours: {library.hours}</div>}
            {bookContext?.title && <div>{bookContext.title} ({bookContext.availableCopies} available)</div>}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

function GoogleLibraryMap({
  libraries,
  activeFocusBranchId,
  setSelectedLibraryId,
  bookContext,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    let active = true;
    void loadGoogleMaps().then((maps) => {
      if (!active || !maps || !containerRef.current) return;

      const map = new maps.Map(containerRef.current, {
        center: { lat: 13.9, lng: 121.1 },
        zoom: 10,
        mapTypeControl: false,
        streetViewControl: false,
      });
      mapRef.current = map;

      const bounds = new maps.LatLngBounds();
      const infoWindow = new maps.InfoWindow();

      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];

      libraries.forEach((library) => {
        const lat = Number(library.lat);
        const lng = Number(library.lng);
        if (
          library.lat == null || library.lng == null ||
          String(library.lat).trim() === '' || String(library.lng).trim() === '' ||
          !Number.isFinite(lat) || !Number.isFinite(lng) ||
          lat < -90 || lat > 90 || lng < -180 || lng > 180
        ) return;
        const pos = { lat, lng };
        bounds.extend(pos);

        const marker = new maps.Marker({
          position: pos,
          map,
          title: library.name,
        });

        marker.addListener('click', () => {
          setSelectedLibraryId(library.id);
          map.panTo(pos);
          map.setZoom(14);
          infoWindow.setContent(createLibraryInfoWindowContent(library, bookContext));
          infoWindow.open(map, marker);
        });

        markersRef.current.push(marker);

        if (String(library.id) === String(activeFocusBranchId)) {
          map.setCenter(pos);
          map.setZoom(14);
          infoWindow.setContent(createLibraryInfoWindowContent(library, bookContext));
          infoWindow.open(map, marker);
        }
      });

      if (!activeFocusBranchId && markersRef.current.length > 0) {
        map.fitBounds(bounds);
      }
    });

    return () => {
      active = false;
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
      mapRef.current = null;
    };
  }, [libraries, activeFocusBranchId, setSelectedLibraryId, bookContext]);

  return <div ref={containerRef} className="h-full w-full min-h-[inherit]" />;
}

export default function LibraryMap({
  onBrowseLibrary,
  focusBranchId = null,
  bookContext = null,
  libraryScopeId = null,
  showLibraryList = true,
}) {
  const { libraries = [] } = useLibraryData();
  const visibleLibraries = libraryScopeId == null
    ? libraries
    : libraries.filter(
        (library) => String(library.id) === String(libraryScopeId)
      );

  const [search, setSearch] = useState('');
  const [campusFilter, setCampusFilter] = useState('All');
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const [showMap, setShowMap] = useState(true);
  const [selectedLibraryId, setSelectedLibraryId] = useState(null);
  const [libraryPage, setLibraryPage] = useState(1);
  const [useGoogle, setUseGoogle] = useState(() => hasGoogleMapsKey());
  const librariesPerPage = 3;
  const activeFocusBranchId = focusBranchId ?? selectedLibraryId;

  useEffect(() => {
    if (hasGoogleMapsKey()) {
      void loadGoogleMaps().then((maps) => {
        if (!maps) setUseGoogle(false);
      });
    }
  }, []);

  // =========================================================
  // GET AVAILABLE CAMPUSES
  // =========================================================

  const campuses = [];

  visibleLibraries.forEach((library) => {
    if (
      library.campus &&
      !campuses.includes(library.campus)
    ) {
      campuses.push(library.campus);
    }
  });

  // =========================================================
  // FILTER LIBRARIES
  // =========================================================

  const filteredLibraries = visibleLibraries.filter(
    (library) => {
      const searchText =
        search.trim().toLowerCase();

      const name = (
        library.name || ''
      ).toLowerCase();

      const address = (
        library.address || ''
      ).toLowerCase();

      const campus = (
        library.campus || ''
      ).toLowerCase();

      const matchesSearch =
        searchText === '' ||
        name.includes(searchText) ||
        address.includes(searchText) ||
        campus.includes(searchText);

      const matchesCampus =
        campusFilter === 'All' ||
        library.campus === campusFilter;

      return (
        ((focusBranchId != null && library.id === focusBranchId) ||
          (matchesSearch && matchesCampus))
      );
    }
  );
  const pageCount = Math.max(1, Math.ceil(filteredLibraries.length / librariesPerPage));
  const currentLibraryPage = Math.min(libraryPage, pageCount);
  const pagedLibraries = filteredLibraries.slice(
    (currentLibraryPage - 1) * librariesPerPage,
    currentLibraryPage * librariesPerPage
  );

  // =========================================================
  // LIBRARIES WITH VALID COORDINATES
  // =========================================================

  const librariesWithCoordinates =
    visibleLibraries.filter(
      (library) => {
        const lat = Number(
          library.lat
        );

        const lng = Number(
          library.lng
        );

        return (
          library.lat !== null &&
          library.lat !== undefined &&
          library.lng !== null &&
          library.lng !== undefined &&
          String(library.lat).trim() !== '' &&
          String(library.lng).trim() !== '' &&
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          lat >= -90 &&
          lat <= 90 &&
          lng >= -180 &&
          lng <= 180
        );
      }
    );

  // =========================================================
  // COMPONENT
  // =========================================================

  return (
    <section className="w-full min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5">

      {/* =====================================================
          SEARCH AND FILTER CONTROLS
      ====================================================== */}

      <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-shelf-primary dark:bg-slate-700 dark:text-blue-200">
            <Building2 size={21} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white sm:text-xl">Find a library</h2>
            <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">Explore branches, check their details, and open a library catalog.</p>
          </div>
        </div>
        <span className="inline-flex w-fit items-center rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
          {filteredLibraries.length} {filteredLibraries.length === 1 ? 'library' : 'libraries'} found
        </span>
      </header>

      <div className="grid min-w-0 gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900/50 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.42fr)_auto] sm:items-center sm:p-4">
        <label className="relative block min-w-0">
          <span className="sr-only">Search libraries by name or address</span>
          <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setLibraryPage(1);
            }}
            placeholder="Search by library or address"
            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-800 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          />
        </label>

        {libraryScopeId == null && (
          <label className="block min-w-0">
            <span className="sr-only">Filter by campus</span>
            <select
              value={campusFilter}
              onChange={(event) => {
                setCampusFilter(event.target.value);
                setLibraryPage(1);
              }}
              className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-shelf-primary/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            >
            <option value="All">
              All campuses
            </option>

            {campuses.map((campus) => (
              <option
                key={campus}
                value={campus}
              >
                {campus}
              </option>
            ))}
            </select>
          </label>
        )}

        <button
          type="button"
          onClick={() =>
            setShowMap(!showMap)
          }
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
        >
          {showMap
            ? 'Hide map view'
            : 'Show map view'}
        </button>

      </div>

      {/* =====================================================
          MAP AND LIBRARY LIST
      ====================================================== */}
      <div
        className={
          showMap && showLibraryList
          ? 'grid grid-cols-1 items-stretch gap-5 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:grid-cols-[minmax(0,13fr)_minmax(0,7fr)]'
          : 'grid grid-cols-1 gap-5'
        }
      >

        {/* ===================================================
            MAP
        ==================================================== */}
        {showMap && (
          <div
            className={
              isMapFullscreen
                ? 'fixed inset-0 z-9999 h-dvh w-screen overflow-hidden bg-white'
                : 'relative isolate z-0 min-w-0 w-full overflow-hidden rounded-xl border border-slate-200 shadow-sm'
            }
            style={isMapFullscreen ? undefined : { minHeight: 'clamp(28rem, 72dvh, 48rem)' }}
          >
            <button
              type="button"
              onClick={() => setIsMapFullscreen((current) => !current)}
              aria-label={
                isMapFullscreen
                  ? 'Exit full-screen map'
                  : 'View map full-screen'
              }
              title={
                isMapFullscreen
                  ? 'Exit full screen'
                  : 'View full screen'
              }

                className="absolute right-3 top-3 z-1200 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-lg transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-shelf-primary"
            >
              {isMapFullscreen ? (
                <Minimize2 size={20} aria-hidden="true" />
              ) : (
                <Maximize2 size={20} aria-hidden="true" />
              )}
            </button>

            {useGoogle ? (
              <GoogleLibraryMap
                libraries={librariesWithCoordinates}
                activeFocusBranchId={activeFocusBranchId}
                setSelectedLibraryId={setSelectedLibraryId}
                bookContext={bookContext}
                onBrowseLibrary={onBrowseLibrary}
              />
            ) : (
              <LeafletLibraryMap
                libraries={librariesWithCoordinates}
                activeFocusBranchId={activeFocusBranchId}
                onSelect={setSelectedLibraryId}
                bookContext={bookContext}
              />
            )}

          </div>
        )}

        {/* ===================================================
            LIBRARY LIST
        ==================================================== */}
      {showLibraryList && (
        <div
          className={
            showMap
              ? 'min-w-0 space-y-3'
              : 'min-w-0 space-y-2'
          }
        >

          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Library directory</h3>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">Select a branch to locate it on the map.</p>
            </div>
            <MapPin size={18} className="shrink-0 text-shelf-primary dark:text-blue-200" aria-hidden="true" />
          </div>

          {/* NO RESULTS */}

          {filteredLibraries.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">

              <p className="text-sm text-slate-500">
                No libraries match your search.
              </p>

            </div>
          )}

          {/* LIBRARIES */}

          {pagedLibraries.map(
            (library) => (
              <div
                key={library.id}
                onClick={() => setSelectedLibraryId(library.id)}
                className={`cursor-pointer rounded-xl border bg-white p-3 shadow-sm transition hover:shadow-md ${
                  activeFocusBranchId === library.id
                    ? 'border-shelf-primary ring-1 ring-shelf-primary/30'
                    : 'border-slate-200'
                }`}
              >

                <div className="flex items-start justify-between gap-3">

                  <div className="min-w-0">

                    <button
                      type="button"
                      onClick={() => setSelectedLibraryId(library.id)}
                      className="text-left text-base font-bold leading-snug text-slate-900 hover:text-shelf-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shelf-primary"
                    >
                      {library.name}
                    </button>

                    {library.campus && (
                      <p className="mt-1 text-sm leading-relaxed text-slate-600">
                        {library.campus}
                      </p>
                    )}

                  </div>

                  {library.status && (
                    <span
                      className={
                        library.status ===
                        'Open'
                          ? 'shrink-0 whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700'
                          : 'shrink-0 whitespace-nowrap rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-600'
                      }
                    >
                      {library.status}
                    </span>
                  )}

                </div>

                {library.address && (
                  <p className="mt-2 flex min-w-0 items-start gap-2 text-sm leading-snug text-slate-600">
                    <MapPin size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 break-words">{library.address}</span>
                  </p>
                )}

                {library.hours && (
                  <p className="mt-1.5 flex min-w-0 items-start gap-2 text-sm leading-snug text-slate-500">
                    <Clock3 size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 break-words">Hours: {library.hours}</span>
                  </p>
                )}

                {onBrowseLibrary && (
                  <button
                    type="button"
                    onClick={(event) =>
                      {
                        event.stopPropagation();
                        onBrowseLibrary(library.id);
                      }
                    }
                    className="mt-2.5 inline-flex items-center text-sm font-bold text-shelf-primary hover:underline"
                  >
                    Browse library catalog →
                  </button>
                )}

              </div>
            )
          )}

          {filteredLibraries.length > librariesPerPage && (
            <nav
              aria-label="Library list pages"
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5"
            >
              <p className="text-xs text-slate-600" aria-live="polite">
                Showing {(currentLibraryPage - 1) * librariesPerPage + 1}–{Math.min(currentLibraryPage * librariesPerPage, filteredLibraries.length)} of {filteredLibraries.length} libraries
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setLibraryPage((page) => Math.max(1, page - 1))}
                  disabled={currentLibraryPage === 1}
                  className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Previous
                </button>
                <span className="text-xs font-semibold text-slate-600">
                  Page {currentLibraryPage} of {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setLibraryPage((page) => Math.min(pageCount, page + 1))}
                  disabled={currentLibraryPage === pageCount}
                  className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Next
                </button>
              </div>
            </nav>
          )}

        </div>
      )}
      </div>

    </section>
  );
}
