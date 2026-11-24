import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeForecastResult } from './forecastResult.js';

const dates = ['2026-11-25', '2026-11-26'];
const forecasts = [{ date: dates[0], visitorCount: 2 }, { date: dates[1], visitorCount: '3' }];

test('Gemini results retain the insights and normalized forecast', () => {
  const result = normalizeForecastResult({ analyticsSource: 'gemini', forecasts, insights: ['Pattern'], recommendations: ['Action'] }, dates, 'branch');
  assert.deepEqual(result.forecasts.map((row) => row.visitorCount), [2, 3]);
  assert.deepEqual(result.insights, ['Pattern']);
  assert.deepEqual(result.recommendations, ['Action']);
  assert.equal(result.scope, 'branch');
});

test('fallback keeps numeric forecast without presenting status text as AI output', () => {
  const result = normalizeForecastResult({ analyticsSource: 'fallback', forecasts, insights: ['Unavailable'], recommendations: ['Check quota'] }, dates, 'branch');
  assert.equal(result.source, 'fallback');
  assert.deepEqual(result.forecasts.map((row) => row.visitorCount), [2, 3]);
  assert.deepEqual(result.insights, []);
  assert.deepEqual(result.recommendations, []);
});

test('unknown sources, missing dates and invalid counts are rejected', () => {
  assert.throws(() => normalizeForecastResult({ analyticsSource: 'other', forecasts }, dates, ''), /unrecognized/);
  assert.throws(() => normalizeForecastResult({ analyticsSource: 'fallback', forecasts: [] }, dates, ''), /exactly 2/);
  for (const invalid of [-1, null, '', 'NaN']) {
    assert.throws(() => normalizeForecastResult({ analyticsSource: 'fallback', forecasts: [{ date: dates[0], visitorCount: invalid }, forecasts[1]] }, dates, ''), /invalid/);
  }
  assert.throws(() => normalizeForecastResult({ analyticsSource: 'fallback', forecasts }, ['2026-01-01', dates[1]], ''), /invalid/);
});
