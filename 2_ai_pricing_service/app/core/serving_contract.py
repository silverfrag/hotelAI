"""Released quote contract, independent from experimental training features.

The V3 artifact remains a research experiment: its demand inputs are synthetic,
its scarcity definition differs between training and serving, and it has not
outperformed V2 or been evaluated on observed Vietnamese demand.
"""
from datetime import date

from app.core.feature_contract import count_stay_nights, count_weekend_nights, cyclic_components

SERVING_CONTRACT_VERSION = "2.0.0"
SERVING_FEATURE_ORDER = (
    "lead_time", "arrival_month_sin", "arrival_month_cos",
    "arrival_weekday_sin", "arrival_weekday_cos", "stay_nights",
    "weekend_nights", "weekend_share", "guest_count",
)


def build_serving_features(
    *, lead_time: int, check_in: date, check_out: date, guest_count: int,
) -> dict[str, int | float]:
    if lead_time < 0 or guest_count <= 0:
        raise ValueError("lead_time must be nonnegative and guest_count positive")
    nights = count_stay_nights(check_in, check_out)
    weekends = count_weekend_nights(check_in, check_out)
    month_sin, month_cos = cyclic_components(check_in.month - 1, 12)
    weekday_sin, weekday_cos = cyclic_components(check_in.weekday(), 7)
    return {
        "lead_time": lead_time,
        "arrival_month_sin": month_sin, "arrival_month_cos": month_cos,
        "arrival_weekday_sin": weekday_sin, "arrival_weekday_cos": weekday_cos,
        "stay_nights": nights, "weekend_nights": weekends,
        "weekend_share": round(weekends / nights, 10), "guest_count": guest_count,
    }
