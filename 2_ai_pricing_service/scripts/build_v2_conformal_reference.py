"""Generate Split Conformal calibration, Mahalanobis OOD, and real empirical drift baselines for RF V2.

Uses the exact reproducible City Hotel filtering & chronological split documented in
`app/models/random_forest_v2.metadata.json` without modifying `random_forest_v2.pkl` weights.
"""
from __future__ import annotations

import json
import math
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.serving_contract import SERVING_FEATURE_ORDER  # noqa: E402
from notebooks.train_model import (  # noqa: E402
    ADR_COLUMN,
    ARRIVAL_DATE_COLUMN,
    MONTH_MAP,
    chronological_split,
    load_and_filter_data,
)

DEFAULT_DATA_PATH = PROJECT_ROOT / "notebooks" / "hotel_bookings.csv"
DEFAULT_MODEL_PATH = PROJECT_ROOT / "app" / "models" / "random_forest_v2.pkl"
DEFAULT_METADATA_PATH = PROJECT_ROOT / "app" / "models" / "random_forest_v2.metadata.json"
DEFAULT_OUTPUT_PATH = PROJECT_ROOT / "app" / "models" / "random_forest_v2.conformal.json"

MIN_MULTIPLIER = 0.5
MAX_MULTIPLIER = 3.0
GAMMA_SMOOTHING = 0.25
ECDF_GRID_POINTS = 1001
MONITORED_DRIFT_FEATURES = (
    "lead_time",
    "stay_nights",
    "guest_count",
    "weekend_share",
    "weekend_nights",
)


def prepare_v2_frame(data_path: Path) -> pd.DataFrame:
    raw = load_and_filter_data(data_path)
    data = raw.copy()
    data["arrival_month"] = data["arrival_date_month"].map(MONTH_MAP)
    numeric_cols = [
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
    for col in numeric_cols:
        data[col] = pd.to_numeric(data[col], errors="raise")

    valid = data.loc[data["adr"] > 0].copy()
    valid[ARRIVAL_DATE_COLUMN] = pd.to_datetime(
        {
            "year": valid["arrival_date_year"],
            "month": valid["arrival_month"],
            "day": valid["arrival_date_day_of_month"],
        },
        errors="raise",
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
    valid = valid.loc[~invalid_context].copy()

    month_angle = 2 * math.pi * (valid["arrival_month"] - 1) / 12
    weekday_angle = 2 * math.pi * valid[ARRIVAL_DATE_COLUMN].dt.weekday / 7
    valid["arrival_month_sin"] = month_angle.map(math.sin).round(10)
    valid["arrival_month_cos"] = month_angle.map(math.cos).round(10)
    valid["arrival_weekday_sin"] = weekday_angle.map(math.sin).round(10)
    valid["arrival_weekday_cos"] = weekday_angle.map(math.cos).round(10)
    valid["weekend_share"] = (valid["weekend_nights"] / valid["stay_nights"]).round(10)
    return valid


def finite_sample_quantile(scores: np.ndarray, coverage_target: float) -> float:
    n = len(scores)
    q_level = min(1.0, math.ceil((n + 1) * coverage_target) / n)
    return float(np.quantile(scores, q_level, method="higher"))


def build_conformal_and_reference(
    data_path: Path = DEFAULT_DATA_PATH,
    model_path: Path = DEFAULT_MODEL_PATH,
    metadata_path: Path = DEFAULT_METADATA_PATH,
    output_path: Path = DEFAULT_OUTPUT_PATH,
) -> dict[str, Any]:
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    artifact = joblib.load(model_path)
    model = artifact["model"]

    valid = prepare_v2_frame(data_path)
    training, holdout = chronological_split(valid, test_size=0.2)

    room_ref = metadata["target"]["reference"]["room_type_base_adr"]
    fallback_ref = float(metadata["target"]["reference"]["global_fallback_base_adr"])
    holdout_base = holdout["reserved_room_type"].map(room_ref).fillna(fallback_ref).astype(float)
    y_hold = (holdout[ADR_COLUMN] / holdout_base).clip(MIN_MULTIPLIER, MAX_MULTIPLIER).to_numpy()

    x_train = training.loc[:, list(SERVING_FEATURE_ORDER)]
    x_hold = holdout.loc[:, list(SERVING_FEATURE_ORDER)]

    hold_preds = np.asarray(model.predict(x_hold), dtype=float)
    hold_mae = float(np.mean(np.abs(y_hold - hold_preds)))
    expected_mae = float(metadata["evaluation"]["mae"])
    if abs(hold_mae - expected_mae) > 1e-4:
        raise RuntimeError(
            f"Holdout MAE mismatch: got {hold_mae:.6f}, expected {expected_mae:.6f}"
        )

    # 1. Split Conformal Calibration on the strictly chronological holdout partition (n=9,029)
    tree_matrix = np.column_stack([dt.predict(x_hold.to_numpy()) for dt in model.estimators_])
    tree_std = np.std(tree_matrix, axis=1)
    abs_residuals = np.abs(y_hold - hold_preds)

    norm_denom = tree_std + GAMMA_SMOOTHING
    norm_scores = abs_residuals / norm_denom
    q90_norm = finite_sample_quantile(norm_scores, 0.90)
    q80_norm = finite_sample_quantile(norm_scores, 0.80)
    q90_abs = finite_sample_quantile(abs_residuals, 0.90)
    q80_abs = finite_sample_quantile(abs_residuals, 0.80)

    lo_90 = np.clip(hold_preds - q90_norm * norm_denom, MIN_MULTIPLIER, MAX_MULTIPLIER)
    hi_90 = np.clip(hold_preds + q90_norm * norm_denom, MIN_MULTIPLIER, MAX_MULTIPLIER)
    achieved_cov_90 = float(np.mean((y_hold >= lo_90) & (y_hold <= hi_90)))

    lo_80 = np.clip(hold_preds - q80_norm * norm_denom, MIN_MULTIPLIER, MAX_MULTIPLIER)
    hi_80 = np.clip(hold_preds + q80_norm * norm_denom, MIN_MULTIPLIER, MAX_MULTIPLIER)
    achieved_cov_80 = float(np.mean((y_hold >= lo_80) & (y_hold <= hi_80)))

    # 2. Regularized Mahalanobis OOD Model from Training Partition (n=36,090)
    x_train_np = x_train.to_numpy(dtype=float)
    feat_mean = np.mean(x_train_np, axis=0)
    feat_std = np.maximum(np.std(x_train_np, axis=0), 1e-6)
    z_train = (x_train_np - feat_mean) / feat_std
    cov = np.cov(z_train, rowvar=False) + np.eye(z_train.shape[1]) * 1e-3
    inv_cov = np.linalg.inv(cov)
    train_dists = np.sqrt(np.einsum("ij,jk,ik->i", z_train, inv_cov, z_train))

    feature_bounds = {}
    for idx, feat in enumerate(SERVING_FEATURE_ORDER):
        col = x_train_np[:, idx]
        feature_bounds[feat] = {
            "mean": round(float(feat_mean[idx]), 6),
            "std": round(float(feat_std[idx]), 6),
            "min": round(float(np.min(col)), 6),
            "p01": round(float(np.percentile(col, 1)), 6),
            "p05": round(float(np.percentile(col, 5)), 6),
            "p50": round(float(np.percentile(col, 50)), 6),
            "p95": round(float(np.percentile(col, 95)), 6),
            "p99": round(float(np.percentile(col, 99)), 6),
            "max": round(float(np.max(col)), 6),
        }

    # 3. Real Empirical Quantile Sketches for Drift Monitoring (PSI, KS, Wasserstein)
    quantile_grid = np.linspace(0.0, 1.0, ECDF_GRID_POINTS)
    drift_reference: dict[str, Any] = {}
    for feat in MONITORED_DRIFT_FEATURES:
        arr = training[feat].to_numpy(dtype=float)
        sketched = np.quantile(arr, quantile_grid, method="nearest")
        drift_reference[feat] = {
            "sample_rows": int(len(arr)),
            "mean": round(float(np.mean(arr)), 6),
            "std": round(float(np.std(arr)), 6),
            "median": round(float(np.median(arr)), 6),
            "min": round(float(np.min(arr)), 6),
            "max": round(float(np.max(arr)), 6),
            "p05": round(float(np.percentile(arr, 5)), 6),
            "p25": round(float(np.percentile(arr, 25)), 6),
            "p75": round(float(np.percentile(arr, 75)), 6),
            "p95": round(float(np.percentile(arr, 95)), 6),
            "ecdf_quantiles": [round(float(v), 6) for v in sketched],
        }

    payload: dict[str, Any] = {
        "schema_version": "1.0.0",
        "generated_at_utc": datetime.now(UTC).isoformat(),
        "model_version": str(metadata["model_version"]),
        "training_run_id": str(metadata["training_run_id"]),
        "feature_contract_version": str(metadata["feature_contract"]["version"]),
        "feature_order": list(SERVING_FEATURE_ORDER),
        "calibration_summary": {
            "training_rows": int(len(training)),
            "calibration_holdout_rows": int(len(holdout)),
            "verified_holdout_mae": round(hold_mae, 6),
            "metadata_holdout_mae": round(expected_mae, 6),
            "data_source": "Portugal City Hotel (non-canceled, adr > 0), chronological holdout >= 2017-04-25",
        },
        "conformal": {
            "method": "smoothed_locally_adaptive_split_conformal",
            "gamma_smoothing": GAMMA_SMOOTHING,
            "alpha_90": 0.10,
            "target_coverage_90": 0.90,
            "q_norm_90": round(q90_norm, 6),
            "q_abs_90": round(q90_abs, 6),
            "achieved_holdout_coverage_90": round(achieved_cov_90, 6),
            "mean_holdout_width_90": round(float(np.mean(hi_90 - lo_90)), 6),
            "alpha_80": 0.20,
            "target_coverage_80": 0.80,
            "q_norm_80": round(q80_norm, 6),
            "q_abs_80": round(q80_abs, 6),
            "achieved_holdout_coverage_80": round(achieved_cov_80, 6),
            "clip_range": [MIN_MULTIPLIER, MAX_MULTIPLIER],
        },
        "ood": {
            "method": "regularized_mahalanobis_zspace",
            "regularization": 1e-3,
            "mean": [round(float(v), 8) for v in feat_mean],
            "std": [round(float(v), 8) for v in feat_std],
            "inv_cov": [[round(float(cell), 8) for cell in row] for row in inv_cov],
            "thresholds": {
                "p50": round(float(np.percentile(train_dists, 50)), 6),
                "p95": round(float(np.percentile(train_dists, 95)), 6),
                "p99": round(float(np.percentile(train_dists, 99)), 6),
                "p995": round(float(np.percentile(train_dists, 99.5)), 6),
                "p999": round(float(np.percentile(train_dists, 99.9)), 6),
                "max": round(float(np.max(train_dists)), 6),
            },
            "feature_bounds": feature_bounds,
        },
        "drift_reference": drift_reference,
    }

    output_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return payload


if __name__ == "__main__":
    result = build_conformal_and_reference()
    print(
        json.dumps(
            {
                "output": str(DEFAULT_OUTPUT_PATH),
                "calibration_summary": result["calibration_summary"],
                "conformal": result["conformal"],
                "ood_thresholds": result["ood"]["thresholds"],
                "drift_features": list(result["drift_reference"].keys()),
            },
            indent=2,
            ensure_ascii=False,
        )
    )

