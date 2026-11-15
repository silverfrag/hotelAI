"""Tests for Population Stability Index (PSI) drift monitoring."""
from __future__ import annotations

import numpy as np
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.drift_monitor import (
    assess_feature_drift,
    calculate_psi,
    classify_psi,
)
from app.main import create_app


def test_psi_identical_distributions():
    np.random.seed(42)
    sample_a = np.random.normal(loc=20.0, scale=5.0, size=1000)
    sample_b = np.random.normal(loc=20.0, scale=5.0, size=1000)

    psi = calculate_psi(sample_a, sample_b)
    assert psi < 0.05
    assert classify_psi(psi) == "stable"


def test_psi_detects_distribution_drift():
    np.random.seed(42)
    baseline = np.random.normal(loc=15.0, scale=3.0, size=1000)
    # Severe shift in production
    shifted = np.random.normal(loc=45.0, scale=3.0, size=500)

    psi = calculate_psi(baseline, shifted)
    assert psi >= 0.25
    assert classify_psi(psi) == "drift_detected"


def test_assess_feature_drift_recommendations():
    obs = {
        "lead_time": [60.0, 70.0, 80.0, 90.0, 100.0] * 20,  # shifted vs baseline 18.5
        "guest_count": [2.0, 2.0, 1.0, 3.0, 2.0] * 20,
    }
    assessment = assess_feature_drift(obs)
    assert assessment.total_features_monitored == 2
    assert assessment.overall_status in {"warning", "drift_alert", "degraded"}
    assert len(assessment.recommendations) > 0


def test_assess_discrete_integer_features_avoid_continuous_bin_inflation():
    rng = np.random.default_rng(7)
    ref_like_nights = np.clip(np.round(rng.normal(loc=2.4, scale=1.6, size=500)), 1.0, 14.0).tolist()
    ref_like_guests = np.clip(np.round(rng.normal(loc=2.1, scale=1.1, size=500)), 1.0, 6.0).tolist()
    assessment = assess_feature_drift({
        "stay_nights": ref_like_nights,
        "guest_count": ref_like_guests,
    })
    for report in assessment.reports:
        assert report.psi < 0.15


@pytest.mark.asyncio
async def test_drift_monitoring_endpoints():

    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # GET /api/v1/monitoring/drift
        res_get = await client.get("/api/v1/monitoring/drift")
        assert res_get.status_code == 200
        data_get = res_get.json()
        assert data_get["status"] == "success"
        assert "overall_status" in data_get
        assert data_get["total_features_monitored"] > 0
        assert len(data_get["reports"]) > 0

        # POST /api/v1/monitoring/evaluate-drift
        eval_payload = {
            "observations": {
                "lead_time": [10.0, 14.0, 21.0, 18.0, 25.0],
                "guest_count": [2.0, 1.0, 3.0, 2.0, 2.0],
            }
        }
        res_post = await client.post("/api/v1/monitoring/evaluate-drift", json=eval_payload)
        assert res_post.status_code == 200
        data_post = res_post.json()
        assert data_post["status"] == "success"
        assert data_post["total_features_monitored"] == 2
        assert data_post["baseline_source"] == "portugal_v2_training_empirical"
        for report in data_post["reports"]:
            assert report["baseline_source"] == "portugal_v2_training_empirical"
            assert report["baseline_rows"] == 36090
            assert 0.0 <= report["ks_stat"] <= 1.0
            assert 0.0 <= report["ks_pvalue"] <= 1.0
            assert report["wasserstein_distance"] >= 0.0
