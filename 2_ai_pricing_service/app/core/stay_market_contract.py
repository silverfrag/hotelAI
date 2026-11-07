"""Internal, versioned coverage contract; never trusts browser-supplied inventory.

Assessment only. This module issues no quote, performs no collection, and loads no
model. Backend integration and policy rounding require the separate M3 approval.
"""
from datetime import date, datetime, timedelta
from decimal import Decimal
import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

GROUPS = {"weather": (Decimal("0.8"), 6), "events": (Decimal("1"), 12),
          "competitors": (Decimal("1"), 2)}


class CoreNight(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    night: date
    available_rooms: int = Field(ge=0, strict=True)
    policy_price: Decimal = Field(gt=0, allow_inf_nan=False)
    floor: Decimal = Field(ge=0, allow_inf_nan=False)
    ceiling: Decimal = Field(gt=0, allow_inf_nan=False)
    variable_cost: Decimal = Field(ge=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def valid_price(self):
        if not self.floor <= self.policy_price <= self.ceiling or self.variable_cost > self.policy_price:
            raise ValueError("Invalid backend policy price or business constraints")
        return self


class StayCore(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    origin: Literal["backend_inventory_policy"]
    room_type_id: int = Field(gt=0, strict=True)
    capacity: int = Field(gt=0, strict=True)
    guests: int = Field(gt=0, strict=True)
    check_in: date
    check_out: date
    policy_version: str = Field(min_length=1)
    timezone: Literal["Asia/Bangkok"] = "Asia/Bangkok"
    nights: tuple[CoreNight, ...]

    @model_validator(mode="after")
    def complete_core(self):
        if self.check_out <= self.check_in or self.guests > self.capacity:
            raise ValueError("Invalid stay dates or room capacity")
        expected = {self.check_in + timedelta(days=i) for i in range((self.check_out - self.check_in).days)}
        actual = [night.night for night in self.nights]
        if len(actual) != len(expected) or set(actual) != expected:
            raise ValueError("Backend core must cover every stay night exactly once")
        return self


class CoverageEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    source_id: str = Field(min_length=1)
    group: Literal["weather", "events", "competitors"]
    observed_at: datetime
    covered_nights: frozenset[date]
    validated: bool = False
    geography: Literal["VN-DN"]
    coverage_basis: Literal["daily_forecast", "declared_source_window", "whole_stay_comparable_rate"]
    extraction_kind: Literal["structured", "llm"] = "structured"
    hotel_id: str | None = None
    provenance: Literal["live", "replay"] = "live"


class StayFeatureContract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    version: str = "stay-market-v1-full"
    disabled_groups: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def approved_variant(self):
        if any(group not in GROUPS or not approval.strip() for group, approval in self.disabled_groups.items()):
            raise ValueError("Disabled groups require a recorded user approval")
        if self.disabled_groups and self.version == "stay-market-v1-full":
            raise ValueError("Disabled features require a distinct contract/model version")
        return self


def assess_stay_context(core: StayCore, evidence: list[CoverageEvidence], *, now: datetime,
                        contract: StayFeatureContract | None = None, model_ready=False, llm_gate_passed=False):
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("Assessment time must have timezone")
    contract = contract or StayFeatureContract.model_validate(json.loads(
        (Path(__file__).with_name("stay_feature_contract.json")).read_text(encoding="utf8")))
    nights = {night.night for night in core.nights}
    quote_allowed = all(night.available_rooms > 0 for night in core.nights)
    coverage, reasons = {}, []
    for group, (threshold, age_hours) in GROUPS.items():
        if group in contract.disabled_groups:
            coverage[group] = {"status": "disabled_by_approved_branch", "approval": contract.disabled_groups[group]}
            continue
        accepted, rejected = [], []
        expected_basis = {"weather": "daily_forecast", "events": "declared_source_window",
                          "competitors": "whole_stay_comparable_rate"}[group]
        for item in (item for item in evidence if item.group == group):
            if item.observed_at.tzinfo is None or item.observed_at.utcoffset() is None:
                rejected.append("invalid_observation_time")
                continue
            age = now - item.observed_at
            if not item.validated or item.coverage_basis != expected_basis:
                rejected.append("unvalidated_or_unknown_window")
            elif item.provenance != "live":
                rejected.append("replay_excluded_from_live_features")
            elif item.extraction_kind == "llm" and not llm_gate_passed:
                rejected.append("llm_gate_not_passed")
            elif age < timedelta(0) or age > timedelta(hours=age_hours):
                rejected.append("stale_or_future_observation")
            else:
                accepted.append(item)
        if group == "competitors":
            # Never assemble a stay from partial quotes or duplicate one hotel.
            hotels = {item.hotel_id for item in accepted if item.hotel_id and nights <= item.covered_nights}
            covered = nights if len(hotels) >= 2 else set()
        else:
            covered = set()
            for item in accepted:
                covered.update(nights & item.covered_nights)
        ratio = Decimal(len(covered)) / len(nights)
        enough = ratio >= threshold
        missing = sorted(day.isoformat() for day in nights - covered)
        coverage[group] = {"status": "sufficient" if enough else "insufficient_data",
                           "covered_nights": len(covered), "total_nights": len(nights),
                           "coverage_ratio": float(ratio), "required_ratio": float(threshold),
                           "missing_nights": missing, "missing_mask": [day not in covered for day in sorted(nights)],
                           "missing_value": None, "rejection_reasons": sorted(set(rejected))}
        if not enough:
            reasons.append(group + "_coverage_below_threshold")
    if not quote_allowed:
        reasons.append("backend_inventory_unavailable")
    return {"contract_version": contract.version, "quote_allowed": quote_allowed,
            "coverage": coverage, "context_eligible_for_training": quote_allowed and not reasons,
            "price_source": "no_quote" if not quote_allowed else "policy",
            # V1 remains shadow only even when all coverage and model gates pass.
            "shadow_eligible": quote_allowed and not reasons and model_ready,
            "conversion_probability": None, "reasons": reasons + ([] if model_ready else ["conversion_not_ready"])}
