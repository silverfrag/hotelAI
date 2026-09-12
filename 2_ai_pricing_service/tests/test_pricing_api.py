from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import joblib
import pytest

from app.core.config import Settings
from app.core.feature_contract import FEATURE_CONTRACT_VERSION, FEATURE_ORDER, feature_contract_metadata
from app.main import create_app
from app.services.inference import MODEL_ARTIFACT_SCHEMA_VERSION


class StubPricingModel:
    feature_names_in_ = FEATURE_ORDER
    n_features_in_ = len(FEATURE_ORDER)

    def predict(self, frame):
        assert list(frame.columns) == list(FEATURE_ORDER)
        assert frame.iloc[0].tolist() == pytest.approx(
            [
                21,
                -0.5,
                -0.8660254038,
                -0.4338837391,
                -0.9009688679,
                3,
                2,
                0.6666666667,
                2,
            ]
        )
        return [3.75]


class NonFinitePricingModel:
    feature_names_in_ = FEATURE_ORDER
    n_features_in_ = len(FEATURE_ORDER)

    def predict(self, frame):
        return [float("nan")]


class IncompatiblePricingModel:
    feature_names_in_ = tuple(reversed(FEATURE_ORDER))
    n_features_in_ = len(FEATURE_ORDER)

    def predict(self, frame):
        return [1.0]


@asynccontextmanager
async def client_for_model(model_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    application = create_app(Settings(model_path=model_path, log_level="DEBUG"))
    async with application.router.lifespan_context(application):
        transport = httpx.ASGITransport(app=application)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            yield client


@pytest.fixture
def model_path(tmp_path: Path) -> Path:
    path = tmp_path / "pricing-model.pkl"
    joblib.dump(
        {
            "artifact_schema_version": MODEL_ARTIFACT_SCHEMA_VERSION,
            "model": StubPricingModel(),
            "metadata": {
                "model_version": "test-pricing-v1",
                "training_run_id": "test-run",
                "feature_contract": feature_contract_metadata(),
                "evaluation": {"mae": 0.1},
            },
        },
        path,
    )
    return path


@pytest.mark.asyncio
async def test_valid_prediction_and_ready_health(model_path: Path) -> None:
    async with client_for_model(model_path) as client:
        assert (await client.get("/health/live")).json() == {"status": "alive"}

        for path in ("/health", "/api/v1/health"):
            response = await client.get(path)
            assert response.status_code == 200
            assert response.json() == {"status": "ok"}

        response = await client.post(
            "/api/v1/predict-price",
            json={
                "lead_time": 21,
                "check_in_date": "2026-08-14",
                "check_out_date": "2026-08-17",
                "guest_count": 2,
            },
        )

    assert response.status_code == 200
    assert response.json() == {
        "status": "success",
        "ai_multiplier": 3.0,
        "model_version": "test-pricing-v1",
        "training_run_id": "test-run",
        "feature_contract_version": FEATURE_CONTRACT_VERSION,
        "features": {
            "lead_time": 21,
            "arrival_month_sin": -0.5,
            "arrival_month_cos": -0.8660254038,
            "arrival_weekday_sin": -0.4338837391,
            "arrival_weekday_cos": -0.9009688679,
            "stay_nights": 3,
            "weekend_nights": 2,
            "weekend_share": 0.6666666667,
            "guest_count": 2,
        },
        "message": "Dynamic price multiplier calculated.",
    }


@pytest.mark.asyncio
async def test_model_info_exports_contract_and_evaluation(model_path: Path) -> None:
    async with client_for_model(model_path) as client:
        response = await client.get("/api/v1/model-info")

    assert response.status_code == 200
    metadata = response.json()["metadata"]
    assert metadata["artifact_schema_version"] == MODEL_ARTIFACT_SCHEMA_VERSION
    assert metadata["model_version"] == "test-pricing-v1"
    assert metadata["training_run_id"] == "test-run"
    assert metadata["feature_contract"]["version"] == FEATURE_CONTRACT_VERSION
    assert metadata["feature_contract"]["feature_order"] == list(FEATURE_ORDER)
    assert metadata["evaluation"] == {"mae": 0.1}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "invalid_field,invalid_value",
    [
        ("lead_time", -1),
        ("check_out_date", "2026-08-14"),
        ("guest_count", 0),
    ],
)
async def test_invalid_payload_returns_422(
    model_path: Path,
    invalid_field: str,
    invalid_value: int | str,
) -> None:
    payload = {
        "lead_time": 21,
        "check_in_date": "2026-08-14",
        "check_out_date": "2026-08-17",
        "guest_count": 2,
    }
    payload[invalid_field] = invalid_value

    async with client_for_model(model_path) as client:
        response = await client.post("/api/v1/predict-price", json=payload)

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_unavailable_model_keeps_liveness_but_fails_readiness_and_prediction(
    tmp_path: Path,
) -> None:
    missing_model = tmp_path / "missing.pkl"

    async with client_for_model(missing_model) as client:
        live_response = await client.get("/health/live")
        readiness_responses = [
            await client.get("/health"),
            await client.get("/api/v1/health"),
        ]
        model_info_response = await client.get("/api/v1/model-info")
        prediction_response = await client.post(
            "/api/v1/predict-price",
            json={
                "lead_time": 21,
                "check_in_date": "2026-08-14",
                "check_out_date": "2026-08-17",
                "guest_count": 2,
            },
        )

    assert live_response.status_code == 200
    assert live_response.json() == {"status": "alive"}
    for response in readiness_responses:
        assert response.status_code == 503
        assert response.json() == {"status": "model_unavailable"}
    assert prediction_response.status_code == 503
    assert prediction_response.json() == {"detail": "Pricing model is unavailable."}
    assert model_info_response.status_code == 503


@pytest.mark.asyncio
async def test_incompatible_model_is_rejected_during_startup(tmp_path: Path) -> None:
    incompatible_model = tmp_path / "incompatible.pkl"
    joblib.dump(IncompatiblePricingModel(), incompatible_model)

    async with client_for_model(incompatible_model) as client:
        readiness_response = await client.get("/health")
        live_response = await client.get("/health/live")

    assert live_response.status_code == 200
    assert readiness_response.status_code == 503
    assert readiness_response.json() == {"status": "model_unavailable"}


@pytest.mark.asyncio
async def test_non_finite_prediction_returns_controlled_500(tmp_path: Path) -> None:
    non_finite_model = tmp_path / "non-finite.pkl"
    joblib.dump(NonFinitePricingModel(), non_finite_model)

    async with client_for_model(non_finite_model) as client:
        assert (await client.get("/health")).status_code == 200
        response = await client.post(
            "/api/v1/predict-price",
            json={
                "lead_time": 21,
                "check_in_date": "2026-08-14",
                "check_out_date": "2026-08-17",
                "guest_count": 2,
            },
        )

    assert response.status_code == 500
    assert response.json() == {"detail": "Pricing inference failed."}
