from __future__ import annotations

import logging
import math
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

import joblib
import pandas as pd

from app.core.conversion_feature_contract import (
    CONVERSION_FEATURE_CONTRACT_VERSION,
    CONVERSION_FEATURE_ORDER,
    build_conversion_features,
)
from app.schemas.conversion_schema import ConversionRequest
from app.services.inference import InferenceError, ModelUnavailableError

logger = logging.getLogger(__name__)

CONVERSION_ARTIFACT_SCHEMA_VERSION: Final = "1.0.0"
CONVERSION_MODEL_KIND: Final = "conversion_challenger"
CONVERSION_PROVENANCE_POLICY_VERSION: Final = "1.0.0"


@dataclass(frozen=True, slots=True)
class ConversionPrediction:
    probability: float
    model_version: str
    training_run_id: str
    feature_contract_version: str
    features: dict[str, int | float | str]


class ConversionInferenceService:
    """Optional shadow-only model; its availability never gates pricing health."""

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
        if not self._model_path.is_file():
            self.unload()
            logger.info(
                "Conversion challenger is unavailable; no artifact at %s",
                self._model_path,
            )
            return
        try:
            artifact = joblib.load(self._model_path)
            model, metadata = self._unpack_artifact(artifact)
            self._validate_model(model)
            self._validate_metadata(metadata)
        except Exception:
            self.unload()
            logger.exception(
                "Unable to load optional conversion challenger from %s",
                self._model_path,
            )
            return

        self._model = model
        self._metadata = metadata
        logger.info(
            "Loaded shadow conversion challenger version=%s run=%s from %s",
            metadata["model_version"],
            metadata["training_run_id"],
            self._model_path,
        )

    def unload(self) -> None:
        self._model = None
        self._metadata = None

    def predict(self, payload: ConversionRequest) -> ConversionPrediction:
        if self._model is None or self._metadata is None:
            raise ModelUnavailableError("Conversion challenger is unavailable.")

        features = build_conversion_features(
            lead_time=payload.lead_time,
            check_in=payload.check_in_date,
            check_out=payload.check_out_date,
            guest_count=payload.guest_count,
            capacity_snapshot=payload.capacity_snapshot,
            rooms_available=payload.rooms_available,
            rooms_sellable_snapshot=payload.rooms_sellable_snapshot,
            rooms_booked_snapshot=payload.rooms_booked_snapshot,
            occupancy_ratio_snapshot=payload.occupancy_ratio_snapshot,
            base_price=payload.base_price,
            offered_nightly_price=payload.offered_nightly_price,
            room_type_name=payload.room_type_name,
            currency=payload.currency,
            pricing_source=payload.pricing_source,
        )
        frame = pd.DataFrame(
            [[features[name] for name in CONVERSION_FEATURE_ORDER]],
            columns=list(CONVERSION_FEATURE_ORDER),
        )
        try:
            probabilities = self._model.predict_proba(frame)
            probability = float(probabilities[0][1])
        except Exception as error:
            logger.exception("Conversion challenger inference failed")
            raise InferenceError("Conversion inference failed.") from error
        if not math.isfinite(probability) or not 0 <= probability <= 1:
            logger.error(
                "Conversion challenger returned invalid probability: %r", probability
            )
            raise InferenceError("Conversion inference failed.")

        return ConversionPrediction(
            probability=round(probability, 6),
            model_version=str(self._metadata["model_version"]),
            training_run_id=str(self._metadata["training_run_id"]),
            feature_contract_version=CONVERSION_FEATURE_CONTRACT_VERSION,
            features=features,
        )

    @staticmethod
    def _unpack_artifact(artifact: Any) -> tuple[Any, dict[str, Any]]:
        if not isinstance(artifact, dict):
            raise ValueError("Conversion artifact must be a versioned mapping.")
        if artifact.get("artifact_schema_version") != CONVERSION_ARTIFACT_SCHEMA_VERSION:
            raise ValueError("Unsupported conversion artifact schema.")
        metadata = artifact.get("metadata")
        if not isinstance(metadata, dict):
            raise ValueError("Conversion artifact metadata is missing or invalid.")
        normalized = deepcopy(metadata)
        normalized["artifact_schema_version"] = artifact["artifact_schema_version"]
        return artifact.get("model"), normalized

    @staticmethod
    def _validate_metadata(metadata: dict[str, Any]) -> None:
        if metadata.get("model_kind") != CONVERSION_MODEL_KIND:
            raise ValueError("Artifact is not a conversion challenger.")
        if metadata.get("lifecycle_stage") != "shadow_only":
            raise ValueError("Conversion challenger must remain shadow-only.")
        for field in ("model_version", "training_run_id"):
            if not isinstance(metadata.get(field), str) or not metadata[field].strip():
                raise ValueError(f"Conversion metadata requires {field}.")
        contract = metadata.get("feature_contract")
        if not isinstance(contract, dict):
            raise ValueError("Conversion feature contract is missing.")
        if contract.get("version") != CONVERSION_FEATURE_CONTRACT_VERSION:
            raise ValueError("Conversion feature contract version is incompatible.")
        if tuple(contract.get("feature_order", ())) != CONVERSION_FEATURE_ORDER:
            raise ValueError("Conversion feature order is incompatible.")
        quality = metadata.get("data_quality", {})
        if not isinstance(quality, dict) or quality.get("passes_readiness_gate") is not True:
            raise ValueError("Conversion artifact did not pass its data-readiness gate.")
        if (quality.get("provenance_policy_version") != CONVERSION_PROVENANCE_POLICY_VERSION
                or quality.get("missing_provenance_columns") != []):
            raise ValueError("Conversion artifact requires verified data provenance under the current policy.")
        eligible = quality.get("eligible_rows")
        observed = quality.get("verified_observed_rows")
        if (type(eligible) is not int or type(observed) is not int
                or eligible <= 0 or observed < eligible):
            raise ValueError("Conversion artifact has no verified eligible observations.")
        if metadata.get("evaluation", {}).get("passes_performance_gate") is not True:
            raise ValueError("Conversion artifact did not pass its performance gate.")

    @staticmethod
    def _validate_model(model: Any) -> None:
        if not callable(getattr(model, "predict_proba", None)):
            raise ValueError("Conversion artifact does not expose predict_proba().")
        feature_names = getattr(model, "feature_names_in_", None)
        if feature_names is not None:
            actual_order = tuple(str(feature) for feature in feature_names)
            if actual_order != CONVERSION_FEATURE_ORDER:
                raise ValueError("Conversion model feature order is incompatible.")
        feature_count = getattr(model, "n_features_in_", None)
        if feature_count is not None and int(feature_count) != len(
            CONVERSION_FEATURE_ORDER
        ):
            raise ValueError("Conversion model feature count is incompatible.")
