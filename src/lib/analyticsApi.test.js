import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ANALYTICS_API_URL,
  getAnalyticsApiUrl,
  getForecastTimeframe,
  getForecastErrorMessage,
} from './analyticsApi.js';

test('analytics API uses the active Render service when no URL is configured', () => {
  assert.equal(getAnalyticsApiUrl(undefined), DEFAULT_ANALYTICS_API_URL);
  assert.equal(getAnalyticsApiUrl('  '), DEFAULT_ANALYTICS_API_URL);
});

test('weekly and annual requests use a timeframe accepted by older forecast services', () => {
  assert.equal(getForecastTimeframe('weekly'), 'custom');
  assert.equal(getForecastTimeframe('annual'), 'custom');
  assert.equal(getForecastTimeframe('last_month'), 'last_month');
});

test('forecast validation errors show useful messages without stringifying objects', () => {
  assert.equal(getForecastErrorMessage([{ loc: ['query', 'timeframe'], msg: 'Invalid value', input: 'private' }], 422), 'Forecast request could not be validated: timeframe: Invalid value');
  assert.equal(getForecastErrorMessage('Service unavailable', 503), 'Service unavailable');
  assert.equal(getForecastErrorMessage({}, 422), 'Forecast service returned 422.');
});

test('analytics API upgrades the retired Render hostname', () => {
  assert.equal(
    getAnalyticsApiUrl('https://shelf-analytics.onrender.com/'),
    DEFAULT_ANALYTICS_API_URL
  );
  assert.equal(
    getAnalyticsApiUrl('https://shelf-analytics.onrender.com/api/'),
    `${DEFAULT_ANALYTICS_API_URL}/api`
  );
});

test('analytics API preserves configured local and custom service URLs', () => {
  assert.equal(
    getAnalyticsApiUrl('http://localhost:8000/'),
    'http://localhost:8000'
  );
  assert.equal(
    getAnalyticsApiUrl('https://analytics.example.com/'),
    'https://analytics.example.com'
  );
});
