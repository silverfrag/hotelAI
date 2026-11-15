import { apiBaseUrl } from '@/services/axiosClient';
import { ADMIN_ACCESS_DENIED_EVENT, AdminApiError } from '@/services/admin.service';
import { clearSession } from '@/services/auth.service';
import {
  type CoreApiErrorMetadata,
  invalidCoreResponseError,
  parseCoreResponse,
} from '@/services/core-api';
import type {
  AiMaturityData,
  HourlySignalsData,
  IntradaySimulationResult,
  PricingIntelligence,
  PricingIntelligenceQuery,
} from '@/types/pricing-intelligence.type';

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const nullableText = (value: unknown) => value === null || isText(value);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const dateOnly = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const createError = (message: string, status: number, metadata: CoreApiErrorMetadata) => (
  new AdminApiError(message, status, metadata)
);

function validIntelligence(value: unknown, query: PricingIntelligenceQuery): value is PricingIntelligence {
  if (!isRecord(value) || !isRecord(value.period) || !isRecord(value.model)
    || !isRecord(value.forecast) || !Array.isArray(value.daily_inventory)) return false;
  const { period, model, forecast } = value;
  if (!isText(value.generated_at) || !Number.isFinite(Date.parse(value.generated_at))
    || !isText(value.timezone)) return false;
  try { new Intl.DateTimeFormat('vi-VN', { timeZone: value.timezone }); } catch { return false; }
  if (!dateOnly(period.start_date) || !dateOnly(period.end_date)
    || !isCount(period.days) || period.days < 1 || period.days > 30
    || period.days !== (query.days ?? 14)
    || (query.start_date !== undefined && query.start_date !== period.start_date)
    || Date.parse(period.end_date) - Date.parse(period.start_date) !== period.days * 86400000) return false;
  if (!['ready', 'unavailable'].includes(String(model.status))
    || !nullableText(model.version) || !nullableText(model.feature_contract_version) || !nullableText(model.training_run_id)
    || !['historical_adr_benchmark', 'unverified'].includes(String(model.scope))
    || model.vietnam_validated !== false
    || forecast.status !== 'not_available' || !isText(forecast.reason)
    || !Array.isArray(value.notes) || !value.notes.every(isText)) return false;

  const datesByType = new Map<number, Set<string>>();
  const typeNames = new Map<number, string>();
  for (const row of value.daily_inventory) {
    if (!isRecord(row) || !dateOnly(row.stay_date) || row.stay_date < period.start_date || row.stay_date >= period.end_date
      || !isCount(row.room_type_id) || row.room_type_id < 1 || !isText(row.room_type_name)
      || !['sellable_rooms', 'confirmed_rooms', 'held_rooms', 'operationally_blocked_rooms', 'available_rooms']
        .every(key => isCount(row[key]))) return false;
    if (Number(row.sellable_rooms) !== Number(row.confirmed_rooms) + Number(row.held_rooms)
      + Number(row.operationally_blocked_rooms) + Number(row.available_rooms)) return false;
    const dates = datesByType.get(row.room_type_id) ?? new Set<string>();
    if (dates.has(row.stay_date) || (typeNames.has(row.room_type_id) && typeNames.get(row.room_type_id) !== row.room_type_name)) return false;
    dates.add(row.stay_date);
    datesByType.set(row.room_type_id, dates);
    typeNames.set(row.room_type_id, row.room_type_name);
  }
  // Missing nights must not silently look like zero demand in the timeline.
  return [...datesByType.values()].every(dates => dates.size === period.days);
}

export async function getPricingIntelligence(
  _sessionMarker: string,
  query: PricingIntelligenceQuery = {},
): Promise<PricingIntelligence> {
  const params = new URLSearchParams({ days: String(query.days ?? 14) });
  if (query.start_date) params.set('start_date', query.start_date);
  const response = await fetch(`${apiBaseUrl}/admin/pricing/intelligence?${params}`, {
    credentials: 'include',
    cache: 'no-store',
    signal: query.signal,
  });
  // A response belonging to a disposed session cannot invalidate a newer login.
  if (query.signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
  if (response.status === 401) clearSession();
  if (response.status === 403 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ADMIN_ACCESS_DENIED_EVENT));
  }
  const payload = await parseCoreResponse<{ status: string; data: unknown }>(response, {
    fallbackMessage: response.status === 401 ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
      : response.status === 403 ? 'Tài khoản không có quyền xem dữ liệu định giá.'
        : 'Không thể tải dữ liệu điều hành AI. Vui lòng thử lại.',
    createError,
  });
  if (payload?.status !== 'success' || !validIntelligence(payload.data, query)) {
    throw invalidCoreResponseError(response, 'Dữ liệu điều hành AI chưa hợp lệ. Vui lòng tải lại.', payload, createError);
  }
  return payload.data;
}

export async function getAiMaturity(
  _sessionMarker: string,
  signal?: AbortSignal,
): Promise<AiMaturityData | null> {
  try {
    const response = await fetch(`${apiBaseUrl}/admin/pricing/maturity`, {
      credentials: 'include',
      cache: 'no-store',
      signal,
    });
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    if (response.status === 401) clearSession();
    if (response.status === 403 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(ADMIN_ACCESS_DENIED_EVENT));
    }
    const payload = await parseCoreResponse<{ status: string; data: AiMaturityData }>(response, {
      fallbackMessage: 'Không thể tải dữ liệu tiến trình trưởng thành AI.',
      createError,
    });
    if (payload?.status === 'success' && payload.data && payload.data.stage) {
      return payload.data;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getHourlySignals(signal?: AbortSignal): Promise<HourlySignalsData | null> {
  try {
    const response = await fetch(`${apiBaseUrl}/admin/pricing/hourly-signals`, {
      credentials: 'include',
      cache: 'no-store',
      signal,
    });
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    if (response.status === 401) clearSession();
    if (response.status === 403 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(ADMIN_ACCESS_DENIED_EVENT));
    }
    const payload = await parseCoreResponse<{ status: string; data: HourlySignalsData }>(response, {
      fallbackMessage: 'Không thể tải tín hiệu định giá theo giờ thời gian thực.',
      createError,
    });
    if (payload?.status === 'success' && payload.data) {
      return payload.data;
    }
    return null;
  } catch {
    return null;
  }
}

export async function simulateHourlyCurve(
  dto: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<IntradaySimulationResult | null> {
  try {
    const response = await fetch(`${apiBaseUrl}/admin/pricing/simulate-hourly-curve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(dto),
      cache: 'no-store',
      signal,
    });
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    if (response.status === 401) clearSession();
    if (response.status === 403 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(ADMIN_ACCESS_DENIED_EVENT));
    }
    const payload = await parseCoreResponse<{ status: string; data: IntradaySimulationResult }>(response, {
      fallbackMessage: 'Không thể thực hiện mô phỏng đường cong giá theo giờ.',
      createError,
    });
    if (payload?.status === 'success' && payload.data) {
      return payload.data;
    }
    return null;
  } catch {
    return null;
  }
}

