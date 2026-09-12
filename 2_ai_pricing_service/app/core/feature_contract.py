from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Final

FEATURE_CONTRACT_VERSION: Final = "2.0.0"
FEATURE_ORDER: Final[tuple[str, ...]] = (
    "lead_time",
    "arrival_month_sin",
    "arrival_month_cos",
    "arrival_weekday_sin",
    "arrival_weekday_cos",
    "stay_nights",
    "weekend_nights",
    "weekend_share",
    "guest_count",
)

# The Hotel Booking Demand dataset defines weekend nights as Saturday or Sunday.
# A stay occupies check-in (inclusive) through check-out (exclusive), so the
# indicator is true when at least one occupied night starts on either day.
WEEKEND_WEEKDAYS: Final[frozenset[int]] = frozenset({5, 6})
WEEKEND_DEFINITION: Final = (
    "1 when at least one occupied night in [check_in_date, check_out_date) "
    "starts on Saturday or Sunday; otherwise 0"
)


def stay_includes_weekend_night(check_in: date, check_out: date) -> int:
    """Return the model's weekend indicator for a complete stay."""
    return int(count_weekend_nights(check_in, check_out) > 0)


def count_stay_nights(check_in: date, check_out: date) -> int:
    """Return occupied nights for the check-in-inclusive stay interval."""
    nights = (check_out - check_in).days
    if nights <= 0:
        raise ValueError("check_out must be after check_in")
    return nights


def count_weekend_nights(check_in: date, check_out: date) -> int:
    """Count occupied Saturday/Sunday nights without iterating long stays."""
    nights = count_stay_nights(check_in, check_out)
    complete_weeks, remaining_nights = divmod(nights, 7)
    weekend_nights = complete_weeks * len(WEEKEND_WEEKDAYS)
    weekend_nights += sum(
        (check_in + timedelta(days=offset)).weekday() in WEEKEND_WEEKDAYS
        for offset in range(remaining_nights)
    )
    return weekend_nights


def cyclic_components(position: int, period: int) -> tuple[float, float]:
    """Encode a zero-based cyclic position with stable numeric precision."""
    if period <= 0 or not 0 <= position < period:
        raise ValueError("cyclic position must be inside its period")
    angle = 2 * math.pi * position / period
    return round(math.sin(angle), 10), round(math.cos(angle), 10)


def weekend_night_count_to_indicator(stays_in_weekend_nights: int | float) -> int:
    """Map the training dataset's weekend-night count to the serving feature."""
    if stays_in_weekend_nights < 0:
        raise ValueError("stays_in_weekend_nights cannot be negative")
    return int(stays_in_weekend_nights > 0)


def build_pricing_features(
    *,
    lead_time: int,
    check_in: date,
    check_out: date,
    guest_count: int,
) -> dict[str, int | float]:
    """Build the only supported train/serve feature vector in model order."""
    if lead_time < 0:
        raise ValueError("lead_time cannot be negative")
    if guest_count <= 0:
        raise ValueError("guest_count must be positive")

    stay_nights = count_stay_nights(check_in, check_out)
    weekend_nights = count_weekend_nights(check_in, check_out)
    month_sin, month_cos = cyclic_components(check_in.month - 1, 12)
    weekday_sin, weekday_cos = cyclic_components(check_in.weekday(), 7)
    return {
        "lead_time": lead_time,
        "arrival_month_sin": month_sin,
        "arrival_month_cos": month_cos,
        "arrival_weekday_sin": weekday_sin,
        "arrival_weekday_cos": weekday_cos,
        "stay_nights": stay_nights,
        "weekend_nights": weekend_nights,
        "weekend_share": round(weekend_nights / stay_nights, 10),
        "guest_count": guest_count,
    }


def feature_contract_metadata() -> dict[str, object]:
    return {
        "version": FEATURE_CONTRACT_VERSION,
        "feature_order": list(FEATURE_ORDER),
        "weekend_definition": WEEKEND_DEFINITION,
        "stay_interval": "check-in inclusive, check-out exclusive",
        "weekend_days": ["Saturday", "Sunday"],
        "cyclic_encoding": "sin/cos with month zero-based over 12 and Monday zero-based over 7",
        "target_reference": "ADR divided by the training median ADR of reserved room type",
        "excluded_user_controlled_features": ["total_of_special_requests"],
    }
