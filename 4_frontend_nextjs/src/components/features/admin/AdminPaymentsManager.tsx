'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  HandCoins,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
} from 'lucide-react';
import { PageContainer } from '@/components/common/PageContainer';
import { PageHeader } from '@/components/common/PageHeader';
import {
  Badge,
  Button,
  Card,
  CardContent,
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
import { getAdminPayments, refundAdminPayment } from '@/services/admin.service';
import type { AdminPaymentTransaction } from '@/types/admin.type';
import type { PaymentMethod, PaymentTransactionType } from '@/types/booking.type';
import { formatCurrency } from '@/utils/formatCurrency';

const PAGE_SIZE = 20;

const methodLabels: Record<PaymentMethod, string> = {
  Cash: 'Tiền mặt',
  BankTransfer: 'Chuyển khoản',
  CardTerminal: 'Thẻ tại quầy',
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(date);
}

function shortReference(value: string): string {
  return value.slice(0, 8).toUpperCase();
}

function newIdempotencyKey(): string {
  const value = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `ui-refund:${value}`;
}

interface AdminPaymentsManagerProps {
  initialSearch?: string;
  initialType?: PaymentTransactionType | '';
  initialMethod?: PaymentMethod | '';
}

export function AdminPaymentsManager({
  initialSearch = '',
  initialType = '',
  initialMethod = '',
}: AdminPaymentsManagerProps) {
  const { accessToken } = useAuth();
  const [items, setItems] = useState<AdminPaymentTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [draftSearch, setDraftSearch] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [transactionType, setTransactionType] = useState<PaymentTransactionType | ''>(initialType);
  const [method, setMethod] = useState<PaymentMethod | ''>(initialMethod);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refundTarget, setRefundTarget] = useState<AdminPaymentTransaction | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundNote, setRefundNote] = useState('');
  const [refundKey, setRefundKey] = useState('');
  const [refundError, setRefundError] = useState('');
  const [refunding, setRefunding] = useState(false);

  const loadPayments = useCallback(async (silent = false, signal?: AbortSignal) => {
    if (!accessToken) return;
    silent ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const page = await getAdminPayments(accessToken, {
        limit: PAGE_SIZE,
        offset,
        transaction_type: transactionType,
        method,
        search,
        signal,
      });
      setItems(page.items);
      setTotal(page.total);
      if (page.items.length === 0 && offset > 0 && page.total > 0) {
        setOffset(Math.max(0, Math.floor((page.total - 1) / PAGE_SIZE) * PAGE_SIZE));
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Không thể tải sổ giao dịch.');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [accessToken, method, offset, search, transactionType]);

  useEffect(() => {
    const controller = new AbortController();
    void loadPayments(false, controller.signal);
    return () => controller.abort();
  }, [loadPayments]);

  const pageTotals = useMemo(() => {
    const paid = items
      .filter((item) => item.transaction_type === 'Payment')
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const refunded = items
      .filter((item) => item.transaction_type === 'Refund')
      .reduce((sum, item) => sum + Number(item.amount), 0);
    return { paid, refunded, net: paid - refunded };
  }, [items]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = draftSearch.trim().slice(0, 150);
    setDraftSearch(normalized);
    setSearch(normalized);
    setOffset(0);
  }

  function openRefund(target: AdminPaymentTransaction) {
    setRefundTarget(target);
    setRefundAmount(String(target.refundable_amount));
    setRefundNote('');
    setRefundKey(newIdempotencyKey());
    setRefundError('');
  }

  function closeRefund() {
    if (refunding) return;
    setRefundTarget(null);
    setRefundError('');
  }

  function changeRefundAmount(value: string) {
    setRefundAmount(value);
    setRefundKey(newIdempotencyKey());
    setRefundError('');
  }

  function changeRefundNote(value: string) {
    setRefundNote(value.slice(0, 250));
    setRefundKey(newIdempotencyKey());
    setRefundError('');
  }

  async function submitRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !refundTarget) return;
    const amount = Number(refundAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > refundTarget.refundable_amount) {
      setRefundError('Số tiền hoàn phải lớn hơn 0 và không vượt quá số còn có thể hoàn.');
      return;
    }
    setRefunding(true);
    setRefundError('');
    try {
      const result = await refundAdminPayment(accessToken, refundTarget.payment_id, {
        amount,
        idempotency_key: refundKey,
        note: refundNote.trim() || undefined,
      });
      setNotice(
        `Đã hoàn ${formatCurrency(result.transaction.amount)} cho booking #${shortReference(refundTarget.booking_id)}.`,
      );
      setRefundTarget(null);
      await loadPayments(true);
    } catch (caught) {
      setRefundError(caught instanceof Error ? caught.message : 'Không thể ghi nhận hoàn tiền.');
    } finally {
      setRefunding(false);
    }
  }

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstRow = total === 0 ? 0 : offset + 1;
  const lastRow = Math.min(offset + items.length, total);

  return (
    <PageContainer>
      <PageHeader
        title="Sổ thanh toán"
        description="Theo dõi ledger chỉ-ghi, đối soát các khoản thu và hoàn tiền theo từng giao dịch gốc."
        actions={
          <Button variant="outline" onClick={() => void loadPayments(true)} disabled={loading || refreshing}>
            <RefreshCw className={refreshing ? 'animate-spin' : ''} /> Làm mới
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="flex items-center gap-3 pt-5"><ArrowUpRight className="size-5 text-success" /><div><p className="text-xs text-muted-foreground">Thu trên trang</p><p className="text-lg font-semibold tabular-nums">{formatCurrency(pageTotals.paid)}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 pt-5"><ArrowDownLeft className="size-5 text-danger" /><div><p className="text-xs text-muted-foreground">Hoàn trên trang</p><p className="text-lg font-semibold tabular-nums">{formatCurrency(pageTotals.refunded)}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 pt-5"><HandCoins className="size-5 text-primary" /><div><p className="text-xs text-muted-foreground">Ròng trên trang</p><p className="text-lg font-semibold tabular-nums">{formatCurrency(pageTotals.net)}</p></div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="pt-5">
          <form className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_180px_190px_auto]" onSubmit={submitSearch}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                type="search"
                value={draftSearch}
                maxLength={150}
                placeholder="Tên, email, mã booking hoặc tham chiếu"
                onChange={(event) => setDraftSearch(event.target.value)}
              />
            </div>
            <Select value={transactionType} onChange={(event) => { setTransactionType(event.target.value as PaymentTransactionType | ''); setOffset(0); }}>
              <option value="">Mọi loại giao dịch</option><option value="Payment">Thanh toán</option><option value="Refund">Hoàn tiền</option>
            </Select>
            <Select value={method} onChange={(event) => { setMethod(event.target.value as PaymentMethod | ''); setOffset(0); }}>
              <option value="">Mọi phương thức</option><option value="Cash">Tiền mặt</option><option value="BankTransfer">Chuyển khoản</option><option value="CardTerminal">Thẻ tại quầy</option>
            </Select>
            <Button type="submit"><Search /> Tìm</Button>
          </form>

          {notice && <p className="mt-4 rounded-md bg-success-muted px-3 py-2 text-sm text-success" role="status">{notice}</p>}
          {error && <p className="mt-4 flex items-center gap-2 rounded-md bg-danger-muted px-3 py-2 text-sm text-danger" role="alert"><AlertCircle className="size-4" />{error}</p>}

          {loading ? (
            <div className="mt-5 space-y-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-16 w-full" />)}</div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground"><HandCoins className="mx-auto mb-3 size-9" /><p>Chưa có giao dịch phù hợp.</p></div>
          ) : (
            <div className="mt-5 overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Thời gian / loại</TableHead><TableHead>Booking / khách</TableHead><TableHead>Phương thức</TableHead><TableHead className="text-right">Số tiền</TableHead><TableHead>Người ghi nhận</TableHead><TableHead className="text-right">Đối soát</TableHead></TableRow></TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const canRefund = item.transaction_type === 'Payment'
                      && ['Canceled', 'Expired', 'NoShow'].includes(item.booking_status)
                      && Number(item.refundable_amount) > 0;
                    return (
                      <TableRow key={item.payment_id}>
                        <TableCell><Badge variant={item.transaction_type === 'Payment' ? 'success' : 'warning'}>{item.transaction_type === 'Payment' ? 'Thanh toán' : 'Hoàn tiền'}</Badge><p className="mt-1 text-xs text-muted-foreground">{formatDateTime(item.created_at)}</p></TableCell>
                        <TableCell><p className="font-mono text-xs text-muted-foreground" title={item.booking_id}>#{shortReference(item.booking_id)}</p><p className="mt-1 font-medium">{item.customer_name}</p><p className="text-xs text-muted-foreground">{item.customer_email}</p></TableCell>
                        <TableCell><p>{methodLabels[item.method]}</p><p className="mt-1 max-w-48 truncate text-xs text-muted-foreground" title={item.external_reference ?? item.note ?? ''}>{item.external_reference || item.note || 'Không có tham chiếu'}</p></TableCell>
                        <TableCell className={`text-right font-semibold tabular-nums ${item.transaction_type === 'Refund' ? 'text-danger' : 'text-success'}`}>{item.transaction_type === 'Refund' ? '−' : '+'}{formatCurrency(Number(item.amount))}</TableCell>
                        <TableCell><p>{item.created_by_name}</p><p className="mt-1 text-xs text-muted-foreground">Thành công</p></TableCell>
                        <TableCell className="text-right">{canRefund ? <Button size="sm" variant="outline" onClick={() => openRefund(item)}><RotateCcw /> Hoàn tiền</Button> : item.transaction_type === 'Payment' ? <span className="text-xs text-muted-foreground">Còn hoàn {formatCurrency(Number(item.refundable_amount))}</span> : <span className="text-xs text-muted-foreground">Theo giao dịch gốc</span>}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Hiển thị {firstRow}–{lastRow} trong {total} giao dịch</span>
            <div className="flex items-center gap-2"><Button size="icon" variant="outline" aria-label="Trang trước" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><ChevronLeft /></Button><span>Trang {currentPage}/{pageCount}</span><Button size="icon" variant="outline" aria-label="Trang sau" disabled={offset + PAGE_SIZE >= total || loading} onClick={() => setOffset(offset + PAGE_SIZE)}><ChevronRight /></Button></div>
          </div>
        </CardContent>
      </Card>

      {refundTarget && (
        <Dialog
          open
          onClose={closeRefund}
          title={`Hoàn tiền booking #${shortReference(refundTarget.booking_id)}`}
          description={`Giao dịch gốc ${formatCurrency(Number(refundTarget.amount))}; còn có thể hoàn ${formatCurrency(Number(refundTarget.refundable_amount))}.`}
        >
          <form className="grid gap-4" onSubmit={submitRefund}>
            {refundError && <p className="rounded-md bg-danger-muted px-3 py-2 text-danger" role="alert">{refundError}</p>}
            <label className="grid gap-1.5 font-medium">Số tiền hoàn
              <Input type="number" min="0.01" step="0.01" max={refundTarget.refundable_amount} value={refundAmount} onChange={(event) => changeRefundAmount(event.target.value)} disabled={refunding} required />
            </label>
            <label className="grid gap-1.5 font-medium">Ghi chú
              <Input value={refundNote} maxLength={250} onChange={(event) => changeRefundNote(event.target.value)} disabled={refunding} placeholder="Lý do hoàn tiền" />
            </label>
            <p className="text-xs leading-5 text-muted-foreground">Mỗi lần thử lại chính xác dùng cùng một khóa chống ghi trùng. Nếu sửa số tiền hoặc ghi chú, hệ thống tự tạo yêu cầu mới.</p>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={closeRefund} disabled={refunding}>Đóng</Button><Button type="submit" disabled={refunding}>{refunding ? <LoaderCircle className="animate-spin" /> : <RotateCcw />} Xác nhận hoàn</Button></div>
          </form>
        </Dialog>
      )}
    </PageContainer>
  );
}
