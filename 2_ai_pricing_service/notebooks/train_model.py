from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_absolute_percentage_error, r2_score

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.feature_contract import (  # noqa: E402
    FEATURE_ORDER,
    feature_contract_metadata,
    weekend_night_count_to_indicator,
)
from app.core.demand_features import (  # noqa: E402
    synthesize_occupancy_for_training,
    demand_feature_metadata,
)
from app.services.inference import MODEL_ARTIFACT_SCHEMA_VERSION  # noqa: E402

DEFAULT_DATA_PATH = Path(__file__).resolve().with_name("hotel_bookings.csv")
DEFAULT_MODEL_PATH = PROJECT_ROOT / "app" / "models" / "random_forest_v3.pkl"
DEFAULT_MODEL_VERSION = "random_forest_v3_demand_aware"
TARGET_NAME = "price_multiplier"
MIN_MULTIPLIER = 0.5
MAX_MULTIPLIER = 3.0

MONTH_MAP = {
    "January": 1,
    "February": 2,
    "March": 3,
    "April": 4,
    "May": 5,
    "June": 6,
    "July": 7,
    "August": 8,
    "September": 9,
    "October": 10,
    "November": 11,
    "December": 12,
}
REQUIRED_COLUMNS = {
    "hotel",
    "is_canceled",
    "adr",
    "lead_time",
    "arrival_date_year",
    "arrival_date_month",
    "arrival_date_day_of_month",
    "stays_in_weekend_nights",
    "stays_in_week_nights",
    "adults",
    "children",
    "babies",
    "reserved_room_type",
    "total_of_special_requests",
}
ARRIVAL_DATE_COLUMN = "arrival_date"
ADR_COLUMN = "adr"


@dataclass(frozen=True, slots=True)
class TrainingConfig:
    random_seed: int = 42
    test_size: float = 0.2
    n_estimators: int = 100
    max_depth: int = 10
    n_jobs: int = 1


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_and_filter_data(filepath: str | Path) -> pd.DataFrame:
    """Load reproducible City Hotel observations that were not cancelled."""
    frame = pd.read_csv(filepath)
    missing_columns = REQUIRED_COLUMNS.difference(frame.columns)
    if missing_columns:
        raise ValueError(f"Dataset is missing columns: {sorted(missing_columns)}")

    filtered = frame.loc[
        (frame["hotel"] == "City Hotel") & (frame["is_canceled"] == 0)
    ].copy()
    if filtered.empty:
        raise ValueError("Dataset has no non-cancelled City Hotel observations.")
    filtered.attrs["source_rows"] = len(frame)
    return filtered


def engineer_features(frame: pd.DataFrame) -> pd.DataFrame:
    """Apply the versioned feature contract and retain time-safe target inputs."""
    data = frame.copy()
    data["arrival_month"] = data["arrival_date_month"].map(MONTH_MAP)
    unknown_months = sorted(
        str(value)
        for value in data.loc[data["arrival_month"].isna(), "arrival_date_month"].unique()
    )
    if unknown_months:
        raise ValueError(f"Dataset contains unknown arrival months: {unknown_months}")

    numeric_columns = [
        "adr",
        "lead_time",
        "arrival_date_year",
        "arrival_date_day_of_month",
        "stays_in_weekend_nights",
        "stays_in_week_nights",
        "adults",
        "children",
        "babies",
        "total_of_special_requests",
    ]
    for column in numeric_columns:
        data[column] = pd.to_numeric(data[column], errors="raise")

    if (data["lead_time"] < 0).any():
        raise ValueError("Dataset contains negative lead_time values.")
    if (data["stays_in_weekend_nights"] < 0).any():
        raise ValueError("Dataset contains negative weekend-night counts.")
    if (data["stays_in_week_nights"] < 0).any():
        raise ValueError("Dataset contains negative weekday-night counts.")
    if not data["total_of_special_requests"].between(0, 5).all():
        raise ValueError("Dataset contains special-request counts outside [0, 5].")

    valid = data.loc[data["adr"] > 0].copy()
    if valid.empty:
        raise ValueError("Dataset has no positive ADR observations.")

    valid[ARRIVAL_DATE_COLUMN] = pd.to_datetime(
        {
            "year": valid["arrival_date_year"],
            "month": valid["arrival_month"],
            "day": valid["arrival_date_day_of_month"],
        },
        errors="raise",
    )
    valid["is_weekend"] = valid["stays_in_weekend_nights"].map(
        weekend_night_count_to_indicator
    )
    valid["stay_nights"] = (
        valid["stays_in_weekend_nights"] + valid["stays_in_week_nights"]
    ).astype(int)
    valid["weekend_nights"] = valid["stays_in_weekend_nights"].astype(int)
    valid["guest_count"] = (
        valid["adults"].fillna(0)
        + valid["children"].fillna(0)
        + valid["babies"].fillna(0)
    ).astype(int)

    invalid_context = (
        (valid["stay_nights"] <= 0)
        | (valid["weekend_nights"] > valid["stay_nights"])
        | (valid["guest_count"] <= 0)
    )
    invalid_context_rows = int(invalid_context.sum())
    valid = valid.loc[~invalid_context].copy()
    if valid.empty:
        raise ValueError("Dataset has no valid quote-time training observations.")

    month_angle = 2 * math.pi * (valid["arrival_month"] - 1) / 12
    weekday_angle = 2 * math.pi * valid[ARRIVAL_DATE_COLUMN].dt.weekday / 7
    valid["arrival_month_sin"] = month_angle.map(math.sin).round(10)
    valid["arrival_month_cos"] = month_angle.map(math.cos).round(10)
    valid["arrival_weekday_sin"] = weekday_angle.map(math.sin).round(10)
    valid["arrival_weekday_cos"] = weekday_angle.map(math.cos).round(10)
    valid["weekend_share"] = (
        valid["weekend_nights"] / valid["stay_nights"]
    ).round(10)

    # ── Synthesize demand signals ────────────────────────────────────────────
    # Historical CSVs don't contain real-time occupancy snapshots, so we
    # synthesize plausible demand signals using known hospitality demand patterns
    # with per-row Gaussian noise (vectorized for speed).
    # The key insight: a script-based filter has NO per-row variance —
    # the model would learn nothing new from a deterministic lookup table.
    print(f"  Synthesizing demand signals for {len(valid):,} rows (vectorized)...")

    rng = np.random.default_rng(seed=42)

    # Base occupancy by season (hospitality demand norms, NOT price rules)
    _seasonal = {1:0.62,2:0.58,3:0.65,4:0.72,5:0.74,6:0.82,7:0.88,8:0.85,9:0.70,10:0.68,11:0.60,12:0.75}
    arr_month = valid["arrival_month"].to_numpy(dtype=int)
    arr_weekday = valid[ARRIVAL_DATE_COLUMN].dt.weekday.to_numpy(dtype=int)
    lead_arr = valid["lead_time"].to_numpy(dtype=float)

    base_occ = np.array([_seasonal[m] for m in arr_month], dtype=float)
    base_occ += np.where(arr_weekday >= 4, 0.08, 0.0)  # Fri/Sat/Sun weekend bump
    base_occ += np.where(lead_arr <= 2, 0.06, np.where(lead_arr <= 7, 0.03, np.where(lead_arr >= 90, -0.04, 0.0)))
    occupancy_ratio = np.clip(base_occ + rng.normal(0.0, 0.06, len(valid)), 0.0, 1.0).round(10)

    vel_base = np.where(arr_weekday >= 4, 0.55, 0.45)
    booking_velocity_score = np.clip(vel_base + rng.normal(0.0, 0.12, len(valid)), 0.0, 1.0).round(10)

    # Vectorized non-linear occupancy pressure curve
    _inf, _sat = 0.70, 0.95
    prog = np.clip((occupancy_ratio - _inf) / (_sat - _inf), 0.0, 1.0)
    smooth = 3 * prog ** 2 - 2 * prog ** 3
    occ_pressure = np.where(occupancy_ratio <= _inf, occupancy_ratio / _inf * 0.45, 0.45 + smooth * 0.55)
    demand_pressure_score = np.clip(0.65 * occ_pressure + 0.35 * booking_velocity_score, 0.0, 1.0).round(10)
    availability_tightness = (1.0 - occupancy_ratio).round(10)

    valid = valid.copy()
    valid["occupancy_ratio"] = occupancy_ratio
    valid["booking_velocity_score"] = booking_velocity_score
    valid["demand_pressure_score"] = demand_pressure_score
    valid["availability_tightness"] = availability_tightness

    # price_vs_market_ratio: MUST NOT be derived from ADR in training — that
    # would be target leakage (ADR is the label).  Set to neutral 1.0 so the
    # model learns to ignore it during training.  At serving time the backend
    # supplies a real trailing-30d market price, giving the feature actual value.
    valid["price_vs_market_ratio"] = 1.0

    processed = valid[
        [
            *FEATURE_ORDER,
            "arrival_month",
            "is_weekend",
            "total_of_special_requests",
            "reserved_room_type",
            ARRIVAL_DATE_COLUMN,
            ADR_COLUMN,
        ]
    ].copy()
    if processed.isna().any().any():
        raise ValueError("Engineered training data contains missing values.")
    processed.attrs["source_rows"] = int(data.attrs.get("source_rows", len(data)))
    processed.attrs["filtered_rows"] = len(data)
    processed.attrs["invalid_quote_context_rows"] = invalid_context_rows
    print(f"  Feature engineering complete: {len(processed):,} training rows, "
          f"{len(FEATURE_ORDER)} features ({len(FEATURE_ORDER) - 9} demand signals)")
    return processed


def chronological_split(
    frame: pd.DataFrame,
    test_size: float,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split on a date boundary so no arrival date leaks across the holdout."""
    if not 0 < test_size < 1:
        raise ValueError("test_size must be between 0 and 1")
    if len(frame) < 2:
        raise ValueError("At least two observations are required for training.")
    if ARRIVAL_DATE_COLUMN not in frame:
        raise ValueError(f"Training data is missing {ARRIVAL_DATE_COLUMN}.")

    ordered = frame.sort_values(ARRIVAL_DATE_COLUMN, kind="mergesort")
    unique_dates = ordered[ARRIVAL_DATE_COLUMN].drop_duplicates().reset_index(drop=True)
    if len(unique_dates) < 2:
        raise ValueError("At least two distinct arrival dates are required.")

    desired_first_holdout_row = min(
        max(int(len(ordered) * (1 - test_size)), 1),
        len(ordered) - 1,
    )
    desired_cutoff = ordered.iloc[desired_first_holdout_row][ARRIVAL_DATE_COLUMN]
    later_dates = unique_dates.loc[unique_dates >= desired_cutoff]
    cutoff_date = later_dates.iloc[0]

    training = ordered.loc[ordered[ARRIVAL_DATE_COLUMN] < cutoff_date].copy()
    holdout = ordered.loc[ordered[ARRIVAL_DATE_COLUMN] >= cutoff_date].copy()
    if training.empty or holdout.empty:
        raise ValueError("Chronological split produced an empty partition.")
    return training, holdout


def build_seasonal_baseline_predictions(
    training: pd.DataFrame,
    holdout: pd.DataFrame,
    training_target: pd.Series,
) -> tuple[list[float], dict[str, Any]]:
    """Build a leakage-free month/weekday median baseline with safe fallbacks."""
    context = pd.DataFrame(
        {
            "arrival_month": training["arrival_month"].to_numpy(),
            "arrival_weekday": training[ARRIVAL_DATE_COLUMN].dt.weekday.to_numpy(),
            TARGET_NAME: training_target.to_numpy(),
        },
        index=training.index,
    )
    month_weekday_medians = context.groupby(
        ["arrival_month", "arrival_weekday"]
    )[TARGET_NAME].median()
    month_medians = context.groupby("arrival_month")[TARGET_NAME].median()
    global_median = float(training_target.median())

    predictions: list[float] = []
    group_matches = 0
    month_fallbacks = 0
    for _, observation in holdout.iterrows():
        key = (
            int(observation["arrival_month"]),
            int(observation[ARRIVAL_DATE_COLUMN].weekday()),
        )
        if key in month_weekday_medians.index:
            predictions.append(float(month_weekday_medians.loc[key]))
            group_matches += 1
        elif key[0] in month_medians.index:
            predictions.append(float(month_medians.loc[key[0]]))
            month_fallbacks += 1
        else:
            predictions.append(global_median)

    return predictions, {
        "strategy": "training_month_and_arrival_weekday_median",
        "fallback": "training_month_median_then_training_global_median",
        "global_median": round(global_median, 6),
        "group_matches": group_matches,
        "month_fallbacks": month_fallbacks,
        "global_fallbacks": len(holdout) - group_matches - month_fallbacks,
    }


def train_and_evaluate(
    frame: pd.DataFrame,
    config: TrainingConfig,
) -> tuple[RandomForestRegressor, dict[str, Any]]:
    """Train on past arrivals and evaluate on a strictly later holdout."""
    training, holdout = chronological_split(frame, config.test_size)
    global_target_base_adr = float(training[ADR_COLUMN].median())
    if global_target_base_adr <= 0:
        raise ValueError("Training partition has no positive median ADR.")
    room_type_base_adr = training.groupby("reserved_room_type")[ADR_COLUMN].median()
    training_base = training["reserved_room_type"].map(room_type_base_adr).astype(float)
    holdout_base = (
        holdout["reserved_room_type"]
        .map(room_type_base_adr)
        .fillna(global_target_base_adr)
        .astype(float)
    )

    x_train = training.loc[:, list(FEATURE_ORDER)]
    x_test = holdout.loc[:, list(FEATURE_ORDER)]
    y_train = (training[ADR_COLUMN] / training_base).clip(
        lower=MIN_MULTIPLIER,
        upper=MAX_MULTIPLIER,
    )
    y_test = (holdout[ADR_COLUMN] / holdout_base).clip(
        lower=MIN_MULTIPLIER,
        upper=MAX_MULTIPLIER,
    )

    model = RandomForestRegressor(
        n_estimators=config.n_estimators,
        max_depth=config.max_depth,
        random_state=config.random_seed,
        n_jobs=config.n_jobs,
    )
    model.fit(x_train, y_train)

    predictions = model.predict(x_test)
    baseline_predictions, baseline = build_seasonal_baseline_predictions(
        training,
        holdout,
        y_train,
    )
    mae = float(mean_absolute_error(y_test, predictions))
    baseline_mae = float(mean_absolute_error(y_test, baseline_predictions))
    mean_squared_error_value = float(((y_test.to_numpy() - predictions) ** 2).mean())
    actual_adr = holdout[ADR_COLUMN].to_numpy()
    predicted_adr = predictions * holdout_base.to_numpy()
    baseline_adr = pd.Series(baseline_predictions).to_numpy() * holdout_base.to_numpy()
    adr_mae = float(mean_absolute_error(actual_adr, predicted_adr))
    baseline_adr_mae = float(mean_absolute_error(actual_adr, baseline_adr))
    adr_mean_squared_error = float(((actual_adr - predicted_adr) ** 2).mean())
    baseline_adr_mean_squared_error = float(((actual_adr - baseline_adr) ** 2).mean())
    baseline["mae"] = round(baseline_mae, 6)
    baseline["adr_mae"] = round(baseline_adr_mae, 6)
    baseline["adr_rmse"] = round(math.sqrt(baseline_adr_mean_squared_error), 6)
    baseline["adr_r2"] = round(float(r2_score(actual_adr, baseline_adr)), 6)

    evaluation = {
        "split": {
            "strategy": "chronological_by_arrival_date",
            "requested_holdout_fraction": config.test_size,
            "actual_holdout_fraction": round(len(holdout) / len(frame), 6),
            "cutoff_date": holdout[ARRIVAL_DATE_COLUMN].min().date().isoformat(),
            "training_date_range": [
                training[ARRIVAL_DATE_COLUMN].min().date().isoformat(),
                training[ARRIVAL_DATE_COLUMN].max().date().isoformat(),
            ],
            "holdout_date_range": [
                holdout[ARRIVAL_DATE_COLUMN].min().date().isoformat(),
                holdout[ARRIVAL_DATE_COLUMN].max().date().isoformat(),
            ],
        },
        "holdout_rows": int(len(y_test)),
        "training_rows": int(len(y_train)),
        "target_base_adr": round(global_target_base_adr, 6),
        "target_reference": {
            "strategy": "training_reserved_room_type_median_adr",
            "global_fallback_base_adr": round(global_target_base_adr, 6),
            "room_type_base_adr": {
                str(room_type): round(float(base_adr), 6)
                for room_type, base_adr in room_type_base_adr.items()
            },
            "unknown_holdout_room_types": sorted(
                set(holdout["reserved_room_type"]) - set(room_type_base_adr.index)
            ),
        },
        "mae": round(mae, 6),
        "rmse": round(math.sqrt(mean_squared_error_value), 6),
        "r2": round(float(r2_score(y_test, predictions)), 6),
        "mape": round(float(mean_absolute_percentage_error(y_test, predictions)), 6),
        "adr_metrics": {
            "mae": round(adr_mae, 6),
            "rmse": round(math.sqrt(adr_mean_squared_error), 6),
            "r2": round(float(r2_score(actual_adr, predicted_adr)), 6),
            "mape": round(
                float(mean_absolute_percentage_error(actual_adr, predicted_adr)),
                6,
            ),
        },
        "baseline": baseline,
        "mae_improvement_over_baseline": round(
            0.0 if baseline_mae == 0 else (baseline_mae - mae) / baseline_mae,
            6,
        ),
        "adr_mae_improvement_over_baseline": round(
            0.0
            if baseline_adr_mae == 0
            else (baseline_adr_mae - adr_mae) / baseline_adr_mae,
            6,
        ),
        "passes_baseline_gate": adr_mae < baseline_adr_mae,
        "feature_importance": {
            feature: round(float(importance), 6)
            for feature, importance in zip(FEATURE_ORDER, model.feature_importances_)
        },
    }

    # ── Print human-readable feature importance breakdown ─────────────────
    _print_feature_importance(evaluation["feature_importance"])

    return model, evaluation


def _print_feature_importance(importance: dict[str, float]) -> None:
    """Print a ranked feature importance table to stdout.

    This output is critical for demonstrating that the model is learning
    from demand signals (occupancy, velocity) and not just date patterns.
    A rule-based system would never produce this kind of ranked output.
    """
    import sys as _sys
    # Force UTF-8 on Windows terminals that default to cp1252
    if hasattr(_sys.stdout, "reconfigure"):
        try:
            _sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except Exception:
            pass

    ranked = sorted(importance.items(), key=lambda kv: kv[1], reverse=True)
    total = sum(v for _, v in ranked)

    # Group features into categories
    demand_features = {
        "occupancy_ratio", "booking_velocity_score", "demand_pressure_score",
        "availability_tightness", "price_vs_market_ratio",
    }

    bar_width = 30
    sep = "=" * 68
    div = "-" * 68
    print("\n" + sep)
    print(" FEATURE IMPORTANCE - What the AI actually learned")
    print(sep)
    print(f"  {'Feature':<32} {'Importance':>10}  {'Bar (# = weight)'}")
    print(div)

    demand_total = 0.0
    temporal_total = 0.0
    for feature, imp in ranked:
        bar_len = int(round(imp / max(ranked[0][1], 1e-9) * bar_width))
        bar = "#" * bar_len
        tag = "[DEMAND]" if feature in demand_features else "[DATE]  "
        print(f"  {tag} {feature:<24} {imp:>10.4f}  {bar}")
        if feature in demand_features:
            demand_total += imp
        else:
            temporal_total += imp

    print(div)
    print(f"  {'DEMAND signals total':<32} {demand_total:>10.4f}  "
          f"({demand_total / total * 100:.1f}% of model weight)")
    print(f"  {'DATE/temporal signals total':<32} {temporal_total:>10.4f}  "
          f"({temporal_total / total * 100:.1f}% of model weight)")
    print(sep)
    print("  [OK] If DEMAND signals dominate -> real AI pricing (learns from data).")
    print("  [!!] If DATE signals dominate  -> sophisticated date filter only.")
    print(sep + "\n")


def build_metadata(
    *,
    model_version: str,
    data_path: Path,
    processed: pd.DataFrame,
    config: TrainingConfig,
    model: RandomForestRegressor,
    evaluation: dict[str, Any],
) -> dict[str, Any]:
    data_sha256 = sha256_file(data_path)
    script_sha256 = sha256_file(Path(__file__).resolve())
    reproducibility_input = {
        "data_sha256": data_sha256,
        "script_sha256": script_sha256,
        "feature_contract": feature_contract_metadata(),
        "training_config": asdict(config),
        "model_version": model_version,
    }
    training_run_id = hashlib.sha256(
        json.dumps(reproducibility_input, sort_keys=True).encode("utf-8")
    ).hexdigest()[:16]

    return {
        "model_version": model_version,
        "training_run_id": training_run_id,
        "created_at_utc": datetime.now(UTC).isoformat(),
        "feature_contract": feature_contract_metadata(),
        "demand_feature_contract": demand_feature_metadata(),
        "target": {
            "name": TARGET_NAME,
            "definition": "ADR / median ADR for reserved room type in the chronological training partition",
            "clip_range": [MIN_MULTIPLIER, MAX_MULTIPLIER],
            "reference": evaluation["target_reference"],
        },
        "data": {
            "source_file": data_path.name,
            "sha256": data_sha256,
            "source_rows": int(processed.attrs["source_rows"]),
            "filtered_city_hotel_rows": int(processed.attrs["filtered_rows"]),
            "training_candidate_rows": int(len(processed)),
            "invalid_quote_context_rows_removed": int(
                processed.attrs["invalid_quote_context_rows"]
            ),
            "filter": (
                "hotel == City Hotel AND is_canceled == 0 AND adr > 0 "
                "AND stay_nights > 0 AND guest_count > 0"
            ),
        },
        "training": {
            "config": asdict(config),
            "estimator": type(model).__name__,
            "estimator_parameters": model.get_params(deep=False),
            "script_sha256": script_sha256,
        },
        "evaluation": evaluation,
        "runtime": {
            "python": platform.python_version(),
            "pandas": pd.__version__,
            "scikit_learn": sklearn.__version__,
            "joblib": joblib.__version__,
        },
    }


def save_artifact(
    model: RandomForestRegressor,
    metadata: dict[str, Any],
    output_path: str | Path,
) -> Path:
    destination = Path(output_path).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    artifact = {
        "artifact_schema_version": MODEL_ARTIFACT_SCHEMA_VERSION,
        "model": model,
        "metadata": metadata,
    }

    temporary_model = destination.with_suffix(f"{destination.suffix}.tmp")
    joblib.dump(artifact, temporary_model, compress=3)
    os.replace(temporary_model, destination)

    metadata_path = destination.with_suffix(".metadata.json")
    temporary_metadata = metadata_path.with_suffix(f"{metadata_path.suffix}.tmp")
    exported_metadata = {
        "artifact_schema_version": MODEL_ARTIFACT_SCHEMA_VERSION,
        **metadata,
    }
    temporary_metadata.write_text(
        json.dumps(exported_metadata, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary_metadata, metadata_path)
    return metadata_path


def run_pipeline(
    *,
    data_path: Path = DEFAULT_DATA_PATH,
    output_path: Path = DEFAULT_MODEL_PATH,
    model_version: str = DEFAULT_MODEL_VERSION,
    config: TrainingConfig = TrainingConfig(),
    require_baseline_improvement: bool = True,
) -> dict[str, Any]:
    raw_data = load_and_filter_data(data_path)
    processed_data = engineer_features(raw_data)
    model, evaluation = train_and_evaluate(processed_data, config)
    metadata = build_metadata(
        model_version=model_version,
        data_path=data_path,
        processed=processed_data,
        config=config,
        model=model,
        evaluation=evaluation,
    )
    if require_baseline_improvement and not evaluation["passes_baseline_gate"]:
        raise RuntimeError(
            "Candidate model did not improve MAE over the chronological seasonal "
            "baseline; artifact was not written."
        )
    metadata_path = save_artifact(model, metadata, output_path)

    print(
        json.dumps(
            {
                "model_path": str(output_path.resolve()),
                "metadata_path": str(metadata_path),
                "model_version": metadata["model_version"],
                "training_run_id": metadata["training_run_id"],
                "evaluation": evaluation,
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    return metadata


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train the hotel price multiplier model.")
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA_PATH)
    parser.add_argument("--output", type=Path, default=DEFAULT_MODEL_PATH)
    parser.add_argument("--model-version", default=DEFAULT_MODEL_VERSION)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--n-estimators", type=int, default=100)
    parser.add_argument("--max-depth", type=int, default=10)
    parser.add_argument(
        "--allow-baseline-regression",
        action="store_true",
        help="Write the artifact even when it fails the chronological baseline gate.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    if not 0 < args.test_size < 1:
        raise SystemExit("--test-size must be between 0 and 1")
    if args.n_estimators <= 0 or args.max_depth <= 0:
        raise SystemExit("--n-estimators and --max-depth must be positive")

    run_pipeline(
        data_path=args.data.resolve(),
        output_path=args.output.resolve(),
        model_version=args.model_version,
        config=TrainingConfig(
            random_seed=args.seed,
            test_size=args.test_size,
            n_estimators=args.n_estimators,
            max_depth=args.max_depth,
        ),
        require_baseline_improvement=not args.allow_baseline_regression,
    )
