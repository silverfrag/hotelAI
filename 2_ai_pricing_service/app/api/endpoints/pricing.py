from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.schemas.pricing_schema import (
    ExplainPricingResponse,
    HealthResponse,
    ModelInfoResponse,
    PricingFeatures,
    PricingRequest,
    PricingResponse,
)
from app.services.inference import (
    InferenceError,
    ModelUnavailableError,
    PricingInferenceService,
)

router = APIRouter()


def get_inference_service(request: Request) -> PricingInferenceService:
    service = getattr(request.app.state, "pricing_inference", None)
    if not isinstance(service, PricingInferenceService):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Pricing model is unavailable.",
        )
    return service


@router.get("/health/live", response_model=HealthResponse, tags=["health"])
def liveness() -> HealthResponse:
    return HealthResponse(status="alive")


@router.get(
    "/health",
    response_model=HealthResponse,
    responses={503: {"model": HealthResponse}},
    tags=["health"],
)
@router.get(
    "/api/v1/health",
    response_model=HealthResponse,
    responses={503: {"model": HealthResponse}},
    tags=["health"],
)
def readiness(
    response: Response,
    service: PricingInferenceService = Depends(get_inference_service),
) -> HealthResponse:
    if not service.is_ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return HealthResponse(status="model_unavailable")
    return HealthResponse(status="ok")


@router.get(
    "/api/v1/model-info",
    response_model=ModelInfoResponse,
    responses={503: {"description": "Pricing model is unavailable."}},
    tags=["model"],
)
def model_info(
    service: PricingInferenceService = Depends(get_inference_service),
) -> ModelInfoResponse:
    metadata = service.model_info
    if metadata is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Pricing model is unavailable.",
        )
    return ModelInfoResponse(metadata=metadata)


@router.post(
    "/api/v1/predict-price",
    response_model=PricingResponse,
    response_model_exclude_none=True,
    responses={503: {"description": "Pricing model is unavailable."}},
    tags=["pricing"],
    summary="Tính giá động AI",
    description="Historical ADR benchmark using the released V2 temporal contract.",
)
def predict_dynamic_price(
    payload: PricingRequest,
    service: PricingInferenceService = Depends(get_inference_service),
) -> PricingResponse:
    try:
        prediction = service.predict(payload)
    except ModelUnavailableError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(error),
        ) from error
    except InferenceError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Pricing inference failed.",
        ) from error

    return PricingResponse(
        ai_multiplier=prediction.multiplier,
        model_version=prediction.model_version,
        training_run_id=prediction.training_run_id,
        feature_contract_version=prediction.feature_contract_version,
        features=PricingFeatures(**prediction.features),
        uncertainty=prediction.uncertainty,
    )


@router.post(
    "/api/v1/explain-price",
    response_model=ExplainPricingResponse,
    responses={503: {"description": "Pricing model is unavailable."}},
    tags=["pricing"],
    summary="Giải thích quyết định giá AI",
    description="Saabas Tree Interpreter decomposition when tree estimators are available; returns 503 if unvalidated.",
)
def explain_dynamic_price(
    payload: PricingRequest,
    service: PricingInferenceService = Depends(get_inference_service),
) -> ExplainPricingResponse:
    """Explain Random Forest V2 prediction via Saabas Tree Interpreter or return controlled 503."""
    try:
        prediction, explanation = service.explain_prediction(payload)
    except ModelUnavailableError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(error),
        ) from error
    except InferenceError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Pricing inference failed.",
        ) from error

    return ExplainPricingResponse(
        ai_multiplier=prediction.multiplier,
        model_version=prediction.model_version,
        training_run_id=prediction.training_run_id,
        feature_contract_version=prediction.feature_contract_version,
        features=PricingFeatures(**prediction.features),
        uncertainty=prediction.uncertainty,
        explanation=explanation,
    )
