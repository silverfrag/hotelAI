'use client';

import React, { useState } from 'react';
import { BarChart3, ChevronDown, ChevronUp, Gauge, Info, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui';
import type {
  PriceExplanationFeatureAttribution,
  PriceExplanationPayload,
  UncertaintyInterval,
} from '@/types/admin.type';
import { formatCurrency } from '@/utils/formatCurrency';

export type FeatureAttribution = PriceExplanationFeatureAttribution;
export type PriceExplanation = PriceExplanationPayload;

export interface AiPriceExplanationProps {
  explanation: PriceExplanation;
  multiplier: number;
  basePrice?: number;
  modelVersion?: string;
  trainingRunId?: string;
  featureContractVersion?: string;
  uncertainty?: UncertaintyInterval | null;
  defaultExpanded?: boolean;
  className?: string;
}

function oodStatusMeta(status: UncertaintyInterval['ood_status']) {
  switch (status) {
    case 'in_distribution':
      return {
        label: 'Trong phân phối (In-Dist)',
        variant: 'success' as const,
        className: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200',
      };
    case 'border':
      return {
        label: 'Vùng rìa (Border)',
        variant: 'warning' as const,
        className: 'border-amber-500/35 bg-amber-500/10 text-amber-200',
      };
    case 'out_of_distribution':
      return {
        label: 'Ngoại lai (OOD Alert)',
        variant: 'danger' as const,
        className: 'border-rose-500/35 bg-rose-500/10 text-rose-200',
      };
  }
}

function attributionBarClass(attr: number): string {
  if (attr > 0.02) return 'bg-emerald-500';
  if (attr < -0.02) return 'bg-rose-500';
  return 'bg-slate-400';
}

function attributionTextClass(attr: number): string {
  if (attr > 0.02) return 'text-emerald-400';
  if (attr < -0.02) return 'text-rose-400';
  return 'text-slate-300';
}

function attributionSign(attr: number): string {
  if (attr > 0.001) return '+';
  if (attr < -0.001) return '−';
  return '';
}

/**
 * AiPriceExplanation
 *
 * Displays genuine Saabas Tree Interpreter feature attributions from
 * `POST /api/v1/explain-price` on Random Forest V2 (sourced strictly from
 * Portugal 2015–2017 ADR benchmark data; no fabricated demand claims).
 */
export default function AiPriceExplanation({
  explanation,
  multiplier,
  basePrice = 1_200_000,
  modelVersion,
  trainingRunId,
  featureContractVersion,
  uncertainty,
  defaultExpanded = false,
  className = '',
}: AiPriceExplanationProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const effectivePrice = Math.round(basePrice * multiplier);
  const conformalLowVnd = uncertainty ? Math.round(basePrice * uncertainty.conformal_low) : null;
  const conformalHighVnd = uncertainty ? Math.round(basePrice * uncertainty.conformal_high) : null;
  const oodMeta = uncertainty ? oodStatusMeta(uncertainty.ood_status) : null;
  const coveragePct = uncertainty?.empirical_holdout_coverage != null
    ? `${(uncertainty.empirical_holdout_coverage * 100).toFixed(1)}%`
    : uncertainty
      ? `${Math.round(uncertainty.target_coverage * 100)}%`
      : null;
  const demandPct = Math.max(0, Math.min(100, Math.round(explanation.demand_share_pct)));
  const temporalPct = Math.max(0, Math.min(100, Math.round(explanation.temporal_share_pct)));

  const topAttributions = [...explanation.attributions]
    .sort((a, b) => Math.abs(b.pct_contribution) - Math.abs(a.pct_contribution))
    .slice(0, 6);

  return (
    <div
      className={`rounded-xl border border-purple-500/25 bg-slate-950/75 p-4 text-xs text-slate-200 space-y-3 ${className}`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-semibold text-purple-300 uppercase tracking-wider text-[11px]">
            <BarChart3 className="size-3.5 text-purple-400" />
            Saabas Tree Interpreter
          </span>
          <Badge variant="outline" className="border-purple-500/35 bg-purple-500/10 text-purple-200 font-mono text-[10px]">
            (A) ML Benchmark Portugal V2
          </Badge>
          {modelVersion && (
            <Badge variant="neutral" className="font-mono text-[10px]">
              {modelVersion}
            </Badge>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-white/10 transition-colors"
        >
          {expanded ? (
            <>
              <span>Thu gọn</span>
              <ChevronUp className="size-3.5" />
            </>
          ) : (
            <>
              <span>Xem bóc tách cây quyết định</span>
              <ChevronDown className="size-3.5" />
            </>
          )}
        </button>
      </div>

      {/* Headline & Multiplier summary */}
      <div className="grid gap-2.5 sm:grid-cols-3">
        <div className="rounded-lg border border-white/[0.06] bg-slate-900/70 p-3 sm:col-span-2">
          <p className="text-[11px] text-slate-400">Yếu tố chi phối chính theo cây RF</p>
          <p className="mt-1 text-xs font-semibold text-slate-100 leading-relaxed">
            {explanation.primary_driver}
          </p>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-slate-900/70 p-3 flex flex-col justify-between">
          <p className="text-[11px] text-slate-400">Hệ số dự đoán (A)</p>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="font-mono text-base font-bold text-amber-400 tabular-nums">
              ×{Number(multiplier).toFixed(4)}
            </span>
            <span className="font-mono text-[11px] text-slate-300 tabular-nums">
              ≈ {formatCurrency(effectivePrice)}/đêm
            </span>
          </div>
        </div>
      </div>

      {/* Split Conformal 90% Interval & Mahalanobis OOD Gate */}
      {uncertainty && oodMeta && conformalLowVnd != null && conformalHighVnd != null && (
        <div className="grid gap-2.5 sm:grid-cols-2 rounded-lg border border-sky-500/25 bg-sky-950/20 p-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-300">
                <Gauge className="size-3.5 text-sky-400" />
                Split Conformal {Math.round(uncertainty.target_coverage * 100)}% Interval
              </span>
              <Badge variant="outline" className="border-sky-500/35 bg-sky-500/10 text-sky-200 font-mono text-[10px]">
                Holdout {coveragePct} (n={uncertainty.calibration_rows.toLocaleString('en-US')})
              </Badge>
            </div>
            <div className="font-mono text-xs font-bold text-slate-100 tabular-nums">
              ×{uncertainty.conformal_low.toFixed(3)} – ×{uncertainty.conformal_high.toFixed(3)}
              <span className="ml-1.5 font-normal text-sky-200">
                ({formatCurrency(conformalLowVnd)} – {formatCurrency(conformalHighVnd)}/đêm)
              </span>
            </div>
            <p className="text-[11px] font-mono text-slate-400 tabular-nums">
              RF Trees P10/P50/P90: {uncertainty.ensemble_p10.toFixed(3)} / {uncertainty.ensemble_p50.toFixed(3)} / {uncertainty.ensemble_p90.toFixed(3)} (σ={uncertainty.ensemble_std.toFixed(3)})
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-200">
                <ShieldCheck className="size-3.5 text-emerald-400" />
                Mahalanobis OOD Gate
              </span>
              <Badge variant={oodMeta.variant} dot className="text-[10px]">
                {oodMeta.label}
              </Badge>
            </div>
            <div className="font-mono text-[11px] text-slate-300 tabular-nums">
              D_M = <strong>{uncertainty.ood_distance.toFixed(3)}</strong>
              {uncertainty.ood_p95_threshold != null && (
                <span className="text-slate-400">
                  {' '}· ngưỡng p95={uncertainty.ood_p95_threshold.toFixed(2)}
                  {uncertainty.ood_p99_threshold != null ? `, p99=${uncertainty.ood_p99_threshold.toFixed(2)}` : ''}
                </span>
              )}
            </div>
            {uncertainty.ood_notes.length > 0 ? (
              <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-amber-200">
                {uncertainty.ood_notes.map((note, idx) => (
                  <li key={idx}>{note}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-slate-400">
                Tổ hợp đầu vào nằm trong vùng mật độ đặc trưng lịch sử Portugal V2.
              </p>
            )}
          </div>
        </div>
      )}

      {expanded && (
        <div className="space-y-4 pt-2 border-t border-white/[0.06]">
          {/* Demand/Context vs Temporal split */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-purple-300 font-medium">
                Độ dài lưu trú / quy mô khách ({demandPct}%)
              </span>
              <span className="text-amber-300 font-medium">
                Thời điểm & đặt trước ({temporalPct}%)
              </span>
            </div>
            <div
              className="flex h-2 w-full overflow-hidden rounded-full bg-slate-800"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={demandPct}
            >
              <div
                className="h-full bg-purple-500 transition-all duration-300"
                style={{ width: `${demandPct}%` }}
              />
              <div
                className="h-full bg-amber-400 transition-all duration-300"
                style={{ width: `${temporalPct}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed flex items-start gap-1.5 pt-0.5">
              <Info className="size-3.5 shrink-0 text-slate-400 mt-0.5" />
              <span>
                Hợp đồng đặc trưng V2 chỉ sử dụng tín hiệu thời gian & cấu trúc booking lịch sử từ Portugal 2015–2017;
                tồn kho thực tế tại White Sand được điều chỉnh ở tầng Engine (B/C/D).
              </span>
            </p>
          </div>

          {/* Waterfall Attributions */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-amber-400" />
              Đóng góp từng đặc trưng (Top {topAttributions.length})
            </h4>
            <div className="space-y-2">
              {topAttributions.map((attr) => (
                <div
                  key={attr.feature}
                  className="rounded-lg border border-white/[0.06] bg-slate-900/50 p-2.5 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge
                        variant="outline"
                        className={
                          attr.category === 'demand'
                            ? 'border-purple-500/35 bg-purple-500/10 text-purple-200 text-[10px]'
                            : 'border-amber-500/35 bg-amber-500/10 text-amber-200 text-[10px]'
                        }
                      >
                        {attr.category === 'demand' ? 'KHÁCH / ĐÊM' : 'LỊCH / LEAD TIME'}
                      </Badge>
                      <span className="font-medium text-slate-100 truncate">
                        {attr.human_label}
                      </span>
                      <span className="font-mono text-[11px] text-slate-400 shrink-0">
                        = {String(attr.value)}
                      </span>
                    </div>
                    <span
                      className={`font-mono font-semibold shrink-0 tabular-nums ${attributionTextClass(attr.attribution)}`}
                    >
                      {attributionSign(attr.attribution)}
                      {Math.abs(attr.pct_contribution).toFixed(1)}%
                      <span className="ml-1 text-[10px] text-slate-400 font-normal">
                        ({attr.attribution >= 0 ? '+' : ''}
                        {attr.attribution.toFixed(4)})
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${attributionBarClass(attr.attribution)}`}
                      style={{ width: `${Math.min(100, Math.abs(attr.pct_contribution))}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">{attr.interpretation}</p>
                </div>
              ))}
            </div>
          </div>

          {/* RF Counterfactual */}
          <div className="rounded-lg border-l-2 border-purple-500 bg-purple-500/10 px-3 py-2.5 text-xs text-purple-100 leading-relaxed">
            <span className="font-semibold text-purple-200">Kiểm tra counterfactual trên RF: </span>
            {explanation.counterfactual}
          </div>

          {/* Provenance & Scope disclaimer */}
          <div className="rounded-lg border border-white/[0.06] bg-slate-900/40 px-3 py-2.5 text-[11px] text-slate-400 leading-relaxed flex flex-col gap-1">
            <div className="flex items-start gap-1.5">
              <ShieldAlert className="size-3.5 shrink-0 text-amber-400 mt-0.5" />
              <span>{explanation.ai_vs_script_note}</span>
            </div>
            {(trainingRunId || featureContractVersion) && (
              <p className="font-mono text-[10px] text-slate-500 pl-5 break-all">
                Hợp đồng đặc trưng: {featureContractVersion ?? 'N/A'} · Run ID: {trainingRunId ?? 'N/A'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
