"""Guardrailed Thompson Sampling Bandit Lab & Conversion Taxonomy Audit (E4).

Strictly advisory & simulation-only benchmark for safe dynamic pricing exploration:
  - Compares Static Base, Rule Heuristic, Unconstrained Epsilon-Greedy, and
    Guardrailed Beta-Bernoulli Thompson Sampling constrained inside (D)
    [contribution_floor_vnd, declared_max_price_vnd].
  - Performs structural taxonomy audit between live White Sand Hotel Danang room
    types and the legacy `conversion_challenger_v1.metadata.json` artifact.
  - NEVER claims causal conversion elasticity was learned from real Danang demand
    and NEVER auto-promotes shadow models to production checkout.
"""
from __future__ import annotations

import json
import math
import random
from pathlib import Path
from typing import Any

from app.core.config import DEFAULT_CONVERSION_MODEL_PATH
from app.core.conversion_feature_contract import CAUSALITY_WARNING

MIN_LEGAL_FLOOR_VND = 452_000.0

DEFAULT_WHITE_SAND_ROOM_NAMES = [
    "Superior Room",
    "Deluxe Room",
    "Premium Room",
    "Executive Room",
    "Suite",
    "Studio Apartment",
]

SCENARIO_BASE_INTERCEPT = {
    "monsoon_low": -0.45,
    "standard": 0.10,
    "weekend_high": 0.45,
    "holiday_surge": 0.85,
}


def _sigmoid(x: float) -> float:
    if x >= 35:
        return 1.0
    if x <= -35:
        return 0.0
    return 1.0 / (1.0 + math.exp(-x))


class BanditPricingLabService:
    """Offline/simulated contextual bandit benchmark + conversion taxonomy auditor."""

    def __init__(self, metadata_path: Path | None = None) -> None:
        if metadata_path is not None:
            self._metadata_path = metadata_path
        else:
            self._metadata_path = DEFAULT_CONVERSION_MODEL_PATH.with_suffix(".metadata.json")

    def inspect_conversion_taxonomy(
        self, live_room_type_names: list[str] | None = None
    ) -> dict[str, Any]:
        live_names = [
            name.strip()
            for name in (live_room_type_names or DEFAULT_WHITE_SAND_ROOM_NAMES)
            if name and name.strip()
        ]
        meta: dict[str, Any] = {}
        if self._metadata_path.is_file():
            try:
                meta = json.loads(self._metadata_path.read_text(encoding="utf-8"))
            except Exception:
                meta = {}

        quality = meta.get("data_quality") if isinstance(meta.get("data_quality"), dict) else {}
        room_type_counts = (
            quality.get("room_type_counts")
            if isinstance(quality.get("room_type_counts"), dict)
            else {}
        )
        artifact_room_types = sorted(str(k) for k in room_type_counts.keys())
        artifact_lower = {k.strip().lower(): k for k in artifact_room_types}
        live_lower = {k.strip().lower(): k for k in live_names}

        matched = [
            live_lower[key] for key in live_lower.keys() if key in artifact_lower
        ]
        unseen_live = [
            live_lower[key] for key in live_lower.keys() if key not in artifact_lower
        ]
        legacy_only = [
            artifact_lower[key] for key in artifact_lower.keys() if key not in live_lower
        ]
        overlap_pct = (
            round((len(matched) / len(live_names)) * 100.0, 1) if live_names else 0.0
        )
        has_drift = len(unseen_live) > 0 or len(legacy_only) > 0

        candidate_eval = (
            meta.get("evaluation", {}).get("candidate", {})
            if isinstance(meta.get("evaluation"), dict)
            else {}
        )

        blockers_vi = [
            (
                f"Độ trùng khớp danh mục hạng phòng chỉ đạt {overlap_pct}% "
                f"({len(matched)}/{len(live_names)} hạng phòng White Sand có trong conversion_challenger_v1)."
            ),
            (
                f"{len(unseen_live)} hạng phòng hiện tại ({', '.join(unseen_live[:6])}) "
                f"chưa từng xuất hiện trong tập huấn luyện cũ ({len(legacy_only)} nhãn resort cũ)."
            )
            if unseen_live
            else "Tất cả hạng phòng hiện tại khớp danh mục huấn luyện.",
            (
                "Hệ số giá trong conversion_challenger_v1 chỉ phản ánh tương quan quan sát, "
                "không phải độ co giãn cầu nhân quả và bị khóa tự động nâng cấp."
            ),
        ]

        return {
            "artifact_found": bool(meta),
            "model_version": str(meta.get("model_version") or "conversion_challenger_v1"),
            "training_run_id": str(meta.get("training_run_id") or "unavailable"),
            "artifact_eligible_rows": int(quality.get("eligible_rows") or 0),
            "artifact_roc_auc": (
                round(float(candidate_eval["roc_auc"]), 4)
                if candidate_eval.get("roc_auc") is not None
                else None
            ),
            "artifact_brier_score": (
                round(float(candidate_eval["brier_score"]), 4)
                if candidate_eval.get("brier_score") is not None
                else None
            ),
            "live_room_types": live_names,
            "artifact_room_types": artifact_room_types,
            "matched_room_types": matched,
            "unseen_live_room_types": unseen_live,
            "legacy_artifact_only_types": legacy_only,
            "taxonomy_overlap_pct": overlap_pct,
            "has_taxonomy_drift": has_drift,
            "promotion_allowed": False,
            "causality_warning": str(meta.get("causality_warning") or CAUSALITY_WARNING),
            "audit_blockers_vi": blockers_vi,
        }

    def simulate_bandit_benchmark(
        self,
        *,
        room_type_id: int = 1,
        room_type_name: str = "Superior Room",
        base_price: float = 1_200_000.0,
        declared_max_price: float = 1_650_000.0,
        serving_cost_per_night: float = 350_000.0,
        channel_commission_pct: float = 0.0,
        tax_rate: float = 0.08,
        service_charge_rate: float = 0.05,
        min_contribution_margin: float = 50_000.0,
        scenario_id: str = "standard",
        true_price_elasticity: float = 1.25,
        episodes: int = 300,
        seed: int = 42,
        live_room_type_names: list[str] | None = None,
    ) -> dict[str, Any]:
        if base_price <= 0:
            raise ValueError("base_price must be positive")
        if episodes < 50 or episodes > 1000:
            raise ValueError("episodes must be between 50 and 1000")

        tax_mult = 1.0 + tax_rate + service_charge_rate
        net_factor = (1.0 / tax_mult) - channel_commission_pct
        if net_factor <= 0.05:
            raise ValueError("Combined tax, service charge, and commission leaves non-positive net share.")

        floor_vnd = int(
            math.ceil(
                max(MIN_LEGAL_FLOOR_VND, (serving_cost_per_night + min_contribution_margin) / net_factor)
                / 1000.0
            )
            * 1000
        )
        ceiling_vnd = max(
            floor_vnd,
            int(math.floor((declared_max_price if declared_max_price > 0 else base_price * 1.4) / 1000.0) * 1000),
        )
        clamped_base = min(max(int(round(base_price / 1000.0) * 1000), floor_vnd), ceiling_vnd)

        # Build 7 safe price arms strictly inside [floor_vnd, ceiling_vnd]
        raw_grid = sorted(
            {
                floor_vnd,
                clamped_base,
                ceiling_vnd,
                *[
                    int(
                        min(
                            max(round(floor_vnd + (ceiling_vnd - floor_vnd) * frac, -3), floor_vnd),
                            ceiling_vnd,
                        )
                    )
                    for frac in (0.16, 0.33, 0.50, 0.67, 0.84)
                ],
            }
        )
        # Keep up to 7 evenly distributed distinct safe arms
        if len(raw_grid) > 7:
            step = (len(raw_grid) - 1) / 6.0
            safe_prices = sorted({raw_grid[round(i * step)] for i in range(7)})
        else:
            safe_prices = raw_grid

        intercept = SCENARIO_BASE_INTERCEPT.get(scenario_id, 0.10)

        def true_conv_prob(price_vnd: int) -> float:
            rel_diff = (price_vnd - base_price) / base_price
            prob = _sigmoid(intercept - true_price_elasticity * 2.1 * rel_diff)
            return min(max(prob, 0.03), 0.92)

        def unit_contrib(price_vnd: int) -> float:
            return price_vnd * net_factor - serving_cost_per_night

        # Unconstrained grid includes unsafe below-floor and above-ceiling prices to prove why guardrails matter
        below_floor_arm = max(250_000, int(round(floor_vnd * 0.72 / 1000.0) * 1000))
        above_ceil_arm = int(round(ceiling_vnd * 1.38 / 1000.0) * 1000)
        unconstrained_prices = sorted({below_floor_arm, *safe_prices, above_ceil_arm})

        safe_arms_meta = []
        for p in safe_prices:
            p_conv = true_conv_prob(p)
            u_contrib = unit_contrib(p)
            safe_arms_meta.append(
                {
                    "price_vnd": int(p),
                    "multiplier": round(p / base_price, 4),
                    "true_conversion_prob": round(p_conv, 4),
                    "unit_contribution_vnd": round(u_contrib, 2),
                    "expected_contribution_vnd": round(p_conv * u_contrib, 2),
                }
            )

        oracle_arm = max(safe_arms_meta, key=lambda item: item["expected_contribution_vnd"])
        oracle_ev = float(oracle_arm["expected_contribution_vnd"])

        # Heuristic arm index (e.g. slight surge if high/surge scenario, discount if monsoon_low)
        if scenario_id in ("weekend_high", "holiday_surge"):
            heuristic_price = safe_prices[min(len(safe_prices) - 1, max(0, int(round((len(safe_prices) - 1) * 0.67))))]
        elif scenario_id == "monsoon_low":
            heuristic_price = safe_prices[min(len(safe_prices) - 1, max(0, int(round((len(safe_prices) - 1) * 0.2))))]
        else:
            heuristic_price = clamped_base

        rng = random.Random(seed)
        # Beta priors (weakly optimistic uniform Beta(1.5, 1.5)) for Guardrailed TS
        ts_alpha = [1.5 for _ in safe_prices]
        ts_beta = [1.5 for _ in safe_prices]
        ts_pulls = [0 for _ in safe_prices]
        ts_conv_hits = [0 for _ in safe_prices]

        # Naive Unconstrained Epsilon-Greedy trackers (epsilon = 0.25)
        eg_counts = [0 for _ in unconstrained_prices]
        eg_values = [0.0 for _ in unconstrained_prices]

        policy_stats: dict[str, dict[str, Any]] = {
            name: {
                "cum_expected_contrib": 0.0,
                "cum_realized_contrib": 0.0,
                "cum_regret": 0.0,
                "conversions": 0,
                "floor_violations": 0,
                "ceiling_violations": 0,
            }
            for name in (
                "guardrailed_thompson_sampling",
                "rule_heuristic",
                "static_base",
                "unconstrained_epsilon_greedy",
            )
        }

        checkpoint_every = max(1, episodes // 24)
        regret_series: list[dict[str, Any]] = []

        static_idx = min(range(len(safe_prices)), key=lambda i: abs(safe_prices[i] - clamped_base))
        heuristic_idx = min(range(len(safe_prices)), key=lambda i: abs(safe_prices[i] - heuristic_price))

        for ep in range(1, episodes + 1):
            # Shared episode demand noise draw U in [0, 1) (common random numbers reduce variance fairly)
            u_draw = rng.random()

            # 1) Static Base
            p_st = safe_prices[static_idx]
            conv_st = 1 if u_draw < true_conv_prob(p_st) else 0
            ev_st = true_conv_prob(p_st) * unit_contrib(p_st)
            policy_stats["static_base"]["cum_expected_contrib"] += ev_st
            policy_stats["static_base"]["cum_realized_contrib"] += conv_st * unit_contrib(p_st)
            policy_stats["static_base"]["cum_regret"] += max(0.0, oracle_ev - ev_st)
            policy_stats["static_base"]["conversions"] += conv_st

            # 2) Fixed Rule Heuristic
            p_hr = safe_prices[heuristic_idx]
            conv_hr = 1 if u_draw < true_conv_prob(p_hr) else 0
            ev_hr = true_conv_prob(p_hr) * unit_contrib(p_hr)
            policy_stats["rule_heuristic"]["cum_expected_contrib"] += ev_hr
            policy_stats["rule_heuristic"]["cum_realized_contrib"] += conv_hr * unit_contrib(p_hr)
            policy_stats["rule_heuristic"]["cum_regret"] += max(0.0, oracle_ev - ev_hr)
            policy_stats["rule_heuristic"]["conversions"] += conv_hr

            # 3) Unconstrained Epsilon-Greedy (epsilon=0.22, no floor/ceiling clamp)
            if rng.random() < 0.22:
                eg_idx = rng.randrange(len(unconstrained_prices))
            else:
                eg_idx = max(range(len(unconstrained_prices)), key=lambda i: eg_values[i])
            p_eg = unconstrained_prices[eg_idx]
            conv_eg = 1 if u_draw < true_conv_prob(p_eg) else 0
            uc_eg = unit_contrib(p_eg)
            ev_eg = true_conv_prob(p_eg) * uc_eg
            eg_counts[eg_idx] += 1
            n_eg = eg_counts[eg_idx]
            reward_eg = conv_eg * uc_eg
            eg_values[eg_idx] += (reward_eg - eg_values[eg_idx]) / n_eg
            policy_stats["unconstrained_epsilon_greedy"]["cum_expected_contrib"] += ev_eg
            policy_stats["unconstrained_epsilon_greedy"]["cum_realized_contrib"] += reward_eg
            policy_stats["unconstrained_epsilon_greedy"]["cum_regret"] += max(0.0, oracle_ev - ev_eg)
            policy_stats["unconstrained_epsilon_greedy"]["conversions"] += conv_eg
            if p_eg < floor_vnd:
                policy_stats["unconstrained_epsilon_greedy"]["floor_violations"] += 1
            if p_eg > ceiling_vnd:
                policy_stats["unconstrained_epsilon_greedy"]["ceiling_violations"] += 1

            # 4) Guardrailed Beta-Bernoulli Thompson Sampling (strictly inside [floor_vnd, ceiling_vnd])
            sampled_scores = [
                rng.betavariate(ts_alpha[i], ts_beta[i]) * unit_contrib(safe_prices[i])
                for i in range(len(safe_prices))
            ]
            ts_idx = max(range(len(safe_prices)), key=lambda i: sampled_scores[i])
            p_ts = safe_prices[ts_idx]
            conv_ts = 1 if u_draw < true_conv_prob(p_ts) else 0
            uc_ts = unit_contrib(p_ts)
            ev_ts = true_conv_prob(p_ts) * uc_ts
            ts_pulls[ts_idx] += 1
            ts_conv_hits[ts_idx] += conv_ts
            if conv_ts == 1:
                ts_alpha[ts_idx] += 1.0
            else:
                ts_beta[ts_idx] += 1.0

            policy_stats["guardrailed_thompson_sampling"]["cum_expected_contrib"] += ev_ts
            policy_stats["guardrailed_thompson_sampling"]["cum_realized_contrib"] += conv_ts * uc_ts
            policy_stats["guardrailed_thompson_sampling"]["cum_regret"] += max(0.0, oracle_ev - ev_ts)
            policy_stats["guardrailed_thompson_sampling"]["conversions"] += conv_ts

            if ep == 1 or ep % checkpoint_every == 0 or ep == episodes:
                regret_series.append(
                    {
                        "episode": ep,
                        "static_regret_vnd": round(policy_stats["static_base"]["cum_regret"]),
                        "heuristic_regret_vnd": round(policy_stats["rule_heuristic"]["cum_regret"]),
                        "eps_greedy_regret_vnd": round(policy_stats["unconstrained_epsilon_greedy"]["cum_regret"]),
                        "thompson_regret_vnd": round(policy_stats["guardrailed_thompson_sampling"]["cum_regret"]),
                        "thompson_cumulative_contrib_vnd": round(
                            policy_stats["guardrailed_thompson_sampling"]["cum_expected_contrib"]
                        ),
                        "static_cumulative_contrib_vnd": round(
                            policy_stats["static_base"]["cum_expected_contrib"]
                        ),
                    }
                )

        policy_labels = {
            "guardrailed_thompson_sampling": ("Guardrailed Thompson Sampling", "TS An Toàn [D]"),
            "rule_heuristic": ("Fixed Scenario Heuristic", "Quy Tắc Cố Định"),
            "static_base": ("Static Base Rate (1.0x)", "Giá Gốc Cố Định"),
            "unconstrained_epsilon_greedy": ("Unconstrained Epsilon-Greedy", "RL Tự Do (Không Guardrail)"),
        }
        policy_summaries = []
        for pid in (
            "guardrailed_thompson_sampling",
            "rule_heuristic",
            "static_base",
            "unconstrained_epsilon_greedy",
        ):
            st = policy_stats[pid]
            violations = st["floor_violations"] + st["ceiling_violations"]
            compliance_pct = round(((episodes - violations) / episodes) * 100.0, 2)
            label_en, label_vi = policy_labels[pid]
            policy_summaries.append(
                {
                    "policy_id": pid,
                    "label_en": label_en,
                    "label_vi": label_vi,
                    "cumulative_expected_contrib_vnd": round(st["cum_expected_contrib"]),
                    "cumulative_realized_contrib_vnd": round(st["cum_realized_contrib"]),
                    "cumulative_regret_vnd": round(st["cum_regret"]),
                    "average_conversion_pct": round((st["conversions"] / episodes) * 100.0, 2),
                    "floor_violations": st["floor_violations"],
                    "ceiling_violations": st["ceiling_violations"],
                    "safety_compliance_pct": compliance_pct,
                }
            )

        thompson_arms = []
        best_emp_idx = max(range(len(safe_prices)), key=lambda i: ts_pulls[i])
        for idx, meta_arm in enumerate(safe_arms_meta):
            a_val = ts_alpha[idx]
            b_val = ts_beta[idx]
            post_mean = a_val / (a_val + b_val)
            thompson_arms.append(
                {
                    "price_vnd": meta_arm["price_vnd"],
                    "multiplier": meta_arm["multiplier"],
                    "pulls": ts_pulls[idx],
                    "empirical_conversions": ts_conv_hits[idx],
                    "posterior_alpha": round(a_val, 2),
                    "posterior_beta": round(b_val, 2),
                    "posterior_mean_conv": round(post_mean, 4),
                    "unit_contribution_vnd": round(meta_arm["unit_contribution_vnd"]),
                    "expected_contribution_vnd": round(meta_arm["expected_contribution_vnd"]),
                    "is_oracle_best": meta_arm["price_vnd"] == oracle_arm["price_vnd"],
                    "is_most_selected": idx == best_emp_idx,
                }
            )

        return {
            "provenance": "(C) SIMULATED_POLICY_BENCHMARK + (D) BUSINESS_RULE_GUARDRAIL",
            "automatic_promotion": False,
            "room_type_id": room_type_id,
            "room_type_name": room_type_name,
            "scenario_id": scenario_id,
            "true_price_elasticity": round(true_price_elasticity, 2),
            "episodes": episodes,
            "guardrails": {
                "contribution_floor_vnd": floor_vnd,
                "declared_ceiling_vnd": ceiling_vnd,
                "base_price_vnd": clamped_base,
                "safe_arm_count": len(safe_prices),
            },
            "oracle_best_arm": {
                "price_vnd": oracle_arm["price_vnd"],
                "multiplier": oracle_arm["multiplier"],
                "expected_conversion_pct": round(oracle_arm["true_conversion_prob"] * 100.0, 2),
                "expected_contribution_vnd": round(oracle_arm["expected_contribution_vnd"]),
            },
            "policy_summaries": policy_summaries,
            "regret_series": regret_series,
            "thompson_arms": thompson_arms,
            "taxonomy_audit": self.inspect_conversion_taxonomy(live_room_type_names),
        }
