"""Pydantic schemas for HotelAI Revenue Simulator and Decision Engine (P8)."""
from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field


class SimulatedCouponSchema(BaseModel):
    code: str
    discount_pct: float
    max_discount_vnd: float
    min_room_type_id: int = 1
    description_vi: str | None = None
    usage_limit: int
    used_count: int
    active: bool
    expiry_date: str | None = "2027-12-31"
    provenance: str = "BUSINESS_RULE"


class MarketScenarioSchema(BaseModel):
    scenario_id: str
    name_vi: str
    demand_level: Literal["low", "normal", "high", "surge"]
    weather: Literal["sunny_favorable", "stormy_unfavorable"]
    competitor_rate_position: Literal["lower_undercut", "par_neutral", "higher_premium"]
    serving_cost_per_night: float
    channel_commission_pct: float
    tax_rate: float
    service_charge_rate: float
    min_contribution_margin: float
    provenance: str = "SIMULATED_ASSUMPTION"


class RevenueQuoteRequest(BaseModel):
    room_type_id: int = Field(..., ge=1)
    room_type_name: str = Field(default="Superior Room")
    base_price: float = Field(..., gt=0)
    declared_max_price: float | None = Field(default=None, gt=0)
    check_in_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    check_out_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    guest_count: int = Field(default=1, ge=1)
    rooms_available: int = Field(default=6, ge=0)
    rooms_total: int = Field(default=12, ge=1)
    ml_multiplier: float = Field(default=1.0, ge=0.5, le=3.0)
    scenario_id: str = Field(default="standard")
    coupon_code: str | None = None
    coupon_rule: SimulatedCouponSchema | None = None
    coupon_lookup_performed: bool = False
    custom_scenario: MarketScenarioSchema | None = None


class PriceFactorSchema(BaseModel):
    factor_name: str
    source_category: str
    impact_pct: float
    impact_vnd: float
    description_vi: str


class RevenueQuoteResponse(BaseModel):
    room_type_id: int
    room_type_name: str
    base_price: float
    ml_reference_price: float
    scenario_recommended_rate: float
    coupon_applied: str | None
    coupon_discount_vnd: float
    guest_payable_nightly_rate: float
    total_nights: int
    guest_total_payable: float
    serving_cost_per_night: float
    taxes_and_service_vnd: float
    net_revenue_per_night: float
    estimated_contribution_margin: float
    is_floor_price_clamped: bool
    factors: list[PriceFactorSchema]
    scenario_id: str
    scenario_name_vi: str
    caveats: list[str]


class AllocationRequestItem(BaseModel):
    request_id: str
    room_type_id: int
    check_in_date: str
    check_out_date: str
    guest_count: int
    revenue_value: float = 0.0
    vip_priority: int = 1
    requested_base_price: float = 0.0
    current_room_id: int | None = None
    requires_ready_room: bool = False


class PhysicalRoomItem(BaseModel):
    room_id: int
    room_number: str
    type_id: int
    capacity: int
    current_status: str = "Available"
    housekeeping_status: str = "Ready"
    base_price: float = 0.0


class ExistingOccupancyItem(BaseModel):
    room_id: int
    check_in_date: str
    check_out_date: str
    booking_id: str


class OptimizeAllocationRequest(BaseModel):
    requests: list[AllocationRequestItem]
    available_rooms: list[PhysicalRoomItem]
    existing_occupancies: list[ExistingOccupancyItem] = Field(default_factory=list)
    allow_upgrades: bool = True


class AssignmentItem(BaseModel):
    request_id: str
    room_id: int
    room_number: str
    assigned_type_id: int
    is_upgrade: bool
    status: str


class OptimizeAllocationResponse(BaseModel):
    status: str
    solver_time_ms: float
    total_assigned_revenue: float
    assignments: list[AssignmentItem]
    unassigned_request_ids: list[str]
    audit_notes: list[str]


class SimulationEventStepSchema(BaseModel):
    step_id: int
    timestamp_offset: str
    phase: str
    actor: str
    title: str
    detail_vi: str
    metrics_snapshot: dict[str, Any] = Field(default_factory=dict)
    provenance_tag: str


class ScenarioScorecardSchema(BaseModel):
    scenario_id: str
    scenario_title: str
    overall_score: int
    zero_oversell_guarantee: bool
    floor_price_safety_rate: str
    revpar_impact: str
    solver_efficiency: str
    policy_compliance_rate: str
    academic_summary: str


class ScenarioExecutionResultResponse(BaseModel):
    scenario_id: str
    title: str
    description: str
    executed_at: str
    duration_ms: float
    timeline: list[SimulationEventStepSchema]
    scorecard: ScenarioScorecardSchema
    parameters: dict[str, Any] = Field(default_factory=dict)


class ScenarioMetaItemSchema(BaseModel):
    id: str
    title: str
    tag: str
    badge_color: str
    summary: str


class ScenarioListResponse(BaseModel):
    scenarios: list[ScenarioMetaItemSchema]


class ScenarioRunRequest(BaseModel):
    scenario_id: str
    custom_params: dict[str, Any] = Field(default_factory=dict)


class PortfolioTierItem(BaseModel):
    type_id: int = Field(..., ge=1)
    type_name: str
    base_price: float = Field(..., gt=0)
    declared_max_price: float = Field(..., gt=0)
    sellable_rooms: int = Field(..., ge=0)
    nightly_available: list[int]
    nightly_booked: list[int] = Field(default_factory=list)


class PortfolioOptimizeRequest(BaseModel):
    start_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    horizon_days: int = Field(default=5, ge=1, le=14)
    scenario_id: Literal["monsoon_low", "standard", "weekend_high", "holiday_surge"] = "standard"
    price_elasticity: float = Field(default=1.15, ge=0.2, le=3.5)
    allow_cross_tier_upgrades: bool = True
    serving_cost_per_night: float = Field(default=350_000.0, ge=0.0)
    channel_commission_pct: float = Field(default=0.0, ge=0.0, le=0.5)
    tax_rate: float = Field(default=0.08, ge=0.0, le=0.3)
    service_charge_rate: float = Field(default=0.05, ge=0.0, le=0.2)
    min_contribution_margin: float = Field(default=50_000.0, ge=0.0)
    tiers: list[PortfolioTierItem] = Field(..., min_length=1, max_length=12)


class PortfolioTierShadowPrice(BaseModel):
    type_id: int
    type_name: str
    bottleneck_night: str
    marginal_value_vnd_per_room: int
    total_available_room_nights: int
    expected_occupied_room_nights: float
    utilization_pct: float
    upgraded_out_room_nights: float


class PortfolioDecisionCell(BaseModel):
    stay_date: str
    is_weekend: bool
    type_id: int
    type_name: str
    base_price_vnd: int
    declared_max_price_vnd: int
    recommended_price_vnd: int
    price_change_pct: float
    available_rooms: int
    already_booked_rooms: int
    expected_demand_rooms: float
    accepted_own_tier_rooms: float
    upgraded_out_rooms: float
    upgraded_in_rooms: float
    ml_cancel_prob: float
    expected_realization_factor: float
    expected_unit_margin_vnd: int


class PortfolioOptimizeResponse(BaseModel):
    status: str
    solver_time_ms: float
    start_date: str
    horizon_days: int
    scenario_id: str
    price_elasticity: float
    allow_cross_tier_upgrades: bool
    contribution_floor_vnd: int
    static_baseline_contribution_vnd: int
    optimized_contribution_vnd: int
    contribution_lift_vnd: int
    contribution_lift_pct: float
    total_upgraded_room_nights: float
    avg_ml_cancel_prob: float
    ml_cancel_source: str
    shadow_prices: list[PortfolioTierShadowPrice]
    decisions: list[PortfolioDecisionCell]
    warnings: list[str]
    provenance_breakdown: dict[str, str]


class BanditSimulateRequest(BaseModel):
    room_type_id: int = Field(default=1, ge=1)
    room_type_name: str = Field(default="Superior Room", min_length=1, max_length=120)
    base_price: float = Field(default=1_200_000.0, gt=0)
    declared_max_price: float = Field(default=1_650_000.0, gt=0)
    serving_cost_per_night: float = Field(default=350_000.0, ge=0.0)
    channel_commission_pct: float = Field(default=0.0, ge=0.0, le=0.5)
    tax_rate: float = Field(default=0.08, ge=0.0, le=0.3)
    service_charge_rate: float = Field(default=0.05, ge=0.0, le=0.2)
    min_contribution_margin: float = Field(default=50_000.0, ge=0.0)
    scenario_id: Literal["monsoon_low", "standard", "weekend_high", "holiday_surge"] = "standard"
    true_price_elasticity: float = Field(default=1.25, ge=0.4, le=3.0)
    episodes: int = Field(default=300, ge=50, le=1000)
    seed: int = Field(default=42, ge=1, le=999999)
    live_room_type_names: list[str] = Field(default_factory=list)


class BanditPolicySummarySchema(BaseModel):
    policy_id: str
    label_en: str
    label_vi: str
    cumulative_expected_contrib_vnd: int
    cumulative_realized_contrib_vnd: int
    cumulative_regret_vnd: int
    average_conversion_pct: float
    floor_violations: int
    ceiling_violations: int
    safety_compliance_pct: float


class BanditRegretPointSchema(BaseModel):
    episode: int
    static_regret_vnd: int
    heuristic_regret_vnd: int
    eps_greedy_regret_vnd: int
    thompson_regret_vnd: int
    thompson_cumulative_contrib_vnd: int
    static_cumulative_contrib_vnd: int


class BanditArmPosteriorSchema(BaseModel):
    price_vnd: int
    multiplier: float
    pulls: int
    empirical_conversions: int
    posterior_alpha: float
    posterior_beta: float
    posterior_mean_conv: float
    unit_contribution_vnd: int
    expected_contribution_vnd: int
    is_oracle_best: bool
    is_most_selected: bool


class ConversionTaxonomyAuditSchema(BaseModel):
    artifact_found: bool
    model_version: str
    training_run_id: str
    artifact_eligible_rows: int
    artifact_roc_auc: float | None = None
    artifact_brier_score: float | None = None
    live_room_types: list[str]
    artifact_room_types: list[str]
    matched_room_types: list[str]
    unseen_live_room_types: list[str]
    legacy_artifact_only_types: list[str]
    taxonomy_overlap_pct: float
    has_taxonomy_drift: bool
    promotion_allowed: bool
    causality_warning: str
    audit_blockers_vi: list[str]


class BanditSimulateResponse(BaseModel):
    provenance: str
    automatic_promotion: bool
    room_type_id: int
    room_type_name: str
    scenario_id: str
    true_price_elasticity: float
    episodes: int
    guardrails: dict[str, int]
    oracle_best_arm: dict[str, float | int]
    policy_summaries: list[BanditPolicySummarySchema]
    regret_series: list[BanditRegretPointSchema]
    thompson_arms: list[BanditArmPosteriorSchema]
    taxonomy_audit: ConversionTaxonomyAuditSchema


class ConciergeAskRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=1000)
    language: Literal["vi", "en"] | None = None


class ConciergeCitationSchema(BaseModel):
    doc_id: str
    category: str
    title: str
    snippet: str
    score: float
    bm25_raw: float
    tfidf_score: float
    suggested_route: str | None = None


class ConciergeSlotsSchema(BaseModel):
    room_type_id: int | None = None
    room_type_name: str | None = None
    check_in_date: str | None = None
    check_out_date: str | None = None
    nights: int | None = None
    guest_count: int | None = None
    coupon_code: str | None = None


class ConciergeAskResponse(BaseModel):
    language: Literal["vi", "en"]
    retriever: str
    top_category: str
    slots: ConciergeSlotsSchema
    citations: list[ConciergeCitationSchema]




