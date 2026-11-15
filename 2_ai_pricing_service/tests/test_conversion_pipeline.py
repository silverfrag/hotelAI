from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import joblib
import pandas as pd
import pytest

from app.services.conversion_inference import ConversionInferenceService
from app.training.conversion_training import (
    ReadinessThresholds,
    TrainingConfig,
    prepare_training_data,
    run_pipeline,
)


def synthetic_export(rows: int = 240) -> pd.DataFrame:
    start = datetime(2026, 1, 1, tzinfo=UTC)
    values: list[dict[str, object]] = []
    for index in range(rows):
        exposed_at = start + timedelta(hours=index * 6)
        check_in = exposed_at.date() + timedelta(days=14 + index % 10)
        ratio = 0.78 if index % 4 in (0, 1) else 1.42
        accepted = ratio < 1
        values.append(
            {
                "quote_id": f"00000000-0000-4000-8000-{index:012d}",
                "room_type_name_snapshot": "Standard" if index % 2 == 0 else "Suite",
                "capacity_snapshot": 3,
                "check_in_date": check_in.isoformat(),
                "check_out_date": (check_in + timedelta(days=2)).isoformat(),
                "guest_count": 2,
                "lead_time": 14 + index % 10,
                "rooms_available": 7,
                "rooms_sellable_snapshot": 10,
                "rooms_booked_snapshot": 3,
                "occupancy_ratio_snapshot": 0.3,
                "base_price": 1_000_000,
                "nightly_price": 1_000_000 * ratio,
                "currency": "VND",
                "pricing_source": "ai",
                # Simulate the shape of a verified collection in unit tests only.
                # These generated fixtures are never a production training export.
                "ai_model_version": "random_forest_v2",
                "data_provenance": "observed",
                "provenance_reference": "unit-test-only-collection",
                "exposure_at": exposed_at.isoformat(),
                "exposure_confirmed": True,
                "acceptance_label": accepted,
                "inventory_snapshot_consistent": True,
                "has_disposition_conflict": False,
            }
        )
    return pd.DataFrame(values)


@pytest.mark.parametrize("provenance", ["synthetic", "test", "demo", "fixture", "unverified", "", None])
def test_unverified_or_generated_exposures_never_enter_training(provenance: str | None) -> None:
    source = synthetic_export(12)
    source["data_provenance"] = provenance
    prepared, report = prepare_training_data(source, ReadinessThresholds(4, 2, 2, 1))

    assert prepared.empty
    assert report["verified_observed_rows"] == 0
    assert report["eligible_rows"] == 0
    assert report["passes_readiness_gate"] is False


def test_known_mock_model_is_excluded_even_with_observed_claim() -> None:
    source = synthetic_export(12)
    source.loc[:5, "ai_model_version"] = "random_forest_v2_mock"
    prepared, report = prepare_training_data(source, ReadinessThresholds(4, 2, 2, 1))

    assert len(prepared) == 6
    assert report["synthetic_or_test_rows"] == 6
    assert report["verified_observed_rows"] == 6
    assert set(prepared["_quote_id"]) == set(source.loc[6:, "quote_id"])


@pytest.mark.parametrize("missing", ["ai_model_version", "data_provenance", "provenance_reference"])
def test_legacy_export_missing_provenance_cannot_pass_readiness(missing: str) -> None:
    source = synthetic_export(12).drop(columns=missing)
    prepared, report = prepare_training_data(source, ReadinessThresholds(4, 2, 2, 1))

    assert prepared.empty
    assert report["missing_provenance_columns"] == [missing]
    assert report["unverified_provenance_rows"] == 12
    assert report["passes_readiness_gate"] is False


@pytest.mark.parametrize("reference", ["", "  ", None])
def test_observed_claim_requires_collection_reference(reference: str | None) -> None:
    source = synthetic_export(12)
    source["provenance_reference"] = reference
    prepared, report = prepare_training_data(source, ReadinessThresholds(4, 2, 2, 1))

    assert prepared.empty
    assert report["unverified_provenance_rows"] == 12


def test_generated_dataset_never_trains_or_overwrites_artifact(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = synthetic_export()
    source["ai_model_version"] = "random_forest_v2_mock"
    data_path = tmp_path / "quotes.csv"
    source.to_csv(data_path, index=False)
    artifact_path = tmp_path / "challenger.pkl"
    artifact_path.write_bytes(b"keep-existing-artifact")

    def unexpected_training(*args: object, **kwargs: object) -> None:
        pytest.fail("Synthetic observations must be rejected before training")

    monkeypatch.setattr("app.training.conversion_training.train_and_evaluate", unexpected_training)
    report = run_pipeline(
        data_path=data_path,
        output_path=artifact_path,
        readiness_report_path=tmp_path / "readiness.json",
        thresholds=ReadinessThresholds(4, 2, 2, 1),
    )

    assert report["status"] == "insufficient_data"
    assert report["data_quality"]["synthetic_or_test_rows"] == len(source)
    assert artifact_path.read_bytes() == b"keep-existing-artifact"


def test_preparation_never_turns_open_or_proxy_quotes_into_negatives() -> None:
    source = synthetic_export(12)
    source["acceptance_label"] = source["acceptance_label"].astype(object)
    source.loc[0, "exposure_confirmed"] = False
    source.loc[1, "acceptance_label"] = None
    source.loc[2, "inventory_snapshot_consistent"] = False
    source.loc[3, "has_disposition_conflict"] = True
    prepared, report = prepare_training_data(
        source,
        ReadinessThresholds(4, 2, 2, 1),
    )

    assert len(prepared) == 8
    assert report["generated_proxy_or_unconfirmed_rows"] == 1
    assert report["open_or_unmatured_label_rows"] == 1
    assert report["missing_or_inconsistent_inventory_rows"] == 1
    assert report["disposition_conflict_rows"] == 1
    assert report["passes_readiness_gate"] is True


def test_insufficient_data_writes_report_without_overwriting_artifact(
    tmp_path: Path,
) -> None:
    data_path = tmp_path / "quotes.csv"
    artifact_path = tmp_path / "challenger.pkl"
    report_path = tmp_path / "readiness.json"
    synthetic_export(20).to_csv(data_path, index=False)
    artifact_path.write_bytes(b"keep-existing-artifact")

    report = run_pipeline(
        data_path=data_path,
        output_path=artifact_path,
        readiness_report_path=report_path,
    )

    assert report["status"] == "insufficient_data"
    assert report_path.is_file()
    assert artifact_path.read_bytes() == b"keep-existing-artifact"


def test_ready_dataset_trains_versioned_shadow_only_artifact(tmp_path: Path) -> None:
    data_path = tmp_path / "quotes.csv"
    artifact_path = tmp_path / "challenger.pkl"
    report_path = tmp_path / "readiness.json"
    synthetic_export().to_csv(data_path, index=False)

    report = run_pipeline(
        data_path=data_path,
        output_path=artifact_path,
        readiness_report_path=report_path,
        thresholds=ReadinessThresholds(200, 80, 80, 28),
        config=TrainingConfig(holdout_fraction=0.2),
    )

    assert report["status"] == "artifact_written"
    artifact = joblib.load(artifact_path)
    assert artifact["metadata"]["lifecycle_stage"] == "shadow_only"
    assert artifact["metadata"]["data_quality"]["passes_readiness_gate"] is True
    assert artifact["metadata"]["evaluation"]["passes_performance_gate"] is True
    service = ConversionInferenceService(artifact_path)
    service.load()
    assert service.is_ready is True
