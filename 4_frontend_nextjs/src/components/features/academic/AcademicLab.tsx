'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { getAcademicHoldout, getAcademicInfo, runAcademicDecision, runAcademicExperiment } from '@/services/academic.service';
import type { AcademicDecision, AcademicExperiment, AcademicInfo, AcademicInput, AcademicTask, CandidateMetrics, HoldoutOrder, HoldoutPage } from '@/types/academic.type';

const number = (value: number | null | undefined, digits = 2) => value == null ? 'Chưa có' : value.toLocaleString('vi-VN', { maximumFractionDigits: digits });
const percent = (value: number | null) => value == null ? 'Chưa có' : `${number(value * 100, 1)}%`;
const labels: Record<string, string> = {
  hotel: 'Loại khách sạn gốc', reserved_room_type: 'Mã hạng phòng gốc', meal: 'Gói ăn (mã gốc)',
  market_segment: 'Phân khúc đặt phòng', distribution_channel: 'Kênh phân phối', customer_type: 'Loại booking',
  lead_time: 'Số ngày đặt trước', stay_nights: 'Số đêm', adults: 'Người lớn', children: 'Trẻ em', babies: 'Em bé',
  arrival_and_stay: 'Ngày đến và thời gian ở', hotel_and_room: 'Khách sạn và mã phòng',
};
const panel = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm';
const control = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-100';
const button = 'rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-900 disabled:cursor-wait disabled:opacity-50';

function Metrics({ info, task }: { info: AcademicInfo; task: AcademicTask }) {
  const report = info.tasks[task];
  const columns: (keyof CandidateMetrics)[] = task === 'adr' ? ['mae', 'rmse', 'r2'] : ['precision', 'recall', 'f1', 'roc_auc', 'pr_auc', 'brier', 'log_loss'];
  return <section className={panel} aria-labelledby="metrics-title">
    <h2 id="metrics-title" className="text-lg font-bold">Đối chứng trên cùng tập test</h2>
    <p className="mt-1 text-sm text-slate-600">Chọn mô hình bằng validation {report.selection_metric}. Tập test chưa dùng để fit hoặc chọn mô hình.</p>
    <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm">
      <caption className="sr-only">Kết quả baseline và mô hình {task}</caption>
      <thead><tr><th className="p-2">Phương pháp</th>{columns.map(key => <th className="p-2" key={key}>{key.toUpperCase()}</th>)}</tr></thead>
      <tbody>{Object.entries(report.test).map(([name, metrics]) => <tr className={name === report.selected ? 'border-t bg-teal-50' : 'border-t'} key={name}>
        <th className="p-2 font-medium">{name.replaceAll('_', ' ')} {name === report.selected && <span className="text-xs font-bold text-teal-800">ĐƯỢC CHỌN</span>}</th>
        {columns.map(key => <td className="p-2 tabular-nums" key={key}>{typeof metrics[key] === 'number' ? number(metrics[key] as number, 4) : '—'}</td>)}
      </tr>)}</tbody>
    </table></div>
    <p className="mt-3 text-xs text-slate-600">Train {number(report.split.train.rows, 0)} · validation {number(report.split.validation.rows, 0)} · test {number(report.split.test.rows, 0)}. Nhãn train chưa mature bị loại: {number(report.split.train.purged_unmatured_labels, 0)}.</p>
    {task === 'cancellation' && <p className="mt-2 text-sm text-amber-900">Threshold đánh giá cố định 0,5. Recall còn thấp và xác suất có thể quá tự tin ở nhóm nguy cơ cao; đây là điểm yếu thực nghiệm.</p>}
  </section>;
}

function Prediction({ decision, experiment }: { decision: AcademicDecision; experiment: AcademicExperiment | null }) {
  return <div className="space-y-5" data-testid="decision-result">
    <section className={panel} aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">Kết quả inference</h2><span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-900">{decision.hypothetical ? 'Kịch bản giả định' : `Holdout thật · ${experiment?.row_id}`}</span></div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-slate-950 p-5 text-white"><p className="text-sm text-slate-300">ADR tham chiếu</p><p className="mt-2 text-3xl font-semibold" data-testid="adr-reference">{number(decision.adr_reference)} <span className="text-base">EUR/đêm</span></p><p className="mt-3 break-all text-xs text-slate-300">{decision.prediction_sources.adr}</p><p className="mt-1 text-xs text-slate-300">Baseline mùa/phòng: {number(decision.baselines.adr)} EUR</p></div>
        <div className="rounded-xl bg-teal-50 p-5 text-teal-950"><p className="text-sm">Nguy cơ hủy / no-show</p><p className="mt-2 text-3xl font-semibold" data-testid="cancellation-probability">{percent(decision.cancellation_probability)}</p><p className="mt-3 break-all text-xs">{decision.prediction_sources.cancellation}</p><p className="mt-1 text-xs">Baseline prevalence: {percent(decision.baselines.cancellation)}</p><p className="mt-2 text-xs">Calibration còn yếu ở nhóm nguy cơ cao; không dùng điểm số để tự động hủy hoặc từ chối booking.</p></div>
      </div>
      {experiment && <div className="mt-4 rounded-xl border border-slate-200 p-4" data-testid="observed-comparison">
        <p className="font-semibold">Đối chiếu nhãn quan sát</p>
        {experiment.task === 'adr' ? <p className="mt-1">ADR thực: <strong>{number(experiment.observed)} EUR</strong> · sai số tuyệt đối của lần gọi API: <strong>{number(decision.adr_reference == null ? null : Math.abs(decision.adr_reference - experiment.observed))} EUR</strong></p>
          : <p className="mt-1">Nhãn is_canceled thực: <strong>{experiment.observed}</strong> ({experiment.observed ? 'hủy hoặc no-show' : 'không hủy'}). Xác suất là điểm rủi ro của mô hình.</p>}
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{Object.entries(experiment.stored_predictions).map(([name, value]) => <div key={name}><dt className="text-slate-500">{name.replaceAll('_', ' ')}</dt><dd className="font-medium">{experiment.task === 'adr' ? `${number(value)} EUR` : percent(value)}</dd></div>)}</dl>
        <p className="mt-3 text-xs text-slate-600">{experiment.target_caveat}</p>
      </div>}
      <p className="mt-4 break-all text-xs text-slate-500">Model {decision.model_version} · run {decision.training_run_id} · {decision.feature_contract_version}</p>
      {decision.status === 'degraded' && <p className="mt-3 rounded-lg bg-amber-50 p-3 font-medium text-amber-900">Model lỗi: kết quả fallback đã được gắn nhãn baseline.</p>}
    </section>
    <section className={panel}>
      <h2 className="text-lg font-bold">Yếu tố ảnh hưởng đến dự đoán</h2>
      <p className="mt-1 text-sm text-slate-600">Thay từng nhóm thuộc tính bằng một booking tham chiếu trong train, rồi tính chênh lệch dự đoán. Các chênh lệch không cộng thành tổng và không thể hiện quan hệ nhân quả.</p>
      <div className="mt-5 grid gap-6 sm:grid-cols-2">{(['adr', 'cancellation'] as const).map(task => {
        const rows = decision.explanation[task].slice(0, 5);
        const max = Math.max(...rows.map(row => Math.abs(row.difference)), 0.001);
        return <div key={task}><h3 className="font-semibold">{task === 'adr' ? 'ADR · EUR' : 'Rủi ro · điểm phần trăm'}</h3>{rows.length === 0 && <p className="mt-2 text-sm">Giải thích chưa khả dụng cho lần gọi này.</p>}
          {rows.map(row => <div className="mt-3" key={row.feature_group}><div className="flex justify-between gap-3 text-xs"><span>{labels[row.feature_group] ?? row.feature_group}</span><strong>{row.difference >= 0 ? '+' : ''}{number(row.difference * (task === 'cancellation' ? 100 : 1))}</strong></div><div className="mt-1 h-2 rounded bg-slate-100"><div className={`h-2 rounded ${row.difference >= 0 ? 'bg-teal-700' : 'bg-amber-500'}`} style={{ width: `${Math.abs(row.difference) / max * 100}%` }} /></div></div>)}</div>;
      })}</div>
    </section>
    {decision.warnings.length > 0 && <section className="rounded-xl border border-amber-200 bg-amber-50 p-4" aria-label="Cảnh báo dữ liệu"><h2 className="font-semibold text-amber-950">Dữ liệu yếu / ngoài phạm vi</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-950">{decision.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></section>}
    <details className={panel}><summary className="cursor-pointer font-semibold">Quy tắc nghiệp vụ và giới hạn nghiên cứu</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-sm">{decision.business_rules.map(rule => <li key={rule.rule}><strong>Quy tắc ứng dụng: {rule.rule}.</strong> {rule.description}</li>)}{decision.caveats.map(caveat => <li key={caveat}>{caveat}</li>)}</ul></details>
  </div>;
}

export function AcademicLab({ mode }: { mode: 'experiment' | 'decision' }) {
  const [info, setInfo] = useState<AcademicInfo | null>(null);
  const [task, setTask] = useState<AcademicTask>('adr');
  const [order, setOrder] = useState<HoldoutOrder>('source');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<HoldoutPage | null>(null);
  const [selected, setSelected] = useState('');
  const [input, setInput] = useState<AcademicInput | null>(null);
  const [experiment, setExperiment] = useState<AcademicExperiment | null>(null);
  const [decision, setDecision] = useState<AcademicDecision | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(0);
  const action = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    action.current?.abort();
    setPending(false); setLoading(true); setError(''); setDecision(null); setExperiment(null); setPage(null); setSelected('');
    void Promise.all([getAcademicInfo(controller.signal), getAcademicHoldout(task, order, offset, controller.signal)])
      .then(async ([metadata, rows]) => {
        if (controller.signal.aborted) return;
        setInfo(metadata); setPage(rows); setSelected(rows.rows[0]?.row_id ?? '');
        if (mode === 'decision' && rows.rows[0]) {
          const sample = await runAcademicExperiment(task, rows.rows[0].row_id, controller.signal);
          if (!controller.signal.aborted) setInput(sample.input);
        }
      }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Không tải được thí nghiệm.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); action.current?.abort(); };
  }, [mode, task, order, offset, retry]);

  async function run(event: FormEvent) {
    event.preventDefault(); action.current?.abort();
    const controller = new AbortController(); action.current = controller;
    setPending(true); setError(''); setDecision(null); setExperiment(null);
    try {
      if (mode === 'experiment') {
        const result = await runAcademicExperiment(task, selected, controller.signal);
        if (!controller.signal.aborted) { setExperiment(result); setInput(result.input); setDecision(result.decision); }
      } else if (input) {
        const result = await runAcademicDecision(input, controller.signal);
        if (!controller.signal.aborted) setDecision(result);
      }
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Inference thất bại.');
    } finally { if (!controller.signal.aborted) setPending(false); }
  }

  function update<K extends keyof AcademicInput>(key: K, value: AcademicInput[K]) {
    action.current?.abort(); setPending(false); setInput(previous => previous ? { ...previous, [key]: value } : previous); setDecision(null); setExperiment(null); setError('');
  }

  return <main className="min-h-screen bg-[#f3f5f7] px-4 py-8 text-slate-900 sm:px-8">
    <div className="mx-auto max-w-7xl">
      <header className="mb-7 flex flex-wrap items-center justify-between gap-4"><div><Link href="/" className="text-xs font-bold uppercase tracking-[.2em] text-teal-800">HotelAI · Academic workspace</Link><h1 className="mt-3 text-3xl font-bold tracking-tight">{mode === 'experiment' ? 'AI Experiment' : 'Decision Lab'}</h1><p className="mt-2 text-sm text-slate-600">Giá tham chiếu và rủi ro booking từ hai mô hình học máy.</p></div>
        <nav aria-label="Không gian AI" className="flex flex-wrap gap-2 text-sm"><Link className={`rounded-lg px-4 py-2 ${mode === 'experiment' ? 'bg-slate-950 text-white' : 'border bg-white'}`} href="/ai-experiment" aria-current={mode === 'experiment' ? 'page' : undefined}>AI Experiment</Link><Link className={`rounded-lg px-4 py-2 ${mode === 'decision' ? 'bg-slate-950 text-white' : 'border bg-white'}`} href="/decision-lab" aria-current={mode === 'decision' ? 'page' : undefined}>Decision Lab</Link></nav>
      </header>
      <aside className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950"><strong>Đồ án mô phỏng · dữ liệu Portugal 2015–2017 · ADR gốc EUR.</strong> White Sand Boutique Hotel là khách sạn mô phỏng. ADR là giá tham chiếu lịch sử. CSV chụp gần ngày đến; thực nghiệm lúc tạo booking có giả định thuộc tính ổn định và chưa được kiểm chứng prospective.</aside>
      {error && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><p>{error}</p><button className="rounded border border-red-300 px-3 py-1" onClick={() => setRetry(value => value + 1)}>Thử kết nối lại</button></div>}
      {loading && <p role="status" className="mb-5 text-sm text-slate-600">Đang tải model metadata và booking test…</p>}
      <div className="grid items-start gap-6 lg:grid-cols-[350px_minmax(0,1fr)]">
        <section className={panel}>
          <h2 className="text-lg font-bold">{mode === 'experiment' ? 'Chọn booking chưa train' : 'Kịch bản giả định'}</h2>
          <p className="mt-2 text-sm text-slate-600">{mode === 'experiment' ? 'Gọi model thật qua NestJS và FastAPI, rồi đối chiếu nhãn quan sát.' : 'Sửa thông tin dự kiến khi tạo booking. Mỗi thay đổi cần chạy lại inference.'}</p>
          <form onSubmit={run} className="mt-5 space-y-4">
            {mode === 'experiment' ? <>
              <label className="block text-sm font-medium" htmlFor="target-task">Bài toán<select id="target-task" className={control} value={task} onChange={event => { setTask(event.target.value as AcademicTask); setOffset(0); }}><option value="adr">ADR tham chiếu</option><option value="cancellation">Nguy cơ hủy / no-show</option></select></label>
              <label className="block text-sm font-medium" htmlFor="sample-order">Nhóm ví dụ<select id="sample-order" className={control} value={order} onChange={event => { setOrder(event.target.value as HoldoutOrder); setOffset(0); }}><option value="source">Theo thứ tự nguồn</option><option value="smallest_error">Dự đoán gần nhãn nhất</option><option value="largest_error">Sai số lớn nhất</option></select></label>
              <label className="block text-sm font-medium" htmlFor="holdout-booking">Booking test<select id="holdout-booking" className={control} value={selected} onChange={event => { action.current?.abort(); setPending(false); setSelected(event.target.value); setDecision(null); setExperiment(null); }}>{page?.rows.map(row => <option key={row.row_id} value={row.row_id}>{row.row_id} · {row.hotel === 'Resort Hotel' ? 'Resort' : 'City'} · {row.arrival_date.slice(0, 10)}</option>)}</select></label>
              {page && <div className="flex items-center justify-between text-xs"><button type="button" disabled={offset === 0 || loading} onClick={() => setOffset(value => Math.max(0, value - 30))}>← Trước</button><span>{number(offset + 1, 0)}–{number(Math.min(offset + 30, page.total), 0)} / {number(page.total, 0)}</span><button type="button" disabled={offset + 30 >= page.total || loading} onClick={() => setOffset(value => value + 30)}>Sau →</button></div>}
            </> : input && <>
              <label className="block text-sm font-medium" htmlFor="arrival-date">Ngày đến<input id="arrival-date" className={control} type="date" required value={input.arrival_date} onChange={event => update('arrival_date', event.target.value)} /></label>
              {(['hotel', 'reserved_room_type', 'meal', 'market_segment', 'distribution_channel', 'customer_type'] as const).map(key => <label className="block text-sm font-medium" htmlFor={key} key={key}>{labels[key]}<select id={key} className={control} value={input[key]} onChange={event => update(key, event.target.value)}>{[...new Set([input[key], ...(info?.categories[key] ?? [])])].map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}
              <div className="grid grid-cols-2 gap-3">{(['lead_time', 'stay_nights', 'adults', 'children', 'babies'] as const).map(key => <label className="block text-sm font-medium" htmlFor={key} key={key}>{labels[key]}<input id={key} className={control} type="number" step="1" min={key === 'stay_nights' || key === 'adults' ? 1 : 0} max={key === 'lead_time' ? 1000 : key === 'stay_nights' ? 365 : 99} required={key !== 'children'} value={input[key] ?? ''} placeholder={key === 'children' ? 'Thiếu → impute' : undefined} onChange={event => update(key, event.target.value === '' && key === 'children' ? null : Number(event.target.value))} /></label>)}</div>
            </>}
            <button className={`${button} w-full`} type="submit" disabled={pending || loading || (mode === 'experiment' ? !selected : !input)}>{pending ? 'Đang gọi model…' : 'Chạy inference thật'}</button>
          </form>
          {experiment && <details className="mt-4 text-xs"><summary className="cursor-pointer font-semibold">Thông tin booking đầu vào</summary><dl className="mt-2 space-y-1">{Object.entries(experiment.input).map(([key, value]) => <div className="flex justify-between gap-3" key={key}><dt>{labels[key] ?? key}</dt><dd>{value ?? 'missing'}</dd></div>)}</dl></details>}
          <p className="mt-4 text-xs text-slate-500">UI → NestJS → FastAPI → pipeline đã lưu. Baseline và quy tắc ứng dụng được gắn nhãn riêng.</p>
        </section>
        <div className="min-w-0 space-y-6">{decision ? <Prediction decision={decision} experiment={experiment} /> : <section className={`${panel} py-12 text-center`}><p className="text-xl font-semibold">{pending ? 'Đang tính dự đoán…' : 'Sẵn sàng kiểm chứng AI'}</p><p className="mx-auto mt-3 max-w-md text-sm text-slate-600">Chọn booking hoặc điều chỉnh kịch bản, sau đó chạy inference để xem dự đoán và phần giải thích.</p></section>}{info && <Metrics info={info} task={task} />}</div>
      </div>
      <footer className="mt-8 text-xs text-slate-500">Nguồn: <a className="underline" href="https://doi.org/10.1016/j.dib.2018.11.126" target="_blank" rel="noreferrer">António, Almeida & Nunes — Hotel booking demand datasets</a> · Hai hotel ẩn danh tại Portugal · Không có dữ liệu quan sát của White Sand Boutique Hotel hoặc thị trường Việt Nam trong các mô hình này.</footer>
    </div>
  </main>;
}
