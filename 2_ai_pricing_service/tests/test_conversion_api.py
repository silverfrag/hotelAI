from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

import joblib
import numpy as np
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import Settings
from app.core.conversion_feature_contract import (
    CONVERSION_FEATURE_ORDER,
    conversion_feature_contract_metadata,
)
from app.main import create_app
from app.services.conversion_inference import CONVERSION_ARTIFACT_SCHEMA_VERSION


class ConstantConversionModel:
    feature_names_in_ = np.asarray(CONVERSION_FEATURE_ORDER, dtype=object)
    n_features_in_ = len(CONVERSION_FEATURE_ORDER)

    def predict_proba(self, frame):
        return np.tile(np.asarray([[0.25, 0.75]]), (len(frame), 1))


def write_conversion_artifact(path: Path) -> None:
    joblib.dump(
        {
            "artifact_schema_version": CONVERSION_ARTIFACT_SCHEMA_VERSION,
            "model": ConstantConversionModel(),
            "metadata": {
                "model_kind": "conversion_challenger",
                "model_version": "conversion-test-v1",
                "training_run_id": "conversion-test-run",
                "lifecycle_stage": "shadow_only",
                "feature_contract": conversion_feature_contract_metadata(),
                "data_quality": {
                    "passes_readiness_gate": True,
                    "provenance_policy_version": "1.0.0",
                    "missing_provenance_columns": [],
                    "eligible_rows": 10,
                    "verified_observed_rows": 10,
                },
                "evaluation": {"passes_performance_gate": True},
            },
        },
        path,
    )


@asynccontextmanager
async def conversion_client(tmp_path: Path, artifact: Path):
    application = create_app(
        Settings(
            model_path=tmp_path / "pricing-not-needed.pkl",
            conversion_model_path=artifact,
        )
    )
    async with application.router.lifespan_context(application):
        async with AsyncClient(
            transport=ASGITransport(app=application), base_url="http://test"
        ) as client:
            yield client


def valid_payload() -> dict[str, object]:
    return {
        "lead_time": 20,
        "check_in_date": "2026-10-10",
        "check_out_date": "2026-10-12",
        "guest_count": 2,
        "capacity_snapshot": 3,
        "rooms_available": 7,
        "rooms_sellable_snapshot": 10,
        "rooms_booked_snapshot": 3,
        "occupancy_ratio_snapshot": 0.3,
        "base_price": 1_000_000,
        "offered_nightly_price": 1_200_000,
        "room_type_name": "Suite",
        "currency": "VND",
        "pricing_source": "ai",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("quality", [
    {"passes_readiness_gate": True},
    {"passes_readiness_gate": True, "provenance_policy_version": "0.9.0", "missing_provenance_columns": [], "eligible_rows": 10, "verified_observed_rows": 10},
    {"passes_readiness_gate": True, "provenance_policy_version": "1.0.0", "missing_provenance_columns": ["data_provenance"], "eligible_rows": 10, "verified_observed_rows": 10},
    {"passes_readiness_gate": True, "provenance_policy_version": "1.0.0", "missing_provenance_columns": [], "eligible_rows": 10, "verified_observed_rows": 0},
])
async def test_legacy_or_unverified_artifact_is_not_served(tmp_path: Path, quality: dict) -> None:
    artifact = tmp_path / "legacy.pkl"
    write_conversion_artifact(artifact)
    contents = joblib.load(artifact)
    contents["metadata"]["data_quality"] = quality
    joblib.dump(contents, artifact)
    original = artifact.read_bytes()
    async with conversion_client(tmp_path, artifact) as client:
        assert (await client.get("/api/v1/conversion-model-info")).status_code == 503
        assert (await client.post("/api/v1/predict-conversion", json=valid_payload())).status_code == 503
    assert artifact.read_bytes() == original


@pytest.mark.asyncio
async def test_conversion_prediction_and_shadow_optimizer(tmp_path: Path) -> None:
    artifact = tmp_path / "conversion.pkl"
    write_conversion_artifact(artifact)
    async with conversion_client(tmp_path, artifact) as client:
        prediction = await client.post("/api/v1/predict-conversion", json=valid_payload())
        optimization = await client.post(
            "/api/v1/optimize-price-shadow",
            json={
                **valid_payload(),
                "champion_multiplier": 1.2,
                "guardrail_min_multiplier": 0.5,
                "guardrail_max_multiplier": 3,
                "guardrail_max_change_ratio": 0.05,
                "candidate_step_ratio": 0.05,
                "candidate_steps": 3,
            },
        )

    assert prediction.status_code == 200
    assert prediction.json()["conversion_probability"] == 0.75
    assert optimization.status_code == 200
    body = optimization.json()
    assert body["lifecycle_stage"] == "shadow_only"
    assert body["proposed_multiplier"] == pytest.approx(1.38)
    assert body["guardrailed_multiplier"] == pytest.approx(1.26)
    assert body["guardrail_status"] == "adjusted"
    assert "change_ceiling" in body["guardrail_reasons"]
    assert "not a causal" in body["causality_warning"]


@pytest.mark.asyncio
async def test_conversion_artifact_is_optional_for_pricing_process(tmp_path: Path) -> None:
    missing = tmp_path / "missing.pkl"
    async with conversion_client(tmp_path, missing) as client:
        response = await client.post("/api/v1/predict-conversion", json=valid_payload())
        optimizer = await client.post(
            "/api/v1/optimize-price-shadow",
            json={
                **valid_payload(),
                "champion_multiplier": 1.2,
                "guardrail_min_multiplier": 0.5,
                "guardrail_max_multiplier": 3,
                "guardrail_max_change_ratio": 0.1,
            },
        )

    assert response.status_code == 503
    assert optimizer.status_code == 503
