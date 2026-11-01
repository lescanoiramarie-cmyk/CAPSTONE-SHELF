import assert from 'node:assert/strict';
import test from 'node:test';
import { getForecastNarrative } from './forecastNarrative.js';

test('narrative displays returned insights and recommendations', () => {
  const narrative = getForecastNarrative({
    forecasts: [{ date: '2026-11-02', visitorCount: 12 }],
    insights: ['Visitor activity is increasing.'],
    recommendations: ['Consider additional staffing.'],
    analyticsSource: 'gemini',
  });

  assert.deepEqual(narrative.insights, ['Visitor activity is increasing.']);
  assert.deepEqual(narrative.recommendations, ['Consider additional staffing.']);
  assert.equal('isGeminiResponse' in narrative, false);
});

test('narrative shows neutral status before a forecast is run', () => {
  const narrative = getForecastNarrative(null);

  assert.deepEqual(narrative.insights, [
    'Run the forecast to generate analytics insights.',
  ]);
  assert.deepEqual(narrative.recommendations, [
    'Recommendations will appear after a forecast completes.',
  ]);
});

test('narrative reports missing insights and recommendations neutrally', () => {
  const narrative = getForecastNarrative({
    forecasts: [{ date: '2026-11-02', visitorCount: 4 }],
    insights: [],
    recommendations: [],
    analyticsSource: 'fallback',
  });

  assert.deepEqual(narrative.insights, [
    'No analytics insights were returned for this forecast.',
  ]);
  assert.deepEqual(narrative.recommendations, [
    'No recommendations were returned for this forecast. Check the analytics service and run the forecast again.',
  ]);
  assert.doesNotMatch(
    JSON.stringify(narrative).toLowerCase(),
    /gemini/
  );
});
