'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Database,
  RefreshCw,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { getAdminPricingDrift } from '@/services/admin.service';
import type { AdminDriftMonitoring, FeatureDriftItem } from '@/types/admin.type';

interface AiDriftMonitorPanelProps {
  refreshSignal?: number;
}

const FEATURE_LABELS_VI: Record<string, string> = {
  lead_time: 'Số ngày đặt trước (lead_time)',
  stay_nights: 'Số đêm lưu trú (stay_nights)',
  guest_count: 'Số khách / phòng (guest_count)',
  weekend_share: 'Tỷ trọng đêm cuối tuần (weekend_share)',
  occupancy_ratio: 'Tỷ lệ công suất snapshot (occupancy_ratio)',
  booking_velocity_score: 'Nhịp đặt phòng (booking_velocity_score)',
};

function formatPValue(p: number | undefined): string {
  if (p == null || !Number.isFinite(p)) return '—';
  if (p < 0.0001) return '<0.0001';
  if (p < 0.001) return '<0.001';
  return p.toFixed(3);
}

function baselineSourceLabel(source: string | undefined): { label: string; isEmpirical: boolean } {
  if (source === 'portugal_v2_training_empirical') {
    return { label: 'Portugal V2 Thực Nghiệm (n=36,090)', isEmpirical: true };
  }
  if (source === 'mixed_empirical_and_prior') {
    return { label: 'Portugal V2 Thực Nghiệm (n=36,090) + Operational Prior', isEmpirical: true };
  }
  if (!source || source === 'unavailable') {
    return { label: 'Chưa xác định', isEmpirical: false };
  }
  return { label: `Baseline (${source})`, isEmpirical: false };
}

function overallBadge(overall: AdminDriftMonitoring['overall_status'], serviceStatus: AdminDriftMonitoring['status']) {
  if (serviceStatus === 'unavailable' || !overall) {
    return { label: 'Chưa kết nối / Fail-open', variant: 'neutral' as const };
  }
  switch (overall) {
    case 'healthy':
      return { label: 'Ổn định (Healthy)', variant: 'success' as const };
    case 'degraded':
      return { label: 'Có biến động nhẹ (Warning)', variant: 'warning' as const };
    case 'drift_alert':
      return { label: 'Cảnh báo lệch phân phối (Drift Alert)', variant: 'danger' as const };
    default:
      return { label: String(overall), variant: 'neutral' as const };
  }
}

function featureBadge(status: FeatureDriftItem['status']) {
  switch (status) {
    case 'stable':
      return { label: 'Ổn định (PSI < 0.10)', variant: 'success' as const };
    case 'warning':
      return { label: 'Theo dõi (0.10–0.25)', variant: 'warning' as const };
    case 'drift_detected':
      return { label: 'Lệch đáng kể (≥ 0.25)', variant: 'danger' as const };
  }
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

export function AiDriftMonitorPanel({ refreshSignal = 0 }: AiDriftMonitorPanelProps) {
  const { session } = useAuth();
  const accessToken = session?.accessToken ?? '';
  const authorized = session?.user.role === 'admin';

  const [sampleSize, setSampleSize] = useState(500);
  const [data, setData] = useState<AdminDriftMonitoring | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDrift = useCallback(async () => {
    if (!accessToken || !authorized) return;
    setLoading(true);
    setError('');
    try {
      setData(await getAdminPricingDrift(accessToken, sampleSize));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Không thể tải báo cáo AI Drift Monitoring.',
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, authorized, sampleSize]);

  useEffect(() => {
    void loadDrift();
  }, [loadDrift, refreshSignal]);

  if (!authorized) return null;

  const summaryBadge = data ? overallBadge(data.overall_status, data.status) : null;

  return (
    <Card className="mb-8 min-w-0" aria-label="Giám sát trôi dạt dữ liệu AI (PSI Drift Monitoring)">
      <CardHeader className="border-b border-white/[0.08] pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm">
                <Activity className="size-4.5" />
              </div>
              AI Feature Drift Monitoring (PSI)
              {summaryBadge && (
                <Badge variant={summaryBadge.variant} dot>
                  {summaryBadge.label}
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-1.5">
              Đo Population Stability Index (PSI), kiểm định hai mẫu Kolmogorov-Smirnov (KS-test) và khoảng cách Wasserstein-1 (W1)
              trên tập báo giá thực PostgreSQL (<code className="font-mono text-slate-300">pricing_quotes</code>) so với phân phối
              thực nghiệm 36,090 dòng huấn luyện Random Forest V2 (Portugal 2015–2017).
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Cỡ mẫu báo giá đánh giá PSI"
              value={String(sampleSize)}
              onChange={(e) => setSampleSize(Number(e.target.value))}
              className="w-40"
            >
              <option value="100">100 quotes gần nhất</option>
              <option value="250">250 quotes gần nhất</option>
              <option value="500">500 quotes gần nhất</option>
              <option value="1000">1,000 quotes gần nhất</option>
              <option value="2000">2,000 quotes gần nhất</option>
            </Select>
            <Button variant="outline" size="sm" onClick={() => void loadDrift()} disabled={loading}>
              <RefreshCw className={loading ? 'animate-spin' : ''} />
              Kiểm tra PSI
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-5">
        {error && (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200 sm:flex-row sm:items-center"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-400" />
              <p>{error}</p>
            </div>
            <Button variant="outline" size="sm" className="sm:ml-auto" onClick={() => void loadDrift()}>
              Thử lại
            </Button>
          </div>
        )}

        {loading && !data ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
            </div>
            <Skeleton className="h-52 rounded-xl" />
          </div>
        ) : data ? (
          <>
            {/* Top Metrics Strip */}
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-white/[0.08] bg-slate-900/50 p-3.5">
                <p className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                  <Database className="size-3.5 text-sky-400" />
                  Nguồn quan sát & Baseline
                </p>
                <p className="mt-1.5 text-sm font-semibold text-slate-100">
                  {data.observation_source === 'live_pricing_quotes'
                    ? 'Báo giá thực PostgreSQL'
                    : 'Mẫu chẩn đoán mặc định'}
                </p>
                <p className="mt-0.5 text-[11px] font-mono text-slate-400">
                  {data.sample_count} / {data.total_quotes_in_db} quotes trong DB
                </p>
                {(() => {
                  const src = baselineSourceLabel(data.baseline_source ?? data.reports[0]?.baseline_source);
                  return (
                    <Badge
                      variant={src.isEmpirical ? 'info' : 'neutral'}
                      className="mt-2 text-[10px] font-mono"
                    >
                      {src.label}
                    </Badge>
                  );
                })()}
              </div>

              <div className="rounded-xl border border-white/[0.08] bg-slate-900/50 p-3.5">
                <p className="text-[11px] font-medium text-slate-400">Đặc trưng giám sát</p>
                <p className="mt-1.5 font-mono text-2xl font-bold text-slate-100 tabular-nums">
                  {data.total_features_monitored}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {formatDateTime(data.assessed_at)}
                </p>
              </div>

              <div className="rounded-xl border border-white/[0.08] bg-slate-900/50 p-3.5">
                <p className="text-[11px] font-medium text-slate-400">Cảnh báo nhẹ (0.10–0.25)</p>
                <p className="mt-1.5 font-mono text-2xl font-bold text-amber-400 tabular-nums">
                  {data.features_with_warning}
                </p>
              </div>

              <div className="rounded-xl border border-white/[0.08] bg-slate-900/50 p-3.5">
                <p className="text-[11px] font-medium text-slate-400">Lệch ngưỡng đỏ (PSI ≥ 0.25)</p>
                <p className="mt-1.5 font-mono text-2xl font-bold text-rose-400 tabular-nums">
                  {data.features_with_drift}
                </p>
              </div>
            </div>

            {data.reports.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-white/[0.08]">
                <Table aria-label="Bảng PSI theo từng đặc trưng">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Đặc trưng</TableHead>
                      <TableHead>Chỉ số PSI</TableHead>
                      <TableHead>KS-Stat &amp; p-value</TableHead>
                      <TableHead>Wasserstein-1 (W1)</TableHead>
                      <TableHead>Phân loại</TableHead>
                      <TableHead>Baseline (Mean ± Std · Med)</TableHead>
                      <TableHead>Hiện tại (Mean ± Std · Med)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.reports.map((report) => {
                      const badge = featureBadge(report.status);
                      const hasKs = report.ks_stat != null && Number.isFinite(report.ks_stat);
                      const hasW1 = report.wasserstein_distance != null && Number.isFinite(report.wasserstein_distance);
                      return (
                        <TableRow key={report.feature}>
                          <TableCell className="font-medium text-slate-100">
                            <div>{FEATURE_LABELS_VI[report.feature] ?? report.feature}</div>
                            {report.baseline_rows != null && report.baseline_rows > 0 && (
                              <div className="text-[10px] font-mono text-slate-400">
                                n_ref = {report.baseline_rows.toLocaleString('en-US')}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="font-mono font-bold tabular-nums text-slate-100">
                            {report.psi.toFixed(4)}
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums text-slate-200">
                            {hasKs ? (
                              <div>
                                <div className="font-semibold">{Number(report.ks_stat).toFixed(3)}</div>
                                <div className={`text-[10px] ${Number(report.ks_pvalue ?? 1) < 0.05 ? 'text-amber-300' : 'text-slate-400'}`}>
                                  p = {formatPValue(report.ks_pvalue)}
                                </div>
                              </div>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums text-slate-200">
                            {hasW1 ? Number(report.wasserstein_distance).toFixed(3) : '—'}
                          </TableCell>
                          <TableCell>
                            <Badge variant={badge.variant} dot>
                              {badge.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-slate-300 tabular-nums">
                            <div>
                              {report.baseline_mean.toFixed(2)} ± {report.baseline_std.toFixed(2)}
                            </div>
                            {report.baseline_median != null && (
                              <div className="text-[10px] text-slate-400">
                                Med (p50): {report.baseline_median.toFixed(2)}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-slate-200 tabular-nums">
                            <div>
                              {report.current_mean.toFixed(2)} ± {report.current_std.toFixed(2)}
                            </div>
                            {report.current_median != null && (
                              <div className="text-[10px] text-slate-400">
                                Med (p50): {report.current_median.toFixed(2)}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-200">
                {data.note_vi}
              </div>
            )}

            {/* Recommendations & Domain-Shift Explanation */}
            <div className="rounded-xl border border-white/[0.08] bg-slate-900/40 p-4 space-y-2 text-xs text-slate-300">
              <div className="flex items-start gap-2">
                {data.features_with_drift > 0 ? (
                  <AlertTriangle className="size-4 shrink-0 text-amber-400 mt-0.5" />
                ) : (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-400 mt-0.5" />
                )}
                <p className="leading-relaxed">{data.note_vi}</p>
              </div>
              {data.recommendations.length > 0 && (
                <ul className="list-disc pl-6 space-y-1 text-slate-400">
                  {data.recommendations.map((rec, idx) => (
                    <li key={idx}>{rec}</li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

