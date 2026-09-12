import logging
import math
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

import joblib
import pandas as pd

from app.core.feature_contract import (
    FEATURE_CONTRACT_VERSION,
    FEATURE_ORDER,
    build_pricing_features,
    feature_contract_metadata,
)
from app.schemas.pricing_schema import PricingRequest

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


class PricingInferenceService:
    def __init__(self, model_path: Path) -> None:
        self._model_path = model_path
        self._model: Any | None = None
        self._metadata: dict[str, Any] | None = None

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
            logger.exception("Unable to load pricing model from %s", self._model_path)
            return

        self._model = model
        self._metadata = metadata
        logger.info(
            "Loaded pricing model version=%s run=%s from %s",
            metadata["model_version"],
            metadata.get("training_run_id", "unknown"),
            self._model_path,
        )

    def unload(self) -> None:
        self._model = None
        self._metadata = None

    def predict_multiplier(self, payload: PricingRequest) -> float:
        return self.predict(payload).multiplier

    def predict(self, payload: PricingRequest) -> PricingPrediction:
        if self._model is None or self._metadata is None:
            raise ModelUnavailableError("Pricing model is unavailable.")

        features = build_pricing_features(
            lead_time=payload.lead_time,
            check_in=payload.check_in_date,
            check_out=payload.check_out_date,
            guest_count=payload.guest_count,
        )
        frame = pd.DataFrame(
            [[features[feature] for feature in FEATURE_ORDER]],
            columns=list(FEATURE_ORDER),
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

        return PricingPrediction(
            multiplier=round(bounded_multiplier, 3),
            model_version=str(self._metadata["model_version"]),
            training_run_id=str(self._metadata["training_run_id"]),
            feature_contract_version=FEATURE_CONTRACT_VERSION,
            features=features,
        )

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
                "feature_contract": feature_contract_metadata(),
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
        if contract.get("version") != FEATURE_CONTRACT_VERSION:
            raise ValueError(
                f"Model feature contract {contract.get('version')!r} does not match "
                f"serving contract {FEATURE_CONTRACT_VERSION!r}."
            )
        if tuple(contract.get("feature_order", ())) != FEATURE_ORDER:
            raise ValueError("Model metadata feature order does not match serving order.")

    @staticmethod
    def _validate_model(model: Any) -> None:
        if not callable(getattr(model, "predict", None)):
            raise ValueError("Loaded artifact does not expose predict().")

        feature_names = getattr(model, "feature_names_in_", None)
        if feature_names is not None:
            actual_order = tuple(str(feature) for feature in feature_names)
            if actual_order != FEATURE_ORDER:
                raise ValueError(
                    f"Model feature order {actual_order!r} does not match {FEATURE_ORDER!r}."
                )

        feature_count = getattr(model, "n_features_in_", None)
        if feature_count is not None and int(feature_count) != len(FEATURE_ORDER):
            raise ValueError(
                f"Model expects {feature_count} features; {len(FEATURE_ORDER)} are required."
            )
