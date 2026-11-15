export interface DailyPricingInventory {
  stay_date: string;
  room_type_id: number;
  room_type_name: string;
  sellable_rooms: number;
  confirmed_rooms: number;
  held_rooms: number;
  operationally_blocked_rooms: number;
  available_rooms: number;
}

export interface PricingIntelligence {
  generated_at: string;
  timezone: string;
  /** end_date is exclusive: it is the checkout boundary, not another night. */
  period: { start_date: string; end_date: string; days: number };
  model: {
    status: 'ready' | 'unavailable';
    version: string | null;
    feature_contract_version: string | null;
    training_run_id: string | null;
    scope: 'historical_adr_benchmark' | 'unverified';
    vietnam_validated: false;
  };
  daily_inventory: DailyPricingInventory[];
  forecast: { status: 'not_available'; reason: string };
  notes: string[];
}

export interface PricingIntelligenceQuery {
  start_date?: string;
  days?: number;
  signal?: AbortSignal;
}

export interface AiMaturityData {
  stage: 'nascent' | 'learning' | 'shadow_ready' | 'shadow_active' | 'assisted' | 'autonomous';
  stage_label: string;
  stage_index: number;
  total_stages: number;
  progress_pct: number;
  gates_passed: number;
  gates_total: number;
  gates: Record<string, boolean>;
  next_actions: string[];
  data_readiness: {
    total_exposures: number;
    confirmed_exposures: number;
    mature_exposures: number;
    positive_labels: number;
    negative_labels: number;
    distinct_exposure_days: number;
    verified_observed_rows: number;
    thresholds: {
      minimum_eligible_exposures: number;
      minimum_positive_labels: number;
      minimum_negative_labels: number;
      minimum_exposure_days: number;
    };
  };
  model_gate: {
    has_artifact: boolean;
    passes_performance_gate: boolean;
    model_version?: string | null;
    brier_score?: number | null;
    baseline_brier_score?: number | null;
    roc_auc?: number | null;
  };
  shadow_gate: {
    shadow_enabled: boolean;
    shadow_days: number;
    coverage: number;
    error_rate: number;
    thresholds: {
      minimum_shadow_days: number;
      minimum_shadow_coverage: number;
      maximum_shadow_error_rate: number;
    };
  };
  causal_evidence: {
    has_experiment: boolean;
    is_significant: boolean;
    revpar_lift_pct?: number | null;
  };
  assessed_at: string;
}

export interface HourlyPriceBreakdown {
  feature: string;
  label_vi: string;
  impact_pct: number;
  impact_vnd: number;
  description: string;
}

export interface HourlyRoomEvaluation {
  room_type_id: number;
  room_type_name: string;
  base_price: number;
  sellable_rooms: number;
  available_rooms: number;
  occupancy_pct: number;
  hourly_multiplier: number;
  final_nightly_price: number;
  session_name: string;
  traffic_surge_index: number;
  breakdowns: HourlyPriceBreakdown[];
  summary_explanation: string;
  counterfactual_scenario: string;
}

export interface HourlySignalsData {
  evaluated_at: string;
  timezone: string;
  business_date: string;
  current_hour: number;
  current_minute: number;
  velocity_1h: number;
  velocity_3h: number;
  hotel_total_sellable: number;
  hotel_total_available: number;
  room_evaluations: HourlyRoomEvaluation[];
}

export interface IntradaySimulationPoint {
  hour: number;
  hour_label: string;
  hourly_multiplier: number;
  final_price: number;
  traffic_velocity_1h: number;
  rooms_available: number;
  occupancy_pct: number;
  session_name: string;
  primary_driver: string;
}

export interface IntradaySimulationResult {
  status: string;
  scenario: string;
  points: IntradaySimulationPoint[];
  summary: string;
}

