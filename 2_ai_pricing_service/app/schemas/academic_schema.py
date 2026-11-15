from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt


class AcademicBookingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid",str_strip_whitespace=True)
    hotel: Literal["Resort Hotel","City Hotel"]
    arrival_date: date
    lead_time: StrictInt = Field(ge=0,le=1000)
    stay_nights: StrictInt = Field(ge=1,le=365)
    adults: StrictInt = Field(ge=1,le=99)
    children: StrictInt | None = Field(default=None,ge=0,le=99)
    babies: StrictInt = Field(ge=0,le=99)
    reserved_room_type: str = Field(min_length=1,max_length=30)
    meal: str = Field(min_length=1,max_length=30)
    market_segment: str = Field(min_length=1,max_length=50)
    distribution_channel: str = Field(min_length=1,max_length=30)
    customer_type: str = Field(min_length=1,max_length=30)


class AcademicDecisionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["success","degraded"]
    adr_reference: float | None
    cancellation_probability: float | None
    adr_unit: Literal["EUR"] = "EUR"
    model_version: str
    training_run_id: str
    feature_contract_version: str
    prediction_sources: dict[str,str]
    baselines: dict[str,float | None]
    features: dict[str,int | float | str | None]
    explanation: dict[str,list[dict]]
    explanation_method: str
    business_rules: list[dict]
    warnings: list[str]
    caveats: list[str]
    hypothetical: bool = True


class HoldoutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task: Literal["adr","cancellation"] = "adr"
    row_id: str = Field(pattern=r"^booking-\d+$")
