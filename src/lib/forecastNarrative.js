function normalizeTextList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getForecastNarrative(forecast) {
  const insights = normalizeTextList(forecast?.insights);
  const recommendations = normalizeTextList(forecast?.recommendations);
  const hasForecast = Array.isArray(forecast?.forecasts) && forecast.forecasts.length > 0;

  return {
    insights:
      insights.length > 0
        ? insights
        : [
            hasForecast
              ? 'No analytics insights were returned for this forecast.'
              : 'Run the forecast to generate analytics insights.',
          ],
    recommendations:
      recommendations.length > 0
        ? recommendations
        : [
            hasForecast
              ? 'No recommendations were returned for this forecast. Check the analytics service and run the forecast again.'
              : 'Recommendations will appear after a forecast completes.',
          ],
  };
}
