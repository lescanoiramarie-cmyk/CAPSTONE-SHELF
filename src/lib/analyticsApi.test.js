import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ANALYTICS_API_URL,
  getAnalyticsApiUrl,
} from './analyticsApi.js';

test('analytics API uses the active Render service when no URL is configured', () => {
  assert.equal(getAnalyticsApiUrl(undefined), DEFAULT_ANALYTICS_API_URL);
  assert.equal(getAnalyticsApiUrl('  '), DEFAULT_ANALYTICS_API_URL);
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
