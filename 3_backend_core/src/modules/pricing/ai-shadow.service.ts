import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DataSource } from 'typeorm';

export type ShadowQuoteContext = {
  quoteId: string;
  quoteCreatedAt: string;
  roomTypeName: string;
  capacity: number;
  checkInDate: string;
  checkOutDate: string;
  guestCount: number;
  leadTime: number;
  roomsAvailable: number;
  roomsSellable: number;
  roomsBooked: number;
  occupancyRatio: number;
  basePrice: number;
  nightlyPrice: number;
  championMultiplier: number;
  pricingSource: 'ai' | 'base';
  championModelVersion: string | null;
  championTrainingRunId: string | null;
  championFeatureContractVersion: string | null;
};

type ShadowPolicyRow = {
  shadow_enabled: boolean;
  champion_model_version: string | null;
  champion_training_run_id: string | null;
  champion_feature_contract_version: string | null;
  challenger_model_version: string | null;
  challenger_training_run_id: string | null;
  challenger_feature_contract_version: string | null;
  guardrail_min_multiplier: string | number;
  guardrail_max_multiplier: string | number;
  guardrail_max_change_ratio: string | number;
  version: string | number;
  updated_at: Date | string;
};

type ShadowOptimizerResponse = {
  status: string;
  lifecycle_stage: string;
  champion_multiplier: number;
  champion_conversion_probability: number;
  proposed_multiplier: number;
  guardrailed_multiplier: number;
  model_version: string;
  training_run_id: string;
  feature_contract_version: string;
};

type AttemptOutcome = 'unavailable' | 'timeout' | 'error' | 'lineage_mismatch';

@Injectable()
export class AiShadowService {
  private readonly logger = new Logger(AiShadowService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async evaluateQuote(context: ShadowQuoteContext): Promise<void> {
    let policy: ShadowPolicyRow | undefined;
    try {
      const rows = await this.dataSource.query(
        `SELECT shadow_enabled,
                champion_model_version,
                champion_training_run_id,
                champion_feature_contract_version,
                challenger_model_version,
                challenger_training_run_id,
                challenger_feature_contract_version,
                guardrail_min_multiplier,
                guardrail_max_multiplier,
                guardrail_max_change_ratio,
                version,
                updated_at
         FROM ai_pricing_shadow_settings
         WHERE setting_id = 1`,
      ) as ShadowPolicyRow[];
      policy = rows[0];
      if (!policy?.shadow_enabled) return;
      const quoteCreatedAt = Date.parse(context.quoteCreatedAt);
      const policyStartedAt = new Date(policy.updated_at).getTime();
      if (
        !Number.isFinite(quoteCreatedAt)
        || !Number.isFinite(policyStartedAt)
        || quoteCreatedAt < policyStartedAt
      ) {
        // The quote was generated before this policy became current, so it is
        // not an inference opportunity for this control window. This can occur
        // when an admin changes policy between quote persistence and evaluation.
        return;
      }

      if (!this.quoteMatchesChampion(context, policy)) {
        await this.recordFailedAttempt(
          context.quoteId,
          Number(policy.version),
          'lineage_mismatch',
          0,
          'champion_lineage_mismatch',
        );
        return;
      }

      const startedAt = Date.now();
      try {
        const { data } = await axios.post<ShadowOptimizerResponse>(
          this.configService.get<string>(
            'AI_SHADOW_OPTIMIZER_URL',
            'http://localhost:8000/api/v1/optimize-price-shadow',
          ),
          {
            lead_time: context.leadTime,
            check_in_date: context.checkInDate,
            check_out_date: context.checkOutDate,
            guest_count: context.guestCount,
            capacity_snapshot: context.capacity,
            rooms_available: context.roomsAvailable,
            rooms_sellable_snapshot: context.roomsSellable,
            rooms_booked_snapshot: context.roomsBooked,
            occupancy_ratio_snapshot: context.occupancyRatio,
            base_price: context.basePrice,
            offered_nightly_price: context.nightlyPrice,
            room_type_name: context.roomTypeName,
            currency: 'VND',
            pricing_source: context.pricingSource,
            champion_multiplier: context.championMultiplier,
            guardrail_min_multiplier: Number(policy.guardrail_min_multiplier),
            guardrail_max_multiplier: Number(policy.guardrail_max_multiplier),
            guardrail_max_change_ratio: Number(policy.guardrail_max_change_ratio),
          },
          { timeout: this.getTimeoutMilliseconds() },
        );
        const latency = Date.now() - startedAt;
        if (!this.isValidResponse(data, context, policy)) {
          const responseLineageMismatch = Boolean(data)
            && (
              data.model_version !== policy.challenger_model_version
              || data.training_run_id !== policy.challenger_training_run_id
              || data.feature_contract_version
                !== policy.challenger_feature_contract_version
            );
          await this.recordFailedAttempt(
            context.quoteId,
            Number(policy.version),
            responseLineageMismatch ? 'lineage_mismatch' : 'error',
            latency,
            responseLineageMismatch
              ? 'challenger_lineage_mismatch'
              : 'invalid_optimizer_response',
          );
          return;
        }
        await this.recordSuccessfulDecision(context, policy, data, latency);
      } catch (error) {
        const latency = Date.now() - startedAt;
        const outcome = this.classifyFailure(error);
        await this.recordFailedAttempt(
          context.quoteId,
          Number(policy.version),
          outcome.outcome,
          latency,
          outcome.errorCode,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Shadow evaluation failed open for quote ${context.quoteId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private quoteMatchesChampion(
    context: ShadowQuoteContext,
    policy: ShadowPolicyRow,
  ): boolean {
    return context.pricingSource === 'ai'
      && context.championModelVersion === policy.champion_model_version
      && context.championTrainingRunId === policy.champion_training_run_id
      && context.championFeatureContractVersion
        === policy.champion_feature_contract_version;
  }

  private isValidResponse(
    data: ShadowOptimizerResponse,
    context: ShadowQuoteContext,
    policy: ShadowPolicyRow,
  ): boolean {
    return Boolean(data)
      && data.status === 'success'
      && data.lifecycle_stage === 'shadow_only'
      && data.model_version === policy.challenger_model_version
      && data.training_run_id === policy.challenger_training_run_id
      && data.feature_contract_version === policy.challenger_feature_contract_version
      && this.numericInside(data.champion_multiplier, 0.1, 5)
      && Math.abs(data.champion_multiplier - context.championMultiplier) <= 1e-6
      && this.numericInside(data.champion_conversion_probability, 0, 1)
      && this.numericInside(data.proposed_multiplier, 0.1, 5)
      && this.numericInside(data.guardrailed_multiplier, 0.1, 5);
  }

  private numericInside(value: unknown, minimum: number, maximum: number): boolean {
    return typeof value === 'number'
      && Number.isFinite(value)
      && value >= minimum
      && value <= maximum;
  }

  private async recordSuccessfulDecision(
    context: ShadowQuoteContext,
    policy: ShadowPolicyRow,
    response: ShadowOptimizerResponse,
    latency: number,
  ): Promise<void> {
    const controlVersion = Number(policy.version);
    await this.dataSource.transaction(async (manager) => {
      const attemptRows = await manager.query(
        `WITH inserted_attempt AS (
           INSERT INTO ai_pricing_shadow_attempts (
             quote_id,
             control_version,
             outcome,
             inference_latency_ms,
             error_code,
             idempotency_key
           ) VALUES ($1::uuid, $2, 'succeeded', $3, NULL, $4)
           ON CONFLICT (quote_id, control_version) DO NOTHING
           RETURNING attempt_id
         )
         SELECT attempt_id FROM inserted_attempt`,
        [
          context.quoteId,
          controlVersion,
          latency,
          this.attemptIdempotencyKey(context.quoteId, controlVersion),
        ],
      ) as Array<{ attempt_id: string }>;
      const attempt = attemptRows[0];
      if (!attempt) return;

      await manager.query(
        `INSERT INTO ai_pricing_shadow_decisions (
           attempt_id,
           quote_id,
           control_version,
           champion_model_version,
           champion_training_run_id,
           champion_feature_contract_version,
           champion_multiplier,
           challenger_model_version,
           challenger_training_run_id,
           challenger_feature_contract_version,
           predicted_conversion_probability,
           proposed_multiplier,
           guardrailed_multiplier,
           multiplier_delta_from_champion,
           relative_price_delta_from_champion,
           guardrail_status,
           guardrail_reasons,
           inference_latency_ms,
           source,
           idempotency_key
         ) VALUES (
           $1::uuid, $2::uuid, $3,
           $4, $5, $6, $7,
           $8, $9, $10, $11, $12,
           NULL, NULL, NULL, 'within_policy', ARRAY[]::TEXT[], $13,
           'ai_shadow_optimizer', $14
         )`,
        [
          attempt.attempt_id,
          context.quoteId,
          controlVersion,
          context.championModelVersion,
          context.championTrainingRunId,
          context.championFeatureContractVersion,
          context.championMultiplier,
          response.model_version,
          response.training_run_id,
          response.feature_contract_version,
          response.champion_conversion_probability,
          response.proposed_multiplier,
          latency,
          `shadow-decision:${context.quoteId}:${controlVersion}`,
        ],
      );
    });
  }

  private async recordFailedAttempt(
    quoteId: string,
    controlVersion: number,
    outcome: AttemptOutcome,
    latency: number,
    errorCode: string,
  ): Promise<void> {
    try {
      await this.dataSource.query(
        `INSERT INTO ai_pricing_shadow_attempts (
           quote_id,
           control_version,
           outcome,
           inference_latency_ms,
           error_code,
           idempotency_key
         ) VALUES ($1::uuid, $2, $3, $4, $5, $6)
         ON CONFLICT (quote_id, control_version) DO NOTHING`,
        [
          quoteId,
          controlVersion,
          outcome,
          latency,
          errorCode,
          this.attemptIdempotencyKey(quoteId, controlVersion),
        ],
      );
    } catch (error) {
      this.logger.warn(
        `Unable to persist shadow failure for quote ${quoteId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private classifyFailure(error: unknown): {
    outcome: AttemptOutcome;
    errorCode: string;
  } {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        return { outcome: 'timeout', errorCode: 'optimizer_timeout' };
      }
      if (error.response?.status === 503) {
        return { outcome: 'unavailable', errorCode: 'challenger_unavailable' };
      }
      return { outcome: 'error', errorCode: 'optimizer_http_error' };
    }
    return { outcome: 'error', errorCode: 'shadow_runtime_error' };
  }

  private attemptIdempotencyKey(quoteId: string, controlVersion: number): string {
    return `shadow-attempt:${quoteId}:${controlVersion}`;
  }

  private getTimeoutMilliseconds(): number {
    const configured = Number(
      this.configService.get<string>('AI_SHADOW_TIMEOUT_MS', '750'),
    );
    if (!Number.isFinite(configured)) return 750;
    return Math.min(2_000, Math.max(100, Math.floor(configured)));
  }
}
