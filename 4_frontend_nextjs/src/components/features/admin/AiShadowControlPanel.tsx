'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Eye,
  GitBranch,
  History,
  Lock,
  PauseCircle,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import {
  AdminApiError,
  getAiShadowAudits,
  getAiShadowReadiness,
  getAiShadowRuntimeStatus,
  getAiShadowSettings,
  pauseAiShadow,
  rollbackAiShadow,
  updateAiShadowSettings,
} from '@/services/admin.service';
import type {
  AiShadowAudit,
  AiShadowReadiness,
  AiShadowRuntimeStatus,
  AiShadowSettings,
  UpdateAiShadowSettingsInput,
} from '@/types/admin.type';

interface AiShadowControlPanelProps {
  refreshSignal?: number;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Chưa có';
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

function formatRatioPct(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(1)}%`;
}

function readinessPresentation(status: string | undefined): {
  label: string;
  variant: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
} {
  switch (status) {
    case 'paused':
      return { label: 'Đang tạm dừng (Paused)', variant: 'neutral' };
    case 'collecting':
      return { label: 'Đang thu thập cơ hội', variant: 'info' };
    case 'insufficient_shadow_days':
      return { label: 'Chưa đủ ngày quan sát', variant: 'warning' };
    case 'insufficient_confirmed_exposures':
      return { label: 'Chưa đủ mẫu hiển thị (quote.exposed.v1)', variant: 'warning' };
    case 'insufficient_conversions':
      return { label: 'Chưa đủ mẫu chuyển đổi', variant: 'warning' };
    case 'insufficient_non_conversions':
      return { label: 'Chưa đủ mẫu không chuyển đổi', variant: 'warning' };
    case 'insufficient_inference_coverage':
      return { label: 'Tỷ lệ phủ suy luận chưa đạt', variant: 'danger' };
    case 'excess_inference_errors':
      return { label: 'Tỷ lệ lỗi vượt ngưỡng', variant: 'danger' };
    case 'lineage_mismatch':
      return { label: 'Lệch lineage Champion/Challenger', variant: 'danger' };
    case 'out_of_window_attempts':
      return { label: 'Có attempt ngoài cửa sổ policy', variant: 'danger' };
    case 'data_quality_exclusions':
      return { label: 'Có mẫu bị loại do chất lượng dữ liệu', variant: 'danger' };
    case 'ready_for_offline_review':
      return { label: 'Đạt ngưỡng thẩm định offline (Cần kiểm duyệt thủ công)', variant: 'success' };
    case 'retired':
      return { label: 'Phiên bản cũ', variant: 'neutral' };
    default:
      return { label: status || 'Không xác định', variant: 'neutral' };
  }
}

export function AiShadowControlPanel({ refreshSignal = 0 }: AiShadowControlPanelProps) {
  const { session } = useAuth();
  const accessToken = session?.accessToken ?? '';
  const authorized = session?.user.role === 'admin';

  const [settings, setSettings] = useState<AiShadowSettings | null>(null);
  const [readiness, setReadiness] = useState<AiShadowReadiness | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<AiShadowRuntimeStatus | null>(null);
  const [audits, setAudits] = useState<AiShadowAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showAudits, setShowAudits] = useState(false);

  // Modal state
  const [editOpen, setEditOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  // Edit form fields
  const [formEnabled, setFormEnabled] = useState(false);
  const [formChampVer, setFormChampVer] = useState('');
  const [formChampRun, setFormChampRun] = useState('');
  const [formChampFc, setFormChampFc] = useState('');
  const [formChalVer, setFormChalVer] = useState('');
  const [formChalRun, setFormChalRun] = useState('');
  const [formChalFc, setFormChalFc] = useState('');
  const [formMinMult, setFormMinMult] = useState('0.5');
  const [formMaxMult, setFormMaxMult] = useState('3');
  const [formMaxDelta, setFormMaxDelta] = useState('0.2');
  const [formMinExposures, setFormMinExposures] = useState('2000');
  const [formMinConv, setFormMinConv] = useState('200');
  const [formMinNonConv, setFormMinNonConv] = useState('200');
  const [formMinDays, setFormMinDays] = useState('14');
  const [formMinCov, setFormMinCov] = useState('0.99');
  const [formMaxErr, setFormMaxErr] = useState('0.01');
  const [formReason, setFormReason] = useState('');

  // Pause & rollback fields
  const [pauseReason, setPauseReason] = useState('');
  const [rollbackTarget, setRollbackTarget] = useState<number>(1);
  const [rollbackReason, setRollbackReason] = useState('');

  const loadAll = useCallback(async () => {
    if (!accessToken || !authorized) return;
    setLoading(true);
    setError('');
    try {
      const [s, r, rt, au] = await Promise.all([
        getAiShadowSettings(accessToken),
        getAiShadowReadiness(accessToken),
        getAiShadowRuntimeStatus(accessToken),
        getAiShadowAudits(accessToken, 20),
      ]);
      setSettings(s);
      setReadiness(r);
      setRuntimeStatus(rt);
      setAudits(au);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Không thể tải cấu hình AI Shadow Control.',
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, authorized]);

  useEffect(() => {
    void loadAll();
  }, [loadAll, refreshSignal]);

  const rollbackCandidates = useMemo(
    () =>
      audits.filter(
        (audit) => settings && audit.version < settings.version,
      ),
    [audits, settings],
  );

  function openEditDialog() {
    if (!settings) return;
    setModalError('');
    setFormEnabled(settings.shadow_enabled);
    setFormChampVer(settings.champion.model_version ?? '');
    setFormChampRun(settings.champion.training_run_id ?? '');
    setFormChampFc(settings.champion.feature_contract_version ?? '');
    setFormChalVer(settings.challenger.model_version ?? '');
    setFormChalRun(settings.challenger.training_run_id ?? '');
    setFormChalFc(settings.challenger.feature_contract_version ?? '');
    setFormMinMult(String(settings.guardrails.minimum_multiplier));
    setFormMaxMult(String(settings.guardrails.maximum_multiplier));
    setFormMaxDelta(String(settings.guardrails.maximum_change_ratio_from_champion));
    setFormMinExposures(String(settings.readiness_gates.minimum_confirmed_exposures));
    setFormMinConv(String(settings.readiness_gates.minimum_conversions));
    setFormMinNonConv(String(settings.readiness_gates.minimum_non_conversions));
    setFormMinDays(String(settings.readiness_gates.minimum_shadow_days));
    setFormMinCov(String(settings.readiness_gates.minimum_inference_coverage_ratio));
    setFormMaxErr(String(settings.readiness_gates.maximum_inference_error_ratio));
    setFormReason('');
    setEditOpen(true);
  }

  function fillLineagesFromRuntime() {
    if (!runtimeStatus) return;
    if (runtimeStatus.champion_artifact.status === 'ready') {
      setFormChampVer(runtimeStatus.champion_artifact.model_version ?? '');
      setFormChampRun(runtimeStatus.champion_artifact.training_run_id ?? '');
      setFormChampFc(runtimeStatus.champion_artifact.feature_contract_version ?? '');
    }
    if (runtimeStatus.challenger_artifact.status === 'ready') {
      setFormChalVer(runtimeStatus.challenger_artifact.model_version ?? '');
      setFormChalRun(runtimeStatus.challenger_artifact.training_run_id ?? '');
      setFormChalFc(runtimeStatus.challenger_artifact.feature_contract_version ?? '');
    }
  }

  async function handleSavePolicy() {
    if (!settings || !accessToken) return;
    const reason = formReason.trim();
    if (reason.length < 10) {
      setModalError('Vui lòng nhập lý do thay đổi tối thiểu 10 ký tự.');
      return;
    }

    const toNullable = (val: string): string | null => {
      const trimmed = val.trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    const payload: UpdateAiShadowSettingsInput = {
      expected_version: settings.version,
      change_reason: reason,
      shadow_enabled: formEnabled,
      champion_model_version: toNullable(formChampVer),
      champion_training_run_id: toNullable(formChampRun),
      champion_feature_contract_version: toNullable(formChampFc),
      challenger_model_version: toNullable(formChalVer),
      challenger_training_run_id: toNullable(formChalRun),
      challenger_feature_contract_version: toNullable(formChalFc),
      guardrail_min_multiplier: Number(formMinMult),
      guardrail_max_multiplier: Number(formMaxMult),
      guardrail_max_change_ratio: Number(formMaxDelta),
      minimum_confirmed_exposures: Number(formMinExposures),
      minimum_conversions: Number(formMinConv),
      minimum_non_conversions: Number(formMinNonConv),
      minimum_shadow_days: Number(formMinDays),
      minimum_inference_coverage_ratio: Number(formMinCov),
      maximum_inference_error_ratio: Number(formMaxErr),
    };

    setSubmitting(true);
    setModalError('');
    setNotice('');
    try {
      const updated = await updateAiShadowSettings(accessToken, payload);
      setSettings(updated);
      setEditOpen(false);
      setNotice(`Đã lưu Shadow Policy v${updated.version} (chế độ shadow_only).`);
      await loadAll();
    } catch (caught) {
      if (caught instanceof AdminApiError && caught.status === 409) {
        await loadAll();
      }
      setModalError(
        caught instanceof Error ? caught.message : 'Không thể cập nhật Shadow Policy.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePauseShadow() {
    if (!settings || !accessToken) return;
    const reason = pauseReason.trim();
    if (reason.length < 10) {
      setModalError('Vui lòng nhập lý do tạm dừng tối thiểu 10 ký tự.');
      return;
    }
    setSubmitting(true);
    setModalError('');
    setNotice('');
    try {
      const updated = await pauseAiShadow(accessToken, {
        expected_version: settings.version,
        change_reason: reason,
      });
      setSettings(updated);
      setPauseOpen(false);
      setPauseReason('');
      setNotice(`Đã tạm dừng Shadow evaluation tại phiên bản v${updated.version}.`);
      await loadAll();
    } catch (caught) {
      if (caught instanceof AdminApiError && caught.status === 409) {
        await loadAll();
      }
      setModalError(
        caught instanceof Error ? caught.message : 'Không thể tạm dừng Shadow evaluation.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRollbackShadow() {
    if (!settings || !accessToken) return;
    const reason = rollbackReason.trim();
    if (reason.length < 10) {
      setModalError('Vui lòng nhập lý do khôi phục tối thiểu 10 ký tự.');
      return;
    }
    setSubmitting(true);
    setModalError('');
    setNotice('');
    try {
      const updated = await rollbackAiShadow(accessToken, {
        expected_version: settings.version,
        target_version: rollbackTarget,
        change_reason: reason,
      });
      setSettings(updated);
      setRollbackOpen(false);
      setRollbackReason('');
      setNotice(
        `Đã khôi phục cấu hình từ v${rollbackTarget} sang phiên bản mới v${updated.version} (trạng thái tạm dừng an toàn).`,
      );
      await loadAll();
    } catch (caught) {
      if (caught instanceof AdminApiError && caught.status === 409) {
        await loadAll();
      }
      setModalError(
        caught instanceof Error ? caught.message : 'Không thể khôi phục Shadow Policy.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!authorized) return null;

  const badgeInfo = readinessPresentation(readiness?.readiness_status);
  const challengerReady = runtimeStatus?.challenger_artifact.status === 'ready';

  return (
    <Card className="mb-8 min-w-0" aria-label="Quản trị AI Shadow Challenger & Readiness">
      <CardHeader className="border-b border-white/[0.08] pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm">
                <Eye className="size-4.5" />
              </div>
              AI Shadow Challenger & Cổng Kiểm Chứng (Readiness)
              <Badge variant="outline" className="font-mono text-[11px] border-sky-500/30 text-sky-300 bg-sky-500/10">
                mode: shadow_only
              </Badge>
              <Badge variant="outline" className="font-mono text-[11px] border-amber-500/30 text-amber-300 bg-amber-500/10 inline-flex items-center gap-1">
                <Lock className="size-3" />
                Auto-Promote: Tắt
              </Badge>
            </CardTitle>
            <CardDescription className="mt-1.5">
              Theo dõi mô hình Conversion Challenger chạy ngầm song song không ảnh hưởng giá khách hàng,
              kiểm soát guardrails và tiêu chuẩn đủ mẫu quan sát trước khi thẩm định offline.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={loading}>
              <RefreshCw className={loading ? 'animate-spin' : ''} />
              Làm mới
            </Button>
            {settings && (
              <>
                <Button variant="secondary" size="sm" onClick={openEditDialog}>
                  <Settings2 />
                  Sửa Shadow Policy
                </Button>
                {settings.shadow_enabled && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      setModalError('');
                      setPauseReason('');
                      setPauseOpen(true);
                    }}
                  >
                    <PauseCircle />
                    Tạm dừng Shadow
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={rollbackCandidates.length === 0}
                  onClick={() => {
                    setModalError('');
                    setRollbackReason('');
                    if (rollbackCandidates[0]) setRollbackTarget(rollbackCandidates[0].version);
                    setRollbackOpen(true);
                  }}
                >
                  <RotateCcw />
                  Rollback
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-5">
        {notice && (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
          >
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
            <span>{notice}</span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200 sm:flex-row sm:items-center"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-400" />
              <p>{error}</p>
            </div>
            <Button variant="outline" size="sm" className="sm:ml-auto" onClick={() => void loadAll()}>
              Thử lại
            </Button>
          </div>
        )}

        {/* Prominent Causality Guard Banner */}
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-xs leading-relaxed text-amber-200 flex items-start gap-3">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-100">
              Cảnh báo nhân quả & Nguyên tắc bất khả xâm phạm (Không tự động nâng cấp Champion)
            </p>
            <p className="text-amber-200/90">
              {runtimeStatus?.causality_warning
                ?? 'Mô hình Conversion Challenger chỉ học tương quan quan sát từ các báo giá đã xác nhận hiển thị (quote.exposed.v1). Hệ số giá chào không phải độ co giãn cầu nhân quả và tuyệt đối không tự động thay thế mô hình đang phục vụ.'}
            </p>
          </div>
        </div>

        {loading && !settings ? (
          <div className="space-y-3">
            <div className="grid gap-4 lg:grid-cols-2">
              <Skeleton className="h-36 rounded-xl" />
              <Skeleton className="h-36 rounded-xl" />
            </div>
            <Skeleton className="h-32 rounded-xl" />
          </div>
        ) : settings && readiness && runtimeStatus ? (
          <>
            {/* Status Row: Policy Control + Runtime Artifacts */}
            <div className="grid gap-4 lg:grid-cols-3">
              {/* Policy Overview */}
              <div className="rounded-xl border border-white/[0.08] bg-slate-900/55 p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <GitBranch className="size-3.5 text-amber-400" />
                    Control Policy v{settings.version}
                  </span>
                  <Badge variant={settings.shadow_enabled ? 'success' : 'neutral'} dot>
                    {settings.shadow_enabled ? 'Shadow: BẬT' : 'Shadow: TẠM DỪNG'}
                  </Badge>
                </div>
                <div className="pt-1">
                  <p className="text-[11px] text-slate-400">Trạng thái Readiness Gate</p>
                  <div className="mt-1">
                    <Badge variant={badgeInfo.variant}>{badgeInfo.label}</Badge>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/[0.06] text-[11px] font-mono">
                  <div>
                    <span className="text-slate-400 block font-sans">Min Mult</span>
                    <span className="text-slate-100 font-semibold">×{settings.guardrails.minimum_multiplier.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-sans">Max Mult</span>
                    <span className="text-slate-100 font-semibold">×{settings.guardrails.maximum_multiplier.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-sans">Biên lệch tối đa</span>
                    <span className="text-amber-300 font-semibold">±{(settings.guardrails.maximum_change_ratio_from_champion * 100).toFixed(0)}%</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">
                  Cập nhật lần cuối: {formatDateTime(settings.updated_at)}
                </p>
              </div>

              {/* Champion Artifact */}
              <div className="rounded-xl border border-white/[0.08] bg-slate-900/55 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Champion Đang Phục Vụ
                  </span>
                  <Badge variant={runtimeStatus.champion_artifact.status === 'ready' ? 'success' : 'danger'}>
                    {runtimeStatus.champion_artifact.status === 'ready' ? 'Runtime Ready' : 'Unavailable'}
                  </Badge>
                </div>
                <div className="space-y-1 text-xs pt-1">
                  <p className="text-slate-300">
                    Model: <span className="font-mono font-semibold text-white">{runtimeStatus.champion_artifact.model_version ?? '—'}</span>
                  </p>
                  <p className="text-slate-400 break-all">
                    Run ID: <span className="font-mono text-slate-200">{runtimeStatus.champion_artifact.training_run_id ?? '—'}</span>
                  </p>
                  <p className="text-slate-400">
                    Contract: <span className="font-mono text-slate-200">{runtimeStatus.champion_artifact.feature_contract_version ?? '—'}</span>
                  </p>
                </div>
                <div className="pt-2 border-t border-white/[0.06] text-[11px] text-slate-400">
                  Khai báo trong Policy:{' '}
                  <span className="font-mono text-slate-200">
                    {settings.champion.model_version ? `${settings.champion.model_version} (${settings.champion.training_run_id?.slice(0, 8)}...)` : 'Chưa gán'}
                  </span>
                </div>
              </div>

              {/* Challenger Artifact & Telemetry */}
              <div className="rounded-xl border border-white/[0.08] bg-slate-900/55 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Conversion Challenger
                  </span>
                  <Badge variant={challengerReady ? 'info' : 'warning'}>
                    {challengerReady ? 'Shadow Ready' : '503 Unavailable'}
                  </Badge>
                </div>
                <p className="text-xs leading-relaxed text-slate-300 pt-1">
                  {runtimeStatus.challenger_artifact.reason_vi}
                </p>
                {challengerReady && (
                  <p className="text-[11px] font-mono text-sky-300 break-all">
                    {runtimeStatus.challenger_artifact.model_version} · {runtimeStatus.challenger_artifact.training_run_id}
                  </p>
                )}
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/[0.06] text-[11px]">
                  <div>
                    <span className="text-slate-400 block">Attempts</span>
                    <span className="font-mono font-semibold text-slate-100">{runtimeStatus.attempt_summary.total_attempts}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Decisions</span>
                    <span className="font-mono font-semibold text-emerald-300">{runtimeStatus.attempt_summary.total_decisions}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Fail/503</span>
                    <span className="font-mono font-semibold text-amber-300">{runtimeStatus.attempt_summary.failed_attempts}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 6 Readiness Gates Grid */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <ShieldCheck className="size-4 text-emerald-400" />
                  6 Tiêu Chí Cổng Kiểm Chứng Dữ Liệu Thật (`ai_pricing_shadow_readiness_v1`)
                </h3>
                <span className="text-xs text-slate-400 font-mono">
                  Opportunity quotes: {readiness.total_opportunity_quotes} · Adjusted by guardrails: {readiness.guardrail_adjusted_decisions}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  {
                    title: '1. Mẫu phơi bày hợp lệ',
                    actual: readiness.eligible_matured_decisions,
                    target: readiness.minimum_confirmed_exposures,
                    display: `${readiness.eligible_matured_decisions} / ${readiness.minimum_confirmed_exposures}`,
                    met: readiness.eligible_matured_decisions >= readiness.minimum_confirmed_exposures,
                    sub: `Confirmed exposure: ${readiness.confirmed_exposure_decisions} · Loại chất lượng: ${readiness.excluded_data_quality_decisions}`,
                  },
                  {
                    title: '2. Mẫu chuyển đổi (Accepted)',
                    actual: readiness.accepted_decisions,
                    target: readiness.minimum_conversions,
                    display: `${readiness.accepted_decisions} / ${readiness.minimum_conversions}`,
                    met: readiness.accepted_decisions >= readiness.minimum_conversions,
                    sub: 'Booking thực sự phát sinh từ báo giá đã hiển thị',
                  },
                  {
                    title: '3. Mẫu không chuyển đổi',
                    actual: readiness.non_accepted_decisions,
                    target: readiness.minimum_non_conversions,
                    display: `${readiness.non_accepted_decisions} / ${readiness.minimum_non_conversions}`,
                    met: readiness.non_accepted_decisions >= readiness.minimum_non_conversions,
                    sub: 'Báo giá đã hiển thị nhưng hết hạn / bị từ chối',
                  },
                  {
                    title: '4. Số ngày quan sát Shadow',
                    actual: readiness.shadow_observation_days,
                    target: readiness.minimum_shadow_days,
                    display: `${readiness.shadow_observation_days} / ${readiness.minimum_shadow_days} ngày`,
                    met: readiness.shadow_observation_days >= readiness.minimum_shadow_days,
                    sub: `Last decision: ${formatDateTime(readiness.last_decision_at)}`,
                  },
                  {
                    title: '5. Tỷ lệ phủ suy luận (Coverage)',
                    actual: readiness.inference_coverage_ratio ?? 0,
                    target: readiness.minimum_inference_coverage_ratio,
                    display: `${formatRatioPct(readiness.inference_coverage_ratio)} (ngưỡng ≥ ${formatRatioPct(readiness.minimum_inference_coverage_ratio)})`,
                    met:
                      readiness.inference_coverage_ratio != null
                      && readiness.inference_coverage_ratio >= readiness.minimum_inference_coverage_ratio,
                    sub: `Succeeded+Decision: ${readiness.succeeded_attempts_with_decisions} / ${readiness.total_opportunity_quotes}`,
                  },
                  {
                    title: '6. Tỷ lệ lỗi suy luận (Error Ratio)',
                    actual: readiness.inference_error_ratio ?? 0,
                    target: readiness.maximum_inference_error_ratio,
                    display: `${formatRatioPct(readiness.inference_error_ratio)} (trần ≤ ${formatRatioPct(readiness.maximum_inference_error_ratio)})`,
                    met:
                      readiness.inference_error_ratio != null
                      && readiness.inference_error_ratio <= readiness.maximum_inference_error_ratio,
                    sub: `Brier score: ${readiness.conversion_brier_score != null ? readiness.conversion_brier_score.toFixed(4) : '—'} · |Δ mult|: ${readiness.mean_absolute_multiplier_delta != null ? readiness.mean_absolute_multiplier_delta.toFixed(4) : '—'}`,
                  },
                ].map((gate) => (
                  <div
                    key={gate.title}
                    className="rounded-xl border border-white/[0.08] bg-slate-900/45 p-3.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-300">{gate.title}</span>
                      <Badge variant={gate.met ? 'success' : 'neutral'} className="text-[10px]">
                        {gate.met ? 'Đạt' : 'Chưa đạt'}
                      </Badge>
                    </div>
                    <p className="font-mono text-sm font-bold text-slate-100 tabular-nums">
                      {gate.display}
                    </p>
                    <p className="text-[11px] text-slate-400 leading-relaxed">{gate.sub}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Collapsible Policy Audit History */}
            <div className="rounded-xl border border-white/[0.08] bg-slate-950/40">
              <button
                type="button"
                onClick={() => setShowAudits((prev) => !prev)}
                className="flex w-full items-center justify-between px-4 py-3 text-xs font-semibold text-slate-200 hover:bg-white/[0.02] transition-colors"
                aria-expanded={showAudits}
              >
                <span className="flex items-center gap-2">
                  <History className="size-4 text-amber-400" />
                  Lịch sử phiên bản Shadow Policy ({audits.length} bản ghi append-only)
                </span>
                <span className="text-amber-400">{showAudits ? 'Ẩn ▲' : 'Xem chi tiết ▼'}</span>
              </button>

              {showAudits && (
                <div className="border-t border-white/[0.08]">
                  {audits.length === 0 ? (
                    <p className="p-4 text-xs text-slate-400">Chưa có bản ghi audit.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Version</TableHead>
                          <TableHead>Trạng thái</TableHead>
                          <TableHead>Lineages (Champion / Challenger)</TableHead>
                          <TableHead>Guardrails</TableHead>
                          <TableHead>Lý do & Thời điểm</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {audits.map((audit) => (
                          <TableRow key={audit.audit_id}>
                            <TableCell className="font-mono font-bold text-slate-100 whitespace-nowrap">
                              v{audit.version}
                              {audit.is_current_control && (
                                <Badge variant="primary" className="ml-2 text-[10px]">
                                  Hiện tại
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={audit.shadow_enabled ? 'success' : 'neutral'}>
                                {audit.shadow_enabled ? 'Bật' : 'Tạm dừng'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs font-mono text-slate-300">
                              <div>C: {audit.champion_model_version ?? '—'}</div>
                              <div className="text-slate-400">S: {audit.challenger_model_version ?? '—'}</div>
                            </TableCell>
                            <TableCell className="text-xs font-mono text-slate-300 whitespace-nowrap">
                              ×{audit.guardrail_min_multiplier.toFixed(2)}–{audit.guardrail_max_multiplier.toFixed(2)} (±{(audit.guardrail_max_change_ratio * 100).toFixed(0)}%)
                            </TableCell>
                            <TableCell className="text-xs text-slate-300 max-w-md">
                              <p className="text-slate-100">{audit.change_reason}</p>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                {formatDateTime(audit.changed_at)}
                              </p>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}
            </div>
          </>
        ) : null}
      </CardContent>

      {/* Edit Shadow Policy Dialog */}
      <Dialog
        open={editOpen}
        onClose={submitting ? () => undefined : () => setEditOpen(false)}
        title={`Cập nhật AI Shadow Policy (hiện tại v${settings?.version ?? 1})`}
        description="Bật/tắt chạy ngầm song song, khai báo Champion/Challenger lineage và ngưỡng sẵn sàng dữ liệu thật. Giá phục vụ khách KHÔNG thay đổi."
        className="max-w-2xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={submitting}>
              Hủy
            </Button>
            <Button onClick={() => void handleSavePolicy()} disabled={submitting}>
              {submitting ? 'Đang lưu...' : 'Lưu phiên bản Policy mới'}
            </Button>
          </>
        }
      >
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          {modalError && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200 flex items-start gap-2">
              <AlertTriangle className="size-4 shrink-0 text-rose-400 mt-0.5" />
              <span>{modalError}</span>
            </div>
          )}

          <div className="flex flex-col gap-2 rounded-xl border border-white/[0.08] bg-slate-900/60 p-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-2.5 text-sm font-medium text-slate-100 cursor-pointer">
              <input
                type="checkbox"
                checked={formEnabled}
                onChange={(e) => setFormEnabled(e.target.checked)}
                className="size-4 accent-amber-500 rounded"
              />
              <span>Kích hoạt Shadow Evaluation (`shadow_enabled`)</span>
            </label>
            <Button type="button" variant="outline" size="sm" onClick={fillLineagesFromRuntime}>
              Điền lineage từ Runtime
            </Button>
          </div>

          {!challengerReady && formEnabled && (
            <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5">
              Lưu ý: Conversion Challenger artifact hiện đang 503 Unavailable. Nếu bật shadow với lineage đầy đủ,
              hệ thống vẫn an toàn fail-open và ghi ledger `outcome = unavailable`.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 rounded-xl border border-white/[0.06] bg-slate-900/40 p-3">
              <p className="text-xs font-semibold text-slate-300">Champion Lineage</p>
              <Input
                placeholder="champion_model_version (vd: random_forest_v2)"
                value={formChampVer}
                onChange={(e) => setFormChampVer(e.target.value)}
              />
              <Input
                placeholder="champion_training_run_id"
                value={formChampRun}
                onChange={(e) => setFormChampRun(e.target.value)}
              />
              <Input
                placeholder="champion_feature_contract_version (vd: 2.0.0)"
                value={formChampFc}
                onChange={(e) => setFormChampFc(e.target.value)}
              />
            </div>

            <div className="space-y-2 rounded-xl border border-white/[0.06] bg-slate-900/40 p-3">
              <p className="text-xs font-semibold text-slate-300">Challenger Lineage</p>
              <Input
                placeholder="challenger_model_version"
                value={formChalVer}
                onChange={(e) => setFormChalVer(e.target.value)}
              />
              <Input
                placeholder="challenger_training_run_id"
                value={formChalRun}
                onChange={(e) => setFormChalRun(e.target.value)}
              />
              <Input
                placeholder="challenger_feature_contract_version"
                value={formChalFc}
                onChange={(e) => setFormChalFc(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-xs text-slate-300">
              <span>Min Multiplier</span>
              <Input type="number" step="0.05" min="0.1" max="3" value={formMinMult} onChange={(e) => setFormMinMult(e.target.value)} />
            </label>
            <label className="space-y-1 text-xs text-slate-300">
              <span>Max Multiplier</span>
              <Input type="number" step="0.05" min="0.1" max="5" value={formMaxMult} onChange={(e) => setFormMaxMult(e.target.value)} />
            </label>
            <label className="space-y-1 text-xs text-slate-300">
              <span>Max Change Ratio (0–1)</span>
              <Input type="number" step="0.01" min="0" max="1" value={formMaxDelta} onChange={(e) => setFormMaxDelta(e.target.value)} />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-xs text-slate-300">
              <span>Min Exposures</span>
              <Input type="number" min="1" value={formMinExposures} onChange={(e) => setFormMinExposures(e.target.value)} />
            </label>
            <label className="space-y-1 text-xs text-slate-300">
              <span>Min Conversions</span>
              <Input type="number" min="1" value={formMinConv} onChange={(e) => setFormMinConv(e.target.value)} />
            </label>
            <label className="space-y-1 text-xs text-slate-300">
              <span>Min Non-Conversions</span>
              <Input type="number" min="1" value={formMinNonConv} onChange={(e) => setFormMinNonConv(e.target.value)} />
            </label>
            <label className="space-y-1 text-xs text-slate-300">
              <span>Min Shadow Days</span>
              <Input type="number" min="1" max="3650" value={formMinDays} onChange={(e) => setFormMinDays(e.target.value)} />
            </label>
            <label className="space-y-1 text-xs text-slate-300">
              <span>Min Coverage Ratio (0–1)</span>
              <Input type="number" step="0.01" min="0" max="1" value={formMinCov} onChange={(e) => setFormMinCov(e.target.value)} />
            </label>
            <label className="space-y-1 text-xs text-slate-300">
              <span>Max Error Ratio (0–1)</span>
              <Input type="number" step="0.01" min="0" max="1" value={formMaxErr} onChange={(e) => setFormMaxErr(e.target.value)} />
            </label>
          </div>

          <label className="block space-y-1 text-xs text-slate-300">
            <span>Lý do thay đổi policy (bắt buộc tối thiểu 10 ký tự)</span>
            <Input
              placeholder="Ví dụ: Cập nhật ngưỡng quan sát shadow thử nghiệm đợt 1..."
              value={formReason}
              onChange={(e) => setFormReason(e.target.value)}
            />
          </label>
        </div>
      </Dialog>

      {/* Pause Shadow Dialog */}
      <Dialog
        open={pauseOpen}
        onClose={submitting ? () => undefined : () => setPauseOpen(false)}
        title="Tạm dừng Shadow Evaluation?"
        description="Báo giá khách hàng từ mô hình Champion vẫn hoạt động bình thường; hệ thống ngừng ghi shadow attempt mới."
        footer={
          <>
            <Button variant="outline" onClick={() => setPauseOpen(false)} disabled={submitting}>
              Đóng
            </Button>
            <Button variant="danger" onClick={() => void handlePauseShadow()} disabled={submitting}>
              {submitting ? 'Đang xử lý...' : 'Xác nhận tạm dừng'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {modalError && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
              {modalError}
            </div>
          )}
          <label className="block space-y-1 text-xs text-slate-300">
            <span>Lý do tạm dừng (tối thiểu 10 ký tự)</span>
            <Input
              placeholder="Ví dụ: Tạm dừng shadow để kiểm tra drift phân phối đầu vào..."
              value={pauseReason}
              onChange={(e) => setPauseReason(e.target.value)}
            />
          </label>
        </div>
      </Dialog>

      {/* Rollback Dialog */}
      <Dialog
        open={rollbackOpen}
        onClose={submitting ? () => undefined : () => setRollbackOpen(false)}
        title="Khôi phục Shadow Policy về phiên bản cũ"
        description="Tạo một phiên bản mới từ snapshot quá khứ với trạng thái Tạm dừng an toàn (shadow_enabled = false)."
        footer={
          <>
            <Button variant="outline" onClick={() => setRollbackOpen(false)} disabled={submitting}>
              Đóng
            </Button>
            <Button onClick={() => void handleRollbackShadow()} disabled={submitting}>
              {submitting ? 'Đang khôi phục...' : 'Khôi phục về trạng thái Tạm dừng'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {modalError && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
              {modalError}
            </div>
          )}
          <label className="block space-y-1 text-xs text-slate-300">
            <span>Chọn phiên bản đích để khôi phục</span>
            <Select
              value={String(rollbackTarget)}
              onChange={(e) => setRollbackTarget(Number(e.target.value))}
            >
              {rollbackCandidates.map((item) => (
                <option key={item.version} value={item.version}>
                  v{item.version} — {item.change_reason.slice(0, 60)}
                </option>
              ))}
            </Select>
          </label>
          <label className="block space-y-1 text-xs text-slate-300">
            <span>Lý do rollback (tối thiểu 10 ký tự)</span>
            <Input
              placeholder="Ví dụ: Khôi phục cấu hình ban đầu sau phiên thử nghiệm..."
              value={rollbackReason}
              onChange={(e) => setRollbackReason(e.target.value)}
            />
          </label>
        </div>
      </Dialog>
    </Card>
  );
}

