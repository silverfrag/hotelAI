'use client';

import {
  Activity,
  AlertCircle,
  ArrowRight,
  Calculator,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Database,
  ExternalLink,
  FlaskConical,
  Globe,
  Layers,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Tag,
  TrendingUp,
  X,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import React, { useCallback, useEffect, useState } from 'react';
import { apiBaseUrl } from '@/services/axiosClient';
import { reassignAdminBookingRoom } from '@/services/admin.service';
import { FALLBACK_ROOM_TYPES } from '@/services/room-presentation';
import {
  createAdminCoupon,
  evaluateMarketDecision,
  evaluateRevenueDecision,
  getAdminAllocationQueue,
  getAdminCoupons,
  getRevenueLiveContext,
  getRevenueScenarios,
  getSandboxScenarios,
  optimizeAdminAllocationQueue,
  optimizeAllocationLive,
  optimizePortfolioYield,
  optimizeRoomAllocation,
  runSandboxScenario,
  updateAdminCoupon,
} from '@/services/revenue.service';
import type { RoomType } from '@/types/room.type';
import type {
  AdminAllocationQueueItem,
  AdminCoupon,
  AdminQueueOptimizationRecommendation,
  AdminQueueOptimizationResult,
  CompetitorPosition,
  DemandLevel,
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
  WeatherCondition,
} from '@/types/revenue.type';

function getVnTodayDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
}

function addDaysToIso(dateStr: string, days: number): string {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return dateStr;
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return dt.toISOString().slice(0, 10);
}

type SimulatorTab = 'pricing' | 'allocation' | 'sandbox';

function formatVND(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);
}

const PROVENANCE_BADGE_MAP: Record<string, { label: string; className: string }> = {
  '(A) ML_REAL_DATA': {
    label: '(A) ML Thật',
    className: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300',
  },
  '(B) SIMULATED_SYSTEM_STATE': {
    label: '(B) Tồn kho',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  },
  '(C) SIMULATED_ASSUMPTION': {
    label: '(C) Giả định',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  '(D) BUSINESS_RULE': {
    label: '(D) Quy tắc',
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  },
};

export function AdminRevenueSimulator() {
  const [activeTab, setActiveTab] = useState<SimulatorTab>('pricing');
  const [roomTypes, setRoomTypes] = useState<RoomType[]>(FALLBACK_ROOM_TYPES);

  // Tab 1: Pricing & Coupon state
  const [scenarios, setScenarios] = useState<MarketScenario[]>([]);
  const [coupons, setCoupons] = useState<SimulatedCoupon[]>([]);
  const [adminCoupons, setAdminCoupons] = useState<AdminCoupon[]>([]);
  const [couponAdminNotice, setCouponAdminNotice] = useState('');
  const [selectedScenarioId, setSelectedScenarioId] = useState('standard');
  const [useCustomScenario, setUseCustomScenario] = useState(false);
  const [customScenario, setCustomScenario] = useState<Omit<MarketScenario, 'provenance'>>({
    scenario_id: 'custom_admin',
    name_vi: 'Kịch bản tùy chỉnh bởi Admin',
    demand_level: 'normal',
    weather: 'sunny_favorable',
    competitor_rate_position: 'par_neutral',
    serving_cost_per_night: 350000,
    channel_commission_pct: 0,
    tax_rate: 0.08,
    service_charge_rate: 0.05,
    min_contribution_margin: 50000,
  });

  const [selectedRoomId, setSelectedRoomId] = useState<number>(FALLBACK_ROOM_TYPES[0].type_id);
  const [checkInDate, setCheckInDate] = useState(() => addDaysToIso(getVnTodayDate(), 2));
  const [checkOutDate, setCheckOutDate] = useState(() => addDaysToIso(getVnTodayDate(), 4));
  const [guestCount, setGuestCount] = useState(2);
  const [couponCode, setCouponCode] = useState('');

  // Live (A) ML & (B) DB Inventory sync
  const [liveContext, setLiveContext] = useState<LiveRevenueContext | null>(null);
  const [loadingLiveContext, setLoadingLiveContext] = useState(false);
  const [syncRealInventory, setSyncRealInventory] = useState(true);
  const [simulatedRoomsAvailable, setSimulatedRoomsAvailable] = useState<number>(
    FALLBACK_ROOM_TYPES[0].available_now,
  );
  const [mlOverrideEnabled, setMlOverrideEnabled] = useState(false);
  const [manualMlMultiplier, setManualMlMultiplier] = useState(1.0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [decision, setDecision] = useState<RevenueQuoteResult | null>(null);

  // Coupon CRUD state
  const [showCouponManager, setShowCouponManager] = useState(false);
  const [couponFormMode, setCouponFormMode] = useState<'closed' | 'create' | 'edit'>('closed');
  const [couponSubmitting, setCouponSubmitting] = useState(false);
  const [couponMutationError, setCouponMutationError] = useState('');
  const [couponMutationSuccess, setCouponMutationSuccess] = useState('');
  const [couponDraft, setCouponDraft] = useState<{
    code: string;
    description_vi: string;
    discount_pct_input: number;
    max_discount_vnd: number;
    min_room_type_id: number;
    usage_limit: number;
    active: boolean;
    expiry_date: string;
  }>({
    code: '',
    description_vi: '',
    discount_pct_input: 10,
    max_discount_vnd: 300000,
    min_room_type_id: 1,
    usage_limit: 100,
    active: true,
    expiry_date: '2027-12-31',
  });

  // Da Nang public evidence advisory (POST /revenue/market-decision)
  const [marketDecisionLoading, setMarketDecisionLoading] = useState(false);
  const [marketDecisionError, setMarketDecisionError] = useState('');
  const [marketDecision, setMarketDecision] = useState<MarketPricingDecisionResult | null>(null);
  const [marketSyncNotice, setMarketSyncNotice] = useState('');

  // Tab 2: OR-Tools Allocation (Real Queue Apply + Live DB What-If)
  const [queueStartDate, setQueueStartDate] = useState(() => getVnTodayDate());
  const [queueEndDate, setQueueEndDate] = useState(() => addDaysToIso(getVnTodayDate(), 60));
  const [queueAllowUpgrades, setQueueAllowUpgrades] = useState(true);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState('');
  const [queueNotice, setQueueNotice] = useState('');
  const [queueBusinessDate, setQueueBusinessDate] = useState('');
  const [queueItems, setQueueItems] = useState<AdminAllocationQueueItem[]>([]);
  const [queueOptimizing, setQueueOptimizing] = useState(false);
  const [queueOptResult, setQueueOptResult] = useState<AdminQueueOptimizationResult | null>(null);
  const [applyingBookingId, setApplyingBookingId] = useState<string | null>(null);
  const [applyingBatch, setApplyingBatch] = useState(false);

  const [allocatingLive, setAllocatingLive] = useState(false);
  const [liveAllocationResult, setLiveAllocationResult] = useState<LiveAllocationResult | null>(null);
  const [allowUpgrades, setAllowUpgrades] = useState(true);
  const [competingRequestCount, setCompetingRequestCount] = useState(6);
  const [allocatingWhatIf, setAllocatingWhatIf] = useState(false);
  const [whatIfAllocationResult, setWhatIfAllocationResult] = useState<OptimizationResult | null>(null);
  const [allocationError, setAllocationError] = useState('');

  // E3: OR-Tools CP-SAT Joint Multi-Night Portfolio Yield & Shadow Prices
  const [portfolioStartDate, setPortfolioStartDate] = useState(() => addDaysToIso(getVnTodayDate(), 1));
  const [portfolioHorizonDays, setPortfolioHorizonDays] = useState(5);
  const [portfolioScenarioId, setPortfolioScenarioId] = useState<PortfolioScenarioId>('weekend_high');
  const [portfolioElasticity, setPortfolioElasticity] = useState(1.15);
  const [portfolioAllowUpgrades, setPortfolioAllowUpgrades] = useState(true);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [portfolioError, setPortfolioError] = useState('');
  const [portfolioResult, setPortfolioResult] = useState<PortfolioOptimizeResult | null>(null);

  // Tab 3: Stress-Test Sandbox
  const [sandboxScenarios, setSandboxScenarios] = useState<ScenarioMetaItem[]>([]);
  const [selectedSandboxId, setSelectedSandboxId] = useState('storm_surge');
  const [runningSandbox, setRunningSandbox] = useState(false);
  const [sandboxResult, setSandboxResult] = useState<ScenarioExecutionResult | null>(null);
  const [sandboxError, setSandboxError] = useState('');

  const selectedRoom = roomTypes.find((r) => r.type_id === selectedRoomId) ?? roomTypes[0] ?? FALLBACK_ROOM_TYPES[0];
  const activeScenario = scenarios.find((s) => s.scenario_id === selectedScenarioId);

  const effectiveRoomsTotal =
    syncRealInventory && liveContext && liveContext.room_type_id === selectedRoom.type_id
      ? Math.max(1, liveContext.rooms_sellable)
      : Math.max(1, selectedRoom.total_rooms);
  const effectiveRoomsAvailable =
    syncRealInventory && liveContext && liveContext.room_type_id === selectedRoom.type_id
      ? liveContext.rooms_available
      : Math.min(simulatedRoomsAvailable, effectiveRoomsTotal);
  const effectiveMlMultiplier = mlOverrideEnabled
    ? manualMlMultiplier
    : liveContext && liveContext.room_type_id === selectedRoom.type_id
      ? liveContext.ml_multiplier
      : 1.0;

  const refreshCoupons = useCallback(async (signal?: AbortSignal) => {
    try {
      const [scenarioData, adminList] = await Promise.all([
        getRevenueScenarios(signal),
        getAdminCoupons(signal).catch((err) => {
          if (signal?.aborted) throw err;
          setCouponAdminNotice(
            err instanceof Error
              ? err.message
              : 'Cần đăng nhập quyền Admin để thêm hoặc sửa mã giảm giá trong CSDL.',
          );
          return null;
        }),
      ]);
      if (signal?.aborted) return;
      setScenarios(scenarioData.scenarios);
      setCoupons(scenarioData.coupons);
      if (adminList) {
        setAdminCoupons(adminList.data);
        setCouponAdminNotice('');
      }
    } catch (err) {
      if (!signal?.aborted) {
        setError(err instanceof Error ? err.message : 'Không thể tải kịch bản doanh thu.');
      }
    }
  }, []);

  // Load White Sand room types from backend + scenarios/coupons + sandbox list
  useEffect(() => {
    const controller = new AbortController();

    void fetch(`${apiBaseUrl}/rooms`, { signal: controller.signal, cache: 'no-store' })
      .then(async (resp) => {
        if (!resp.ok) return;
        const json = (await resp.json()) as { data?: unknown } | unknown[];
        const rawList = Array.isArray(json)
          ? json
          : Array.isArray((json as { data?: unknown }).data)
            ? (json as { data: unknown[] }).data
            : [];
        const parsed = rawList
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((item) => ({
            type_id: Number(item.type_id),
            type_name: String(item.type_name ?? item.name ?? ''),
            base_price: Number(item.base_price),
            declared_max_price:
              item.declared_max_price != null ? Number(item.declared_max_price) : null,
            capacity: Number(item.capacity ?? 2),
            total_rooms: Number(item.total_rooms ?? 6),
            available_now: Number(item.available_now ?? item.total_rooms ?? 6),
          }))
          .filter((item) => Number.isFinite(item.type_id) && item.type_name && Number.isFinite(item.base_price));

        if (parsed.length > 0 && !controller.signal.aborted) {
          setRoomTypes(parsed);
          setSelectedRoomId((prev) =>
            parsed.some((r) => r.type_id === prev) ? prev : parsed[0].type_id,
          );
        }
      })
      .catch(() => undefined);

    void refreshCoupons(controller.signal);

    void getSandboxScenarios(controller.signal)
      .then((list) => {
        if (!controller.signal.aborted && list.length > 0) {
          setSandboxScenarios(list);
          setSelectedSandboxId((prev) => (list.some((s) => s.id === prev) ? prev : list[0].id));
        }
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [refreshCoupons]);

  // Keep custom_scenario baseline aligned when preset changes and custom editor is closed
  useEffect(() => {
    if (!activeScenario || useCustomScenario) return;
    setCustomScenario({
      scenario_id: `custom_${activeScenario.scenario_id}`,
      name_vi: `Tùy chỉnh (${activeScenario.name_vi})`,
      demand_level: activeScenario.demand_level,
      weather: activeScenario.weather,
      competitor_rate_position: activeScenario.competitor_rate_position,
      serving_cost_per_night: activeScenario.serving_cost_per_night,
      channel_commission_pct: activeScenario.channel_commission_pct,
      tax_rate: activeScenario.tax_rate,
      service_charge_rate: activeScenario.service_charge_rate,
      min_contribution_margin: activeScenario.min_contribution_margin,
    });
  }, [activeScenario, useCustomScenario]);

  // Read-only Live Context sync for (A) ML & (B) DB availability (never writes pricing_quotes)
  useEffect(() => {
    if (!selectedRoom || checkOutDate <= checkInDate) return;
    const controller = new AbortController();
    setLoadingLiveContext(true);

    void getRevenueLiveContext(
      {
        room_type_id: selectedRoom.type_id,
        check_in_date: checkInDate,
        check_out_date: checkOutDate,
        guest_count: Math.min(Math.max(1, guestCount), selectedRoom.capacity),
      },
      controller.signal,
    )
      .then((ctx) => {
        if (controller.signal.aborted) return;
        setLiveContext(ctx);
        if (syncRealInventory) {
          setSimulatedRoomsAvailable(ctx.rooms_available);
        }
        if (!mlOverrideEnabled) {
          setManualMlMultiplier(ctx.ml_multiplier);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setLoadingLiveContext(false);
      });

    return () => controller.abort();
  }, [selectedRoom, checkInDate, checkOutDate, guestCount, syncRealInventory, mlOverrideEnabled]);

  const calculateDecision = useCallback(
    async (couponOverride?: string, signal?: AbortSignal) => {
      if (!selectedRoom) return;
      if (checkOutDate <= checkInDate) {
        setError('Ngày trả phòng phải sau ngày nhận phòng.');
        return;
      }
      const effectiveCoupon = (couponOverride !== undefined ? couponOverride : couponCode).trim().toUpperCase();
      setLoading(true);
      setError('');
      try {
        const res = await evaluateRevenueDecision(
          {
            room_type_id: selectedRoom.type_id,
            room_type_name: selectedRoom.type_name,
            base_price: selectedRoom.base_price,
            declared_max_price: selectedRoom.declared_max_price ?? undefined,
            check_in_date: checkInDate,
            check_out_date: checkOutDate,
            guest_count: Math.min(Math.max(1, guestCount), selectedRoom.capacity),
            rooms_available: effectiveRoomsAvailable,
            rooms_total: effectiveRoomsTotal,
            ml_multiplier: effectiveMlMultiplier,
            scenario_id: selectedScenarioId,
            coupon_code: effectiveCoupon || undefined,
            custom_scenario: useCustomScenario ? customScenario : undefined,
          },
          signal,
        );
        if (!signal?.aborted) {
          setDecision(res);
        }
      } catch (err) {
        if (!signal?.aborted) {
          setError(err instanceof Error ? err.message : 'Lỗi tính toán quyết định giá');
        }
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [
      checkInDate,
      checkOutDate,
      couponCode,
      customScenario,
      effectiveMlMultiplier,
      effectiveRoomsAvailable,
      effectiveRoomsTotal,
      guestCount,
      selectedRoom,
      selectedScenarioId,
      useCustomScenario,
    ],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void calculateDecision(undefined, controller.signal);
    }, 100);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [calculateDecision]);

  const handleRoomChange = (nextTypeId: number) => {
    setSelectedRoomId(nextTypeId);
    const nextRoom = roomTypes.find((r) => r.type_id === nextTypeId);
    if (nextRoom) {
      setGuestCount((prev) => Math.min(prev, nextRoom.capacity));
      setSimulatedRoomsAvailable((prev) => Math.min(prev, Math.max(1, nextRoom.total_rooms)));
    }
  };

  const handleOpenCreateCoupon = () => {
    setShowCouponManager(true);
    setCouponMutationError('');
    setCouponMutationSuccess('');
    setCouponFormMode('create');
    setCouponDraft({
      code: '',
      description_vi: '',
      discount_pct_input: 10,
      max_discount_vnd: 300000,
      min_room_type_id: 1,
      usage_limit: 100,
      active: true,
      expiry_date: '2027-12-31',
    });
  };

  const handleOpenEditCoupon = (c: AdminCoupon) => {
    setShowCouponManager(true);
    setCouponMutationError('');
    setCouponMutationSuccess('');
    setCouponFormMode('edit');
    setCouponDraft({
      code: c.code,
      description_vi: c.description_vi,
      discount_pct_input: Math.round(c.discount_pct * 100),
      max_discount_vnd: c.max_discount_vnd,
      min_room_type_id: c.min_room_type_id,
      usage_limit: c.usage_limit,
      active: c.active,
      expiry_date: c.expiry_date ?? '',
    });
  };

  const handleSaveCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    setCouponSubmitting(true);
    setCouponMutationError('');
    setCouponMutationSuccess('');
    try {
      const normalizedDiscount = Math.round(Number(couponDraft.discount_pct_input)) / 100;
      const expiryValue = couponDraft.expiry_date.trim() ? couponDraft.expiry_date.trim() : null;
      if (couponFormMode === 'create') {
        const created = await createAdminCoupon({
          code: couponDraft.code.trim().toUpperCase(),
          description_vi: couponDraft.description_vi.trim(),
          discount_pct: normalizedDiscount,
          max_discount_vnd: Number(couponDraft.max_discount_vnd),
          min_room_type_id: Number(couponDraft.min_room_type_id),
          usage_limit: Number(couponDraft.usage_limit),
          active: couponDraft.active,
          expiry_date: expiryValue,
        });
        setCouponMutationSuccess(`Đã tạo mã ưu đãi ${created.code} trong CSDL.`);
      } else if (couponFormMode === 'edit') {
        const updated = await updateAdminCoupon(couponDraft.code, {
          description_vi: couponDraft.description_vi.trim(),
          discount_pct: normalizedDiscount,
          max_discount_vnd: Number(couponDraft.max_discount_vnd),
          min_room_type_id: Number(couponDraft.min_room_type_id),
          usage_limit: Number(couponDraft.usage_limit),
          active: couponDraft.active,
          expiry_date: expiryValue,
        });
        setCouponMutationSuccess(`Đã cập nhật mã ưu đãi ${updated.code}.`);
      }
      setCouponFormMode('closed');
      await refreshCoupons();
      await calculateDecision();
    } catch (err) {
      setCouponMutationError(err instanceof Error ? err.message : 'Không thể lưu mã ưu đãi.');
    } finally {
      setCouponSubmitting(false);
    }
  };

  const handleToggleCouponActive = async (c: AdminCoupon) => {
    setCouponMutationError('');
    setCouponMutationSuccess('');
    try {
      const updated = await updateAdminCoupon(c.code, { active: !c.active });
      setCouponMutationSuccess(`Mã ${updated.code} đã chuyển sang ${updated.active ? 'Đang kích hoạt' : 'Tạm ngưng'}.`);
      await refreshCoupons();
      await calculateDecision();
    } catch (err) {
      setCouponMutationError(err instanceof Error ? err.message : 'Không thể đổi trạng thái coupon.');
    }
  };

  const handleResetCouponUsage = async (c: AdminCoupon) => {
    setCouponMutationError('');
    setCouponMutationSuccess('');
    try {
      const updated = await updateAdminCoupon(c.code, { reset_used_count: true });
      setCouponMutationSuccess(`Đã đặt lại số lượt đã dùng của ${updated.code} về 0.`);
      await refreshCoupons();
      await calculateDecision();
    } catch (err) {
      setCouponMutationError(err instanceof Error ? err.message : 'Không thể reset lượt sử dụng.');
    }
  };

  const handleRunMarketDecision = async () => {
    if (!selectedRoom) return;
    setMarketDecisionLoading(true);
    setMarketDecisionError('');
    setMarketSyncNotice('');
    try {
      const activeCost = useCustomScenario
        ? customScenario.serving_cost_per_night
        : (activeScenario?.serving_cost_per_night ?? 350000);
      const activeComm = useCustomScenario
        ? customScenario.channel_commission_pct
        : (activeScenario?.channel_commission_pct ?? 0);
      const activeTax = useCustomScenario
        ? customScenario.tax_rate + customScenario.service_charge_rate
        : ((activeScenario?.tax_rate ?? 0.08) + (activeScenario?.service_charge_rate ?? 0.05));
      const activeMargin = useCustomScenario
        ? customScenario.min_contribution_margin
        : (activeScenario?.min_contribution_margin ?? 50000);

      const res = await evaluateMarketDecision({
        check_in_date: checkInDate,
        guest_count: Math.min(Math.max(1, guestCount), selectedRoom.capacity),
        room_type_id: selectedRoom.type_id,
        room_segment: 'upscale_resort_standard',
        base_price: selectedRoom.base_price,
        rooms_available: effectiveRoomsAvailable,
        rooms_total: effectiveRoomsTotal,
        serving_cost: activeCost,
        commission_pct: activeComm,
        tax_pct: Math.min(0.3, activeTax),
        min_margin: activeMargin,
        floor_price: 452000,
        ceiling_price: selectedRoom.declared_max_price ?? Math.round(selectedRoom.base_price * 1.5),
      });
      setMarketDecision(res);
    } catch (err) {
      setMarketDecisionError(
        err instanceof Error ? err.message : 'Không thể chạy thẩm định thị trường Đà Nẵng.',
      );
    } finally {
      setMarketDecisionLoading(false);
    }
  };

  const handleApplyMarketSignalsToScenario = () => {
    if (!marketDecision) return;
    const suggestion = marketDecision.scenario_sync_suggestion;
    const weatherSignal =
      suggestion?.weather ?? marketDecision.weather_index?.recommended_weather_signal ?? customScenario.weather;
    const demandSignal = suggestion?.demand_level ?? 'normal';
    setUseCustomScenario(true);
    setCustomScenario((prev) => ({
      ...prev,
      scenario_id: 'custom_danang_advisory',
      name_vi: 'Đồng bộ từ dẫn chứng Đà Nẵng [C]',
      weather: weatherSignal,
      demand_level: demandSignal,
    }));
    setMarketSyncNotice(
      `Đã đồng bộ giả định [C] (Nhu cầu: ${demandSignal}, Thời tiết: ${weatherSignal}). Hệ số [A] ML Random Forest V2 và giá checkout thực không bị thay đổi.`,
    );
  };

  const buildSampleCompetingRequests = () => {
    const tiers = [
      { label: 'Direct Web', mult: 1.0, vip: 1 },
      { label: 'OTA Booking', mult: 0.95, vip: 1 },
      { label: 'Silver Member', mult: 1.05, vip: 2 },
      { label: 'Gold Member', mult: 1.12, vip: 3 },
      { label: 'Platinum VIP', mult: 1.2, vip: 4 },
      { label: 'Corporate Longstay', mult: 1.18, vip: 3 },
      { label: 'Family Direct', mult: 1.08, vip: 2 },
      { label: 'VIP Diplomatic', mult: 1.25, vip: 5 },
    ];
    return Array.from({ length: competingRequestCount }, (_, idx) => {
      const tier = tiers[idx % tiers.length];
      return {
        request_id: `REQ-${String(idx + 1).padStart(2, '0')} (${tier.label})`,
        room_type_id: selectedRoom.type_id,
        check_in_date: checkInDate,
        check_out_date: checkOutDate,
        guest_count: Math.min(guestCount, selectedRoom.capacity),
        revenue_value: Math.round(selectedRoom.base_price * 2 * tier.mult),
        vip_priority: tier.vip,
      };
    });
  };

  const handleRunLiveAllocation = async () => {
    if (checkOutDate <= checkInDate) {
      setAllocationError('Ngày trả phòng phải sau ngày nhận phòng.');
      return;
    }
    setAllocatingLive(true);
    setAllocationError('');
    try {
      const res = await optimizeAllocationLive({
        requests: buildSampleCompetingRequests(),
        allow_upgrades: allowUpgrades,
        check_in_date: checkInDate,
        check_out_date: checkOutDate,
      });
      setLiveAllocationResult(res);
    } catch (err) {
      setAllocationError(err instanceof Error ? err.message : 'Lỗi chạy phân bổ OR-Tools từ DB thực.');
    } finally {
      setAllocatingLive(false);
    }
  };

  const loadRealQueue = useCallback(async (signal?: AbortSignal) => {
    if (queueEndDate <= queueStartDate) {
      setQueueError('Ngày kết thúc cửa sổ hàng đợi phải sau ngày bắt đầu.');
      return;
    }
    setQueueLoading(true);
    setQueueError('');
    try {
      const data = await getAdminAllocationQueue(
        { start_date: queueStartDate, end_date: queueEndDate },
        signal,
      );
      if (signal?.aborted) return;
      setQueueBusinessDate(data.business_date);
      setQueueItems(data.items);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!signal?.aborted) {
        setQueueError(err instanceof Error ? err.message : 'Không thể tải hàng đợi booking từ PostgreSQL.');
      }
    } finally {
      if (!signal?.aborted) {
        setQueueLoading(false);
      }
    }
  }, [queueStartDate, queueEndDate]);

  useEffect(() => {
    if (activeTab !== 'allocation') return;
    const controller = new AbortController();
    void loadRealQueue(controller.signal);
    return () => controller.abort();
  }, [activeTab, loadRealQueue]);

  const handleOptimizeRealQueue = async () => {
    if (queueEndDate <= queueStartDate) {
      setQueueError('Ngày kết thúc cửa sổ tối ưu phải sau ngày bắt đầu.');
      return;
    }
    setQueueOptimizing(true);
    setQueueError('');
    try {
      const optimizableIds = queueItems.filter((item) => item.can_optimize).map((item) => item.booking_id);
      const res = await optimizeAdminAllocationQueue({
        start_date: queueStartDate,
        end_date: queueEndDate,
        allow_upgrades: queueAllowUpgrades,
        ...(optimizableIds.length > 0 ? { booking_ids: optimizableIds } : {}),
      });
      setQueueOptResult(res);
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : 'Lỗi giải tối ưu hàng đợi booking với OR-Tools.');
    } finally {
      setQueueOptimizing(false);
    }
  };

  const handleApplyQueueRecommendation = async (rec: AdminQueueOptimizationRecommendation) => {
    if (!rec.changed || !rec.recommended_room) return;
    setApplyingBookingId(rec.booking_id);
    setQueueError('');
    setQueueNotice('');
    try {
      const idempotencyKey = `ortools-${rec.booking_id.slice(0, 8)}-${rec.expected_assignment_version}-${Date.now()}`;
      const reason = `OR-Tools CP-SAT: ${rec.reason_vi}`.slice(0, 500);
      const event = await reassignAdminBookingRoom(
        'cookie-session',
        rec.booking_id,
        {
          target_room_id: rec.recommended_room.room_id,
          expected_assignment_version: rec.expected_assignment_version,
          reason,
          is_upgrade: rec.is_upgrade,
        },
        idempotencyKey,
      );
      setQueueNotice(
        `Đã ghi ledger đổi phòng cho booking #${rec.booking_id.slice(0, 8).toUpperCase()} (${rec.customer_name}): Phòng ${rec.current_room.room_number} -> ${rec.recommended_room.room_number} (${rec.recommended_room.type_name}), assignment v${event.room_assignment_version}.`,
      );
      await loadRealQueue();
      const refreshedOpt = await optimizeAdminAllocationQueue({
        start_date: queueStartDate,
        end_date: queueEndDate,
        allow_upgrades: queueAllowUpgrades,
      });
      setQueueOptResult(refreshedOpt);
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : 'Không thể áp dụng phân bổ vào ledger phòng.');
      await loadRealQueue();
    } finally {
      setApplyingBookingId(null);
    }
  };

  const handleApplyAllQueueChanges = async () => {
    if (!queueOptResult) return;
    const moves = queueOptResult.recommendations.filter((r) => r.changed && r.recommended_room);
    if (moves.length === 0) return;
    setApplyingBatch(true);
    setQueueError('');
    setQueueNotice('');
    let appliedCount = 0;
    try {
      for (const rec of moves) {
        if (!rec.recommended_room) continue;
        setApplyingBookingId(rec.booking_id);
        const idempotencyKey = `ortools-batch-${rec.booking_id.slice(0, 8)}-${rec.expected_assignment_version}-${Date.now()}`;
        const reason = `OR-Tools CP-SAT Batch: ${rec.reason_vi}`.slice(0, 500);
        await reassignAdminBookingRoom(
          'cookie-session',
          rec.booking_id,
          {
            target_room_id: rec.recommended_room.room_id,
            expected_assignment_version: rec.expected_assignment_version,
            reason,
            is_upgrade: rec.is_upgrade,
          },
          idempotencyKey,
        );
        appliedCount += 1;
      }
      setQueueNotice(`Đã áp dụng thành công ${appliedCount}/${moves.length} đề xuất phân bổ OR-Tools vào ledger phòng PostgreSQL.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể áp dụng toàn bộ chuỗi thay đổi.';
      setQueueError(
        appliedCount > 0
          ? `Đã áp dụng ${appliedCount}/${moves.length} bước trước khi gặp xung đột: ${msg} (Nếu 2 phòng đổi chéo trực tiếp cho nhau, hãy dời 1 phòng sang phòng trung gian hoặc tải lại đề xuất.)`
          : msg,
      );
    } finally {
      setApplyingBookingId(null);
      setApplyingBatch(false);
      await loadRealQueue();
      try {
        const refreshedOpt = await optimizeAdminAllocationQueue({
          start_date: queueStartDate,
          end_date: queueEndDate,
          allow_upgrades: queueAllowUpgrades,
        });
        setQueueOptResult(refreshedOpt);
      } catch {
        // Ignore follow-up refresh error cleanly
      }
    }
  };

  const handleRunWhatIfAllocation = async () => {
    if (checkOutDate <= checkInDate) {
      setAllocationError('Ngày trả phòng phải sau ngày nhận phòng.');
      return;
    }
    setAllocatingWhatIf(true);
    setAllocationError('');
    try {
      const floorPrefix = selectedRoom.type_id * 2 + 1;
      const res = await optimizeRoomAllocation({
        requests: [
          {
            request_id: 'REQ-01 (Direct Web)',
            room_type_id: selectedRoom.type_id,
            check_in_date: checkInDate,
            check_out_date: checkOutDate,
            guest_count: Math.min(guestCount, selectedRoom.capacity),
            revenue_value: selectedRoom.base_price * 2,
            vip_priority: 1,
          },
          {
            request_id: 'REQ-02 (Silver Member)',
            room_type_id: selectedRoom.type_id,
            check_in_date: checkInDate,
            check_out_date: checkOutDate,
            guest_count: Math.min(guestCount, selectedRoom.capacity),
            revenue_value: Math.round(selectedRoom.base_price * 2.2),
            vip_priority: 2,
          },
          {
            request_id: 'REQ-03 (Platinum VIP)',
            room_type_id: selectedRoom.type_id,
            check_in_date: checkInDate,
            check_out_date: checkOutDate,
            guest_count: Math.min(guestCount, selectedRoom.capacity),
            revenue_value: Math.round(selectedRoom.base_price * 2.5),
            vip_priority: 4,
          },
        ],
        available_rooms: [
          {
            room_id: floorPrefix * 100 + 1,
            room_number: `${floorPrefix}01`,
            type_id: selectedRoom.type_id,
            capacity: selectedRoom.capacity,
            current_status: 'Available',
            housekeeping_status: 'Ready',
          },
          {
            room_id: floorPrefix * 100 + 2,
            room_number: `${floorPrefix}02`,
            type_id: selectedRoom.type_id,
            capacity: selectedRoom.capacity,
            current_status: 'Available',
            housekeeping_status: 'Cleaning',
          },
        ],
        allow_upgrades: allowUpgrades,
      });
      setWhatIfAllocationResult(res);
    } catch (err) {
      setAllocationError(err instanceof Error ? err.message : 'Lỗi chạy kịch bản phân bổ What-If.');
    } finally {
      setAllocatingWhatIf(false);
    }
  };

  const handleRunPortfolioOptimize = async () => {
    setPortfolioLoading(true);
    setPortfolioError('');
    try {
      const activeCost = useCustomScenario
        ? customScenario.serving_cost_per_night
        : (activeScenario?.serving_cost_per_night ?? 350000);
      const activeComm = useCustomScenario
        ? customScenario.channel_commission_pct
        : (activeScenario?.channel_commission_pct ?? 0);
      const activeTax = useCustomScenario ? customScenario.tax_rate : (activeScenario?.tax_rate ?? 0.08);
      const activeSvc = useCustomScenario
        ? customScenario.service_charge_rate
        : (activeScenario?.service_charge_rate ?? 0.05);
      const activeMargin = useCustomScenario
        ? customScenario.min_contribution_margin
        : (activeScenario?.min_contribution_margin ?? 50000);

      const res = await optimizePortfolioYield({
        start_date: portfolioStartDate,
        horizon_days: portfolioHorizonDays,
        scenario_id: portfolioScenarioId,
        price_elasticity: portfolioElasticity,
        allow_cross_tier_upgrades: portfolioAllowUpgrades,
        serving_cost_per_night: activeCost,
        channel_commission_pct: activeComm,
        tax_rate: activeTax,
        service_charge_rate: activeSvc,
        min_contribution_margin: activeMargin,
      });
      setPortfolioResult(res);
    } catch (err) {
      setPortfolioError(
        err instanceof Error ? err.message : 'Không thể giải tối ưu danh mục 6 hạng phòng bằng OR-Tools CP-SAT.',
      );
    } finally {
      setPortfolioLoading(false);
    }
  };

  const handleRunSandbox = async (scenarioId = selectedSandboxId) => {
    setRunningSandbox(true);
    setSandboxError('');
    try {
      const res = await runSandboxScenario({ scenario_id: scenarioId });
      setSandboxResult(res);
    } catch (err) {
      setSandboxError(err instanceof Error ? err.message : 'Không thể chạy kịch bản sandbox.');
    } finally {
      setRunningSandbox(false);
    }
  };

  const activeFinancialParams = useCustomScenario ? customScenario : activeScenario;
  const vatRatePct = Math.round((activeFinancialParams?.tax_rate ?? 0.08) * 100);
  const svcRatePct = Math.round((activeFinancialParams?.service_charge_rate ?? 0.05) * 100);
  const commissionRatePct = Math.round((activeFinancialParams?.channel_commission_pct ?? 0) * 100);
  const estimatedCommissionVnd = decision
    ? Math.max(
        0,
        Math.round(
          decision.guest_payable_nightly_rate -
            decision.taxes_and_service_vnd -
            decision.net_revenue_per_night,
        ),
      )
    : 0;

  return (
    <div className="space-y-8 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-amber-100 dark:bg-amber-950/60 px-3 py-1 text-xs font-bold text-amber-800 dark:text-amber-300">
              P8 · Intelligent Revenue Simulator
            </span>
            <span className="rounded-full bg-teal-100 dark:bg-teal-950/60 px-3 py-1 text-xs font-bold text-teal-800 dark:text-teal-300">
              White Sand Boutique Hotel · 6 hạng · 54 phòng
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white mt-2">
            Mô Phỏng Doanh Thu, Coupon & Tối Ưu Phân Bổ Phòng
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Phân tách minh bạch 4 nguồn kết quả: (A) ML thực nghiệm, (B) Tồn kho quan sát, (C) Giả định kịch bản thị trường và (D) Quy tắc ràng buộc tài chính.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void calculateDecision()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm transition shadow-sm shrink-0"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Đang tính toán...' : 'Tính lại báo giá'}
        </button>
      </div>

      {/* 3-Tab Switcher */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('pricing')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition ${
            activeTab === 'pricing'
              ? 'bg-amber-500 text-slate-950 shadow-sm'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          <TrendingUp size={16} />
          <span>1. Giá, Tồn Kho & Coupon</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('allocation')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition ${
            activeTab === 'allocation'
              ? 'bg-teal-500 text-slate-950 shadow-sm'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          <Cpu size={16} />
          <span>2. Phân Bổ Phòng OR-Tools Live</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('sandbox')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition ${
            activeTab === 'sandbox'
              ? 'bg-purple-500 text-white shadow-sm'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          <FlaskConical size={16} />
          <span>3. Kịch Bản Stress-Test Sandbox</span>
        </button>
      </div>

      {/* ===================================================================== */}
      {/* TAB 1: PRICING, INVENTORY & COUPON SIMULATOR                         */}
      {/* ===================================================================== */}
      {activeTab === 'pricing' && (
        <div className="space-y-8">
          {error && (
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 text-sm flex items-center gap-3">
              <AlertCircle size={20} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Control Grid: Scenario & Room Selection */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Card 1: Market Scenario + Custom Parameters */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white text-base">
                  <TrendingUp size={18} className="text-amber-500" />
                  <span>Kịch bản thị trường (Giả định)</span>
                </div>
                <button
                  type="button"
                  onClick={() => setUseCustomScenario((v) => !v)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                    useCustomScenario
                      ? 'bg-amber-100 border-amber-400 text-amber-900 dark:bg-amber-950/60 dark:border-amber-700 dark:text-amber-200'
                      : 'bg-slate-100 border-slate-300 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300'
                  }`}
                >
                  <SlidersHorizontal size={12} />
                  {useCustomScenario ? 'Đang tùy chỉnh' : 'Tùy chỉnh'}
                </button>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Chọn kịch bản mô phỏng:</label>
                <select
                  value={selectedScenarioId}
                  onChange={(e) => {
                    setSelectedScenarioId(e.target.value);
                    setUseCustomScenario(false);
                  }}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-2.5 text-sm text-slate-900 dark:text-white"
                >
                  {scenarios.map((s) => (
                    <option key={s.scenario_id} value={s.scenario_id}>
                      {s.name_vi}
                    </option>
                  ))}
                </select>
              </div>

              {useCustomScenario ? (
                <div className="space-y-2.5 p-3 rounded-xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 text-xs">
                  <div className="font-semibold text-amber-900 dark:text-amber-200">
                    Tham số kịch bản tự cấu hình ([C] SIMULATED_ASSUMPTION)
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">Nhu cầu:</label>
                      <select
                        value={customScenario.demand_level}
                        onChange={(e) =>
                          setCustomScenario((prev) => ({
                            ...prev,
                            demand_level: e.target.value as DemandLevel,
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 text-xs"
                      >
                        <option value="low">Low (Thấp)</option>
                        <option value="normal">Normal (Bình thường)</option>
                        <option value="high">High (Cao)</option>
                        <option value="surge">Surge (Đột biến)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">Thời tiết:</label>
                      <select
                        value={customScenario.weather}
                        onChange={(e) =>
                          setCustomScenario((prev) => ({
                            ...prev,
                            weather: e.target.value as WeatherCondition,
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 text-xs"
                      >
                        <option value="sunny_favorable">Nắng thuận lợi</option>
                        <option value="stormy_unfavorable">Mưa bão bất lợi</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">Vị thế giá đối thủ:</label>
                    <select
                      value={customScenario.competitor_rate_position}
                      onChange={(e) =>
                        setCustomScenario((prev) => ({
                          ...prev,
                          competitor_rate_position: e.target.value as CompetitorPosition,
                        }))
                      }
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 text-xs"
                    >
                      <option value="lower_undercut">Đối thủ thấp hơn (Cạnh tranh giá)</option>
                      <option value="par_neutral">Ngang bằng thị trường</option>
                      <option value="higher_premium">Đối thủ cao hơn (Dư địa tăng)</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">Biến phí phục vụ (VND):</label>
                      <input
                        type="number"
                        min={0}
                        step={10000}
                        value={customScenario.serving_cost_per_night}
                        onChange={(e) =>
                          setCustomScenario((prev) => ({
                            ...prev,
                            serving_cost_per_night: Math.max(0, Number(e.target.value) || 0),
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">Biên tối thiểu (VND):</label>
                      <input
                        type="number"
                        min={0}
                        step={10000}
                        value={customScenario.min_contribution_margin}
                        onChange={(e) =>
                          setCustomScenario((prev) => ({
                            ...prev,
                            min_contribution_margin: Math.max(0, Number(e.target.value) || 0),
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 text-xs"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">Hoa hồng OTA (%):</label>
                      <input
                        type="number"
                        min={0}
                        max={40}
                        step={1}
                        value={Math.round(customScenario.channel_commission_pct * 100)}
                        onChange={(e) =>
                          setCustomScenario((prev) => ({
                            ...prev,
                            channel_commission_pct: Math.max(0, Math.min(0.4, (Number(e.target.value) || 0) / 100)),
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">VAT (%):</label>
                      <input
                        type="number"
                        min={0}
                        max={20}
                        step={1}
                        value={Math.round(customScenario.tax_rate * 100)}
                        onChange={(e) =>
                          setCustomScenario((prev) => ({
                            ...prev,
                            tax_rate: Math.max(0, Math.min(0.2, (Number(e.target.value) || 0) / 100)),
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">SVC (%):</label>
                      <input
                        type="number"
                        min={0}
                        max={15}
                        step={1}
                        value={Math.round(customScenario.service_charge_rate * 100)}
                        onChange={(e) =>
                          setCustomScenario((prev) => ({
                            ...prev,
                            service_charge_rate: Math.max(0, Math.min(0.15, (Number(e.target.value) || 0) / 100)),
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 text-xs"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                decision && (
                  <div className="text-xs space-y-1.5 p-3 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 text-amber-950 dark:text-amber-200">
                    <div>• Biến phí phục vụ: <strong>{formatVND(decision.serving_cost_per_night)} / đêm</strong></div>
                    <div>
                      • Thuế & Phí dịch vụ:{' '}
                      <strong>
                        {activeScenario
                          ? `${Math.round((activeScenario.tax_rate + activeScenario.service_charge_rate) * 100)}%`
                          : '13%'}{' '}
                        (VAT + SVC)
                      </strong>
                    </div>
                    {activeScenario && activeScenario.channel_commission_pct > 0 && (
                      <div>
                        • Hoa hồng OTA: <strong>{Math.round(activeScenario.channel_commission_pct * 100)}%</strong>
                      </div>
                    )}
                    <div>
                      • Phân loại nguồn:{' '}
                      <span className="font-semibold text-amber-700 dark:text-amber-300">SIMULATED ASSUMPTION</span>
                    </div>
                  </div>
                )
              )}
            </div>

            {/* Card 2: Room Type, Dates, Real DB Inventory & Live ML Context */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white text-base">
                <Layers size={18} className="text-teal-600" />
                <span>Hạng phòng White Sand & Lưu trú</span>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Loại phòng (6 hạng · 54 phòng):</label>
                <select
                  value={selectedRoomId}
                  onChange={(e) => handleRoomChange(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-2.5 text-sm text-slate-900 dark:text-white"
                >
                  {roomTypes.map((r) => (
                    <option key={r.type_id} value={r.type_id}>
                      {r.type_name} ({formatVND(r.base_price)} · tối đa {r.capacity} khách)
                    </option>
                  ))}
                </select>
                {selectedRoom.declared_max_price != null && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                    Trần giá kê khai Sở Tài chính: <strong>{formatVND(selectedRoom.declared_max_price)} / đêm</strong>
                  </p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Check-in:</label>
                  <input
                    type="date"
                    value={checkInDate}
                    onChange={(e) => setCheckInDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Check-out:</label>
                  <input
                    type="date"
                    value={checkOutDate}
                    onChange={(e) => setCheckOutDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Số khách:</label>
                  <input
                    type="number"
                    min={1}
                    max={selectedRoom.capacity}
                    value={guestCount}
                    onChange={(e) => setGuestCount(Math.max(1, Math.min(selectedRoom.capacity, Number(e.target.value) || 1)))}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-2 text-xs"
                  />
                </div>
              </div>

              {/* Real DB Sync vs What-If Slider */}
              <div className="space-y-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Tồn phòng áp dụng:</span>
                  <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-700 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setSyncRealInventory(true)}
                      className={`px-2 py-0.5 font-semibold transition ${
                        syncRealInventory
                          ? 'bg-blue-600 text-white'
                          : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      Đồng bộ DB [B]
                    </button>
                    <button
                      type="button"
                      onClick={() => setSyncRealInventory(false)}
                      className={`px-2 py-0.5 font-semibold transition ${
                        !syncRealInventory
                          ? 'bg-amber-500 text-slate-950'
                          : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      What-If [C]
                    </button>
                  </div>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">
                    {syncRealInventory ? 'Tồn kho thực tế theo ngày:' : 'Số phòng trống giả lập:'}
                  </span>
                  <strong className="text-slate-900 dark:text-white tabular-nums">
                    {loadingLiveContext && syncRealInventory
                      ? 'Đang đồng bộ...'
                      : `${effectiveRoomsAvailable} / ${effectiveRoomsTotal} phòng`}
                  </strong>
                </div>
                {syncRealInventory ? (
                  <p className="text-[11px] text-blue-700 dark:text-blue-300">
                    Đọc trực tiếp từ PostgreSQL cho kỳ {checkInDate} → {checkOutDate} (đang giữ {liveContext?.rooms_booked ?? 0} phòng). Không tạo quote rác.
                  </p>
                ) : (
                  <input
                    type="range"
                    min={0}
                    max={effectiveRoomsTotal}
                    value={Math.min(simulatedRoomsAvailable, effectiveRoomsTotal)}
                    onChange={(e) => setSimulatedRoomsAvailable(Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                )}
              </div>

              {/* Live (A) ML Multiplier Control */}
              <div className="space-y-1.5 p-3 rounded-xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/50 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-purple-900 dark:text-purple-200">
                    Hệ số ML ADR: <strong>×{effectiveMlMultiplier.toFixed(3)}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setMlOverrideEnabled((v) => !v)}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition ${
                      mlOverrideEnabled
                        ? 'bg-amber-200 border-amber-400 text-amber-950'
                        : 'bg-purple-200/70 border-purple-300 text-purple-900 dark:bg-purple-900 dark:border-purple-700 dark:text-purple-100'
                    }`}
                  >
                    {mlOverrideEnabled ? 'Đang ghi đè [C]' : 'ML Live [A]'}
                  </button>
                </div>
                {mlOverrideEnabled ? (
                  <div>
                    <input
                      type="range"
                      min={0.7}
                      max={1.6}
                      step={0.01}
                      value={manualMlMultiplier}
                      onChange={(e) => setManualMlMultiplier(Number(e.target.value))}
                      className="w-full accent-purple-600"
                    />
                    <div className="flex justify-between text-[11px] text-amber-800 dark:text-amber-300">
                      <span>Thử độ nhạy thủ công [C]</span>
                      <span>Gốc [A]: ×{(liveContext?.ml_multiplier ?? 1).toFixed(3)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-purple-700/90 dark:text-purple-300/90 leading-snug">
                      {liveContext?.ml_note ?? 'Đang lấy hệ số từ AI Random Forest V2...'}
                    </p>
                    {liveContext?.ml_uncertainty && (
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span
                          className={`px-1.5 py-0.5 rounded font-semibold ${
                            liveContext.ml_uncertainty.ood_status === 'in_distribution'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : liveContext.ml_uncertainty.ood_status === 'border'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                          }`}
                        >
                          {liveContext.ml_uncertainty.ood_status === 'in_distribution'
                            ? 'In-Dist'
                            : liveContext.ml_uncertainty.ood_status === 'border'
                              ? 'Border'
                              : 'OOD'}{' '}
                          (D_M={liveContext.ml_uncertainty.ood_distance.toFixed(2)})
                        </span>
                        <span className="font-mono text-purple-800 dark:text-purple-200">
                          Conformal 90%: ×{liveContext.ml_uncertainty.conformal_low.toFixed(2)}–×{liveContext.ml_uncertainty.conformal_high.toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Card 3: Coupon Tester & Manager Trigger */}
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white text-base">
                  <Tag size={18} className="text-purple-600" />
                  <span>Thử nghiệm Mã Giảm Giá</span>
                </div>
                {couponCode && (
                  <button
                    type="button"
                    onClick={() => {
                      setCouponCode('');
                      void calculateDecision('');
                    }}
                    className="text-xs font-semibold text-rose-500 hover:underline"
                  >
                    Gỡ mã
                  </button>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Nhập hoặc chọn mã coupon White Sand:</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="VD: WHITESAND10, SUITE20..."
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void calculateDecision();
                      }
                    }}
                    className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-2.5 text-sm uppercase font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => void calculateDecision()}
                    className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs transition"
                  >
                    Áp dụng
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {coupons.map((c) => {
                  const isSelected = couponCode === c.code;
                  return (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => {
                        setCouponCode(c.code);
                        void calculateDecision(c.code);
                      }}
                      title={c.description_vi || c.code}
                      className={`text-xs px-2.5 py-1 rounded-lg border font-mono transition ${
                        isSelected
                          ? 'bg-purple-100 border-purple-500 text-purple-900 dark:bg-purple-950 dark:text-purple-200 font-semibold'
                          : !c.active
                            ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-900 text-rose-700 dark:text-rose-300'
                            : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {c.code} (-{Math.round(c.discount_pct * 100)}%)
                      {!c.active ? ' · Ngưng' : c.min_room_type_id && c.min_room_type_id >= 5 ? ' · Suite+' : ''}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Đồng bộ trực tiếp bảng <code className="font-mono">pricing_coupons</code> với luồng đặt phòng khách (<code className="font-mono">/pricing/quote</code>).
              </p>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setShowCouponManager((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-700 dark:text-purple-300 hover:underline"
                >
                  {showCouponManager ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  Quản trị kho Coupon ({adminCoupons.length || coupons.length} mã)
                </button>
                <button
                  type="button"
                  onClick={handleOpenCreateCoupon}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold transition"
                >
                  <Plus size={12} /> Tạo mã mới
                </button>
              </div>
            </div>
          </div>

          {/* Admin Coupon CRUD Manager Panel */}
          {showCouponManager && (
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-900/60 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
                    <Tag size={17} className="text-purple-600" />
                    Quản Lý Kho Mã Giảm Giá PostgreSQL (pricing_coupons)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Thay đổi có hiệu lực ngay với cả Bộ mô phỏng doanh thu lẫn trang /book & /checkout của khách.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleOpenCreateCoupon}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold transition"
                  >
                    <Plus size={14} /> Thêm mã mới
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCouponManager(false)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600"
                    title="Thu gọn"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {couponAdminNotice && (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-200">
                  {couponAdminNotice}
                </div>
              )}
              {couponMutationError && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-200">
                  {couponMutationError}
                </div>
              )}
              {couponMutationSuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-200">
                  {couponMutationSuccess}
                </div>
              )}

              {couponFormMode !== 'closed' && (
                <form
                  onSubmit={(e) => void handleSaveCoupon(e)}
                  className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <strong className="text-sm text-slate-900 dark:text-white">
                      {couponFormMode === 'create'
                        ? 'Tạo mã coupon mới'
                        : `Chỉnh sửa mã ${couponDraft.code}`}
                    </strong>
                    <button
                      type="button"
                      onClick={() => setCouponFormMode('closed')}
                      className="text-slate-500 hover:underline"
                    >
                      Đóng form
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">Mã Code (A-Z, 0-9, _-):</label>
                      <input
                        type="text"
                        required
                        disabled={couponFormMode === 'edit'}
                        value={couponDraft.code}
                        onChange={(e) =>
                          setCouponDraft((prev) => ({
                            ...prev,
                            code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''),
                          }))
                        }
                        placeholder="VD: WINTER25"
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 font-mono uppercase disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">% Giảm (1 - 50%):</label>
                      <input
                        type="number"
                        required
                        min={1}
                        max={50}
                        value={couponDraft.discount_pct_input}
                        onChange={(e) =>
                          setCouponDraft((prev) => ({
                            ...prev,
                            discount_pct_input: Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">Trần giảm tối đa / đêm (VND):</label>
                      <input
                        type="number"
                        required
                        min={1000}
                        step={10000}
                        value={couponDraft.max_discount_vnd}
                        onChange={(e) =>
                          setCouponDraft((prev) => ({
                            ...prev,
                            max_discount_vnd: Math.max(1000, Number(e.target.value) || 1000),
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">Hạng phòng tối thiểu:</label>
                      <select
                        value={couponDraft.min_room_type_id}
                        onChange={(e) =>
                          setCouponDraft((prev) => ({
                            ...prev,
                            min_room_type_id: Number(e.target.value),
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2"
                      >
                        {roomTypes.map((r) => (
                          <option key={r.type_id} value={r.type_id}>
                            Từ {r.type_name} (ID {r.type_id})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">Mô tả ưu đãi (tiếng Việt):</label>
                      <input
                        type="text"
                        required
                        minLength={3}
                        maxLength={255}
                        value={couponDraft.description_vi}
                        onChange={(e) =>
                          setCouponDraft((prev) => ({ ...prev, description_vi: e.target.value }))
                        }
                        placeholder="VD: Ưu đãi đặt sớm White Sand mùa thấp điểm"
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">Giới hạn lượt:</label>
                      <input
                        type="number"
                        required
                        min={1}
                        max={100000}
                        value={couponDraft.usage_limit}
                        onChange={(e) =>
                          setCouponDraft((prev) => ({
                            ...prev,
                            usage_limit: Math.max(1, Number(e.target.value) || 1),
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">Hạn dùng (để trống = vĩnh viễn):</label>
                      <input
                        type="date"
                        value={couponDraft.expiry_date}
                        onChange={(e) =>
                          setCouponDraft((prev) => ({ ...prev, expiry_date: e.target.value }))
                        }
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={couponDraft.active}
                        onChange={(e) =>
                          setCouponDraft((prev) => ({ ...prev, active: e.target.checked }))
                        }
                      />
                      <span>Kích hoạt áp dụng ngay</span>
                    </label>
                    <button
                      type="submit"
                      disabled={couponSubmitting}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold disabled:opacity-50"
                    >
                      {couponSubmitting && <LoaderCircle size={13} className="animate-spin" />}
                      {couponFormMode === 'create' ? 'Lưu mã mới' : 'Cập nhật mã'}
                    </button>
                  </div>
                </form>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400">
                      <th className="pb-2">Mã</th>
                      <th className="pb-2">Ưu đãi & Trần/đêm</th>
                      <th className="pb-2">Điều kiện hạng</th>
                      <th className="pb-2">Lượt dùng</th>
                      <th className="pb-2">Hạn dùng</th>
                      <th className="pb-2">Trạng thái</th>
                      <th className="pb-2 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(adminCoupons.length > 0 ? adminCoupons : []).map((c) => {
                      const minRoomName =
                        roomTypes.find((r) => r.type_id === c.min_room_type_id)?.type_name ??
                        `Hạng ${c.min_room_type_id}`;
                      return (
                        <tr key={c.code} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 font-mono font-bold text-slate-900 dark:text-white">
                            {c.code}
                            <p className="font-sans font-normal text-[11px] text-slate-500 max-w-xs truncate" title={c.description_vi}>
                              {c.description_vi}
                            </p>
                          </td>
                          <td className="py-2.5 font-mono">
                            -{Math.round(c.discount_pct * 100)}% (tối đa {formatVND(c.max_discount_vnd)})
                          </td>
                          <td className="py-2.5">Từ {minRoomName}</td>
                          <td className="py-2.5 font-mono">
                            {c.used_count} / {c.usage_limit}
                          </td>
                          <td className="py-2.5 font-mono">{c.expiry_date ?? 'Không giới hạn'}</td>
                          <td className="py-2.5">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                c.active
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                              }`}
                            >
                              {c.active ? 'Đang bật' : 'Tạm ngưng'}
                            </span>
                          </td>
                          <td className="py-2.5 text-right whitespace-nowrap space-x-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEditCoupon(c)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <Pencil size={11} /> Sửa
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleToggleCouponActive(c)}
                              className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              {c.active ? 'Tắt' : 'Bật'}
                            </button>
                            {c.used_count > 0 && (
                              <button
                                type="button"
                                onClick={() => void handleResetCouponUsage(c)}
                                title="Đặt lại used_count = 0"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300"
                              >
                                <RotateCcw size={11} /> Reset
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Main KPI Dashboard & Pricing Output */}
          {decision && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
                  <span className="text-xs font-semibold text-slate-500 block">Giá cơ sở phòng</span>
                  <strong className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                    {formatVND(decision.base_price)}
                  </strong>
                  <span className="text-xs text-slate-400 block mt-1">Niêm yết tiêu chuẩn</span>
                </div>

                <div className="p-4 rounded-2xl bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900 shadow-sm">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-purple-700 dark:text-purple-300">ML ADR Benchmark</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        mlOverrideEnabled
                          ? 'bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-100'
                          : 'bg-purple-200 dark:bg-purple-900 text-purple-900 dark:text-purple-100'
                      }`}
                    >
                      {mlOverrideEnabled
                        ? `[C] Ghi đè ×${effectiveMlMultiplier.toFixed(2)}`
                        : `[A] ML Live ×${effectiveMlMultiplier.toFixed(2)}`}
                    </span>
                  </div>
                  <strong className="text-xl sm:text-2xl font-bold text-purple-900 dark:text-purple-100 tabular-nums">
                    {formatVND(decision.ml_reference_price)}
                  </strong>
                  <span className="text-xs text-purple-600/80 dark:text-purple-300/80 block mt-1">
                    {mlOverrideEnabled
                      ? `Đang thử độ nhạy thủ công (Gốc ML: ×${(liveContext?.ml_multiplier ?? 1).toFixed(2)})`
                      : liveContext?.ml_model_version
                        ? `Random Forest ${liveContext.ml_model_version} (${liveContext.ml_feature_contract_version ?? 'V2'})`
                        : 'Tham chiếu từ Random Forest (Bồ Đào Nha)'}
                  </span>
                  {liveContext?.ml_uncertainty && !mlOverrideEnabled && (
                    <div className="mt-2 pt-2 border-t border-purple-200/70 dark:border-purple-800/60 space-y-1 text-[11px]">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span className="text-purple-800/90 dark:text-purple-200 font-medium">
                          Conformal {Math.round(liveContext.ml_uncertainty.target_coverage * 100)}%:
                        </span>
                        <span className="font-mono font-semibold text-purple-900 dark:text-purple-100 tabular-nums">
                          {formatVND(Math.round(decision.base_price * liveContext.ml_uncertainty.conformal_low))} –{' '}
                          {formatVND(Math.round(decision.base_price * liveContext.ml_uncertainty.conformal_high))}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-1 text-[10px]">
                        <span className="font-mono text-purple-700/80 dark:text-purple-300/80">
                          RF P10–P90: {formatVND(Math.round(decision.base_price * liveContext.ml_uncertainty.ensemble_p10))}–
                          {formatVND(Math.round(decision.base_price * liveContext.ml_uncertainty.ensemble_p90))}
                        </span>
                        <span
                          title={liveContext.ml_uncertainty.ood_notes.join(' | ') || 'Mahalanobis OOD Gate'}
                          className={`px-1.5 py-0.5 rounded font-bold ${
                            liveContext.ml_uncertainty.ood_status === 'in_distribution'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : liveContext.ml_uncertainty.ood_status === 'border'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                          }`}
                        >
                          {liveContext.ml_uncertainty.ood_status === 'in_distribution'
                            ? 'In-Dist'
                            : liveContext.ml_uncertainty.ood_status === 'border'
                              ? 'Border'
                              : 'OOD Alert'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Giá đề xuất kịch bản</span>
                    <span className="text-[10px] bg-amber-200 dark:bg-amber-900 px-1.5 py-0.5 rounded font-bold">[C] Giả định</span>
                  </div>
                  <strong className="text-xl sm:text-2xl font-bold text-amber-900 dark:text-amber-100 tabular-nums">
                    {formatVND(decision.scenario_recommended_rate)}
                  </strong>
                  <span className="text-xs text-amber-600/80 dark:text-amber-300/80 block mt-1">
                    {selectedRoom.declared_max_price && decision.scenario_recommended_rate >= selectedRoom.declared_max_price
                      ? 'Đã kiểm trần kê khai'
                      : 'Trước khi trừ coupon'}
                  </span>
                </div>

                <div
                  className={`p-4 rounded-2xl border shadow-sm ${
                    decision.is_floor_price_clamped
                      ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-900'
                      : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">Khách thanh toán / đêm</span>
                    {decision.is_floor_price_clamped && (
                      <span className="text-[10px] bg-rose-200 dark:bg-rose-900 text-rose-800 px-1.5 py-0.5 rounded font-bold">
                        Giá Sàn Bảo Vệ
                      </span>
                    )}
                  </div>
                  <strong className="text-xl sm:text-2xl font-bold text-emerald-900 dark:text-emerald-100 tabular-nums">
                    {formatVND(decision.guest_payable_nightly_rate)}
                  </strong>
                  <span className="text-xs text-emerald-700 dark:text-emerald-300 block mt-1">
                    Biên đóng góp: <strong>+{formatVND(decision.estimated_contribution_margin)}</strong>
                  </span>
                </div>
              </div>

              {/* Breakdown Table & P&L */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-7 p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-900 dark:text-white text-base">
                      Bóc Tách Nhân Tố & Nguồn Gốc Tác Động (Lineage)
                    </h3>
                    <span className="text-xs text-slate-500 font-mono">4 Nguồn Minh Bạch</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs sm:text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400">
                          <th className="pb-2">Nhân tố tác động</th>
                          <th className="pb-2">Nguồn gốc</th>
                          <th className="pb-2 text-right">Mức biến động</th>
                          <th className="pb-2 text-right">Số tiền (VND)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {decision.factors.map((f, i) => {
                          const badge = PROVENANCE_BADGE_MAP[f.source_category];
                          return (
                            <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                              <td className="py-2.5 font-medium text-slate-900 dark:text-white">
                                {f.factor_name}
                                <p className="text-[11px] text-slate-500 font-normal">{f.description_vi}</p>
                              </td>
                              <td className="py-2.5 whitespace-nowrap">
                                {badge ? (
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${badge.className}`}>
                                    {badge.label}
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                                    {f.source_category}
                                  </span>
                                )}
                              </td>
                              <td
                                className={`py-2.5 text-right font-mono font-bold ${
                                  f.impact_pct > 0 ? 'text-amber-600' : f.impact_pct < 0 ? 'text-emerald-600' : 'text-slate-500'
                                }`}
                              >
                                {f.impact_pct > 0 ? `+${f.impact_pct}%` : `${f.impact_pct}%`}
                              </td>
                              <td className="py-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                {f.impact_vnd > 0 ? `+${formatVND(f.impact_vnd)}` : formatVND(f.impact_vnd)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Caveats */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                    {decision.caveats.map((c, i) => (
                      <div key={i} className="text-xs text-amber-900 dark:text-amber-300 flex items-start gap-1.5">
                        <ShieldAlert size={14} className="shrink-0 mt-0.5 text-amber-600" />
                        <span>{c}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* P&L Statement */}
                <div className="lg:col-span-5 p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    Báo Cáo Tài Chính & Biên Đóng Góp (P&L Simulation)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Bảo đảm nguyên tắc: Không bán phòng dưới biến phí phục vụ (Doanh thu thuần Net &ge; Biến phí C_serve).
                  </p>

                  <div className="space-y-2.5 text-xs sm:text-sm pt-2">
                    <div className="flex justify-between text-slate-600 dark:text-slate-400">
                      <span>Giá niêm yết kịch bản:</span>
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {formatVND(decision.scenario_recommended_rate)}
                      </span>
                    </div>
                    {decision.coupon_applied && (
                      <div className="flex justify-between text-purple-600 dark:text-purple-400">
                        <span>Khuyến mãi ({decision.coupon_applied}):</span>
                        <span className="font-semibold">-{formatVND(decision.coupon_discount_vnd)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-slate-900 dark:text-white font-bold pt-2 border-t border-slate-100 dark:border-slate-800">
                      <span>Giá khách thanh toán:</span>
                      <span className="tabular-nums">{formatVND(decision.guest_payable_nightly_rate)} / đêm</span>
                    </div>
                    <div className="flex justify-between text-slate-500">
                      <span>Trừ: Thuế VAT ({vatRatePct}%) &amp; SVC ({svcRatePct}%):</span>
                      <span>-{formatVND(decision.taxes_and_service_vnd)}</span>
                    </div>
                    {(commissionRatePct > 0 || estimatedCommissionVnd > 0) && (
                      <div className="flex justify-between text-slate-500">
                        <span>Trừ: Hoa hồng kênh OTA ({commissionRatePct}%):</span>
                        <span>-{formatVND(estimatedCommissionVnd)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-slate-700 dark:text-slate-300 font-medium">
                      <span>Doanh thu thuần (Net Revenue):</span>
                      <span>{formatVND(decision.net_revenue_per_night)}</span>
                    </div>
                    <div className="flex justify-between text-rose-600 dark:text-rose-400">
                      <span>Trừ: Biến phí phục vụ (C_serve):</span>
                      <span>-{formatVND(decision.serving_cost_per_night)}</span>
                    </div>
                    <div className="flex justify-between items-baseline pt-3 border-t-2 border-slate-200 dark:border-slate-700">
                      <span className="font-bold text-slate-900 dark:text-white">Biên đóng góp kỳ vọng:</span>
                      <strong
                        className={`text-base sm:text-lg font-bold font-mono ${
                          decision.estimated_contribution_margin >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600'
                        }`}
                      >
                        +{formatVND(decision.estimated_contribution_margin)} / đêm
                      </strong>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500">
                    Tổng cộng cho kỳ lưu trú {decision.total_nights} đêm:{' '}
                    <strong>{formatVND(decision.guest_total_payable)}</strong>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Da Nang Public Evidence Advisory Card (POST /revenue/market-decision) */}
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Globe size={18} className="text-sky-600" />
                  <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                    Thẩm Định Thị Trường Đà Nẵng Từ Nguồn Công Khai (Advisory Only)
                  </h3>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200 font-bold">
                    Không tự áp checkout
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Kiểm tra nguồn công khai Đà Nẵng (dự báo thời tiết Open-Meteo, tin sự kiện/khuyến mại địa phương), cổng kiểm định dữ liệu conversion và mốc tham chiếu ML Bồ Đào Nha.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRunMarketDecision()}
                disabled={marketDecisionLoading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs sm:text-sm font-semibold transition shrink-0 disabled:opacity-50"
              >
                {marketDecisionLoading ? <LoaderCircle size={15} className="animate-spin" /> : <Globe size={15} />}
                {marketDecisionLoading ? 'Đang thu thập dẫn chứng...' : 'Chạy thẩm định thị trường Đà Nẵng'}
              </button>
            </div>

            {marketDecisionError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2">
                <AlertCircle size={16} className="shrink-0" />
                <span>{marketDecisionError}</span>
              </div>
            )}

            {marketDecision && (
              <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2.5 py-1 rounded-full font-bold ${
                        marketDecision.status === 'shadow_ready'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                          : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                      }`}
                    >
                      {marketDecision.status === 'shadow_ready'
                        ? 'SHADOW READY · Có đề xuất tham khảo'
                        : 'CHƯA ĐỦ DẪN CHỨNG (Dừng đề xuất giá tự động)'}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                      {marketDecision.region} · {marketDecision.feature_contract_version}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-slate-400">
                    ID: {marketDecision.decision_id.slice(0, 12)}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-xl bg-purple-50/60 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/50 space-y-1">
                    <div className="text-[11px] font-semibold text-purple-800 dark:text-purple-200">
                      [A] Tham chiếu ML lịch sử ({marketDecision.reference.status})
                    </div>
                    <div className="text-base font-bold text-purple-900 dark:text-purple-100 tabular-nums">
                      {marketDecision.reference.price_vnd != null
                        ? `${formatVND(marketDecision.reference.price_vnd)} / đêm`
                        : 'Không khả dụng'}
                    </div>
                    <p className="text-[11px] text-purple-700/80 dark:text-purple-300/80 leading-snug">
                      {marketDecision.reference.scope}
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1">
                    <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      Khung chính sách &amp; Dự báo thời tiết
                    </div>
                    <div className="font-mono text-slate-900 dark:text-white">
                      Sàn: {formatVND(marketDecision.policy.floor_vnd)} · Trần:{' '}
                      {formatVND(marketDecision.policy.ceiling_vnd)}
                    </div>
                    {marketDecision.evidence.weather ? (
                      <div className="space-y-1.5">
                        <p className="text-[11px] text-slate-600 dark:text-slate-300">
                          Open-Meteo Đà Nẵng ({String(marketDecision.evidence.weather.date ?? checkInDate)}):{' '}
                          {String(marketDecision.evidence.weather.temperature_max_c ?? '—')}°C · Mưa{' '}
                          {String(marketDecision.evidence.weather.rain_probability_pct ?? '—')}% · Gió{' '}
                          {String(marketDecision.evidence.weather.wind_max_kmh ?? '—')} km/h
                        </p>
                        {marketDecision.weather_index && (
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className="px-2 py-0.5 rounded bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200 font-bold tabular-nums">
                              Comfort {marketDecision.weather_index.comfort_score_0_100}/100
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded font-bold ${
                                marketDecision.weather_index.storm_risk_level === 'high'
                                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
                                  : marketDecision.weather_index.storm_risk_level === 'moderate'
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                              }`}
                            >
                              Rủi ro bão: {marketDecision.weather_index.storm_risk_level}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-500">
                        Chưa có dữ liệu dự báo thời tiết trong tầm 16 ngày Open-Meteo cho ngày lưu trú đã chọn.
                      </p>
                    )}
                  </div>

                  <div className="p-3.5 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 space-y-1">
                    <div className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">
                      Khuyến nghị tối ưu kỳ vọng (Shadow)
                    </div>
                    {marketDecision.selected ? (
                      <>
                        <div className="text-base font-bold text-emerald-900 dark:text-emerald-100 tabular-nums">
                          {formatVND(marketDecision.selected.price_vnd)} / đêm
                        </div>
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                          Xác suất đặt dự kiến {(marketDecision.selected.conversion_probability * 100).toFixed(1)}% · Biên kỳ vọng{' '}
                          {formatVND(marketDecision.selected.expected_contribution_vnd)}
                        </p>
                      </>
                    ) : (
                      <p className="text-[11px] text-amber-800 dark:text-amber-300">
                        Hệ thống an toàn từ chối xuất giá tối ưu tự động khi thiếu dẫn chứng hợp chuẩn hoặc model conversion chưa vượt cổng kiểm định.
                      </p>
                    )}
                  </div>
                </div>

                {/* E2: Native Grounded Da Nang NLP & 1-click [C] Sync */}
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-white">
                        Trích xuất ngữ cảnh Đà Nẵng có kiểm chứng (NLP Grounding)
                      </span>
                      <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                        {marketDecision.context.model ?? 'unconfigured'} · status: {marketDecision.context.status}
                      </span>
                      {typeof marketDecision.context.documents_scanned === 'number' && (
                        <span className="text-[11px] text-slate-500">
                          Đã quét {marketDecision.context.documents_scanned} tài liệu công khai
                        </span>
                      )}
                    </div>
                    {marketDecision.scenario_sync_suggestion && (
                      <button
                        type="button"
                        onClick={handleApplyMarketSignalsToScenario}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs transition shrink-0"
                      >
                        <Sparkles size={13} />
                        Áp dụng tín hiệu Đà Nẵng sang Kịch bản [C]
                      </button>
                    )}
                  </div>

                  {marketDecision.scenario_sync_suggestion && (
                    <p className="text-[11px] text-slate-600 dark:text-slate-300">
                      <strong>Gợi ý đồng bộ [C]:</strong> {marketDecision.scenario_sync_suggestion.reason_vi}
                    </p>
                  )}

                  {marketSyncNotice && (
                    <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-800 dark:text-emerald-200 font-medium">
                      {marketSyncNotice}
                    </div>
                  )}

                  {(() => {
                    const factsList = marketDecision.context.all_extracted_facts ?? marketDecision.context.facts ?? [];
                    if (factsList.length === 0) {
                      return (
                        <p className="text-[11px] text-slate-500">
                          Chưa tìm thấy đoạn văn nào có ngày cụ thể và địa điểm Đà Nẵng khớp điều kiện chống suy diễn từ các nguồn công khai đã tải hôm nay.
                        </p>
                      );
                    }
                    return (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {factsList.slice(0, 6).map((fact, idx) => (
                          <div
                            key={`${fact.source_id}-${fact.start_date}-${idx}`}
                            className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-1"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-1.5">
                              <span className="font-semibold text-slate-900 dark:text-white truncate max-w-[70%]">
                                {fact.title}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  fact.matches_target_date === false
                                    ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                                }`}
                              >
                                {fact.fact_type} · {fact.event_status}
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-sky-700 dark:text-sky-300">
                              {fact.location_quote} · {fact.start_date} → {fact.end_date}{' '}
                              {fact.matches_target_date === false ? '(Ngoài ngày check-in)' : '(Trùng ngày check-in)'}
                            </div>
                            <p className="text-[11px] italic text-slate-600 dark:text-slate-400 line-clamp-2">
                              “{fact.quote}”
                            </p>
                            <div className="text-[10px] text-slate-400 font-mono">
                              source: {fact.source_id}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {marketDecision.blockers.length > 0 && (
                  <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 space-y-1">
                    <div className="font-bold text-amber-900 dark:text-amber-200">
                      Cổng an toàn đang chặn suy luận tự động ({marketDecision.blockers.length}):
                    </div>
                    {marketDecision.blockers.map((blocker, idx) => (
                      <div key={idx} className="text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
                        <ShieldAlert size={13} className="shrink-0 mt-0.5" />
                        <span>{blocker}</span>
                      </div>
                    ))}
                  </div>
                )}

                {Array.isArray(marketDecision.evidence.sources) && marketDecision.evidence.sources.length > 0 && (
                  <div className="space-y-2">
                    <div className="font-semibold text-slate-700 dark:text-slate-300">
                      Trạng thái các nguồn công khai đã kiểm tra ({marketDecision.evidence.sources.length}):
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {marketDecision.evidence.sources.map((src) => (
                        <div
                          key={src.source_id}
                          className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex items-start justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 dark:text-white truncate">{src.name}</div>
                            <div className="text-[11px] text-slate-500 break-words">{src.detail || src.url}</div>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold shrink-0 ${
                              src.status === 'fetched' || src.status === 'cached'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                                : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                            }`}
                          >
                            {src.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {marketDecision.limitations.length > 0 && (
                  <div className="text-[11px] text-slate-500 space-y-0.5">
                    {marketDecision.limitations.map((lim, idx) => (
                      <div key={idx}>• {lim}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Academic Q&A */}
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Calculator size={20} className="text-teal-600" />
              Giải Thích Nghiệp Vụ & Nguồn Gốc Dữ Liệu
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs sm:text-sm">
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <h4 className="font-bold text-slate-900 dark:text-white mb-1">
                  1. Giá thay đổi vì những tín hiệu nào?
                </h4>
                <p className="text-slate-600 dark:text-slate-300">
                  Giá được tổng hợp minh bạch từ tồn kho thực tế 54 phòng của White Sand Boutique Hotel, giả định kịch bản thị trường (nhu cầu, thời tiết, đối thủ), mốc tham chiếu ML lịch sử và ranh giới trần/sàn quy định.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <h4 className="font-bold text-slate-900 dark:text-white mb-1">
                  2. Yếu tố nào được AI học từ dữ liệu?
                </h4>
                <p className="text-slate-600 dark:text-slate-300">
                  Chỉ <strong>ML ADR Benchmark</strong> và <strong>Mô hình rủi ro hủy</strong> được huấn luyện từ tập dữ liệu lịch sử Bồ Đào Nha (119k booking). Không tuyên bố ML đã học phản ứng giá thực tại thị trường Đà Nẵng.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <h4 className="font-bold text-slate-900 dark:text-white mb-1">
                  3. Yếu tố nào là giả định mô phỏng?
                </h4>
                <p className="text-slate-600 dark:text-slate-300">
                  Nhu cầu thị trường (Low/Normal/High/Surge), thời tiết mưa bão Đà Nẵng và mức giá đối thủ là <strong>SIMULATED ASSUMPTION</strong> do người vận hành thiết lập để kiểm thử kịch bản.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <h4 className="font-bold text-slate-900 dark:text-white mb-1">
                  4. Vì sao có cả Trần Giá Kê Khai và Giá Sàn Biến Phí?
                </h4>
                <p className="text-slate-600 dark:text-slate-300">
                  <strong>Trần kê khai</strong> ngăn giá trước coupon vượt mức niêm yết công khai từng hạng phòng; <strong>Contribution Margin Floor</strong> bảo đảm doanh thu thuần không thấp hơn biến phí phục vụ (C_serve) trên bất kỳ room-night nào.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: OR-TOOLS CP-SAT LIVE ROOM ALLOCATION                          */}
      {/* ===================================================================== */}
      {activeTab === 'allocation' && (
        <div className="space-y-6">
          {/* 1. Primary Real DB Booking Queue + Safe Ledger Reassignment */}
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-teal-200 dark:border-teal-900/60 shadow-sm space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CalendarRange size={18} className="text-teal-600" />
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    Hàng Đợi Booking Thực Từ PostgreSQL &amp; Áp Dụng Phân Bổ An Toàn
                  </h2>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200 font-bold">
                    (B) Live DB + (D) OR-Tools CP-SAT
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed max-w-3xl">
                  Đọc trực tiếp các booking <code className="font-mono">Confirmed</code> đang giữ chỗ trong cửa sổ lưu trú, tính phương án phân phòng/nâng hạng không hạ cấp bằng Google OR-Tools và ghi thẳng vào ledger <code className="font-mono">booking_details</code> qua <code className="font-mono">reassign-room</code> (khóa lạc quan version + idempotency).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Link
                  href="/admin/housekeeping?tab=ai-upgrades"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 text-purple-800 dark:text-purple-200 text-xs font-semibold hover:bg-purple-100 dark:hover:bg-purple-950/70 transition"
                >
                  <Sparkles size={14} />
                  <span>Gợi ý Nâng hạng Buồng phòng</span>
                  <ExternalLink size={12} />
                </Link>
                <Link
                  href="/admin/tape-chart"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                >
                  <span>Sơ đồ Tape Chart</span>
                  <ExternalLink size={12} />
                </Link>
              </div>
            </div>

            {queueError && (
              <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2.5">
                <AlertCircle size={16} className="shrink-0" />
                <span>{queueError}</span>
              </div>
            )}
            {queueNotice && (
              <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2.5">
                <CheckCircle2 size={16} className="shrink-0" />
                <span>{queueNotice}</span>
              </div>
            )}

            {/* Filter & Action Toolbar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-4 text-xs items-end">
              <div>
                <label className="text-slate-500 font-semibold block mb-1">Từ ngày (Check-out &gt;):</label>
                <input
                  type="date"
                  value={queueStartDate}
                  onChange={(e) => setQueueStartDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="text-slate-500 font-semibold block mb-1">Đến ngày (Check-in &lt;):</label>
                <input
                  type="date"
                  value={queueEndDate}
                  onChange={(e) => setQueueEndDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-slate-900 dark:text-white"
                />
              </div>
              <div className="flex items-center pb-2">
                <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-200 select-none">
                  <input
                    type="checkbox"
                    checked={queueAllowUpgrades}
                    onChange={(e) => setQueueAllowUpgrades(e.target.checked)}
                    className="rounded border-slate-400 accent-teal-600"
                  />
                  <span>Cho phép nâng hạng (chặn hạ cấp)</span>
                </label>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => void loadRealQueue()}
                  disabled={queueLoading || applyingBatch}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 font-semibold transition inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw size={14} className={queueLoading ? 'animate-spin' : ''} />
                  {queueLoading ? 'Đang tải hàng đợi...' : 'Tải hàng đợi từ DB'}
                </button>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => void handleOptimizeRealQueue()}
                  disabled={queueOptimizing || queueLoading || applyingBatch}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold transition inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {queueOptimizing ? <LoaderCircle size={14} className="animate-spin" /> : <Cpu size={14} />}
                  {queueOptimizing ? 'Đang giải tối ưu...' : 'Giải tối ưu hàng đợi thực'}
                </button>
              </div>
            </div>

            {/* Active Queue Snapshot */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  Tổng số booking hiệu lực trong cửa sổ:{' '}
                  <strong className="text-slate-900 dark:text-white">{queueItems.length}</strong>{' '}
                  ({queueItems.filter((i) => i.can_optimize).length} <code className="font-mono">Confirmed</code> có thể tối ưu ·{' '}
                  {queueItems.filter((i) => !i.can_optimize).length} <code className="font-mono">CheckedIn/Pending</code> giữ khóa)
                </span>
                {queueBusinessDate && (
                  <span className="font-mono text-[11px]">Business date: {queueBusinessDate}</span>
                )}
              </div>

              {queueLoading && queueItems.length === 0 ? (
                <div className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-800/40 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                  <LoaderCircle size={15} className="animate-spin" />
                  Đang truy vấn hàng đợi booking thực từ PostgreSQL...
                </div>
              ) : queueItems.length === 0 ? (
                <div className="p-6 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center space-y-2 text-xs">
                  <p className="font-semibold text-slate-700 dark:text-slate-200">
                    Chưa có booking hiệu lực nào trong khoảng {queueStartDate} → {queueEndDate}.
                  </p>
                  <p className="text-slate-500 max-w-xl mx-auto">
                    Hệ thống chỉ tối ưu trên các booking <code className="font-mono">Confirmed</code> đơn phòng còn hoạt động. Bạn có thể tạo booking thử nghiệm mới trên trang đặt phòng hoặc mở rộng ngày bắt đầu lùi về quá khứ để kiểm tra dữ liệu hiện có.
                  </p>
                  <div className="pt-1 flex flex-wrap justify-center gap-2">
                    <Link
                      href="/book"
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800 transition"
                    >
                      Đặt booking kiểm thử tại /book
                      <ExternalLink size={12} />
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-500">
                      <tr>
                        <th className="p-2.5">Booking / Khách</th>
                        <th className="p-2.5">Phòng hiện tại</th>
                        <th className="p-2.5">Lưu trú &amp; Khách</th>
                        <th className="p-2.5">Trạng thái buồng</th>
                        <th className="p-2.5 text-right">Giá trị</th>
                        <th className="p-2.5 text-right">Quyền tối ưu</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {queueItems.map((item) => (
                        <tr key={item.booking_id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                          <td className="p-2.5">
                            <div className="font-mono text-[11px] text-slate-500">#{item.booking_id.slice(0, 8).toUpperCase()}</div>
                            <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                              <span>{item.customer_name}</span>
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-[10px] font-bold">
                                {item.loyalty_tier}
                              </span>
                            </div>
                          </td>
                          <td className="p-2.5">
                            <span className="font-mono font-bold text-slate-900 dark:text-white">
                              P.{item.current_room_number}
                            </span>
                            <span className="block text-[11px] text-slate-500">
                              {item.current_type_name} · assign v{item.room_assignment_version}
                            </span>
                          </td>
                          <td className="p-2.5 whitespace-nowrap">
                            <div>{item.check_in_date} → {item.check_out_date}</div>
                            <span className="text-[11px] text-slate-500">
                              {item.nights} đêm · {item.guest_count} khách
                            </span>
                          </td>
                          <td className="p-2.5">
                            <span className="font-mono">{item.room_current_status} · {item.housekeeping_status}</span>
                            {item.requires_ready_now && (
                              <span className="block text-[10px] text-amber-600 dark:text-amber-400 font-semibold">
                                Lưu trú hôm nay (bắt buộc Ready)
                              </span>
                            )}
                          </td>
                          <td className="p-2.5 text-right font-mono tabular-nums">
                            {formatVND(item.total_price)}
                          </td>
                          <td className="p-2.5 text-right">
                            {item.can_optimize ? (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[10px] font-bold">
                                Confirmed · Giải OR-Tools
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200 text-[10px] font-bold">
                                {item.status} (Khóa cố định)
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Real Queue Solver Output + Apply Buttons */}
            {queueOptResult && (
              <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="px-2.5 py-1 rounded-full bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-200 font-mono font-bold">
                      {queueOptResult.status} ({queueOptResult.solver_time_ms}ms)
                    </span>
                    <span className="text-slate-600 dark:text-slate-300">
                      Đã xét <strong>{queueOptResult.evaluated_bookings}</strong> booking · Đề xuất đổi phòng:{' '}
                      <strong>{queueOptResult.changed_count}</strong> ({queueOptResult.upgrade_count} nâng hạng) · Khóa giữ lân cận:{' '}
                      <strong>{queueOptResult.existing_occupancy_count}</strong>
                    </span>
                  </div>

                  {queueOptResult.changed_count > 1 && (
                    <button
                      type="button"
                      onClick={() => void handleApplyAllQueueChanges()}
                      disabled={applyingBatch || Boolean(applyingBookingId)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition disabled:opacity-50"
                    >
                      {applyingBatch ? <LoaderCircle size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                      Áp dụng tất cả thay đổi ({queueOptResult.changed_count})
                    </button>
                  )}
                </div>

                {queueOptResult.recommendations.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {queueOptResult.recommendations.map((rec) => {
                      const isBusy = applyingBookingId === rec.booking_id;
                      return (
                        <div
                          key={rec.booking_id}
                          className={`p-4 rounded-2xl border space-y-3 text-xs ${
                            rec.status !== 'ASSIGNED'
                              ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900'
                              : rec.changed
                                ? 'bg-teal-50/60 dark:bg-teal-950/25 border-teal-300 dark:border-teal-800'
                                : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                                <span>{rec.customer_name}</span>
                                <span className="font-mono text-[11px] text-slate-500">
                                  #{rec.booking_id.slice(0, 8).toUpperCase()}
                                </span>
                                <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[10px]">
                                  {rec.loyalty_tier}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                {rec.check_in_date} → {rec.check_out_date} ({rec.nights} đêm · {rec.guest_count} khách · assign v{rec.expected_assignment_version})
                              </div>
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                                rec.status !== 'ASSIGNED'
                                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
                                  : rec.is_upgrade
                                    ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200'
                                    : rec.changed
                                      ? 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200'
                                      : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                              }`}
                            >
                              {rec.status !== 'ASSIGNED'
                                ? 'Chờ Ready/Hết chỗ'
                                : rec.is_upgrade
                                  ? 'Nâng hạng miễn phí'
                                  : rec.changed
                                    ? 'Đổi phòng tối ưu'
                                    : 'Giữ nguyên tối ưu'}
                            </span>
                          </div>

                          <div className="flex items-center justify-between rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-2.5">
                            <div>
                              <span className="text-[10px] uppercase text-slate-400 block">Hiện tại</span>
                              <strong className="text-slate-900 dark:text-white">P.{rec.current_room.room_number}</strong>
                              <span className="block text-[11px] text-slate-500">{rec.current_room.type_name}</span>
                            </div>
                            <ArrowRight size={16} className={rec.changed ? 'text-teal-600' : 'text-slate-400'} />
                            <div className="text-right">
                              <span className="text-[10px] uppercase text-slate-400 block">OR-Tools Đề Xuất</span>
                              {rec.recommended_room ? (
                                <>
                                  <strong className="text-teal-700 dark:text-teal-300">
                                    P.{rec.recommended_room.room_number}
                                  </strong>
                                  <span className="block text-[11px] text-slate-500">
                                    {rec.recommended_room.type_name}
                                  </span>
                                </>
                              ) : (
                                <strong className="text-rose-600">Chưa thể gán</strong>
                              )}
                            </div>
                          </div>

                          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                            {rec.reason_vi}
                            {rec.upgrade_delta_value > 0 && (
                              <span className="ml-1 font-semibold text-purple-700 dark:text-purple-300">
                                (+{formatVND(rec.upgrade_delta_value)} giá trị hạng)
                              </span>
                            )}
                          </p>

                          {rec.changed && rec.recommended_room && (
                            <div className="flex justify-end pt-1">
                              <button
                                type="button"
                                onClick={() => void handleApplyQueueRecommendation(rec)}
                                disabled={isBusy || applyingBatch || Boolean(applyingBookingId)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs transition disabled:opacity-50"
                              >
                                {isBusy ? <LoaderCircle size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                                Áp dụng phân bổ vào Ledger
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {queueOptResult.audit_notes.length > 0 && (
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
                    {queueOptResult.audit_notes.map((note, idx) => (
                      <div key={idx}>• {note}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {allocationError && (
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 text-sm flex items-center gap-3">
              <AlertCircle size={20} className="shrink-0" />
              <span>{allocationError}</span>
            </div>
          )}

          {/* 2. Live PostgreSQL + OR-Tools CP-SAT Stress / Competing Demo */}
          <div className="p-6 rounded-3xl bg-slate-950 text-white shadow-xl space-y-6 border border-slate-800">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Database size={18} className="text-teal-400" />
                  <h2 className="text-lg sm:text-xl font-bold">
                    Mô Phỏng Tình Huống Cạnh Tranh Phòng (Live DB Benchmark + What-If)
                  </h2>
                </div>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-3xl">
                  Thử nghiệm đồng loạt 2–8 yêu cầu cạnh tranh dựa trên tồn kho 54 phòng thực tại PostgreSQL để đánh giá hiệu năng chống bán quá phòng trước khi triển khai ngoài thực tế.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleRunLiveAllocation()}
                  disabled={allocatingLive}
                  className="px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs sm:text-sm transition flex items-center gap-2 disabled:opacity-50"
                >
                  {allocatingLive ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {allocatingLive ? 'Đang giải từ DB thực...' : 'Chạy OR-Tools từ DB thực'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRunWhatIfAllocation()}
                  disabled={allocatingWhatIf}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs sm:text-sm transition flex items-center gap-2 disabled:opacity-50"
                >
                  {allocatingWhatIf ? <LoaderCircle size={16} className="animate-spin" /> : <Cpu size={16} />}
                  What-If: 3 khách tranh 2 phòng
                </button>
              </div>
            </div>

            {/* Parameters for Live Allocation */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 rounded-2xl bg-slate-900/70 border border-slate-800 p-4 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Hạng phòng yêu cầu:</label>
                <select
                  value={selectedRoomId}
                  onChange={(e) => handleRoomChange(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-100"
                >
                  {roomTypes.map((r) => (
                    <option key={r.type_id} value={r.type_id}>
                      {r.type_name} ({r.total_rooms} phòng)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Check-in:</label>
                <input
                  type="date"
                  value={checkInDate}
                  onChange={(e) => setCheckInDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-100"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Check-out:</label>
                <input
                  type="date"
                  value={checkOutDate}
                  onChange={(e) => setCheckOutDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-100"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Số yêu cầu cạnh tranh ({competingRequestCount}):</label>
                <input
                  type="range"
                  min={2}
                  max={8}
                  value={competingRequestCount}
                  onChange={(e) => setCompetingRequestCount(Number(e.target.value))}
                  className="w-full accent-teal-400 mt-2"
                />
              </div>
              <div className="flex items-center">
                <label className="inline-flex items-center gap-2 cursor-pointer text-slate-200 select-none">
                  <input
                    type="checkbox"
                    checked={allowUpgrades}
                    onChange={(e) => setAllowUpgrades(e.target.checked)}
                    className="rounded border-slate-600 accent-teal-400"
                  />
                  <span>Cho phép nâng hạng miễn phí khi hết hạng gốc</span>
                </label>
              </div>
            </div>

            {liveAllocationResult && (
              <div className="space-y-5 pt-4 border-t border-slate-800">
                {/* Live DB Snapshot Bar */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl bg-slate-900 border border-slate-800 p-3">
                    <span className="text-[11px] text-slate-400 block">Tổng phòng DB</span>
                    <strong className="text-xl font-bold text-white tabular-nums">
                      {liveAllocationResult.live_snapshot.total_rooms}
                    </strong>
                  </div>
                  <div className="rounded-xl bg-slate-900 border border-slate-800 p-3">
                    <span className="text-[11px] text-slate-400 block">Phòng có thể bán</span>
                    <strong className="text-xl font-bold text-emerald-400 tabular-nums">
                      {liveAllocationResult.live_snapshot.sellable_rooms}
                    </strong>
                  </div>
                  <div className="rounded-xl bg-slate-900 border border-slate-800 p-3">
                    <span className="text-[11px] text-slate-400 block">Đang bảo trì</span>
                    <strong className="text-xl font-bold text-amber-400 tabular-nums">
                      {liveAllocationResult.live_snapshot.maintenance_rooms}
                    </strong>
                  </div>
                  <div className="rounded-xl bg-slate-900 border border-slate-800 p-3">
                    <span className="text-[11px] text-slate-400 block">Lịch trùng đang giữ</span>
                    <strong className="text-xl font-bold text-sky-400 tabular-nums">
                      {liveAllocationResult.live_snapshot.existing_occupancy_count}
                    </strong>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="px-2.5 py-1 rounded-full bg-teal-950 border border-teal-500 text-teal-300 font-mono">
                    {liveAllocationResult.status} ({liveAllocationResult.solver_time_ms}ms)
                  </span>
                  <span className="text-slate-300">
                    Tổng doanh thu gán tối ưu:{' '}
                    <strong className="text-white">{formatVND(liveAllocationResult.total_assigned_revenue)}</strong>
                  </span>
                  <span className="text-[11px] text-slate-400 ml-auto font-mono">
                    {liveAllocationResult.live_snapshot.provenance}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {liveAllocationResult.assignments.map((a, idx) => (
                    <div
                      key={`${a.request_id}-${idx}`}
                      className={`p-3.5 rounded-xl border ${
                        a.status === 'ASSIGNED'
                          ? 'bg-teal-950/40 border-teal-800 text-teal-100'
                          : 'bg-rose-950/40 border-rose-800 text-rose-200'
                      }`}
                    >
                      <div className="flex justify-between items-center text-xs">
                        <strong className="truncate">{a.request_id}</strong>
                        {a.status === 'ASSIGNED' ? (
                          <CheckCircle2 size={16} className="text-teal-400 shrink-0" />
                        ) : (
                          <XCircle size={16} className="text-rose-400 shrink-0" />
                        )}
                      </div>
                      <div className="text-xs mt-2 text-slate-300">
                        Phòng gán: <strong>{a.room_number}</strong>
                        {a.is_upgrade && <span className="ml-1.5 text-amber-300 font-bold">(Được nâng hạng)</span>}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        {a.status === 'ASSIGNED'
                          ? 'Thỏa mãn ràng buộc sức chứa & không trùng lịch DB'
                          : 'Từ chối an toàn (hết sức chứa phù hợp)'}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300 space-y-1">
                  <div className="font-semibold text-slate-400">Nhật ký kiểm toán OR-Tools CP-SAT:</div>
                  {liveAllocationResult.audit_notes.map((note, i) => (
                    <div key={i}>• {note}</div>
                  ))}
                </div>
              </div>
            )}

            {/* What-If Companion Result */}
            {whatIfAllocationResult && (
              <div className="space-y-4 pt-5 border-t border-slate-800">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-bold text-amber-300">Kịch bản What-If (3 khách tranh 2 phòng):</span>
                  <span className="px-2 py-0.5 rounded bg-slate-800 font-mono text-teal-300">
                    {whatIfAllocationResult.status} ({whatIfAllocationResult.solver_time_ms}ms)
                  </span>
                  <span>
                    Tổng doanh thu: <strong>{formatVND(whatIfAllocationResult.total_assigned_revenue)}</strong>
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {whatIfAllocationResult.assignments.map((a, idx) => (
                    <div
                      key={`${a.request_id}-whatif-${idx}`}
                      className={`p-3 rounded-xl border ${
                        a.status === 'ASSIGNED'
                          ? 'bg-emerald-950/35 border-emerald-800 text-emerald-100'
                          : 'bg-rose-950/35 border-rose-800 text-rose-200'
                      }`}
                    >
                      <div className="flex justify-between items-center text-xs">
                        <strong className="truncate">{a.request_id}</strong>
                        {a.status === 'ASSIGNED' ? (
                          <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle size={15} className="text-rose-400 shrink-0" />
                        )}
                      </div>
                      <div className="text-xs mt-1.5 text-slate-300">
                        Phòng: <strong>{a.room_number}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 3. E3: OR-Tools CP-SAT Joint Multi-Night Portfolio Yield & Cross-Tier Upgrade Optimizer */}
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-900/60 shadow-sm space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Layers size={18} className="text-indigo-600" />
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    Tối Ưu Doanh Thu Đa Đêm 6 Hạng Phòng &amp; Shadow Price (OR-Tools CP-SAT)
                  </h2>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200 font-bold">
                    (A)+(B)+(C)+(D) Joint Portfolio Yield
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed max-w-3xl">
                  Giải bài toán phân bổ tồn kho 54 phòng thực tại PostgreSQL kết hợp thang giá đơn điệu 6 hạng phòng (<code className="font-mono">P[t] ≤ P[t+1]</code>), dòng nâng hạng miễn phí 1 bậc có kiểm soát chi phí hiếu khách và định giá bóng (<code className="font-mono">Shadow Price</code>) từng đêm nút thắt.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRunPortfolioOptimize()}
                disabled={portfolioLoading}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs sm:text-sm transition inline-flex items-center gap-2 shrink-0 disabled:opacity-50"
              >
                {portfolioLoading ? <LoaderCircle size={16} className="animate-spin" /> : <TrendingUp size={16} />}
                {portfolioLoading ? 'Đang giải CP-SAT toàn danh mục...' : 'Giải Tối Ưu Danh Mục 6 Hạng'}
              </button>
            </div>

            {portfolioError && (
              <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2.5">
                <AlertCircle size={16} className="shrink-0" />
                <span>{portfolioError}</span>
              </div>
            )}

            {/* Controls: [B] horizon, [C] scenario & elasticity, [D] cross-tier upgrade rule */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-4 text-xs items-end">
              <div>
                <label className="text-slate-500 font-semibold block mb-1">Ngày bắt đầu [B]:</label>
                <input
                  type="date"
                  value={portfolioStartDate}
                  onChange={(e) => setPortfolioStartDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="text-slate-500 font-semibold block mb-1">
                  Cửa sổ tối ưu ({portfolioHorizonDays} đêm):
                </label>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={portfolioHorizonDays}
                  onChange={(e) => setPortfolioHorizonDays(Number(e.target.value))}
                  className="w-full accent-indigo-600 mt-2"
                />
              </div>
              <div>
                <label className="text-slate-500 font-semibold block mb-1">Kịch bản nhu cầu [C]:</label>
                <select
                  value={portfolioScenarioId}
                  onChange={(e) => setPortfolioScenarioId(e.target.value as PortfolioScenarioId)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-slate-900 dark:text-white"
                >
                  <option value="monsoon_low">Mùa mưa thấp điểm [C]</option>
                  <option value="standard">Ngày thường ổn định [C]</option>
                  <option value="weekend_high">Cuối tuần cao điểm [C]</option>
                  <option value="holiday_surge">Lễ hội / Pháo hoa bùng nổ [C]</option>
                </select>
              </div>
              <div>
                <label className="text-slate-500 font-semibold block mb-1">
                  Độ co giãn giá β [C] ({portfolioElasticity.toFixed(2)}):
                </label>
                <input
                  type="range"
                  min={0.4}
                  max={2.4}
                  step={0.05}
                  value={portfolioElasticity}
                  onChange={(e) => setPortfolioElasticity(Number(e.target.value))}
                  className="w-full accent-indigo-600 mt-2"
                />
              </div>
              <div className="flex items-center pb-2">
                <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-200 select-none">
                  <input
                    type="checkbox"
                    checked={portfolioAllowUpgrades}
                    onChange={(e) => setPortfolioAllowUpgrades(e.target.checked)}
                    className="rounded border-slate-400 accent-indigo-600"
                  />
                  <span>Cho phép nâng 1 hạng [D]</span>
                </label>
              </div>
            </div>

            {portfolioResult && (
              <div className="space-y-5 pt-2">
                {/* Summary KPI Strip */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-500 block">Biên đóng góp Base Static [C]</span>
                    <strong className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">
                      {formatVND(portfolioResult.static_baseline_contribution_vnd)}
                    </strong>
                  </div>
                  <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900">
                    <span className="text-emerald-700 dark:text-emerald-300 block font-semibold">
                      Biên tối ưu CP-SAT [D] (+{portfolioResult.contribution_lift_pct.toFixed(1)}%)
                    </span>
                    <strong className="text-lg font-bold text-emerald-900 dark:text-emerald-100 tabular-nums">
                      {formatVND(portfolioResult.optimized_contribution_vnd)}
                    </strong>
                    <span className="text-[11px] text-emerald-700 dark:text-emerald-300 block">
                      Lift: +{formatVND(portfolioResult.contribution_lift_vnd)}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900">
                    <span className="text-purple-700 dark:text-purple-300 block font-semibold">
                      [A] Trọng số rủi ro hủy TB ({portfolioResult.ml_cancel_source})
                    </span>
                    <strong className="text-lg font-bold text-purple-900 dark:text-purple-100 tabular-nums">
                      {(portfolioResult.avg_ml_cancel_prob * 100).toFixed(1)}%
                    </strong>
                    <span className="text-[11px] text-purple-700 dark:text-purple-300 block">
                      Floor an toàn: {formatVND(portfolioResult.contribution_floor_vnd)}/đêm
                    </span>
                  </div>
                  <div className="p-3.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900">
                    <span className="text-indigo-700 dark:text-indigo-300 block font-semibold">
                      Nâng hạng &amp; Solver CP-SAT
                    </span>
                    <strong className="text-lg font-bold text-indigo-900 dark:text-indigo-100 tabular-nums">
                      {portfolioResult.total_upgraded_room_nights.toFixed(1)} room-nights
                    </strong>
                    <span className="text-[11px] text-indigo-700 dark:text-indigo-300 block font-mono">
                      {portfolioResult.status} · {portfolioResult.solver_time_ms}ms
                    </span>
                  </div>
                </div>

                {/* Shadow Prices Visualization */}
                {(() => {
                  const maxShadow = Math.max(
                    1,
                    ...portfolioResult.shadow_prices.map((s) => s.marginal_value_vnd_per_room),
                  );
                  return (
                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <strong className="text-slate-900 dark:text-white">
                          Giá Bóng Công Suất (Shadow Price — Giá trị biên nếu mở thêm 1 phòng ở đêm nút thắt)
                        </strong>
                        <span className="font-mono text-[11px] text-slate-500">
                          Perturbation sensitivity +1 phòng [D]
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
                        {portfolioResult.shadow_prices.map((sp) => {
                          const widthPct = Math.round((sp.marginal_value_vnd_per_room / maxShadow) * 100);
                          return (
                            <div
                              key={sp.type_id}
                              className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-1.5"
                            >
                              <div className="flex justify-between items-baseline gap-2">
                                <span className="font-semibold text-slate-900 dark:text-white truncate">
                                  {sp.type_name}
                                </span>
                                <span className="font-mono font-bold text-indigo-700 dark:text-indigo-300 shrink-0">
                                  +{formatVND(sp.marginal_value_vnd_per_room)}/phòng
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-indigo-500 transition-all"
                                  style={{ width: `${Math.max(widthPct, sp.marginal_value_vnd_per_room > 0 ? 6 : 0)}%` }}
                                />
                              </div>
                              <div className="flex justify-between text-[11px] text-slate-500">
                                <span>Nút thắt: {sp.bottleneck_night}</span>
                                <span>
                                  Công suất {sp.utilization_pct}% · Upgrade out {sp.upgraded_out_room_nights}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* 6-Tier x Night Matrix */}
                <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-500">
                      <tr>
                        <th className="p-2.5">Đêm lưu trú</th>
                        <th className="p-2.5">Hạng phòng</th>
                        <th className="p-2.5 text-right">Giá nền → Giá đề xuất</th>
                        <th className="p-2.5 text-right">Tồn trống / Đã đặt [B]</th>
                        <th className="p-2.5 text-right">Cầu kỳ vọng [C]</th>
                        <th className="p-2.5 text-right">Phân bổ &amp; Upgrade [D]</th>
                        <th className="p-2.5 text-right">Rủi ro hủy [A]</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {portfolioResult.decisions.map((cell) => (
                        <tr
                          key={`${cell.stay_date}-${cell.type_id}`}
                          className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
                        >
                          <td className="p-2.5 whitespace-nowrap font-mono">
                            {cell.stay_date}{' '}
                            {cell.is_weekend && (
                              <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 text-[10px] font-sans font-bold">
                                WKND
                              </span>
                            )}
                          </td>
                          <td className="p-2.5 font-semibold text-slate-900 dark:text-white">{cell.type_name}</td>
                          <td className="p-2.5 text-right tabular-nums whitespace-nowrap">
                            <span className="text-slate-400">{formatVND(cell.base_price_vnd)} → </span>
                            <strong className="text-slate-900 dark:text-white">
                              {formatVND(cell.recommended_price_vnd)}
                            </strong>
                            <span
                              className={`ml-1.5 font-mono text-[11px] font-bold ${
                                cell.price_change_pct > 0
                                  ? 'text-amber-600'
                                  : cell.price_change_pct < 0
                                    ? 'text-emerald-600'
                                    : 'text-slate-400'
                              }`}
                            >
                              {cell.price_change_pct > 0
                                ? `+${cell.price_change_pct}%`
                                : `${cell.price_change_pct}%`}
                            </span>
                          </td>
                          <td className="p-2.5 text-right font-mono">
                            {cell.available_rooms} trống / {cell.already_booked_rooms} đặt
                          </td>
                          <td className="p-2.5 text-right font-mono">{cell.expected_demand_rooms.toFixed(1)}</td>
                          <td className="p-2.5 text-right font-mono whitespace-nowrap">
                            <span>Giữ hạng: {cell.accepted_own_tier_rooms.toFixed(1)}</span>
                            {(cell.upgraded_out_rooms > 0 || cell.upgraded_in_rooms > 0) && (
                              <span className="block text-[10px] text-indigo-600 dark:text-indigo-300">
                                Up out: {cell.upgraded_out_rooms.toFixed(1)} · Up in: {cell.upgraded_in_rooms.toFixed(1)}
                              </span>
                            )}
                          </td>
                          <td className="p-2.5 text-right font-mono text-purple-700 dark:text-purple-300">
                            {(cell.ml_cancel_prob * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: OPERATIONAL STRESS-TEST SANDBOX                               */}
      {/* ===================================================================== */}
      {activeTab === 'sandbox' && (
        <div className="space-y-6">
          {sandboxError && (
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 text-sm flex items-center gap-3">
              <AlertCircle size={20} className="shrink-0" />
              <span>{sandboxError}</span>
            </div>
          )}

          {/* Scenario Preset Selector Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sandboxScenarios.map((sc) => {
              const selected = selectedSandboxId === sc.id;
              return (
                <div
                  key={sc.id}
                  onClick={() => setSelectedSandboxId(sc.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedSandboxId(sc.id);
                    }
                  }}
                  className={`p-5 rounded-2xl border cursor-pointer transition space-y-2 ${
                    selected
                      ? 'bg-purple-50 dark:bg-purple-950/35 border-purple-500 shadow-sm'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-purple-400'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200">
                      {sc.tag}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedSandboxId(sc.id);
                        void handleRunSandbox(sc.id);
                      }}
                      disabled={runningSandbox}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold transition disabled:opacity-50"
                    >
                      {runningSandbox && selectedSandboxId === sc.id ? (
                        <LoaderCircle size={13} className="animate-spin" />
                      ) : (
                        <Play size={13} />
                      )}
                      Chạy kịch bản
                    </button>
                  </div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm sm:text-base">{sc.title}</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{sc.summary}</p>
                </div>
              );
            })}
          </div>

          {/* Sandbox Run CTA if not yet executed */}
          {!sandboxResult && (
            <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center space-y-3">
              <FlaskConical size={28} className="mx-auto text-purple-500" />
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Chọn một kịch bản kiểm thử căng thẳng ở trên rồi bấm <strong>Chạy kịch bản</strong> để quan sát chuỗi suy luận, bộ giải OR-Tools và scorecard kiểm toán.
              </p>
              <button
                type="button"
                onClick={() => void handleRunSandbox()}
                disabled={runningSandbox}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold transition"
              >
                {runningSandbox ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} />}
                Chạy kịch bản đang chọn
              </button>
            </div>
          )}

          {/* Sandbox Execution Output */}
          {sandboxResult && (
            <div className="space-y-6">
              {/* Scorecard */}
              <div className="p-6 rounded-3xl bg-slate-950 text-white border border-slate-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-purple-300 font-semibold uppercase tracking-wider">
                      <Activity size={14} /> Scorecard Đánh Giá Kịch Bản
                    </div>
                    <h3 className="text-lg sm:text-xl font-bold mt-1">{sandboxResult.title}</h3>
                  </div>
                  <div className="text-right">
                    <span className="text-3xl font-bold font-mono text-emerald-400">
                      {sandboxResult.scorecard.overall_score}/100
                    </span>
                    <div className="text-[11px] text-slate-400">Thời gian chạy: {sandboxResult.duration_ms}ms</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                  <div className="rounded-xl bg-slate-900 border border-slate-800 p-3">
                    <span className="text-slate-400 block">Chống bán quá phòng</span>
                    <strong className="text-emerald-400 text-sm">
                      {sandboxResult.scorecard.zero_oversell_guarantee ? '100% Zero Oversell' : 'Cần kiểm tra'}
                    </strong>
                  </div>
                  <div className="rounded-xl bg-slate-900 border border-slate-800 p-3">
                    <span className="text-slate-400 block">An toàn giá sàn biến phí</span>
                    <strong className="text-slate-100">{sandboxResult.scorecard.floor_price_safety_rate}</strong>
                  </div>
                  <div className="rounded-xl bg-slate-900 border border-slate-800 p-3">
                    <span className="text-slate-400 block">Tác động RevPAR / Biên</span>
                    <strong className="text-amber-300">{sandboxResult.scorecard.revpar_impact}</strong>
                  </div>
                  <div className="rounded-xl bg-slate-900 border border-slate-800 p-3">
                    <span className="text-slate-400 block">Tuân thủ chính sách / Solver</span>
                    <strong className="text-sky-300">
                      {sandboxResult.scorecard.policy_compliance_rate} · {sandboxResult.scorecard.solver_efficiency}
                    </strong>
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed border-t border-slate-800 pt-3">
                  {sandboxResult.scorecard.academic_summary}
                </p>
              </div>

              {/* Event Timeline */}
              <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
                <h4 className="font-bold text-slate-900 dark:text-white text-base">
                  Diễn Tiến Kịch Bản Từng Bước (Simulated Event Trace)
                </h4>
                <div className="space-y-3">
                  {sandboxResult.timeline.map((step) => {
                    const badge = PROVENANCE_BADGE_MAP[step.provenance_tag];
                    return (
                      <div
                        key={step.step_id}
                        className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-bold text-purple-600 dark:text-purple-300">
                              {step.timestamp_offset}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-mono text-[10px]">
                              {step.actor}
                            </span>
                            <span className="font-bold text-slate-900 dark:text-white">{step.title}</span>
                          </div>
                          {badge && (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${badge.className}`}>
                              {badge.label}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{step.detail_vi}</p>
                        {step.metrics_snapshot && Object.keys(step.metrics_snapshot).length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {Object.entries(step.metrics_snapshot).map(([k, v]) => (
                              <span
                                key={k}
                                className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-[10px] text-slate-600 dark:text-slate-300"
                              >
                                {k}: {Array.isArray(v) ? v.join(', ') : String(v)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
