import assert from 'node:assert/strict';
import test from 'node:test';
import { getForecastNarrative } from './forecastNarrative.js';

test('narrative displays Gemini insights and recommendations without adding local analysis', () => {
  const narrative = getForecastNarrative({
    forecasts: [{ date: '2026-11-02', visitorCount: 12 }],
    insights: ['Gemini insight'],
    recommendations: ['Gemini recommendation'],
    analyticsSource: 'gemini',
  });

  assert.deepEqual(narrative.insights, ['Gemini insight']);
  assert.deepEqual(narrative.recommendations, ['Gemini recommendation']);
  assert.equal(narrative.isGeminiResponse, true);
});

test('narrative shows an explicit status before a forecast is run', () => {
  const narrative = getForecastNarrative(null);

  assert.deepEqual(narrative.insights, [
    'Run the forecast to request Gemini-generated analytics insights.',
  ]);
  assert.deepEqual(narrative.recommendations, [
    'Gemini-generated recommendations will appear after a forecast completes.',
  ]);
});

test('narrative explains missing Gemini output without inventing recommendations', () => {
  const narrative = getForecastNarrative({
    forecasts: [{ date: '2026-11-02', visitorCount: 4 }],
    insights: [],
    recommendations: [],
    analyticsSource: 'gemini',
  });

  assert.ok(narrative.insights[0].includes('Gemini did not return'));
  assert.ok(narrative.recommendations[0].includes('Check the analytics service'));
  assert.equal(narrative.isGeminiResponse, true);
});

test('narrative identifies analytics-service fallback separately from Gemini output', () => {
  const narrative = getForecastNarrative({
    forecasts: [{ date: '2026-11-02', visitorCount: 4 }],
    insights: ['Gemini insights are unavailable.'],
    recommendations: ['Check Gemini API configuration and rerun.'],
    analyticsSource: 'fallback',
  });

  assert.deepEqual(narrative.insights, ['Gemini insights are unavailable.']);
  assert.deepEqual(narrative.recommendations, [
    'Check Gemini API configuration and rerun.',
  ]);
  assert.equal(narrative.isGeminiResponse, false);
});
