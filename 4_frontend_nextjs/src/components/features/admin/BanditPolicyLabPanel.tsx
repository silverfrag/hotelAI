'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  FlaskConical,
  Lock,
  Play,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
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
} from '@/components/ui';
import { simulateBanditPricing } from '@/services/revenue.service';
import type { BanditSimulateResult, PortfolioScenarioId } from '@/types/revenue.type';
import { formatCurrency } from '@/utils/formatCurrency';

interface BanditPolicyLabPanelProps {
  refreshSignal?: number;
}

function buildSvgPolyline(points: Array<{ x: number; y: number }>): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

export function BanditPolicyLabPanel({ refreshSignal = 0 }: BanditPolicyLabPanelProps) {
  const [roomTypeId, setRoomTypeId] = useState(1);
  const [scenarioId, setScenarioId] = useState<PortfolioScenarioId>('weekend_high');
  const [elasticity, setElasticity] = useState(1.25);
  const [episodes, setEpisodes] = useState(300);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BanditSimulateResult | null>(null);

  const runSimulation = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const res = await simulateBanditPricing(
        {
          room_type_id: roomTypeId,
          scenario_id: scenarioId,
          true_price_elasticity: elasticity,
          episodes,
          seed: 42,
        },
        signal,
      );
      if (signal?.aborted) return;
      setResult(res);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      if (!signal?.aborted) {
        setError(
          caught instanceof Error
            ? caught.message
            : 'Không thể chạy mô phỏng Bandit & kiểm định taxonomy.',
        );
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [roomTypeId, scenarioId, elasticity, episodes]);

  useEffect(() => {
    const controller = new AbortController();
    void runSimulation(controller.signal);
    return () => controller.abort();
  }, [runSimulation, refreshSignal]);

  const catalogOptions =
    result?.live_catalog && result.live_catalog.length > 0
      ? result.live_catalog
      : [
          { type_id: 1, name: 'Superior Room', base_price: 1200000 },
          { type_id: 2, name: 'Deluxe Room', base_price: 1400000 },
          { type_id: 3, name: 'Premium Room', base_price: 1600000 },
          { type_id: 4, name: 'Executive Room', base_price: 1700000 },
          { type_id: 5, name: 'Suite', base_price: 1800000 },
          { type_id: 6, name: 'Studio Apartment', base_price: 2000000 },
        ];

  return (
    <Card className="border-indigo-500/20">
      <CardHeader className="border-b border-white/[0.08] pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                <FlaskConical className="size-4.5" />
              </div>
              <CardTitle>
                Bandit Lab (Guardrailed Thompson Sampling) &amp; Kiểm Định Taxonomy
              </CardTitle>
              <Badge variant="warning">[C] SIMULATED BENCHMARK · [D] GUARDRAIL</Badge>
              <Badge variant="outline" className="font-mono text-xs">
                <Lock className="size-3 mr-1 inline" />
                Auto-Promote: Khóa cứng
              </Badge>
            </div>
            <CardDescription className="mt-1">
              Đối chiếu thuật toán Thompson Sampling có rào chắn an toàn [D] với Epsilon-Greedy tự do trong môi trường giả lập [C], đồng thời kiểm toán độ lệch danh mục phòng thực White Sand vs artifact conversion cũ.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void runSimulation()}
            disabled={loading}
          >
            <Play className="size-3.5" />
            {loading ? 'Đang chạy Bandit...' : 'Chạy Benchmark Bandit'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-5">
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200 flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-xl border border-white/[0.08] bg-slate-900/55 p-3.5 text-xs">
          <label className="space-y-1 text-slate-300">
            <span>Hạng phòng White Sand [B]</span>
            <Select value={String(roomTypeId)} onChange={(e) => setRoomTypeId(Number(e.target.value))}>
              {catalogOptions.map((item) => (
                <option key={item.type_id} value={item.type_id}>
                  {item.name} ({formatCurrency(item.base_price)})
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 text-slate-300">
            <span>Kịch bản môi trường [C]</span>
            <Select value={scenarioId} onChange={(e) => setScenarioId(e.target.value as PortfolioScenarioId)}>
              <option value="monsoon_low">Mùa mưa thấp điểm [C]</option>
              <option value="standard">Ngày thường ổn định [C]</option>
              <option value="weekend_high">Cuối tuần cao điểm [C]</option>
              <option value="holiday_surge">Lễ hội / Pháo hoa [C]</option>
            </Select>
          </label>
          <label className="space-y-1 text-slate-300">
            <span>Độ co giãn giá β [C] ({elasticity.toFixed(2)})</span>
            <input
              type="range"
              min={0.5}
              max={2.4}
              step={0.05}
              value={elasticity}
              onChange={(e) => setElasticity(Number(e.target.value))}
              className="w-full accent-indigo-400 mt-2"
            />
          </label>
          <label className="space-y-1 text-slate-300">
            <span>Số phiên khám phá ({episodes} episodes)</span>
            <input
              type="range"
              min={100}
              max={600}
              step={50}
              value={episodes}
              onChange={(e) => setEpisodes(Number(e.target.value))}
              className="w-full accent-indigo-400 mt-2"
            />
          </label>
        </div>

        {loading && !result ? (
          <div className="space-y-3">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-44 rounded-xl" />
          </div>
        ) : result ? (
          <>
            {/* 1. Taxonomy Drift Audit Block */}
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-amber-100 flex items-center gap-2">
                  <ShieldAlert className="size-4 text-amber-400" />
                  Kiểm Toán Taxonomy Challenger ({result.taxonomy_audit.model_version}) vs White Sand Đà Nẵng
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant={result.taxonomy_audit.has_taxonomy_drift ? 'danger' : 'success'}>
                    Khớp danh mục: {result.taxonomy_audit.taxonomy_overlap_pct}%
                  </Badge>
                  <Badge variant="outline" className="font-mono">
                    n={result.taxonomy_audit.artifact_eligible_rows.toLocaleString('en-US')} · AUC{' '}
                    {result.taxonomy_audit.artifact_roc_auc ?? '—'}
                  </Badge>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-2 text-[11px]">
                <div className="rounded-lg border border-white/[0.06] bg-slate-950/60 p-2.5">
                  <span className="text-slate-400 block mb-1">
                    Hạng phòng thực White Sand ({result.taxonomy_audit.live_room_types.length}):
                  </span>
                  <span className="font-mono text-sky-300">
                    {result.taxonomy_audit.live_room_types.join(' · ')}
                  </span>
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-slate-950/60 p-2.5">
                  <span className="text-slate-400 block mb-1">
                    Nhãn resort cũ trong artifact ({result.taxonomy_audit.artifact_room_types.length}):
                  </span>
                  <span className="font-mono text-amber-300">
                    {result.taxonomy_audit.artifact_room_types.join(' · ')}
                  </span>
                </div>
              </div>
              <ul className="space-y-1 text-[11px] text-amber-200/90">
                {result.taxonomy_audit.audit_blockers_vi.map((msg, i) => (
                  <li key={i}>• {msg}</li>
                ))}
              </ul>
            </div>

            {/* 2. 4-Policy Comparison Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              {result.policy_summaries.map((pol) => {
                const isTs = pol.policy_id === 'guardrailed_thompson_sampling';
                const isUnsafe = pol.safety_compliance_pct < 100;
                return (
                  <div
                    key={pol.policy_id}
                    className={`rounded-xl border p-3.5 space-y-1.5 ${
                      isTs
                        ? 'border-emerald-500/40 bg-emerald-950/25'
                        : isUnsafe
                          ? 'border-rose-500/35 bg-rose-950/20'
                          : 'border-white/[0.08] bg-slate-900/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="font-semibold text-slate-100 truncate">{pol.label_vi}</span>
                      <Badge variant={isUnsafe ? 'danger' : 'success'} className="text-[10px] shrink-0">
                        An toàn {pol.safety_compliance_pct}%
                      </Badge>
                    </div>
                    <p className="font-mono text-base font-bold text-white tabular-nums">
                      {formatCurrency(pol.cumulative_expected_contrib_vnd)}
                    </p>
                    <div className="text-[11px] text-slate-400 space-y-0.5 font-mono">
                      <div>Regret: {formatCurrency(pol.cumulative_regret_vnd)}</div>
                      <div>
                        Conv TB: {pol.average_conversion_pct}% · Vi phạm sàn/trần:{' '}
                        <span className={isUnsafe ? 'text-rose-300 font-bold' : 'text-emerald-300'}>
                          {pol.floor_violations + pol.ceiling_violations}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 3. SVG Cumulative Regret Chart + Beta Arm Posteriors */}
            <div className="grid gap-4 lg:grid-cols-12">
              <div className="lg:col-span-6 rounded-xl border border-white/[0.08] bg-slate-950/55 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-100 flex items-center gap-1.5">
                    <TrendingDown className="size-4 text-emerald-400" />
                    Đường Cong Cumulative Regret (VND — Càng thấp càng tốt)
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    Oracle Arm: {formatCurrency(Number(result.oracle_best_arm.price_vnd))}
                  </span>
                </div>

                {(() => {
                  const series = result.regret_series;
                  const W = 520;
                  const H = 175;
                  const padL = 14;
                  const padR = 14;
                  const padT = 14;
                  const padB = 22;
                  const maxRegret = Math.max(
                    1,
                    ...series.flatMap((pt) => [
                      pt.static_regret_vnd,
                      pt.heuristic_regret_vnd,
                      pt.eps_greedy_regret_vnd,
                      pt.thompson_regret_vnd,
                    ]),
                  );
                  const toX = (ep: number) =>
                    padL + ((ep - series[0].episode) / Math.max(1, episodes - series[0].episode)) * (W - padL - padR);
                  const toY = (val: number) => H - padB - (val / maxRegret) * (H - padT - padB);

                  const lines = [
                    {
                      name: 'Guardrailed TS [D]',
                      color: '#34d399',
                      pts: series.map((pt) => ({ x: toX(pt.episode), y: toY(pt.thompson_regret_vnd) })),
                    },
                    {
                      name: 'Rule Heuristic',
                      color: '#38bdf8',
                      pts: series.map((pt) => ({ x: toX(pt.episode), y: toY(pt.heuristic_regret_vnd) })),
                    },
                    {
                      name: 'Unconstrained ε-Greedy',
                      color: '#fb7185',
                      pts: series.map((pt) => ({ x: toX(pt.episode), y: toY(pt.eps_greedy_regret_vnd) })),
                    },
                    {
                      name: 'Static Base (1.0x)',
                      color: '#fbbf24',
                      pts: series.map((pt) => ({ x: toX(pt.episode), y: toY(pt.static_regret_vnd) })),
                    },
                  ];

                  return (
                    <>
                      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44 overflow-visible">
                        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#334155" strokeWidth="1" />
                        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#334155" strokeWidth="1" />
                        {lines.map((line) => (
                          <polyline
                            key={line.name}
                            fill="none"
                            stroke={line.color}
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={buildSvgPolyline(line.pts)}
                          />
                        ))}
                        <text x={padL} y={H - 5} fontSize="10" fill="#94a3b8">
                          ep 1
                        </text>
                        <text x={W - 44} y={H - 5} fontSize="10" fill="#94a3b8">
                          ep {episodes}
                        </text>
                      </svg>
                      <div className="flex flex-wrap gap-3 text-[11px] text-slate-300">
                        {lines.map((line) => (
                          <span key={line.name} className="inline-flex items-center gap-1.5">
                            <span
                              className="inline-block size-2.5 rounded-full"
                              style={{ backgroundColor: line.color }}
                            />
                            {line.name}
                          </span>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Beta Posterior Distribution per Safe Arm */}
              <div className="lg:col-span-6 rounded-xl border border-white/[0.08] bg-slate-950/55 p-4 space-y-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-100 flex items-center gap-1.5">
                    <ShieldCheck className="size-4 text-indigo-400" />
                    Phân Phối Hậu Nghiệm Beta(α, β) Trên {result.guardrails.safe_arm_count} Mức Giá An Toàn [D]
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    [{formatCurrency(result.guardrails.contribution_floor_vnd)} ..{' '}
                    {formatCurrency(result.guardrails.declared_ceiling_vnd)}]
                  </span>
                </div>
                <div className="space-y-2">
                  {result.thompson_arms.map((arm) => {
                    const pullShare = Math.round((arm.pulls / Math.max(1, result.episodes)) * 100);
                    return (
                      <div
                        key={arm.price_vnd}
                        className="rounded-lg border border-white/[0.06] bg-slate-900/60 p-2.5 space-y-1"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono font-bold text-slate-100">
                            {formatCurrency(arm.price_vnd)} (×{arm.multiplier.toFixed(2)})
                            {arm.is_oracle_best && (
                              <Badge variant="success" className="ml-2 text-[10px]">
                                Oracle EV Max
                              </Badge>
                            )}
                          </span>
                          <span className="font-mono text-[11px] text-slate-300">
                            {arm.pulls} pulls ({pullShare}%) · E[p]={(arm.posterior_mean_conv * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              arm.is_oracle_best ? 'bg-emerald-400' : 'bg-indigo-400'
                            }`}
                            style={{ width: `${Math.max(4, pullShare)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

