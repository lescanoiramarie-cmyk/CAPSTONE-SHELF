export const DEFAULT_ANALYTICS_API_URL =
  'https://shelf-analytics-q24u.onrender.com';

const LEGACY_ANALYTICS_HOST = 'shelf-analytics.onrender.com';
const CURRENT_ANALYTICS_HOST = 'shelf-analytics-q24u.onrender.com';

export function getAnalyticsApiUrl(configuredUrl) {
  const endpoint = String(configuredUrl ?? '').trim();
  if (!endpoint) return DEFAULT_ANALYTICS_API_URL;

  try {
    const url = new URL(endpoint);
    if (url.hostname.toLowerCase() === LEGACY_ANALYTICS_HOST) {
      url.hostname = CURRENT_ANALYTICS_HOST;
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return endpoint.replace(/\/+$/, '');
  }
}
