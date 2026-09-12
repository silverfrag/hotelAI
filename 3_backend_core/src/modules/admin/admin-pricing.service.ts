import { ConflictException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PricingLogsQueryDto, UpdatePricingSettingDto } from './dto/pricing.dto';
import { PricingSetting } from './entities/pricing-setting.entity';

export type PricingSettingView = {
  ai_enabled: boolean;
  version: number;
  updated_at: Date;
  updated_by: string | null;
};

export type PricingLogView = {
  log_id: string;
  booking_id: string | null;
  type_id: number;
  type_name: string;
  target_date: string;
  lead_time: number | null;
  is_weekend: boolean | null;
  total_of_special_requests: number | null;
  base_price: number;
  ai_multiplier: number;
  final_price: number;
  pricing_source: 'ai' | 'base';
  settings_version: number;
  ai_enabled: boolean;
  ai_model_version: string | null;
  ai_training_run_id: string | null;
  ai_feature_contract_version: string | null;
  updated_at: Date;
};

@Injectable()
export class AdminPricingService {
  constructor(
    @InjectRepository(PricingSetting) private readonly settings: Repository<PricingSetting>,
    private readonly dataSource: DataSource,
  ) {}

  async getSetting(): Promise<PricingSettingView> {
    const setting = await this.settings.findOne({ where: { setting_id: 1 } });
    if (!setting) throw new InternalServerErrorException('Thiếu cấu hình định giá mặc định.');
    return this.mapSetting(setting);
  }

  async updateSetting(
    dto: UpdatePricingSettingDto,
    updatedBy: string,
  ): Promise<PricingSettingView> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query(
        `SELECT setting_id, ai_enabled, version, updated_at, updated_by
         FROM pricing_settings
         WHERE setting_id = 1
         FOR UPDATE`,
      );
      if (!rows.length) throw new InternalServerErrorException('Thiếu cấu hình định giá mặc định.');

      const current = rows[0] as PricingSetting;
      if (dto.expected_version !== undefined && Number(current.version) !== dto.expected_version) {
        throw new ConflictException('Cấu hình định giá đã được quản trị viên khác cập nhật. Hãy tải lại dữ liệu.');
      }

      if (current.ai_enabled === dto.ai_enabled) return this.mapSetting(current);

      const updated = await manager.query(
        `UPDATE pricing_settings
         SET ai_enabled = $1,
             version = version + 1,
             updated_at = CURRENT_TIMESTAMP,
             updated_by = $2::uuid
         WHERE setting_id = 1
         RETURNING setting_id, ai_enabled, version, updated_at, updated_by`,
        [dto.ai_enabled, updatedBy],
      );
      const updatedSetting = (Array.isArray(updated[0]) ? updated[0][0] : updated[0]) as PricingSetting;
      await manager.query(
        `INSERT INTO pricing_setting_audits
           (setting_id, ai_enabled, version, changed_at, changed_by)
         VALUES (1, $1, $2, $3, $4::uuid)`,
        [
          updatedSetting.ai_enabled,
          updatedSetting.version,
          updatedSetting.updated_at,
          updatedBy,
        ],
      );
      return this.mapSetting(updatedSetting);
    });
  }

  async listLogs(query: PricingLogsQueryDto): Promise<{
    data: PricingLogView[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const [rows, countRows] = await Promise.all([
      this.dataSource.query(
        `SELECT pricing_log.log_id,
                pricing_log.booking_id,
                pricing_log.type_id,
                pricing_log.room_type_name_snapshot AS type_name,
                pricing_log.target_date::text,
                pricing_log.lead_time,
                pricing_log.is_weekend,
                pricing_log.total_of_special_requests,
                pricing_log.base_price,
                pricing_log.ai_multiplier,
                pricing_log.final_price,
                pricing_log.pricing_source,
                pricing_log.settings_version,
                pricing_log.ai_enabled,
                pricing_log.ai_model_version,
                pricing_log.ai_training_run_id,
                pricing_log.ai_feature_contract_version,
                pricing_log.updated_at
         FROM daily_pricing_logs pricing_log
         ORDER BY pricing_log.updated_at DESC, pricing_log.log_id DESC
         LIMIT $1 OFFSET $2`,
        [query.limit, query.offset],
      ),
      this.dataSource.query('SELECT COUNT(*)::int AS total FROM daily_pricing_logs'),
    ]);

    return {
      data: rows.map((row: Record<string, unknown>) => ({
        log_id: String(row.log_id),
        booking_id: row.booking_id === null ? null : String(row.booking_id),
        type_id: Number(row.type_id),
        type_name: String(row.type_name),
        target_date: String(row.target_date),
        lead_time: row.lead_time === null ? null : Number(row.lead_time),
        is_weekend: row.is_weekend === null ? null : Boolean(row.is_weekend),
        total_of_special_requests:
          row.total_of_special_requests === null ? null : Number(row.total_of_special_requests),
        base_price: Number(row.base_price),
        ai_multiplier: Number(row.ai_multiplier),
        final_price: Number(row.final_price),
        pricing_source: row.pricing_source as 'ai' | 'base',
        settings_version: Number(row.settings_version),
        ai_enabled: Boolean(row.ai_enabled),
        ai_model_version:
          row.ai_model_version === null ? null : String(row.ai_model_version),
        ai_training_run_id:
          row.ai_training_run_id === null ? null : String(row.ai_training_run_id),
        ai_feature_contract_version:
          row.ai_feature_contract_version === null
            ? null
            : String(row.ai_feature_contract_version),
        updated_at: row.updated_at as Date,
      })),
      total: Number(countRows[0].total),
      limit: query.limit,
      offset: query.offset,
    };
  }

  private mapSetting(setting: PricingSetting): PricingSettingView {
    return {
      ai_enabled: setting.ai_enabled,
      version: Number(setting.version),
      updated_at: setting.updated_at,
      updated_by: setting.updated_by ?? null,
    };
  }
}
