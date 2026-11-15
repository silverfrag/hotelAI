"""FastAPI router for HotelAI Intelligent Revenue Simulator (P8)."""
from __future__ import annotations

from dataclasses import asdict
from fastapi import APIRouter, HTTPException, status

from app.schemas.revenue_schema import (
    AllocationRequestItem,
    AssignmentItem,
    BanditSimulateRequest,
    BanditSimulateResponse,
    ConversionTaxonomyAuditSchema,
    ExistingOccupancyItem,
    MarketScenarioSchema,
    OptimizeAllocationRequest,
    OptimizeAllocationResponse,
    PhysicalRoomItem,
    PortfolioOptimizeRequest,
    PortfolioOptimizeResponse,
    PriceFactorSchema,
    RevenueQuoteRequest,
    RevenueQuoteResponse,
    ScenarioExecutionResultResponse,
    ScenarioListResponse,
    ScenarioMetaItemSchema,
    ScenarioRunRequest,
    ScenarioScorecardSchema,
    SimulatedCouponSchema,
    SimulationEventStepSchema,
)
from app.services.bandit_pricing_lab import BanditPricingLabService
from app.services.constraint_room_allocator import (
    BookingAllocationRequest,
    ConstraintRoomAllocationSolver,
    ExistingRoomOccupancy,
    PhysicalRoomCandidate,
)
from app.services.portfolio_yield_optimizer import (
    PortfolioTierInput,
    PortfolioYieldOptimizer,
)
from app.services.revenue_decision_engine import (
    DEFAULT_COUPONS,
    DEFAULT_SCENARIOS,
    MarketScenarioConfig,
    RevenueDecisionEngine,
    SimulatedCoupon,
)
from app.services.scenario_simulator import ScenarioSandboxSimulator
from app.schemas.market_pricing_schema import MarketPricingRequest
from app.services.market_pricing_engine import MarketPricingEngine

router = APIRouter(prefix="/api/v1/revenue", tags=["Revenue Simulator & Allocation"])
_engine = RevenueDecisionEngine()
_allocator = ConstraintRoomAllocationSolver(time_limit_seconds=2.0)
_portfolio_optimizer = PortfolioYieldOptimizer(time_limit_seconds=1.5)
_bandit_lab = BanditPricingLabService()
_sandbox = ScenarioSandboxSimulator()
_market_pricing = MarketPricingEngine()


@router.post("/market-decision", summary="Da Nang evidence-backed contextual pricing (advisory only)")
def market_decision(payload: MarketPricingRequest):
    return _market_pricing.decide(payload)


@router.get("/scenarios", summary="Get all simulated market scenarios and available coupons")
def get_scenarios_and_coupons():
    return {
        "status": "success",
        "scenarios": [
            MarketScenarioSchema(
                scenario_id=s.scenario_id,
                name_vi=s.name_vi,
                demand_level=s.demand_level,
                weather=s.weather,
                competitor_rate_position=s.competitor_rate_position,
                serving_cost_per_night=s.serving_cost_per_night,
                channel_commission_pct=s.channel_commission_pct,
                tax_rate=s.tax_rate,
                service_charge_rate=s.service_charge_rate,
                min_contribution_margin=s.min_contribution_margin,
                provenance=s.provenance,
            )
            for s in DEFAULT_SCENARIOS.values()
        ],
        "coupons": [
            SimulatedCouponSchema(
                code=c.code,
                discount_pct=c.discount_pct,
                max_discount_vnd=c.max_discount_vnd,
                min_room_type_id=c.min_room_type_id,
                description_vi=c.description_vi,
                usage_limit=c.usage_limit,
                used_count=c.used_count,
                active=c.active,
                expiry_date=c.expiry_date,
                provenance=c.provenance,
            )
            for c in DEFAULT_COUPONS.values()
        ],
    }


@router.post("/decision", response_model=RevenueQuoteResponse, summary="Evaluate contextual dynamic rate with 4-source attribution")
def evaluate_revenue_decision(payload: RevenueQuoteRequest):
    custom = None
    if payload.custom_scenario:
        custom = MarketScenarioConfig(
            scenario_id=payload.custom_scenario.scenario_id,
            name_vi=payload.custom_scenario.name_vi,
            demand_level=payload.custom_scenario.demand_level,
            weather=payload.custom_scenario.weather,
            competitor_rate_position=payload.custom_scenario.competitor_rate_position,
            serving_cost_per_night=payload.custom_scenario.serving_cost_per_night,
            channel_commission_pct=payload.custom_scenario.channel_commission_pct,
            tax_rate=payload.custom_scenario.tax_rate,
            service_charge_rate=payload.custom_scenario.service_charge_rate,
            min_contribution_margin=payload.custom_scenario.min_contribution_margin,
            provenance="SIMULATED_ASSUMPTION",
        )

    coupon_rule = None
    if payload.coupon_rule:
        coupon_rule = SimulatedCoupon(
            code=payload.coupon_rule.code,
            discount_pct=payload.coupon_rule.discount_pct,
            max_discount_vnd=payload.coupon_rule.max_discount_vnd,
            min_room_type_id=payload.coupon_rule.min_room_type_id,
            description_vi=payload.coupon_rule.description_vi,
            usage_limit=payload.coupon_rule.usage_limit,
            used_count=payload.coupon_rule.used_count,
            active=payload.coupon_rule.active,
            expiry_date=payload.coupon_rule.expiry_date,
            provenance=payload.coupon_rule.provenance,
        )

    res = _engine.evaluate_quote(
        room_type_id=payload.room_type_id,
        room_type_name=payload.room_type_name,
        base_price=payload.base_price,
        declared_max_price=payload.declared_max_price,
        check_in_date=payload.check_in_date,
        check_out_date=payload.check_out_date,
        guest_count=payload.guest_count,
        rooms_available=payload.rooms_available,
        rooms_total=payload.rooms_total,
        ml_multiplier=payload.ml_multiplier,
        scenario_id=payload.scenario_id,
        custom_scenario=custom,
        coupon_code=payload.coupon_code,
        coupon_rule=coupon_rule,
        coupon_lookup_performed=payload.coupon_lookup_performed,
    )

    return RevenueQuoteResponse(
        room_type_id=res.room_type_id,
        room_type_name=res.room_type_name,
        base_price=res.base_price,
        ml_reference_price=res.ml_reference_price,
        scenario_recommended_rate=res.scenario_recommended_rate,
        coupon_applied=res.coupon_applied,
        coupon_discount_vnd=res.coupon_discount_vnd,
        guest_payable_nightly_rate=res.guest_payable_nightly_rate,
        total_nights=res.total_nights,
        guest_total_payable=res.guest_total_payable,
        serving_cost_per_night=res.serving_cost_per_night,
        taxes_and_service_vnd=res.taxes_and_service_vnd,
        net_revenue_per_night=res.net_revenue_per_night,
        estimated_contribution_margin=res.estimated_contribution_margin,
        is_floor_price_clamped=res.is_floor_price_clamped,
        factors=[
            PriceFactorSchema(
                factor_name=f.factor_name,
                source_category=f.source_category,
                impact_pct=f.impact_pct,
                impact_vnd=f.impact_vnd,
                description_vi=f.description_vi,
            )
            for f in res.factors
        ],
        scenario_id=res.scenario_id,
        scenario_name_vi=res.scenario_name_vi,
        caveats=res.caveats,
    )


@router.post("/optimize-allocation", response_model=OptimizeAllocationResponse, summary="Solve constraint-based room allocation via Google OR-Tools CP-SAT")
def optimize_room_allocation(payload: OptimizeAllocationRequest):
    reqs = [
        BookingAllocationRequest(
            request_id=r.request_id,
            room_type_id=r.room_type_id,
            check_in_date=r.check_in_date,
            check_out_date=r.check_out_date,
            guest_count=r.guest_count,
            revenue_value=r.revenue_value,
            vip_priority=r.vip_priority,
            requested_base_price=r.requested_base_price,
            current_room_id=r.current_room_id,
            requires_ready_room=r.requires_ready_room,
        )
        for r in payload.requests
    ]
    rooms = [
        PhysicalRoomCandidate(
            room_id=rm.room_id,
            room_number=rm.room_number,
            type_id=rm.type_id,
            capacity=rm.capacity,
            current_status=rm.current_status,
            housekeeping_status=rm.housekeeping_status,
            base_price=rm.base_price,
        )
        for rm in payload.available_rooms
    ]
    existing = [
        ExistingRoomOccupancy(
            room_id=ex.room_id,
            check_in_date=ex.check_in_date,
            check_out_date=ex.check_out_date,
            booking_id=ex.booking_id,
        )
        for ex in payload.existing_occupancies
    ]

    result = _allocator.solve(
        requests=reqs,
        available_rooms=rooms,
        existing_occupancies=existing,
        allow_upgrades=payload.allow_upgrades,
    )

    return OptimizeAllocationResponse(
        status=result.status,
        solver_time_ms=result.solver_time_ms,
        total_assigned_revenue=result.total_assigned_revenue,
        assignments=[
            AssignmentItem(
                request_id=a.request_id,
                room_id=a.room_id,
                room_number=a.room_number,
                assigned_type_id=a.assigned_type_id,
                is_upgrade=a.is_upgrade,
                status=a.status,
            )
            for a in result.assignments
        ],
        unassigned_request_ids=result.unassigned_request_ids,
        audit_notes=result.audit_notes,
    )


@router.get("/sandbox/scenarios", response_model=ScenarioListResponse, summary="List operational stress-test scenarios")
def list_sandbox_scenarios():
    scenarios = _sandbox.list_scenarios()
    return ScenarioListResponse(
        scenarios=[
            ScenarioMetaItemSchema(
                id=s["id"],
                title=s["title"],
                tag=s["tag"],
                badge_color=s["badge_color"],
                summary=s["summary"],
            )
            for s in scenarios
        ]
    )


@router.post("/sandbox/run", response_model=ScenarioExecutionResultResponse, summary="Execute interactive scenario stress-test")
def run_sandbox_scenario(payload: ScenarioRunRequest):
    result = _sandbox.run_scenario(scenario_id=payload.scenario_id, custom_params=payload.custom_params)
    return ScenarioExecutionResultResponse(
        scenario_id=result.scenario_id,
        title=result.title,
        description=result.description,
        executed_at=result.executed_at,
        duration_ms=result.duration_ms,
        timeline=[
            SimulationEventStepSchema(
                step_id=step.step_id,
                timestamp_offset=step.timestamp_offset,
                phase=step.phase,
                actor=step.actor,
                title=step.title,
                detail_vi=step.detail_vi,
                metrics_snapshot=step.metrics_snapshot,
                provenance_tag=step.provenance_tag,
            )
            for step in result.timeline
        ],
        scorecard=ScenarioScorecardSchema(
            scenario_id=result.scorecard.scenario_id,
            scenario_title=result.scorecard.scenario_title,
            overall_score=result.scorecard.overall_score,
            zero_oversell_guarantee=result.scorecard.zero_oversell_guarantee,
            floor_price_safety_rate=result.scorecard.floor_price_safety_rate,
            revpar_impact=result.scorecard.revpar_impact,
            solver_efficiency=result.scorecard.solver_efficiency,
            policy_compliance_rate=result.scorecard.policy_compliance_rate,
            academic_summary=result.scorecard.academic_summary,
        ),
        parameters=result.parameters,
    )


@router.post(
    "/portfolio-optimize",
    response_model=PortfolioOptimizeResponse,
    summary="Joint Multi-Night 6-Tier Portfolio Yield & Upgrade Optimizer (OR-Tools CP-SAT)",
)
def optimize_portfolio_yield(payload: PortfolioOptimizeRequest):
    try:
        result = _portfolio_optimizer.optimize(
            tiers=[
                PortfolioTierInput(
                    type_id=t.type_id,
                    type_name=t.type_name,
                    base_price=t.base_price,
                    declared_max_price=t.declared_max_price,
                    sellable_rooms=t.sellable_rooms,
                    nightly_available=t.nightly_available,
                    nightly_booked=t.nightly_booked,
                )
                for t in payload.tiers
            ],
            start_date=payload.start_date,
            horizon_days=payload.horizon_days,
            scenario_id=payload.scenario_id,
            price_elasticity=payload.price_elasticity,
            allow_cross_tier_upgrades=payload.allow_cross_tier_upgrades,
            serving_cost_per_night=payload.serving_cost_per_night,
            channel_commission_pct=payload.channel_commission_pct,
            tax_rate=payload.tax_rate,
            service_charge_rate=payload.service_charge_rate,
            min_contribution_margin=payload.min_contribution_margin,
        )
        return PortfolioOptimizeResponse(**result)
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err),
        ) from err


@router.get(
    "/taxonomy-audit",
    response_model=ConversionTaxonomyAuditSchema,
    summary="Inspect conversion challenger taxonomy drift against White Sand catalog",
)
def inspect_conversion_taxonomy():
    return ConversionTaxonomyAuditSchema(**_bandit_lab.inspect_conversion_taxonomy())


@router.post(
    "/bandit-simulate",
    response_model=BanditSimulateResponse,
    summary="Run Guardrailed Thompson Sampling Bandit vs Baselines Benchmark (Simulated Lab)",
)
def simulate_bandit_benchmark(payload: BanditSimulateRequest):
    try:
        result = _bandit_lab.simulate_bandit_benchmark(
            room_type_id=payload.room_type_id,
            room_type_name=payload.room_type_name,
            base_price=payload.base_price,
            declared_max_price=payload.declared_max_price,
            serving_cost_per_night=payload.serving_cost_per_night,
            channel_commission_pct=payload.channel_commission_pct,
            tax_rate=payload.tax_rate,
            service_charge_rate=payload.service_charge_rate,
            min_contribution_margin=payload.min_contribution_margin,
            scenario_id=payload.scenario_id,
            true_price_elasticity=payload.true_price_elasticity,
            episodes=payload.episodes,
            seed=payload.seed,
            live_room_type_names=payload.live_room_type_names or None,
        )
        return BanditSimulateResponse(**result)
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err),
        ) from err




