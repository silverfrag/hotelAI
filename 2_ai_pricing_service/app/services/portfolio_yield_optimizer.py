"""Joint Multi-Night Portfolio Yield & Cross-Tier Upgrade Optimizer (OR-Tools CP-SAT).

Combines all four grounded provenance sources:
  (A) ML_REAL_DATA: `academic_v1` Portugal cancellation risk proxy (advisory weight).
  (B) SIMULATED_SYSTEM_STATE: Live PostgreSQL night-by-night sellable inventory.
  (C) SIMULATED_ASSUMPTION: Scenario baseline demand & log-linear price-elasticity curve.
  (D) BUSINESS_RULE: Contribution floor, declared Da Nang ceilings, monotonic 6-tier
      price ladder, optional 1-tier complimentary free upgrade conservation & CP-SAT solver.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any

from ortools.sat.python import cp_model

from app.schemas.academic_schema import AcademicBookingRequest
from app.services.academic_inference import AcademicInferenceService

logger = logging.getLogger(__name__)

UNIT_SCALE = 10  # Represent 0.1 room-night units cleanly as CP-SAT integers
MIN_LEGAL_FLOOR_VND = 452_000.0
UPGRADE_HOSPITALITY_COST_VND = 35_000.0
PRICE_GRID_MULTIPLIERS = (0.82, 0.90, 0.96, 1.00, 1.06, 1.14, 1.24)

SCENARIO_DEMAND_MULT = {
    "monsoon_low": 0.72,
    "standard": 1.00,
    "weekend_high": 1.28,
    "holiday_surge": 1.65,
}

# Deterministic tier share across 6 White Sand Boutique Hotel room types
DEFAULT_TIER_DEMAND_SHARE = {
    1: 1.05,  # Superior
    2: 0.98,  # Deluxe
    3: 0.85,  # Premium
    4: 0.78,  # Executive
    5: 0.72,  # Suite
    6: 0.65,  # Studio Apartment
}

ACADEMIC_ROOM_CODE = {
    1: "A",
    2: "D",
    3: "E",
    4: "F",
    5: "G",
    6: "G",
}

_ACADEMIC_SERVICE: AcademicInferenceService | None = None


def _get_academic_service() -> AcademicInferenceService | None:
    global _ACADEMIC_SERVICE
    if _ACADEMIC_SERVICE is None:
        svc = AcademicInferenceService()
        svc.load()
        _ACADEMIC_SERVICE = svc
    return _ACADEMIC_SERVICE if _ACADEMIC_SERVICE.bundle is not None else None


@dataclass(frozen=True, slots=True)
class PortfolioTierInput:
    type_id: int
    type_name: str
    base_price: float
    declared_max_price: float
    sellable_rooms: int
    nightly_available: list[int]
    nightly_booked: list[int] = field(default_factory=list)


class PortfolioYieldOptimizer:
    """Exact CP-SAT joint pricing & cross-tier complimentary upgrade solver."""

    def __init__(
        self,
        *,
        academic_service: AcademicInferenceService | None = None,
        time_limit_seconds: float = 1.5,
    ) -> None:
        self._academic_override = academic_service
        self.time_limit_seconds = time_limit_seconds

    def _academic_cancel_prob(
        self,
        *,
        tier_id: int,
        stay_date: date,
        today: date,
    ) -> tuple[float, str]:
        svc = self._academic_override if self._academic_override is not None else _get_academic_service()
        if svc is not None and svc.bundle is not None:
            try:
                lead = max(0, (stay_date - today).days)
                room_code = ACADEMIC_ROOM_CODE.get(tier_id, "A")
                req = AcademicBookingRequest(
                    hotel="City Hotel",
                    arrival_date=stay_date,
                    lead_time=min(lead, 730),
                    stay_nights=1,
                    adults=2,
                    children=0,
                    babies=0,
                    reserved_room_type=room_code,
                    meal="BB",
                    market_segment="Online TA",
                    distribution_channel="TA/TO",
                    customer_type="Transient",
                )
                decision = svc.decide(req, explain=False)
                prob = decision.get("cancellation_probability")
                if isinstance(prob, (int, float)) and math.isfinite(prob):
                    return round(float(max(0.02, min(0.85, prob))), 4), "ml_academic_v1"
            except Exception as err:
                logger.warning("academic_v1 cancel proxy fallback: %s", err)
        return 0.18, "prior_fallback"

    @staticmethod
    def _candidate_prices(
        *,
        base_price: float,
        floor_vnd: int,
        ceiling_vnd: int,
    ) -> list[int]:
        raw = [base_price * m for m in PRICE_GRID_MULTIPLIERS] + [base_price]
        rounded = sorted({
            max(floor_vnd, min(ceiling_vnd, int(round(p / 1000.0) * 1000)))
            for p in raw
        })
        return rounded or [max(floor_vnd, min(ceiling_vnd, int(round(base_price / 1000.0) * 1000)))]

    @staticmethod
    def _simulated_unconstrained_demand(
        *,
        sellable_rooms: int,
        type_id: int,
        stay_date: date,
        base_price: float,
        candidate_price: float,
        scenario_id: str,
        price_elasticity: float,
    ) -> float:
        scenario_mult = SCENARIO_DEMAND_MULT.get(scenario_id, 1.0)
        tier_share = DEFAULT_TIER_DEMAND_SHARE.get(type_id, 0.85)
        is_weekend = stay_date.weekday() in (4, 5)
        weekend_mult = 1.18 if is_weekend else 0.94
        baseline_arrivals = max(1.0, sellable_rooms * 0.95 * tier_share * scenario_mult * weekend_mult)
        ratio = max(0.4, candidate_price / max(1.0, base_price))
        elastic_demand = baseline_arrivals * (ratio ** (-price_elasticity))
        return max(0.0, min(sellable_rooms * 2.5, elastic_demand))

    def _solve_cp_sat(
        self,
        *,
        tiers: list[PortfolioTierInput],
        nights: list[date],
        available_matrix: list[list[int]],
        price_grids: list[list[int]],
        demand_grid: list[list[list[int]]],  # scaled * UNIT_SCALE
        realization_grid: list[list[float]],
        unit_margin_grid: list[list[int]],  # VND per room at tier t, level k
        allow_upgrades: bool,
        upgrade_cost_vnd: float = UPGRADE_HOSPITALITY_COST_VND,
        solve_time_limit: float = 1.0,
    ) -> tuple[str, int, list[list[int]], list[list[int]], list[list[int]], list[list[int]]]:
        """Solve CP-SAT portfolio problem and return integer assignments & exact objective (VND)."""
        T = len(tiers)
        H = len(nights)
        model = cp_model.CpModel()

        y: dict[tuple[int, int, int], cp_model.IntVar] = {}
        stay_self: dict[tuple[int, int, int], cp_model.IntVar] = {}
        upgrade_out: dict[tuple[int, int, int], cp_model.IntVar] = {}

        for t in range(T):
            for d in range(H):
                max_avail_t = available_matrix[t][d] * UNIT_SCALE
                max_avail_next = available_matrix[t + 1][d] * UNIT_SCALE if (allow_upgrades and t + 1 < T) else 0
                y_vars_td = []
                for k in range(len(price_grids[t])):
                    dem_k = demand_grid[t][d][k]
                    yk = model.NewBoolVar(f"y_{t}_{d}_{k}")
                    y[(t, d, k)] = yk
                    y_vars_td.append(yk)

                    stay_ub = min(dem_k, max_avail_t)
                    sk = model.NewIntVar(0, stay_ub, f"stay_{t}_{d}_{k}")
                    stay_self[(t, d, k)] = sk

                    if allow_upgrades and t + 1 < T and max_avail_next > 0:
                        up_ub = min(dem_k, max(0, max_avail_next))
                        uk = model.NewIntVar(0, up_ub, f"up_{t}_{d}_{k}")
                    else:
                        uk = model.NewConstant(0)
                    upgrade_out[(t, d, k)] = uk

                    # Exact linear coupling to chosen price level yk
                    model.Add(sk + uk <= dem_k * yk)

                model.Add(sum(y_vars_td) == 1)

        # Physical capacity conservation per tier and night (including incoming upgrades from tier t-1)
        for t in range(T):
            for d in range(H):
                inflow_up = (
                    sum(upgrade_out[(t - 1, d, k)] for k in range(len(price_grids[t - 1])))
                    if (allow_upgrades and t > 0)
                    else 0
                )
                own_stay = sum(stay_self[(t, d, k)] for k in range(len(price_grids[t])))
                model.Add(own_stay + inflow_up <= available_matrix[t][d] * UNIT_SCALE)

                # Guardrail: complimentary upgrades cannot exceed 50% of upper tier capacity on night d
                if allow_upgrades and t + 1 < T:
                    max_up_cap = math.ceil(available_matrix[t + 1][d] * 0.5) * UNIT_SCALE
                    outflow_up = sum(upgrade_out[(t, d, k)] for k in range(len(price_grids[t])))
                    model.Add(outflow_up <= max_up_cap)

        # (D) Strictly monotonic 6-tier price ladder on every night: P[t,d] <= P[t+1,d]
        for d in range(H):
            for t in range(T - 1):
                p_curr = sum(price_grids[t][k] * y[(t, d, k)] for k in range(len(price_grids[t])))
                p_next = sum(price_grids[t + 1][k] * y[(t + 1, d, k)] for k in range(len(price_grids[t + 1])))
                model.Add(p_curr <= p_next)

        # Objective: Maximize expected risk-adjusted contribution (scaled in VND * UNIT_SCALE // UNIT_SCALE = VND)
        # Keep integer coefficients cleanly in hundreds of VND per 0.1 room so fits comfortably in 64-bit ints
        obj_terms = []
        for t in range(T):
            base_p = tiers[t].base_price
            for d in range(H):
                rf = realization_grid[t][d]
                for k, p_val in enumerate(price_grids[t]):
                    m_unit = unit_margin_grid[t][k]
                    coeff_stay = int(round((m_unit * rf) / UNIT_SCALE))
                    obj_terms.append(coeff_stay * stay_self[(t, d, k)])
                    if allow_upgrades and t + 1 < T and available_matrix[t + 1][d] > 0:
                        coeff_up = int(round(((m_unit * rf) - upgrade_cost_vnd) / UNIT_SCALE))
                        obj_terms.append(coeff_up * upgrade_out[(t, d, k)])
                    # Tiny tie-breaker favoring neutral price when contribution identical
                    if abs(p_val - base_p) < 500:
                        obj_terms.append(1 * y[(t, d, k)])

        model.Maximize(sum(obj_terms))

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = solve_time_limit
        solver.parameters.num_search_workers = 4
        status_code = solver.Solve(model)
        status_name = solver.StatusName(status_code)

        chosen_k = [[0] * H for _ in range(T)]
        sold_own_scaled = [[0] * H for _ in range(T)]
        up_out_scaled = [[0] * H for _ in range(T)]
        up_in_scaled = [[0] * H for _ in range(T)]
        exact_contrib_vnd = 0

        if status_name in ("OPTIMAL", "FEASIBLE"):
            for t in range(T):
                for d in range(H):
                    rf = realization_grid[t][d]
                    for k in range(len(price_grids[t])):
                        if solver.Value(y[(t, d, k)]) == 1:
                            chosen_k[t][d] = k
                        sv = solver.Value(stay_self[(t, d, k)])
                        uv = solver.Value(upgrade_out[(t, d, k)])
                        if sv > 0:
                            sold_own_scaled[t][d] += sv
                            exact_contrib_vnd += int(round(unit_margin_grid[t][k] * rf * (sv / UNIT_SCALE)))
                        if uv > 0:
                            up_out_scaled[t][d] += uv
                            up_in_scaled[t + 1][d] += uv
                            exact_contrib_vnd += int(round((unit_margin_grid[t][k] * rf - upgrade_cost_vnd) * (uv / UNIT_SCALE)))

        return status_name, exact_contrib_vnd, chosen_k, sold_own_scaled, up_out_scaled, up_in_scaled

    def optimize(
        self,
        *,
        tiers: list[PortfolioTierInput],
        start_date: str,
        horizon_days: int = 5,
        scenario_id: str = "standard",
        price_elasticity: float = 1.15,
        allow_cross_tier_upgrades: bool = True,
        serving_cost_per_night: float = 350_000.0,
        channel_commission_pct: float = 0.0,
        tax_rate: float = 0.08,
        service_charge_rate: float = 0.05,
        min_contribution_margin: float = 50_000.0,
    ) -> dict[str, Any]:
        started = datetime.now()
        ordered_tiers = sorted(tiers, key=lambda item: (item.base_price, item.type_id))
        if not ordered_tiers:
            raise ValueError("At least one room tier is required for portfolio optimization.")

        start_d = datetime.strptime(start_date, "%Y-%m-%d").date()
        nights = [start_d + timedelta(days=offset) for offset in range(horizon_days)]
        today = (datetime.now(timezone.utc) + timedelta(hours=7)).date()

        tax_mult = 1.0 + tax_rate + service_charge_rate
        net_factor = (1.0 / tax_mult) - channel_commission_pct
        if net_factor <= 0.05:
            raise ValueError("Combined tax, service charge, and commission leaves non-positive net share.")

        req_contrib_floor = math.ceil(
            max(MIN_LEGAL_FLOOR_VND, (serving_cost_per_night + min_contribution_margin) / net_factor) / 1000.0
        ) * 1000

        T = len(ordered_tiers)
        H = len(nights)
        available_matrix: list[list[int]] = []
        booked_matrix: list[list[int]] = []
        price_grids: list[list[int]] = []
        unit_margin_grid: list[list[int]] = []
        warnings: list[str] = []

        # Track monotonicity of tier ceilings so tier t price <= tier t+1 remains feasible
        tier_ceilings: list[int] = []
        for tier in ordered_tiers:
            ceil_raw = tier.declared_max_price if tier.declared_max_price > 0 else tier.base_price * 1.4
            ceil_vnd = int(math.floor(ceil_raw / 1000.0) * 1000)
            tier_ceilings.append(max(req_contrib_floor, ceil_vnd))
        # Ensure non-decreasing floor/ceiling envelope across sorted tiers if custom inputs inverted
        for idx in range(T - 2, -1, -1):
            if tier_ceilings[idx] > tier_ceilings[idx + 1]:
                tier_ceilings[idx] = tier_ceilings[idx + 1]

        for idx, tier in enumerate(ordered_tiers):
            avail = list(tier.nightly_available[:H])
            while len(avail) < H:
                avail.append(max(0, tier.sellable_rooms))
            booked = list(tier.nightly_booked[:H])
            while len(booked) < H:
                booked.append(max(0, tier.sellable_rooms - avail[len(booked)]))
            available_matrix.append([max(0, int(v)) for v in avail])
            booked_matrix.append([max(0, int(v)) for v in booked])

            effective_floor = min(req_contrib_floor, tier_ceilings[idx])
            if req_contrib_floor > tier_ceilings[idx]:
                warnings.append(
                    f"{tier.type_name}: sàn biên đóng góp ({req_contrib_floor:,.0f} VND) vượt trần kê khai ({tier_ceilings[idx]:,.0f} VND); kẹp an toàn về trần."
                )
            p_grid = self._candidate_prices(
                base_price=tier.base_price,
                floor_vnd=effective_floor,
                ceiling_vnd=tier_ceilings[idx],
            )
            price_grids.append(p_grid)
            unit_margin_grid.append([
                int(round((p * net_factor) - serving_cost_per_night))
                for p in p_grid
            ])

        demand_grid: list[list[list[int]]] = [[[0] * len(price_grids[t]) for _ in range(H)] for t in range(T)]
        realization_grid: list[list[float]] = [[0.82] * H for _ in range(T)]
        cancel_prob_grid: list[list[float]] = [[0.18] * H for _ in range(T)]
        cancel_sources: set[str] = set()

        for t, tier in enumerate(ordered_tiers):
            for d, stay_d in enumerate(nights):
                c_prob, c_src = self._academic_cancel_prob(tier_id=tier.type_id, stay_date=stay_d, today=today)
                cancel_prob_grid[t][d] = c_prob
                realization_grid[t][d] = max(0.35, 1.0 - 0.50 * c_prob)
                cancel_sources.add(c_src)
                for k, p_val in enumerate(price_grids[t]):
                    dem = self._simulated_unconstrained_demand(
                        sellable_rooms=max(1, tier.sellable_rooms),
                        type_id=tier.type_id,
                        stay_date=stay_d,
                        base_price=tier.base_price,
                        candidate_price=float(p_val),
                        scenario_id=scenario_id,
                        price_elasticity=price_elasticity,
                    )
                    demand_grid[t][d][k] = int(round(dem * UNIT_SCALE))

        status_name, opt_contrib, chosen_k, sold_own_s, up_out_s, up_in_s = self._solve_cp_sat(
            tiers=ordered_tiers,
            nights=nights,
            available_matrix=available_matrix,
            price_grids=price_grids,
            demand_grid=demand_grid,
            realization_grid=realization_grid,
            unit_margin_grid=unit_margin_grid,
            allow_upgrades=allow_cross_tier_upgrades,
            solve_time_limit=min(1.0, self.time_limit_seconds * 0.5),
        )

        # Static Base Price baseline (exact same demand & realization, fixed base_price clamped, zero upgrades)
        static_contrib = 0
        for t, tier in enumerate(ordered_tiers):
            base_clamped = max(price_grids[t][0], min(price_grids[t][-1], int(round(tier.base_price / 1000.0) * 1000)))
            base_margin = int(round((base_clamped * net_factor) - serving_cost_per_night))
            for d, stay_d in enumerate(nights):
                dem = self._simulated_unconstrained_demand(
                    sellable_rooms=max(1, tier.sellable_rooms),
                    type_id=tier.type_id,
                    stay_date=stay_d,
                    base_price=tier.base_price,
                    candidate_price=float(base_clamped),
                    scenario_id=scenario_id,
                    price_elasticity=price_elasticity,
                )
                cap = available_matrix[t][d]
                accepted = min(float(cap), dem)
                static_contrib += int(round(base_margin * realization_grid[t][d] * accepted))

        # Exact Shadow Prices per tier via +1 physical room sensitivity re-solve on bottleneck night
        shadow_prices: list[dict[str, Any]] = []
        for t, tier in enumerate(ordered_tiers):
            # Find the night where adding 1 physical room to tier t yields peak marginal gain
            # Test at most 2 tightest nights for tier t so total runtime stays < 150ms
            night_ranks = sorted(
                range(H),
                key=lambda d: (
                    available_matrix[t][d] * UNIT_SCALE - (sold_own_s[t][d] + up_in_s[t][d]),
                    -demand_grid[t][d][chosen_k[t][d]],
                ),
            )[:2]
            best_delta_vnd = 0
            best_night_str = nights[night_ranks[0]].isoformat() if night_ranks else start_date
            if status_name in ("OPTIMAL", "FEASIBLE"):
                for d_cand in night_ranks:
                    perturbed = [row[:] for row in available_matrix]
                    perturbed[t][d_cand] += 1
                    p_status, p_contrib, *_ = self._solve_cp_sat(
                        tiers=ordered_tiers,
                        nights=nights,
                        available_matrix=perturbed,
                        price_grids=price_grids,
                        demand_grid=demand_grid,
                        realization_grid=realization_grid,
                        unit_margin_grid=unit_margin_grid,
                        allow_upgrades=allow_cross_tier_upgrades,
                        solve_time_limit=0.12,
                    )
                    if p_status in ("OPTIMAL", "FEASIBLE"):
                        delta = max(0, p_contrib - opt_contrib)
                        if delta >= best_delta_vnd:
                            best_delta_vnd = delta
                            best_night_str = nights[d_cand].isoformat()

            total_avail_t = sum(available_matrix[t])
            total_used_t = sum((sold_own_s[t][d] + up_in_s[t][d]) / UNIT_SCALE for d in range(H))
            total_up_out_t = sum(up_out_s[t][d] / UNIT_SCALE for d in range(H))
            shadow_prices.append({
                "type_id": tier.type_id,
                "type_name": tier.type_name,
                "bottleneck_night": best_night_str,
                "marginal_value_vnd_per_room": int(best_delta_vnd),
                "total_available_room_nights": total_avail_t,
                "expected_occupied_room_nights": round(total_used_t, 1),
                "utilization_pct": round((total_used_t / total_avail_t * 100.0) if total_avail_t > 0 else 0.0, 1),
                "upgraded_out_room_nights": round(total_up_out_t, 1),
            })

        decisions: list[dict[str, Any]] = []
        total_upgrades = 0.0
        for d, stay_d in enumerate(nights):
            for t, tier in enumerate(ordered_tiers):
                k_sel = chosen_k[t][d]
                rec_price = price_grids[t][k_sel]
                dem_rooms = round(demand_grid[t][d][k_sel] / UNIT_SCALE, 1)
                own_rooms = round(sold_own_s[t][d] / UNIT_SCALE, 1)
                u_out = round(up_out_s[t][d] / UNIT_SCALE, 1)
                u_in = round(up_in_s[t][d] / UNIT_SCALE, 1)
                total_upgrades += u_out
                decisions.append({
                    "stay_date": stay_d.isoformat(),
                    "is_weekend": stay_d.weekday() in (4, 5),
                    "type_id": tier.type_id,
                    "type_name": tier.type_name,
                    "base_price_vnd": int(round(tier.base_price)),
                    "declared_max_price_vnd": tier_ceilings[t],
                    "recommended_price_vnd": int(rec_price),
                    "price_change_pct": round(((rec_price / tier.base_price) - 1.0) * 100.0, 1),
                    "available_rooms": available_matrix[t][d],
                    "already_booked_rooms": booked_matrix[t][d],
                    "expected_demand_rooms": dem_rooms,
                    "accepted_own_tier_rooms": own_rooms,
                    "upgraded_out_rooms": u_out,
                    "upgraded_in_rooms": u_in,
                    "ml_cancel_prob": cancel_prob_grid[t][d],
                    "expected_realization_factor": round(realization_grid[t][d], 4),
                    "expected_unit_margin_vnd": int(round(unit_margin_grid[t][k_sel] * realization_grid[t][d])),
                })

        elapsed_ms = round((datetime.now() - started).total_seconds() * 1000.0, 2)
        lift_vnd = int(opt_contrib - static_contrib)
        lift_pct = round((lift_vnd / static_contrib * 100.0) if static_contrib > 0 else 0.0, 2)
        avg_cancel = round(
            sum(cancel_prob_grid[t][d] for t in range(T) for d in range(H)) / max(1, T * H),
            4,
        )

        return {
            "status": status_name,
            "solver_time_ms": elapsed_ms,
            "start_date": start_date,
            "horizon_days": horizon_days,
            "scenario_id": scenario_id,
            "price_elasticity": price_elasticity,
            "allow_cross_tier_upgrades": allow_cross_tier_upgrades,
            "contribution_floor_vnd": req_contrib_floor,
            "static_baseline_contribution_vnd": int(static_contrib),
            "optimized_contribution_vnd": int(opt_contrib),
            "contribution_lift_vnd": lift_vnd,
            "contribution_lift_pct": lift_pct,
            "total_upgraded_room_nights": round(total_upgrades, 1),
            "avg_ml_cancel_prob": avg_cancel,
            "ml_cancel_source": "ml_academic_v1" if "ml_academic_v1" in cancel_sources else "prior_fallback",
            "shadow_prices": shadow_prices,
            "decisions": decisions,
            "warnings": warnings,
            "provenance_breakdown": {
                "A_ml_cancel_proxy": "academic_v1 Logistic Regression (Portugal 2015–2017; chỉ trọng số rủi ro hủy tham khảo)",
                "B_inventory": "PostgreSQL room_types/rooms/bookings thực tế từng đêm",
                "C_demand_elasticity": f"Giả định độ co giãn giá beta={price_elasticity:.2f} & kịch bản '{scenario_id}' (Simulated)",
                "D_optimizer": "Google OR-Tools CP-SAT: đồng tối ưu 6 hạng × đa đêm, thang giá đơn điệu & nâng 1 hạng miễn phí",
            },
        }
