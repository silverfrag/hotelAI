'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Microscope, Play, ShieldAlert } from 'lucide-react';
import AiPriceExplanation from '@/components/features/booking/AiPriceExplanation';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
  Skeleton,
} from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { explainPricingSample } from '@/services/admin.service';
import type { AdminExplainSampleResult } from '@/types/admin.type';

interface AdminExplainSamplePanelProps {
  refreshSignal?: number;
}

const WHITE_SAND_TIERS = [
  { id: 1, name: 'Superior Room (1.200.000 đ)', basePrice: 1_200_000 },
  { id: 2, name: 'Deluxe Room (1.400.000 đ)', basePrice: 1_400_000 },
  { id: 3, name: 'Premium Room (1.600.000 đ)', basePrice: 1_600_000 },
  { id: 4, name: 'Executive Room (1.700.000 đ)', basePrice: 1_700_000 },
  { id: 5, name: 'Suite (1.800.000 đ)', basePrice: 1_800_000 },
  { id: 6, name: 'Studio Apartment (2.000.000 đ)', basePrice: 2_000_000 },
];

function addDaysVnIso(days: number): string {
  const vnToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date());
  const parts = vnToday.split('-').map(Number);
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return dt.toISOString().slice(0, 10);
}

export function AdminExplainSamplePanel({ refreshSignal = 0 }: AdminExplainSamplePanelProps) {
  const { session } = useAuth();
  const accessToken = session?.accessToken ?? '';
  const authorized = session?.user.role === 'admin';

  const [checkInDate, setCheckInDate] = useState(() => addDaysVnIso(14));
  const [checkOutDate, setCheckOutDate] = useState(() => addDaysVnIso(16));
  const [leadTime, setLeadTime] = useState('14');
  const [guestCount, setGuestCount] = useState('2');
  const [basePrice, setBasePrice] = useState(1_200_000);

  const [result, setResult] = useState<AdminExplainSampleResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const paramsRef = useRef({ checkInDate, checkOutDate, leadTime, guestCount });
  paramsRef.current = { checkInDate, checkOutDate, leadTime, guestCount };

  const runInspection = useCallback(async () => {
    if (!accessToken || !authorized) return;
    const {
      checkInDate: ci,
      checkOutDate: co,
      leadTime: lt,
      guestCount: gc,
    } = paramsRef.current;

    if (co <= ci) {
      setError('Ngày trả phòng phải sau ngày nhận phòng ít nhất 1 đêm.');
      return;
    }
    const parsedLead = Math.max(0, Math.min(730, Math.round(Number(lt) || 0)));
    const parsedGuests = Math.max(1, Math.min(20, Math.round(Number(gc) || 1)));

    setLoading(true);
    setError('');
    try {
      const response = await explainPricingSample(accessToken, {
        lead_time: parsedLead,
        check_in_date: ci,
        check_out_date: co,
        guest_count: parsedGuests,
      });
      setResult(response);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Không thể chạy phân tích Saabas Tree Interpreter.',
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, authorized]);

  useEffect(() => {
    void runInspection();
  }, [runInspection, refreshSignal]);

  if (!authorized) return null;

  return (
    <Card className="mb-8 min-w-0" aria-label="Kiểm tra Saabas Tree Interpreter V2">
      <CardHeader className="border-b border-white/[0.08] pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-purple-500/15 text-purple-300 border border-purple-500/25 shadow-sm">
                <Microscope className="size-4.5" />
              </div>
              Kiểm Tra Diễn Giải Cây Quyết Định (`/api/v1/explain-price`)
              <Badge variant="outline" className="border-purple-500/30 text-purple-200 bg-purple-500/10 text-[11px]">
                Read-Only Diagnostic
              </Badge>
            </CardTitle>
            <CardDescription className="mt-1.5">
              Kiểm thử trực tiếp đóng góp từng đặc trưng của Random Forest V2 (Saabas Tree Interpreter).
              Không tạo bản ghi `pricing_quotes` mới; tự động trả `503 có kiểm soát` nếu model thiếu `.estimators_`.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => void runInspection()} disabled={loading}>
            <Play className="size-3.5" />
            {loading ? 'Đang giải thích...' : 'Phân tích mẫu'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="space-y-1 text-xs font-medium text-slate-300">
            <span>Check-in</span>
            <Input
              type="date"
              value={checkInDate}
              onChange={(e) => setCheckInDate(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-300">
            <span>Check-out</span>
            <Input
              type="date"
              value={checkOutDate}
              onChange={(e) => setCheckOutDate(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-300">
            <span>Đặt trước (ngày)</span>
            <Input
              type="number"
              min="0"
              max="730"
              value={leadTime}
              onChange={(e) => setLeadTime(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-300">
            <span>Số khách</span>
            <Input
              type="number"
              min="1"
              max="20"
              value={guestCount}
              onChange={(e) => setGuestCount(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-300">
            <span>Hạng phòng tham chiếu (B)</span>
            <Select
              value={String(basePrice)}
              onChange={(e) => setBasePrice(Number(e.target.value))}
            >
              {WHITE_SAND_TIERS.map((tier) => (
                <option key={tier.id} value={tier.basePrice}>
                  {tier.name}
                </option>
              ))}
            </Select>
          </label>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-200 flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {loading && !result ? (
          <Skeleton className="h-44 rounded-xl" />
        ) : result ? (
          result.available ? (
            <AiPriceExplanation
              explanation={result.explanation}
              multiplier={result.ai_multiplier}
              basePrice={basePrice}
              modelVersion={result.model_version}
              trainingRunId={result.training_run_id}
              featureContractVersion={result.feature_contract_version}
              uncertainty={result.uncertainty}
              defaultExpanded
            />
          ) : (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-100 space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-amber-200">
                <ShieldAlert className="size-4 shrink-0 text-amber-400" />
                <span>Trạng thái diễn giải: Khóa có kiểm soát (HTTP {result.status_code ?? 'N/A'})</span>
              </div>
              <p className="text-amber-100/90 leading-relaxed pl-6">{result.reason_vi}</p>
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
