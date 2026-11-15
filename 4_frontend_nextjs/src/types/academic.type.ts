export type AcademicTask = 'adr' | 'cancellation';
export type HoldoutOrder = 'source' | 'largest_error' | 'smallest_error';
export interface AcademicInput {
  hotel: string;
  arrival_date: string;
  lead_time: number;
  stay_nights: number;
  adults: number;
  children: number | null;
  babies: number;
  reserved_room_type: string;
  meal: string;
  market_segment: string;
  distribution_channel: string;
  customer_type: string;
}
export interface AcademicDecision {
  status: 'success' | 'degraded';
  adr_reference: number | null;
  cancellation_probability: number | null;
  adr_unit: 'EUR';
  model_version: string;
  training_run_id: string;
  feature_contract_version: string;
  prediction_sources: Record<AcademicTask, string>;
  baselines: Record<AcademicTask, number | null>;
  explanation: Record<AcademicTask, { feature_group: string; difference: number; reference_values: Record<string, unknown> }[]>;
  explanation_method: string;
  warnings: string[];
  caveats: string[];
  business_rules: { rule: string; source: string; applied?: boolean; value?: number; description: string }[];
  hypothetical: boolean;
}
export interface HoldoutRow {
  row_id: string; arrival_date: string; hotel: string; reserved_room_type: string;
  observed: number; prediction: number; error: number;
}
export interface HoldoutPage { task: AcademicTask; total: number; offset: number; rows: HoldoutRow[]; partition: string }
export interface AcademicExperiment {
  task: AcademicTask; row_id: string; partition: 'test'; input: AcademicInput;
  observed: number; stored_predictions: Record<string, number>; decision: AcademicDecision; target_caveat: string;
}
export interface CandidateMetrics {
  mae?: number; rmse?: number; r2?: number; precision?: number; recall?: number;
  f1?: number; roc_auc?: number; pr_auc?: number; brier?: number; log_loss?: number;
  confusion_matrix?: number[][]; calibration?: { rows: number; mean_probability: number; observed_rate: number }[];
}
export interface TaskReport {
  selected: string; selection_metric: string; selection_partition: string;
  test: Record<string, CandidateMetrics>; validation: Record<string, CandidateMetrics>;
  split: Record<string, { rows: number; purged_unmatured_labels: number; label_cutoff: string }>;
}
export interface AcademicInfo {
  model_version: string; training_run_id: string; feature_contract_version: string;
  caveats: string[]; categories: Record<string, string[]>;
  tasks: Record<AcademicTask, TaskReport>;
}
