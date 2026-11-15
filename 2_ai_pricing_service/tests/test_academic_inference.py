import json

import numpy as np
import pytest

from app.schemas.academic_schema import AcademicBookingRequest
from app.services.academic_inference import AcademicInferenceService, AcademicUnavailableError


@pytest.fixture
def service():
    service = AcademicInferenceService()
    service.load()
    service.require_ready()
    return service


def test_persisted_models_match_frozen_holdout_and_explain(service):
    for task in ("adr","cancellation"):
        row = service.holdout[task][100]
        result = service.experiment(task,row["row_id"])
        value = result["decision"]["adr_reference" if task=="adr" else "cancellation_probability"]
        assert value == pytest.approx(row["prediction"],abs=1e-9)
        assert result["decision"]["prediction_sources"][task].startswith("ml:")
        assert len(result["decision"]["explanation"][task])==10
        assert result["partition"]=="test" and not result["decision"]["hypothetical"]
    assert service.info()["tasks"]["cancellation"]["target"]=="is_canceled"


def test_unknown_missing_and_outside_source_period_are_explicit(service):
    row = service.experiment("adr",service.holdout["adr"][0]["row_id"])["input"]
    row.update(arrival_date="2026-10-26",children=None,reserved_room_type="UNSEEN",lead_time=999)
    result = service.decide(AcademicBookingRequest(**row))
    warnings = " ".join(result["warnings"])
    assert "unknown" in warnings and "missing children" in warnings
    assert "outside training range" in warnings and "2015–2017" in warnings
    assert np.isfinite(result["adr_reference"])
    assert 0 <= result["cancellation_probability"] <= 1


def test_failure_uses_labelled_baseline_and_never_masquerades_as_ml(service):
    class Broken:
        def predict(self,X):
            raise RuntimeError("fixture failure")
    row = service.experiment("adr",service.holdout["adr"][0]["row_id"])["input"]
    adr = service.bundle["tasks"]["adr"]
    adr["models"][adr["selected"]]=Broken()
    result = service.decide(AcademicBookingRequest(**row))
    assert result["status"]=="degraded"
    assert result["adr_reference"]==result["baselines"]["adr"]
    assert result["prediction_sources"]["adr"]=="fallback_baseline:seasonal_room_median"
    assert result["explanation"]["adr"]==[]


def test_checksum_failure_and_missing_artifact_are_unavailable(tmp_path):
    (tmp_path/"manifest.json").write_text(json.dumps({"files":{"bundle.joblib":"wrong"}}))
    (tmp_path/"bundle.joblib").write_bytes(b"not a model")
    service = AcademicInferenceService(tmp_path)
    service.load()
    with pytest.raises(AcademicUnavailableError):
        service.require_ready()
