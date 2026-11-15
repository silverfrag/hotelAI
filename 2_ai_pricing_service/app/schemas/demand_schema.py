"""Schema definitions for the Real-time Demand Signal Pipeline API."""
from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field


class DemandSignalsRequest(BaseModel):
    room_type_name: str = Field(..., min_length=1, description="Target room type name.")
    rooms_sellable: int = Field(..., ge=0, description="Total physical sellable rooms.")
    rooms_booked: int = Field(..., ge=0, description="Number of rooms booked for stay date.")
    rooms_available: int | None = Field(default=None, ge=0, description="Rooms remaining sellable.")
    bookings_last_7d: int | None = Field(default=None, ge=0, description="Bookings created in last 7 days.")
    historical_avg_7d: float | None = Field(default=None, ge=0.0, description="Historical 7-day booking average.")
    offered_nightly_price: float | None = Field(default=None, gt=0.0, description="Offered nightly price (VND).")
    trailing_avg_price: float | None = Field(default=None, gt=0.0, description="Trailing 30-day average ADR.")


class DemandSignalsResponse(BaseModel):
    status: Literal["success"] = "success"
    occupancy_ratio: float = Field(..., ge=0.0, le=1.0)
    booking_velocity_score: float = Field(..., ge=0.0, le=1.0)
    demand_pressure_score: float = Field(..., ge=0.0, le=1.0)
    availability_tightness: float = Field(..., ge=0.0, le=1.0)
    price_vs_market_ratio: float = Field(..., gt=0.0)
    source: Literal["real_time", "fallback"]
    pipeline_version: str


class DemandPipelineMetadataResponse(BaseModel):
    pipeline_version: str
    velocity_window_days: int
    trailing_price_window_days: int
    signals: list[dict[str, Any]]
