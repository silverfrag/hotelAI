'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Banknote,
  CalendarCheck2,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  LoaderCircle,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
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
import {
  AdminApiError,
  authorizeAdminBookingCredit,
  cancelAdminBooking,
  checkInAdminBooking,
  checkOutAdminBooking,
  confirmAdminBooking,
  expireAdminPendingBookings,
  getAdminBookingPayment,
  getAdminBookingPolicy,
  getAdminBookings,
  getAdminWorkflowReadiness,
  markAdminBookingNoShow,
  recordAdminPayment,
  updateAdminBookingPolicy,
} from '@/services/admin.service';
import type {
  AdminBooking,
  AdminBookingPolicy,
  AdminBookingStatus,
  AdminWorkflowReadiness,
} from '@/types/admin.type';
import type { BookingPaymentSummary, PaymentMethod, PaymentStatus } from '@/types/booking.type';
import { formatCurrency } from '@/utils/formatCurrency';

const PAGE_SIZE = 20;

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

const paymentStatusLabel: Record<PaymentStatus, string> = {
  Unpaid: 'Chưa thanh toán',
  PartiallyPaid: 'Đã thu một phần',
  Paid: 'Đã thanh toán',
  RefundPending: 'Chờ hoàn tiền',
  PartiallyRefunded: 'Đã hoàn một phần',
  Refunded: 'Đã hoàn tiền',
};

const paymentStatusVariant: Record<PaymentStatus, 'neutral' | 'warning' | 'success' | 'info'> = {
  Unpaid: 'neutral',
  PartiallyPaid: 'warning',
  Paid: 'success',
  RefundPending: 'warning',
  PartiallyRefunded: 'warning',
  Refunded: 'info',
};

function newPaymentKey(): string {
  const value = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `ui-payment:${value}`;
}

type ActionTarget = {
  kind: 'cancel' | 'check-in' | 'check-out' | 'no-show' | 'confirm';
  booking: AdminBooking;
};

interface AdminBookingsManagerProps {
  initialSearch?: string;
  initialStatus?: AdminBookingStatus | '';
}

function asNumber(value: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-');
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

function shortReference(bookingId: string): string {
  return bookingId.length > 12 ? bookingId.slice(0, 8).toUpperCase() : bookingId.toUpperCase();
}

function StatusBadge({ status }: { status: AdminBookingStatus }) {
  return <Badge variant={statusVariant[status]} dot>{statusLabel[status]}</Badge>;
}

function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge variant={paymentStatusVariant[status]}>{paymentStatusLabel[status]}</Badge>;
}

function Eligibility({ booking }: { booking: AdminBooking }) {
  if (booking.can_cancel) {
    return <span className="text-xs text-muted-foreground">Booking hiện có thể hủy</span>;
  }
  if (booking.can_check_in) {
    return <span className="text-xs text-muted-foreground">Đã sẵn sàng nhận phòng</span>;
  }
  if (booking.can_check_out) {
    return <span className="text-xs text-muted-foreground">Khách đang lưu trú</span>;
  }
  if (booking.can_mark_no_show) {
    return <span className="text-xs text-muted-foreground">Đã qua ngày nhận phòng, có thể ghi nhận không đến</span>;
  }
  if (booking.status === 'Pending') {
    return <span className="text-xs text-muted-foreground">Kiểm tra thời hạn giữ phòng và tiền cọc</span>;
  }
  if (booking.status === 'CheckedIn') {
    return <span className="text-xs text-muted-foreground">Cần đủ thanh toán hoặc hạn mức công nợ được duyệt để trả phòng</span>;
  }
  if (booking.status === 'Confirmed') {
    return <span className="text-xs text-muted-foreground">Kiểm tra ngày lưu trú, tiền cọc và tình trạng sẵn sàng của phòng</span>;
  }
  return <span className="text-xs text-muted-foreground">Không còn thao tác vòng đời</span>;
}

function BookingActions({
  booking,
  pending,
  onAction,
  onPayment,
  onRefundLookup,
  onAuthorizeCredit,
}: {
  booking: AdminBooking;
  pending: boolean;
  onAction: (target: ActionTarget) => void;
  onPayment: (booking: AdminBooking) => void;
  onRefundLookup: (booking: AdminBooking) => void;
  onAuthorizeCredit?: (booking: AdminBooking) => void;
}) {
  const canConfirmPending = booking.status === 'Pending'
    && booking.can_cancel
    && asNumber(booking.net_paid) >= asNumber(booking.deposit_required);
  const canAuthorizeCredit = Boolean(onAuthorizeCredit)
    && booking.status === 'CheckedIn'
    && booking.checkout_payment_required
    && !booking.can_check_out
    && asNumber(booking.balance_due) > 0
    && asNumber(booking.credit_authorized) === 0;
  const hasLifecycleAction = booking.can_cancel
    || booking.can_check_in
    || booking.can_check_out
    || booking.can_mark_no_show
    || canConfirmPending
    || canAuthorizeCredit;
  // List eligibility is a hint; the payment dialog checks the ledger's can_record_payment flag.
  const canRecordPayment = !['Canceled', 'Expired', 'NoShow'].includes(booking.status)
    && (booking.status !== 'Pending' || booking.can_cancel)
    && Number(booking.balance_due) > 0;
  const needsRefund = Number(booking.refund_due) > 0;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {!hasLifecycleAction && !canRecordPayment && !needsRefund && <Eligibility booking={booking} />}
      {booking.can_cancel && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => onAction({ kind: 'cancel', booking })}
          aria-label={`Hủy booking của ${booking.customer_name}`}
        >
          <XCircle /> Hủy
        </Button>
      )}
      {canConfirmPending && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => onAction({ kind: 'confirm', booking })}
          aria-label={`Xác nhận booking của ${booking.customer_name}`}
        >
          <CheckCircle2 /> Xác nhận
        </Button>
      )}
      {booking.can_mark_no_show && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => onAction({ kind: 'no-show', booking })}
          aria-label={`Ghi nhận khách không đến của ${booking.customer_name}`}
        >
          <CheckCircle2 /> Không đến
        </Button>
      )}
      {booking.can_check_in && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => onAction({ kind: 'check-in', booking })}
          aria-label={`Nhận phòng cho ${booking.customer_name}`}
        >
          <LogIn /> Nhận phòng
        </Button>
      )}
      {canAuthorizeCredit && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => onAuthorizeCredit?.(booking)}
          aria-label={`Duyệt công nợ cho ${booking.customer_name}`}
        >
          <ShieldCheck /> Duyệt công nợ
        </Button>
      )}
      {booking.can_check_out && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => onAction({ kind: 'check-out', booking })}
          aria-label={`Trả phòng cho ${booking.customer_name}`}
        >
          <LogOut /> Trả phòng
        </Button>
      )}
      {canRecordPayment && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => onPayment(booking)}
          aria-label={`Ghi nhận thanh toán của ${booking.customer_name}`}
        >
          <Banknote /> Thu tiền
        </Button>
      )}
      {needsRefund && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => onRefundLookup(booking)}
          aria-label={`Mở giao dịch cần hoàn của ${booking.customer_name}`}
        >
          Hoàn tiền
        </Button>
      )}
    </div>
  );
}

export function AdminBookingsManager({
  initialSearch = '',
  initialStatus = '',
}: AdminBookingsManagerProps) {
  const { accessToken } = useAuth();
  const router = useRouter();
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState(initialSearch.trim());
  const [draftSearch, setDraftSearch] = useState(initialSearch.trim());
  const [status, setStatus] = useState<AdminBookingStatus | ''>(initialStatus);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);
  const [pendingBookingId, setPendingBookingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [actionKey, setActionKey] = useState('');
  const [actionStale, setActionStale] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<AdminBooking | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentKey, setPaymentKey] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentSummary, setPaymentSummary] = useState<BookingPaymentSummary | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const paymentRequest = useRef(0);

  // Booking Policy & Pending Expiry Readiness
  const [policy, setPolicy] = useState<AdminBookingPolicy | null>(null);
  const [readiness, setReadiness] = useState<AdminWorkflowReadiness | null>(null);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policyExpanded, setPolicyExpanded] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [expiringPending, setExpiringPending] = useState(false);
  const [policyError, setPolicyError] = useState('');
  const [policyNotice, setPolicyNotice] = useState('');
  const [draftDepositPercent, setDraftDepositPercent] = useState('0');
  const [draftPendingTtlMinutes, setDraftPendingTtlMinutes] = useState('30');
  const [draftRequireCheckoutPayment, setDraftRequireCheckoutPayment] = useState(true);
  const [policyReason, setPolicyReason] = useState('');

  // Credit Authorization Dialog
  const [creditTarget, setCreditTarget] = useState<AdminBooking | null>(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [creditKey, setCreditKey] = useState('');
  const [creditError, setCreditError] = useState('');
  const [savingCredit, setSavingCredit] = useState(false);

  const updateUrl = useCallback((nextSearch: string, nextStatus: AdminBookingStatus | '') => {
    const params = new URLSearchParams();
    if (nextSearch) params.set('search', nextSearch);
    if (nextStatus) params.set('status', nextStatus);
    const query = params.toString();
    router.replace(query ? `/admin/bookings?${query}` : '/admin/bookings', { scroll: false });
  }, [router]);

  useEffect(() => {
    const normalizedSearch = initialSearch.trim();
    setDraftSearch(normalizedSearch);
    setSearch(normalizedSearch);
    setStatus(initialStatus);
    setOffset(0);
  }, [initialSearch, initialStatus]);

  const loadBookings = useCallback(async (silent = false, signal?: AbortSignal) => {
    if (!accessToken) return;
    silent ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const page = await getAdminBookings(accessToken, {
        limit: PAGE_SIZE,
        offset,
        status,
        search,
        signal,
      });
      setBookings(page.items);
      setTotal(page.total);
      if (page.items.length === 0 && offset > 0 && page.total > 0) {
        setOffset(Math.max(0, Math.floor((page.total - 1) / PAGE_SIZE) * PAGE_SIZE));
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Không thể tải danh sách booking.');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [accessToken, offset, search, status]);

  const loadPolicyAndReadiness = useCallback(async () => {
    if (!accessToken) return;
    setPolicyLoading(true);
    try {
      const [nextPolicy, nextReadiness] = await Promise.all([
        getAdminBookingPolicy(accessToken),
        getAdminWorkflowReadiness(accessToken),
      ]);
      setPolicy(nextPolicy);
      setReadiness(nextReadiness);
      setDraftDepositPercent(String(nextPolicy.deposit_percent));
      setDraftPendingTtlMinutes(String(nextPolicy.pending_ttl_minutes));
      setDraftRequireCheckoutPayment(nextPolicy.require_full_payment_at_checkout);
    } catch (caught) {
      setPolicyError(caught instanceof Error ? caught.message : 'Không thể tải chính sách giữ phòng.');
    } finally {
      setPolicyLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    const controller = new AbortController();
    void loadBookings(false, controller.signal);
    void loadPolicyAndReadiness();
    return () => controller.abort();
  }, [loadBookings, loadPolicyAndReadiness]);

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstRow = total === 0 ? 0 : offset + 1;
  const lastRow = Math.min(offset + bookings.length, total);

  const filterDescription = useMemo(() => {
    const parts: string[] = [];
    if (status) parts.push(`trạng thái “${statusLabel[status]}”`);
    if (search) parts.push(`từ khóa “${search}”`);
    return parts.length ? `Kết quả theo ${parts.join(' và ')}` : 'Tất cả booking trong hệ thống';
  }, [search, status]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = draftSearch.trim().slice(0, 100);
    setDraftSearch(normalized);
    setSearch(normalized);
    setOffset(0);
    updateUrl(normalized, status);
  }

  function changeStatus(nextStatus: AdminBookingStatus | '') {
    setStatus(nextStatus);
    setOffset(0);
    updateUrl(search, nextStatus);
  }

  function clearFilters() {
    setDraftSearch('');
    setSearch('');
    setStatus('');
    setOffset(0);
    updateUrl('', '');
  }

  function openAction(target: ActionTarget) {
    setActionTarget(target);
    setActionReason('');
    const keyPrefix = target.kind === 'confirm' ? 'ui-confirm:' : 'ui-no-show:';
    setActionKey(newPaymentKey().replace('ui-payment:', keyPrefix));
    setActionStale(false);
    setActionError('');
  }

  async function confirmAction() {
    if (!accessToken || !actionTarget) return;
    const { booking, kind } = actionTarget;
    if (actionStale) return;
    if (kind === 'no-show' && (actionReason.trim().length < 10 || actionReason.trim().length > 500)) {
      setActionError('Nhập lý do từ 10 đến 500 ký tự để ghi nhận khách không đến.');
      return;
    }
    if (kind === 'confirm' && (actionReason.trim().length < 10 || actionReason.trim().length > 500)) {
      setActionError('Nhập lý do từ 10 đến 500 ký tự để xác nhận booking.');
      return;
    }
    setPendingBookingId(booking.booking_id);
    setActionError('');
    setNotice('');
    try {
      switch (kind) {
        case 'cancel':
          await cancelAdminBooking(accessToken, booking.booking_id);
          setNotice(`Đã hủy booking ${shortReference(booking.booking_id)} của ${booking.customer_name}.`);
          break;
        case 'confirm':
          await confirmAdminBooking(accessToken, booking.booking_id, {
            expected_version: booking.lifecycle_version,
            reason: actionReason.trim(),
          }, actionKey);
          setNotice(`Đã xác nhận booking ${shortReference(booking.booking_id)} cho ${booking.customer_name}.`);
          break;
        case 'check-in':
          await checkInAdminBooking(accessToken, booking.booking_id);
          setNotice(`Đã nhận phòng ${booking.room_number_snapshot} cho ${booking.customer_name}.`);
          break;
        case 'check-out':
          await checkOutAdminBooking(accessToken, booking.booking_id);
          setNotice(`Đã trả phòng ${booking.room_number_snapshot} cho ${booking.customer_name}.`);
          break;
        case 'no-show':
          await markAdminBookingNoShow(accessToken, booking.booking_id, {
            expected_version: booking.lifecycle_version,
            reason: actionReason.trim(),
          }, actionKey);
          setNotice(`Đã ghi nhận khách không đến cho booking ${shortReference(booking.booking_id)} của ${booking.customer_name}.`);
          break;
      }
      setActionTarget(null);
      await Promise.all([loadBookings(true), loadPolicyAndReadiness()]);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Không thể cập nhật booking.');
      if (caught instanceof AdminApiError && caught.status === 409) {
        setActionStale(true);
        setActionError(`${caught.message} Đóng hộp thoại và kiểm tra booking đã làm mới trước khi thử lại.`);
        await Promise.all([loadBookings(true), loadPolicyAndReadiness()]);
      }
    } finally {
      setPendingBookingId(null);
    }
  }

  async function handleSavePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !policy) return;
    setPolicyError('');
    setPolicyNotice('');
    const depositVal = Number(draftDepositPercent);
    const ttlVal = Number(draftPendingTtlMinutes);
    if (!Number.isFinite(depositVal) || depositVal < 0 || depositVal > 100) {
      setPolicyError('Tỷ lệ đặt cọc phải trong khoảng 0 đến 100%.');
      return;
    }
    if (!Number.isInteger(ttlVal) || ttlVal < 1 || ttlVal > 1440) {
      setPolicyError('Thời gian giữ phòng Pending phải là số nguyên từ 1 đến 1440 phút.');
      return;
    }
    if (policyReason.trim().length < 10 || policyReason.trim().length > 500) {
      setPolicyError('Vui lòng nhập lý do cập nhật chính sách từ 10 đến 500 ký tự.');
      return;
    }
    const depositChanged = Math.round(depositVal * 100) !== Math.round(policy.deposit_percent * 100);
    const ttlChanged = ttlVal !== policy.pending_ttl_minutes;
    const checkoutChanged = draftRequireCheckoutPayment !== policy.require_full_payment_at_checkout;
    if (!depositChanged && !ttlChanged && !checkoutChanged) {
      setPolicyError('Chưa có thay đổi nào so với chính sách hiện tại.');
      return;
    }
    setSavingPolicy(true);
    try {
      const updated = await updateAdminBookingPolicy(accessToken, {
        expected_version: policy.version,
        reason: policyReason.trim(),
        ...(depositChanged ? { deposit_percent: Math.round(depositVal * 100) / 100 } : {}),
        ...(ttlChanged ? { pending_ttl_minutes: ttlVal } : {}),
        ...(checkoutChanged ? { require_full_payment_at_checkout: draftRequireCheckoutPayment } : {}),
      });
      setPolicy(updated);
      setPolicyReason('');
      setPolicyExpanded(false);
      setPolicyNotice(`Đã cập nhật chính sách giữ phòng lên v${updated.version} (Cọc ${updated.deposit_percent}%, TTL ${updated.pending_ttl_minutes} phút).`);
      await loadPolicyAndReadiness();
    } catch (caught) {
      setPolicyError(caught instanceof Error ? caught.message : 'Không thể cập nhật chính sách booking.');
      if (caught instanceof AdminApiError && caught.status === 409) {
        await loadPolicyAndReadiness();
      }
    } finally {
      setSavingPolicy(false);
    }
  }

  async function handleExpirePending() {
    if (!accessToken) return;
    setExpiringPending(true);
    setPolicyError('');
    setPolicyNotice('');
    try {
      const result = await expireAdminPendingBookings(accessToken, 100);
      setPolicyNotice(
        result.expired_count > 0
          ? `Đã quét và chuyển ${result.expired_count} booking Pending quá hạn sang Expired (trả lại phòng trống).`
          : 'Không có booking Pending quá hạn nào cần giải phóng.',
      );
      await Promise.all([loadPolicyAndReadiness(), loadBookings(true)]);
    } catch (caught) {
      setPolicyError(caught instanceof Error ? caught.message : 'Không thể chạy quét booking Pending hết hạn.');
    } finally {
      setExpiringPending(false);
    }
  }

  function openCreditDialog(booking: AdminBooking) {
    setCreditTarget(booking);
    setCreditAmount(String(asNumber(booking.balance_due)));
    setCreditReason('');
    setCreditKey(newPaymentKey().replace('ui-payment:', 'ui-credit:'));
    setCreditError('');
  }

  async function submitCreditAuthorization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !creditTarget) return;
    const amount = Number(creditAmount);
    if (!Number.isFinite(amount) || amount < 0.01 || amount > asNumber(creditTarget.balance_due)) {
      setCreditError('Hạn mức công nợ phải từ 0.01 đến tối đa số dư còn thiếu.');
      return;
    }
    if (creditReason.trim().length < 10 || creditReason.trim().length > 500) {
      setCreditError('Nhập lý do duyệt công nợ từ 10 đến 500 ký tự.');
      return;
    }
    setSavingCredit(true);
    setCreditError('');
    try {
      await authorizeAdminBookingCredit(
        accessToken,
        creditTarget.booking_id,
        {
          expected_version: creditTarget.lifecycle_version,
          reason: creditReason.trim(),
          authorized_amount: Math.round(amount * 100) / 100,
        },
        creditKey,
      );
      setNotice(
        `Đã phê duyệt công nợ ${formatCurrency(amount)} cho booking #${shortReference(creditTarget.booking_id)} (${creditTarget.customer_name}). Có thể tiến hành trả phòng.`,
      );
      setCreditTarget(null);
      await loadBookings(true);
    } catch (caught) {
      setCreditError(caught instanceof Error ? caught.message : 'Không thể phê duyệt công nợ.');
      if (caught instanceof AdminApiError && caught.status === 409) {
        await loadBookings(true);
      }
    } finally {
      setSavingCredit(false);
    }
  }

  async function openPayment(booking: AdminBooking) {
    if (!accessToken) return;
    const request = ++paymentRequest.current;
    setPaymentTarget(booking);
    setPaymentSummary(null);
    setPaymentLoading(true);
    setPaymentAmount('');
    setPaymentMethod('Cash');
    setPaymentReference('');
    setPaymentNote('');
    setPaymentKey(newPaymentKey());
    setPaymentError('');
    try {
      const summary = await getAdminBookingPayment(accessToken, booking.booking_id);
      if (request !== paymentRequest.current) return;
      setPaymentSummary(summary);
      setPaymentAmount(String(summary.booking_status === 'Pending' && summary.deposit_due > 0 ? summary.deposit_due : summary.balance_due));
      if (!summary.can_record_payment) setPaymentError('Booking hiện không thể nhận thêm thanh toán. Kiểm tra trạng thái hoặc thời hạn giữ phòng.');
    } catch (caught) {
      if (request === paymentRequest.current) setPaymentError(caught instanceof Error ? caught.message : 'Không thể kiểm tra trạng thái thanh toán.');
    } finally {
      if (request === paymentRequest.current) setPaymentLoading(false);
    }
  }

  function closePayment() {
    if (savingPayment) return;
    paymentRequest.current += 1;
    setPaymentTarget(null);
    setPaymentSummary(null);
    setPaymentLoading(false);
    setPaymentError('');
  }

  function renewPaymentRequest() {
    setPaymentKey(newPaymentKey());
    setPaymentError('');
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !paymentTarget || !paymentSummary?.can_record_payment || paymentLoading) return;
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > Number(paymentSummary.balance_due)) {
      setPaymentError('Số tiền phải lớn hơn 0 và không vượt quá số dư cần thanh toán.');
      return;
    }
    setSavingPayment(true);
    setPaymentError('');
    try {
      const result = await recordAdminPayment(accessToken, paymentTarget.booking_id, {
        amount,
        method: paymentMethod,
        idempotency_key: paymentKey,
        external_reference: paymentReference.trim() || undefined,
        note: paymentNote.trim() || undefined,
      });
      setNotice(
        `Đã ghi nhận ${formatCurrency(result.transaction.amount)} cho booking ${shortReference(paymentTarget.booking_id)}. Trạng thái: ${statusLabel[result.summary.booking_status]}.`,
      );
      setPaymentTarget(null);
      await loadBookings(true);
    } catch (caught) {
      setPaymentError(caught instanceof Error ? caught.message : 'Không thể ghi nhận thanh toán.');
      if (caught instanceof AdminApiError && caught.status === 409) {
        setPaymentSummary(null);
        await loadBookings(true);
      }
    } finally {
      setSavingPayment(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Quản lý booking"
        description="Tìm kiếm, theo dõi và cập nhật vòng đời booking trên toàn khách sạn."
        actions={
          <Button variant="outline" onClick={() => { void loadBookings(true); void loadPolicyAndReadiness(); }} disabled={loading || refreshing}>
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
            Làm mới
          </Button>
        }
      />

      {error && (
        <div className="mb-5 flex flex-col gap-3 rounded-lg border border-danger/20 bg-danger-muted p-4 text-sm text-danger sm:flex-row sm:items-center" role="alert">
          <span className="flex min-w-0 items-start gap-2"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</span>
          <Button className="sm:ml-auto" variant="outline" size="sm" onClick={() => void loadBookings()}>
            Thử lại
          </Button>
        </div>
      )}
      {notice && (
        <div className="mb-5 rounded-lg border border-success/20 bg-success-muted px-4 py-3 text-sm text-success" role="status">
          {notice}
        </div>
      )}

      {/* Booking Policy & Pending Hold Expiry Readiness Card */}
      <Card className="mb-6">
        <CardContent className="pt-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <SlidersHorizontal className="size-4 text-primary" aria-hidden="true" />
                <h2 className="text-sm font-semibold">Chính sách giữ phòng &amp; Quét hết hạn</h2>
                {policy && (
                  <Badge variant="outline">Phiên bản v{policy.version}</Badge>
                )}
                {readiness && (
                  <Badge variant={readiness.expiry_worker === 'running' ? 'success' : readiness.expiry_worker === 'error' ? 'danger' : 'warning'}>
                    Worker: {readiness.expiry_worker}
                  </Badge>
                )}
                {readiness && readiness.expired_backlog > 0 && (
                  <Badge variant="danger">Quá hạn chờ quét: {readiness.expired_backlog}</Badge>
                )}
              </div>
              {policyLoading && !policy ? (
                <p className="text-xs text-muted-foreground">Đang tải cấu hình giữ phòng &amp; trạng thái worker…</p>
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    Đặt cọc bắt buộc: <strong className="text-foreground">{policy?.deposit_percent ?? 0}%</strong>
                    {(policy?.deposit_percent ?? 0) === 0 ? ' (xác nhận ngay)' : ' (vào Pending)'}
                  </span>
                  <span>
                    Giữ chỗ Pending: <strong className="text-foreground">{policy?.pending_ttl_minutes ?? 30} phút</strong>
                  </span>
                  <span>
                    Trả phòng phải đủ tiền/công nợ: <strong className="text-foreground">{policy?.require_full_payment_at_checkout ? 'Có' : 'Không'}</strong>
                  </span>
                  {readiness && (
                    <span>
                      Đang Pending: <strong className="text-foreground">{readiness.pending_count}</strong>
                      {readiness.last_expiry_run_at ? ` · Quét gần nhất ${formatDateTime(readiness.last_expiry_run_at)}` : ''}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleExpirePending()}
                disabled={expiringPending || policyLoading}
              >
                {expiringPending ? <LoaderCircle className="animate-spin" /> : <Clock />}
                Quét &amp; hủy Pending hết hạn ngay
              </Button>
              <Button
                type="button"
                variant={policyExpanded ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => {
                  setPolicyExpanded((v) => !v);
                  setPolicyError('');
                }}
                disabled={!policy}
              >
                {policyExpanded ? <ChevronUp /> : <ChevronDown />}
                {policyExpanded ? 'Thu gọn' : 'Chỉnh chính sách'}
              </Button>
            </div>
          </div>

          {policyError && (
            <p className="mt-3 rounded-md bg-danger-muted px-3 py-2 text-xs text-danger" role="alert">
              {policyError}
            </p>
          )}
          {policyNotice && (
            <p className="mt-3 rounded-md bg-success-muted px-3 py-2 text-xs text-success" role="status">
              {policyNotice}
            </p>
          )}

          {policyExpanded && policy && (
            <form onSubmit={(event) => void handleSavePolicy(event)} className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="grid gap-1 text-xs font-medium">
                Tỷ lệ đặt cọc (%)
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={draftDepositPercent}
                  onChange={(event) => setDraftDepositPercent(event.target.value)}
                  disabled={savingPolicy}
                  required
                />
              </label>
              <label className="grid gap-1 text-xs font-medium">
                Thời gian giữ phòng Pending (phút)
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  step={1}
                  value={draftPendingTtlMinutes}
                  onChange={(event) => setDraftPendingTtlMinutes(event.target.value)}
                  disabled={savingPolicy}
                  required
                />
              </label>
              <label className="grid gap-1 text-xs font-medium sm:col-span-2">
                Lý do thay đổi chính sách (10–500 ký tự)
                <Input
                  value={policyReason}
                  minLength={10}
                  maxLength={500}
                  placeholder="Ví dụ: Áp dụng cọc 30% giữ chỗ dịp cuối tuần cao điểm"
                  onChange={(event) => setPolicyReason(event.target.value)}
                  disabled={savingPolicy}
                  required
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2 lg:col-span-4">
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={draftRequireCheckoutPayment}
                    onChange={(event) => setDraftRequireCheckoutPayment(event.target.checked)}
                    disabled={savingPolicy}
                  />
                  <span>Bắt buộc thanh toán đủ hoặc phê duyệt công nợ trước khi trả phòng (check-out)</span>
                </label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={savingPolicy}
                    onClick={() => {
                      setDraftDepositPercent(String(policy.deposit_percent));
                      setDraftPendingTtlMinutes(String(policy.pending_ttl_minutes));
                      setDraftRequireCheckoutPayment(policy.require_full_payment_at_checkout);
                      setPolicyReason('');
                      setPolicyExpanded(false);
                      setPolicyError('');
                    }}
                  >
                    Hủy
                  </Button>
                  <Button type="submit" size="sm" disabled={savingPolicy || policyReason.trim().length < 10}>
                    {savingPolicy && <LoaderCircle className="animate-spin" />}
                    Lưu chính sách (v{policy.version + 1})
                  </Button>
                </div>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <form className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-end" onSubmit={submitSearch}>
              <label className="grid min-w-0 flex-1 gap-1.5 text-sm font-medium" htmlFor="admin-booking-search">
                Tìm booking
                <span className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="admin-booking-search"
                    type="search"
                    value={draftSearch}
                    onChange={(event) => setDraftSearch(event.target.value)}
                    placeholder="Tên, email, số phòng hoặc mã booking"
                    maxLength={100}
                    className="pl-9"
                  />
                </span>
              </label>
              <Button type="submit" variant="secondary"><Search /> Tìm kiếm</Button>
            </form>
            <label className="grid gap-1.5 text-sm font-medium lg:w-52" htmlFor="admin-booking-status">
              Trạng thái
              <Select
                id="admin-booking-status"
                value={status}
                onChange={(event) => changeStatus(event.target.value as AdminBookingStatus | '')}
              >
                <option value="">Tất cả trạng thái</option>
                <option value="Pending">Chờ đặt cọc</option>
                <option value="Confirmed">Đã xác nhận</option>
                <option value="CheckedIn">Đang lưu trú</option>
                <option value="Completed">Đã hoàn tất</option>
                <option value="Canceled">Đã hủy</option>
                <option value="Expired">Hết hạn giữ phòng</option>
                <option value="NoShow">Không đến nhận phòng</option>
              </Select>
            </label>
            {(search || status) && (
              <Button variant="ghost" onClick={clearFilters}>Xóa bộ lọc</Button>
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">{filterDescription}</p>
        </CardContent>
      </Card>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold">Danh sách booking</h2>
              <p className="mt-1 text-sm text-muted-foreground">{loading ? 'Đang tải…' : `${total} booking phù hợp`}</p>
            </div>
            {!loading && <Badge variant="outline">Trang {currentPage}/{pageCount}</Badge>}
          </div>
        </div>

        {loading ? (
          <div className="grid gap-3 p-5" role="status" aria-label="Đang tải danh sách booking">
            <span className="sr-only">Đang tải danh sách booking…</span>
            {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-16" />)}
          </div>
        ) : !error && bookings.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <CalendarCheck2 className="mx-auto size-9 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 font-medium">Không tìm thấy booking</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {search || status ? 'Hãy thử thay đổi từ khóa hoặc trạng thái.' : 'Booking mới sẽ xuất hiện tại đây.'}
            </p>
            {(search || status) && <Button className="mt-4" variant="outline" onClick={clearFilters}>Xóa bộ lọc</Button>}
          </div>
        ) : bookings.length > 0 ? (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Booking / khách</TableHead>
                    <TableHead>Phòng</TableHead>
                    <TableHead>Lưu trú</TableHead>
                    <TableHead className="text-right">Giá trị</TableHead>
                    <TableHead>Booking / thanh toán</TableHead>
                    <TableHead className="text-right">Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings.map((booking) => (
                    <TableRow key={booking.booking_id}>
                      <TableCell>
                        <span className="block font-mono text-xs text-muted-foreground" title={booking.booking_id}>
                          #{shortReference(booking.booking_id)}
                        </span>
                        <span className="mt-1 block max-w-52 truncate font-medium">{booking.customer_name}</span>
                        <span className="block max-w-52 truncate text-xs text-muted-foreground">{booking.customer_email}</span>
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold">{booking.room_number_snapshot}</span>
                        <span className="block max-w-44 truncate text-xs text-muted-foreground">{booking.room_type_name_snapshot}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span>{formatDate(booking.check_in_date)} – {formatDate(booking.check_out_date)}</span>
                        <span className="block text-xs text-muted-foreground">{booking.nights} đêm · tạo {formatDateTime(booking.created_at)}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <span className="font-medium tabular-nums">{formatCurrency(asNumber(booking.total_price))}</span>
                        <span className="block text-xs text-muted-foreground tabular-nums">{formatCurrency(asNumber(booking.nightly_price))}/đêm</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1.5">
                          <StatusBadge status={booking.status} />
                          <PaymentStatusBadge status={booking.payment_status} />
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {booking.refund_due > 0
                              ? `Cần hoàn ${formatCurrency(asNumber(booking.refund_due))}`
                              : `Còn thu ${formatCurrency(asNumber(booking.balance_due))}`}
                          </span>
                          {booking.status === 'Pending' && (
                            <span className="text-[11px] text-amber-400 tabular-nums">
                              Cọc {formatCurrency(asNumber(booking.deposit_required))}
                              {booking.pending_expires_at ? ` · hạn ${formatDateTime(booking.pending_expires_at)}` : ''}
                              {!booking.can_cancel ? ' (đã quá hạn)' : ''}
                            </span>
                          )}
                          {asNumber(booking.credit_authorized) > 0 && (
                            <span className="text-[11px] text-emerald-400 tabular-nums">
                              Công nợ đã duyệt: {formatCurrency(asNumber(booking.credit_authorized))}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="min-w-36 text-right">
                        <BookingActions
                          booking={booking}
                          pending={pendingBookingId === booking.booking_id}
                          onAction={openAction}
                          onPayment={openPayment}
                          onRefundLookup={(target) => router.push(`/admin/payments?search=${encodeURIComponent(target.booking_id)}`)}
                          onAuthorizeCredit={openCreditDialog}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="divide-y divide-border md:hidden">
              {bookings.map((booking) => (
                <li key={booking.booking_id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-muted-foreground" title={booking.booking_id}>#{shortReference(booking.booking_id)}</p>
                      <p className="mt-1 truncate font-semibold">{booking.customer_name}</p>
                      <p className="truncate text-xs text-muted-foreground">{booking.customer_email}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5"><StatusBadge status={booking.status} /><PaymentStatusBadge status={booking.payment_status} /></div>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Phòng</dt>
                      <dd className="mt-0.5 font-medium">{booking.room_number_snapshot} · {booking.room_type_name_snapshot}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Giá trị</dt>
                      <dd className="mt-0.5 font-medium tabular-nums">{formatCurrency(asNumber(booking.total_price))}</dd>
                      <dd className="mt-1 text-xs text-muted-foreground tabular-nums">
                        {booking.refund_due > 0
                          ? `Cần hoàn ${formatCurrency(asNumber(booking.refund_due))}`
                          : `Còn thu ${formatCurrency(asNumber(booking.balance_due))}`}
                      </dd>
                      {booking.status === 'Pending' && (
                        <dd className="mt-0.5 text-[11px] text-amber-400 tabular-nums">
                          Cọc {formatCurrency(asNumber(booking.deposit_required))}
                          {booking.pending_expires_at ? ` · hạn ${formatDateTime(booking.pending_expires_at)}` : ''}
                        </dd>
                      )}
                      {asNumber(booking.credit_authorized) > 0 && (
                        <dd className="mt-0.5 text-[11px] text-emerald-400 tabular-nums">
                          Công nợ đã duyệt: {formatCurrency(asNumber(booking.credit_authorized))}
                        </dd>
                      )}
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs text-muted-foreground">Lưu trú</dt>
                      <dd className="mt-0.5">{formatDate(booking.check_in_date)} – {formatDate(booking.check_out_date)} · {booking.nights} đêm</dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex justify-end">
                    <BookingActions
                      booking={booking}
                      pending={pendingBookingId === booking.booking_id}
                      onAction={openAction}
                      onPayment={openPayment}
                      onRefundLookup={(target) => router.push(`/admin/payments?search=${encodeURIComponent(target.booking_id)}`)}
                      onAuthorizeCredit={openCreditDialog}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {!loading && !error && total > 0 && (
          <div className="flex flex-col gap-3 border-t border-border px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground" aria-live="polite">Hiển thị {firstRow}–{lastRow} trong {total} booking</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0 || refreshing}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                <ChevronLeft /> Trước
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + bookings.length >= total || refreshing}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Sau <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Dialog
        open={Boolean(actionTarget)}
        onClose={pendingBookingId ? () => undefined : () => { setActionTarget(null); setActionError(''); }}
        title={actionTarget?.kind === 'cancel'
          ? 'Xác nhận hủy booking?'
          : actionTarget?.kind === 'confirm'
            ? 'Xác nhận chuyển booking sang Confirmed?'
            : actionTarget?.kind === 'check-in'
              ? 'Xác nhận nhận phòng?'
              : actionTarget?.kind === 'check-out'
                ? 'Xác nhận trả phòng?'
                : 'Xác nhận khách không đến?'}
        description={actionTarget
          ? `Booking #${shortReference(actionTarget.booking.booking_id)} · ${actionTarget.booking.customer_name}`
          : undefined}
        footer={
          <>
            <Button
              variant="outline"
              disabled={Boolean(pendingBookingId)}
              onClick={() => { setActionTarget(null); setActionError(''); }}
            >
              Quay lại
            </Button>
            <Button
              variant={actionTarget?.kind === 'cancel' ? 'danger' : 'primary'}
              disabled={Boolean(pendingBookingId) || actionStale || ((actionTarget?.kind === 'no-show' || actionTarget?.kind === 'confirm') && actionReason.trim().length < 10)}
              onClick={() => void confirmAction()}
            >
              {pendingBookingId && <LoaderCircle className="animate-spin" />}
              {actionTarget?.kind === 'cancel'
                ? 'Hủy booking'
                : actionTarget?.kind === 'confirm'
                  ? 'Xác nhận booking'
                  : actionTarget?.kind === 'check-in'
                    ? 'Nhận phòng'
                    : actionTarget?.kind === 'check-out'
                      ? 'Trả phòng'
                      : 'Ghi nhận không đến'}
            </Button>
          </>
        }
      >
        {actionError && <p className="mb-3 rounded-md bg-danger-muted px-3 py-2 text-danger" role="alert">{actionError}</p>}
        {actionTarget?.kind === 'cancel' ? (
          <p className="leading-6 text-muted-foreground">
            Booking sẽ chuyển sang trạng thái đã hủy và phòng được trả lại cho các ngày đã đặt. Thao tác này không thể hoàn tác trên màn hình quản trị.
          </p>
        ) : actionTarget?.kind === 'confirm' ? (
          <div className="grid gap-4 leading-6 text-muted-foreground">
            <p>
              Booking Pending đã đủ tiền cọc ({formatCurrency(asNumber(actionTarget.booking.net_paid))} / {formatCurrency(asNumber(actionTarget.booking.deposit_required))}) và còn hạn giữ phòng. Chuyển sang <strong className="text-foreground">Confirmed</strong>?
            </p>
            <label className="grid gap-1.5 text-sm font-medium">
              Lý do xác nhận thủ công
              <Input
                value={actionReason}
                minLength={10}
                maxLength={500}
                disabled={Boolean(pendingBookingId) || actionStale}
                onChange={(event) => {
                  setActionReason(event.target.value);
                  setActionKey(newPaymentKey().replace('ui-payment:', 'ui-confirm:'));
                  setActionError('');
                }}
                placeholder="Nhập lý do từ 10 đến 500 ký tự"
                required
              />
            </label>
          </div>
        ) : actionTarget?.kind === 'check-in' ? (
          <div className="grid gap-2 leading-6 text-muted-foreground">
            <p>
              Phòng <strong className="text-foreground">{actionTarget.booking.room_number_snapshot}</strong>
              {' '}sẽ chuyển sang đang sử dụng và booking chuyển sang đang lưu trú.
            </p>
            <p>
              Kỳ lưu trú {formatDate(actionTarget.booking.check_in_date)} – {formatDate(actionTarget.booking.check_out_date)}.
              {actionTarget.booking.balance_due > 0
                ? ` Còn phải thu ${formatCurrency(asNumber(actionTarget.booking.balance_due))}.`
                : ' Booking đã thanh toán đủ.'}
            </p>
          </div>
        ) : actionTarget?.kind === 'check-out' ? (
          <p className="leading-6 text-muted-foreground">
            Booking sẽ chuyển sang đã hoàn tất. Phòng {actionTarget.booking.room_number_snapshot} cần được dọn và đánh dấu sẵn sàng trước lượt nhận phòng tiếp theo.
            {' '}Thao tác này không thể hoàn tác trên màn hình quản trị.
            {actionTarget.booking.balance_due > 0
              ? ` Booking vẫn còn phải thu ${formatCurrency(asNumber(actionTarget.booking.balance_due))}.`
              : ''}
          </p>
        ) : (
          <div className="grid gap-4 leading-6 text-muted-foreground">
            <p>Booking đã qua ngày nhận phòng nhưng khách chưa nhận phòng. Ghi nhận khách không đến sẽ kết thúc booking; khoản cần hoàn tiền được theo dõi riêng.</p>
            <label className="grid gap-1.5 text-sm font-medium">
              Lý do khách không đến
              <Input value={actionReason} minLength={10} maxLength={500} disabled={Boolean(pendingBookingId) || actionStale}
                onChange={(event) => { setActionReason(event.target.value); setActionKey(newPaymentKey().replace('ui-payment:', 'ui-no-show:')); setActionError(''); }}
                placeholder="Nhập lý do từ 10 đến 500 ký tự" required />
            </label>
          </div>
        )}
      </Dialog>

      {creditTarget && (
        <Dialog
          open
          onClose={savingCredit ? () => undefined : () => { setCreditTarget(null); setCreditError(''); }}
          title={`Phê duyệt công nợ #${shortReference(creditTarget.booking_id)}`}
          description={`${creditTarget.customer_name} · Còn phải thu ${formatCurrency(asNumber(creditTarget.balance_due))}`}
        >
          <form className="grid gap-4" onSubmit={(event) => void submitCreditAuthorization(event)}>
            <p className="text-sm text-muted-foreground">
              Phê duyệt hạn mức công nợ cho khách đang lưu trú để mở khóa thao tác <strong>Trả phòng (Check-out)</strong> khi chưa tất toán hết hóa đơn.
            </p>
            {creditError && <p className="rounded-md bg-danger-muted px-3 py-2 text-xs text-danger" role="alert">{creditError}</p>}
            <label className="grid gap-1.5 text-sm font-medium">
              Số tiền công nợ được duyệt (VND)
              <Input
                type="number"
                min="0.01"
                step="0.01"
                max={asNumber(creditTarget.balance_due)}
                value={creditAmount}
                onChange={(event) => {
                  setCreditAmount(event.target.value);
                  setCreditKey(newPaymentKey().replace('ui-payment:', 'ui-credit:'));
                  setCreditError('');
                }}
                disabled={savingCredit}
                required
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              Lý do phê duyệt (10–500 ký tự)
              <Input
                value={creditReason}
                minLength={10}
                maxLength={500}
                placeholder="Ví dụ: Công ty đối tác thanh toán chuyển khoản cuối tháng"
                onChange={(event) => {
                  setCreditReason(event.target.value);
                  setCreditKey(newPaymentKey().replace('ui-payment:', 'ui-credit:'));
                  setCreditError('');
                }}
                disabled={savingCredit}
                required
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={savingCredit} onClick={() => { setCreditTarget(null); setCreditError(''); }}>
                Đóng
              </Button>
              <Button type="submit" disabled={savingCredit || creditReason.trim().length < 10}>
                {savingCredit ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
                Xác nhận duyệt công nợ
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {paymentTarget && (
        <Dialog
          open
          onClose={closePayment}
          title={`Ghi nhận thanh toán #${shortReference(paymentTarget.booking_id)}`}
          description={`${paymentSummary ? `Số dư cần thanh toán ${formatCurrency(asNumber(paymentSummary.balance_due))} · ` : ''}${paymentTarget.customer_name}`}
        >
          <form className="grid gap-4" onSubmit={submitPayment}>
            {paymentLoading && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" /> Đang kiểm tra trạng thái thanh toán…</p>}
            {paymentSummary?.booking_status === 'Pending' && <p className="text-sm text-muted-foreground">Còn cần cọc {formatCurrency(paymentSummary.deposit_due)}{paymentSummary.pending_expires_at ? ` trước ${formatDateTime(paymentSummary.pending_expires_at)}` : ''}. Nhận đủ cọc trước hạn sẽ tự xác nhận booking.</p>}
            {paymentError && <p className="rounded-md bg-danger-muted px-3 py-2 text-danger" role="alert">{paymentError}</p>}
            <label className="grid gap-1.5 font-medium">Số tiền
              <Input
                type="number"
                min="0.01"
                step="0.01"
                max={paymentSummary?.balance_due ?? 0}
                value={paymentAmount}
                onChange={(event) => { setPaymentAmount(event.target.value); renewPaymentRequest(); }}
                disabled={savingPayment || paymentLoading || !paymentSummary?.can_record_payment}
                required
              />
            </label>
            <label className="grid gap-1.5 font-medium">Phương thức
              <Select
                value={paymentMethod}
                onChange={(event) => { setPaymentMethod(event.target.value as PaymentMethod); renewPaymentRequest(); }}
                disabled={savingPayment}
              >
                <option value="Cash">Tiền mặt</option>
                <option value="BankTransfer">Chuyển khoản</option>
                <option value="CardTerminal">Thẻ tại quầy</option>
              </Select>
            </label>
            <label className="grid gap-1.5 font-medium">Mã tham chiếu
              <Input
                value={paymentReference}
                maxLength={100}
                placeholder="Tùy chọn, ví dụ mã chuyển khoản"
                onChange={(event) => { setPaymentReference(event.target.value); renewPaymentRequest(); }}
                disabled={savingPayment}
              />
            </label>
            <label className="grid gap-1.5 font-medium">Ghi chú
              <Input
                value={paymentNote}
                maxLength={250}
                placeholder="Tùy chọn"
                onChange={(event) => { setPaymentNote(event.target.value); renewPaymentRequest(); }}
                disabled={savingPayment}
              />
            </label>
            <p className="text-xs leading-5 text-muted-foreground">
              Chỉ ghi nhận khoản tiền khách sạn đã nhận. Màn hình này không thực hiện thu tiền từ thẻ của khách.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closePayment} disabled={savingPayment}>Đóng</Button>
              <Button type="submit" disabled={savingPayment || paymentLoading || !paymentSummary?.can_record_payment}>
                {savingPayment ? <LoaderCircle className="animate-spin" /> : <Banknote />} Xác nhận thu
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </PageContainer>
  );
}
