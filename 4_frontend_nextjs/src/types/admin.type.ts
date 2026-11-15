import type {
  BookingPaymentSummary,
  BookingPolicySnapshot,
  BookingStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentTransaction,
} from '@/types/booking.type';

export type RoomStatus = 'Available' | 'Occupied' | 'Maintenance';
export type HousekeepingStatus = 'Ready' | 'Dirty' | 'Cleaning';

export interface AdminRoom {
  room_id: number;
  room_number: string;
  current_status: RoomStatus;
  occupancy_booking_id: string | null;
  housekeeping_status: HousekeepingStatus;
  housekeeping_version: number;
  housekeeping_updated_at: string;
  type_id: number;
  type_name: string;
  base_price: number;
  capacity: number;
}

export interface AdminRoomType {
  type_id: number;
  type_name: string;
  base_price: number;
  capacity: number;
  declared_max_price?: number | null;
  room_count: number;
}

export type EditableRoomStatus = Exclude<RoomStatus, 'Occupied'>;

export interface CreateRoomInput {
  room_number: string;
  type_id: number;
  current_status?: EditableRoomStatus;
}

export type UpdateRoomInput = Partial<CreateRoomInput>;

export interface RoomTypeInput {
  name: string;
  base_price: number;
  capacity: number;
  declared_max_price?: number | null;
}

export interface PricingSettings {
  ai_enabled: boolean;
  updated_at: string | null;
  updated_by?: string | null;
  version: number;
}

export interface PricingLog {
  log_id: string;
  booking_id: string | null;
  type_id: number;
  type_name: string | null;
  target_date: string;
  lead_time: number | null;
  is_weekend: boolean | null;
  total_of_special_requests: number | null;
  ai_multiplier: number;
  final_price: number;
  pricing_source: string | null;
  base_price?: number | null;
  settings_version?: number | null;
  ai_enabled?: boolean | null;
  updated_at: string;
}

export interface PricingLogPage {
  items: PricingLog[];
  total: number;
  limit: number;
  offset: number;
}

export type AdminBookingStatus = BookingStatus;

export interface AdminBooking extends BookingPolicySnapshot {
  booking_id: string;
  customer_id: string;
  customer_name: string;
  customer_email: string;
  check_in_date: string;
  check_out_date: string;
  guest_count: number;
  status: AdminBookingStatus;
  created_at: string;
  checked_in_at: string | null;
  checked_in_by: string | null;
  checked_out_at: string | null;
  checked_out_by: string | null;
  room_id: number;
  room_assignment_version: number;
  room_current_status: RoomStatus;
  housekeeping_status: HousekeepingStatus;
  housekeeping_version: number;
  housekeeping_updated_at: string;
  room_number_snapshot: string;
  room_type_name_snapshot: string;
  nightly_price: number;
  nights: number;
  total_price: number;
  can_cancel: boolean;
  can_check_in: boolean;
  can_check_out: boolean;
  can_mark_no_show: boolean;
  credit_authorized: number;
  payment_status: PaymentStatus;
  paid_amount: number;
  refunded_amount: number;
  net_paid: number;
  balance_due: number;
  refund_due: number;
}

export interface AdminBookingPage {
  items: AdminBooking[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminHousekeepingQueueItem {
  room_id: number;
  type_id: number;
  type_name: string;
  room_number: string;
  current_status: RoomStatus;
  occupancy_booking_id: string | null;
  housekeeping_status: HousekeepingStatus;
  housekeeping_version: number;
  housekeeping_updated_at: string;
}

export interface AdminHousekeepingPage {
  items: AdminHousekeepingQueueItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface UpdateHousekeepingStatusInput {
  target_status: HousekeepingStatus;
  expected_version: number;
  reason: string;
}

export interface AdminHousekeepingMutation {
  event_id: string;
  room_id: number;
  from_status: HousekeepingStatus;
  to_status: HousekeepingStatus;
  housekeeping_status: HousekeepingStatus;
  from_version: number;
  to_version: number;
  housekeeping_version: number;
  reason: string;
  changed_by: string;
  occurred_at: string;
}

export interface ReassignRoomInput {
  target_room_id: number;
  expected_assignment_version: number;
  reason: string;
  is_upgrade?: boolean;
}

export interface AdminBookingPolicy {
  policy_id: number;
  version: number;
  deposit_percent: number;
  pending_ttl_minutes: number;
  require_full_payment_at_checkout: boolean;
  updated_at: string;
  updated_by: string | null;
  reason: string;
}

export interface UpdateAdminBookingPolicyInput {
  expected_version: number;
  reason: string;
  deposit_percent?: number;
  pending_ttl_minutes?: number;
  require_full_payment_at_checkout?: boolean;
}

export interface AdminWorkflowReadiness {
  pending_count: number;
  expired_backlog: number;
  oldest_expired_at: string | null;
  expiry_worker: string;
  last_expiry_run_at: string | null;
  notification_channel: string;
}

export interface AdminExpirePendingResult {
  expired_count: number;
  booking_ids: string[];
}

export interface AdminBookingWorkflowActionResult {
  replayed: boolean;
  booking: import('@/types/booking.type').BookingFinancialStatus;
}

export interface AdminCreditAuthorization {
  authorization_id: string;
  booking_id: string;
  authorized_amount: number;
  reason: string;
  idempotency_key: string;
  authorized_by: string;
  created_at: string;
}

export interface AdminCreditAuthorizationResult {
  replayed: boolean;
  authorization: AdminCreditAuthorization;
}

export interface AdminRoomReassignment {
  event_id: string;
  booking_id: string;
  booking_detail_id: string;
  from_room_id: number;
  to_room_id: number;
  from_version: number;
  to_version: number;
  room_assignment_version: number;
  reason: string;
  changed_by: string;
  occurred_at: string;
}

export interface AdminPaymentTransaction extends PaymentTransaction {
  customer_id: string;
  customer_name: string;
  customer_email: string;
  booking_status: AdminBookingStatus;
}

export interface AdminPaymentPage {
  items: AdminPaymentTransaction[];
  total: number;
  limit: number;
  offset: number;
}

export interface RecordPaymentInput {
  amount: number;
  method: PaymentMethod;
  idempotency_key: string;
  external_reference?: string;
  note?: string;
}

export interface RefundPaymentInput {
  amount: number;
  idempotency_key: string;
  note?: string;
}

export interface PaymentMutationResult {
  replayed: boolean;
  transaction: PaymentTransaction;
  summary: BookingPaymentSummary;
}

export interface AdminDashboardSummary {
  total_bookings: number;
  confirmed_bookings: number;
  checked_in_bookings: number;
  completed_bookings: number;
  canceled_bookings: number;
  pending_bookings: number;
  expired_bookings: number;
  no_show_bookings: number;
  booking_value: number;
  customer_count: number;
  room_count: number;
  revpar: number | null;
  booking_value_per_room: number;
  occupancy_rate: number;
  forecasted_demand: number | null;
  forecast_status: 'not_available';
}

export interface AdminMonthlyBookingValue {
  month: string;
  booking_count: number;
  booking_value: number;
}

export interface AdminRoomStatusBreakdown {
  status: RoomStatus;
  room_count: number;
}

export interface AdminDashboard {
  business_date: string;
  timezone: string;
  summary: AdminDashboardSummary;
  monthly_revenue: AdminMonthlyBookingValue[];
  room_status_breakdown: AdminRoomStatusBreakdown[];
  pricing_setting: PricingSettings;
  recent_bookings: AdminBooking[];
}

export type AdminUserRole = 'customer' | 'admin';
export type AdminUserStatus = 'Active' | 'Suspended' | 'Deactivated';

export interface AdminUser {
  customer_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  nationality: string | null;
  role: AdminUserRole;
  account_status: AdminUserStatus;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  booking_count: number;
  confirmed_booking_count: number;
  checked_in_booking_count: number;
  active_booking_count: number;
  booking_value: number;
}

export interface AdminUserPage {
  items: AdminUser[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminUserAudit {
  audit_id: string;
  action: 'profile_updated' | 'password_changed' | 'account_updated' | 'deactivated';
  old_role: AdminUserRole | null;
  new_role: AdminUserRole | null;
  old_status: AdminUserStatus | null;
  new_status: AdminUserStatus | null;
  old_version: number;
  new_version: number;
  changed_fields: { fields?: string[]; source?: string };
  changed_by: string;
  changed_by_name: string;
  changed_by_email: string;
  created_at: string;
}

export interface AdminUserAuditPage {
  items: AdminUserAudit[];
  total: number;
  limit: number;
  offset: number;
}

export interface SmartUpgradeRecommendation {
  booking_id: string;
  customer_name: string;
  check_in_date: string;
  check_out_date: string;
  guest_count: number;
  nights: number;
  expected_assignment_version: number;
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
  };
  upgrade_delta_value: number;
  occupancy_boost_reason: string;
  confidence_score: number | null;
  recommendation_source?: 'rule_based';
}

export interface ExecuteUpgradeInput {
  booking_id: string;
  target_room_id: number;
  expected_assignment_version: number;
  reason: string;
}

export interface TapeChartDayColumn {
  date: string;
  dayOfWeek: string;
  isToday: boolean;
  isWeekend: boolean;
}

export interface TapeChartBookingSlot {
  bookingId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  status: AdminBookingStatus;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  appliedPrice: number;
  isStart: boolean;
  isEnd: boolean;
  isSpan: boolean;
  roomAssignmentVersion: number;
  canCheckIn: boolean;
  canCheckOut: boolean;
}

export interface TapeChartRoomRow {
  roomId: number;
  roomNumber: string;
  floor: number;
  roomTypeId: number;
  roomTypeName: string;
  basePrice: number;
  currentStatus: 'Available' | 'Occupied' | 'Maintenance';
  housekeepingStatus: 'Ready' | 'Dirty' | 'Cleaning' | 'Inspected' | 'Maintenance';
  housekeepingVersion: number;
  occupancyBookingId: string | null;
  slots: Record<string, TapeChartBookingSlot | null>;
}

export interface TapeChartMetrics {
  totalRooms: number;
  occupiedRoomsToday: number;
  occupancyRateToday: number;
  arrivalsToday: number;
  departuresToday: number;
  readyRooms: number;
  dirtyRooms: number;
  cleaningRooms: number;
  maintenanceRooms: number;
}

export interface TapeChartView {
  businessDate: string;
  startDate: string;
  endDate: string;
  days: number;
  timeline: TapeChartDayColumn[];
  metrics: TapeChartMetrics;
  rooms: TapeChartRoomRow[];
}

export interface AiModelLineage {
  model_version: string | null;
  training_run_id: string | null;
  feature_contract_version: string | null;
}

export interface AiShadowSettings {
  shadow_enabled: boolean;
  champion: AiModelLineage;
  challenger: AiModelLineage;
  guardrails: {
    minimum_multiplier: number;
    maximum_multiplier: number;
    maximum_change_ratio_from_champion: number;
  };
  readiness_gates: {
    minimum_confirmed_exposures: number;
    minimum_conversions: number;
    minimum_non_conversions: number;
    minimum_shadow_days: number;
    minimum_inference_coverage_ratio: number;
    maximum_inference_error_ratio: number;
  };
  version: number;
  updated_at: string;
  updated_by: string | null;
  mode: 'shadow_only';
  automatic_promotion: false;
}

export interface UpdateAiShadowSettingsInput {
  expected_version: number;
  change_reason: string;
  shadow_enabled?: boolean;
  champion_model_version?: string | null;
  champion_training_run_id?: string | null;
  champion_feature_contract_version?: string | null;
  challenger_model_version?: string | null;
  challenger_training_run_id?: string | null;
  challenger_feature_contract_version?: string | null;
  guardrail_min_multiplier?: number;
  guardrail_max_multiplier?: number;
  guardrail_max_change_ratio?: number;
  minimum_confirmed_exposures?: number;
  minimum_conversions?: number;
  minimum_non_conversions?: number;
  minimum_shadow_days?: number;
  minimum_inference_coverage_ratio?: number;
  maximum_inference_error_ratio?: number;
}

export type AiShadowReadinessStatus =
  | 'retired'
  | 'paused'
  | 'out_of_window_attempts'
  | 'collecting'
  | 'lineage_mismatch'
  | 'excess_inference_errors'
  | 'insufficient_inference_coverage'
  | 'insufficient_shadow_days'
  | 'data_quality_exclusions'
  | 'insufficient_confirmed_exposures'
  | 'insufficient_conversions'
  | 'insufficient_non_conversions'
  | 'ready_for_offline_review'
  | string;

export interface AiShadowReadiness {
  control_version: number;
  is_current_control: boolean;
  challenger_model_version: string | null;
  challenger_training_run_id: string | null;
  challenger_feature_contract_version: string | null;
  shadow_enabled: boolean;
  minimum_confirmed_exposures: number;
  minimum_conversions: number;
  minimum_non_conversions: number;
  minimum_shadow_days: number;
  minimum_inference_coverage_ratio: number;
  maximum_inference_error_ratio: number;
  total_opportunity_quotes: number;
  total_attempts: number;
  in_window_attempts: number;
  out_of_window_attempts: number;
  succeeded_attempts: number;
  succeeded_attempts_with_decisions: number;
  orphan_succeeded_attempts: number;
  failed_attempts: number;
  lineage_mismatch_attempts: number;
  inference_coverage_ratio: number | null;
  inference_error_ratio: number | null;
  total_decisions: number;
  shadow_observation_days: number;
  confirmed_exposure_decisions: number;
  matured_labeled_decisions: number;
  eligible_matured_decisions: number;
  accepted_decisions: number;
  non_accepted_decisions: number;
  excluded_data_quality_decisions: number;
  guardrail_adjusted_decisions: number;
  mean_absolute_multiplier_delta: number | null;
  conversion_brier_score: number | null;
  readiness_status: AiShadowReadinessStatus;
  last_attempt_at: string | null;
  last_decision_at: string | null;
}

export interface AiShadowAudit {
  audit_id: string;
  setting_id: number;
  shadow_enabled: boolean;
  champion_model_version: string | null;
  champion_training_run_id: string | null;
  champion_feature_contract_version: string | null;
  challenger_model_version: string | null;
  challenger_training_run_id: string | null;
  challenger_feature_contract_version: string | null;
  guardrail_min_multiplier: number;
  guardrail_max_multiplier: number;
  guardrail_max_change_ratio: number;
  minimum_confirmed_exposures: number;
  minimum_conversions: number;
  minimum_non_conversions: number;
  minimum_shadow_days: number;
  minimum_inference_coverage_ratio: number;
  maximum_inference_error_ratio: number;
  version: number;
  change_reason: string;
  changed_at: string;
  changed_by: string | null;
  is_current_control: boolean;
}

export interface AiShadowRuntimeStatus {
  mode: 'shadow_only';
  automatic_promotion: false;
  causality_warning: string;
  champion_artifact: {
    status: 'ready' | 'unavailable';
    model_version: string | null;
    training_run_id: string | null;
    feature_contract_version: string | null;
  };
  challenger_artifact: {
    status: 'ready' | 'unavailable';
    lifecycle_stage: 'shadow_only' | null;
    model_version: string | null;
    training_run_id: string | null;
    feature_contract_version: string | null;
    reason_vi: string;
  };
  attempt_summary: {
    total_attempts: number;
    succeeded_attempts: number;
    failed_attempts: number;
    unavailable_attempts: number;
    timeout_attempts: number;
    lineage_mismatch_attempts: number;
    total_decisions: number;
    last_attempt_at: string | null;
  };
}

export interface UncertaintyInterval {
  method: string;
  calibration_rows: number;
  ensemble_p10: number;
  ensemble_p50: number;
  ensemble_p90: number;
  ensemble_std: number;
  conformal_alpha: number;
  target_coverage: number;
  empirical_holdout_coverage: number | null;
  conformal_low: number;
  conformal_high: number;
  ood_distance: number;
  ood_p95_threshold: number | null;
  ood_p99_threshold: number | null;
  ood_status: 'in_distribution' | 'border' | 'out_of_distribution';
  ood_notes: string[];
}

export interface FeatureDriftItem {
  feature: string;
  psi: number;
  status: 'stable' | 'warning' | 'drift_detected';
  baseline_mean: number;
  current_mean: number;
  baseline_std: number;
  current_std: number;
  ks_stat?: number;
  ks_pvalue?: number;
  wasserstein_distance?: number;
  baseline_median?: number;
  current_median?: number;
  baseline_rows?: number;
  baseline_source?: string;
}

export interface AdminDriftMonitoring {
  status: 'ready' | 'unavailable';
  observation_source: 'live_pricing_quotes' | 'baseline_diagnostic_sample';
  baseline_source?: string;
  sample_count: number;
  total_quotes_in_db: number;
  assessed_at: string;
  overall_status: 'healthy' | 'degraded' | 'drift_alert' | null;
  total_features_monitored: number;
  features_with_drift: number;
  features_with_warning: number;
  reports: FeatureDriftItem[];
  recommendations: string[];
  note_vi: string;
}

export interface ExplainPricingSampleInput {
  lead_time: number;
  check_in_date: string;
  check_out_date: string;
  guest_count: number;
}

export interface PriceExplanationFeatureAttribution {
  feature: string;
  value: number | string;
  attribution: number;
  pct_contribution: number;
  category: 'demand' | 'temporal';
  human_label: string;
  interpretation: string;
}

export interface PriceExplanationPayload {
  primary_driver: string;
  demand_share_pct: number;
  temporal_share_pct: number;
  attributions: PriceExplanationFeatureAttribution[];
  counterfactual: string;
  ai_vs_script_note: string;
}

export type AdminExplainSampleResult =
  | {
      available: true;
      ai_multiplier: number;
      model_version: string;
      training_run_id: string;
      feature_contract_version: string;
      features: Record<string, number>;
      uncertainty?: UncertaintyInterval | null;
      explanation: PriceExplanationPayload;
    }
  | {
      available: false;
      status_code: number | null;
      reason_vi: string;
    };
