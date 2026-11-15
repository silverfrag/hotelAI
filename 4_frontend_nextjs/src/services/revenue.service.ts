import { apiBaseUrl } from '@/services/axiosClient';
import type {
  AdminAllocationQueueResponse,
  AdminCoupon,
  AdminCouponListResult,
  AdminQueueOptimizationResult,
  BanditSimulateResult,
  CreateAdminCouponInput,
  LiveAllocationResult,
  LiveRevenueContext,
  MarketPricingDecisionResult,
  MarketScenario,
  OptimizationResult,
  PortfolioOptimizeResult,
  PortfolioScenarioId,
  RevenueQuoteResult,
  ScenarioExecutionResult,
  ScenarioMetaItem,
  SimulatedCoupon,
  UpdateAdminCouponInput,
} from '@/types/revenue.type';

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  const err = await response.json().catch(() => null);
  if (err && typeof err === 'object') {
    const rawMsg = (err as { message?: unknown }).message;
    if (Array.isArray(rawMsg)) {
      return rawMsg.map(String).join('; ');
    }
    if (typeof rawMsg === 'string' && rawMsg.trim().length > 0) {
      return rawMsg;
    }
  }
  return fallback;
}

export async function getRevenueScenarios(signal?: AbortSignal): Promise<{
  scenarios: MarketScenario[];
  coupons: SimulatedCoupon[];
}> {
  const response = await fetch(`${apiBaseUrl}/revenue/scenarios`, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error('Không thể tải danh sách kịch bản thị trường.');
  const json = await response.json();
  return json.data;
}

export async function getRevenueLiveContext(
  params: {
    room_type_id: number;
    check_in_date: string;
    check_out_date: string;
    guest_count?: number;
  },
  signal?: AbortSignal,
): Promise<LiveRevenueContext> {
  const search = new URLSearchParams({
    room_type_id: String(params.room_type_id),
    check_in_date: params.check_in_date,
    check_out_date: params.check_out_date,
  });
  if (params.guest_count !== undefined) {
    search.set('guest_count', String(params.guest_count));
  }
  const response = await fetch(`${apiBaseUrl}/revenue/live-context?${search.toString()}`, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Không thể đồng bộ tồn kho & ML trực tiếp từ hệ thống.'));
  }
  const json = await response.json();
  return json.data;
}

export async function evaluateRevenueDecision(
  payload: {
    room_type_id: number;
    room_type_name?: string;
    base_price: number;
    declared_max_price?: number | null;
    check_in_date: string;
    check_out_date: string;
    guest_count: number;
    rooms_available?: number;
    rooms_total?: number;
    ml_multiplier?: number;
    scenario_id?: string;
    coupon_code?: string;
    custom_scenario?: Partial<MarketScenario>;
  },
  signal?: AbortSignal,
): Promise<RevenueQuoteResult> {
  const response = await fetch(`${apiBaseUrl}/revenue/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Không thể tính toán quyết định giá kịch bản.'));
  }
  const json = await response.json();
  return json.data;
}

export async function evaluateMarketDecision(
  payload: {
    check_in_date: string;
    guest_count?: number;
    room_type_id?: number;
    room_segment?: 'upscale_resort_standard';
    base_price?: number;
    rooms_available?: number;
    rooms_total?: number;
    serving_cost?: number;
    commission_pct?: number;
    tax_pct?: number;
    min_margin?: number;
    floor_price?: number;
    ceiling_price?: number;
  },
  signal?: AbortSignal,
): Promise<MarketPricingDecisionResult> {
  const response = await fetch(`${apiBaseUrl}/revenue/market-decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Không thể chạy thẩm định thị trường Đà Nẵng.'));
  }
  const json = await response.json();
  return json.data;
}

export async function optimizeRoomAllocation(
  payload: {
    requests: Array<{
      request_id: string;
      room_type_id: number;
      check_in_date: string;
      check_out_date: string;
      guest_count: number;
      revenue_value?: number;
      vip_priority?: number;
    }>;
    available_rooms: Array<{
      room_id: number;
      room_number: string;
      type_id: number;
      capacity: number;
      current_status?: string;
      housekeeping_status?: string;
    }>;
    existing_occupancies?: Array<{
      room_id: number;
      check_in_date: string;
      check_out_date: string;
      booking_id: string;
    }>;
    allow_upgrades?: boolean;
  },
  signal?: AbortSignal,
): Promise<OptimizationResult> {
  const response = await fetch(`${apiBaseUrl}/revenue/optimize-allocation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Không thể giải bài toán phân bổ phòng.'));
  }
  const json = await response.json();
  return json.data;
}

export async function getSandboxScenarios(signal?: AbortSignal): Promise<ScenarioMetaItem[]> {
  const response = await fetch(`${apiBaseUrl}/revenue/sandbox/scenarios`, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error('Không thể tải danh sách kịch bản sandbox.');
  const json = await response.json();
  return json.data?.scenarios ?? [];
}

export async function runSandboxScenario(
  payload: { scenario_id: string; custom_params?: Record<string, any> },
  signal?: AbortSignal,
): Promise<ScenarioExecutionResult> {
  const response = await fetch(`${apiBaseUrl}/revenue/sandbox/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Không thể chạy kịch bản sandbox.'));
  }
  const json = await response.json();
  return json.data;
}

export async function optimizeAllocationLive(
  payload: {
    requests: Array<{
      request_id: string;
      room_type_id: number;
      check_in_date: string;
      check_out_date: string;
      guest_count: number;
      revenue_value?: number;
      vip_priority?: number;
    }>;
    allow_upgrades?: boolean;
    check_in_date?: string;
    check_out_date?: string;
  },
  signal?: AbortSignal,
): Promise<LiveAllocationResult> {
  const response = await fetch(`${apiBaseUrl}/revenue/optimize-allocation-live`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Không thể chạy phân bổ phòng trực tiếp từ dữ liệu khách sạn.'));
  }
  const json = await response.json();
  return json.data;
}

export async function getAdminCoupons(signal?: AbortSignal): Promise<AdminCouponListResult> {
  const response = await fetch(`${apiBaseUrl}/admin/coupons`, {
    credentials: 'include',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Không thể tải danh sách mã giảm giá quản trị.'));
  }
  const json = await response.json();
  return {
    data: Array.isArray(json.data) ? json.data : [],
    summary: json.summary ?? { total: 0, active_count: 0, total_redemptions: 0 },
  };
}

export async function createAdminCoupon(input: CreateAdminCouponInput): Promise<AdminCoupon> {
  const response = await fetch(`${apiBaseUrl}/admin/coupons`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Không thể tạo mã giảm giá mới.'));
  }
  const json = await response.json();
  return json.data;
}

export async function updateAdminCoupon(
  code: string,
  input: UpdateAdminCouponInput,
): Promise<AdminCoupon> {
  const response = await fetch(`${apiBaseUrl}/admin/coupons/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, `Không thể cập nhật mã giảm giá ${code}.`));
  }
  const json = await response.json();
  return json.data;
}

export async function getAdminAllocationQueue(
  params?: { start_date?: string; end_date?: string },
  signal?: AbortSignal,
): Promise<AdminAllocationQueueResponse> {
  const search = new URLSearchParams();
  if (params?.start_date) search.set('start_date', params.start_date);
  if (params?.end_date) search.set('end_date', params.end_date);
  const query = search.toString();
  const response = await fetch(`${apiBaseUrl}/admin/allocations/queue${query ? `?${query}` : ''}`, {
    credentials: 'include',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Không thể tải hàng đợi booking đang chờ phân bổ phòng.'));
  }
  const json = await response.json();
  return json.data;
}

export async function optimizeAdminAllocationQueue(
  payload: {
    booking_ids?: string[];
    start_date?: string;
    end_date?: string;
    allow_upgrades?: boolean;
  },
  signal?: AbortSignal,
): Promise<AdminQueueOptimizationResult> {
  const response = await fetch(`${apiBaseUrl}/admin/allocations/optimize-queue`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Không thể giải tối ưu hàng đợi booking từ PostgreSQL.'));
  }
  const json = await response.json();
  return json.data;
}

export async function optimizePortfolioYield(
  payload: {
    start_date?: string;
    horizon_days?: number;
    scenario_id?: PortfolioScenarioId;
    price_elasticity?: number;
    allow_cross_tier_upgrades?: boolean;
    serving_cost_per_night?: number;
    channel_commission_pct?: number;
    tax_rate?: number;
    service_charge_rate?: number;
    min_contribution_margin?: number;
  },
  signal?: AbortSignal,
): Promise<PortfolioOptimizeResult> {
  const response = await fetch(`${apiBaseUrl}/revenue/portfolio-optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Không thể giải tối ưu doanh thu toàn danh mục 6 hạng phòng.'));
  }
  const json = await response.json();
  return json.data;
}

export async function simulateBanditPricing(
  payload: {
    room_type_id?: number;
    scenario_id?: PortfolioScenarioId;
    true_price_elasticity?: number;
    episodes?: number;
    seed?: number;
  },
  signal?: AbortSignal,
): Promise<BanditSimulateResult> {
  const response = await fetch(`${apiBaseUrl}/revenue/bandit-simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, 'Không thể chạy mô phỏng Guardrailed Thompson Sampling Bandit.'));
  }
  const json = await response.json();
  return json.data;
}
