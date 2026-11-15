'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ArrowUpDown,
  BedDouble,
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Filter,
  LogIn,
  LogOut,
  Mail,
  Phone,
  RefreshCw,
  Search,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { PageContainer } from '@/components/common/PageContainer';
import { PageHeader } from '@/components/common/PageHeader';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  Input,
  Select,
  Skeleton,
} from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import {
  checkInAdminBooking,
  checkOutAdminBooking,
  getAdminTapeChart,
  reassignAdminBookingRoom,
  updateAdminHousekeepingStatus,
} from '@/services/admin.service';

import type {
  HousekeepingStatus,
  TapeChartBookingSlot,
  TapeChartDayColumn,
  TapeChartMetrics,
  TapeChartRoomRow,
  TapeChartView,
} from '@/types/admin.type';
import { formatCurrency } from '@/utils/formatCurrency';

export function AdminTapeChart() {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [actionNotice, setActionNotice] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Filter & Timeline parameters
  const [startDate, setStartDate] = useState('');
  const [days, setDays] = useState(14);
  const [selectedRoomType, setSelectedRoomType] = useState<string>('all');
  const [selectedFloor, setSelectedFloor] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Loaded data
  const [chartData, setChartData] = useState<TapeChartView | null>(null);
  const chartRequest = useRef(0);

  // Interactive booking details modal
  const [activeBooking, setActiveBooking] = useState<{
    slot: TapeChartBookingSlot;
    room: TapeChartRoomRow;
  } | null>(null);

  // Reassignment sub-modal
  const [showReassign, setShowReassign] = useState(false);
  const [targetRoomId, setTargetRoomId] = useState<number | null>(null);
  const [actionProcessing, setActionProcessing] = useState(false);

  // Clear notice timer
  useEffect(() => {
    if (!actionNotice) return;
    const timer = setTimeout(() => setActionNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [actionNotice]);

  // Fetch tape chart data
  const loadChart = useCallback(async (isRefresh = false) => {
    const request = ++chartRequest.current;
    if (!session?.accessToken) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      // Keep the complete inventory for this bounded date window. Filtering the
      // response on the server also removes options needed to change filters.
      const params: { startDate?: string; days: number } = { days };
      if (startDate) params.startDate = startDate;

      const data = await getAdminTapeChart(session.accessToken, params);
      if (request !== chartRequest.current) return;
      setChartData(data);
    } catch (err: unknown) {
      if (request !== chartRequest.current) return;
      const msg = err instanceof Error ? err.message : 'Không thể tải sơ đồ phòng.';
      setError(msg);
    } finally {
      if (request === chartRequest.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [session?.accessToken, days, startDate]);

  useEffect(() => {
    void loadChart();
    return () => { chartRequest.current++; };
  }, [loadChart]);

  // Timeline date shift helpers
  const handleShiftDays = (delta: number) => {
    const currentStart = startDate || chartData?.startDate;
    if (!currentStart) return;
    const [y, m, d] = currentStart.split('-').map(Number);
    const cur = new Date(Date.UTC(y, m - 1, d));
    cur.setUTCDate(cur.getUTCDate() + delta);
    setStartDate(cur.toISOString().slice(0, 10));
  };

  const handleResetToday = () => {
    if (chartData?.businessDate) {
      setStartDate(chartData.businessDate);
    } else {
      setStartDate('');
    }
  };

  // Housekeeping status toggle
  const handleToggleHousekeeping = async (room: TapeChartRoomRow) => {
    if (!session?.accessToken || actionProcessing) return;
    const statusCycle: Record<string, HousekeepingStatus> = {
      Ready: 'Dirty',
      Dirty: 'Cleaning',
      Cleaning: 'Ready',
      Inspected: 'Ready',
      Maintenance: 'Ready',
    };
    const nextStatus = statusCycle[room.housekeepingStatus] || 'Ready';

    try {
      setActionProcessing(true);
      const idempotencyKey = `hk-${room.roomId}-${Date.now()}`;
      await updateAdminHousekeepingStatus(
        session.accessToken,
        room.roomId,
        {
          target_status: nextStatus,
          expected_version: room.housekeepingVersion,
          reason: 'Cập nhật từ Sơ đồ phòng Tape Chart',
        },
        idempotencyKey,
      );

      setActionNotice({
        text: `Phòng ${room.roomNumber}: Chuyển trạng thái buồng phòng sang "${nextStatus}".`,
        type: 'success',
      });
      loadChart(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi cập nhật buồng phòng.';
      setActionNotice({ text: msg, type: 'error' });
    } finally {
      setActionProcessing(false);
    }
  };

  // Check-in action
  const handleCheckIn = async (bookingId: string) => {
    if (!session?.accessToken || actionProcessing) return;
    try {
      setActionProcessing(true);
      await checkInAdminBooking(session.accessToken, bookingId);
      setActionNotice({ text: `Nhận phòng thành công cho booking ${bookingId.slice(0, 8)}...`, type: 'success' });
      setActiveBooking(null);
      loadChart(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi khi nhận phòng.';
      setActionNotice({ text: msg, type: 'error' });
    } finally {
      setActionProcessing(false);
    }
  };

  // Check-out action
  const handleCheckOut = async (bookingId: string) => {
    if (!session?.accessToken || actionProcessing) return;
    try {
      setActionProcessing(true);
      await checkOutAdminBooking(session.accessToken, bookingId);
      setActionNotice({ text: `Trả phòng thành công cho booking ${bookingId.slice(0, 8)}...`, type: 'success' });
      setActiveBooking(null);
      loadChart(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi khi trả phòng.';
      setActionNotice({ text: msg, type: 'error' });
    } finally {
      setActionProcessing(false);
    }
  };

  // Reassign room action
  const handleExecuteReassign = async () => {
    if (!session?.accessToken || !activeBooking || !targetRoomId || actionProcessing) return;
    try {
      setActionProcessing(true);
      const idempotencyKey = `reassign-${activeBooking.slot.bookingId}-${Date.now()}`;
      await reassignAdminBookingRoom(
        session.accessToken,
        activeBooking.slot.bookingId,
        {
          target_room_id: targetRoomId,
          expected_assignment_version: activeBooking.slot.roomAssignmentVersion,
          reason: 'Khách yêu cầu đổi phòng trực tiếp từ Tape Chart',
        },
        idempotencyKey,
      );


      setActionNotice({
        text: `Đã chuyển booking ${activeBooking.slot.bookingId.slice(0, 8)}... sang phòng mới thành công.`,
        type: 'success',
      });
      setShowReassign(false);
      setActiveBooking(null);
      setTargetRoomId(null);
      loadChart(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi khi đổi phòng.';
      setActionNotice({ text: msg, type: 'error' });
    } finally {
      setActionProcessing(false);
    }
  };

  // Extract unique room types for filtering
  const roomTypesList = useMemo(() => {
    if (!chartData?.rooms) return [];
    const map = new Map<number, string>();
    for (const r of chartData.rooms) {
      if (!map.has(r.roomTypeId)) {
        map.set(r.roomTypeId, r.roomTypeName);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [chartData?.rooms]);

  // Extract floors for filtering
  const floorsList = useMemo(() => {
    if (!chartData?.rooms) return [];
    const set = new Set<number>();
    for (const r of chartData.rooms) {
      set.add(r.floor);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [chartData?.rooms]);

  // Filtered rooms list
  const displayRooms = useMemo(() => {
    if (!chartData?.rooms) return [];
    return chartData.rooms.filter((room) => {
      if (selectedRoomType !== 'all' && room.roomTypeId !== Number(selectedRoomType)) return false;
      if (selectedFloor !== 'all' && room.floor !== Number(selectedFloor)) return false;
      // Status filter
      if (selectedStatus === 'occupied' && room.currentStatus !== 'Occupied') return false;
      if (selectedStatus === 'available' && room.currentStatus !== 'Available') return false;
      if (selectedStatus === 'dirty' && room.housekeepingStatus !== 'Dirty') return false;

      // Search query (matches room number or customer name)
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchRoom = room.roomNumber.toLowerCase().includes(q) || room.roomTypeName.toLowerCase().includes(q);
        const matchBooking = Object.values(room.slots).some(
          (s) => s && (s.customerName.toLowerCase().includes(q) || s.bookingId.toLowerCase().includes(q)),
        );
        if (!matchRoom && !matchBooking) return false;
      }

      return true;
    });
  }, [chartData?.rooms, selectedRoomType, selectedFloor, selectedStatus, searchQuery]);

  // Available rooms of the same type for reassignment
  const availableTargetRooms = useMemo(() => {
    if (!chartData?.rooms || !activeBooking) return [];
    const curRoomId = activeBooking.room.roomId;
    const curTypeId = activeBooking.room.roomTypeId;
    return chartData.rooms.filter(
      (r) => r.roomId !== curRoomId && r.roomTypeId === curTypeId && r.housekeepingStatus === 'Ready',
    );
  }, [chartData?.rooms, activeBooking]);

  return (
    <PageContainer>
      <div className="space-y-6 pb-12">
        {/* Page Header */}
        <PageHeader
          title="Sơ đồ phòng (Room Tape Chart)"
          description="Theo dõi danh sách phòng, điều phối nhận/trả phòng và xem lịch lưu trú theo ngày."
          actions={
            <div className="flex items-center gap-2.5">
              <Badge variant="primary" className="gap-1.5 px-3 py-1 font-semibold uppercase tracking-wider text-xs">
                <Sparkles className="h-3.5 w-3.5 text-amber-300 animate-pulse" />
                Live Room Rack
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadChart(true)}
                disabled={refreshing || loading}
                className="gap-2 border-slate-700 bg-slate-900/50 hover:bg-slate-800"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin text-amber-400' : ''}`} />
                Làm mới dữ liệu
              </Button>
            </div>
          }
        />


        {/* Action Notice Banner */}
        {actionNotice && (
          <div
            className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm font-medium transition-all ${
              actionNotice.type === 'success'
                ? 'border border-emerald-500/30 bg-emerald-950/60 text-emerald-200'
                : 'border border-rose-500/30 bg-rose-950/60 text-rose-200'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {actionNotice.type === 'success' ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="h-5 w-5 text-rose-400 shrink-0" />
              )}
              <span>{actionNotice.text}</span>
            </div>
            <button
              onClick={() => setActionNotice(null)}
              className="rounded-md p-1 hover:bg-white/10 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Current property-wide metrics; timeline filters only change rows. */}
        {chartData && !loading && !error && (
          <section aria-label="Tình trạng hiện tại toàn khách sạn" className="space-y-3">
            <p className="text-xs text-slate-400">
              Số liệu hiện tại của toàn khách sạn, không thay đổi theo bộ lọc hay dải ngày trên lịch.
              {' '}Ngày nghiệp vụ: {chartData.businessDate}.
            </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="border-slate-800 bg-slate-900/70 backdrop-blur-md">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium">Tổng phòng</span>
                  <BedDouble className="h-4 w-4 text-amber-400" />
                </div>
                <div className="mt-2 text-2xl font-bold text-white tracking-tight">
                  {chartData.metrics.totalRooms}
                </div>
                <span className="text-[11px] text-slate-400">{roomTypesList.length} hạng phòng</span>
              </CardContent>
            </Card>

            <Card className="border-slate-800 bg-slate-900/70 backdrop-blur-md">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium">Công suất hôm nay</span>
                  <div className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                </div>
                <div className="mt-2 text-2xl font-bold text-emerald-400 tracking-tight">
                  {chartData.metrics.occupancyRateToday}%
                </div>
                <span className="text-[11px] text-slate-400">
                  {chartData.metrics.occupiedRoomsToday} phòng đang ở
                </span>
              </CardContent>
            </Card>

            <Card className="border-slate-800 bg-slate-900/70 backdrop-blur-md">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium">Phòng sạch sẵn sàng</span>
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="mt-2 text-2xl font-bold text-emerald-400 tracking-tight">
                  {chartData.metrics.readyRooms}
                </div>
                <span className="text-[11px] text-slate-400">Trạng thái Ready</span>
              </CardContent>
            </Card>

            <Card className="border-slate-800 bg-slate-900/70 backdrop-blur-md">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium">Chờ dọn dẹp</span>
                  <Clock className="h-4 w-4 text-rose-400" />
                </div>
                <div className="mt-2 text-2xl font-bold text-rose-400 tracking-tight">
                  {chartData.metrics.dirtyRooms + chartData.metrics.cleaningRooms}
                </div>
                <span className="text-[11px] text-slate-400">
                  {chartData.metrics.cleaningRooms} đang dọn • {chartData.metrics.dirtyRooms} bẩn
                </span>
              </CardContent>
            </Card>
          </div>
          </section>
        )}

        {/* Toolbar Controls (Dates, Range, Filters) */}
        <Card className="border-slate-800 bg-slate-900/60 backdrop-blur-md p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            {/* Date Navigation */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-lg border border-slate-700 bg-slate-800/80 p-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleShiftDays(-7)}
                  className="h-8 w-8 p-0 text-slate-300 hover:text-white"
                  title="Tuần trước"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetToday}
                  className="h-8 px-2.5 text-xs font-semibold text-amber-400 hover:text-amber-300"
                >
                  Hôm nay
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleShiftDays(7)}
                  className="h-8 w-8 p-0 text-slate-300 hover:text-white"
                  title="Tuần sau"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Specific Date input */}
              <div className="relative">
                <Input
                  type="date"
                  aria-label="Ngày bắt đầu lịch"
                  value={startDate || chartData?.startDate || ''}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-9 w-40 bg-slate-800 border-slate-700 text-xs text-white"
                />
              </div>

              {/* Days duration buttons */}
              <div className="flex items-center rounded-lg border border-slate-700 bg-slate-800/80 p-1">
                {[7, 14, 21, 30].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      days === d
                        ? 'bg-amber-500 font-semibold text-slate-950 shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {d} ngày
                  </button>
                ))}
              </div>
            </div>

            {/* Filters and Search */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Room type filter */}
              <Select
                aria-label="Lọc theo hạng phòng"
                value={selectedRoomType}
                onChange={(e) => setSelectedRoomType(e.target.value)}
                className="h-9 bg-slate-800 border-slate-700 text-xs text-white w-40"
              >
                <option value="all">Tất cả hạng phòng</option>
                {roomTypesList.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.name}
                  </option>
                ))}
              </Select>

              {/* Floor filter */}
              <Select
                aria-label="Lọc theo tầng"
                value={selectedFloor}
                onChange={(e) => setSelectedFloor(e.target.value)}
                className="h-9 bg-slate-800 border-slate-700 text-xs text-white w-28"
              >
                <option value="all">Tất cả tầng</option>
                {floorsList.map((f) => (
                  <option key={f} value={String(f)}>
                    Tầng {f}
                  </option>
                ))}
              </Select>

              {/* Status filter */}
              <Select
                aria-label="Lọc theo trạng thái phòng"
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="h-9 bg-slate-800 border-slate-700 text-xs text-white w-32"
              >
                <option value="all">Tất cả trạng thái</option>
                <option value="occupied">Đang có khách</option>
                <option value="available">Phòng trống</option>
                <option value="dirty">Chưa dọn (Bẩn)</option>
              </Select>

              {/* Search input */}
              <div className="relative w-44">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  type="text"
                  aria-label="Tìm phòng hoặc khách"
                  placeholder="Số phòng / Tên khách"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 pl-8 text-xs bg-slate-800 border-slate-700 text-white"
                />
              </div>
            </div>
          </div>
          {chartData && !loading && !error && (
            <p className="mt-3 text-xs text-slate-400" role="status">
              Hiển thị {displayRooms.length}/{chartData.rooms.length} phòng. Bộ lọc chỉ áp dụng cho bảng lịch bên dưới.
            </p>
          )}
        </Card>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
          <span className="font-semibold text-slate-400">Chú giải:</span>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded bg-blue-600" />
            <span>Đã xác nhận (Sắp đến)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded bg-emerald-600" />
            <span>Đang lưu trú (Checked-in)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-3 rounded bg-slate-600" />
            <span>Đã hoàn tất</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">Ready</span>
            <span>Phòng sạch</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40">Dirty</span>
            <span>Chờ dọn</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">Clean</span>
            <span>Đang dọn</span>
          </div>
        </div>

        {/* Gantt Tape Chart Matrix Table */}
        <Card className="border-slate-800 bg-slate-900/80 shadow-2xl overflow-hidden">
          <div className="relative overflow-x-auto max-h-[700px] overflow-y-auto">
            {loading ? (
              <div className="p-8 space-y-4">
                <Skeleton className="h-12 w-full bg-slate-800/60" />
                <Skeleton className="h-16 w-full bg-slate-800/40" />
                <Skeleton className="h-16 w-full bg-slate-800/40" />
                <Skeleton className="h-16 w-full bg-slate-800/40" />
              </div>
            ) : error ? (
              <div className="p-12 text-center text-rose-300">
                <AlertCircle className="mx-auto h-8 w-8 text-rose-400 mb-2" />
                <p className="font-medium">{error}</p>
                <Button variant="outline" size="sm" onClick={() => loadChart()} className="mt-4">
                  Thử lại
                </Button>
              </div>
            ) : displayRooms.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <BedDouble className="mx-auto h-8 w-8 text-slate-500 mb-2" />
                <p>Không có phòng nào phù hợp với bộ lọc hiện tại.</p>
              </div>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                {/* Table Header: Sticky Left Room Header + Sticky Dates */}
                <thead className="sticky top-0 z-30 bg-slate-950 text-slate-300 border-b border-slate-800 shadow-md">
                  <tr>
                    {/* Sticky Room Column Header */}
                    <th className="sticky left-0 z-40 bg-slate-950 px-4 py-3 min-w-[210px] max-w-[210px] border-r border-slate-800 font-semibold text-amber-300">
                      Phòng / Hạng phòng
                    </th>

                    {/* Timeline Date Headers */}
                    {chartData?.timeline.map((day) => (
                      <th
                        key={day.date}
                        className={`min-w-[68px] max-w-[68px] px-1 py-2 text-center border-r border-slate-800/60 transition-colors ${
                          day.isToday
                            ? 'bg-amber-500/15 border-b-2 border-b-amber-400 text-amber-300 font-bold'
                            : day.isWeekend
                            ? 'bg-slate-900/60 text-slate-400'
                            : 'bg-slate-950 text-slate-300'
                        }`}
                      >
                        <div className="text-[10px] uppercase font-semibold tracking-wider">{day.dayOfWeek}</div>
                        <div className="text-sm font-bold tracking-tight">
                          {day.date.slice(8, 10)}/{day.date.slice(5, 7)}
                        </div>
                        {day.isToday && (
                          <span className="inline-block rounded px-1 text-[9px] bg-amber-400 text-slate-950 font-extrabold uppercase">
                            Hôm nay
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>

                {/* Table Body: Rooms & Booking Spans */}
                <tbody className="divide-y divide-slate-800/50">
                  {displayRooms.map((room) => (
                    <tr key={room.roomId} className="hover:bg-slate-800/20 transition-colors group">
                      {/* Sticky Left Room Cell */}
                      <td className="sticky left-0 z-20 bg-slate-950 group-hover:bg-slate-900/90 border-r border-slate-800 px-3 py-2.5 transition-colors">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-sm text-white">{room.roomNumber}</span>
                              <span className="text-[10px] text-slate-400 font-medium">T{room.floor}</span>
                            </div>
                            <div className="text-[11px] text-slate-400 truncate max-w-[125px]" title={room.roomTypeName}>
                              {room.roomTypeName}
                            </div>
                          </div>

                          {/* Interactive Housekeeping Status Badge */}
                          <button
                            onClick={() => handleToggleHousekeeping(room)}
                            disabled={actionProcessing}
                            title="Bấm để đổi trạng thái dọn phòng"
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase transition-all shadow-sm ${
                              room.housekeepingStatus === 'Ready'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                                : room.housekeepingStatus === 'Dirty'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 animate-pulse'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                            }`}
                          >
                            {room.housekeepingStatus === 'Ready' ? 'Sạch' : room.housekeepingStatus === 'Dirty' ? 'Bẩn' : 'Đang dọn'}
                          </button>
                        </div>
                      </td>

                      {/* Timeline Day Slots */}
                      {chartData?.timeline.map((day) => {
                        const slot = room.slots[day.date];

                        if (!slot) {
                          return (
                            <td
                              key={day.date}
                              className={`border-r border-slate-800/40 p-1 text-center transition-colors ${
                                day.isToday ? 'bg-amber-500/5' : day.isWeekend ? 'bg-slate-950/40' : ''
                              }`}
                            >
                              <div className="h-9 w-full rounded hover:bg-white/5 transition-colors" />
                            </td>
                          );
                        }

                        // Determine visual style based on booking status
                        const isConfirmed = slot.status === 'Confirmed';
                        const isCheckedIn = slot.status === 'CheckedIn';
                        const isCompleted = slot.status === 'Completed';

                        return (
                          <td
                            key={day.date}
                            className={`border-r border-slate-800/40 p-0.5 relative transition-colors ${
                              day.isToday ? 'bg-amber-500/5' : ''
                            }`}
                          >
                            <div
                              onClick={() => setActiveBooking({ slot, room })}
                              className={`h-9 flex items-center px-1.5 cursor-pointer text-[11px] font-semibold transition-all select-none shadow-sm ${
                                isCheckedIn
                                  ? 'bg-gradient-to-r from-emerald-600 to-teal-700 text-white hover:brightness-110'
                                  : isConfirmed
                                  ? 'bg-gradient-to-r from-blue-600 to-indigo-700 text-white hover:brightness-110'
                                  : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                              } ${slot.isStart ? 'rounded-l-lg ml-0.5 border-l-2 border-l-amber-300' : ''} ${
                                slot.isEnd ? 'rounded-r-lg mr-0.5' : ''
                              }`}
                              title={`${slot.customerName} (${slot.status})\n${slot.checkInDate} -> ${slot.checkOutDate}`}
                            >
                              {slot.isStart ? (
                                <div className="flex items-center gap-1 truncate">
                                  {isCheckedIn ? <User className="h-3 w-3 shrink-0" /> : <Clock className="h-3 w-3 shrink-0" />}
                                  <span className="truncate">{slot.customerName}</span>
                                </div>
                              ) : (
                                <div className="w-full text-center text-[10px] text-white/50">•</div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        {/* Interactive Booking Details Modal */}
        {activeBooking && (
          <Dialog
            open={Boolean(activeBooking)}
            onClose={() => setActiveBooking(null)}
            title={`Chi Tiết Đặt Phòng: ${activeBooking.slot.customerName}`}
            description={`Mã booking: ${activeBooking.slot.bookingId}`}
          >
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-2">
                <Badge
                  variant={activeBooking.slot.status === 'CheckedIn' ? 'success' : 'primary'}
                  className="uppercase font-bold text-[10px]"
                >
                  {activeBooking.slot.status === 'CheckedIn' ? 'Đang lưu trú' : activeBooking.slot.status}
                </Badge>
              </div>

              {/* Guest & Stay Information Grid */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="space-y-1 rounded-xl bg-slate-950/60 p-3 border border-slate-800/80">
                  <span className="text-slate-400 font-medium">Thông tin phòng:</span>
                  <div className="font-bold text-white text-sm">
                    Phòng {activeBooking.room.roomNumber} (Tầng {activeBooking.room.floor})
                  </div>
                  <div className="text-slate-400 text-[11px]">{activeBooking.room.roomTypeName}</div>
                </div>

                <div className="space-y-1 rounded-xl bg-slate-950/60 p-3 border border-slate-800/80">
                  <span className="text-slate-400 font-medium">Giá phòng:</span>
                  <div className="font-bold text-amber-400 text-sm">
                    {formatCurrency(activeBooking.slot.appliedPrice)}/đêm
                  </div>
                  <div className="text-slate-400 text-[11px]">
                    {activeBooking.slot.nights} đêm • Tổng: {formatCurrency(activeBooking.slot.appliedPrice * activeBooking.slot.nights)}
                  </div>
                </div>

                <div className="space-y-1 rounded-xl bg-slate-950/60 p-3 border border-slate-800/80">
                  <span className="text-slate-400 font-medium">Dải ngày lưu trú:</span>
                  <div className="font-bold text-white">
                    {activeBooking.slot.checkInDate} <ArrowRight className="inline h-3 w-3 text-amber-400" /> {activeBooking.slot.checkOutDate}
                  </div>
                </div>

                <div className="space-y-1 rounded-xl bg-slate-950/60 p-3 border border-slate-800/80">
                  <span className="text-slate-400 font-medium">Liên hệ khách hàng:</span>
                  <div className="text-slate-300 truncate flex items-center gap-1.5">
                    <Phone className="h-3 w-3 text-slate-400 shrink-0" />
                    {activeBooking.slot.customerPhone || 'Chưa có SĐT'}
                  </div>
                  <div className="text-slate-300 truncate flex items-center gap-1.5">
                    <Mail className="h-3 w-3 text-slate-400 shrink-0" />
                    {activeBooking.slot.customerEmail || 'Chưa có email'}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="border-t border-slate-800 pt-4 flex flex-wrap items-center justify-end gap-2.5">
                {/* Reassign Room Button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowReassign(true)}
                  disabled={actionProcessing}
                  className="gap-1.5 border-slate-700 bg-slate-800 hover:bg-slate-700 text-white"
                >
                  <ArrowUpDown className="h-4 w-4 text-amber-400" />
                  Đổi phòng
                </Button>

                {/* Check-in button */}
                {activeBooking.slot.canCheckIn && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleCheckIn(activeBooking.slot.bookingId)}
                    disabled={actionProcessing}
                    className="gap-1.5 bg-blue-600 hover:bg-blue-500 text-white"
                  >
                    <LogIn className="h-4 w-4" />
                    Nhận phòng ngay
                  </Button>
                )}

                {/* Check-out button */}
                {activeBooking.slot.canCheckOut && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleCheckOut(activeBooking.slot.bookingId)}
                    disabled={actionProcessing}
                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    <LogOut className="h-4 w-4" />
                    Trả phòng ngay
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveBooking(null)}
                  className="text-slate-400 hover:text-white"
                >
                  Đóng
                </Button>
              </div>
            </div>
          </Dialog>
        )}

        {/* Room Reassignment Modal */}
        {showReassign && activeBooking && (
          <Dialog
            open={showReassign}
            onClose={() => setShowReassign(false)}
            title={`Đổi Phòng: Booking ${activeBooking.slot.bookingId.slice(0, 8)}...`}
            description={`Hạng phòng: ${activeBooking.room.roomTypeName} (Phòng hiện tại: ${activeBooking.room.roomNumber})`}
          >
            <div className="space-y-4 pt-2">
              <div className="space-y-3">
                <label className="text-xs font-semibold text-slate-300">Chọn phòng trống cùng hạng (Đã sạch):</label>
                {availableTargetRooms.length === 0 ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-950/40 p-4 text-xs text-amber-200">
                    Không có phòng trống nào cùng hạng phòng đang ở trạng thái Ready.
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1">
                    {availableTargetRooms.map((r) => (
                      <button
                        key={r.roomId}
                        type="button"
                        onClick={() => setTargetRoomId(r.roomId)}
                        className={`rounded-lg border p-2 text-center transition-all ${
                          targetRoomId === r.roomId
                            ? 'border-amber-400 bg-amber-500/20 text-white font-bold ring-2 ring-amber-400'
                            : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        <div className="text-sm font-bold">{r.roomNumber}</div>
                        <div className="text-[10px] text-slate-400">Tầng {r.floor}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-800 pt-4 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowReassign(false)}>
                  Hủy
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!targetRoomId || actionProcessing}
                  onClick={handleExecuteReassign}
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
                >
                  Xác nhận đổi phòng
                </Button>
              </div>
            </div>
          </Dialog>
        )}

      </div>
    </PageContainer>
  );
}
