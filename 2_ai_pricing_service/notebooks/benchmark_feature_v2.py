from __future__ import annotations

"""Offline-only benchmark for quote-time feature candidates.

This script deliberately does not write a model artifact.  It keeps the
production chronological split and RandomForest configuration fixed so that
changes in the results can be attributed to the candidate feature/target
design rather than to a different evaluation protocol.
"""

import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import (
    mean_absolute_error,
    mean_absolute_percentage_error,
    r2_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from notebooks.train_model import (  # noqa: E402
    ADR_COLUMN,
    DEFAULT_DATA_PATH,
    FEATURE_ORDER,
    MAX_MULTIPLIER,
    MIN_MULTIPLIER,
    TARGET_NAME,
    TrainingConfig,
    build_seasonal_baseline_predictions,
    chronological_split,
    engineer_features,
    load_and_filter_data,
)


TargetStrategy = Literal["global_median", "room_type_median"]
DEFAULT_REPORT_PATH = PROJECT_ROOT / "app" / "models" / "feature_v2_benchmark.json"
V1_FEATURES = (
    "lead_time",
    "arrival_month",
    "is_weekend",
    "total_of_special_requests",
)


@dataclass(frozen=True, slots=True)
class Candidate:
    name: str
    numeric_features: tuple[str, ...]
    categorical_features: tuple[str, ...] = ()
    target_strategy: TargetStrategy = "global_median"
    deployability: str = "candidate"


SAFE_QUOTE_FEATURES = tuple(FEATURE_ORDER)

CANDIDATES = (
    Candidate(
        name="v1_current",
        numeric_features=V1_FEATURES,
        deployability="production reference; special-request count is user-controlled",
    ),
    Candidate(
        name="v1_without_special_requests",
        numeric_features=("lead_time", "arrival_month", "is_weekend"),
        deployability="safe drop-in feature subset",
    ),
    Candidate(
        name="v2_quote_context",
        numeric_features=SAFE_QUOTE_FEATURES,
        deployability="recommended quote-time feature candidate",
    ),
    Candidate(
        name="v2_quote_context_with_room_feature",
        numeric_features=SAFE_QUOTE_FEATURES,
        categorical_features=("reserved_room_type",),
        deployability=(
            "diagnostic upper bound only while serving multiplies a room-specific base price"
        ),
    ),
    Candidate(
        name="v2_room_normalized_multiplier",
        numeric_features=SAFE_QUOTE_FEATURES,
        target_strategy="room_type_median",
        deployability=(
            "recommended target design after room-base calibration and contract versioning"
        ),
    ),
)


def prepare_data(data_path: Path) -> pd.DataFrame:
    """Preserve the exact v1 candidate rows, then add quote-time-only fields."""
    raw = load_and_filter_data(data_path)
    prepared = engineer_features(raw)
    source = raw.loc[prepared.index]

    prepared["arrival_weekday"] = prepared["arrival_date"].dt.weekday
    prepared["arrival_month_sin"] = np.sin(
        2 * np.pi * (prepared["arrival_month"] - 1) / 12
    )
    prepared["arrival_month_cos"] = np.cos(
        2 * np.pi * (prepared["arrival_month"] - 1) / 12
    )
    prepared["arrival_weekday_sin"] = np.sin(
        2 * np.pi * prepared["arrival_weekday"] / 7
    )
    prepared["arrival_weekday_cos"] = np.cos(
        2 * np.pi * prepared["arrival_weekday"] / 7
    )
    prepared["stay_nights"] = (
        source["stays_in_weekend_nights"] + source["stays_in_week_nights"]
    ).astype(int)
    prepared["weekend_nights"] = source["stays_in_weekend_nights"].astype(int)
    prepared["weekend_share"] = (
        prepared["weekend_nights"] / prepared["stay_nights"]
    )
    prepared["guest_count"] = (
        source["adults"] + source["children"].fillna(0) + source["babies"]
    ).astype(int)
    prepared["reserved_room_type"] = source["reserved_room_type"].astype(str)

    if not np.isfinite(prepared[list(SAFE_QUOTE_FEATURES)].to_numpy()).all():
        raise ValueError("Candidate quote-time features contain non-finite values.")
    return prepared


def build_target(
    training: pd.DataFrame,
    holdout: pd.DataFrame,
    strategy: TargetStrategy,
) -> tuple[pd.Series, pd.Series, pd.Series, pd.Series, dict[str, object]]:
    """Return clipped multipliers plus the leakage-free base used for each row."""
    global_base = float(training[ADR_COLUMN].median())
    if strategy == "global_median":
        training_base = pd.Series(global_base, index=training.index, dtype=float)
        holdout_base = pd.Series(global_base, index=holdout.index, dtype=float)
        details: dict[str, object] = {"global_training_median_adr": global_base}
    else:
        room_bases = training.groupby("reserved_room_type")[ADR_COLUMN].median()
        training_base = training["reserved_room_type"].map(room_bases).astype(float)
        holdout_base = (
            holdout["reserved_room_type"].map(room_bases).fillna(global_base).astype(float)
        )
        details = {
            "global_training_median_adr_fallback": global_base,
            "training_room_type_median_adr": {
                str(room): round(float(value), 6)
                for room, value in room_bases.items()
            },
            "unknown_holdout_room_types": sorted(
                set(holdout["reserved_room_type"]) - set(room_bases.index)
            ),
        }

    y_train = (training[ADR_COLUMN] / training_base).clip(
        lower=MIN_MULTIPLIER,
        upper=MAX_MULTIPLIER,
    )
    y_holdout = (holdout[ADR_COLUMN] / holdout_base).clip(
        lower=MIN_MULTIPLIER,
        upper=MAX_MULTIPLIER,
    )
    return y_train, y_holdout, training_base, holdout_base, details


def build_estimator(candidate: Candidate, config: TrainingConfig):
    forest = RandomForestRegressor(
        n_estimators=config.n_estimators,
        max_depth=config.max_depth,
        random_state=config.random_seed,
        n_jobs=config.n_jobs,
    )
    if not candidate.categorical_features:
        return forest

    transform = ColumnTransformer(
        transformers=[
            ("numeric", "passthrough", list(candidate.numeric_features)),
            (
                "categorical",
                OneHotEncoder(handle_unknown="ignore", sparse_output=False),
                list(candidate.categorical_features),
            ),
        ],
        remainder="drop",
    )
    return Pipeline([("features", transform), ("model", forest)])


def evaluate_candidate(
    candidate: Candidate,
    training: pd.DataFrame,
    holdout: pd.DataFrame,
    config: TrainingConfig,
) -> dict[str, object]:
    y_train, y_holdout, _, holdout_base, target_details = build_target(
        training,
        holdout,
        candidate.target_strategy,
    )
    feature_names = [*candidate.numeric_features, *candidate.categorical_features]
    estimator = build_estimator(candidate, config)
    estimator.fit(training[feature_names], y_train)
    predicted_multiplier = estimator.predict(holdout[feature_names])
    predicted_adr = predicted_multiplier * holdout_base.to_numpy()
    actual_adr = holdout[ADR_COLUMN].to_numpy()

    multiplier_mse = float(
        ((y_holdout.to_numpy() - predicted_multiplier) ** 2).mean()
    )
    adr_mse = float(((actual_adr - predicted_adr) ** 2).mean())
    return {
        "name": candidate.name,
        "numeric_features": list(candidate.numeric_features),
        "categorical_features": list(candidate.categorical_features),
        "target_strategy": candidate.target_strategy,
        "deployability": candidate.deployability,
        "target_details": target_details,
        "metrics": {
            "multiplier_mae_on_clipped_target": round(
                float(mean_absolute_error(y_holdout, predicted_multiplier)), 6
            ),
            "multiplier_rmse_on_clipped_target": round(math.sqrt(multiplier_mse), 6),
            "adr_mae": round(float(mean_absolute_error(actual_adr, predicted_adr)), 6),
            "adr_rmse": round(math.sqrt(adr_mse), 6),
            "adr_mape": round(
                float(mean_absolute_percentage_error(actual_adr, predicted_adr)), 6
            ),
            "adr_r2": round(float(r2_score(actual_adr, predicted_adr)), 6),
        },
    }


def run_benchmark(
    data_path: Path = DEFAULT_DATA_PATH,
    config: TrainingConfig = TrainingConfig(),
) -> dict[str, object]:
    data = prepare_data(data_path)
    training, holdout = chronological_split(data, config.test_size)

    global_y_train, global_y_holdout, _, global_holdout_base, _ = build_target(
        training,
        holdout,
        "global_median",
    )
    baseline_multiplier, baseline_details = build_seasonal_baseline_predictions(
        training,
        holdout,
        global_y_train,
    )
    baseline_adr = np.asarray(baseline_multiplier) * global_holdout_base.to_numpy()
    actual_adr = holdout[ADR_COLUMN].to_numpy()

    results = [
        evaluate_candidate(candidate, training, holdout, config)
        for candidate in CANDIDATES
    ]
    baseline_multiplier_mse = float(
        ((global_y_holdout.to_numpy() - np.asarray(baseline_multiplier)) ** 2).mean()
    )
    baseline_adr_mse = float(((actual_adr - baseline_adr) ** 2).mean())

    invalid_context_rows = int(data.attrs.get("invalid_quote_context_rows", 0))
    return {
        "purpose": "offline feature-v2 benchmark; no serving artifact is written",
        "split": {
            "strategy": "chronological_by_arrival_date",
            "training_rows": len(training),
            "holdout_rows": len(holdout),
            "training_date_range": [
                training["arrival_date"].min().date().isoformat(),
                training["arrival_date"].max().date().isoformat(),
            ],
            "holdout_date_range": [
                holdout["arrival_date"].min().date().isoformat(),
                holdout["arrival_date"].max().date().isoformat(),
            ],
        },
        "data_quality": {
            "invalid_quote_context_rows_excluded": invalid_context_rows,
            "comparison_population": "same valid rows for every candidate",
        },
        "baseline": {
            **baseline_details,
            "metrics": {
                "multiplier_mae_on_clipped_target": round(
                    float(mean_absolute_error(global_y_holdout, baseline_multiplier)), 6
                ),
                "multiplier_rmse_on_clipped_target": round(
                    math.sqrt(baseline_multiplier_mse), 6
                ),
                "adr_mae": round(float(mean_absolute_error(actual_adr, baseline_adr)), 6),
                "adr_rmse": round(math.sqrt(baseline_adr_mse), 6),
                "adr_mape": round(
                    float(mean_absolute_percentage_error(actual_adr, baseline_adr)), 6
                ),
                "adr_r2": round(float(r2_score(actual_adr, baseline_adr)), 6),
            },
        },
        "candidates": results,
    }


if __name__ == "__main__":
    report = run_benchmark()
    DEFAULT_REPORT_PATH.write_text(
        json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"report_path": str(DEFAULT_REPORT_PATH), **report}, indent=2, ensure_ascii=False))
