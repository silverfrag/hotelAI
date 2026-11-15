import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DataSource, EntityManager } from 'typeorm';
import {
  PauseAiShadowDto,
  RollbackAiShadowDto,
  UpdateAiShadowSettingDto,
} from './dto/pricing.dto';

type NullableLineage = string | null;

type ShadowSettingRow = {
  setting_id: number | string;
  shadow_enabled: boolean;
  champion_model_version: NullableLineage;
  champion_training_run_id: NullableLineage;
  champion_feature_contract_version: NullableLineage;
  challenger_model_version: NullableLineage;
  challenger_training_run_id: NullableLineage;
  challenger_feature_contract_version: NullableLineage;
  guardrail_min_multiplier: number | string;
  guardrail_max_multiplier: number | string;
  guardrail_max_change_ratio: number | string;
  minimum_confirmed_exposures: number | string;
  minimum_conversions: number | string;
  minimum_non_conversions: number | string;
  minimum_shadow_days: number | string;
  minimum_inference_coverage_ratio: number | string;
  maximum_inference_error_ratio: number | string;
  version: number | string;
  updated_at: Date | string;
  updated_by: string | null;
};

export type AiShadowSettingView = {
  shadow_enabled: boolean;
  champion: {
    model_version: string | null;
    training_run_id: string | null;
    feature_contract_version: string | null;
  };
  challenger: {
    model_version: string | null;
    training_run_id: string | null;
    feature_contract_version: string | null;
  };
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
};

@Injectable()
export class AdminAiShadowService {
  constructor(
    private readonly dataSource: DataSource,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  async getSetting(): Promise<AiShadowSettingView> {
    const row = await this.selectSetting(this.dataSource);
    return this.mapSetting(row);
  }

  async updateSetting(
    dto: UpdateAiShadowSettingDto,
    actorId: string,
  ): Promise<AiShadowSettingView> {
    const mutableKeys = Object.keys(dto).filter(
      (key) => !['expected_version', 'change_reason'].includes(key),
    );
    if (mutableKeys.length === 0) {
      throw new BadRequestException('Cần cung cấp ít nhất một thay đổi cho shadow policy.');
    }
    return this.dataSource.transaction(async (manager) => {
      const current = await this.selectSetting(manager, true);
      this.assertExpectedVersion(current, dto.expected_version);
      const next = this.merge(current, dto);
      this.validate(next);
      if (this.samePolicy(current, next)) return this.mapSetting(current);
      return this.mapSetting(
        await this.applySetting(manager, next, actorId, dto.change_reason),
      );
    });
  }

  async pause(
    dto: PauseAiShadowDto,
    actorId: string,
  ): Promise<AiShadowSettingView> {
    return this.dataSource.transaction(async (manager) => {
      const current = await this.selectSetting(manager, true);
      this.assertExpectedVersion(current, dto.expected_version);
      if (!current.shadow_enabled) return this.mapSetting(current);
      const next = { ...current, shadow_enabled: false };
      return this.mapSetting(
        await this.applySetting(manager, next, actorId, dto.change_reason),
      );
    });
  }

  async rollback(
    dto: RollbackAiShadowDto,
    actorId: string,
  ): Promise<AiShadowSettingView> {
    return this.dataSource.transaction(async (manager) => {
      const current = await this.selectSetting(manager, true);
      this.assertExpectedVersion(current, dto.expected_version);
      if (dto.target_version >= Number(current.version)) {
        throw new BadRequestException('Rollback chỉ nhận một policy version cũ hơn.');
      }
      const targetRows = await manager.query(
        `${this.settingColumns('audit')}
         FROM ai_pricing_shadow_setting_audits audit
         WHERE audit.version = $1`,
        [dto.target_version],
      ) as ShadowSettingRow[];
      const target = targetRows[0];
      if (!target) throw new NotFoundException('Không tìm thấy shadow policy cần rollback.');
      const next: ShadowSettingRow = {
        ...target,
        setting_id: 1,
        shadow_enabled: false,
        version: current.version,
        updated_at: current.updated_at,
        updated_by: current.updated_by,
      };
      this.validate(next);
      return this.mapSetting(
        await this.applySetting(manager, next, actorId, dto.change_reason),
      );
    });
  }

  async getReadiness(): Promise<Record<string, unknown>> {
    const rows = await this.dataSource.query(
      `SELECT *
       FROM ai_pricing_shadow_readiness_v1
       WHERE is_current_control`,
    ) as Array<Record<string, unknown>>;
    if (!rows[0]) {
      throw new InternalServerErrorException('Không thể đọc shadow readiness hiện tại.');
    }
    return this.normalizeReadiness(rows[0]);
  }

  async listAudits(limit = 50): Promise<Array<Record<string, unknown>>> {
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const rows = await this.dataSource.query(
      `SELECT audit.*,
              audit.version = setting.version AS is_current_control
       FROM ai_pricing_shadow_setting_audits audit
       CROSS JOIN ai_pricing_shadow_settings setting
       ORDER BY audit.version DESC
       LIMIT $1`,
      [safeLimit],
    ) as Array<Record<string, unknown>>;
    return rows.map((row) => this.normalizeNumbers(row));
  }

  async getRuntimeStatus(): Promise<{
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
  }> {
    const safeId = (val: unknown): string | null =>
      typeof val === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(val) ? val : null;

    const resolveOrigin = (key: string): string | null => {
      try {
        const raw = this.configService?.get<string>(key);
        if (!raw) return null;
        const url = new URL(raw);
        return ['http:', 'https:'].includes(url.protocol) ? url.origin : null;
      } catch {
        return null;
      }
    };

    const championOrigin = resolveOrigin('AI_SERVICE_URL');
    const challengerOrigin = resolveOrigin('AI_SHADOW_OPTIMIZER_URL') ?? championOrigin;

    const readStats = async () => {
      const rows = await this.dataSource.query(
        `SELECT COUNT(*)::int AS total_attempts,
                COUNT(*) FILTER (WHERE outcome = 'succeeded')::int AS succeeded_attempts,
                COUNT(*) FILTER (WHERE outcome <> 'succeeded')::int AS failed_attempts,
                COUNT(*) FILTER (WHERE outcome = 'unavailable')::int AS unavailable_attempts,
                COUNT(*) FILTER (WHERE outcome = 'timeout')::int AS timeout_attempts,
                COUNT(*) FILTER (WHERE outcome = 'lineage_mismatch')::int AS lineage_mismatch_attempts,
                MAX(occurred_at) AS last_attempt_at,
                (SELECT COUNT(*)::int FROM ai_pricing_shadow_decisions) AS total_decisions
         FROM ai_pricing_shadow_attempts`,
      ) as Array<Record<string, unknown>>;
      const row = rows[0] ?? {};
      return {
        total_attempts: Number(row.total_attempts ?? 0),
        succeeded_attempts: Number(row.succeeded_attempts ?? 0),
        failed_attempts: Number(row.failed_attempts ?? 0),
        unavailable_attempts: Number(row.unavailable_attempts ?? 0),
        timeout_attempts: Number(row.timeout_attempts ?? 0),
        lineage_mismatch_attempts: Number(row.lineage_mismatch_attempts ?? 0),
        total_decisions: Number(row.total_decisions ?? 0),
        last_attempt_at: row.last_attempt_at ? new Date(String(row.last_attempt_at)).toISOString() : null,
      };
    };

    const readChampion = async () => {
      const empty = {
        status: 'unavailable' as const,
        model_version: null,
        training_run_id: null,
        feature_contract_version: null,
      };
      if (!championOrigin) return empty;
      try {
        const res = await axios.get(new URL('/api/v1/model-info', championOrigin).toString(), {
          timeout: 2_000, maxRedirects: 0, maxContentLength: 131_072,
        });
        const meta = res.data?.metadata;
        const mv = safeId(meta?.model_version);
        const tr = safeId(meta?.training_run_id);
        const fc = safeId(meta?.feature_contract?.version);
        if (res.data?.status !== 'ready' || !mv || !tr || !fc) return empty;
        return {
          status: 'ready' as const,
          model_version: mv,
          training_run_id: tr,
          feature_contract_version: fc,
        };
      } catch {
        return empty;
      }
    };

    const readChallenger = async () => {
      const empty = (reasonVi: string) => ({
        status: 'unavailable' as const,
        lifecycle_stage: null,
        model_version: null,
        training_run_id: null,
        feature_contract_version: null,
        reason_vi: reasonVi,
      });
      if (!challengerOrigin) {
        return empty('AI Shadow Optimizer URL chưa được cấu hình.');
      }
      try {
        const res = await axios.get(new URL('/api/v1/conversion-model-info', challengerOrigin).toString(), {
          timeout: 2_000, maxRedirects: 0, maxContentLength: 131_072,
        });
        const meta = res.data?.metadata;
        const mv = safeId(meta?.model_version);
        const tr = safeId(meta?.training_run_id);
        const fc = safeId(meta?.feature_contract?.version);
        if (res.data?.status !== 'ready' || meta?.lifecycle_stage !== 'shadow_only' || !mv || !tr || !fc) {
          return empty('Metadata của Conversion Challenger chưa đạt chuẩn shadow_only.');
        }
        return {
          status: 'ready' as const,
          lifecycle_stage: 'shadow_only' as const,
          model_version: mv,
          training_run_id: tr,
          feature_contract_version: fc,
          reason_vi: 'Conversion Challenger sẵn sàng chạy song song ở chế độ quan sát shadow_only.',
        };
      } catch (error) {
        const code = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (code === 503) {
          return empty('Chưa có artifact conversion_challenger đạt cổng dữ liệu thật (503 có kiểm soát); hệ thống vẫn phục vụ Champion fail-open.');
        }
        return empty('Không thể kết nối điểm cuối /api/v1/conversion-model-info; hệ thống giữ nguyên Champion fail-open.');
      }
    };

    const [attemptSummary, championArtifact, challengerArtifact] = await Promise.all([
      readStats(),
      readChampion(),
      readChallenger(),
    ]);

    return {
      mode: 'shadow_only',
      automatic_promotion: false,
      causality_warning:
        'Mô hình Conversion Challenger chỉ học tương quan quan sát từ các báo giá đã xác nhận hiển thị (quote.exposed.v1). Hệ số giá chào không phải độ co giãn cầu nhân quả (price elasticity) và TUYỆT ĐỐI KHÔNG tự động nâng cấp mô hình khi chưa có thử nghiệm đối chứng.',
      champion_artifact: championArtifact,
      challenger_artifact: challengerArtifact,
      attempt_summary: attemptSummary,
    };
  }

  private async selectSetting(
    runner: DataSource | EntityManager,
    lock = false,
  ): Promise<ShadowSettingRow> {
    const rows = await runner.query(
      `${this.settingColumns('setting')}
       FROM ai_pricing_shadow_settings setting
       WHERE setting.setting_id = 1${lock ? ' FOR UPDATE' : ''}`,
    ) as ShadowSettingRow[];
    if (!rows[0]) {
      throw new InternalServerErrorException('Thiếu cấu hình AI shadow mặc định.');
    }
    return rows[0];
  }

  private settingColumns(alias: string): string {
    return `SELECT ${alias}.setting_id,
                   ${alias}.shadow_enabled,
                   ${alias}.champion_model_version,
                   ${alias}.champion_training_run_id,
                   ${alias}.champion_feature_contract_version,
                   ${alias}.challenger_model_version,
                   ${alias}.challenger_training_run_id,
                   ${alias}.challenger_feature_contract_version,
                   ${alias}.guardrail_min_multiplier,
                   ${alias}.guardrail_max_multiplier,
                   ${alias}.guardrail_max_change_ratio,
                   ${alias}.minimum_confirmed_exposures,
                   ${alias}.minimum_conversions,
                   ${alias}.minimum_non_conversions,
                   ${alias}.minimum_shadow_days,
                   ${alias}.minimum_inference_coverage_ratio,
                   ${alias}.maximum_inference_error_ratio,
                   ${alias}.version,
                   ${alias}.${alias === 'audit' ? 'changed_at' : 'updated_at'} AS updated_at,
                   ${alias}.${alias === 'audit' ? 'changed_by' : 'updated_by'} AS updated_by`;
  }

  private assertExpectedVersion(current: ShadowSettingRow, expected: number): void {
    if (Number(current.version) !== expected) {
      throw new ConflictException(
        'Shadow policy đã được quản trị viên khác cập nhật. Hãy tải lại dữ liệu.',
      );
    }
  }

  private merge(
    current: ShadowSettingRow,
    dto: UpdateAiShadowSettingDto,
  ): ShadowSettingRow {
    const value = <K extends keyof UpdateAiShadowSettingDto>(
      key: K,
      fallback: ShadowSettingRow[keyof ShadowSettingRow],
    ) => dto[key] === undefined ? fallback : dto[key] as never;
    return {
      ...current,
      shadow_enabled: value('shadow_enabled', current.shadow_enabled) as boolean,
      champion_model_version: value(
        'champion_model_version', current.champion_model_version,
      ) as NullableLineage,
      champion_training_run_id: value(
        'champion_training_run_id', current.champion_training_run_id,
      ) as NullableLineage,
      champion_feature_contract_version: value(
        'champion_feature_contract_version', current.champion_feature_contract_version,
      ) as NullableLineage,
      challenger_model_version: value(
        'challenger_model_version', current.challenger_model_version,
      ) as NullableLineage,
      challenger_training_run_id: value(
        'challenger_training_run_id', current.challenger_training_run_id,
      ) as NullableLineage,
      challenger_feature_contract_version: value(
        'challenger_feature_contract_version', current.challenger_feature_contract_version,
      ) as NullableLineage,
      guardrail_min_multiplier: value(
        'guardrail_min_multiplier', current.guardrail_min_multiplier,
      ) as number,
      guardrail_max_multiplier: value(
        'guardrail_max_multiplier', current.guardrail_max_multiplier,
      ) as number,
      guardrail_max_change_ratio: value(
        'guardrail_max_change_ratio', current.guardrail_max_change_ratio,
      ) as number,
      minimum_confirmed_exposures: value(
        'minimum_confirmed_exposures', current.minimum_confirmed_exposures,
      ) as number,
      minimum_conversions: value(
        'minimum_conversions', current.minimum_conversions,
      ) as number,
      minimum_non_conversions: value(
        'minimum_non_conversions', current.minimum_non_conversions,
      ) as number,
      minimum_shadow_days: value(
        'minimum_shadow_days', current.minimum_shadow_days,
      ) as number,
      minimum_inference_coverage_ratio: value(
        'minimum_inference_coverage_ratio', current.minimum_inference_coverage_ratio,
      ) as number,
      maximum_inference_error_ratio: value(
        'maximum_inference_error_ratio', current.maximum_inference_error_ratio,
      ) as number,
    };
  }

  private validate(setting: ShadowSettingRow): void {
    const champion = [
      setting.champion_model_version,
      setting.champion_training_run_id,
      setting.champion_feature_contract_version,
    ];
    const challenger = [
      setting.challenger_model_version,
      setting.challenger_training_run_id,
      setting.challenger_feature_contract_version,
    ];
    const completeOrEmpty = (values: NullableLineage[]) => (
      values.every((item) => item === null)
      || values.every((item) => typeof item === 'string' && item.trim().length > 0)
    );
    if (!completeOrEmpty(champion) || !completeOrEmpty(challenger)) {
      throw new BadRequestException('Mỗi model lineage phải đầy đủ hoặc để trống toàn bộ.');
    }
    if (setting.shadow_enabled && (champion[0] === null || challenger[0] === null)) {
      throw new BadRequestException('Phải cấu hình đủ champion và challenger trước khi bật shadow.');
    }
    if (Number(setting.guardrail_min_multiplier) > Number(setting.guardrail_max_multiplier)) {
      throw new BadRequestException('Guardrail minimum không được lớn hơn maximum.');
    }
    if (
      Number(setting.minimum_conversions) + Number(setting.minimum_non_conversions)
        > Number(setting.minimum_confirmed_exposures)
    ) {
      throw new BadRequestException(
        'Tổng positive/negative tối thiểu không được vượt confirmed exposures tối thiểu.',
      );
    }
  }

  private async applySetting(
    manager: EntityManager,
    setting: ShadowSettingRow,
    actorId: string,
    reason: string,
  ): Promise<ShadowSettingRow> {
    await manager.query(
      `SELECT set_config('hotelai.ai_shadow_change_reason', $1, TRUE)`,
      [reason.trim()],
    );
    const rows = await manager.query(
      `WITH updated_setting AS (
         UPDATE ai_pricing_shadow_settings
         SET shadow_enabled = $1,
             champion_model_version = $2,
             champion_training_run_id = $3,
             champion_feature_contract_version = $4,
             challenger_model_version = $5,
             challenger_training_run_id = $6,
             challenger_feature_contract_version = $7,
             guardrail_min_multiplier = $8,
             guardrail_max_multiplier = $9,
             guardrail_max_change_ratio = $10,
             minimum_confirmed_exposures = $11,
             minimum_conversions = $12,
             minimum_non_conversions = $13,
             minimum_shadow_days = $14,
             minimum_inference_coverage_ratio = $15,
             maximum_inference_error_ratio = $16,
             version = version + 1,
             updated_by = $17::uuid
         WHERE setting_id = 1
         RETURNING *
       )
       SELECT * FROM updated_setting`,
      [
        setting.shadow_enabled,
        setting.champion_model_version,
        setting.champion_training_run_id,
        setting.champion_feature_contract_version,
        setting.challenger_model_version,
        setting.challenger_training_run_id,
        setting.challenger_feature_contract_version,
        Number(setting.guardrail_min_multiplier),
        Number(setting.guardrail_max_multiplier),
        Number(setting.guardrail_max_change_ratio),
        Number(setting.minimum_confirmed_exposures),
        Number(setting.minimum_conversions),
        Number(setting.minimum_non_conversions),
        Number(setting.minimum_shadow_days),
        Number(setting.minimum_inference_coverage_ratio),
        Number(setting.maximum_inference_error_ratio),
        actorId,
      ],
    ) as ShadowSettingRow[];
    if (!rows[0]) {
      throw new InternalServerErrorException('Không thể cập nhật AI shadow policy.');
    }
    return rows[0];
  }

  private samePolicy(left: ShadowSettingRow, right: ShadowSettingRow): boolean {
    const lineageKeys: Array<keyof ShadowSettingRow> = [
      'champion_model_version',
      'champion_training_run_id',
      'champion_feature_contract_version',
      'challenger_model_version',
      'challenger_training_run_id',
      'challenger_feature_contract_version',
    ];
    const numericKeys: Array<keyof ShadowSettingRow> = [
      'guardrail_min_multiplier',
      'guardrail_max_multiplier',
      'guardrail_max_change_ratio',
      'minimum_confirmed_exposures',
      'minimum_conversions',
      'minimum_non_conversions',
      'minimum_shadow_days',
      'minimum_inference_coverage_ratio',
      'maximum_inference_error_ratio',
    ];
    const leftEnabled = left.shadow_enabled === true || String(left.shadow_enabled) === 'true';
    const rightEnabled = right.shadow_enabled === true || String(right.shadow_enabled) === 'true';
    return leftEnabled === rightEnabled
      && lineageKeys.every((key) => left[key] === right[key])
      && numericKeys.every((key) => {
        const leftNumber = Number(left[key]);
        const rightNumber = Number(right[key]);
        return Number.isFinite(leftNumber)
          && Number.isFinite(rightNumber)
          && leftNumber === rightNumber;
      });
  }

  private mapSetting(row: ShadowSettingRow): AiShadowSettingView {
    return {
      shadow_enabled: row.shadow_enabled === true || String(row.shadow_enabled) === 'true',
      champion: {
        model_version: row.champion_model_version,
        training_run_id: row.champion_training_run_id,
        feature_contract_version: row.champion_feature_contract_version,
      },
      challenger: {
        model_version: row.challenger_model_version,
        training_run_id: row.challenger_training_run_id,
        feature_contract_version: row.challenger_feature_contract_version,
      },
      guardrails: {
        minimum_multiplier: Number(row.guardrail_min_multiplier),
        maximum_multiplier: Number(row.guardrail_max_multiplier),
        maximum_change_ratio_from_champion: Number(row.guardrail_max_change_ratio),
      },
      readiness_gates: {
        minimum_confirmed_exposures: Number(row.minimum_confirmed_exposures),
        minimum_conversions: Number(row.minimum_conversions),
        minimum_non_conversions: Number(row.minimum_non_conversions),
        minimum_shadow_days: Number(row.minimum_shadow_days),
        minimum_inference_coverage_ratio: Number(row.minimum_inference_coverage_ratio),
        maximum_inference_error_ratio: Number(row.maximum_inference_error_ratio),
      },
      version: Number(row.version),
      updated_at: new Date(row.updated_at).toISOString(),
      updated_by: row.updated_by,
      mode: 'shadow_only',
      automatic_promotion: false,
    };
  }

  private normalizeReadiness(row: Record<string, unknown>): Record<string, unknown> {
    return this.normalizeNumbers(row);
  }

  private normalizeNumbers(row: Record<string, unknown>): Record<string, unknown> {
    const numericKeys = new Set([
      'control_version', 'version', 'guardrail_min_multiplier',
      'guardrail_max_multiplier', 'guardrail_max_change_ratio',
      'minimum_confirmed_exposures', 'minimum_conversions',
      'minimum_non_conversions', 'minimum_shadow_days',
      'minimum_inference_coverage_ratio', 'maximum_inference_error_ratio',
      'total_opportunity_quotes', 'total_attempts', 'in_window_attempts',
      'out_of_window_attempts', 'succeeded_attempts',
      'succeeded_attempts_with_decisions', 'orphan_succeeded_attempts',
      'failed_attempts', 'lineage_mismatch_attempts', 'inference_coverage_ratio',
      'inference_error_ratio', 'total_decisions', 'shadow_observation_days',
      'confirmed_exposure_decisions', 'matured_labeled_decisions',
      'eligible_matured_decisions', 'accepted_decisions', 'non_accepted_decisions',
      'excluded_data_quality_decisions', 'guardrail_adjusted_decisions',
      'mean_absolute_multiplier_delta', 'conversion_brier_score',
    ]);
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        numericKeys.has(key) && value !== null ? Number(value) : value,
      ]),
    );
  }
}
