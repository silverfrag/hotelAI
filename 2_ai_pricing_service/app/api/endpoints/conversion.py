from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.schemas.conversion_schema import (
    ConversionModelInfoResponse,
    ConversionRequest,
    ConversionResponse,
    ShadowCandidateScore,
    ShadowOptimizationRequest,
    ShadowOptimizationResponse,
)
from app.services.conversion_inference import ConversionInferenceService
from app.services.inference import InferenceError, ModelUnavailableError
from app.services.shadow_optimizer import ShadowPriceOptimizer

router = APIRouter()


def get_conversion_service(request: Request) -> ConversionInferenceService:
    service = getattr(request.app.state, "conversion_inference", None)
    if not isinstance(service, ConversionInferenceService):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Conversion challenger is unavailable.",
        )
    return service


@router.get(
    "/api/v1/conversion-model-info",
    response_model=ConversionModelInfoResponse,
    responses={503: {"description": "Conversion challenger is unavailable."}},
    tags=["conversion-shadow"],
)
def conversion_model_info(
    service: ConversionInferenceService = Depends(get_conversion_service),
) -> ConversionModelInfoResponse:
    metadata = service.model_info
    if metadata is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Conversion challenger is unavailable.",
        )
    return ConversionModelInfoResponse(metadata=metadata)


@router.post(
    "/api/v1/predict-conversion",
    response_model=ConversionResponse,
    responses={503: {"description": "Conversion challenger is unavailable."}},
    tags=["conversion-shadow"],
)
def predict_conversion(
    payload: ConversionRequest,
    service: ConversionInferenceService = Depends(get_conversion_service),
) -> ConversionResponse:
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
            detail="Conversion inference failed.",
        ) from error

    return ConversionResponse(
        conversion_probability=prediction.probability,
        model_version=prediction.model_version,
        training_run_id=prediction.training_run_id,
        feature_contract_version=prediction.feature_contract_version,
        features=prediction.features,
    )


@router.post(
    "/api/v1/optimize-price-shadow",
    response_model=ShadowOptimizationResponse,
    responses={503: {"description": "Conversion challenger is unavailable."}},
    tags=["conversion-shadow"],
)
def optimize_price_shadow(
    payload: ShadowOptimizationRequest,
    service: ConversionInferenceService = Depends(get_conversion_service),
) -> ShadowOptimizationResponse:
    try:
        result = ShadowPriceOptimizer(service).optimize(payload)
    except ModelUnavailableError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(error),
        ) from error
    except InferenceError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Shadow price optimization failed.",
        ) from error

    return ShadowOptimizationResponse(
        champion_multiplier=result.champion_multiplier,
        champion_conversion_probability=result.champion_conversion_probability,
        proposed_multiplier=result.proposed_multiplier,
        guardrailed_multiplier=result.guardrailed_multiplier,
        guardrail_status=result.guardrail_status,
        guardrail_reasons=list(result.guardrail_reasons),
        selected_conversion_probability=result.selected_conversion_probability,
        candidate_scores=[
            ShadowCandidateScore(
                multiplier=candidate.multiplier,
                nightly_price=candidate.nightly_price,
                conversion_probability=candidate.conversion_probability,
                expected_room_revenue_per_night=(
                    candidate.expected_room_revenue_per_night
                ),
            )
            for candidate in result.candidate_scores
        ],
        model_version=result.model_version,
        training_run_id=result.training_run_id,
        feature_contract_version=result.feature_contract_version,
        causality_warning=result.causality_warning,
    )
