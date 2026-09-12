from __future__ import annotations

import hashlib
import json
import math
import os
import platform
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    log_loss,
    roc_auc_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from app.core.conversion_feature_contract import (
    CONVERSION_CATEGORICAL_FEATURE_ORDER,
    CONVERSION_FEATURE_ORDER,
    CONVERSION_NUMERIC_FEATURE_ORDER,
    CAUSALITY_WARNING,
    build_conversion_features,
    conversion_feature_contract_metadata,
)
from app.services.conversion_inference import CONVERSION_ARTIFACT_SCHEMA_VERSION

TARGET_COLUMN: Final = "acceptance_label"
EXPOSURE_COLUMN: Final = "exposure_at"
DEFAULT_MODEL_VERSION: Final = "conversion_challenger_v1"
REQUIRED_COLUMNS: Final[frozenset[str]] = frozenset(
    {
        "quote_id",
        "room_type_name_snapshot",
        "capacity_snapshot",
        "check_in_date",
        "check_out_date",
        "guest_count",
        "lead_time",
        "rooms_available",
        "rooms_sellable_snapshot",
        "rooms_booked_snapshot",
        "occupancy_ratio_snapshot",
        "base_price",
        "nightly_price",
        "currency",
        "pricing_source",
        EXPOSURE_COLUMN,
        "exposure_confirmed",
        TARGET_COLUMN,
        "inventory_snapshot_consistent",
        "has_disposition_conflict",
    }
)


@dataclass(frozen=True, slots=True)
class ReadinessThresholds:
    minimum_eligible_rows: int = 2_000
    minimum_positive_labels: int = 200
    minimum_negative_labels: int = 200
    minimum_exposure_days: int = 28


@dataclass(frozen=True, slots=True)
class TrainingConfig:
    holdout_fraction: float = 0.2
    random_seed: int = 42
    maximum_iterations: int = 1_000
    calibration_bins: int = 10


def _normalize_boolean(series: pd.Series, *, nullable: bool) -> pd.Series:
    mapping = {
        True: True,
        False: False,
        1: True,
        0: False,
        "1": True,
        "0": False,
        "true": True,
        "false": False,
        "t": True,
        "f": False,
        "yes": True,
        "no": False,
    }

    def normalize(value: object) -> object:
        if pd.isna(value):
            return pd.NA if nullable else False
        key = value.strip().lower() if isinstance(value, str) else value
        if key not in mapping:
            raise ValueError(f"Unsupported boolean value: {value!r}")
        return mapping[key]

    dtype = "boolean" if nullable else "bool"
    return series.map(normalize).astype(dtype)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_training_export(path: str | Path) -> pd.DataFrame:
    source = Path(path)
    if not source.is_file():
        raise FileNotFoundError(f"Training export does not exist: {source}")
    frame = pd.read_csv(source)
    missing = REQUIRED_COLUMNS.difference(frame.columns)
    if missing:
        raise ValueError(f"Training export is missing columns: {sorted(missing)}")
    return frame


def prepare_training_data(
    source: pd.DataFrame,
    thresholds: ReadinessThresholds = ReadinessThresholds(),
) -> tuple[pd.DataFrame, dict[str, Any]]:
    missing = REQUIRED_COLUMNS.difference(source.columns)
    if missing:
        raise ValueError(f"Training export is missing columns: {sorted(missing)}")

    frame = source.copy()
    frame["exposure_confirmed"] = _normalize_boolean(
        frame["exposure_confirmed"], nullable=False
    )
    frame["inventory_snapshot_consistent"] = _normalize_boolean(
        frame["inventory_snapshot_consistent"], nullable=True
    )
    frame["has_disposition_conflict"] = _normalize_boolean(
        frame["has_disposition_conflict"], nullable=False
    )
    frame[TARGET_COLUMN] = _normalize_boolean(frame[TARGET_COLUMN], nullable=True)
    frame[EXPOSURE_COLUMN] = pd.to_datetime(
        frame[EXPOSURE_COLUMN], utc=True, errors="coerce"
    )
    frame["check_in_date"] = pd.to_datetime(
        frame["check_in_date"], errors="coerce"
    ).dt.date
    frame["check_out_date"] = pd.to_datetime(
        frame["check_out_date"], errors="coerce"
    ).dt.date

    duplicate_quotes = frame["quote_id"].duplicated(keep=False)
    confirmed = frame["exposure_confirmed"]
    mature = frame[TARGET_COLUMN].notna()
    inventory_valid = frame["inventory_snapshot_consistent"].fillna(False).astype(bool)
    conflict_free = ~frame["has_disposition_conflict"]
    has_dates = (
        frame[EXPOSURE_COLUMN].notna()
        & frame["check_in_date"].notna()
        & frame["check_out_date"].notna()
    )
    candidate_mask = (
        confirmed
        & mature
        & inventory_valid
        & conflict_free
        & ~duplicate_quotes
        & has_dates
    )

    feature_rows: list[dict[str, Any]] = []
    invalid_feature_rows = 0
    for index, row in frame.loc[candidate_mask].iterrows():
        try:
            features = build_conversion_features(
                lead_time=int(row["lead_time"]),
                check_in=row["check_in_date"],
                check_out=row["check_out_date"],
                guest_count=int(row["guest_count"]),
                capacity_snapshot=int(row["capacity_snapshot"]),
                rooms_available=int(row["rooms_available"]),
                rooms_sellable_snapshot=int(row["rooms_sellable_snapshot"]),
                rooms_booked_snapshot=int(row["rooms_booked_snapshot"]),
                occupancy_ratio_snapshot=float(row["occupancy_ratio_snapshot"]),
                base_price=float(row["base_price"]),
                offered_nightly_price=float(row["nightly_price"]),
                room_type_name=str(row["room_type_name_snapshot"]),
                currency=str(row["currency"]),
                pricing_source=str(row["pricing_source"]),
            )
        except (TypeError, ValueError, OverflowError):
            invalid_feature_rows += 1
            continue
        feature_rows.append(
            {
                **features,
                "_quote_id": str(row["quote_id"]),
                "_exposure_at": row[EXPOSURE_COLUMN],
                "_target": int(bool(row[TARGET_COLUMN])),
            }
        )

    prepared = pd.DataFrame(
        feature_rows,
        columns=[*CONVERSION_FEATURE_ORDER, "_quote_id", "_exposure_at", "_target"],
    )
    positive_labels = int(prepared["_target"].sum()) if not prepared.empty else 0
    negative_labels = int(len(prepared) - positive_labels)
    exposure_days = (
        int(prepared["_exposure_at"].dt.date.nunique()) if not prepared.empty else 0
    )
    room_type_counts = (
        prepared.groupby("room_type_name")["_target"]
        .agg(rows="size", positive="sum")
        .assign(negative=lambda value: value["rows"] - value["positive"])
        .astype(int)
        .to_dict(orient="index")
        if not prepared.empty
        else {}
    )
    gate_checks = {
        "minimum_eligible_rows": len(prepared) >= thresholds.minimum_eligible_rows,
        "minimum_positive_labels": positive_labels
        >= thresholds.minimum_positive_labels,
        "minimum_negative_labels": negative_labels
        >= thresholds.minimum_negative_labels,
        "minimum_exposure_days": exposure_days >= thresholds.minimum_exposure_days,
        "no_duplicate_quotes": int(duplicate_quotes.sum()) == 0,
        "no_invalid_feature_rows": invalid_feature_rows == 0,
    }
    report: dict[str, Any] = {
        "status": "ready" if all(gate_checks.values()) else "insufficient_data",
        "source_rows": int(len(frame)),
        "confirmed_exposure_rows": int(confirmed.sum()),
        "generated_proxy_or_unconfirmed_rows": int((~confirmed).sum()),
        "open_or_unmatured_label_rows": int((~mature).sum()),
        "disposition_conflict_rows": int(frame["has_disposition_conflict"].sum()),
        "missing_or_inconsistent_inventory_rows": int((~inventory_valid).sum()),
        "duplicate_quote_rows": int(duplicate_quotes.sum()),
        "missing_or_invalid_date_rows": int((~has_dates).sum()),
        "invalid_feature_rows": invalid_feature_rows,
        "eligible_rows": int(len(prepared)),
        "positive_labels": positive_labels,
        "negative_labels": negative_labels,
        "distinct_exposure_days": exposure_days,
        "room_type_counts": room_type_counts,
        "thresholds": asdict(thresholds),
        "checks": gate_checks,
        "passes_readiness_gate": all(gate_checks.values()),
        "filter": (
            "exposure_confirmed = true AND acceptance_label IS NOT NULL AND "
            "inventory_snapshot_consistent = true AND "
            "has_disposition_conflict = false AND quote_id is unique"
        ),
    }
    return prepared.sort_values("_exposure_at", kind="mergesort"), report


def chronological_split(
    frame: pd.DataFrame, holdout_fraction: float
) -> tuple[pd.DataFrame, pd.DataFrame]:
    if not 0 < holdout_fraction < 1:
        raise ValueError("holdout_fraction must be between zero and one")
    if len(frame) < 2 or frame["_exposure_at"].nunique() < 2:
        raise ValueError("At least two distinct exposure timestamps are required")
    ordered = frame.sort_values("_exposure_at", kind="mergesort")
    first_holdout = min(max(int(len(ordered) * (1 - holdout_fraction)), 1), len(ordered) - 1)
    cutoff = ordered.iloc[first_holdout]["_exposure_at"]
    training = ordered.loc[ordered["_exposure_at"] < cutoff].copy()
    holdout = ordered.loc[ordered["_exposure_at"] >= cutoff].copy()
    if training.empty or holdout.empty:
        raise ValueError("Chronological split produced an empty partition")
    return training, holdout


def build_estimator(config: TrainingConfig) -> Pipeline:
    preprocessing = ColumnTransformer(
        transformers=[
            (
                "numeric",
                Pipeline(
                    [
                        ("impute", SimpleImputer(strategy="median")),
                        ("scale", StandardScaler()),
                    ]
                ),
                list(CONVERSION_NUMERIC_FEATURE_ORDER),
            ),
            (
                "categorical",
                OneHotEncoder(handle_unknown="ignore"),
                list(CONVERSION_CATEGORICAL_FEATURE_ORDER),
            ),
        ],
        remainder="drop",
    )
    return Pipeline(
        [
            ("features", preprocessing),
            (
                "classifier",
                LogisticRegression(
                    max_iter=config.maximum_iterations,
                    random_state=config.random_seed,
                    class_weight="balanced",
                ),
            ),
        ]
    )


def _calibration_report(
    labels: np.ndarray, probabilities: np.ndarray, bins: int
) -> list[dict[str, float | int]]:
    boundaries = np.linspace(0, 1, bins + 1)
    bucket_ids = np.minimum(np.digitize(probabilities, boundaries[1:-1]), bins - 1)
    result: list[dict[str, float | int]] = []
    for bucket in range(bins):
        selected = bucket_ids == bucket
        if not selected.any():
            continue
        result.append(
            {
                "bin": bucket,
                "rows": int(selected.sum()),
                "mean_predicted_probability": round(float(probabilities[selected].mean()), 6),
                "observed_conversion_rate": round(float(labels[selected].mean()), 6),
            }
        )
    return result


def _slice_metrics(frame: pd.DataFrame, probabilities: np.ndarray) -> dict[str, Any]:
    output: dict[str, Any] = {}
    working = frame.reset_index(drop=True).copy()
    working["_probability"] = probabilities
    try:
        working["_price_band"] = pd.qcut(
            working["offered_price_ratio"], q=4, duplicates="drop"
        ).astype(str)
    except ValueError:
        working["_price_band"] = "single_band"
    for field in ("room_type_name", "_price_band"):
        slices: dict[str, Any] = {}
        for name, group in working.groupby(field, observed=True):
            labels = group["_target"].to_numpy(dtype=int)
            predicted = group["_probability"].to_numpy(dtype=float)
            slices[str(name)] = {
                "rows": int(len(group)),
                "positive_labels": int(labels.sum()),
                "brier_score": round(float(brier_score_loss(labels, predicted)), 6),
                "log_loss": round(float(log_loss(labels, predicted, labels=[0, 1])), 6),
            }
        output["by_room_type" if field == "room_type_name" else "by_price_band"] = slices
    return output


def train_and_evaluate(
    prepared: pd.DataFrame,
    config: TrainingConfig = TrainingConfig(),
) -> tuple[Pipeline | None, dict[str, Any]]:
    training, holdout = chronological_split(prepared, config.holdout_fraction)
    train_classes = sorted(training["_target"].unique().tolist())
    holdout_classes = sorted(holdout["_target"].unique().tolist())
    split = {
        "strategy": "chronological_by_exposure_at",
        "cutoff_at": holdout["_exposure_at"].min().isoformat(),
        "training_rows": int(len(training)),
        "holdout_rows": int(len(holdout)),
        "training_classes": train_classes,
        "holdout_classes": holdout_classes,
        "training_range": [
            training["_exposure_at"].min().isoformat(),
            training["_exposure_at"].max().isoformat(),
        ],
        "holdout_range": [
            holdout["_exposure_at"].min().isoformat(),
            holdout["_exposure_at"].max().isoformat(),
        ],
    }
    if train_classes != [0, 1] or holdout_classes != [0, 1]:
        return None, {
            "split": split,
            "passes_performance_gate": False,
            "gate_failure": "chronological partitions must both contain positive and negative labels",
        }

    model = build_estimator(config)
    model.fit(training.loc[:, list(CONVERSION_FEATURE_ORDER)], training["_target"])
    probabilities = model.predict_proba(
        holdout.loc[:, list(CONVERSION_FEATURE_ORDER)]
    )[:, 1]
    labels = holdout["_target"].to_numpy(dtype=int)
    baseline_probability = float(training["_target"].mean())
    baseline_predictions = np.full(len(holdout), baseline_probability)
    candidate_log_loss = float(log_loss(labels, probabilities, labels=[0, 1]))
    baseline_log_loss = float(log_loss(labels, baseline_predictions, labels=[0, 1]))
    candidate_brier = float(brier_score_loss(labels, probabilities))
    baseline_brier = float(brier_score_loss(labels, baseline_predictions))
    evaluation = {
        "split": split,
        "candidate": {
            "log_loss": round(candidate_log_loss, 6),
            "brier_score": round(candidate_brier, 6),
            "roc_auc": round(float(roc_auc_score(labels, probabilities)), 6),
            "pr_auc": round(float(average_precision_score(labels, probabilities)), 6),
            "calibration": _calibration_report(
                labels, probabilities, config.calibration_bins
            ),
            "slices": _slice_metrics(holdout, probabilities),
        },
        "baseline": {
            "strategy": "constant training-partition conversion rate",
            "probability": round(baseline_probability, 6),
            "log_loss": round(baseline_log_loss, 6),
            "brier_score": round(baseline_brier, 6),
        },
        "log_loss_improvement": round(baseline_log_loss - candidate_log_loss, 6),
        "brier_score_improvement": round(baseline_brier - candidate_brier, 6),
        "passes_performance_gate": (
            math.isfinite(candidate_log_loss)
            and math.isfinite(candidate_brier)
            and candidate_log_loss < baseline_log_loss
            and candidate_brier < baseline_brier
        ),
        "causality_warning": CAUSALITY_WARNING,
    }
    return model, evaluation


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(
        json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def run_pipeline(
    *,
    data_path: Path,
    output_path: Path,
    readiness_report_path: Path,
    model_version: str = DEFAULT_MODEL_VERSION,
    thresholds: ReadinessThresholds = ReadinessThresholds(),
    config: TrainingConfig = TrainingConfig(),
) -> dict[str, Any]:
    source = load_training_export(data_path)
    prepared, data_quality = prepare_training_data(source, thresholds)
    report: dict[str, Any] = {
        "pipeline": "conversion_challenger",
        "created_at_utc": datetime.now(UTC).isoformat(),
        "model_version": model_version,
        "data_quality": data_quality,
        "feature_contract": conversion_feature_contract_metadata(),
        "causality_warning": CAUSALITY_WARNING,
    }
    if not data_quality["passes_readiness_gate"]:
        report["status"] = "insufficient_data"
        _atomic_json(readiness_report_path, report)
        return report

    model, evaluation = train_and_evaluate(prepared, config)
    report["evaluation"] = evaluation
    if model is None or not evaluation["passes_performance_gate"]:
        report["status"] = "performance_gate_failed"
        _atomic_json(readiness_report_path, report)
        return report

    data_sha256 = sha256_file(data_path)
    reproducibility = {
        "data_sha256": data_sha256,
        "feature_contract": conversion_feature_contract_metadata(),
        "training_config": asdict(config),
        "thresholds": asdict(thresholds),
        "model_version": model_version,
    }
    training_run_id = hashlib.sha256(
        json.dumps(reproducibility, sort_keys=True).encode("utf-8")
    ).hexdigest()[:16]
    metadata = {
        "model_kind": "conversion_challenger",
        "model_version": model_version,
        "training_run_id": training_run_id,
        "lifecycle_stage": "shadow_only",
        "created_at_utc": datetime.now(UTC).isoformat(),
        "feature_contract": conversion_feature_contract_metadata(),
        "data_quality": data_quality,
        "evaluation": evaluation,
        "training": {
            "configuration": asdict(config),
            "estimator": type(model).__name__,
            "data_sha256": data_sha256,
        },
        "runtime": {
            "python": platform.python_version(),
            "pandas": pd.__version__,
            "scikit_learn": sklearn.__version__,
            "joblib": joblib.__version__,
        },
        "causality_warning": CAUSALITY_WARNING,
    }
    artifact = {
        "artifact_schema_version": CONVERSION_ARTIFACT_SCHEMA_VERSION,
        "model": model,
        "metadata": metadata,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_artifact = output_path.with_suffix(f"{output_path.suffix}.tmp")
    joblib.dump(artifact, temporary_artifact, compress=3)
    os.replace(temporary_artifact, output_path)
    _atomic_json(output_path.with_suffix(".metadata.json"), {
        "artifact_schema_version": CONVERSION_ARTIFACT_SCHEMA_VERSION,
        **metadata,
    })
    report.update(
        {
            "status": "artifact_written",
            "training_run_id": training_run_id,
            "artifact_path": str(output_path.resolve()),
        }
    )
    _atomic_json(readiness_report_path, report)
    return report
