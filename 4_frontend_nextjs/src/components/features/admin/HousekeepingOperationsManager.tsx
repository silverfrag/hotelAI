'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BedDouble,
  CheckCircle2,
  Clock,
  Filter,
  Layers,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  TrendingUp,
  UserCheck,
  Zap,
} from 'lucide-react';
import { PageContainer } from '@/components/common/PageContainer';
import { PageHeader } from '@/components/common/PageHeader';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  Input,
  Select,
  Skeleton,
} from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import {
  executeAdminUpgrade,
  getAdminHousekeeping,
  getAdminUpgradeRecommendations,
  updateAdminHousekeepingStatus,
} from '@/services/admin.service';
import type {
  AdminHousekeepingQueueItem,
  HousekeepingStatus,
  SmartUpgradeRecommendation,
} from '@/types/admin.type';
import { formatCurrency } from '@/utils/formatCurrency';

type Tab = 'housekeeping' | 'ai-upgrades';

type ZoneFilter = 'all' | 'floor1' | 'floor2' | 'floor3' | 'floor4' | 'floor5' | 'villas' | 'penthouses';

export function HousekeepingOperationsManager() {
  const { session } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('housekeeping');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [successNotice, setSuccessNotice] = useState('');

  // Housekeeping state
  const [rooms, setRooms] = useState<AdminHousekeepingQueueItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<HousekeepingStatus | 'all'>('all');
  const [zoneFilter, setZoneFilter] = useState<ZoneFilter>('all');

  // AI Upgrades state
  const [recommendations, setRecommendations] = useState<SmartUpgradeRecommendation[]>([]);
  const [upgradingId, setUpgradingId] = useState<string | null>(null);

  // Status Change Dialog
  const [targetRoom, setTargetRoom] = useState<AdminHousekeepingQueueItem | null>(null);
  const [targetStatus, setTargetStatus] = useState<HousekeepingStatus | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);

  const loadData = useCallback(async (isSilent = false) => {
    if (!session?.accessToken) return;
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    setError('');

    try {
      const [housekeepingPage, upgradeList] = await Promise.all([
        getAdminHousekeeping(session.accessToken, { limit: 100 }),
        getAdminUpgradeRecommendations(session.accessToken),
      ]);
      setRooms(housekeepingPage.items);
      setRecommendations(upgradeList);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể tải dữ liệu vận hành buồng phòng.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.accessToken]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Housekeeping metrics
  const totalRooms = rooms.length;
  const readyRooms = useMemo(() => rooms.filter((r) => r.housekeeping_status === 'Ready').length, [rooms]);
  const cleaningRooms = useMemo(() => rooms.filter((r) => r.housekeeping_status === 'Cleaning').length, [rooms]);
  const dirtyRooms = useMemo(() => rooms.filter((r) => r.housekeeping_status === 'Dirty').length, [rooms]);

  // Filtered rooms
  const filteredRooms = useMemo(() => {
    return rooms.filter((r) => {
      if (statusFilter !== 'all' && r.housekeeping_status !== statusFilter) return false;
      const num = r.room_number;
      if (zoneFilter === 'floor1') return num.startsWith('1');
      if (zoneFilter === 'floor2') return num.startsWith('2');
      if (zoneFilter === 'floor3') return num.startsWith('3');
      if (zoneFilter === 'floor4') return num.startsWith('4');
      if (zoneFilter === 'floor5') return num.startsWith('5');
      if (zoneFilter === 'villas') return num.startsWith('V') || num.startsWith('PV');
      if (zoneFilter === 'penthouses') return num.startsWith('P') && !num.startsWith('PV');
      return true;
    });
  }, [rooms, statusFilter, zoneFilter]);

  // Execute quick housekeeping transition
  const handleOpenStatusDialog = (room: AdminHousekeepingQueueItem, nextStatus: HousekeepingStatus) => {
    setTargetRoom(room);
    setTargetStatus(nextStatus);
    if (nextStatus === 'Cleaning') {
      setStatusReason('Bắt đầu dọn buồng và thay drap trải giường theo quy trình.');
    } else if (nextStatus === 'Ready') {
      setStatusReason('Đã vệ sinh, kiểm tra minibar và sẵn sàng đón khách lưu trú.');
    } else {
      setStatusReason('Khách trả phòng / cần dọn dẹp buồng phòng định kỳ.');
    }
  };

  const handleConfirmStatusChange = async () => {
    if (!session?.accessToken || !targetRoom || !targetStatus) return;
    setSavingStatus(true);
    setError('');

    try {
      const idempotencyKey = `hk-${targetRoom.room_id}-${Date.now()}`;
      await updateAdminHousekeepingStatus(
        session.accessToken,
        targetRoom.room_id,
        {
          target_status: targetStatus,
          expected_version: targetRoom.housekeeping_version,
          reason: statusReason || 'Cập nhật từ bảng điều phối buồng phòng.',
        },
        idempotencyKey,
      );
      setSuccessNotice(`Đã chuyển phòng ${targetRoom.room_number} sang trạng thái ${targetStatus}.`);
      setTargetRoom(null);
      setTargetStatus(null);
      await loadData(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể cập nhật trạng thái phòng.');
    } finally {
      setSavingStatus(false);
    }
  };

  // Execute AI Smart Upgrade
  const handleExecuteUpgrade = async (rec: SmartUpgradeRecommendation) => {
    if (!session?.accessToken) return;
    setUpgradingId(rec.booking_id);
    setError('');

    try {
      const idempotencyKey = `upgrade-${rec.booking_id}-${Date.now()}`;
      await executeAdminUpgrade(
        session.accessToken,
        {
          booking_id: rec.booking_id,
          target_room_id: rec.recommended_room.room_id,
          expected_assignment_version: rec.expected_assignment_version,
          reason: `AI Smart Upgrade: ${rec.occupancy_boost_reason}`,
        },
        idempotencyKey,
      );
      setSuccessNotice(
        `Nâng hạng thành công cho khách ${rec.customer_name}: từ phòng ${rec.current_room.room_number} lên ${rec.recommended_room.room_number} (${rec.recommended_room.type_name})!`,
      );
      await loadData(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể thực hiện nâng hạng phòng.');
    } finally {
      setUpgradingId(null);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Điều Phối Buồng Phòng & AI Nâng Hạng"
        description="Quản trị luân chuyển 98 phòng resort và tối ưu hóa doanh thu (Yield Upsell) qua Lõi Khuyến Nghị AI Nâng Hạng Phòng Thông Minh."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadData(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-2 border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
          >
            <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Làm mới</span>
          </Button>
        }
      />

      {/* Notices */}
      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-300">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-400" />
          <p>{error}</p>
        </div>
      )}

      {successNotice && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-300">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
          <div className="flex-1">
            <p>{successNotice}</p>
          </div>
          <button
            onClick={() => setSuccessNotice('')}
            className="text-emerald-400 hover:text-emerald-200 text-xs uppercase tracking-wider font-semibold"
          >
            Đóng
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="border-white/[0.08] bg-[#111622]/80 backdrop-blur-md">
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Tổng Quy Mô</p>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-white">{totalRooms || 98}</span>
              <span className="text-xs text-slate-400">Phòng resort</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-emerald-500/20 bg-emerald-950/20 backdrop-blur-md">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-emerald-400">Sẵn Sàng (Ready)</p>
              <span className="flex size-2 rounded-full bg-emerald-400" />
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-emerald-300">{readyRooms}</span>
              <span className="text-xs font-semibold text-emerald-400/80">
                {totalRooms ? Math.round((readyRooms / totalRooms) * 100) : 0}%
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-amber-500/20 bg-amber-950/20 backdrop-blur-md">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-amber-400">Đang Dọn (Cleaning)</p>
              <Clock className="size-3.5 text-amber-400" />
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-amber-300">{cleaningRooms}</span>
              <span className="text-xs font-semibold text-amber-400/80">
                {totalRooms ? Math.round((cleaningRooms / totalRooms) * 100) : 0}%
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-rose-500/20 bg-rose-950/20 backdrop-blur-md">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-rose-400">Cần Dọn (Dirty)</p>
              <span className="flex size-2 rounded-full bg-rose-400 animate-pulse" />
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-rose-300">{dirtyRooms}</span>
              <span className="text-xs font-semibold text-rose-400/80">
                {totalRooms ? Math.round((dirtyRooms / totalRooms) * 100) : 0}%
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs Navigation */}
      <div className="mb-6 flex border-b border-white/[0.08]">
        <button
          onClick={() => setActiveTab('housekeeping')}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-semibold transition-all ${
            activeTab === 'housekeeping'
              ? 'border-amber-500 text-amber-400 bg-amber-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="size-4" />
          <span>Sơ Đồ 98 Phòng Buồng Phòng</span>
          <span className="ml-1.5 rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-300">
            {rooms.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('ai-upgrades')}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-semibold transition-all ${
            activeTab === 'ai-upgrades'
              ? 'border-purple-500 text-purple-400 bg-purple-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles className="size-4 text-purple-400" />
          <span>AI Smart Upgrade & Tối Ưu Doanh Thu</span>
          {recommendations.length > 0 && (
            <span className="ml-1.5 rounded-full bg-purple-500/20 px-2 py-0.5 text-xs font-bold text-purple-300 border border-purple-500/30 animate-pulse">
              {recommendations.length}
            </span>
          )}
        </button>
      </div>

      {/* Tab 1: Housekeeping Dispatcher */}
      {activeTab === 'housekeeping' && (
        <div className="space-y-6">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-[#111622]/60 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400 mr-2">
                <Filter className="size-3.5" /> Lọc Trạng Thái:
              </span>
              {(['all', 'Ready', 'Cleaning', 'Dirty'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    statusFilter === st
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5'
                  }`}
                >
                  {st === 'all' ? 'Tất cả' : st === 'Ready' ? 'Sẵn sàng' : st === 'Cleaning' ? 'Đang dọn' : 'Cần dọn'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Khu Vực:</span>
              <select
                value={zoneFilter}
                onChange={(e) => setZoneFilter(e.target.value as ZoneFilter)}
                className="rounded-lg border border-white/10 bg-[#161c2b] px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-amber-500"
              >
                <option value="all">Toàn bộ 98 phòng resort</option>
                <option value="floor1">Tầng 1 - Deluxe & Twin (101-120)</option>
                <option value="floor2">Tầng 2 - Deluxe & Twin (201-222)</option>
                <option value="floor3">Tầng 3 - Family Suite (301-316)</option>
                <option value="floor4">Tầng 4 - Executive Ocean (401-414)</option>
                <option value="floor5">Tầng 5 - Panoramic Sunrise (501-512)</option>
                <option value="villas">Khu Biệt Thự (V101-V108, PV01-PV02)</option>
                <option value="penthouses">Khu Penthouse Đỉnh Tháp (P601-P604)</option>
              </select>
            </div>
          </div>

          {/* Rooms Grid */}
          {loading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 18 }).map((_, idx) => (
                <Skeleton key={idx} className="h-28 w-full rounded-xl bg-white/5" />
              ))}
            </div>
          ) : filteredRooms.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.08] bg-[#111622] p-12 text-center">
              <p className="text-slate-400 text-sm">Không tìm thấy phòng nào phù hợp với bộ lọc hiện tại.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {filteredRooms.map((room) => {
                const isReady = room.housekeeping_status === 'Ready';
                const isCleaning = room.housekeeping_status === 'Cleaning';
                const isDirty = room.housekeeping_status === 'Dirty';

                return (
                  <div
                    key={room.room_id}
                    className={`flex flex-col justify-between rounded-xl border p-3 transition-all ${
                      isReady
                        ? 'border-emerald-500/20 bg-[#101918]/80 hover:border-emerald-500/40'
                        : isCleaning
                        ? 'border-amber-500/20 bg-[#1c1810]/80 hover:border-amber-500/40'
                        : 'border-rose-500/20 bg-[#1c1114]/80 hover:border-rose-500/40'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-base font-bold text-white">{room.room_number}</span>
                        <span
                          className={`inline-block size-2 rounded-full ${
                            isReady ? 'bg-emerald-400' : isCleaning ? 'bg-amber-400' : 'bg-rose-400 animate-pulse'
                          }`}
                        />
                      </div>
                      <p className="mt-1 truncate text-[11px] text-slate-400" title={room.type_name}>
                        {room.type_name}
                      </p>
                    </div>

                    <div className="mt-3 space-y-2">
                      <div className="flex items-center justify-between text-[10px]">
                        <span
                          className={`rounded px-1.5 py-0.5 font-semibold ${
                            isReady
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : isCleaning
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'bg-rose-500/15 text-rose-300'
                          }`}
                        >
                          {isReady ? 'Sẵn sàng' : isCleaning ? 'Đang dọn' : 'Cần dọn'}
                        </span>
                        <span className="text-slate-400 font-mono">v{room.housekeeping_version}</span>
                      </div>

                      {/* Action trigger */}
                      {isDirty && (
                        <button
                          onClick={() => handleOpenStatusDialog(room, 'Cleaning')}
                          className="w-full rounded bg-amber-500/15 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/25 border border-amber-500/30 transition-colors"
                        >
                          Bắt đầu dọn
                        </button>
                      )}
                      {isCleaning && (
                        <button
                          onClick={() => handleOpenStatusDialog(room, 'Ready')}
                          className="w-full rounded bg-emerald-500/15 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30 transition-colors"
                        >
                          Hoàn tất (Ready)
                        </button>
                      )}
                      {isReady && (
                        <button
                          onClick={() => handleOpenStatusDialog(room, 'Dirty')}
                          className="w-full rounded bg-white/5 py-1 text-[10px] text-slate-400 hover:bg-rose-500/15 hover:text-rose-300 transition-colors"
                        >
                          Báo phòng bẩn
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: AI Smart Upgrade & Revenue Optimization */}
      {activeTab === 'ai-upgrades' && (
        <div className="space-y-6">
          {/* AI Banner */}
          <div className="rounded-2xl border border-purple-500/20 bg-gradient-to-r from-purple-950/40 via-[#131124] to-[#121622] p-6">
            <div className="flex items-start gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-400">
                <Zap className="size-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span>Chiến Lược Tối Ưu Doanh Thu & Nâng Hạng Phòng Thông Minh (Yield Upsell)</span>
                  <span className="rounded bg-purple-500/20 px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold text-purple-300">
                    AI Active
                  </span>
                </h2>
                <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
                  Khi các hạng phòng tiêu chuẩn (Deluxe King, Premier Twin) có công suất cao, Lõi AI tự động quét và đề
                  xuất nâng hạng miễn phí/ưu đãi cho các đặt phòng phù hợp lên các hạng Suite cao cấp còn trống. Điều này
                  vừa tối đa hóa chỉ số hài lòng của khách (NPS), vừa <strong>giải phóng phòng tiêu chuẩn</strong> để đón
                  các lượt khách giờ chót với mức giá cao đỉnh điểm.
                </p>
              </div>
            </div>
          </div>

          {/* Recommendations List */}
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-32 w-full rounded-xl bg-white/5" />
              <Skeleton className="h-32 w-full rounded-xl bg-white/5" />
            </div>
          ) : recommendations.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.08] bg-[#111622] p-12 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mb-4">
                <CheckCircle2 className="size-6" />
              </div>
              <h3 className="text-base font-semibold text-white">Kho Phòng Đang Đạt Trạng Thái Phân Bổ Tối Ưu</h3>
              <p className="mt-1.5 text-xs text-slate-400 max-w-md mx-auto">
                Lõi AI chưa phát hiện xung đột công suất hoặc cơ hội thặng dư cần tái phân bổ trong 60 ngày tới.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {recommendations.map((rec) => {
                const isProcessing = upgradingId === rec.booking_id;

                return (
                  <Card
                    key={rec.booking_id}
                    className="border-white/[0.08] bg-[#111622]/90 hover:border-purple-500/30 transition-all backdrop-blur-md"
                  >
                    <CardHeader className="p-4 pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
                            <span>{rec.customer_name}</span>
                            <Badge variant="outline" className="text-[10px] font-mono border-white/10 text-slate-400">
                              {rec.booking_id.slice(0, 8)}…
                            </Badge>
                          </CardTitle>
                          <CardDescription className="text-xs text-slate-400 mt-0.5">
                            Lưu trú: {rec.check_in_date} → {rec.check_out_date} ({rec.nights} đêm, {rec.guest_count} khách)
                          </CardDescription>
                        </div>
                        <span className="rounded-full bg-purple-500/15 px-2.5 py-1 text-[11px] font-bold text-purple-300 border border-purple-500/25">
                          Độ tin cậy: {Math.round(rec.confidence_score * 100)}%
                        </span>
                      </div>
                    </CardHeader>

                    <CardContent className="p-4 pt-2 space-y-4">
                      {/* Flow Diagram */}
                      <div className="flex items-center justify-between rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 text-xs">
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-wider text-slate-400">Hiện tại</p>
                          <p className="font-bold text-slate-200 mt-0.5">Phòng {rec.current_room.room_number}</p>
                          <p className="text-[11px] text-slate-400 truncate">{rec.current_room.type_name}</p>
                        </div>

                        <div className="flex flex-col items-center px-2">
                          <span className="text-[10px] font-semibold text-purple-400 mb-0.5">AI UPGRADE</span>
                          <ArrowRight className="size-4 text-purple-400" />
                        </div>

                        <div className="min-w-0 text-right">
                          <p className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Nâng lên</p>
                          <p className="font-bold text-emerald-300 mt-0.5">Phòng {rec.recommended_room.room_number}</p>
                          <p className="text-[11px] text-emerald-400/90 truncate">{rec.recommended_room.type_name}</p>
                        </div>
                      </div>

                      {/* Upgrade Delta & Reason */}
                      <div className="flex items-center justify-between text-xs border-t border-white/[0.06] pt-3">
                        <div>
                          <p className="text-[10px] text-slate-400">Giá trị tặng thêm</p>
                          <p className="font-bold text-amber-400">{formatCurrency(rec.upgrade_delta_value)}</p>
                        </div>

                        <Button
                          size="sm"
                          onClick={() => void handleExecuteUpgrade(rec)}
                          disabled={isProcessing}
                          className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-lg shadow-purple-900/30"
                        >
                          {isProcessing ? (
                            <>
                              <LoaderCircle className="size-3.5 animate-spin" />
                              <span>Đang xử lý…</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="size-3.5" />
                              <span>Xác Nhận Nâng Hạng 1-Chạm</span>
                            </>
                          )}
                        </Button>
                      </div>

                      <p className="text-[11px] text-slate-400/90 italic leading-relaxed">
                        &ldquo;{rec.occupancy_boost_reason}&rdquo;
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Housekeeping Status Change Dialog */}
      {targetRoom && targetStatus && (
        <Dialog
          open={Boolean(targetRoom)}
          onClose={() => {
            if (!savingStatus) {
              setTargetRoom(null);
              setTargetStatus(null);
            }
          }}
          title={`Cập Nhật Trạng Thái: Phòng ${targetRoom.room_number}`}
        >
          <div className="space-y-4 pt-2">
            <p className="text-xs text-slate-300 leading-relaxed">
              Bạn đang chuyển trạng thái phòng <strong>{targetRoom.room_number}</strong> ({targetRoom.type_name}) từ{' '}
              <span className="font-semibold text-amber-400">{targetRoom.housekeeping_status}</span> sang{' '}
              <span className="font-semibold text-emerald-400">{targetStatus}</span>.
            </p>

            <div>
              <label className="text-xs font-semibold text-slate-300 mb-1.5 block">Lý do điều chuyển:</label>
              <Input
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
                placeholder="Nhập lý do chuyển trạng thái buồng phòng..."
                className="text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/[0.08]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTargetRoom(null);
                  setTargetStatus(null);
                }}
                disabled={savingStatus}
              >
                Hủy bỏ
              </Button>
              <Button
                size="sm"
                onClick={() => void handleConfirmStatusChange()}
                disabled={savingStatus}
                className="bg-amber-600 hover:bg-amber-500 text-white font-semibold"
              >
                {savingStatus ? (
                  <>
                    <LoaderCircle className="size-3.5 animate-spin mr-1.5" />
                    <span>Đang lưu…</span>
                  </>
                ) : (
                  <span>Lưu trạng thái</span>
                )}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </PageContainer>
  );
}
