import type { UncertaintyInterval } from '@/types/admin.type';

export type DemandLevel = 'low' | 'normal' | 'high' | 'surge';
export type WeatherCondition = 'sunny_favorable' | 'stormy_unfavorable';
export type CompetitorPosition = 'lower_undercut' | 'par_neutral' | 'higher_premium';

export interface SimulatedCoupon {
  code: string;
  description_vi?: string;
  discount_pct: number;
  max_discount_vnd: number;
  min_room_type_id?: number;
  usage_limit: number;
  used_count: number;
  active: boolean;
  expiry_date: string;
  provenance?: string;
}

export interface MarketScenario {
  scenario_id: string;
  name_vi: string;
  demand_level: DemandLevel;
  weather: WeatherCondition;
  competitor_rate_position: CompetitorPosition;
  serving_cost_per_night: number;
  channel_commission_pct: number;
  tax_rate: number;
  service_charge_rate: number;
  min_contribution_margin: number;
  provenance: string;
}

export interface PriceFactor {
  factor_name: string;
  source_category: string;
  impact_pct: number;
  impact_vnd: number;
  description_vi: string;
}

export interface RevenueQuoteResult {
  room_type_id: number;
  room_type_name: string;
  base_price: number;
  ml_reference_price: number;
  scenario_recommended_rate: number;
  coupon_applied: string | null;
  coupon_discount_vnd: number;
  guest_payable_nightly_rate: number;
  total_nights: number;
  guest_total_payable: number;
  serving_cost_per_night: number;
  taxes_and_service_vnd: number;
  net_revenue_per_night: number;
  estimated_contribution_margin: number;
  is_floor_price_clamped: boolean;
  factors: PriceFactor[];
  scenario_id: string;
  scenario_name_vi: string;
  caveats: string[];
}

export interface AllocationAssignment {
  request_id: string;
  room_id: number;
  room_number: string;
  assigned_type_id: number;
  is_upgrade: boolean;
  status: 'ASSIGNED' | 'REJECTED_NO_CAPACITY';
}

export interface OptimizationResult {
  status: string;
  solver_time_ms: number;
  total_assigned_revenue: number;
  assignments: AllocationAssignment[];
  unassigned_request_ids: string[];
  audit_notes: string[];
}

export interface SimulationEventStep {
  step_id: number;
  timestamp_offset: string;
  phase: 'SIGNAL_INCOMING' | 'AI_REASONING' | 'TOOL_EXECUTION' | 'DECISION_OUTCOME' | string;
  actor: 'MARKET' | 'GUEST' | 'AI_DECISION_ENGINE' | 'OR_TOOLS_SOLVER' | 'FINANCIAL_GUARD' | string;
  title: string;
  detail_vi: string;
  metrics_snapshot: Record<string, any>;
  provenance_tag: string;
}

export interface ScenarioScorecard {
  scenario_id: string;
  scenario_title: string;
  overall_score: number;
  zero_oversell_guarantee: boolean;
  floor_price_safety_rate: string;
  revpar_impact: string;
  solver_efficiency: string;
  policy_compliance_rate: string;
  academic_summary: string;
}

export interface ScenarioExecutionResult {
  scenario_id: string;
  title: string;
  description: string;
  executed_at: string;
  duration_ms: number;
  timeline: SimulationEventStep[];
  scorecard: ScenarioScorecard;
  parameters: Record<string, any>;
}

export interface ScenarioMetaItem {
  id: string;
  title: string;
  tag: string;
  badge_color: 'rose' | 'purple' | 'amber' | 'teal' | string;
  summary: string;
}

export interface LiveAllocationSnapshot {
  total_rooms: number;
  sellable_rooms: number;
  maintenance_rooms: number;
  existing_occupancy_count: number;
  window_start: string;
  window_end: string;
  queried_at: string;
  provenance: string;
}

export interface LiveAllocationResult extends OptimizationResult {
  live_snapshot: LiveAllocationSnapshot;
}

export interface LiveRevenueContext {
  room_type_id: number;
  room_type_name: string;
  base_price: number;
  declared_max_price: number | null;
  capacity: number;
  check_in_date: string;
  check_out_date: string;
  guest_count: number;
  lead_time: number;
  rooms_available: number;
  rooms_sellable: number;
  rooms_booked: number;
  occupancy_ratio: number;
  ai_enabled: boolean;
  ml_available: boolean;
  ml_multiplier: number;
  ml_model_version: string | null;
  ml_training_run_id: string | null;
  ml_feature_contract_version: string | null;
  ml_uncertainty?: UncertaintyInterval | null;
  ml_note: string;
  business_date: string;
  queried_at: string;
  provenance: {
    ml_multiplier: string;
    inventory: string;
  };
}

export interface AdminCoupon {
  code: string;
  description_vi: string;
  discount_pct: number;
  max_discount_vnd: number;
  min_room_type_id: number;
  usage_limit: number;
  used_count: number;
  active: boolean;
  expiry_date: string | null;
  created_at: string;
}

export interface AdminCouponListResult {
  data: AdminCoupon[];
  summary: {
    total: number;
    active_count: number;
    total_redemptions: number;
  };
}

export interface CreateAdminCouponInput {
  code: string;
  description_vi: string;
  discount_pct: number;
  max_discount_vnd: number;
  min_room_type_id: number;
  usage_limit: number;
  active?: boolean;
  expiry_date?: string | null;
}

export interface UpdateAdminCouponInput {
  description_vi?: string;
  discount_pct?: number;
  max_discount_vnd?: number;
  min_room_type_id?: number;
  usage_limit?: number;
  active?: boolean;
  expiry_date?: string | null;
  reset_used_count?: boolean;
}

export interface MarketSourceEvidence {
  source_id: string;
  name: string;
  kind: string;
  url: string;
  status: 'fetched' | 'cached' | 'unavailable' | 'out_of_horizon' | string;
  fetched_at: string | null;
  detail: string;
}

export interface MarketComparableRate {
  hotel_id: string;
  hotel_name: string;
  nightly_price: number;
  observed_at: string;
  source_url: string;
}

export interface MarketCurvePoint {
  price_vnd: number;
  conversion_probability: number;
  expected_contribution_vnd: number;
}

export interface WeatherIndex {
  comfort_score_0_100: number;
  storm_risk_level: 'low' | 'moderate' | 'high';
  recommended_weather_signal: WeatherCondition;
  temperature_max_c: number;
  rain_probability_pct: number;
  wind_max_kmh: number;
  provenance: string;
  formula_note: string;
}

export interface ScenarioSyncSuggestion {
  weather: WeatherCondition | null;
  demand_level: DemandLevel;
  suggested_scenario_preset: string;
  active_event_count: number;
  total_extracted_facts: number;
  provenance: string;
  reason_vi: string;
}

export interface ExtractedMarketFact {
  fact_type: 'event' | 'travel_disruption' | 'hotel_offer' | string;
  normalization_rule?: string;
  event_status: 'scheduled' | 'cancelled' | 'updated' | string;
  status_quote?: string;
  title: string;
  source_id: string;
  quote: string;
  location_quote: string;
  start_date: string;
  end_date: string;
  start_date_quote: string;
  end_date_quote: string;
  matches_target_date?: boolean;
}

export interface MarketPricingDecisionResult {
  decision_id: string;
  region: string;
  location: string;
  created_at: string;
  feature_contract_version: string;
  status: 'shadow_ready' | 'insufficient_evidence' | string;
  inventory_provenance: string;
  advisory_only: boolean;
  blockers: string[];
  limitations: string[];
  objective: string;
  reference: {
    status: string;
    price_vnd: number | null;
    model_version?: string;
    training_run_id?: string;
    scope: string;
  };
  evidence: {
    sources?: MarketSourceEvidence[];
    weather?: Record<string, unknown> | null;
    comparable_rates?: MarketComparableRate[];
    [key: string]: unknown;
  };
  context: {
    status: string;
    model?: string | null;
    provider?: string | null;
    documents_scanned?: number;
    events?: ExtractedMarketFact[];
    facts?: ExtractedMarketFact[];
    all_extracted_facts?: ExtractedMarketFact[];
    conflicts?: unknown[];
    rejected_events?: number;
    coverage?: string;
    [key: string]: unknown;
  };
  weather_index?: WeatherIndex | null;
  scenario_sync_suggestion?: ScenarioSyncSuggestion | null;
  policy: {
    floor_vnd: number;
    ceiling_vnd: number;
    rounding_vnd: number;
    commission_pct: number;
    tax_pct: number;
    serving_cost: number;
  };
  selected: MarketCurvePoint | null;
  curve: MarketCurvePoint[];
  contributions: Array<{
    feature: string;
    value: number;
    log_odds_contribution: number;
  }>;
}

export interface AdminAllocationQueueItem {
  booking_id: string;
  customer_id: string;
  customer_name: string;
  loyalty_tier: 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
  status: string;
  check_in_date: string;
  check_out_date: string;
  nights: number;
  guest_count: number;
  total_price: number;
  current_room_id: number;
  current_room_number: string;
  current_type_id: number;
  current_type_name: string;
  current_base_price: number;
  room_current_status: string;
  housekeeping_status: string;
  room_assignment_version: number;
  requires_ready_now: boolean;
  can_optimize: boolean;
}

export interface AdminAllocationQueueResponse {
  business_date: string;
  start_date: string;
  end_date: string;
  items: AdminAllocationQueueItem[];
}

export interface AdminQueueOptimizationRecommendation {
  booking_id: string;
  customer_name: string;
  loyalty_tier: 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
  check_in_date: string;
  check_out_date: string;
  nights: number;
  guest_count: number;
  total_price: number;
  expected_assignment_version: number;
  requires_ready_now: boolean;
  status: 'ASSIGNED' | 'REJECTED_NO_CAPACITY';
  changed: boolean;
  is_upgrade: boolean;
  upgrade_delta_value: number;
  current_room: {
    room_id: number;
    room_number: string;
    type_id: number;
    type_name: string;
    base_price: number;
  };
  recommended_room: {
    room_id: number;
    room_number: string;
    type_id: number;
    type_name: string;
    base_price: number;
  } | null;
  reason_vi: string;
}

export interface AdminQueueOptimizationResult {
  status: string;
  solver_time_ms: number;
  total_assigned_revenue: number;
  evaluated_bookings: number;
  changed_count: number;
  upgrade_count: number;
  unassigned_request_ids: string[];
  audit_notes: string[];
  window_start: string;
  window_end: string;
  existing_occupancy_count: number;
  provenance: string;
  recommendations: AdminQueueOptimizationRecommendation[];
}

export type PortfolioScenarioId = 'monsoon_low' | 'standard' | 'weekend_high' | 'holiday_surge';

export interface PortfolioTierShadowPrice {
  type_id: number;
  type_name: string;
  bottleneck_night: string;
  marginal_value_vnd_per_room: number;
  total_available_room_nights: number;
  expected_occupied_room_nights: number;
  utilization_pct: number;
  upgraded_out_room_nights: number;
}

export interface PortfolioDecisionCell {
  stay_date: string;
  is_weekend: boolean;
  type_id: number;
  type_name: string;
  base_price_vnd: number;
  declared_max_price_vnd: number;
  recommended_price_vnd: number;
  price_change_pct: number;
  available_rooms: number;
  already_booked_rooms: number;
  expected_demand_rooms: number;
  accepted_own_tier_rooms: number;
  upgraded_out_rooms: number;
  upgraded_in_rooms: number;
  ml_cancel_prob: number;
  expected_realization_factor: number;
  expected_unit_margin_vnd: number;
}

export interface PortfolioOptimizeResult {
  status: string;
  solver_time_ms: number;
  start_date: string;
  horizon_days: number;
  scenario_id: PortfolioScenarioId;
  price_elasticity: number;
  allow_cross_tier_upgrades: boolean;
  contribution_floor_vnd: number;
  static_baseline_contribution_vnd: number;
  optimized_contribution_vnd: number;
  contribution_lift_vnd: number;
  contribution_lift_pct: number;
  total_upgraded_room_nights: number;
  avg_ml_cancel_prob: number;
  ml_cancel_source: string;
  shadow_prices: PortfolioTierShadowPrice[];
  decisions: PortfolioDecisionCell[];
  warnings: string[];
  provenance_breakdown: Record<string, string>;
  live_snapshot?: {
    tier_count: number;
    total_sellable_rooms: number;
    business_date: string;
    queried_at: string;
    provenance: string;
  };
}

export interface BanditPolicySummary {
  policy_id: string;
  label_en: string;
  label_vi: string;
  cumulative_expected_contrib_vnd: number;
  cumulative_realized_contrib_vnd: number;
  cumulative_regret_vnd: number;
  average_conversion_pct: number;
  floor_violations: number;
  ceiling_violations: number;
  safety_compliance_pct: number;
}

export interface BanditRegretPoint {
  episode: number;
  static_regret_vnd: number;
  heuristic_regret_vnd: number;
  eps_greedy_regret_vnd: number;
  thompson_regret_vnd: number;
  thompson_cumulative_contrib_vnd: number;
  static_cumulative_contrib_vnd: number;
}

export interface BanditArmPosterior {
  price_vnd: number;
  multiplier: number;
  pulls: number;
  empirical_conversions: number;
  posterior_alpha: number;
  posterior_beta: number;
  posterior_mean_conv: number;
  unit_contribution_vnd: number;
  expected_contribution_vnd: number;
  is_oracle_best: boolean;
  is_most_selected: boolean;
}

export interface ConversionTaxonomyAudit {
  artifact_found: boolean;
  model_version: string;
  training_run_id: string;
  artifact_eligible_rows: number;
  artifact_roc_auc: number | null;
  artifact_brier_score: number | null;
  live_room_types: string[];
  artifact_room_types: string[];
  matched_room_types: string[];
  unseen_live_room_types: string[];
  legacy_artifact_only_types: string[];
  taxonomy_overlap_pct: number;
  has_taxonomy_drift: boolean;
  promotion_allowed: boolean;
  causality_warning: string;
  audit_blockers_vi: string[];
}

export interface BanditSimulateResult {
  provenance: string;
  automatic_promotion: boolean;
  room_type_id: number;
  room_type_name: string;
  scenario_id: PortfolioScenarioId;
  true_price_elasticity: number;
  episodes: number;
  guardrails: {
    contribution_floor_vnd: number;
    declared_ceiling_vnd: number;
    base_price_vnd: number;
    safe_arm_count: number;
  };
  oracle_best_arm: {
    price_vnd: number;
    multiplier: number;
    expected_conversion_pct: number;
    expected_contribution_vnd: number;
  };
  policy_summaries: BanditPolicySummary[];
  regret_series: BanditRegretPoint[];
  thompson_arms: BanditArmPosterior[];
  taxonomy_audit: ConversionTaxonomyAudit;
  live_catalog?: Array<{
    type_id: number;
    name: string;
    base_price: number;
  }>;
}



