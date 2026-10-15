import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import '../lib/leafletIcons.js';

// Component para sa pag-click at pag-drag sa mapa
function MapEventsHandler({ position, setPosition, onChangeCoordinates }) {
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng;
      setPosition([lat, lng]);
      onChangeCoordinates(lat.toFixed(6), lng.toFixed(6));
    },
  });

  return (
    <Marker
      position={position}
      draggable={true}
      eventHandlers={{
        dragend(e) {
          const { lat, lng } = e.target.getLatLng();
          setPosition([lat, lng]);
          onChangeCoordinates(lat.toFixed(6), lng.toFixed(6));
        },
      }}
    />
  );
}

// Recenter at resize trigger kapag nagbago ang posisyon o nag-render ang modal/form
function RecenterMap({ center }) {
  const map = useMap();
  
  useEffect(() => {
    // Ino-offset ang rendering para maging smooth ang pagpapakita ng mapa
    setTimeout(() => {
      map.invalidateSize();
    }, 100);
    map.setView(center, map.getZoom());
  }, [center, map]);

  return null;
}

export default function LocationPickerMap({ position, setPosition, onChangeCoordinates }) {
  return (
    <div className="relative isolate z-0 my-3 h-72 w-full min-w-0 overflow-hidden rounded-xl border border-slate-300 shadow-sm">
      <MapContainer
        center={position}
        zoom={14}
        scrollWheelZoom={true}
        className="relative z-0 h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <RecenterMap center={position} />
        <MapEventsHandler
          position={position}
          setPosition={setPosition}
          onChangeCoordinates={onChangeCoordinates}
        />
      </MapContainer>
    </div>
  );
}