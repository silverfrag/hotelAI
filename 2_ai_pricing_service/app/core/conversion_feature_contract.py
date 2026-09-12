from __future__ import annotations

import math
from datetime import date
from typing import Final

from app.core.feature_contract import FEATURE_ORDER, build_pricing_features

CONVERSION_FEATURE_CONTRACT_VERSION: Final = "1.0.0"
CONVERSION_NUMERIC_FEATURE_ORDER: Final[tuple[str, ...]] = (
    *FEATURE_ORDER,
    "capacity_snapshot",
    "rooms_available",
    "rooms_sellable_snapshot",
    "rooms_booked_snapshot",
    "occupancy_ratio_snapshot",
    "base_price",
    "offered_nightly_price",
    "offered_price_ratio",
)
CONVERSION_CATEGORICAL_FEATURE_ORDER: Final[tuple[str, ...]] = (
    "room_type_name",
    "currency",
    "pricing_source",
)
CONVERSION_FEATURE_ORDER: Final[tuple[str, ...]] = (
    *CONVERSION_NUMERIC_FEATURE_ORDER,
    *CONVERSION_CATEGORICAL_FEATURE_ORDER,
)

CAUSALITY_WARNING: Final = (
    "This model learns observational conversion associations. Its offered-price "
    "coefficient is not a causal price-elasticity estimate and must not be used "
    "for autonomous price optimization without a controlled experiment."
)


def build_conversion_features(
    *,
    lead_time: int,
    check_in: date,
    check_out: date,
    guest_count: int,
    capacity_snapshot: int,
    rooms_available: int,
    rooms_sellable_snapshot: int,
    rooms_booked_snapshot: int,
    occupancy_ratio_snapshot: float,
    base_price: float,
    offered_nightly_price: float,
    room_type_name: str,
    currency: str,
    pricing_source: str,
) -> dict[str, int | float | str]:
    """Build the shared quote-time feature vector for conversion inference."""
    if capacity_snapshot <= 0:
        raise ValueError("capacity_snapshot must be positive")
    if guest_count > capacity_snapshot:
        raise ValueError("guest_count cannot exceed capacity_snapshot")
    if rooms_sellable_snapshot < 0:
        raise ValueError("rooms_sellable_snapshot cannot be negative")
    if not 0 <= rooms_booked_snapshot <= rooms_sellable_snapshot:
        raise ValueError("rooms_booked_snapshot must be inside sellable inventory")
    if not 0 <= rooms_available <= rooms_sellable_snapshot:
        raise ValueError("rooms_available must be inside sellable inventory")
    if rooms_available + rooms_booked_snapshot != rooms_sellable_snapshot:
        raise ValueError("available plus booked rooms must equal sellable inventory")
    if not 0 <= occupancy_ratio_snapshot <= 1:
        raise ValueError("occupancy_ratio_snapshot must be inside [0, 1]")
    expected_occupancy = (
        rooms_booked_snapshot / rooms_sellable_snapshot
        if rooms_sellable_snapshot
        else 0.0
    )
    if not math.isclose(
        float(occupancy_ratio_snapshot), expected_occupancy, abs_tol=1e-5
    ):
        raise ValueError("occupancy_ratio_snapshot is inconsistent with inventory")
    if not math.isfinite(float(base_price)) or base_price <= 0:
        raise ValueError("base_price must be a positive finite number")
    if not math.isfinite(float(offered_nightly_price)) or offered_nightly_price <= 0:
        raise ValueError("offered_nightly_price must be a positive finite number")

    normalized_categories = {
        "room_type_name": room_type_name.strip(),
        "currency": currency.strip().upper(),
        "pricing_source": pricing_source.strip().lower(),
    }
    if any(not value for value in normalized_categories.values()):
        raise ValueError("categorical conversion features cannot be blank")

    pricing_features = build_pricing_features(
        lead_time=lead_time,
        check_in=check_in,
        check_out=check_out,
        guest_count=guest_count,
    )
    offered_price_ratio = round(float(offered_nightly_price) / float(base_price), 10)
    return {
        **pricing_features,
        "capacity_snapshot": capacity_snapshot,
        "rooms_available": rooms_available,
        "rooms_sellable_snapshot": rooms_sellable_snapshot,
        "rooms_booked_snapshot": rooms_booked_snapshot,
        "occupancy_ratio_snapshot": round(float(occupancy_ratio_snapshot), 10),
        "base_price": float(base_price),
        "offered_nightly_price": float(offered_nightly_price),
        "offered_price_ratio": offered_price_ratio,
        **normalized_categories,
    }


def conversion_feature_contract_metadata() -> dict[str, object]:
    return {
        "version": CONVERSION_FEATURE_CONTRACT_VERSION,
        "feature_order": list(CONVERSION_FEATURE_ORDER),
        "numeric_features": list(CONVERSION_NUMERIC_FEATURE_ORDER),
        "categorical_features": list(CONVERSION_CATEGORICAL_FEATURE_ORDER),
        "target": "acceptance_label for an explicitly exposed, resolved quote",
        "observation_unit": "one immutable pricing quote",
        "source_view": "pricing_quote_training_dataset_v1",
        "price_feature": {
            "name": "offered_price_ratio",
            "definition": "offered_nightly_price / base_price at quote time",
        },
        "excluded_as_leakage": [
            "booking_id",
            "accepted_at",
            "rejected_at",
            "latest_outcome",
            "quote_disposition",
            "acceptance_label_available_at",
            "paid_amount",
            "refunded_amount",
        ],
        "causality_warning": CAUSALITY_WARNING,
    }
