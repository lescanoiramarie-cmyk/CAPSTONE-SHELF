from datetime import date, timedelta
import os

import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sklearn.linear_model import LinearRegression


class CategorySeries(BaseModel):
    category: str = Field(min_length=1, max_length=120)
    weekly_demand: list[int] = Field(min_length=1, max_length=26)


class ForecastRequest(BaseModel):
    daily_visitors: list[int] = Field(min_length=2, max_length=90)
    categories: list[CategorySeries] = Field(default_factory=list, max_length=30)
    horizon_days: int = Field(default=7, ge=1, le=30)


app = FastAPI(title="SHELF ILMS Analytics", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv("ANALYTICS_ALLOWED_ORIGINS", "http://localhost:5173").split(",")
        if origin.strip()
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


def linear_forecast(values: list[int], horizon: int) -> list[int]:
    frame = pd.DataFrame({"period": range(len(values)), "demand": values})
    model = LinearRegression().fit(frame[["period"]], frame["demand"])
    future = pd.DataFrame({"period": range(len(values), len(values) + horizon)})
    return [max(0, round(value)) for value in model.predict(future[["period"]])]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/forecast")
def forecast(request: ForecastRequest):
    visitor_counts = linear_forecast(request.daily_visitors, request.horizon_days)
    start_date = date.today() + timedelta(days=1)
    visitor_forecasts = [
        {"date": (start_date + timedelta(days=index)).isoformat(), "visitorCount": count}
        for index, count in enumerate(visitor_counts)
    ]

    category_forecasts = []
    for series in request.categories:
        values = linear_forecast(series.weekly_demand, 1)
        category_forecasts.append({"category": series.category, "projectedDemand": values[0]})
    category_forecasts.sort(key=lambda item: item["projectedDemand"], reverse=True)

    recommendations = []
    baseline = sum(request.daily_visitors) / len(request.daily_visitors)
    peak = max(visitor_counts, default=0)
    if baseline > 0 and peak >= baseline * 1.25:
        recommendations.append(
            "Forecast visitor volume peaks at least 25% above the recent daily average; consider additional desk coverage."
        )
    if category_forecasts and category_forecasts[0]["projectedDemand"] > 0:
        top_category = category_forecasts[0]["category"]
        recommendations.append(
            f"Review availability and consider replenishing {top_category}, the category with the highest projected demand."
        )

    return {
        "forecasts": visitor_forecasts,
        "highDemandCategories": category_forecasts,
        "recommendations": recommendations,
    }