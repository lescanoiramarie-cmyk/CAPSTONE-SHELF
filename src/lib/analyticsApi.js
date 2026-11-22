export const DEFAULT_ANALYTICS_API_URL =
  'https://shelf-analytics-q24u.onrender.com';

const LEGACY_ANALYTICS_HOST = 'shelf-analytics.onrender.com';
const RETIRED_ANALYTICS_HOST = 'capstone-shelf.onrender.com';
const CURRENT_ANALYTICS_HOST = 'shelf-analytics-q24u.onrender.com';

// Older deployed services accept custom date ranges but not the newer view names.
export function getForecastTimeframe(timeframe) {
  return timeframe === 'weekly' || timeframe === 'annual' ? 'custom' : timeframe;
}

export function getForecastErrorMessage(detail, status) {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail.map((item) => {
      if (typeof item?.msg !== 'string') return '';
      const field = Array.isArray(item.loc) ? item.loc.slice(1).join('.') : '';
      return field ? `${field}: ${item.msg}` : item.msg;
    }).filter(Boolean);
    if (messages.length) return `Forecast request could not be validated: ${messages.join('; ')}`;
  }
  return `Forecast service returned ${status}.`;
}

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
