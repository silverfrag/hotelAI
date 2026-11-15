"""Tests for Split Conformal Prediction, Ensemble Quantiles, and Mahalanobis OOD detection."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import httpx
import numpy as np
import pytest

from app.core.config import Settings
from app.main import create_app
from app.schemas.pricing_schema import PricingRequest
from app.services.inference import PricingInferenceService


@pytest.mark.asyncio
async def test_champion_v2_emits_conformal_and_ood_uncertainty() -> None:
    model_path = Path("app/models/random_forest_v2.pkl")
    if not model_path.exists():
        pytest.skip("random_forest_v2.pkl not found locally")

    service = PricingInferenceService(model_path)
    service.load()
    assert service.is_ready

    # Normal in-distribution booking
    normal_req = PricingRequest(
        lead_time=14,
        check_in_date=date(2026, 11, 15),
        check_out_date=date(2026, 11, 17),
        guest_count=2,
    )
    normal_pred = service.predict(normal_req)
    assert normal_pred.uncertainty is not None
    u = normal_pred.uncertainty
    assert u.calibration_rows == 9029
    assert u.empirical_holdout_coverage == pytest.approx(0.90021, abs=1e-4)
    assert u.ensemble_p10 <= u.ensemble_p50 <= u.ensemble_p90
    assert 0.5 <= u.conformal_low <= normal_pred.multiplier <= u.conformal_high <= 3.0
    assert u.ood_status == "in_distribution"
    assert u.ood_distance <= (u.ood_p95_threshold or 5.0)

    # Extreme out-of-distribution booking (12 guests, 30 nights, 550 lead_time)
    extreme_req = PricingRequest(
        lead_time=550,
        check_in_date=date(2027, 8, 1),
        check_out_date=date(2027, 8, 31),
        guest_count=12,
    )
    extreme_pred = service.predict(extreme_req)
    assert extreme_pred.uncertainty is not None
    eu = extreme_pred.uncertainty
    assert eu.ood_status == "out_of_distribution"
    assert eu.ood_distance > normal_pred.uncertainty.ood_distance
    assert any("Ngoại lai" in note or "vượt ngưỡng" in note for note in eu.ood_notes)

    # HTTP integration on /api/v1/predict-price and /api/v1/explain-price
    app = create_app(Settings(model_path=model_path))
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            res_pred = await client.post(
                "/api/v1/predict-price",
                json={
                    "lead_time": 14,
                    "check_in_date": "2026-11-15",
                    "check_out_date": "2026-11-17",
                    "guest_count": 2,
                },
            )
            assert res_pred.status_code == 200
            pred_json = res_pred.json()
            assert "uncertainty" in pred_json
            assert pred_json["uncertainty"]["conformal_low"] <= pred_json["ai_multiplier"] <= pred_json["uncertainty"]["conformal_high"]

            res_exp = await client.post(
                "/api/v1/explain-price",
                json={
                    "lead_time": 550,
                    "check_in_date": "2027-08-01",
                    "check_out_date": "2027-08-31",
                    "guest_count": 12,
                },
            )
            assert res_exp.status_code == 200
            exp_json = res_exp.json()
            assert exp_json["uncertainty"]["ood_status"] == "out_of_distribution"
            assert exp_json["explanation"]["attributions"]


def test_conformal_artifact_integrity() -> None:
    conf_path = Path("app/models/random_forest_v2.conformal.json")
    meta_path = Path("app/models/random_forest_v2.metadata.json")
    if not conf_path.exists() or not meta_path.exists():
        pytest.skip("Conformal or metadata artifact not found")
    conf = json.loads(conf_path.read_text(encoding="utf-8"))
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert conf["training_run_id"] == meta["training_run_id"]
    assert conf["calibration_summary"]["calibration_holdout_rows"] == meta["evaluation"]["holdout_rows"]
    assert 0.89 <= conf["conformal"]["achieved_holdout_coverage_90"] <= 0.92
    for feat in ("lead_time", "stay_nights", "guest_count", "weekend_share"):
        assert len(conf["drift_reference"][feat]["ecdf_quantiles"]) == 1001

