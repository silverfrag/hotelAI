'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  History,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
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
import { getAdminUserAudits, getAdminUsers, updateAdminUser } from '@/services/admin.service';
import type {
  AdminUser,
  AdminUserAudit,
  AdminUserRole,
  AdminUserStatus,
} from '@/types/admin.type';
import { formatCurrency } from '@/utils/formatCurrency';

const PAGE_SIZE = 20;
const roleLabels: Record<AdminUserRole, string> = { customer: 'Khách hàng', admin: 'Quản trị viên' };
const statusLabels: Record<AdminUserStatus, string> = {
  Active: 'Hoạt động',
  Suspended: 'Đã khóa',
  Deactivated: 'Vô hiệu hóa',
};
const statusVariants: Record<AdminUserStatus, 'success' | 'warning' | 'danger'> = {
  Active: 'success',
  Suspended: 'warning',
  Deactivated: 'danger',
};
const auditLabels: Record<AdminUserAudit['action'], string> = {
  profile_updated: 'Cập nhật hồ sơ',
  password_changed: 'Đổi mật khẩu',
  account_updated: 'Đổi quyền/trạng thái',
  deactivated: 'Vô hiệu hóa tài khoản',
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

function UserEditor({
  target,
  currentUserId,
  saving,
  error,
  onClose,
  onSave,
}: {
  target: AdminUser;
  currentUserId: string | undefined;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (role: AdminUserRole, status: 'Active' | 'Suspended') => Promise<void>;
}) {
  const isSelf = target.customer_id === currentUserId;
  const [role, setRole] = useState<AdminUserRole>(target.role);
  const [status, setStatus] = useState<'Active' | 'Suspended'>(
    target.account_status === 'Suspended' ? 'Suspended' : 'Active',
  );

  return (
    <Dialog
      open
      onClose={saving ? () => undefined : onClose}
      title={`Cập nhật ${target.full_name}`}
      description="Thay đổi có hiệu lực ngay với các yêu cầu tiếp theo; thay đổi trạng thái sẽ vô hiệu hóa phiên cũ."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>Hủy</Button>
          <Button
            onClick={() => void onSave(role, status)}
            disabled={saving || (role === target.role && status === target.account_status)}
          >
            {saving ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
            Lưu thay đổi
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {isSelf && (
          <p className="rounded-md bg-warning-muted px-3 py-2 text-warning">
            Bạn không thể tự hạ quyền hoặc tự khóa tài khoản đang đăng nhập.
          </p>
        )}
        {error && <p className="rounded-md bg-danger-muted px-3 py-2 text-danger" role="alert">{error}</p>}
        <label className="grid gap-1.5 font-medium">Vai trò
          <Select value={role} onChange={(event) => setRole(event.target.value as AdminUserRole)} disabled={saving || isSelf}>
            <option value="customer">Khách hàng</option>
            <option value="admin">Quản trị viên</option>
          </Select>
        </label>
        <label className="grid gap-1.5 font-medium">Trạng thái
          <Select value={status} onChange={(event) => setStatus(event.target.value as 'Active' | 'Suspended')} disabled={saving || isSelf}>
            <option value="Active">Hoạt động</option>
            <option value="Suspended">Khóa tài khoản</option>
          </Select>
        </label>
        <p className="text-xs leading-5 text-muted-foreground">
          Tài khoản đã vô hiệu hóa vĩnh viễn không thể khôi phục trong màn hình này.
        </p>
      </div>
    </Dialog>
  );
}

function AuditDialog({
  target,
  audits,
  loading,
  error,
  onClose,
}: {
  target: AdminUser;
  audits: AdminUserAudit[];
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      className="max-w-2xl"
      title={`Lịch sử tài khoản · ${target.full_name}`}
      description="Nhật ký chỉ-ghi của các thay đổi hồ sơ, bảo mật và vòng đời tài khoản."
      footer={<Button variant="outline" onClick={onClose}>Đóng</Button>}
    >
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-muted-foreground" role="status">
          <LoaderCircle className="size-5 animate-spin" /> Đang tải lịch sử…
        </div>
      ) : error ? (
        <p className="rounded-md bg-danger-muted px-3 py-2 text-danger" role="alert">{error}</p>
      ) : audits.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">Chưa có thay đổi nào được ghi nhận.</p>
      ) : (
        <ol className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
          {audits.map((audit) => (
            <li key={audit.audit_id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{auditLabels[audit.action]}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    bởi {audit.changed_by_name} · {formatDateTime(audit.created_at)}
                  </p>
                </div>
                <Badge variant="outline">v{audit.old_version} → v{audit.new_version}</Badge>
              </div>
              {(audit.old_role !== audit.new_role || audit.old_status !== audit.new_status) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {audit.old_role && audit.new_role && audit.old_role !== audit.new_role
                    ? `${roleLabels[audit.old_role]} → ${roleLabels[audit.new_role]}`
                    : ''}
                  {audit.old_role !== audit.new_role && audit.old_status !== audit.new_status ? ' · ' : ''}
                  {audit.old_status && audit.new_status && audit.old_status !== audit.new_status
                    ? `${statusLabels[audit.old_status]} → ${statusLabels[audit.new_status]}`
                    : ''}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}

export function AdminUsersManager() {
  const { accessToken, user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [draftSearch, setDraftSearch] = useState('');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<AdminUserRole | ''>('');
  const [status, setStatus] = useState<AdminUserStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<AdminUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [auditTarget, setAuditTarget] = useState<AdminUser | null>(null);
  const [audits, setAudits] = useState<AdminUserAudit[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');

  const loadUsers = useCallback(async (silent = false, signal?: AbortSignal) => {
    if (!accessToken) return;
    silent ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const page = await getAdminUsers(accessToken, {
        limit: PAGE_SIZE,
        offset,
        role,
        status,
        search,
        signal,
      });
      setUsers(page.items);
      setTotal(page.total);
      if (page.items.length === 0 && offset > 0 && page.total > 0) {
        setOffset(Math.max(0, Math.floor((page.total - 1) / PAGE_SIZE) * PAGE_SIZE));
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Không thể tải danh sách người dùng.');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [accessToken, offset, role, search, status]);

  useEffect(() => {
    const controller = new AbortController();
    void loadUsers(false, controller.signal);
    return () => controller.abort();
  }, [loadUsers]);

  const summary = useMemo(() => ({
    active: users.filter((item) => item.account_status === 'Active').length,
    admins: users.filter((item) => item.role === 'admin').length,
  }), [users]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setSearch(draftSearch.trim().slice(0, 150));
  }

  async function saveUser(nextRole: AdminUserRole, nextStatus: 'Active' | 'Suspended') {
    if (!editor || !accessToken) return;
    setSaving(true);
    setEditorError('');
    try {
      const updated = await updateAdminUser(accessToken, editor.customer_id, {
        role: nextRole,
        account_status: nextStatus,
        expected_version: editor.version,
      });
      setUsers((current) => current.map((item) => item.customer_id === updated.customer_id ? updated : item));
      setEditor(null);
      setNotice(`Đã cập nhật tài khoản ${updated.full_name}.`);
    } catch (caught) {
      setEditorError(caught instanceof Error ? caught.message : 'Không thể cập nhật tài khoản.');
    } finally {
      setSaving(false);
    }
  }

  async function openAudits(target: AdminUser) {
    if (!accessToken) return;
    setAuditTarget(target);
    setAudits([]);
    setAuditError('');
    setAuditLoading(true);
    try {
      const page = await getAdminUserAudits(accessToken, target.customer_id);
      setAudits(page.items);
    } catch (caught) {
      setAuditError(caught instanceof Error ? caught.message : 'Không thể tải lịch sử tài khoản.');
    } finally {
      setAuditLoading(false);
    }
  }

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstRow = total === 0 ? 0 : offset + 1;
  const lastRow = Math.min(offset + users.length, total);

  return (
    <PageContainer>
      <PageHeader
        title="Quản lý người dùng"
        description="Theo dõi hồ sơ, giá trị booking, phân quyền và trạng thái truy cập theo thời gian thực."
        actions={
          <Button variant="outline" onClick={() => void loadUsers(true)} disabled={loading || refreshing}>
            <RefreshCw className={refreshing ? 'animate-spin' : ''} /> Làm mới
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="flex items-center gap-3 pt-5"><UsersRound className="size-5 text-primary" /><div><p className="text-xs text-muted-foreground">Tổng kết quả</p><p className="text-xl font-semibold">{total}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 pt-5"><UserRoundCheck className="size-5 text-success" /><div><p className="text-xs text-muted-foreground">Hoạt động trên trang</p><p className="text-xl font-semibold">{summary.active}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 pt-5"><ShieldCheck className="size-5 text-info" /><div><p className="text-xs text-muted-foreground">Admin trên trang</p><p className="text-xl font-semibold">{summary.admins}</p></div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="pt-5">
          <form className="mb-5 grid gap-3 md:grid-cols-[minmax(240px,1fr)_180px_180px_auto]" onSubmit={submitSearch}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} maxLength={150} placeholder="Tên, email hoặc số điện thoại" />
            </div>
            <Select value={role} onChange={(event) => { setRole(event.target.value as AdminUserRole | ''); setOffset(0); }}>
              <option value="">Mọi vai trò</option><option value="customer">Khách hàng</option><option value="admin">Quản trị viên</option>
            </Select>
            <Select value={status} onChange={(event) => { setStatus(event.target.value as AdminUserStatus | ''); setOffset(0); }}>
              <option value="">Mọi trạng thái</option><option value="Active">Hoạt động</option><option value="Suspended">Đã khóa</option><option value="Deactivated">Vô hiệu hóa</option>
            </Select>
            <Button type="submit"><Search /> Tìm</Button>
          </form>

          {notice && <p className="mb-4 rounded-md bg-success-muted px-3 py-2 text-sm text-success" role="status">{notice}</p>}
          {error && <p className="mb-4 flex items-center gap-2 rounded-md bg-danger-muted px-3 py-2 text-sm text-danger" role="alert"><AlertCircle className="size-4" />{error}</p>}

          {loading ? (
            <div className="space-y-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}</div>
          ) : users.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground"><UsersRound className="mx-auto mb-3 size-9" /><p>Không tìm thấy người dùng phù hợp.</p></div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Người dùng</TableHead><TableHead>Liên hệ</TableHead><TableHead>Quyền / trạng thái</TableHead><TableHead>Booking</TableHead><TableHead>Giá trị</TableHead><TableHead className="text-right">Thao tác</TableHead></TableRow></TableHeader>
              <TableBody>
                {users.map((item) => (
                  <TableRow key={item.customer_id}>
                    <TableCell><p className="font-medium">{item.full_name}</p><p className="mt-1 text-xs text-muted-foreground">Tham gia {formatDateTime(item.created_at)}</p></TableCell>
                    <TableCell><p>{item.email}</p><p className="mt-1 text-xs text-muted-foreground">{item.phone || item.nationality || 'Chưa bổ sung hồ sơ'}</p></TableCell>
                    <TableCell><div className="flex flex-wrap gap-1.5"><Badge variant={item.role === 'admin' ? 'info' : 'neutral'}>{roleLabels[item.role]}</Badge><Badge variant={statusVariants[item.account_status]} dot>{statusLabels[item.account_status]}</Badge></div></TableCell>
                    <TableCell><p>{item.booking_count} tổng · {item.active_booking_count} hoạt động</p><p className="mt-1 text-xs text-muted-foreground">{item.confirmed_booking_count} chờ · {item.checked_in_booking_count} đang lưu trú</p></TableCell>
                    <TableCell className="font-medium">{formatCurrency(item.booking_value)}</TableCell>
                    <TableCell><div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => void openAudits(item)}><History /> Lịch sử</Button><Button size="sm" variant="outline" onClick={() => { setEditorError(''); setEditor(item); }} disabled={item.account_status === 'Deactivated'}><Pencil /> Sửa</Button></div></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Hiển thị {firstRow}–{lastRow} trong {total} tài khoản</span>
            <div className="flex items-center gap-2"><Button size="icon" variant="outline" aria-label="Trang trước" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><ChevronLeft /></Button><span>Trang {currentPage}/{pageCount}</span><Button size="icon" variant="outline" aria-label="Trang sau" disabled={offset + PAGE_SIZE >= total || loading} onClick={() => setOffset(offset + PAGE_SIZE)}><ChevronRight /></Button></div>
          </div>
        </CardContent>
      </Card>

      {editor && <UserEditor target={editor} currentUserId={currentUser?.id} saving={saving} error={editorError} onClose={() => setEditor(null)} onSave={saveUser} />}
      {auditTarget && <AuditDialog target={auditTarget} audits={audits} loading={auditLoading} error={auditError} onClose={() => setAuditTarget(null)} />}
    </PageContainer>
  );
}
