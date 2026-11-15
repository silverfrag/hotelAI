import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class PricingIntelligenceQueryDto {
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'start_date phải có định dạng YYYY-MM-DD.',
  })
  start_date?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  days = 14;
}

export class DriftMonitoringQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(2000)
  sample_size = 500;
}

export class ExplainPricingSampleDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(730)
  lead_time: number;

  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'check_in_date phải có định dạng YYYY-MM-DD.',
  })
  check_in_date: string;

  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'check_out_date phải có định dạng YYYY-MM-DD.',
  })
  check_out_date: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  guest_count: number;
}

export type UncertaintyIntervalView = {
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
};

export type FeatureDriftItemView = {
  feature: string;
  psi: number;
  status: 'stable' | 'warning' | 'drift_detected';
  baseline_mean: number;
  current_mean: number;
  baseline_std: number;
  current_std: number;
  ks_stat: number;
  ks_pvalue: number;
  wasserstein_distance: number;
  baseline_median: number;
  current_median: number;
  baseline_rows: number;
  baseline_source: string;
};

export type AdminDriftMonitoringView = {
  status: 'ready' | 'unavailable';
  observation_source: 'live_pricing_quotes' | 'baseline_diagnostic_sample';
  baseline_source: string;
  sample_count: number;
  total_quotes_in_db: number;
  assessed_at: string;
  overall_status: 'healthy' | 'degraded' | 'drift_alert' | null;
  total_features_monitored: number;
  features_with_drift: number;
  features_with_warning: number;
  reports: FeatureDriftItemView[];
  recommendations: string[];
  note_vi: string;
};

export type AdminExplainSampleView =
  | {
      available: true;
      ai_multiplier: number;
      model_version: string;
      training_run_id: string;
      feature_contract_version: string;
      features: Record<string, number>;
      uncertainty: UncertaintyIntervalView | null;
      explanation: {
        primary_driver: string;
        demand_share_pct: number;
        temporal_share_pct: number;
        attributions: Array<{
          feature: string;
          value: number | string;
          attribution: number;
          pct_contribution: number;
          category: 'demand' | 'temporal';
          human_label: string;
          interpretation: string;
        }>;
        counterfactual: string;
        ai_vs_script_note: string;
      };
    }
  | {
      available: false;
      status_code: number | null;
      reason_vi: string;
    };

export type PricingIntelligenceView = {
  generated_at: string;
  timezone: string;
  period: { start_date: string; end_date: string; days: number };
  model: {
    status: 'ready' | 'unavailable';
    version: string | null;
    feature_contract_version: string | null;
    training_run_id: string | null;
    scope: 'historical_adr_benchmark' | 'unverified';
    vietnam_validated: false;
  };
  daily_inventory: Array<{
    stay_date: string;
    room_type_id: number;
    room_type_name: string;
    sellable_rooms: number;
    confirmed_rooms: number;
    held_rooms: number;
    operationally_blocked_rooms: number;
    available_rooms: number;
  }>;
  forecast: { status: 'not_available'; reason: string };
  notes: string[];
};
