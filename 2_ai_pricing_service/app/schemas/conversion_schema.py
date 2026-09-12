from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ConversionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lead_time: int = Field(ge=0)
    check_in_date: date
    check_out_date: date
    guest_count: int = Field(ge=1, le=1_000)
    capacity_snapshot: int = Field(ge=1, le=1_000)
    rooms_available: int = Field(ge=0)
    rooms_sellable_snapshot: int = Field(ge=0)
    rooms_booked_snapshot: int = Field(ge=0)
    occupancy_ratio_snapshot: float = Field(ge=0, le=1)
    base_price: float = Field(gt=0)
    offered_nightly_price: float = Field(gt=0)
    room_type_name: str = Field(min_length=1, max_length=150)
    currency: str = Field(min_length=3, max_length=3)
    pricing_source: str = Field(min_length=1, max_length=30)

    @model_validator(mode="after")
    def validate_quote_context(self) -> "ConversionRequest":
        if self.check_out_date <= self.check_in_date:
            raise ValueError("check_out_date must be after check_in_date")
        if self.guest_count > self.capacity_snapshot:
            raise ValueError("guest_count cannot exceed capacity_snapshot")
        if self.rooms_booked_snapshot > self.rooms_sellable_snapshot:
            raise ValueError("rooms_booked_snapshot cannot exceed sellable inventory")
        if self.rooms_available > self.rooms_sellable_snapshot:
            raise ValueError("rooms_available cannot exceed sellable inventory")
        if (
            self.rooms_available + self.rooms_booked_snapshot
            != self.rooms_sellable_snapshot
        ):
            raise ValueError(
                "available plus booked rooms must equal sellable inventory"
            )
        expected_occupancy = (
            self.rooms_booked_snapshot / self.rooms_sellable_snapshot
            if self.rooms_sellable_snapshot
            else 0.0
        )
        if abs(self.occupancy_ratio_snapshot - expected_occupancy) > 1e-5:
            raise ValueError("occupancy_ratio_snapshot is inconsistent with inventory")
        return self


class ConversionResponse(BaseModel):
    status: Literal["success"] = "success"
    conversion_probability: float = Field(ge=0, le=1)
    model_version: str
    training_run_id: str
    feature_contract_version: str
    lifecycle_stage: Literal["shadow_only"] = "shadow_only"
    features: dict[str, int | float | str]
    message: str = "Shadow conversion probability calculated."


class ConversionModelInfoResponse(BaseModel):
    status: Literal["ready"] = "ready"
    metadata: dict[str, Any]


class ShadowOptimizationRequest(ConversionRequest):
    champion_multiplier: float = Field(ge=0.1, le=5)
    guardrail_min_multiplier: float = Field(ge=0.1, le=3)
    guardrail_max_multiplier: float = Field(ge=0.1, le=5)
    guardrail_max_change_ratio: float = Field(ge=0, le=1)
    candidate_step_ratio: float = Field(default=0.05, gt=0, le=0.25)
    candidate_steps: int = Field(default=3, ge=1, le=10)

    @model_validator(mode="after")
    def validate_optimizer_policy(self) -> "ShadowOptimizationRequest":
        if self.guardrail_min_multiplier > self.guardrail_max_multiplier:
            raise ValueError("guardrail_min_multiplier cannot exceed maximum")
        return self


class ShadowCandidateScore(BaseModel):
    multiplier: float
    nightly_price: float
    conversion_probability: float = Field(ge=0, le=1)
    expected_room_revenue_per_night: float


class ShadowOptimizationResponse(BaseModel):
    status: Literal["success"] = "success"
    lifecycle_stage: Literal["shadow_only"] = "shadow_only"
    champion_multiplier: float
    champion_conversion_probability: float = Field(ge=0, le=1)
    proposed_multiplier: float
    guardrailed_multiplier: float
    guardrail_status: Literal["within_policy", "adjusted", "policy_conflict"]
    guardrail_reasons: list[str]
    selected_conversion_probability: float = Field(ge=0, le=1)
    candidate_scores: list[ShadowCandidateScore]
    model_version: str
    training_run_id: str
    feature_contract_version: str
    causality_warning: str
