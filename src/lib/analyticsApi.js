export const DEFAULT_ANALYTICS_API_URL =
  'https://shelf-analytics-q24u.onrender.com';

const LEGACY_ANALYTICS_HOST = 'shelf-analytics.onrender.com';
const RETIRED_ANALYTICS_HOST = 'capstone-shelf.onrender.com';
const CURRENT_ANALYTICS_HOST = 'shelf-analytics-q24u.onrender.com';

export function getAnalyticsApiUrl(configuredUrl) {
  const endpoint = String(configuredUrl ?? '').trim();
  if (!endpoint) return DEFAULT_ANALYTICS_API_URL;

  try {
    const url = new URL(endpoint);
    if ([LEGACY_ANALYTICS_HOST, RETIRED_ANALYTICS_HOST].includes(url.hostname.toLowerCase())) {
      url.hostname = CURRENT_ANALYTICS_HOST;
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return endpoint.replace(/\/+$/, '');
  }
}
