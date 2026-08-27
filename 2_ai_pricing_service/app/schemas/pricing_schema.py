from datetime import date

from pydantic import BaseModel, Field


class PricingRequest(BaseModel):
    room_id: int
    check_in: date
    occupancy_rate: float = Field(ge=0, le=1)
    base_price: float = Field(gt=0)


class PricingResponse(BaseModel):
    recommended_price: float
    currency: str = "VND"
