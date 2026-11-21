import { useEffect, useRef, useState } from 'react';
import { hasGoogleMapsKey, loadGoogleMaps } from '../lib/googleMaps.js';

/** Google Places address selector with a normal text-input fallback when Maps is not configured. */
export default function GooglePlaceAddressInput({
  value,
  onChange,
  onPlaceSelected,
  onBlur,
  placeholder = 'Search for a library address in the Philippines',
  className = '',
  required = false,
}) {
  const hostRef = useRef(null);
  const elementRef = useRef(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onPlaceSelectedRef = useRef(onPlaceSelected);
  const [ready, setReady] = useState(false);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onPlaceSelectedRef.current = onPlaceSelected; }, [onPlaceSelected]);
  valueRef.current = value;

  useEffect(() => {
    let active = true;
    if (!hasGoogleMapsKey()) return undefined;

    void loadGoogleMaps().then(async (maps) => {
      if (!active || !maps?.importLibrary || !hostRef.current) return;
      try {
        const places = await maps.importLibrary('places');
        if (!active || !places?.PlaceAutocompleteElement || !hostRef.current) return;

        const autocomplete = new places.PlaceAutocompleteElement({ includedRegionCodes: ['ph'] });
        autocomplete.placeholder = placeholder;
        autocomplete.value = valueRef.current || '';
        autocomplete.style.display = 'block';
        autocomplete.style.width = '100%';
        autocomplete.style.minHeight = '42px';
        autocomplete.style.border = '1px solid #cbd5e1';
        autocomplete.style.borderRadius = '0.5rem';
        autocomplete.style.fontFamily = 'inherit';
        autocomplete.style.fontSize = '14px';
        autocomplete.style.colorScheme = 'light';
        autocomplete.required = required;
        autocomplete.setAttribute('aria-label', 'Library address');

        const handleInput = () => onChangeRef.current?.(autocomplete.value || '');
        const handleSelection = async (event) => {
          try {
            const place = event.placePrediction?.toPlace();
            if (!place) return;
            await place.fetchFields({ fields: ['formattedAddress', 'location'] });
            const address = place.formattedAddress || autocomplete.value || '';
            const location = place.location;
            autocomplete.value = address;
            onChangeRef.current?.(address);
            if (location) {
              onPlaceSelectedRef.current?.({
                address,
                lat: location.lat(),
                lng: location.lng(),
              });
            }
          } catch (error) {
            console.error('Google Places selection failed:', error);
          }
        };

        autocomplete.addEventListener('input', handleInput);
        autocomplete.addEventListener('gmp-select', handleSelection);
        hostRef.current.replaceChildren(autocomplete);
        elementRef.current = autocomplete;
        setReady(true);
      } catch (error) {
        console.warn('Google Places autocomplete is unavailable.', error);
      }
    });

    return () => {
      active = false;
      if (elementRef.current) {
        elementRef.current.remove();
        elementRef.current = null;
      }
    };
  }, [placeholder, required]);

  useEffect(() => {
    if (elementRef.current && elementRef.current.value !== (value || '')) {
      elementRef.current.value = value || '';
    }
  }, [value]);

  return (
    <div className="w-full" onBlur={onBlur}>
      {!ready && (
        <input
          type="text"
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          placeholder={placeholder}
          className={className}
          required={required}
        />
      )}
      <div ref={hostRef} className="w-full" style={{ display: ready ? 'block' : 'none' }} />
    </div>
  );
}
