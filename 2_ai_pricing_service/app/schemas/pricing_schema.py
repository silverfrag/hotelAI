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


class PricingFeatures(BaseModel):
    lead_time: int = Field(ge=0)
    arrival_month_sin: float = Field(ge=-1, le=1)
    arrival_month_cos: float = Field(ge=-1, le=1)
    arrival_weekday_sin: float = Field(ge=-1, le=1)
    arrival_weekday_cos: float = Field(ge=-1, le=1)
    stay_nights: int = Field(ge=1)
    weekend_nights: int = Field(ge=0)
    weekend_share: float = Field(ge=0, le=1)
    guest_count: int = Field(ge=1, le=1_000)


class PricingResponse(BaseModel):
    status: Literal["success"] = "success"
    ai_multiplier: float = Field(ge=0.5, le=3.0)
    model_version: str
    training_run_id: str
    feature_contract_version: str
    features: PricingFeatures
    message: str = "Dynamic price multiplier calculated."


class HealthResponse(BaseModel):
    status: Literal["alive", "ok", "model_unavailable"]


class ModelInfoResponse(BaseModel):
    status: Literal["ready"] = "ready"
    metadata: dict[str, Any]
