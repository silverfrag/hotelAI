from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.api.endpoints.academic import router
from app.services.academic_inference import AcademicInferenceService


@pytest.fixture(scope="module")
def client():
    app = FastAPI(); app.include_router(router)
    service = AcademicInferenceService(); service.load(); service.require_ready()
    app.state.academic_inference = service
    with TestClient(app) as client:
        yield client


def input_from_holdout(client):
    row = client.get("/api/v1/academic/holdout?limit=1").json()["rows"][0]
    response = client.post("/api/v1/academic/experiment",json={"task":"adr","row_id":row["row_id"]})
    assert response.status_code==200
    return response.json()["input"]


def test_decision_contract_and_real_holdout(client):
    payload = input_from_holdout(client)
    response = client.post("/api/v1/academic/decision",json=payload)
    assert response.status_code==200
    body=response.json()
    assert body["status"]=="success" and body["adr_unit"]=="EUR"
    assert body["adr_reference"]>0 and 0<=body["cancellation_probability"]<=1
    assert "optimal_price" not in body
    assert body["business_rules"][1]["applied"] is False
    assert client.get("/api/v1/academic/info").json()["tasks"]["adr"]["selection_partition"]=="validation"
    assert client.post("/api/v1/academic/experiment",json={"task":"adr","row_id":"booking-999999"}).status_code==404


@pytest.mark.parametrize("change",[{"is_canceled":1},{"occupancy_ratio":.9},{"adults":0},
    {"lead_time":-1},{"lead_time":1.5},{"stay_nights":0},{"arrival_date":"2017-02-30"},
    {"hotel":"Aurum Vietnam"},{"arrival_date":"bad"}])
def test_invalid_and_leaking_inputs_fail_422(client,change):
    payload=input_from_holdout(client);payload.update(change)
    assert client.post("/api/v1/academic/decision",json=payload).status_code==422


def test_missing_required_and_explicit_optional_imputation(client):
    payload=input_from_holdout(client);payload.pop("adults")
    assert client.post("/api/v1/academic/decision",json=payload).status_code==422
    payload=input_from_holdout(client);payload.pop("children")
    result=client.post("/api/v1/academic/decision",json=payload)
    assert result.status_code==200 and "missing children" in " ".join(result.json()["warnings"])
    assert client.get("/api/v1/academic/holdout?limit=101").status_code==422
    assert client.get("/api/v1/academic/holdout?task=conversion").status_code==422


def test_missing_artifact_returns_503_without_fabricating_predictions(tmp_path):
    app=FastAPI();app.include_router(router)
    app.state.academic_inference=AcademicInferenceService(tmp_path)
    with TestClient(app) as client:
        assert client.get("/api/v1/academic/info").status_code==503
