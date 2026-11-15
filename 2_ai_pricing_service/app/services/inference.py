import json
import logging
import math
import warnings
from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final

import joblib
import numpy as np
import pandas as pd

from app.core.serving_contract import (
    SERVING_CONTRACT_VERSION,
    SERVING_FEATURE_ORDER,
    build_serving_features,
)
from app.core.tree_interpreter import explain_random_forest
from app.schemas.pricing_schema import (
    PriceExplanation,
    PricingRequest,
    UncertaintyInterval,
)

logger = logging.getLogger(__name__)

MODEL_ARTIFACT_SCHEMA_VERSION: Final = "1.0.0"
MIN_MULTIPLIER: Final = 0.5
MAX_MULTIPLIER: Final = 3.0

class ModelUnavailableError(RuntimeError):
    """Raised when inference is requested before a compatible model is loaded."""


class InferenceError(RuntimeError):
    """Raised when a loaded model cannot produce a valid prediction."""


@dataclass(frozen=True, slots=True)
class PricingPrediction:
    multiplier: float
    model_version: str
    training_run_id: str
    feature_contract_version: str
    features: dict[str, int | float]
    feature_importance: dict[str, float] = field(default_factory=dict)
    uncertainty: UncertaintyInterval | None = None


FEATURE_LABELS_OOD_VI: Final[dict[str, str]] = {
    "lead_time": "Số ngày đặt trước",
    "stay_nights": "Số đêm lưu trú",
    "weekend_nights": "Số đêm cuối tuần",
    "weekend_share": "Tỷ trọng cuối tuần",
    "guest_count": "Số lượng khách",
}


class PricingInferenceService:
    def __init__(self, model_path: Path) -> None:
        self._model_path = model_path
        self._model: Any | None = None
        self._metadata: dict[str, Any] | None = None
        self._feature_importance: dict[str, float] = {}
        self._conformal_spec: dict[str, Any] | None = None

    @property
    def is_ready(self) -> bool:
        return self._model is not None and self._metadata is not None

    @property
    def model_info(self) -> dict[str, Any] | None:
        return deepcopy(self._metadata)

    def load(self) -> None:
        try:
            artifact = joblib.load(self._model_path)
            model, metadata = self._unpack_artifact(artifact)
            self._validate_model(model)
            self._validate_metadata(metadata)
        except Exception:
            self._model = None
            self._metadata = None
            self._feature_importance = {}
            self._conformal_spec = None
            logger.exception("Unable to load pricing model from %s", self._model_path)
            return

        self._model = model
        self._metadata = metadata
        importances = getattr(model, "feature_importances_", None)
        self._feature_importance = (
            dict(zip(SERVING_FEATURE_ORDER, map(float, importances)))
            if importances is not None and len(importances) == len(SERVING_FEATURE_ORDER)
            else {}
        )
        self._conformal_spec = self._load_conformal_spec(metadata)
        logger.info(
            "Loaded pricing model version=%s run=%s from %s (conformal=%s)",
            metadata["model_version"],
            metadata.get("training_run_id", "unknown"),
            self._model_path,
            "yes" if self._conformal_spec is not None else "no",
        )

    def unload(self) -> None:
        self._model = None
        self._metadata = None
        self._feature_importance = {}
        self._conformal_spec = None

    def _load_conformal_spec(self, metadata: dict[str, Any]) -> dict[str, Any] | None:
        conformal_path = self._model_path.with_suffix(".conformal.json")
        if not conformal_path.exists():
            return None
        try:
            spec = json.loads(conformal_path.read_text(encoding="utf-8"))
        except Exception:
            logger.warning("Failed to parse conformal calibration file %s", conformal_path)
            return None
        if spec.get("feature_order") != list(SERVING_FEATURE_ORDER):
            logger.warning("Conformal feature order mismatch in %s; ignoring.", conformal_path)
            return None
        if (
            metadata.get("training_run_id")
            and spec.get("training_run_id")
            and spec.get("training_run_id") != metadata.get("training_run_id")
        ):
            logger.warning("Conformal training_run_id mismatch in %s; ignoring.", conformal_path)
            return None
        return spec

    def _compute_uncertainty(
        self,
        *,
        bounded_multiplier: float,
        frame: pd.DataFrame,
        features: dict[str, int | float],
    ) -> UncertaintyInterval | None:
        estimators = getattr(self._model, "estimators_", None)
        if not estimators:
            return None

        x_np = frame.to_numpy(dtype=float)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            raw_tree_preds = np.array([float(dt.predict(x_np)[0]) for dt in estimators], dtype=float)

        clipped_tree_preds = np.clip(raw_tree_preds, MIN_MULTIPLIER, MAX_MULTIPLIER)
        ensemble_p10 = round(float(np.percentile(clipped_tree_preds, 10)), 4)
        ensemble_p50 = round(float(np.percentile(clipped_tree_preds, 50)), 4)
        ensemble_p90 = round(float(np.percentile(clipped_tree_preds, 90)), 4)
        ensemble_std = round(float(np.std(raw_tree_preds)), 4)

        spec = self._conformal_spec
        if spec is None:
            low = max(MIN_MULTIPLIER, round(bounded_multiplier - max(0.05, 1.645 * ensemble_std), 3))
            high = min(MAX_MULTIPLIER, round(bounded_multiplier + max(0.05, 1.645 * ensemble_std), 3))
            return UncertaintyInterval(
                method="ensemble_spread_fallback",
                calibration_rows=0,
                ensemble_p10=ensemble_p10,
                ensemble_p50=ensemble_p50,
                ensemble_p90=ensemble_p90,
                ensemble_std=ensemble_std,
                conformal_alpha=0.10,
                target_coverage=0.90,
                empirical_holdout_coverage=None,
                conformal_low=low,
                conformal_high=high,
                ood_distance=0.0,
                ood_p95_threshold=None,
                ood_p99_threshold=None,
                ood_status="in_distribution",
                ood_notes=[
                    "Không có tệp hiệu chuẩn holdout (.conformal.json); dùng độ phân tán nội tại của cây quyết định."
                ],
            )

        conformal_cfg = spec.get("conformal", {})
        gamma = float(conformal_cfg.get("gamma_smoothing", 0.25))
        q_norm = float(conformal_cfg.get("q_norm_90", 1.688113))
        alpha = float(conformal_cfg.get("alpha_90", 0.10))
        target_cov = float(conformal_cfg.get("target_coverage_90", 0.90))
        empirical_cov = conformal_cfg.get("achieved_holdout_coverage_90")
        cal_rows = int(spec.get("calibration_summary", {}).get("calibration_holdout_rows", 0))

        radius = q_norm * (float(np.std(raw_tree_preds)) + gamma)
        conformal_low = round(min(MAX_MULTIPLIER, max(MIN_MULTIPLIER, bounded_multiplier - radius)), 3)
        conformal_high = round(min(MAX_MULTIPLIER, max(MIN_MULTIPLIER, bounded_multiplier + radius)), 3)

        ood_cfg = spec.get("ood", {})
        mean_vec = np.asarray(ood_cfg.get("mean", []), dtype=float)
        std_vec = np.asarray(ood_cfg.get("std", []), dtype=float)
        inv_cov = np.asarray(ood_cfg.get("inv_cov", []), dtype=float)
        thresholds = ood_cfg.get("thresholds", {})
        p95_thr = float(thresholds.get("p95", 4.233))
        p99_thr = float(thresholds.get("p99", 4.988))
        p999_thr = float(thresholds.get("p999", 7.546))

        ood_dist = 0.0
        ood_notes: list[str] = []
        if len(mean_vec) == len(SERVING_FEATURE_ORDER) and inv_cov.shape == (len(SERVING_FEATURE_ORDER), len(SERVING_FEATURE_ORDER)):
            vec = np.array([float(features[name]) for name in SERVING_FEATURE_ORDER], dtype=float)
            z = (vec - mean_vec) / np.maximum(std_vec, 1e-6)
            ood_dist = round(float(np.sqrt(max(0.0, float(z @ inv_cov @ z)))), 4)

            bounds = ood_cfg.get("feature_bounds", {})
            for name, label_vi in FEATURE_LABELS_OOD_VI.items():
                f_bound = bounds.get(name)
                val = float(features[name])
                if not isinstance(f_bound, dict):
                    continue
                if val > float(f_bound.get("p99", val)):
                    ood_notes.append(
                        f"{label_vi} = {features[name]} vượt ngưỡng phân vị 99% của tập huấn luyện Portugal (p99 = {f_bound['p99']:.2g})."
                    )
                elif val < float(f_bound.get("p01", val)):
                    ood_notes.append(
                        f"{label_vi} = {features[name]} thấp hơn ngưỡng phân vị 1% của tập huấn luyện Portugal (p01 = {f_bound['p01']:.2g})."
                    )

        if ood_dist <= p95_thr:
            ood_status = "in_distribution"
            if not ood_notes:
                ood_notes.append(
                    f"Tổ hợp đặc trưng nằm gọn trong vùng dữ liệu huấn luyện Portugal (Mahalanobis {ood_dist:.2f} ≤ p95 {p95_thr:.2f})."
                )
        elif ood_dist <= p999_thr:
            ood_status = "border"
            if not ood_notes:
                ood_notes.append(
                    f"Tổ hợp đặc trưng thuộc vùng rìa phân phối huấn luyện (top 5%, Mahalanobis {ood_dist:.2f}); nên kiểm chứng khoảng tin cậy Conformal."
                )
        else:
            ood_status = "out_of_distribution"
            ood_notes.append(
                f"Ngoại lai phân phối huấn luyện (Mahalanobis {ood_dist:.2f} > p99.9 {p999_thr:.2f}): hệ số ML đang ngoại suy, cần ưu tiên sàn/trần chính sách [D]."
            )

        return UncertaintyInterval(
            method=str(conformal_cfg.get("method", "smoothed_locally_adaptive_split_conformal")),
            calibration_rows=cal_rows,
            ensemble_p10=ensemble_p10,
            ensemble_p50=ensemble_p50,
            ensemble_p90=ensemble_p90,
            ensemble_std=ensemble_std,
            conformal_alpha=alpha,
            target_coverage=target_cov,
            empirical_holdout_coverage=float(empirical_cov) if empirical_cov is not None else None,
            conformal_low=conformal_low,
            conformal_high=conformal_high,
            ood_distance=ood_dist,
            ood_p95_threshold=round(p95_thr, 4),
            ood_p99_threshold=round(p99_thr, 4),
            ood_status=ood_status,
            ood_notes=ood_notes,
        )

    def predict_multiplier(self, payload: PricingRequest) -> float:
        return self.predict(payload).multiplier

    def predict(self, payload: PricingRequest) -> PricingPrediction:
        if self._model is None or self._metadata is None:
            raise ModelUnavailableError("Pricing model is unavailable.")

        features = build_serving_features(
            lead_time=payload.lead_time,
            check_in=payload.check_in_date,
            check_out=payload.check_out_date,
            guest_count=payload.guest_count,
        )
        frame = pd.DataFrame(
            [[features[name] for name in SERVING_FEATURE_ORDER]],
            columns=list(SERVING_FEATURE_ORDER),
        )

        try:
            prediction = self._model.predict(frame)
            multiplier = float(prediction[0])
        except Exception as error:
            logger.exception("Pricing model inference failed")
            raise InferenceError("Pricing inference failed.") from error

        if not math.isfinite(multiplier):
            logger.error("Pricing model returned a non-finite multiplier: %r", multiplier)
            raise InferenceError("Pricing inference failed.")

        bounded_multiplier = min(MAX_MULTIPLIER, max(MIN_MULTIPLIER, multiplier))
        if bounded_multiplier != multiplier:
            logger.warning(
                "Pricing multiplier %.6f was clamped to %.6f",
                multiplier,
                bounded_multiplier,
            )

        uncertainty = self._compute_uncertainty(
            bounded_multiplier=bounded_multiplier,
            frame=frame,
            features=features,
        )

        return PricingPrediction(
            multiplier=round(bounded_multiplier, 3),
            model_version=str(self._metadata["model_version"]),
            training_run_id=str(self._metadata["training_run_id"]),
            feature_contract_version=SERVING_CONTRACT_VERSION,
            features=features,
            feature_importance=deepcopy(self._feature_importance),
            uncertainty=uncertainty,
        )

    def explain_prediction(
        self, payload: PricingRequest
    ) -> tuple["PricingPrediction", PriceExplanation]:
        """Produce validated local feature attributions using the Saabas Tree Interpreter.

        Decomposes the prediction across all decision paths in the Random Forest ensemble:
            prediction(x) - baseline = sum_i(phi_i)
        """
        if self._model is None or self._metadata is None:
            raise ModelUnavailableError("Pricing model is unavailable.")

        if not hasattr(self._model, "estimators_"):
            raise ModelUnavailableError("Pricing explanations have not been validated.")

        prediction = self.predict(payload)

        features = build_serving_features(
            lead_time=payload.lead_time,
            check_in=payload.check_in_date,
            check_out=payload.check_out_date,
            guest_count=payload.guest_count,
        )
        frame = pd.DataFrame(
            [[features[name] for name in SERVING_FEATURE_ORDER]],
            columns=list(SERVING_FEATURE_ORDER),
        )

        try:
            explanation = explain_random_forest(
                model=self._model,
                feature_frame=frame,
                features_dict=features,
            )
        except Exception as error:
            logger.exception("Pricing model explanation failed")
            raise InferenceError("Pricing explanation failed.") from error

        return prediction, explanation

    @staticmethod
    def _unpack_artifact(artifact: Any) -> tuple[Any, dict[str, Any]]:
        if not isinstance(artifact, dict) or "model" not in artifact:
            logger.warning(
                "Loaded a legacy unversioned pricing artifact; retrain it to attach metrics."
            )
            return artifact, {
                "artifact_schema_version": "legacy",
                "model_version": "legacy-unversioned",
                "training_run_id": "unknown",
                "feature_contract": {"version": SERVING_CONTRACT_VERSION, "feature_order": list(SERVING_FEATURE_ORDER)},
                "evaluation": {},
            }

        schema_version = artifact.get("artifact_schema_version")
        if schema_version != MODEL_ARTIFACT_SCHEMA_VERSION:
            raise ValueError(
                f"Unsupported artifact schema {schema_version!r}; "
                f"expected {MODEL_ARTIFACT_SCHEMA_VERSION!r}."
            )
        metadata = artifact.get("metadata")
        if not isinstance(metadata, dict):
            raise ValueError("Model artifact metadata is missing or invalid.")

        normalized_metadata = deepcopy(metadata)
        normalized_metadata["artifact_schema_version"] = schema_version
        return artifact["model"], normalized_metadata

    @staticmethod
    def _validate_metadata(metadata: dict[str, Any]) -> None:
        model_version = metadata.get("model_version")
        if not isinstance(model_version, str) or not model_version.strip():
            raise ValueError("Model metadata must contain a non-empty model_version.")
        training_run_id = metadata.get("training_run_id")
        if not isinstance(training_run_id, str) or not training_run_id.strip():
            raise ValueError("Model metadata must contain a non-empty training_run_id.")

        contract = metadata.get("feature_contract")
        if not isinstance(contract, dict):
            raise ValueError("Model metadata must contain the feature contract.")
        if contract.get("version") != SERVING_CONTRACT_VERSION:
            raise ValueError("Experimental pricing contract is not released for quotes.")
        if contract.get("feature_order") != list(SERVING_FEATURE_ORDER):
            raise ValueError("Artifact feature order differs from the serving contract.")

    @staticmethod
    def _validate_model(model: Any) -> None:
        if not callable(getattr(model, "predict", None)):
            raise ValueError("Loaded artifact does not expose predict().")
        if getattr(model, "n_features_in_", None) != len(SERVING_FEATURE_ORDER):
            raise ValueError("Model feature count differs from the serving contract.")
        if list(getattr(model, "feature_names_in_", ())) != list(SERVING_FEATURE_ORDER):
            raise ValueError("Model feature names/order differ from the serving contract.")
