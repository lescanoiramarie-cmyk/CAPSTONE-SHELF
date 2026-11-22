const GEOAPIFY_BASE_URL = 'https://api.geoapify.com/v1/geocode';

export function getGeoapifyApiKey() {
  return String(import.meta.env.VITE_GEOAPIFY_API_KEY || '').trim();
}

export async function searchGeoapifyAddresses(query, { limit = 5, signal } = {}) {
  const apiKey = getGeoapifyApiKey();
  if (!apiKey) return [];

  const params = new URLSearchParams({
    text: query,
    format: 'json',
    limit: String(limit),
    filter: 'countrycode:ph',
    apiKey,
  });
  const response = await fetch(`${GEOAPIFY_BASE_URL}/autocomplete?${params}`, { signal });
  if (!response.ok) throw new Error('Geoapify address lookup is temporarily unavailable.');
  const payload = await response.json();
  return Array.isArray(payload.results) ? payload.results : [];
}

export async function geocodeGeoapifyAddress(address, { signal } = {}) {
  const apiKey = getGeoapifyApiKey();
  if (!apiKey) return null;

  const params = new URLSearchParams({
    text: address,
    format: 'json',
    limit: '1',
    filter: 'countrycode:ph',
    apiKey,
  });
  const response = await fetch(`https://api.geoapify.com/v1/geocode/search?${params}`, { signal });
  if (!response.ok) throw new Error('Geoapify address lookup is temporarily unavailable.');
  const payload = await response.json();
  return Array.isArray(payload.results) ? payload.results[0] || null : null;
}

