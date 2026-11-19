import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import '../lib/leafletIcons.js';
import { loadGoogleMaps, hasGoogleMapsKey } from '../lib/googleMaps.js';

// Component para sa pag-click at pag-drag sa Leaflet mapa
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
    setTimeout(() => {
      map.invalidateSize();
    }, 100);
    map.setView(center, map.getZoom());
  }, [center, map]);

  return null;
}

// Google Maps implementation kapag configured ang VITE_GOOGLE_MAPS_API_KEY
function GoogleLocationPickerMap({ position, setPosition, onChangeCoordinates }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);

  useEffect(() => {
    let active = true;
    void loadGoogleMaps().then((maps) => {
      if (!active || !maps || !containerRef.current) return;
      const initialPos = { lat: Number(position[0]), lng: Number(position[1]) };

      const map = new maps.Map(containerRef.current, {
        center: initialPos,
        zoom: 15,
        mapTypeControl: false,
        streetViewControl: false,
      });
      mapRef.current = map;

      const marker = new maps.Marker({
        position: initialPos,
        map,
        draggable: true,
      });
      markerRef.current = marker;

      map.addListener('click', (e) => {
        const lat = e.latLng.lat();
        const lng = e.latLng.lng();
        marker.setPosition({ lat, lng });
        setPosition([lat, lng]);
        onChangeCoordinates(lat.toFixed(6), lng.toFixed(6));
      });

      marker.addListener('dragend', (e) => {
        const lat = e.latLng.lat();
        const lng = e.latLng.lng();
        setPosition([lat, lng]);
        onChangeCoordinates(lat.toFixed(6), lng.toFixed(6));
      });
    });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (markerRef.current && mapRef.current) {
      const pos = { lat: Number(position[0]), lng: Number(position[1]) };
      markerRef.current.setPosition(pos);
      mapRef.current.panTo(pos);
    }
  }, [position]);

  return <div ref={containerRef} className="h-full w-full" />;
}

export default function LocationPickerMap({ position, setPosition, onChangeCoordinates }) {
  const [useGoogle, setUseGoogle] = useState(() => hasGoogleMapsKey());

  useEffect(() => {
    if (hasGoogleMapsKey()) {
      void loadGoogleMaps().then((maps) => {
        if (!maps) setUseGoogle(false);
      });
    }
  }, []);

  return (
    <div className="relative isolate z-0 my-3 h-72 w-full min-w-0 overflow-hidden rounded-xl border border-slate-300 shadow-sm">
      {useGoogle ? (
        <GoogleLocationPickerMap
          position={position}
          setPosition={setPosition}
          onChangeCoordinates={onChangeCoordinates}
        />
      ) : (
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
      )}
    </div>
  );
}
