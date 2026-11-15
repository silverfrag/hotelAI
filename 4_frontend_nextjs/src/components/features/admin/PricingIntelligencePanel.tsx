'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Activity, BrainCircuit, Clock3, RefreshCw } from 'lucide-react';
import {
  Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  Input, Select, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { AdminApiError } from '@/services/admin.service';
import { getPricingIntelligence } from '@/services/pricing-intelligence.service';
import type { PricingIntelligence } from '@/types/pricing-intelligence.type';
import type { AuthSession } from '@/types/user.type';

type SnapshotState = {
  owner: AuthSession | null;
  query: string;
  data: PricingIntelligence | null;
  loading: boolean;
  error: string;
};

function displayDate(date: string): string {
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${date}T00:00:00Z`));
}

function displayTimestamp(data: PricingIntelligence): string {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: data.timezone,
  }).format(new Date(data.generated_at));
}

function businessDate(data: PricingIntelligence): string {
  const parts = new Intl.DateTimeFormat('en', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: data.timezone,
  }).formatToParts(new Date(data.generated_at));
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function PricingIntelligencePanel() {
  const { session } = useAuth();
  const [startDate, setStartDate] = useState('');
  const [days, setDays] = useState(14);
  const [roomType, setRoomType] = useState('all');
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<SnapshotState>({ owner: null, query: '', data: null, loading: true, error: '' });
  const query = `${startDate}:${days}`;
  const authorized = session?.user.role === 'admin';
  // The marker is shared by cookie sessions; scope snapshots to the session object.
  const current = authorized && state.owner === session && state.query === query;
  const data = current ? state.data : null;
  const loading = authorized && (!current || state.loading);
  const error = current ? state.error : '';

  useEffect(() => {
    if (!session || session.user.role !== 'admin') return;
    const controller = new AbortController();
    let active = true;
    setState(previous => ({
      owner: session, query, loading: true,
      data: previous.owner === session && previous.query === query ? previous.data : null,
      error: previous.owner === session && previous.query === query ? previous.error : '',
    }));
    void getPricingIntelligence(session.accessToken, {
      ...(startDate ? { start_date: startDate } : {}), days, signal: controller.signal,
    }).then(result => {
      if (active) setState({ owner: session, query, data: result, loading: false, error: '' });
    }).catch((caught: unknown) => {
      if (!active) return;
      const denied = caught instanceof AdminApiError && [401, 403].includes(caught.status);
      const message = caught instanceof AdminApiError && caught.status >= 400 && caught.status < 500
        ? caught.message : 'Không thể cập nhật dữ liệu điều hành AI. Kiểm tra kết nối và thử lại.';
      setState(previous => ({ ...previous, data: denied ? null : previous.data, loading: false, error: message }));
    });
    return () => { active = false; controller.abort(); };
  }, [session, startDate, days, query, refresh]);

  const roomTypes = useMemo(() => [...new Map(data?.daily_inventory.map(row => [row.room_type_id, row.room_type_name]) ?? [])], [data]);
  const selectedType = roomType === 'all' || roomTypes.some(([id]) => String(id) === roomType) ? roomType : 'all';
  const dailyRows = useMemo(() => {
    const rows = new Map<string, { date: string; sellable: number; confirmed: number; held: number; blocked: number; available: number }>();
    for (const item of data?.daily_inventory ?? []) {
      if (selectedType !== 'all' && String(item.room_type_id) !== selectedType) continue;
      const row = rows.get(item.stay_date) ?? { date: item.stay_date, sellable: 0, confirmed: 0, held: 0, blocked: 0, available: 0 };
      row.sellable += item.sellable_rooms;
      row.confirmed += item.confirmed_rooms;
      row.held += item.held_rooms;
      row.blocked += item.operationally_blocked_rooms;
      row.available += item.available_rooms;
      rows.set(item.stay_date, row);
    }
    return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [data, selectedType]);

  if (!authorized) return null;

  return (
    <Card className="mb-8 min-w-0" aria-label="Dữ liệu điều hành AI" aria-busy={loading}>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2.5"><Activity className="size-5 text-amber-400" aria-hidden="true" />Dữ liệu điều hành AI</CardTitle>
            <CardDescription className="mt-2">Theo dõi phòng đã đặt theo từng đêm và phạm vi đã kiểm chứng của mô hình.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setRefresh(value => value + 1)} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            {loading ? 'Đang cập nhật' : 'Cập nhật dữ liệu AI'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1.5 text-xs font-medium text-slate-300">
            <span>Đêm bắt đầu</span>
            <Input type="date" aria-label="Đêm bắt đầu theo dõi AI" min={data ? businessDate(data) : undefined} value={startDate || data?.period.start_date || ''}
              onChange={event => setStartDate(event.target.value)} />
          </label>
          <label className="space-y-1.5 text-xs font-medium text-slate-300">
            <span>Khoảng theo dõi</span>
            <Select aria-label="Số đêm theo dõi AI" value={days} onChange={event => setDays(Number(event.target.value))}>
              <option value={7}>7 đêm</option><option value={14}>14 đêm</option><option value={30}>30 đêm</option>
            </Select>
          </label>
          <label className="space-y-1.5 text-xs font-medium text-slate-300">
            <span>Hạng phòng</span>
            <Select aria-label="Hạng phòng theo dõi AI" value={selectedType} onChange={event => setRoomType(event.target.value)} disabled={!data}>
              <option value="all">Tất cả hạng phòng</option>
              {roomTypes.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}
            </Select>
          </label>
        </div>

        {error && (
          <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200 sm:flex-row sm:items-center">
            <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{error}{data && ' Bảng bên dưới là lần tải trước, có thể đã thay đổi.'}</p>
            </div>
            <Button variant="outline" size="sm" className="shrink-0 sm:ml-auto" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Thử tải lại dữ liệu AI</Button>
          </div>
        )}

        {loading && !data && <div role="status" className="space-y-3"><p className="text-sm text-slate-400">Đang tải trạng thái phòng và mô hình…</p><Skeleton className="h-24" /><Skeleton className="h-52" /></div>}

        {data && <>
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-xl border border-white/[0.08] bg-slate-900/50 p-4">
              <p className="flex items-center gap-2 text-xs font-medium text-slate-400"><BrainCircuit className="size-4" aria-hidden="true" />Mô hình báo giá</p>
              <div className="mt-2 flex flex-wrap items-center gap-2"><strong className="break-all text-sm text-slate-100">{data.model.version || 'Chưa xác định phiên bản'}</strong>
                <Badge variant={data.model.status === 'ready' ? 'success' : 'warning'}>{data.model.status === 'ready' ? 'Sẵn sàng' : 'Chưa kết nối'}</Badge>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">{data.model.scope === 'historical_adr_benchmark' ? 'Mô hình tham chiếu học giá phòng lịch sử.' : 'Chưa xác minh phạm vi dữ liệu huấn luyện.'} Chưa kiểm chứng trên thị trường Việt Nam.</p>
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
              <p className="text-xs font-medium text-amber-300">Dự báo nhu cầu</p>
              <p className="mt-2 text-sm font-semibold text-slate-100">Chưa có dự báo được kiểm chứng</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">{data.forecast.reason}</p>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-slate-900/50 p-4">
              <p className="flex items-center gap-2 text-xs font-medium text-slate-400"><Clock3 className="size-4" aria-hidden="true" />{loading ? 'Đang tải bản mới' : error ? 'Bản dữ liệu trước' : 'Thời điểm dữ liệu'}</p>
              <p className="mt-2 text-sm font-semibold tabular-nums text-slate-100">{displayTimestamp(data)}</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">{data.timezone}. Đọc trực tiếp lịch đặt phòng và trạng thái phòng của hệ thống.</p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-100">Tình trạng phòng theo đêm</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">Đã xác nhận và đang giữ là các đặt phòng hiện có; chưa bao gồm khách có thể đặt thêm. Mốc kết thúc {displayDate(data.period.end_date)} không tính thêm một đêm.</p>
          </div>

          {dailyRows.length ? <div className="overflow-hidden rounded-xl border border-white/[0.08]">
            <Table aria-label="Tồn phòng theo đêm cho định giá AI">
              <TableHeader><TableRow>
                <TableHead scope="col">Đêm lưu trú</TableHead><TableHead scope="col">Phòng khai thác</TableHead>
                <TableHead scope="col">Đã xác nhận</TableHead><TableHead scope="col">Đang giữ</TableHead>
                <TableHead scope="col">Chặn vận hành</TableHead><TableHead scope="col">Còn có thể bán</TableHead>
              </TableRow></TableHeader>
              <TableBody>{dailyRows.map(row => <TableRow key={row.date}>
                <TableHead scope="row" className="text-slate-200">{displayDate(row.date)}</TableHead>
                <TableCell className="tabular-nums">{row.sellable}</TableCell>
                <TableCell className="min-w-32 tabular-nums"><span>{row.confirmed}</span>
                  <div aria-hidden="true" className="mt-1.5 h-1.5 w-20 overflow-hidden rounded-full bg-slate-700">
                    <div className="h-full rounded-full bg-amber-400" style={{ width: `${row.sellable ? row.confirmed / row.sellable * 100 : 0}%` }} />
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">{row.held}</TableCell>
                <TableCell className="tabular-nums">{row.blocked}</TableCell>
                <TableCell className="font-semibold tabular-nums text-emerald-300">{row.available}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </div> : <p className="rounded-xl border border-white/[0.08] p-5 text-sm text-slate-400">Chưa có dữ liệu phòng trong khoảng đã chọn.</p>}

          <details className="rounded-xl border border-white/[0.08] p-4 text-xs text-slate-400">
            <summary className="cursor-pointer font-medium text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">Nguồn dữ liệu và cách đọc</summary>
            <p className="mt-3 leading-relaxed">Phòng khai thác đã loại phòng bảo trì. Phòng còn bán = phòng khai thác − đã xác nhận − đang giữ − chặn vận hành. Dữ liệu vận hành trong bảng được tách biệt với dự báo học máy.</p>
            {data.notes.length > 0 && <ul className="mt-3 list-disc space-y-2 pl-4">{data.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
            <p className="mt-3 break-all">Hợp đồng đặc trưng: {data.model.feature_contract_version || 'Chưa có'} · Lần huấn luyện: {data.model.training_run_id || 'Chưa có'}</p>
          </details>
        </>}
      </CardContent>
    </Card>
  );
}
