"""Schema definitions for AI Drift and Performance Monitoring API."""
from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field


class FeatureDriftSchema(BaseModel):
    feature: str
    psi: float
    status: Literal["stable", "warning", "drift_detected"]
    baseline_mean: float
    current_mean: float
    baseline_std: float
    current_std: float
    ks_stat: float = 0.0
    ks_pvalue: float = 1.0
    wasserstein_distance: float = 0.0
    baseline_median: float = 0.0
    current_median: float = 0.0
    baseline_rows: int = 0
    baseline_source: str = "portugal_v2_training_empirical"


class DriftEvaluationRequest(BaseModel):
    observations: dict[str, list[float]] = Field(
        ...,
        description="Feature observations from recent quote requests or booking events.",
        examples=[{"lead_time": [10, 14, 20, 7, 30], "guest_count": [2, 1, 3, 2, 4]}],
    )


class DriftAssessmentResponse(BaseModel):
    status: Literal["success"] = "success"
    assessed_at: str
    overall_status: Literal["healthy", "degraded", "drift_alert"]
    baseline_source: str = "portugal_v2_training_empirical"
    total_features_monitored: int
    features_with_drift: int
    features_with_warning: int
    reports: list[FeatureDriftSchema]
    recommendations: list[str]
