// Accept only known service responses and validate every forecast before display.
export function normalizeForecastResult(result, expectedDates, scope) {
  if (!['gemini', 'fallback'].includes(result?.analyticsSource)) {
    throw new Error('Forecast service returned an unrecognized result. Please try again.');
  }
  if (!Array.isArray(result.forecasts) || result.forecasts.length !== expectedDates.length) {
    throw new Error(`Forecast service did not return exactly ${expectedDates.length} daily estimates.`);
  }
  const forecasts = result.forecasts.map((item, index) => {
    const rawCount = item?.visitorCount;
    const count = typeof rawCount === 'number' || (typeof rawCount === 'string' && rawCount.trim())
      ? Number(rawCount)
      : NaN;
    if (item?.date !== expectedDates[index] || !Number.isFinite(count) || count < 0) {
      throw new Error('Forecast service returned invalid dates or visitor counts.');
    }
    return { ...item, visitorCount: count };
  });
  return {
    ...result,
    source: result.analyticsSource,
    scope,
    forecasts,
    // The service's fallback messages are status text, not AI-generated content.
    ...(result.analyticsSource === 'fallback' ? { insights: [], recommendations: [] } : {}),
  };
}
