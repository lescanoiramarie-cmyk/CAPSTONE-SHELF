import { useEffect, useRef, useState } from 'react';
import { Clock3, MapPin } from 'lucide-react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from 'react-leaflet';

import { useLibraryData } from '../context/useLibrary.js';

import 'leaflet/dist/leaflet.css';

function FocusBranch({ library, markerRef }) {
  const map = useMap();

  useEffect(() => {
    if (!library) return;
    const position = [Number(library.lat), Number(library.lng)];
    map.setView(position, Math.max(map.getZoom(), 15));
    markerRef.current?.openPopup();
  }, [library, map, markerRef]);

  return null;
}

export default function LibraryMap({
  onBrowseLibrary,
  focusBranchId = null,
  bookContext = null,
}) {
  const { libraries = [] } = useLibraryData();
  const focusedMarkerRef = useRef(null);

  const [search, setSearch] = useState('');
  const [campusFilter, setCampusFilter] = useState('All');
  const [showMap, setShowMap] = useState(true);

  // =========================================================
  // GET AVAILABLE CAMPUSES
  // =========================================================

  const campuses = [];

  libraries.forEach((library) => {
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

  const filteredLibraries = libraries.filter(
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
          Number.isFinite(lat) &&
          Number.isFinite(lng)
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
          className="flex-1 px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
        />

        <select
          value={campusFilter}
          onChange={(event) =>
            setCampusFilter(
              event.target.value
            )
          }
          className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#002046]/20"
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
          showMap
            ? 'grid grid-cols-1 lg:grid-cols-5 gap-4'
            : 'grid grid-cols-1 gap-4'
        }
      >

        {/* ===================================================
            MAP
        ==================================================== */}

        {showMap && (
          <div className="lg:col-span-2 rounded-xl overflow-hidden border border-slate-200 shadow-sm h-80 lg:h-[600px]">

            <MapContainer
              center={[14.085, 121.149]}
              zoom={13}
              scrollWheelZoom
              className="w-full h-full"
            >

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
                    Number.isFinite(Number(branch.lat)) &&
                    Number.isFinite(Number(branch.lng)) ? (
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

                      <div className="min-w-[180px]">

                        <h3 className="font-bold text-sm">
                          {library.name}
                        </h3>

                        {library.campus && (
                          <p className="text-xs text-slate-500 mt-1">
                            {library.campus}
                          </p>
                        )}

                        {library.address && (
                          <p className="mt-2 flex items-start gap-1 text-xs text-slate-600">
                            <MapPin size={13} className="mt-0.5 shrink-0" aria-hidden="true" /> {library.address}
                          </p>
                        )}

                        {library.hours && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                            <Clock3 size={13} aria-hidden="true" /> {library.hours}
                          </p>
                        )}

                        {focusBranchId != null &&
                          library.id === focusBranchId &&
                          bookContext && (
                          <div className="mt-2 border-t border-slate-200 pt-2">
                            <p className="text-xs font-bold text-slate-800">
                              {bookContext.title}
                            </p>
                            <p className="text-xs text-slate-600">
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
                            className="mt-2 text-xs font-bold text-[#002046] hover:underline"
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

        <div
          className={
            showMap
              ? 'lg:col-span-3 space-y-3'
              : 'space-y-3'
          }
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
                className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm"
              >

                <div className="flex justify-between items-start gap-3">

                  <div>

                    <h3 className="font-bold text-sm text-slate-800">
                      {library.name}
                    </h3>

                    {library.campus && (
                      <p className="text-xs text-slate-500">
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
                  <p className="text-xs text-slate-500 mt-2">
                    {library.address}
                  </p>
                )}

                {library.hours && (
                  <p className="text-xs text-slate-400 mt-1">
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
                    className="mt-3 text-xs font-bold text-[#002046] hover:underline"
                  >
                    Browse Library Catalog →
                  </button>
                )}

              </div>
            )
          )}

        </div>

      </div>

    </div>
  );
}
