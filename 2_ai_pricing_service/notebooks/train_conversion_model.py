from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.training.conversion_training import (  # noqa: E402
    DEFAULT_MODEL_VERSION,
    ReadinessThresholds,
    TrainingConfig,
    run_pipeline,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train a censor-aware conversion challenger from a CSV export."
    )
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument(
        "--output",
        type=Path,
        default=PROJECT_ROOT / "app" / "models" / "conversion_challenger_v1.pkl",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=PROJECT_ROOT / "app" / "models" / "conversion_readiness.json",
    )
    parser.add_argument("--model-version", default=DEFAULT_MODEL_VERSION)
    parser.add_argument("--holdout-fraction", type=float, default=0.2)
    parser.add_argument("--minimum-eligible-rows", type=int, default=2_000)
    parser.add_argument("--minimum-positive-labels", type=int, default=200)
    parser.add_argument("--minimum-negative-labels", type=int, default=200)
    parser.add_argument("--minimum-exposure-days", type=int, default=28)
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    result = run_pipeline(
        data_path=arguments.data,
        output_path=arguments.output,
        readiness_report_path=arguments.report,
        model_version=arguments.model_version,
        thresholds=ReadinessThresholds(
            minimum_eligible_rows=arguments.minimum_eligible_rows,
            minimum_positive_labels=arguments.minimum_positive_labels,
            minimum_negative_labels=arguments.minimum_negative_labels,
            minimum_exposure_days=arguments.minimum_exposure_days,
        ),
        config=TrainingConfig(holdout_fraction=arguments.holdout_fraction),
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
    raise SystemExit(0 if result["status"] == "artifact_written" else 2)
