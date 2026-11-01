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
  const isGeminiResponse = forecast?.analyticsSource !== 'fallback';

  return {
    insights:
      insights.length > 0
        ? insights
        : [
            hasForecast
              ? 'Gemini did not return analytics insights for this forecast.'
              : 'Run the forecast to request Gemini-generated analytics insights.',
          ],
    recommendations:
      recommendations.length > 0
        ? recommendations
        : [
            hasForecast
              ? 'Gemini did not return recommendations for this forecast. Check the analytics service and Gemini API configuration, then run the forecast again.'
              : 'Gemini-generated recommendations will appear after a forecast completes.',
          ],
    isGeminiResponse,
  };
}
