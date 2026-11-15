from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PricingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lead_time: int = Field(ge=0)
    check_in_date: date
    check_out_date: date
    guest_count: int = Field(ge=1, le=1_000)

    @model_validator(mode="after")
    def validate_stay_dates(self) -> "PricingRequest":
        if self.check_out_date <= self.check_in_date:
            raise ValueError("check_out_date must be after check_in_date")
        return self


class ExperimentalDemandPricingRequest(PricingRequest):
    """Research-only demand inputs; not accepted by the released quote API."""
    # ── Demand signals (v3.0.0) ───────────────────────────────────────────
    # Defaults represent a neutral/average market state for backward compat.
    occupancy_ratio: float = Field(
        default=0.65, ge=0.0, le=1.0,
        description="Fraction of sellable rooms already booked [0.0, 1.0]. "
                    "This is the primary demand signal for price decisions.",
    )
    booking_velocity_score: float = Field(
        default=0.50, ge=0.0, le=1.0,
        description="Normalised booking pace vs historical average. "
                    "0.5 = on-trend; >0.5 = demand is accelerating.",
    )
    rooms_available: int | None = Field(
        default=None, ge=0,
        description="Absolute number of rooms still available. "
                    "Used to compute availability_tightness when provided.",
    )
    rooms_sellable: int | None = Field(
        default=None, ge=1,
        description="Total sellable rooms for this room type.",
    )
    price_vs_market_ratio: float = Field(
        default=1.0, gt=0.0,
        description="Offered price / trailing 30-day average for this room type. "
                    "Pass 1.0 when no historical average is available.",
    )



class PricingFeatures(BaseModel):
    """Released V2 feature vector actually consumed by the quote model."""
    # Temporal
    lead_time: int = Field(ge=0)
    arrival_month_sin: float = Field(ge=-1, le=1)
    arrival_month_cos: float = Field(ge=-1, le=1)
    arrival_weekday_sin: float = Field(ge=-1, le=1)
    arrival_weekday_cos: float = Field(ge=-1, le=1)
    stay_nights: int = Field(ge=1)
    weekend_nights: int = Field(ge=0)
    weekend_share: float = Field(ge=0, le=1)
    guest_count: int = Field(ge=1, le=1_000)


class ExperimentalDemandPricingFeatures(PricingFeatures):
    """V3 research vector; not approved for the quote endpoint."""
    # Demand signals
    occupancy_ratio: float = Field(ge=0.0, le=1.0)
    booking_velocity_score: float = Field(ge=0.0, le=1.0)
    demand_pressure_score: float = Field(ge=0.0, le=1.0)
    availability_tightness: float = Field(ge=0.0, le=1.0)
    price_vs_market_ratio: float = Field(gt=0.0)


# ── Explanation types ─────────────────────────────────────────────────────────

class FeatureAttribution(BaseModel):
    """A single feature's contribution to the pricing decision."""
    feature: str
    value: float | int | str
    attribution: float = Field(
        description="Signed contribution to the multiplier (positive = price up, "
                    "negative = price down). Approximate, based on feature importance × deviation."
    )
    pct_contribution: float = Field(
        description="Percentage of the total absolute attribution from this feature."
    )
    category: Literal["demand", "temporal"] = Field(
        description="'demand' features reflect real-time market conditions; "
                    "'temporal' features are calendar-derived."
    )
    human_label: str = Field(description="Plain-language label for this feature.")
    interpretation: str = Field(description="Plain-language interpretation of value.")


class PriceExplanation(BaseModel):
    """Human-readable explanation of the AI pricing decision."""
    primary_driver: str = Field(description="The single most influential factor.")
    demand_share_pct: float = Field(
        description="Percentage of model weight attributed to real-time demand signals."
    )
    temporal_share_pct: float = Field(
        description="Percentage of model weight attributed to calendar/date features."
    )
    attributions: list[FeatureAttribution]
    counterfactual: str = Field(
        description="What the multiplier would be at neutral occupancy (0.65)."
    )
    ai_vs_script_note: str = (
        "Chưa có đánh giá dự báo nhu cầu trên dữ liệu Việt Nam. "
        "Độ quan trọng toàn cục của đặc trưng không chứng minh "
        "mức đóng góp hoặc quan hệ nhân quả cho một báo giá."
    )


class UncertaintyInterval(BaseModel):
    """Epistemic ensemble quantiles, Split Conformal interval, and Mahalanobis OOD gate."""
    method: str = "smoothed_locally_adaptive_split_conformal"
    calibration_rows: int = Field(default=0, ge=0)
    ensemble_p10: float = Field(ge=0.5, le=3.0)
    ensemble_p50: float = Field(ge=0.5, le=3.0)
    ensemble_p90: float = Field(ge=0.5, le=3.0)
    ensemble_std: float = Field(ge=0.0)
    conformal_alpha: float = Field(default=0.10, gt=0.0, lt=1.0)
    target_coverage: float = Field(default=0.90, gt=0.0, lt=1.0)
    empirical_holdout_coverage: float | None = Field(default=None, ge=0.0, le=1.0)
    conformal_low: float = Field(ge=0.5, le=3.0)
    conformal_high: float = Field(ge=0.5, le=3.0)
    ood_distance: float = Field(ge=0.0)
    ood_p95_threshold: float | None = Field(default=None, ge=0.0)
    ood_p99_threshold: float | None = Field(default=None, ge=0.0)
    ood_status: Literal["in_distribution", "border", "out_of_distribution"]
    ood_notes: list[str] = Field(default_factory=list)


class PricingResponse(BaseModel):
    status: Literal["success"] = "success"
    ai_multiplier: float = Field(ge=0.5, le=3.0)
    model_version: str
    training_run_id: str
    feature_contract_version: str
    features: PricingFeatures
    message: str = "Dynamic price multiplier calculated."
    uncertainty: UncertaintyInterval | None = None


class ExplainPricingResponse(PricingResponse):
    """Extended response with AI explanation of the pricing decision."""
    explanation: PriceExplanation


class HealthResponse(BaseModel):
    status: Literal["alive", "ok", "model_unavailable"]


class ModelInfoResponse(BaseModel):
    status: Literal["ready"] = "ready"
    metadata: dict[str, Any]
