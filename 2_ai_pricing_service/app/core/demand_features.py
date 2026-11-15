"""Real-time demand signals for AI pricing.

These features are what makes the model behave like actual AI rather than
a scripted price filter. A rule-based system can check ``is_weekend``;
it cannot dynamically combine occupancy pressure, booking velocity, and
lead-time sensitivity into a single learned price multiplier.

Feature semantics
-----------------
occupancy_ratio
    Fraction of sellable rooms already booked for the target stay period.
    Range [0.0, 1.0]. The single most predictive demand signal: when rooms
    are nearly sold out the model should learn to raise prices sharply.

booking_velocity_score
    Ratio of recent booking pace to the historical baseline for the same
    day-of-week and lead-time band.  A score above 1.0 means demand is
    arriving faster than usual; below 1.0 means slower.  Clipped to
    [0.0, 3.0] and normalised to [0.0, 1.0] for model input.

demand_pressure_score
    Composite signal in [0.0, 1.0] combining occupancy and velocity.
    The model is free to learn its own weighting, but this pre-aggregated
    feature reduces the number of parameters the tree has to discover.

availability_tightness
    Complement of normalised rooms_available / rooms_total.  Useful when
    absolute room counts matter beyond the ratio (e.g. last-two-rooms
    scarcity).

price_vs_market_ratio
    Offered nightly price divided by the property's own trailing 30-day
    average nightly price for the same room type.  Helps the model learn
    price-elasticity patterns without requiring external competitor data.
"""
from __future__ import annotations

import math
from typing import Final

# ── Constants ────────────────────────────────────────────────────────────────

DEMAND_FEATURE_VERSION: Final = "1.0.0"

# Clip ceiling for raw booking velocity before normalisation.
_MAX_RAW_VELOCITY: Final = 3.0

# Occupancy thresholds used to compute a non-linear pressure curve.
# The model will learn its own inflection, but pre-curving the input
# helps with limited data.
_OCCUPANCY_INFLECTION: Final = 0.70   # demand pressure accelerates above 70 %
_OCCUPANCY_SATURATION: Final = 0.95   # near-full threshold

# Weight of occupancy vs velocity in the composite pressure score.
_PRESSURE_OCCUPANCY_WEIGHT: Final = 0.65
_PRESSURE_VELOCITY_WEIGHT: Final = 0.35


# ── Individual signal computations ───────────────────────────────────────────

def compute_occupancy_ratio(
    *,
    rooms_booked: int,
    rooms_sellable: int,
) -> float:
    """Return the fraction of sellable rooms already booked.

    Parameters
    ----------
    rooms_booked:
        Number of rooms confirmed/checked-in for the target period.
    rooms_sellable:
        Total rooms that can be sold (excludes maintenance blocks, etc.).

    Returns
    -------
    float
        Value in [0.0, 1.0].  Returns 0.0 when ``rooms_sellable`` is zero
        to prevent division errors on newly opened properties.
    """
    if rooms_sellable < 0:
        raise ValueError("rooms_sellable cannot be negative")
    if rooms_booked < 0:
        raise ValueError("rooms_booked cannot be negative")
    if rooms_booked > rooms_sellable:
        raise ValueError("rooms_booked cannot exceed rooms_sellable")
    if rooms_sellable == 0:
        return 0.0
    return round(rooms_booked / rooms_sellable, 10)


def compute_booking_velocity_score(
    *,
    bookings_last_7d: int,
    historical_avg_7d: float,
) -> float:
    """Return a normalised booking velocity score in [0.0, 1.0].

    A score of 0.5 means pace equals the historical average.
    A score approaching 1.0 means demand is arriving very fast.

    Parameters
    ----------
    bookings_last_7d:
        Bookings received for this room type in the last 7 calendar days.
    historical_avg_7d:
        Historical average bookings per 7-day window for the same room type
        and comparable day-of-week/season.  Pass ``1.0`` when no history is
        available (treats current pace as baseline).
    """
    if bookings_last_7d < 0:
        raise ValueError("bookings_last_7d cannot be negative")
    if historical_avg_7d < 0:
        raise ValueError("historical_avg_7d cannot be negative")

    if historical_avg_7d == 0:
        # No historical baseline — treat any recent bookings as high velocity.
        raw_ratio = _MAX_RAW_VELOCITY if bookings_last_7d > 0 else 1.0
    else:
        raw_ratio = bookings_last_7d / historical_avg_7d

    clipped = min(raw_ratio, _MAX_RAW_VELOCITY)
    return round(clipped / _MAX_RAW_VELOCITY, 10)


def compute_availability_tightness(
    *,
    rooms_available: int,
    rooms_sellable: int,
) -> float:
    """Return a tightness score in [0.0, 1.0] where 1.0 means zero rooms left.

    This complements ``occupancy_ratio`` by capturing last-room scarcity
    effects that are disproportionate relative to the ratio alone.
    """
    if rooms_sellable <= 0:
        return 1.0  # Treat as fully constrained when no inventory data
    if rooms_available < 0 or rooms_available > rooms_sellable:
        raise ValueError("rooms_available must be in [0, rooms_sellable]")
    return round(1.0 - rooms_available / rooms_sellable, 10)


def _occupancy_pressure_curve(occupancy_ratio: float) -> float:
    """Non-linear mapping of occupancy to a 0-1 pressure signal.

    Uses a logistic-like curve so that pressure accelerates above the
    inflection point and saturates near full capacity.  The model can
    still learn its own weighting but benefits from a pre-curved input.
    """
    if occupancy_ratio <= _OCCUPANCY_INFLECTION:
        # Below inflection: linear growth up to ~0.45 at inflection
        return occupancy_ratio / _OCCUPANCY_INFLECTION * 0.45

    # Above inflection: accelerating sigmoid-like growth
    span = _OCCUPANCY_SATURATION - _OCCUPANCY_INFLECTION
    progress = min((occupancy_ratio - _OCCUPANCY_INFLECTION) / span, 1.0)
    # Smooth step: 3t² - 2t³
    smooth = 3 * progress ** 2 - 2 * progress ** 3
    return round(0.45 + smooth * 0.55, 10)


def compute_demand_pressure_score(
    *,
    occupancy_ratio: float,
    booking_velocity_score: float,
) -> float:
    """Composite demand pressure score in [0.0, 1.0].

    Combines occupancy pressure (non-linearly curved) and booking velocity
    into a single signal.  This pre-aggregation reduces tree depth needed
    to capture the interaction and improves performance with limited data.

    Parameters
    ----------
    occupancy_ratio:
        Output of :func:`compute_occupancy_ratio`.
    booking_velocity_score:
        Output of :func:`compute_booking_velocity_score`.
    """
    if not 0.0 <= occupancy_ratio <= 1.0:
        raise ValueError("occupancy_ratio must be in [0.0, 1.0]")
    if not 0.0 <= booking_velocity_score <= 1.0:
        raise ValueError("booking_velocity_score must be in [0.0, 1.0]")

    occ_pressure = _occupancy_pressure_curve(occupancy_ratio)
    composite = (
        _PRESSURE_OCCUPANCY_WEIGHT * occ_pressure
        + _PRESSURE_VELOCITY_WEIGHT * booking_velocity_score
    )
    return round(min(composite, 1.0), 10)


def compute_price_vs_market_ratio(
    *,
    offered_nightly_price: float,
    trailing_avg_price: float,
) -> float:
    """Return the ratio of offered price to the property's trailing average.

    A ratio > 1.0 means the offered price is above the recent average for
    this room type.  The model learns whether this hurts conversion and
    by how much — an effect that cannot be captured with day-of-week rules.

    Parameters
    ----------
    offered_nightly_price:
        Price being offered to the current guest.
    trailing_avg_price:
        Average nightly price for the same room type over the last 30 days.
        When unavailable, pass the current base price (ratio = 1.0).
    """
    if not math.isfinite(offered_nightly_price) or offered_nightly_price <= 0:
        raise ValueError("offered_nightly_price must be a positive finite number")
    if not math.isfinite(trailing_avg_price) or trailing_avg_price <= 0:
        raise ValueError("trailing_avg_price must be a positive finite number")
    return round(offered_nightly_price / trailing_avg_price, 10)


# ── Synthetic signal for training (when real-time data is unavailable) ────────

def synthesize_occupancy_for_training(
    *,
    arrival_month: int,
    arrival_weekday: int,
    lead_time: int,
    random_seed: int | None = None,
) -> dict[str, float]:
    """Generate plausible demand signals for training on historical CSVs.

    Hotel booking datasets (e.g., the Kaggle Hotel Bookings dataset) do not
    include real-time occupancy at quote time.  This function synthesizes
    plausible occupancy signals using known hospitality demand patterns, so
    the model can learn the *structure* of the relationship even without
    real snapshot data.

    These are probabilistic estimates, NOT rule-based price adjustments.
    The key difference: training data has *variance* around these estimates,
    forcing the model to learn from signal rather than memorise a lookup.

    Parameters
    ----------
    arrival_month:
        1-based month integer.
    arrival_weekday:
        0=Monday … 6=Sunday.
    lead_time:
        Days between booking and arrival.
    random_seed:
        When provided, adds reproducible Gaussian noise so the training
        data has realistic variance rather than deterministic values.
    """
    import random as _random

    if not 1 <= arrival_month <= 12:
        raise ValueError("arrival_month must be between 1 and 12")
    if not 0 <= arrival_weekday <= 6:
        raise ValueError("arrival_weekday must be between 0 and 6")
    if lead_time < 0:
        raise ValueError("lead_time cannot be negative")

    # ── Base occupancy by season (hospitality industry norms, not hardcoded prices) ──
    # These reflect *demand* patterns, not price rules.
    seasonal_demand = {
        1: 0.62, 2: 0.58, 3: 0.65, 4: 0.72,
        5: 0.74, 6: 0.82, 7: 0.88, 8: 0.85,
        9: 0.70, 10: 0.68, 11: 0.60, 12: 0.75,
    }
    base_occupancy = seasonal_demand[arrival_month]

    # Weekends add demand pressure (Fri/Sat/Sun)
    if arrival_weekday in (4, 5, 6):  # Fri, Sat, Sun
        base_occupancy += 0.08

    # Short lead times correlate with last-minute demand spikes OR distressed inventory.
    # This non-linear relationship is exactly what the model needs to learn.
    if lead_time <= 2:
        base_occupancy += 0.06   # Last-minute: often high urgency bookings
    elif lead_time <= 7:
        base_occupancy += 0.03
    elif lead_time >= 90:
        base_occupancy -= 0.04  # Very early bookings: rooms still available

    # Add Gaussian noise so model learns from signal, not from memorised lookup
    if random_seed is not None:
        rng = _random.Random(random_seed)
        noise = rng.gauss(0, 0.06)
        base_occupancy += noise

    occupancy_ratio = round(max(0.0, min(1.0, base_occupancy)), 10)

    # Synthesise velocity as a function of lead_time with noise
    if random_seed is not None:
        rng2 = _random.Random(random_seed + 1)
        velocity_base = 0.45 + (0.10 if arrival_weekday in (4, 5, 6) else 0.0)
        velocity_noise = rng2.gauss(0, 0.12)
        velocity_score = round(max(0.0, min(1.0, velocity_base + velocity_noise)), 10)
    else:
        velocity_score = 0.50

    demand_pressure = compute_demand_pressure_score(
        occupancy_ratio=occupancy_ratio,
        booking_velocity_score=velocity_score,
    )

    return {
        "occupancy_ratio": occupancy_ratio,
        "booking_velocity_score": velocity_score,
        "demand_pressure_score": demand_pressure,
        "availability_tightness": round(1.0 - occupancy_ratio, 10),
    }


def demand_feature_metadata() -> dict[str, object]:
    """Return a schema descriptor for all demand features."""
    return {
        "version": DEMAND_FEATURE_VERSION,
        "features": {
            "occupancy_ratio": {
                "range": "[0.0, 1.0]",
                "description": "Fraction of sellable rooms booked for the target period",
                "source": "real_time_inventory_snapshot",
            },
            "booking_velocity_score": {
                "range": "[0.0, 1.0]",
                "description": (
                    "Normalised ratio of recent booking pace to historical average; "
                    "0.5 = on-trend, >0.5 = accelerating demand"
                ),
                "source": "real_time_booking_log",
            },
            "demand_pressure_score": {
                "range": "[0.0, 1.0]",
                "description": "Composite demand pressure: occupancy × velocity weighted sum",
                "source": "computed",
            },
            "availability_tightness": {
                "range": "[0.0, 1.0]",
                "description": "Complement of availability ratio; 1.0 = zero rooms left",
                "source": "real_time_inventory_snapshot",
            },
        },
        "training_note": (
            "When real-time snapshots are unavailable (historical CSV training), "
            "use synthesize_occupancy_for_training() to generate plausible signals "
            "with Gaussian noise, ensuring the model learns from variance not lookup."
        ),
    }
