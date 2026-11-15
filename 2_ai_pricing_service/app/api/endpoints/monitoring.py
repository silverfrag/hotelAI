"""AI Performance and Drift Monitoring endpoints."""
from __future__ import annotations

from fastapi import APIRouter

from app.core.drift_monitor import DriftAssessment, assess_feature_drift
from app.schemas.monitoring_schema import (
    DriftAssessmentResponse,
    DriftEvaluationRequest,
    FeatureDriftSchema,
)

router = APIRouter()


def _to_response(assessment: DriftAssessment) -> DriftAssessmentResponse:
    return DriftAssessmentResponse(
        assessed_at=assessment.assessed_at,
        overall_status=assessment.overall_status,
        baseline_source=assessment.baseline_source,
        total_features_monitored=assessment.total_features_monitored,
        features_with_drift=assessment.features_with_drift,
        features_with_warning=assessment.features_with_warning,
        reports=[
            FeatureDriftSchema(
                feature=r.feature,
                psi=r.psi,
                status=r.status,
                baseline_mean=r.baseline_mean,
                current_mean=r.current_mean,
                baseline_std=r.baseline_std,
                current_std=r.current_std,
                ks_stat=r.ks_stat,
                ks_pvalue=r.ks_pvalue,
                wasserstein_distance=r.wasserstein_distance,
                baseline_median=r.baseline_median,
                current_median=r.current_median,
                baseline_rows=r.baseline_rows,
                baseline_source=r.baseline_source,
            )
            for r in assessment.reports
        ],
        recommendations=assessment.recommendations,
    )


@router.get(
    "/api/v1/monitoring/drift",
    response_model=DriftAssessmentResponse,
    tags=["monitoring"],
    summary="Báo cáo trôi dạt dữ liệu AI định kỳ",
    description="Evaluates default diagnostic observations against empirical Portugal V2 training quantiles (KS, Wasserstein-1, PSI).",
)
def get_drift_assessment() -> DriftAssessmentResponse:
    sample_obs = {
        "lead_time": [14.0, 21.0, 7.0, 30.0, 18.0, 15.0, 10.0, 25.0],
        "stay_nights": [2.0, 3.0, 1.0, 4.0, 2.0, 2.0, 3.0],
        "guest_count": [2.0, 2.0, 1.0, 3.0, 2.0, 4.0],
        "weekend_share": [0.33, 0.50, 0.0, 0.67, 0.50],
        "occupancy_ratio": [0.60, 0.65, 0.70, 0.55, 0.62],
        "booking_velocity_score": [0.50, 0.52, 0.48, 0.55],
    }
    assessment = assess_feature_drift(sample_obs, use_empirical_reference=True)
    return _to_response(assessment)


@router.post(
    "/api/v1/monitoring/evaluate-drift",
    response_model=DriftAssessmentResponse,
    tags=["monitoring"],
    summary="Đánh giá trôi dạt dữ liệu trên tập quan sát thực tế",
)
def evaluate_drift(payload: DriftEvaluationRequest) -> DriftAssessmentResponse:
    assessment = assess_feature_drift(payload.observations, use_empirical_reference=True)
    return _to_response(assessment)
