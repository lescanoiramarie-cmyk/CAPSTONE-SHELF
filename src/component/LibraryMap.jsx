import { useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
} from 'react-leaflet';
import { useLibraryData } from '../context/LibraryContext';
import 'leaflet/dist/leaflet.css';

export default function LibraryMap({ onBrowseLibrary, lat, lng, name }) {
  const { libraries = [] } = useLibraryData();
  const [search, setSearch] = useState('');
  const [campusFilter, setCampusFilter] = useState('All');
  const [showMap, setShowMap] = useState(true);

  // ==========================================
  // SINGLE MODE: For OPAC Catalog preview
  // ==========================================
  if (lat && lng) {
    const position = [Number(lat), Number(lng)];
    return (
      <div className="h-[300px] w-full rounded-xl overflow-hidden z-0">
        <MapContainer 
          center={position} 
          zoom={16} 
          scrollWheelZoom={true} 
          className="w-full h-full"
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker position={position}>
            <Popup>
              <div className="font-bold text-sm">{name || 'Library Location'}</div>
              <div className="text-xs text-slate-500 mt-1">Book is located here.</div>
            </Popup>
          </Marker>
        </MapContainer>
      </div>
    );
  }

  // ==========================================
  // DIRECTORY MODE: Your existing full page UI
  // ==========================================
  const campuses = [];
  libraries.forEach((library) => {
    if (library.campus && !campuses.includes(library.campus)) {
      campuses.push(library.campus);
    }
  });

  const filteredLibraries = libraries.filter((library) => {
    const searchText = search.trim().toLowerCase();
    const libName = (library.name || '').toLowerCase();
    const address = (library.address || '').toLowerCase();
    const campus = (library.campus || '').toLowerCase();

    const matchesSearch =
      searchText === '' ||
      libName.includes(searchText) ||
      address.includes(searchText) ||
      campus.includes(searchText);

    const matchesCampus =
      campusFilter === 'All' || library.campus === campusFilter;

    return matchesSearch && matchesCampus;
  });

  const librariesWithCoordinates = filteredLibraries.filter((library) => {
    const libLat = Number(library.lat);
    const libLng = Number(library.lng);
    return Number.isFinite(libLat) && Number.isFinite(libLng);
  });

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs px-4 py-2 rounded-lg">
        Sample/demo branch coordinates for the Tanauan City integrated network.
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search libraries by name or address..."
          className="flex-1 px-4 py-2.5 border border-slate-300 rounded-lg text-sm"
        />

        <select
          value={campusFilter}
          onChange={(event) => setCampusFilter(event.target.value)}
          className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm bg-white"
        >
          <option value="All">All</option>
          {campuses.map((campus) => (
            <option key={campus} value={campus}>
              {campus}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setShowMap(!showMap)}
          className="px-4 py-2.5 rounded-lg text-sm font-bold border border-slate-300"
        >
          {showMap ? 'Hide Map View' : 'Show Map View'}
        </button>
      </div>

      <div className={showMap ? 'grid grid-cols-1 lg:grid-cols-5 gap-4' : 'grid grid-cols-1 gap-4'}>
        {showMap && (
          <div className="lg:col-span-2 rounded-xl overflow-hidden border border-slate-200 shadow-sm h-80 lg:h-[600px] z-0">
            <MapContainer
              center={[14.085, 121.149]}
              zoom={13}
              scrollWheelZoom={true}
              className="w-full h-full"
            >
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {librariesWithCoordinates.map((library) => (
                <Marker
                  key={library.id}
                  position={[Number(library.lat), Number(library.lng)]}
                >
                  <Popup>
                    <div className="min-w-[180px]">
                      <h3 className="font-bold text-sm">{library.name}</h3>
                      {library.campus && (
                        <p className="text-xs text-slate-500 mt-1">{library.campus}</p>
                      )}
                      {library.address && (
                        <p className="text-xs text-slate-600 mt-2">📍 {library.address}</p>
                      )}
                      {library.hours && (
                        <p className="text-xs text-slate-500 mt-1">🕒 {library.hours}</p>
                      )}
                      <p className="text-xs font-bold mt-2">{library.status}</p>
                      {onBrowseLibrary && (
                        <button
                          type="button"
                          onClick={() => onBrowseLibrary(library.id)}
                          className="mt-2 text-xs font-bold text-[#002046] hover:underline"
                        >
                          Browse Catalog →
                        </button>
                      )}
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>
        )}

        <div className={showMap ? 'lg:col-span-3 space-y-3' : 'space-y-3'}>
          {filteredLibraries.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
              <p className="text-sm text-slate-500">No libraries match your search.</p>
            </div>
          )}

          {filteredLibraries.map((library) => (
            <div key={library.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <h3 className="font-bold text-sm text-slate-800">{library.name}</h3>
                  <p className="text-xs text-slate-500">{library.campus}</p>
                </div>
                <span
                  className={
                    library.status === 'Open'
                      ? 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700'
                      : 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600'
                  }
                >
                  {library.status}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-2">{library.address}</p>
              <p className="text-xs text-slate-400 mt-1">Hours: {library.hours}</p>
              {onBrowseLibrary && (
                <button
                  type="button"
                  onClick={() => onBrowseLibrary(library.id)}
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