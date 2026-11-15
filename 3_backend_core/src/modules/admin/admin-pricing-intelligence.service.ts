import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DataSource } from 'typeorm';
import {
  AdminDriftMonitoringView,
  AdminExplainSampleView,
  DriftMonitoringQueryDto,
  ExplainPricingSampleDto,
  FeatureDriftItemView,
  PricingIntelligenceQueryDto,
  PricingIntelligenceView,
  UncertaintyIntervalView,
} from './dto/pricing-intelligence.dto';

// Each row starts from one physical room on one stay night. EXISTS prevents a
// duplicated booking detail (or overlapping holds) from inflating inventory.
const DAILY_INVENTORY_SQL = `
  WITH requested_days AS (
    SELECT ($1::date + day_offset)::date AS stay_date
    FROM generate_series(0, $2::integer - 1) AS day_offset
  ), room_days AS (
    SELECT day.stay_date, room_type.type_id, room_type.name,
           room.room_id, room.current_status, room.housekeeping_status,
           room.occupancy_booking_id,
           EXISTS (
             SELECT 1 FROM booking_details detail
             INNER JOIN bookings booking ON booking.booking_id = detail.booking_id
             WHERE detail.room_id = room.room_id
               AND booking.status IN ('Confirmed', 'CheckedIn')
               AND booking.check_in_date <= day.stay_date
               AND booking.check_out_date > day.stay_date
           ) AS is_confirmed,
           EXISTS (
             SELECT 1 FROM booking_details detail
             INNER JOIN bookings booking ON booking.booking_id = detail.booking_id
             WHERE detail.room_id = room.room_id
               AND booking.status = 'Pending'
               AND booking.pending_expires_at > $4::timestamptz
               AND booking.check_in_date <= day.stay_date
               AND booking.check_out_date > day.stay_date
           ) AS is_held
    FROM requested_days day
    CROSS JOIN room_types room_type
    LEFT JOIN rooms room ON room.type_id = room_type.type_id
      AND room.current_status <> 'Maintenance'
  ), classified_rooms AS (
    SELECT *, CASE
      WHEN room_id IS NULL THEN NULL
      WHEN is_confirmed THEN 'confirmed'
      WHEN is_held THEN 'held'
      WHEN stay_date = $3::date AND (
        current_status <> 'Available'
        OR occupancy_booking_id IS NOT NULL
        OR housekeeping_status <> 'Ready'
      ) THEN 'operationally_blocked'
      ELSE 'available'
    END AS inventory_state
    FROM room_days
  )
  SELECT stay_date::text, type_id AS room_type_id, name AS room_type_name,
         COUNT(room_id)::integer AS sellable_rooms,
         COUNT(*) FILTER (WHERE inventory_state = 'confirmed')::integer AS confirmed_rooms,
         COUNT(*) FILTER (WHERE inventory_state = 'held')::integer AS held_rooms,
         COUNT(*) FILTER (WHERE inventory_state = 'operationally_blocked')::integer AS operationally_blocked_rooms,
         COUNT(*) FILTER (WHERE inventory_state = 'available')::integer AS available_rooms
  FROM classified_rooms
  GROUP BY stay_date, type_id, name
  ORDER BY stay_date, type_id`;

@Injectable()
export class AdminPricingIntelligenceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async getIntelligence(query: PricingIntelligenceQueryDto): Promise<PricingIntelligenceView> {
    const now = new Date();
    const timezone = this.configService.get<string>('HOTEL_TIMEZONE', 'Asia/Ho_Chi_Minh');
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const dateParts = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    const businessDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
    const startDate = query.start_date ?? businessDate;
    const days = query.days ?? 14;
    const startTime = Date.parse(`${startDate}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)
      || !Number.isFinite(startTime)
      || new Date(startTime).toISOString().slice(0, 10) !== startDate) {
      throw new BadRequestException('Ngày bắt đầu không hợp lệ.');
    }
    if (!Number.isInteger(days) || days < 1 || days > 30) {
      throw new BadRequestException('Số ngày phải là số nguyên từ 1 đến 30.');
    }
    if (startDate < businessDate) {
      throw new BadRequestException('Chỉ xem tồn phòng từ hôm nay; dữ liệu này không tái dựng công suất quá khứ.');
    }
    const endDate = new Date(startTime + days * 86_400_000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new BadRequestException('Khoảng ngày không hợp lệ.');
    }
    const generatedAt = now.toISOString();
    const [rows, model] = await Promise.all([
      this.dataSource.query(DAILY_INVENTORY_SQL, [startDate, days, businessDate, generatedAt]),
      this.readModelStatus(),
    ]);

    return {
      generated_at: generatedAt,
      timezone,
      period: { start_date: startDate, end_date: endDate, days },
      model,
      daily_inventory: rows.map((row: Record<string, unknown>) => ({
        stay_date: String(row.stay_date),
        room_type_id: Number(row.room_type_id),
        room_type_name: String(row.room_type_name),
        sellable_rooms: Number(row.sellable_rooms),
        confirmed_rooms: Number(row.confirmed_rooms),
        held_rooms: Number(row.held_rooms),
        operationally_blocked_rooms: Number(row.operationally_blocked_rooms),
        available_rooms: Number(row.available_rooms),
      })),
      forecast: {
        status: 'not_available',
        reason: 'Chưa có mô hình dự báo nhu cầu được kiểm định cho khách sạn Việt Nam; tồn phòng hiện tại không phải dự báo lượng khách.',
      },
      notes: [
        'Mỗi dòng là trạng thái hiện tại cho một loại phòng và một đêm lưu trú; ngày trả phòng không chiếm phòng đêm đó.',
        'Sức chứa có thể bán loại trừ phòng đang Maintenance trên toàn khoảng xem, theo chính sách đặt phòng hiện tại; chưa có lịch kết thúc bảo trì.',
        'Phòng đã xác nhận gồm Confirmed và CheckedIn. Giữ chỗ chỉ gồm Pending chưa hết hạn tại thời điểm cập nhật.',
        'Chặn vận hành chỉ tính thêm phòng chưa được đặt hoặc giữ nhưng chưa sẵn sàng đón khách hôm nay. Trạng thái dọn phòng hiện tại không được kéo dài sang ngày tương lai.',
        'Phòng còn bán = sức chứa có thể bán − đã xác nhận − đang giữ − chặn vận hành. Đây là ảnh chụp tồn phòng, không bảo đảm còn phòng lúc đặt.',
        'Model V2 là benchmark giá ADR lịch sử từ dữ liệu ngoài Việt Nam; trạng thái sẵn sàng không xác nhận độ chính xác tại Việt Nam.',
      ],
    };
  }

  private resolveAiOrigin(): string | null {
    try {
      const configuredUrl = this.configService.get<string>('AI_SERVICE_URL');
      if (!configuredUrl) return null;
      const origin = new URL(configuredUrl);
      if (!['http:', 'https:'].includes(origin.protocol)) return null;
      return origin.origin;
    } catch {
      return null;
    }
  }

  async getDriftMonitoring(query: DriftMonitoringQueryDto): Promise<AdminDriftMonitoringView> {
    const rawLimit = Number(query?.sample_size ?? 500);
    const sampleLimit = Number.isInteger(rawLimit)
      ? Math.min(2000, Math.max(10, rawLimit))
      : 500;

    const [countRows, quoteRows] = await Promise.all([
      this.dataSource.query(
        'SELECT COUNT(*)::int AS total_quotes FROM pricing_quotes',
      ) as Promise<Array<{ total_quotes: number | string }>>,
      this.dataSource.query(
        `SELECT lead_time,
                (check_out_date - check_in_date)::int AS stay_nights,
                guest_count,
                occupancy_ratio_snapshot::float AS occupancy_ratio,
                (
                  SELECT COUNT(*)::float
                  FROM generate_series(
                    check_in_date,
                    check_out_date - INTERVAL '1 day',
                    INTERVAL '1 day'
                  ) AS d
                  WHERE EXTRACT(ISODOW FROM d) IN (6, 7)
                ) / GREATEST(1, (check_out_date - check_in_date))::float AS weekend_share
         FROM pricing_quotes
         ORDER BY created_at DESC, quote_id DESC
         LIMIT $1`,
        [sampleLimit],
      ) as Promise<Array<{
        lead_time: number | string | null;
        stay_nights: number | string | null;
        guest_count: number | string | null;
        occupancy_ratio: number | string | null;
        weekend_share: number | string | null;
      }>>,
    ]);

    const totalQuotesInDb = Number(countRows[0]?.total_quotes ?? 0);
    const sampleCount = quoteRows.length;
    const observationSource: AdminDriftMonitoringView['observation_source'] = sampleCount >= 10
      ? 'live_pricing_quotes'
      : 'baseline_diagnostic_sample';

    const emptyFailure = (noteVi: string): AdminDriftMonitoringView => ({
      status: 'unavailable',
      observation_source: observationSource,
      baseline_source: 'unavailable',
      sample_count: sampleCount,
      total_quotes_in_db: totalQuotesInDb,
      assessed_at: new Date().toISOString(),
      overall_status: null,
      total_features_monitored: 0,
      features_with_drift: 0,
      features_with_warning: 0,
      reports: [],
      recommendations: [],
      note_vi: noteVi,
    });

    const origin = this.resolveAiOrigin();
    if (!origin) {
      return emptyFailure('AI Pricing Service chưa được cấu hình URL hợp lệ để kiểm tra drift.');
    }

    const toSeries = (key: 'lead_time' | 'stay_nights' | 'guest_count' | 'weekend_share' | 'occupancy_ratio') =>
      quoteRows
        .map((row) => (row[key] === null ? Number.NaN : Number(row[key])))
        .filter((val) => Number.isFinite(val));

    try {
      let responseData: Record<string, unknown>;
      if (observationSource === 'live_pricing_quotes') {
        const observations: Record<string, number[]> = {
          lead_time: toSeries('lead_time'),
          stay_nights: toSeries('stay_nights'),
          guest_count: toSeries('guest_count'),
          weekend_share: toSeries('weekend_share'),
        };
        const occSeries = toSeries('occupancy_ratio');
        if (occSeries.length >= 10) {
          observations.occupancy_ratio = occSeries;
        }
        const response = await axios.post(
          new URL('/api/v1/monitoring/evaluate-drift', origin).toString(),
          { observations },
          { timeout: 3_000, maxRedirects: 0, maxContentLength: 262_144 },
        );
        responseData = (response.data ?? {}) as Record<string, unknown>;
      } else {
        const response = await axios.get(
          new URL('/api/v1/monitoring/drift', origin).toString(),
          { timeout: 3_000, maxRedirects: 0, maxContentLength: 262_144 },
        );
        responseData = (response.data ?? {}) as Record<string, unknown>;
      }

      if (responseData.status !== 'success' || !Array.isArray(responseData.reports)) {
        return emptyFailure('Dịch vụ AI trả về phản hồi kiểm tra drift chưa hợp lệ.');
      }

      const reports: FeatureDriftItemView[] = responseData.reports
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item) => ({
          feature: String(item.feature ?? ''),
          psi: Number(item.psi ?? 0),
          status: (['stable', 'warning', 'drift_detected'].includes(String(item.status))
            ? String(item.status)
            : 'warning') as FeatureDriftItemView['status'],
          baseline_mean: Number(item.baseline_mean ?? 0),
          current_mean: Number(item.current_mean ?? 0),
          baseline_std: Number(item.baseline_std ?? 0),
          current_std: Number(item.current_std ?? 0),
          ks_stat: Number(item.ks_stat ?? 0),
          ks_pvalue: Number(item.ks_pvalue ?? 1),
          wasserstein_distance: Number(item.wasserstein_distance ?? 0),
          baseline_median: Number(item.baseline_median ?? item.baseline_mean ?? 0),
          current_median: Number(item.current_median ?? item.current_mean ?? 0),
          baseline_rows: Number(item.baseline_rows ?? 0),
          baseline_source: String(item.baseline_source ?? responseData.baseline_source ?? 'portugal_v2_training_empirical'),
        }));

      const baselineSource = typeof responseData.baseline_source === 'string'
        ? responseData.baseline_source
        : 'portugal_v2_training_empirical';

      const overallRaw = String(responseData.overall_status ?? '');
      const overallStatus = (['healthy', 'degraded', 'drift_alert'].includes(overallRaw)
        ? overallRaw
        : 'degraded') as AdminDriftMonitoringView['overall_status'];

      return {
        status: 'ready',
        observation_source: observationSource,
        baseline_source: baselineSource,
        sample_count: sampleCount,
        total_quotes_in_db: totalQuotesInDb,
        assessed_at: typeof responseData.assessed_at === 'string'
          ? responseData.assessed_at
          : new Date().toISOString(),
        overall_status: overallStatus,
        total_features_monitored: Number(responseData.total_features_monitored ?? reports.length),
        features_with_drift: Number(responseData.features_with_drift ?? 0),
        features_with_warning: Number(responseData.features_with_warning ?? 0),
        reports,
        recommendations: Array.isArray(responseData.recommendations)
          ? responseData.recommendations.map((item) => String(item))
          : [],
        note_vi: observationSource === 'live_pricing_quotes'
          ? `Đánh giá PSI, Kolmogorov-Smirnov (KS) và khoảng cách Wasserstein-1 trên ${sampleCount} báo giá gần nhất trong PostgreSQL so với phân phối thực nghiệm lúc huấn luyện RF V2 (Portugal, n = 36,090). PSI ≥ 0.25 phản ánh khác biệt hành vi đặt phòng giữa Đà Nẵng và Bồ Đào Nha 2015–2017.`
          : 'CSDL hiện có dưới 10 báo giá; hệ thống đang hiển thị mẫu chẩn đoán mặc định đối chiếu phân phối thực nghiệm Portugal V2.',
      };
    } catch {
      return emptyFailure('Không thể kết nối AI Monitoring endpoint; hệ thống vận hành báo giá vẫn hoạt động bình thường (fail-open).');
    }
  }

  async explainPricingSample(dto: ExplainPricingSampleDto): Promise<AdminExplainSampleView> {
    if (dto.check_out_date <= dto.check_in_date) {
      throw new BadRequestException('Ngày trả phòng phải sau ngày nhận phòng.');
    }
    const origin = this.resolveAiOrigin();
    if (!origin) {
      return {
        available: false,
        status_code: null,
        reason_vi: 'AI Service chưa được cấu hình để kiểm tra /api/v1/explain-price.',
      };
    }

    try {
      const response = await axios.post(
        new URL('/api/v1/explain-price', origin).toString(),
        {
          lead_time: dto.lead_time,
          check_in_date: dto.check_in_date,
          check_out_date: dto.check_out_date,
          guest_count: dto.guest_count,
        },
        { timeout: 3_000, maxRedirects: 0, maxContentLength: 262_144 },
      );
      const data = response.data as Record<string, unknown> | undefined;
      if (!data || data.status !== 'success' || !data.explanation) {
        return {
          available: false,
          status_code: response.status,
          reason_vi: 'Phản hồi từ /api/v1/explain-price không hợp lệ.',
        };
      }
      return {
        available: true,
        ai_multiplier: Number(data.ai_multiplier),
        model_version: String(data.model_version ?? ''),
        training_run_id: String(data.training_run_id ?? ''),
        feature_contract_version: String(data.feature_contract_version ?? ''),
        features: (data.features ?? {}) as Record<string, number>,
        uncertainty: (data.uncertainty && typeof data.uncertainty === 'object'
          ? (data.uncertainty as UncertaintyIntervalView)
          : null),
        explanation: data.explanation as Extract<AdminExplainSampleView, { available: true }>['explanation'],
      };
    } catch (error) {
      const statusCode = axios.isAxiosError(error) ? (error.response?.status ?? null) : null;
      return {
        available: false,
        status_code: statusCode,
        reason_vi: statusCode === 503
          ? 'Điểm cuối /api/v1/explain-price đang trả 503 có kiểm soát vì mô hình hiện tại chưa có cây quyết định (estimators_) được kiểm chứng.'
          : 'Không thể kết nối AI Service để lấy giải thích Saabas Tree Interpreter.',
      };
    }
  }

  private async readModelStatus(): Promise<PricingIntelligenceView['model']> {
    const unavailable: PricingIntelligenceView['model'] = {
      status: 'unavailable', version: null, feature_contract_version: null,
      training_run_id: null, scope: 'unverified', vietnam_validated: false,
    };
    try {
      const origin = this.resolveAiOrigin();
      if (!origin) return unavailable;
      const response = await axios.get(new URL('/api/v1/model-info', origin).toString(), {
        timeout: 2_000, maxRedirects: 0, maxContentLength: 131_072,
      });
      if (response.data?.status !== 'ready') return unavailable;
      const metadata = response.data?.metadata;
      const version = this.safeIdentifier(metadata?.model_version);
      const featureContract = this.safeIdentifier(metadata?.feature_contract?.version);
      const trainingRun = this.safeIdentifier(metadata?.training_run_id);
      if (!version || !featureContract || !trainingRun) return unavailable;
      return {
        status: 'ready', version, feature_contract_version: featureContract,
        training_run_id: trainingRun,
        scope: version === 'random_forest_v2' && featureContract === '2.0.0'
          ? 'historical_adr_benchmark' : 'unverified',
        vietnam_validated: false,
      };
    } catch {
      // Inventory remains useful during an AI outage. Do not return upstream
      // errors, file paths, source metadata, or service URLs to the browser.
      return unavailable;
    }
  }

  private safeIdentifier(value: unknown): string | null {
    return typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(value) ? value : null;
  }
}
