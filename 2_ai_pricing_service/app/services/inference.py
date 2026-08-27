from app.schemas.pricing_schema import PricingRequest, PricingResponse


def recommend_price(payload: PricingRequest) -> PricingResponse:
    """Fallback rule until the trained model is loaded."""
    multiplier = 1 + (payload.occupancy_rate - 0.5) * 0.4
    return PricingResponse(recommended_price=round(payload.base_price * multiplier, 2))
