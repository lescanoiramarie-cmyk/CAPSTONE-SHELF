import { useEffect, useRef, useState } from 'react';
import {
  Clock3,
  MapPin,
  Maximize2,
  Minimize2,
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


function ResizeMap({ isFullscreen }) {
  const map = useMap();

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => window.clearTimeout(timeoutId);
  }, [isFullscreen, map]);

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

  // =========================================================
  // COMPONENT
  // =========================================================

  return (
    <div className="space-y-4">

      {/* =====================================================
          SEARCH AND FILTER CONTROLS
      ====================================================== */}

      <div className="flex flex-col sm:flex-row gap-3">

        <input
          type="text"
          value={search}
          onChange={(event) =>
            setSearch(event.target.value)
          }
          placeholder="Search libraries by name or address..."
          className="flex-1 px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
        />

        <select
          value={campusFilter}
          onChange={(event) =>
            setCampusFilter(
              event.target.value
            )
          }
          className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-shelf-primary/20"
        >
          <option value="All">
            All
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

        <button
          type="button"
          onClick={() =>
            setShowMap(!showMap)
          }
          className="px-4 py-2.5 rounded-lg text-sm font-bold border border-slate-300 hover:bg-slate-50 transition"
        >
          {showMap
            ? 'Hide Map View'
            : 'Show Map View'}
        </button>

      </div>

      {/* =====================================================
          MAP AND LIBRARY LIST
      ====================================================== */}
      <div
        className={
          showMap && showLibraryList
          ? 'grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'
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
                ? 'fixed inset-0 z-9999 h-screen w-screen overflow-hidden bg-white'
                : 'relative isolate z-0 min-w-0 h-105 lg:h-140 overflow-hidden rounded-xl border border-slate-200 shadow-sm'
            }
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

            <MapContainer
              center={[14.085, 121.149]}
              zoom={13}
              scrollWheelZoom
              className="relative z-0 h-full w-full"
            >
              <ResizeMap isFullscreen={isMapFullscreen} />

              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {focusBranchId &&
                (() => {
                  const branch = libraries.find(
                    (library) => library.id === focusBranchId
                  );
                  return branch &&
                    branch.lat != null &&
                    branch.lng != null &&
                    String(branch.lat).trim() !== '' &&
                    String(branch.lng).trim() !== '' &&
                    Number.isFinite(Number(branch.lat)) &&
                    Number.isFinite(Number(branch.lng)) &&
                    Number(branch.lat) >= -90 &&
                    Number(branch.lat) <= 90 &&
                    Number(branch.lng) >= -180 &&
                    Number(branch.lng) <= 180 ? (
                    <FocusBranch
                      library={branch}
                      markerRef={focusedMarkerRef}
                    />
                  ) : null;
                })()}

              {librariesWithCoordinates.map(
                (library) => (
                  <Marker
                    key={library.id}
                    ref={
                      library.id === focusBranchId
                        ? focusedMarkerRef
                        : undefined
                    }
                    position={[
                      Number(library.lat),
                      Number(library.lng),
                    ]}
                  >
                    <Popup>

                      <div className="min-w-45">

                        <h3 className="text-base font-bold leading-snug text-slate-900">
                          {library.name}
                        </h3>

                        {library.campus && (
                          <p className="mt-1 text-sm leading-relaxed text-slate-600">
                            {library.campus}
                          </p>
                        )}

                        {library.address && (
                          <p className="mt-2 flex items-start gap-2 text-sm leading-relaxed text-slate-600">
                            <MapPin size={13} className="mt-0.5 shrink-0" aria-hidden="true" /> {library.address}
                          </p>
                        )}

                        {library.hours && (
                          <p className="mt-2 flex items-center gap-2 text-sm leading-relaxed text-slate-600">
                            <Clock3 size={13} aria-hidden="true" /> {library.hours}
                          </p>
                        )}

                        {focusBranchId != null &&
                          library.id === focusBranchId &&
                          bookContext && (
                          <div className="mt-2 border-t border-slate-200 pt-2">
                            <p className="text-xs font-bold text-slate-900">
                              {bookContext.title}
                            </p>
                            <p className="mt-1 text-sm leading-relaxed text-slate-600">
                              {bookContext.availableCopies} available of{' '}
                              {bookContext.totalCopies} copies
                            </p>
                          </div>
                        )}

                        {library.status && (
                          <p className="text-xs font-bold mt-2">
                            {library.status}
                          </p>
                        )}

                        {onBrowseLibrary && (
                          <button
                            type="button"
                            onClick={() =>
                              onBrowseLibrary(
                                library.id
                              )
                            }
                            className="mt-3 inline-flex items-center text-sm font-bold text-shelf-primary hover:underline"
                          >
                            Browse Catalog →
                          </button>
                        )}

                      </div>

                    </Popup>
                  </Marker>
                )
              )}

            </MapContainer>

          </div>
        )}

        {/* ===================================================
            LIBRARY LIST
        ==================================================== */}
      {showLibraryList && (
        <div
          className="min-w-0 space-y-3"
        >

          {/* NO RESULTS */}

          {filteredLibraries.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">

              <p className="text-sm text-slate-500">
                No libraries match your search.
              </p>

            </div>
          )}

          {/* LIBRARIES */}

          {filteredLibraries.map(
            (library) => (
              <div
                key={library.id}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
              >

                <div className="flex justify-between items-start gap-3">

                  <div>

                    <h3 className="text-base font-bold leading-snug text-slate-900">
                      {library.name}
                    </h3>

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
                          ? 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700'
                          : 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600'
                      }
                    >
                      {library.status}
                    </span>
                  )}

                </div>

                {library.address && (
                  <p className="mt-3 text-sm leading-relaxed text-slate-600">
                    {library.address}
                  </p>
                )}

                {library.hours && (
                  <p className="mt-2 text-sm leading-relaxed text-slate-500">
                    Hours: {library.hours}
                  </p>
                )}

                {onBrowseLibrary && (
                  <button
                    type="button"
                    onClick={() =>
                      onBrowseLibrary(
                        library.id
                      )
                    }
                    className="mt-4 inline-flex items-center text-sm font-bold text-shelf-primary hover:underline"
                  >
                    Browse Library Catalog →
                  </button>
                )}

              </div>
            )
          )}

        </div>
      )}
      </div>

    </div>
  );
}
