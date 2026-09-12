from __future__ import annotations

from dataclasses import dataclass

from app.core.conversion_feature_contract import CAUSALITY_WARNING
from app.schemas.conversion_schema import ShadowOptimizationRequest
from app.services.conversion_inference import ConversionInferenceService


@dataclass(frozen=True, slots=True)
class CandidateScore:
    multiplier: float
    nightly_price: float
    conversion_probability: float
    expected_room_revenue_per_night: float


@dataclass(frozen=True, slots=True)
class ShadowOptimization:
    champion_multiplier: float
    champion_conversion_probability: float
    proposed_multiplier: float
    guardrailed_multiplier: float
    guardrail_status: str
    guardrail_reasons: tuple[str, ...]
    selected_conversion_probability: float
    candidate_scores: tuple[CandidateScore, ...]
    model_version: str
    training_run_id: str
    feature_contract_version: str
    causality_warning: str = CAUSALITY_WARNING


class ShadowPriceOptimizer:
    """Observational candidate scorer; never connected to the served quote price."""

    def __init__(self, conversion_service: ConversionInferenceService) -> None:
        self._conversion_service = conversion_service

    def optimize(self, payload: ShadowOptimizationRequest) -> ShadowOptimization:
        candidates = self._candidate_multipliers(payload)
        scores = tuple(self._score(payload, multiplier) for multiplier in candidates)
        champion_score = self._score(payload, payload.champion_multiplier)
        proposed = max(
            scores,
            key=lambda score: (
                score.expected_room_revenue_per_night,
                -abs(score.multiplier - payload.champion_multiplier),
            ),
        )

        relative_floor = payload.champion_multiplier * (
            1 - payload.guardrail_max_change_ratio
        )
        relative_ceiling = payload.champion_multiplier * (
            1 + payload.guardrail_max_change_ratio
        )
        lower_bound = max(payload.guardrail_min_multiplier, relative_floor)
        upper_bound = min(payload.guardrail_max_multiplier, relative_ceiling)
        reasons: list[str] = []
        if proposed.multiplier < payload.guardrail_min_multiplier:
            reasons.append("absolute_min")
        if proposed.multiplier > payload.guardrail_max_multiplier:
            reasons.append("absolute_max")
        if proposed.multiplier < relative_floor:
            reasons.append("change_floor")
        if proposed.multiplier > relative_ceiling:
            reasons.append("change_ceiling")

        if lower_bound > upper_bound:
            guarded = payload.champion_multiplier
            reasons.append("empty_policy_interval")
            status = "policy_conflict"
        else:
            guarded = min(upper_bound, max(lower_bound, proposed.multiplier))
            status = "within_policy" if not reasons else "adjusted"
        guarded = round(guarded, 6)
        selected = (
            proposed
            if abs(proposed.multiplier - guarded) <= 1e-9
            else self._score(payload, guarded)
        )
        first_prediction = self._conversion_service.predict(
            payload.model_copy(
                update={
                    "offered_nightly_price": round(
                        payload.base_price * payload.champion_multiplier, 6
                    )
                }
            )
        )
        return ShadowOptimization(
            champion_multiplier=round(payload.champion_multiplier, 6),
            champion_conversion_probability=champion_score.conversion_probability,
            proposed_multiplier=proposed.multiplier,
            guardrailed_multiplier=guarded,
            guardrail_status=status,
            guardrail_reasons=tuple(reasons),
            selected_conversion_probability=selected.conversion_probability,
            candidate_scores=scores,
            model_version=first_prediction.model_version,
            training_run_id=first_prediction.training_run_id,
            feature_contract_version=first_prediction.feature_contract_version,
        )

    def _candidate_multipliers(
        self, payload: ShadowOptimizationRequest
    ) -> tuple[float, ...]:
        values = {
            round(
                min(
                    5.0,
                    max(
                        0.1,
                        payload.champion_multiplier
                        * (1 + step * payload.candidate_step_ratio),
                    ),
                ),
                6,
            )
            for step in range(-payload.candidate_steps, payload.candidate_steps + 1)
        }
        values.add(round(payload.champion_multiplier, 6))
        return tuple(sorted(values))

    def _score(
        self, payload: ShadowOptimizationRequest, multiplier: float
    ) -> CandidateScore:
        nightly_price = round(payload.base_price * multiplier, 6)
        prediction = self._conversion_service.predict(
            payload.model_copy(update={"offered_nightly_price": nightly_price})
        )
        expected_revenue = nightly_price * prediction.probability
        return CandidateScore(
            multiplier=round(multiplier, 6),
            nightly_price=nightly_price,
            conversion_probability=prediction.probability,
            expected_room_revenue_per_night=round(expected_revenue, 6),
        )
