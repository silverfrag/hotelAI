from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Final

# v3.0.0 — adds real-time demand signals: occupancy_ratio, booking_velocity_score,
# demand_pressure_score, availability_tightness, price_vs_market_ratio.
# These features are what makes the model behave as actual AI: it must learn the
# *relationship* between demand pressure and optimal price, rather than a
# lookup table of date-based rules.
FEATURE_CONTRACT_VERSION: Final = "3.0.0"
FEATURE_ORDER: Final[tuple[str, ...]] = (
    # ── Temporal features (date context) ──────────────────────────────────
    "lead_time",
    "arrival_month_sin",
    "arrival_month_cos",
    "arrival_weekday_sin",
    "arrival_weekday_cos",
    "stay_nights",
    "weekend_nights",
    "weekend_share",
    "guest_count",
    # ── Demand signals (real-time market context) ─────────────────────────
    # These features are absent from a script-based price filter:
    # a rule cannot know "how full are we right now?" without a database.
    "occupancy_ratio",          # % of rooms booked — the single strongest signal
    "booking_velocity_score",   # is demand arriving faster than usual?
    "demand_pressure_score",    # composite: occupancy × velocity
    "availability_tightness",   # scarcity pressure (last-room effects)
    "price_vs_market_ratio",    # is offered price above/below recent average?
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
    # ── Demand signals (required in v3.0.0) ──────────────────────────────
    occupancy_ratio: float = 0.65,
    booking_velocity_score: float = 0.50,
    demand_pressure_score: float | None = None,
    availability_tightness: float | None = None,
    price_vs_market_ratio: float = 1.0,
) -> dict[str, int | float]:
    """Build the versioned train/serve feature vector in model order.

    v3.0.0 — demand signals are required for live serving.  Default values
    are provided for backward compatibility during the transition period and
    represent a neutral/average market state.  Production callers should
    always supply real-time values.

    Parameters
    ----------
    occupancy_ratio:
        Fraction of sellable rooms booked for the target period [0.0, 1.0].
        *This is the single most important feature for dynamic pricing.*
    booking_velocity_score:
        Normalised booking pace vs historical average [0.0, 1.0].
        0.5 = on-trend; >0.5 = demand is accelerating.
    demand_pressure_score:
        Pre-computed composite of occupancy + velocity [0.0, 1.0].
        If ``None``, computed from occupancy and velocity using the
        canonical weights from :mod:`app.core.demand_features`.
    availability_tightness:
        Scarcity measure [0.0, 1.0].  If ``None``, set to
        ``1.0 - occupancy_ratio`` as a conservative approximation.
    price_vs_market_ratio:
        Offered price / trailing-30d average for this room type.
        Pass ``1.0`` when trailing history is unavailable.
    """
    if lead_time < 0:
        raise ValueError("lead_time cannot be negative")
    if guest_count <= 0:
        raise ValueError("guest_count must be positive")
    if not 0.0 <= occupancy_ratio <= 1.0:
        raise ValueError("occupancy_ratio must be in [0.0, 1.0]")
    if not 0.0 <= booking_velocity_score <= 1.0:
        raise ValueError("booking_velocity_score must be in [0.0, 1.0]")
    if not math.isfinite(price_vs_market_ratio) or price_vs_market_ratio <= 0:
        raise ValueError("price_vs_market_ratio must be a positive finite number")

    # Compute derived demand signals when not provided
    if demand_pressure_score is None:
        from app.core.demand_features import compute_demand_pressure_score
        demand_pressure_score = compute_demand_pressure_score(
            occupancy_ratio=occupancy_ratio,
            booking_velocity_score=booking_velocity_score,
        )
    if availability_tightness is None:
        availability_tightness = round(1.0 - occupancy_ratio, 10)

    if not 0.0 <= demand_pressure_score <= 1.0:
        raise ValueError("demand_pressure_score must be in [0.0, 1.0]")
    if not 0.0 <= availability_tightness <= 1.0:
        raise ValueError("availability_tightness must be in [0.0, 1.0]")

    stay_nights = count_stay_nights(check_in, check_out)
    weekend_nights = count_weekend_nights(check_in, check_out)
    month_sin, month_cos = cyclic_components(check_in.month - 1, 12)
    weekday_sin, weekday_cos = cyclic_components(check_in.weekday(), 7)
    return {
        # Temporal
        "lead_time": lead_time,
        "arrival_month_sin": month_sin,
        "arrival_month_cos": month_cos,
        "arrival_weekday_sin": weekday_sin,
        "arrival_weekday_cos": weekday_cos,
        "stay_nights": stay_nights,
        "weekend_nights": weekend_nights,
        "weekend_share": round(weekend_nights / stay_nights, 10),
        "guest_count": guest_count,
        # Demand signals — the AI-differentiating features
        "occupancy_ratio": round(occupancy_ratio, 10),
        "booking_velocity_score": round(booking_velocity_score, 10),
        "demand_pressure_score": round(demand_pressure_score, 10),
        "availability_tightness": round(availability_tightness, 10),
        "price_vs_market_ratio": round(price_vs_market_ratio, 10),
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
        "demand_signals": {
            "version": "1.0.0",
            "description": (
                "Real-time demand context features added in v3.0.0. "
                "These require live inventory and booking-log data at serving time. "
                "Defaults represent a neutral mid-season, on-trend market state."
            ),
            "features": [
                "occupancy_ratio",
                "booking_velocity_score",
                "demand_pressure_score",
                "availability_tightness",
                "price_vs_market_ratio",
            ],
        },
    }
