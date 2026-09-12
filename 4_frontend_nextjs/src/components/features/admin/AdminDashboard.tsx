'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  BedDouble,
  Bot,
  CalendarCheck2,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  RefreshCw,
  Users,
  Wrench,
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
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { getAdminDashboard } from '@/services/admin.service';
import type {
  AdminBooking,
  AdminBookingStatus,
  AdminDashboard as AdminDashboardData,
  AdminMonthlyBookingValue,
  RoomStatus,
} from '@/types/admin.type';
import { formatCurrency } from '@/utils/formatCurrency';

const statusLabel: Record<AdminBookingStatus, string> = {
  Pending: 'Chờ đặt cọc',
  Expired: 'Hết hạn giữ phòng',
  NoShow: 'Không đến nhận phòng',
  Confirmed: 'Đã xác nhận',
  CheckedIn: 'Đang lưu trú',
  Canceled: 'Đã hủy',
  Completed: 'Đã hoàn tất',
};

const statusVariant: Record<AdminBookingStatus, 'primary' | 'danger' | 'success' | 'info' | 'warning' | 'neutral'> = {
  Pending: 'warning',
  Expired: 'neutral',
  NoShow: 'danger',
  Confirmed: 'primary',
  CheckedIn: 'info',
  Canceled: 'danger',
  Completed: 'success',
};

const roomStatusLabel: Record<RoomStatus, string> = {
  Available: 'Sẵn sàng',
  Occupied: 'Đang sử dụng',
  Maintenance: 'Bảo trì',
};

const roomStatusColor: Record<RoomStatus, string> = {
  Available: 'bg-emerald-500',
  Occupied: 'bg-amber-500',
  Maintenance: 'bg-slate-600',
};

function asNumber(value: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value: string): string {
  const datePart = value.slice(0, 10);
  const [year, month, day] = datePart.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date);
}

function formatMonth(value: string): string {
  const [year, month] = value.split('-').map(Number);
  return year && month ? `T${month}/${year}` : value;
}

function compactCurrency(value: number): string {
  return new Intl.NumberFormat('vi-VN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(asNumber(value));
}

function StatusBadge({ status }: { status: AdminBookingStatus }) {
  return <Badge variant={statusVariant[status]} dot>{statusLabel[status]}</Badge>;
}

interface MetricCardProps {
  label: string;
  value: string;
  helper: string;
  icon: LucideIcon;
  tone?: string;
}

function MetricCard({ label, value, helper, icon: Icon, tone = 'text-amber-400' }: MetricCardProps) {
  return (
    <Card className="p-5 transition-all duration-150 hover:border-white/[0.15]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-800/80 border border-white/5', tone)}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-white tabular-nums sm:text-3xl">{value}</p>
      <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">{helper}</p>
    </Card>
  );
}

function BookingValueChart({ data }: { data: AdminMonthlyBookingValue[] }) {
  const titleId = useId();
  const descriptionId = useId();
  const width = 720;
  const height = 270;
  const left = 72;
  const right = 20;
  const top = 20;
  const bottom = 52;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = data.map((item) => Math.max(0, asNumber(item.booking_value)));
  const maximum = Math.max(...values, 1);
  const points = data.map((item, index) => {
    const x = data.length === 1 ? left + plotWidth / 2 : left + (index * plotWidth) / (data.length - 1);
    const y = top + plotHeight - (Math.max(0, asNumber(item.booking_value)) / maximum) * plotHeight;
    return { x, y, item };
  });
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const area = points.length
    ? `${line} L ${points.at(-1)!.x} ${top + plotHeight} L ${points[0].x} ${top + plotHeight} Z`
    : '';
  const gridValues = [0, 0.25, 0.5, 0.75, 1];

  if (data.length === 0) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.01] px-6 text-center">
        <CircleDollarSign className="size-8 text-slate-500" aria-hidden="true" />
        <p className="mt-3 font-semibold text-slate-200">Chưa có dữ liệu giá trị booking</p>
        <p className="mt-1 text-xs text-slate-400">Biểu đồ sẽ xuất hiện khi hệ thống có booking.</p>
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-[620px]"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
      >
        <title id={titleId}>Giá trị booking theo tháng</title>
        <desc id={descriptionId}>
          Giá trị của các booking đã xác nhận, đang lưu trú hoặc hoàn tất, nhóm theo tháng tạo booking trong {data.length} tháng gần nhất.
        </desc>
        <defs>
          <linearGradient id="booking-value-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.00" />
          </linearGradient>
        </defs>
        {gridValues.map((ratio) => {
          const y = top + plotHeight - ratio * plotHeight;
          return (
            <g key={ratio}>
              <line x1={left} y1={y} x2={width - right} y2={y} stroke="rgba(255, 255, 255, 0.06)" strokeDasharray="3 3" />
              <text x={left - 12} y={y + 4} textAnchor="end" fill="#64748b" fontSize="11" fontFamily="inherit" fontWeight="500">
                {compactCurrency(maximum * ratio)}
              </text>
            </g>
          );
        })}
        {area && <path d={area} fill="url(#booking-value-area)" />}
        {line && <path d={line} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
        {points.map(({ x, y, item }) => (
          <g key={item.month}>
            <circle cx={x} cy={y} r="4.5" fill="#090b11" stroke="#f59e0b" strokeWidth="2">
              <title>{formatMonth(item.month)}: {formatCurrency(asNumber(item.booking_value))}, {item.booking_count} booking</title>
            </circle>
            <text x={x} y={height - 20} textAnchor="middle" fill="#94a3b8" fontSize="11" fontWeight="500">
              {formatMonth(item.month)}
            </text>
          </g>
        ))}
      </svg>
      <ul className="sr-only">
        {data.map((item) => (
          <li key={item.month}>{formatMonth(item.month)}: {formatCurrency(asNumber(item.booking_value))}, {item.booking_count} booking.</li>
        ))}
      </ul>
    </div>
  );
}

function RoomStatusPanel({ dashboard }: { dashboard: AdminDashboardData }) {
  const items = dashboard.room_status_breakdown;
  const total = items.reduce((sum, item) => sum + Number(item.room_count), 0);

  return (
    <Card className="flex flex-col justify-between">
      <CardHeader>
        <CardTitle>Trạng thái phòng</CardTitle>
        <CardDescription>Ảnh chụp vận hành của {total} phòng vật lý</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 || total === 0 ? (
          <div className="py-10 text-center">
            <BedDouble className="mx-auto size-8 text-slate-500" aria-hidden="true" />
            <p className="mt-3 font-semibold text-slate-200">Chưa có phòng</p>
            <Link href="/admin/rooms" className="mt-2 inline-block text-xs font-semibold text-amber-400 hover:underline">
              Quản lý kho phòng
            </Link>
          </div>
        ) : (
          <>
            <div
              className="flex h-2.5 overflow-hidden rounded-full bg-slate-800 p-0.5 border border-white/[0.06]"
              role="img"
              aria-label={items.map((item) => `${roomStatusLabel[item.status]}: ${item.room_count}`).join(', ')}
            >
              {items.map((item) => (
                <span
                  key={item.status}
                  className={cn('h-full first:rounded-l-full last:rounded-r-full', roomStatusColor[item.status])}
                  style={{ width: `${(Number(item.room_count) / total) * 100}%` }}
                  aria-hidden="true"
                />
              ))}
            </div>
            <ul className="mt-5 divide-y divide-white/[0.06]">
              {items.map((item) => (
                <li key={item.status} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                  <span className="flex items-center gap-2.5 text-sm text-slate-300">
                    <span className={cn('size-2 rounded-full', roomStatusColor[item.status])} aria-hidden="true" />
                    {roomStatusLabel[item.status]}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-slate-100">{item.room_count}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RecentBookings({ bookings }: { bookings: AdminBooking[] }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-start justify-between gap-4 border-b border-white/[0.08] pb-4">
        <div>
          <CardTitle>Booking gần đây</CardTitle>
          <CardDescription>Hoạt động đặt phòng mới nhất trên hệ thống</CardDescription>
        </div>
        <Link
          href="/admin/bookings"
          className="inline-flex h-8 items-center rounded-lg border border-white/10 bg-slate-800/80 px-3 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 hover:text-white"
        >
          Xem tất cả
        </Link>
      </CardHeader>
      {bookings.length === 0 ? (
        <CardContent className="py-12 text-center">
          <CalendarCheck2 className="mx-auto size-8 text-slate-500" aria-hidden="true" />
          <p className="mt-3 font-semibold text-slate-200">Chưa có booking</p>
          <p className="mt-1 text-sm text-slate-400">Booking mới sẽ xuất hiện tại đây.</p>
        </CardContent>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Khách hàng</TableHead>
              <TableHead>Phòng</TableHead>
              <TableHead>Lưu trú</TableHead>
              <TableHead className="text-right">Giá trị</TableHead>
              <TableHead>Trạng thái</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bookings.map((booking) => (
              <TableRow key={booking.booking_id}>
                <TableCell>
                  <span className="block max-w-48 truncate font-medium text-slate-100">{booking.customer_name}</span>
                  <span className="block max-w-48 truncate text-xs text-slate-400">{booking.customer_email}</span>
                </TableCell>
                <TableCell>
                  <span className="font-semibold text-slate-200">{booking.room_number_snapshot}</span>
                  <span className="block text-xs text-slate-400">{booking.room_type_name_snapshot}</span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-slate-300 text-xs">
                  {formatDate(booking.check_in_date)} – {formatDate(booking.check_out_date)}
                  <span className="block text-slate-400">{booking.nights} đêm</span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono font-semibold text-amber-400 tabular-nums">
                  {formatCurrency(asNumber(booking.total_price))}
                </TableCell>
                <TableCell><StatusBadge status={booking.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-label="Đang tải tổng quan vận hành" role="status">
      <span className="sr-only">Đang tải dữ liệu dashboard…</span>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-32 rounded-xl" />)}
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
      <Skeleton className="mt-6 h-80 rounded-xl" />
    </div>
  );
}

export function AdminDashboard() {
  const { accessToken } = useAuth();
  const [dashboard, setDashboard] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadDashboard = useCallback(async (silent = false) => {
    if (!accessToken) return;
    silent ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      setDashboard(await getAdminDashboard(accessToken, 6));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể tải tổng quan vận hành.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  const roomCounts = useMemo(() => {
    const result: Record<RoomStatus, number> = { Available: 0, Occupied: 0, Maintenance: 0 };
    dashboard?.room_status_breakdown.forEach((item) => { result[item.status] = Number(item.room_count); });
    return result;
  }, [dashboard]);

  return (
    <PageContainer>
      <PageHeader
        title="Tổng quan vận hành"
        description={dashboard
          ? `Ngày nghiệp vụ ${formatDate(dashboard.business_date)} · Múi giờ ${dashboard.timezone}`
          : 'Theo dõi booking, phòng và chính sách định giá từ dữ liệu thực.'}
        actions={
          <Button variant="outline" onClick={() => void loadDashboard(true)} disabled={refreshing || loading}>
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
            Làm mới
          </Button>
        }
      />

      {error && (
        <div className="mb-6 flex flex-col gap-3 rounded-lg border border-danger/20 bg-danger-muted p-4 text-sm text-danger sm:flex-row sm:items-center" role="alert">
          <span className="flex min-w-0 items-start gap-2"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</span>
          <Button className="sm:ml-auto" variant="outline" size="sm" onClick={() => void loadDashboard()}>
            Thử lại
          </Button>
        </div>
      )}

      {loading && !dashboard ? <DashboardSkeleton /> : dashboard ? (
        <div className="grid gap-6">
          <section aria-labelledby="dashboard-kpis">
            <h2 id="dashboard-kpis" className="sr-only">Chỉ số chính</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <MetricCard
                label="Giá trị booking"
                value={formatCurrency(asNumber(dashboard.summary.booking_value))}
                helper="Booking đã xác nhận, đang lưu trú hoặc hoàn tất"
                icon={CircleDollarSign}
              />
              <MetricCard
                label="RevPAR"
                value={formatCurrency(asNumber(dashboard.summary.revpar))}
                helper="Doanh thu trên mỗi phòng có sẵn"
                icon={CircleDollarSign}
                tone="text-emerald-400"
              />
              <MetricCard
                label="Công suất phòng (Occupancy)"
                value={`${dashboard.summary.occupancy_rate}%`}
                helper="Tỷ lệ lấp đầy hiện tại"
                icon={BedDouble}
                tone="text-indigo-400"
              />
              <MetricCard
                label="Dự báo nhu cầu (Forecast)"
                value={`${dashboard.summary.forecasted_demand}%`}
                helper="Dự báo công suất dựa trên xu hướng"
                icon={RefreshCw}
                tone="text-purple-400"
              />
              <MetricCard
                label="Tổng booking"
                value={String(dashboard.summary.total_bookings)}
                helper={`${dashboard.summary.completed_bookings} hoàn tất · ${dashboard.summary.canceled_bookings} đã hủy · ${dashboard.summary.expired_bookings} hết hạn · ${dashboard.summary.no_show_bookings} không đến`}
                icon={CalendarCheck2}
              />
              <MetricCard
                label="Chờ nhận phòng"
                value={String(dashboard.summary.confirmed_bookings)}
                helper={`${dashboard.summary.checked_in_bookings} đang lưu trú · ${dashboard.summary.pending_bookings} chờ cọc`}
                icon={Clock3}
                tone="text-info"
              />
              <MetricCard
                label="Khách hàng"
                value={String(dashboard.summary.customer_count)}
                helper="Tài khoản khách hàng trong hệ thống"
                icon={Users}
              />
              <MetricCard
                label="Phòng đang sử dụng"
                value={`${roomCounts.Occupied}/${dashboard.summary.room_count}`}
                helper={`${roomCounts.Available} phòng sẵn sàng`}
                icon={BedDouble}
                tone="text-success"
              />
              <MetricCard
                label="Phòng bảo trì"
                value={String(roomCounts.Maintenance)}
                helper="Không được phân bổ cho booking mới"
                icon={Wrench}
                tone="text-warning"
              />
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Giá trị đặt phòng theo tháng</CardTitle>
                <CardDescription>
                  Giá trị booking đã xác nhận, đang lưu trú hoặc hoàn tất, nhóm theo tháng tạo booking; không phải doanh thu đã thanh toán.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-2 sm:px-5">
                <BookingValueChart data={dashboard.monthly_revenue} />
              </CardContent>
            </Card>

            <div className="grid content-start gap-6">
              <RoomStatusPanel dashboard={dashboard} />
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Bot className="size-5 text-amber-400" /> Định giá AI</CardTitle>
                  <CardDescription>Chính sách đang áp dụng cho booking mới</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-900/60 border border-white/[0.06] p-4">
                    <div>
                      <p className="font-semibold text-slate-200">{dashboard.pricing_setting.ai_enabled ? 'Đang hoạt động' : 'Tạm dừng'}</p>
                      <p className="mt-0.5 text-xs text-slate-400 font-mono">Phiên bản v{dashboard.pricing_setting.version}</p>
                    </div>
                    <Badge variant={dashboard.pricing_setting.ai_enabled ? 'success' : 'neutral'} dot>
                      {dashboard.pricing_setting.ai_enabled ? 'AI hoạt động' : 'Giá cơ sở'}
                    </Badge>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-slate-400">
                    Cập nhật gần nhất: {dashboard.pricing_setting.updated_at
                      ? formatDateTime(dashboard.pricing_setting.updated_at)
                      : 'Chưa có'}
                  </p>
                  <Link href="/admin/pricing" className="mt-4 inline-flex text-sm font-medium text-amber-400 hover:text-amber-300 transition-colors">
                    Mở quản lý định giá →
                  </Link>
                </CardContent>
              </Card>
            </div>
          </div>

          <RecentBookings bookings={dashboard.recent_bookings} />

          <p className="flex items-start gap-2 text-xs leading-5 text-slate-400">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden="true" />
            Tất cả chỉ số trên trang được lấy trực tiếp từ hệ thống tại thời điểm tải dữ liệu.
          </p>
        </div>
      ) : !error ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-slate-900/40 p-10 text-center text-sm text-slate-400">
          Chưa có dữ liệu tổng quan.
        </div>
      ) : null}
    </PageContainer>
  );
}
