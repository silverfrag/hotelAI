"""Same context vector at training and inference; no hand-set price uplifts."""
import math

VERSION = "danang-market-conversion-v1"
FEATURES = (
    "offered_price_ratio", "competitor_price_ratio", "rain_probability_pct", "wind_max_kmh",
    "occupancy_ratio", "lead_time", "guest_count", "weekday_sin", "weekday_cos",
    "month_sin", "month_cos", "event_count", "events_extracted",
)


def context_features(request, evidence, analysis, today):
    rates = evidence["comparable_rates"]
    weather = evidence["weather"]
    if weather is None or len(rates) < 2:
        raise ValueError("Need a weather forecast and at least two comparable hotel quotes")
    from statistics import median
    day = request.check_in_date
    return {"competitor_price_ratio": median(r["nightly_price"] for r in rates) / request.base_price,
        "rain_probability_pct": weather["rain_probability_pct"], "wind_max_kmh": weather["wind_max_kmh"],
        "occupancy_ratio": 1 - request.rooms_available / request.rooms_total,
        "lead_time": max(0, (day - today).days), "guest_count": request.guest_count,
        "weekday_sin": math.sin(2 * math.pi * day.weekday() / 7),
        "weekday_cos": math.cos(2 * math.pi * day.weekday() / 7),
        "month_sin": math.sin(2 * math.pi * day.month / 12),
        "month_cos": math.cos(2 * math.pi * day.month / 12),
        "event_count": len(analysis["events"]), "events_extracted": int(analysis["status"] == "extracted")}
