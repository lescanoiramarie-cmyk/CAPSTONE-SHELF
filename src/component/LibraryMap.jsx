import { useEffect, useRef, useState } from 'react';
import {
  Building2,
  Clock3,
  MapPin,
  Maximize2,
  Minimize2,
  Search,
} from 'lucide-react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from 'react-leaflet';

import { useLibraryData } from '../context/useLibrary.js';

import 'leaflet/dist/leaflet.css';
import '../lib/leafletIcons.js';
import { loadGoogleMaps, hasGoogleMapsKey } from '../lib/googleMaps.js';

function GoogleMapsEmbed({ libraries, activeFocusBranchId, bookContext }) {
  const focused = libraries.find((lib) => String(lib.id) === String(activeFocusBranchId)) || libraries[0];
  const query = focused?.address
    ? encodeURIComponent(`${focused.name || ''}, ${focused.address}`)
    : focused?.lat && focused?.lng
    ? `${focused.lat},${focused.lng}`
    : 'Batangas State University, Batangas, Philippines';
  const zoom = activeFocusBranchId ? 16 : 12;

  return (
    <div className="relative h-full w-full min-h-[400px]">
      <iframe
        title="Google Maps Interactive View"
        width="100%"
        height="100%"
        style={{ border: 0, minHeight: '400px' }}
        loading="lazy"
        allowFullScreen
        referrerPolicy="no-referrer-when-downgrade"
        src={`https://maps.google.com/maps?q=${query}&hl=en&z=${zoom}&output=embed`}
        className="h-full w-full rounded-b-xl"
      />
      {focused && (
        <div className="absolute bottom-3 left-3 z-10 max-w-sm rounded-lg border border-slate-200 bg-white/95 p-3 shadow-md backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/95">
          <p className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-blue-600"></span>
            {focused.name}
          </p>
          {focused.address && (
            <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-300">
              {focused.address}
            </p>
          )}
          {bookContext && (
            <p className="mt-1 text-[11px] font-semibold text-blue-700 dark:text-blue-300">
              📖 {bookContext.title} ({bookContext.availableCopies} available)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function GoogleLibraryMap({
  libraries,
  activeFocusBranchId,
  setSelectedLibraryId,
  bookContext,
  onBrowseLibrary,
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
        if (!library.lat || !library.lng || !Number.isFinite(Number(library.lat))) return;
        const pos = { lat: Number(library.lat), lng: Number(library.lng) };
        bounds.extend(pos);

        const marker = new maps.Marker({
          position: pos,
          map,
          title: library.name,
        });

        marker.addListener('click', () => {
          setSelectedLibraryId(library.id);
          infoWindow.setContent(`
            <div style="font-family: inherit; padding: 4px; min-width: 180px;">
              <h3 style="font-weight: bold; font-size: 14px; margin: 0 0 4px 0;">${library.name}</h3>
              ${library.campus ? `<p style="font-size: 12px; color: #475569; margin: 0 0 4px 0;">${library.campus}</p>` : ''}
              ${library.address ? `<p style="font-size: 12px; color: #475569; margin: 0 0 4px 0;">📍 ${library.address}</p>` : ''}
              ${library.hours ? `<p style="font-size: 12px; color: #475569; margin: 0 0 4px 0;">⏰ ${library.hours}</p>` : ''}
              ${library.status ? `<p style="font-size: 11px; font-weight: bold; margin: 4px 0 0 0;">${library.status}</p>` : ''}
            </div>
          `);
          infoWindow.open(map, marker);
        });

        markersRef.current.push(marker);

        if (library.id === activeFocusBranchId) {
          map.setCenter(pos);
          map.setZoom(14);
          infoWindow.setContent(`
            <div style="font-family: inherit; padding: 4px; min-width: 180px;">
              <h3 style="font-weight: bold; font-size: 14px; margin: 0 0 4px 0;">${library.name}</h3>
              ${library.address ? `<p style="font-size: 12px; color: #475569; margin: 0 0 4px 0;">📍 ${library.address}</p>` : ''}
              ${bookContext ? `<p style="font-size: 12px; font-weight: bold; color: #1e3a8a; margin: 4px 0 0 0;">📖 ${bookContext.title} (${bookContext.availableCopies} available)</p>` : ''}
            </div>
          `);
          infoWindow.open(map, marker);
        }
      });

      if (!activeFocusBranchId && markersRef.current.length > 0) {
        map.fitBounds(bounds);
      }
    });

    return () => {
      active = false;
    };
  }, [libraries, activeFocusBranchId, setSelectedLibraryId, bookContext, onBrowseLibrary]);

  return <div ref={containerRef} className="h-full w-full min-h-[inherit]" />;
}


function ResizeMap({ isFullscreen }) {
  const map = useMap();

  useEffect(() => {
    const mapContainer = map.getContainer();
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
    });
    const frameId = window.requestAnimationFrame(() => {
      map.invalidateSize({ pan: false });
    });

    resizeObserver.observe(mapContainer);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [isFullscreen, map]);

  return null;
}

function FocusBranch({ library, markerRef }) {
  const map = useMap();
  const latitude = Number(library.lat);
  const longitude = Number(library.lng);

  useEffect(() => {
    map.setView([latitude, longitude], Math.max(map.getZoom(), 15));
    markerRef.current?.openPopup();
  }, [latitude, longitude, map, markerRef]);

  return null;
}

function FitLibraries({ coordinates, focusBranchId }) {
  const map = useMap();

  useEffect(() => {
    if (focusBranchId != null || coordinates === '') {
      return;
    }

    const locations = coordinates
      .split('|')
      .map((coordinate) => coordinate.split(',').map(Number));

    if (locations.length === 1) {
      map.setView(locations[0], 15);
      return;
    }

    map.fitBounds(locations, {
      padding: [24, 24],
      maxZoom: 12,
    });
  }, [coordinates, focusBranchId, map]);

  return null;
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
  const focusedMarkerRef = useRef(null);

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
    filteredLibraries.filter(
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
  const markerCoordinates = librariesWithCoordinates
    .map((library) => `${Number(library.lat)},${Number(library.lng)}`)
    .join('|');

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
              <GoogleMapsEmbed
                libraries={librariesWithCoordinates}
                activeFocusBranchId={activeFocusBranchId}
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
