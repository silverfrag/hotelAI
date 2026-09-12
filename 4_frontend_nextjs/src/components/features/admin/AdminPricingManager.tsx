'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  History,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  Sparkles,
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
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui';
import { cn } from '@/components/ui/utils';
import { useAuth } from '@/hooks/useAuth';
import {
  AdminApiError,
  getPricingLogs,
  getPricingSettings,
  updatePricingSettings,
} from '@/services/admin.service';
import type { PricingLog, PricingLogPage, PricingSettings } from '@/types/admin.type';
import { formatCurrency } from '@/utils/formatCurrency';

const PAGE_SIZE = 50;

function formatDate(value: string): string {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed);
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Chưa có dữ liệu';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(parsed);
}

function sourcePresentation(source: string | null): { label: string; variant: 'primary' | 'warning' | 'neutral' } {
  const normalized = source?.toLowerCase() ?? '';
  if (normalized.includes('ai')) return { label: 'AI', variant: 'primary' };
  if (normalized.includes('fallback')) return { label: 'Fallback', variant: 'warning' };
  if (normalized.includes('base')) return { label: 'Giá cơ sở', variant: 'neutral' };
  return { label: source || 'Không rõ', variant: 'neutral' };
}

function PricingError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-300 sm:flex-row sm:items-center shadow-sm">
      <div className="flex items-start gap-2.5">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-400" />
        <p>{message}</p>
      </div>
      <Button className="sm:ml-auto" variant="outline" size="sm" onClick={onRetry}>
        Thử lại
      </Button>
    </div>
  );
}

function PricingLogRow({ log }: { log: PricingLog }) {
  const source = sourcePresentation(log.pricing_source);
  const multiplier = Number(log.ai_multiplier);
  const priceDelta = log.base_price == null || Number(log.base_price) === 0
    ? null
    : ((Number(log.final_price) / Number(log.base_price)) - 1) * 100;

  return (
    <TableRow className="transition-colors hover:bg-white/[0.02]">
      <TableCell className="whitespace-nowrap">
        <p className="font-semibold text-slate-100">{formatDate(log.target_date)}</p>
        <span className="inline-block mt-1 rounded bg-slate-800/80 px-2 py-0.5 text-[11px] font-medium text-slate-300 border border-white/5">
          {log.type_name ?? `Loại #${log.type_id}`}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5 min-w-[200px]">
          {/* Lead time chip */}
          <span className="inline-flex items-center gap-1 rounded bg-slate-800/80 px-2 py-0.5 text-[11px] font-medium text-slate-300 border border-white/5">
            <span className="text-slate-400">Đặt trước:</span>
            <span className="font-semibold text-slate-100 font-mono">
              {log.lead_time == null ? '—' : `${log.lead_time}d`}
            </span>
          </span>
          {/* Weekend chip */}
          {log.is_weekend ? (
            <span className="inline-flex items-center rounded bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300 border border-amber-500/20">
              Cuối tuần
            </span>
          ) : (
            <span className="inline-flex items-center rounded bg-slate-800/60 px-2 py-0.5 text-[11px] font-medium text-slate-400 border border-white/5">
              Ngày thường
            </span>
          )}
          {/* Special requests chip */}
          {log.total_of_special_requests != null && Number(log.total_of_special_requests) > 0 ? (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300 border border-emerald-500/20">
              {log.total_of_special_requests} req
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={source.variant} dot>{source.label}</Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums">
        <div className="flex flex-col">
          <span
            className={cn(
              'font-mono text-sm font-bold',
              multiplier > 1 ? 'text-emerald-400' : multiplier < 1 ? 'text-amber-400' : 'text-slate-200',
            )}
          >
            ×{multiplier.toFixed(3)}
          </span>
          {priceDelta !== null && (
            <span
              className={cn(
                'mt-0.5 font-mono text-[11px] font-medium',
                priceDelta > 0 ? 'text-emerald-400' : priceDelta < 0 ? 'text-amber-400' : 'text-slate-400',
              )}
            >
              {priceDelta >= 0 ? '+' : ''}{priceDelta.toFixed(1)}%
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap font-mono text-sm font-semibold text-amber-400 tabular-nums">
        {formatCurrency(Number(log.final_price))}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-slate-400">
        <p className="font-medium text-slate-300">{formatDateTime(log.updated_at)}</p>
        <p className="mt-0.5 font-mono text-[11px] text-slate-400" title={log.booking_id ?? 'Bản ghi cũ không có booking ID'}>
          {log.booking_id ? `#${log.booking_id.slice(0, 8)}` : 'Legacy'}
        </p>
      </TableCell>
    </TableRow>
  );
}

export function AdminPricingManager() {
  const { accessToken } = useAuth();
  const [settings, setSettings] = useState<PricingSettings | null>(null);
  const [logs, setLogs] = useState<PricingLogPage>({ items: [], total: 0, limit: PAGE_SIZE, offset: 0 });
  const [offset, setOffset] = useState(0);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [logsError, setLogsError] = useState('');
  const [notice, setNotice] = useState('');
  const [updating, setUpdating] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);

  const loadSettings = useCallback(async () => {
    if (!accessToken) return;
    setSettingsLoading(true);
    setSettingsError('');
    try {
      setSettings(await getPricingSettings(accessToken));
    } catch (caught) {
      setSettingsError(caught instanceof Error ? caught.message : 'Không thể tải cấu hình định giá.');
    } finally {
      setSettingsLoading(false);
    }
  }, [accessToken]);

  const loadLogs = useCallback(async (nextOffset: number) => {
    if (!accessToken) return;
    setLogsLoading(true);
    setLogsError('');
    try {
      const page = await getPricingLogs(accessToken, PAGE_SIZE, nextOffset);
      if (page.items.length === 0 && page.total > 0 && nextOffset > 0) {
        const validOffset = Math.max(0, Math.floor((page.total - 1) / PAGE_SIZE) * PAGE_SIZE);
        setOffset(validOffset);
        return;
      }
      setLogs(page);
    } catch (caught) {
      setLogsError(caught instanceof Error ? caught.message : 'Không thể tải lịch sử định giá.');
    } finally {
      setLogsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { void loadSettings(); }, [loadSettings]);
  useEffect(() => { void loadLogs(offset); }, [loadLogs, offset]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadSettings(), loadLogs(offset)]);
    setRefreshing(false);
  }, [loadLogs, loadSettings, offset]);

  async function applyAiSetting(aiEnabled: boolean) {
    if (!accessToken || !settings) return;
    setUpdating(true);
    setSettingsError('');
    setNotice('');
    try {
      const nextSettings = await updatePricingSettings(accessToken, aiEnabled, settings.version);
      setSettings(nextSettings);
      setNotice(aiEnabled
        ? 'AI Pricing đã được kích hoạt. Báo giá mới sẽ tự động tính theo hệ số động.'
        : 'AI Pricing đã tắt. Báo giá mới sẽ dùng giá cơ sở chuẩn.');
      setConfirmDisable(false);
    } catch (caught) {
      if (caught instanceof AdminApiError && caught.status === 409) {
        await loadSettings();
        setSettingsError(`${caught.message} Cấu hình mới nhất đã được tải lại.`);
      } else {
        setSettingsError(caught instanceof Error ? caught.message : 'Không thể cập nhật cấu hình AI.');
      }
    } finally {
      setUpdating(false);
    }
  }

  const averageMultiplier = useMemo(() => {
    if (logs.items.length === 0) return null;
    return logs.items.reduce((sum, log) => sum + Number(log.ai_multiplier), 0) / logs.items.length;
  }, [logs.items]);
  const firstRow = logs.total === 0 ? 0 : logs.offset + 1;
  const lastRow = Math.min(logs.offset + logs.items.length, logs.total);
  const hasPrevious = offset > 0;
  const hasNext = offset + logs.limit < logs.total;

  return (
    <PageContainer>
      <PageHeader
        title="Định giá & Doanh thu"
        description="Điều khiển mô hình AI Pricing và kiểm toán truy vết mức giá đã áp dụng cho từng đặt phòng."
        actions={
          <Button variant="outline" onClick={() => void refreshAll()} disabled={refreshing}>
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin text-amber-400')} />
            Làm mới
          </Button>
        }
      />

      {notice && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300 shadow-sm" role="status">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
          <span className="font-medium">{notice}</span>
        </div>
      )}

      <div className="mb-8 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
        {/* AI Engine Status Card */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2.5">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm">
                    <Bot className="size-4.5" />
                  </div>
                  Mô hình AI Dynamic Pricing
                </CardTitle>
                <CardDescription className="mt-1.5">
                  Tự động điều chỉnh hệ số giá linh hoạt dựa trên dữ liệu lịch sử đặt phòng và thời gian thực.
                </CardDescription>
              </div>
              {!settingsLoading && settings && (
                <Badge variant={settings.ai_enabled ? 'success' : 'neutral'} dot>
                  {settings.ai_enabled ? 'Đang hoạt động' : 'Tạm dừng'}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {settingsLoading ? (
              <div className="grid gap-3"><Skeleton className="h-16" /><Skeleton className="h-8 w-52" /></div>
            ) : settingsError && !settings ? (
              <PricingError message={settingsError} onRetry={() => void loadSettings()} />
            ) : settings ? (
              <>
                {settingsError && <div className="mb-4"><PricingError message={settingsError} onRetry={() => void loadSettings()} /></div>}
                <div className="flex flex-col gap-4 rounded-xl border border-white/[0.08] bg-slate-900/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1 pr-4">
                    <p className="text-sm font-semibold text-slate-100">
                      {settings.ai_enabled ? 'Mô hình học máy đang tính giá động' : 'Đang áp dụng hệ số chuẩn'}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">
                      {settings.ai_enabled
                        ? 'Giá cơ sở của loại phòng được nhân với hệ số dự đoán theo ngày đến, lead-time, số đêm, cuối tuần và số khách.'
                        : 'Báo giá mới đang áp dụng hệ số chuẩn 1.000 từ giá cơ sở của loại phòng.'}
                    </p>
                  </div>
                  {/* Tactile modern switch */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.ai_enabled}
                    aria-label="Bật hoặc tắt AI Pricing"
                    disabled={updating}
                    onClick={() => settings.ai_enabled ? setConfirmDisable(true) : void applyAiSetting(true)}
                    className={cn(
                      'relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-50 p-0.5',
                      settings.ai_enabled ? 'bg-emerald-500' : 'bg-slate-700',
                    )}
                  >
                    <span
                      className={cn(
                        'block size-6 rounded-full bg-white shadow transition-transform duration-200',
                        settings.ai_enabled ? 'translate-x-5' : 'translate-x-0',
                      )}
                    />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-xs text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-slate-500" />
                    Cập nhật: <strong className="font-medium text-slate-300">{formatDateTime(settings.updated_at)}</strong>
                  </span>
                  {settings.updated_by && (
                    <span className="flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full bg-slate-500" />
                      Bởi: <strong className="font-medium text-slate-300">{settings.updated_by}</strong>
                    </span>
                  )}
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-slate-500" />
                    Phiên bản: <strong className="font-mono font-medium text-slate-300">v{settings.version}</strong>
                  </span>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        {/* Operational Statistics Card */}
        <Card className="flex flex-col justify-between">
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm">
                <Sparkles className="size-4.5" />
              </div>
              Thống kê phiên vận hành
            </CardTitle>
            <CardDescription>Tổng quan {logs.items.length} bản ghi kiểm toán trên trang hiện tại.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {logsLoading ? <Skeleton className="h-24 rounded-xl" /> : (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/[0.06] bg-slate-900/60 p-3.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Hệ số trung bình</p>
                  <p className="mt-1.5 font-mono text-2xl font-bold text-amber-400 tabular-nums">
                    {averageMultiplier == null ? '—' : `×${averageMultiplier.toFixed(3)}`}
                  </p>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-slate-900/60 p-3.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Tổng bản ghi</p>
                  <p className="mt-1.5 font-mono text-2xl font-bold text-slate-100 tabular-nums">
                    {logs.total}
                  </p>
                </div>
              </div>
            )}
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 text-xs leading-relaxed text-slate-300 flex items-start gap-2.5">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
              <span>
                Công tắc chỉ áp dụng cho báo giá mới tạo. Giá booking đã lưu được bảo toàn để đảm bảo tính toàn vẹn nghiệp vụ kế toán.
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Audit Log Table */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 border-b border-white/[0.08] pb-4">
          <div>
            <CardTitle className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm">
                <History className="size-4.5" />
              </div>
              Nhật ký kiểm toán định giá
            </CardTitle>
            <CardDescription className="mt-1">
              Mỗi bản ghi ghi lại đầy đủ các tham số và hệ số AI tại thời điểm khách hàng yêu cầu báo giá.
            </CardDescription>
          </div>
          {!logsLoading && (
            <Badge variant="outline" className="font-mono">
              {logs.total} bản ghi
            </Badge>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {logsError ? (
            <div className="p-6"><PricingError message={logsError} onRetry={() => void loadLogs(offset)} /></div>
          ) : logsLoading ? (
            <div className="grid gap-3 p-6">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-12 rounded-lg" />)}</div>
          ) : logs.items.length === 0 ? (
            <div className="py-16 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-slate-800/80 text-slate-400 border border-white/10">
                <History className="size-6" />
              </div>
              <p className="mt-4 text-base font-semibold text-slate-200">Chưa có lịch sử định giá</p>
              <p className="mt-1 text-xs text-slate-400">Bản ghi đầu tiên sẽ tự động xuất hiện ngay sau khi khách hàng tạo booking.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ngày / Loại phòng</TableHead>
                  <TableHead>Tín hiệu đầu vào</TableHead>
                  <TableHead>Nguồn giá</TableHead>
                  <TableHead>Hệ số AI</TableHead>
                  <TableHead>Giá cuối / Đêm</TableHead>
                  <TableHead>Cập nhật / Booking</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>{logs.items.map((log) => <PricingLogRow key={log.log_id} log={log} />)}</TableBody>
            </Table>
          )}
        </CardContent>
        {!logsLoading && !logsError && logs.total > 0 && (
          <div className="flex flex-col gap-3 border-t border-white/[0.08] px-6 py-4 text-xs sm:flex-row sm:items-center sm:justify-between bg-white/[0.01]">
            <p className="text-slate-400">
              Hiển thị <span className="font-semibold text-slate-200 font-mono">{firstRow}–{lastRow}</span> trong tổng số <span className="font-semibold text-slate-200 font-mono">{logs.total}</span> bản ghi
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={!hasPrevious} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                <ChevronLeft className="size-3.5" /> Trước
              </Button>
              <Button variant="outline" size="sm" disabled={!hasNext} onClick={() => setOffset(offset + PAGE_SIZE)}>
                Sau <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Dialog
        open={confirmDisable}
        onClose={updating ? () => undefined : () => setConfirmDisable(false)}
        title="Tắt AI Pricing?"
        description="Thay đổi áp dụng cho báo giá mới. Các báo giá còn hiệu lực và booking đã lưu vẫn giữ nguyên giá."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDisable(false)} disabled={updating}>Giữ AI hoạt động</Button>
            <Button variant="danger" onClick={() => void applyAiSetting(false)} disabled={updating}>
              {updating && <LoaderCircle className="animate-spin" />}
              Tắt AI Pricing
            </Button>
          </>
        }
      >
        <p className="leading-6 text-slate-400 text-sm">
          Sau khi tắt, hệ thống sẽ dùng giá cơ sở với hệ số 1.000. Giá của các booking đã tạo không thay đổi.
        </p>
      </Dialog>
    </PageContainer>
  );
}
