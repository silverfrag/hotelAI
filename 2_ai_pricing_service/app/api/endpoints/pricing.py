from fastapi import APIRouter

from app.schemas.pricing_schema import PricingRequest, PricingResponse
from app.services.inference import recommend_price

router = APIRouter(prefix="/pricing", tags=["pricing"])


@router.post("/recommend", response_model=PricingResponse)
def get_recommended_price(payload: PricingRequest) -> PricingResponse:
    return recommend_price(payload)
