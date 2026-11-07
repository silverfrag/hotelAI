"""Contracts for evidence-backed, advisory-only Da Nang pricing."""
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class MarketPricingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    check_in_date: date
    guest_count: int = Field(default=2, ge=1, le=20)
    room_type_id: int = Field(default=1, ge=1)
    room_segment: Literal["upscale_resort_standard"] = "upscale_resort_standard"
    base_price: float = Field(default=1200000, ge=10000, le=100000000)
    rooms_available: int = Field(default=6, ge=0, le=10000)
    rooms_total: int = Field(default=24, ge=1, le=10000)
    serving_cost: float = Field(default=350000, ge=0, le=100000000)
    commission_pct: float = Field(default=0, ge=0, le=.5)
    tax_pct: float = Field(default=0, ge=0, le=.3)
    min_margin: float = Field(default=100000, ge=0, le=100000000)
    floor_price: float = Field(default=600000, ge=1000, le=100000000)
    ceiling_price: float = Field(default=3000000, ge=1000, le=100000000)

    @model_validator(mode="after")
    def consistent(self):
        if self.rooms_available > self.rooms_total:
            raise ValueError("rooms_available cannot exceed rooms_total")
        if self.floor_price > self.ceiling_price:
            raise ValueError("floor_price cannot exceed ceiling_price")
        return self


class SourceEvidence(BaseModel):
    source_id: str
    name: str
    kind: str
    url: str
    status: Literal["fetched", "cached", "unavailable", "out_of_horizon"]
    fetched_at: datetime | None = None
    sha256: str | None = None
    detail: str = ""


class ComparableRate(BaseModel):
    """Trusted-provider contract: exact one-night, public, tax-inclusive quote."""
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    hotel_id: str = Field(min_length=1)
    hotel_name: str = Field(min_length=1)
    region: Literal["VN-DN"]
    room_segment: Literal["upscale_resort_standard"]
    check_in_date: date
    nights: Literal[1]
    guest_count: int = Field(ge=1)
    currency: Literal["VND"]
    meal_plan: Literal["breakfast"]
    refundable: Literal[True]
    taxes_included: Literal[True]
    available: Literal[True]
    nightly_price: float = Field(gt=0, le=100000000)
    observed_at: datetime
    source_url: str


class ExtractedEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fact_type: Literal["event", "travel_disruption", "hotel_offer"] = "event"
    normalization_rule: Literal["literal_full_dates", "explicit_shared_year_in_single_range", "explicit_year_in_occurrence_span"] = "literal_full_dates"
    occurrence_year_quote: str | None = Field(default=None, pattern=r"^(?:19|20)\d{2}$")
    event_status: Literal["scheduled", "cancelled", "updated"] = "scheduled"
    status_quote: str = Field(default="", max_length=2000)
    title: str = Field(min_length=1, max_length=200)
    source_id: str
    quote: str = Field(min_length=15, max_length=2000)
    location_quote: str = Field(min_length=3, max_length=200)
    start_date: date
    end_date: date
    start_date_quote: str = Field(min_length=3, max_length=30)
    end_date_quote: str = Field(min_length=3, max_length=30)


class EventExtraction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    events: list[ExtractedEvent] = Field(default_factory=list, max_length=20)
