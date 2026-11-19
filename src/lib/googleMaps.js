/**
 * Safe Google Maps Platform API loader for SHELF ILMS.
 * Dynamically loads Google Maps JS API when VITE_GOOGLE_MAPS_API_KEY is configured,
 * with seamless fallback when unavailable or offline.
 */

let googleMapsPromise = null;

export function loadGoogleMaps(apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY) {
  if (!apiKey || typeof window === 'undefined') return Promise.resolve(null);
  if (window.google?.maps) return Promise.resolve(window.google.maps);

  if (!googleMapsPromise) {
    googleMapsPromise = new Promise((resolve) => {
      const scriptId = 'shelf-google-maps-script';
      if (document.getElementById(scriptId)) {
        const interval = setInterval(() => {
          if (window.google?.maps) {
            clearInterval(interval);
            resolve(window.google.maps);
          }
        }, 100);
        return;
      }
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places,marker`;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(window.google?.maps || null);
      script.onerror = (err) => {
        console.warn('Google Maps API failed to load; using map fallback.', err);
        resolve(null);
      };
      document.head.appendChild(script);
    });
  }
  return googleMapsPromise;
}

export function hasGoogleMapsKey() {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return Boolean(key && String(key).trim() && String(key) !== 'undefined' && String(key) !== 'null');
}
