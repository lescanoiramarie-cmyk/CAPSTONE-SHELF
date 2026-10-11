import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix sa default marker icon issue sa Leaflet + React/Vite
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

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
    <div className="w-full h-72 rounded-xl overflow-hidden border border-slate-300 shadow-sm my-3 z-0">
      <MapContainer
        center={position}
        zoom={14}
        scrollWheelZoom={true}
        className="w-full h-full"
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