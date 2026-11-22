import { useEffect, useRef, useState } from 'react';
import { getGeoapifyApiKey, searchGeoapifyAddresses } from '../lib/geoapify.js';

/** Address field with Geoapify place suggestions when a key is configured. */
export default function GeoapifyAddressInput({
  value,
  onChange,
  onPlaceSelected,
  onBlur,
  placeholder = 'Search for a library address in the Philippines',
  className = '',
  required = false,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const requestRef = useRef(null);
  const hasKey = Boolean(getGeoapifyApiKey());

  useEffect(() => {
    const query = String(value || '').trim();
    if (!hasKey || query.length < 4) {
      setSuggestions([]);
      setOpen(false);
      return undefined;
    }

    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const results = await searchGeoapifyAddresses(query, { signal: controller.signal });
        setSuggestions(results.filter((result) => Number.isFinite(Number(result.lat)) && Number.isFinite(Number(result.lon))));
        setOpen(true);
      } catch (error) {
        if (error.name !== 'AbortError') setSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [hasKey, value]);

  const chooseSuggestion = (result) => {
    const address = result.formatted || result.address_line1 || result.name || value;
    setSuggestions([]);
    setOpen(false);
    onChange?.(address);
    onPlaceSelected?.({ address, lat: Number(result.lat), lng: Number(result.lon) });
  };

  return (
    <div className="relative w-full">
      <input
        type="text"
        value={value || ''}
        onChange={(event) => onChange?.(event.target.value)}
        onFocus={() => { if (suggestions.length) setOpen(true); }}
        onBlur={(event) => {
          window.setTimeout(() => setOpen(false), 120);
          onBlur?.(event);
        }}
        placeholder={placeholder}
        className={className}
        required={required}
        autoComplete="street-address"
        aria-autocomplete={hasKey ? 'list' : undefined}
        aria-expanded={hasKey ? open : undefined}
      />
      {hasKey && open && (loading || suggestions.length > 0) && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-xl" role="listbox">
          {loading && <div className="px-3 py-2 text-slate-500">Searching addresses…</div>}
          {suggestions.map((result, index) => (
            <button
              key={`${result.place_id || result.lon}-${index}`}
              type="button"
              role="option"
              aria-selected="false"
              className="block w-full px-3 py-2 text-left text-slate-800 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseSuggestion(result)}
            >
              {result.formatted || result.address_line1 || result.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
