'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BedDouble,
  Layers3,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { PageContainer } from '@/components/common/PageContainer';
import { PageHeader } from '@/components/common/PageHeader';
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
  createAdminRoom,
  createAdminRoomType,
  deleteAdminRoom,
  deleteAdminRoomType,
  getAdminRooms,
  getAdminRoomTypes,
  updateAdminRoom,
  updateAdminRoomType,
} from '@/services/admin.service';
import type {
  AdminRoom,
  AdminRoomType,
  CreateRoomInput,
  EditableRoomStatus,
  RoomStatus,
  RoomTypeInput,
} from '@/types/admin.type';
import { formatCurrency } from '@/utils/formatCurrency';

type RoomEditor = { mode: 'create' } | { mode: 'edit'; room: AdminRoom };
type RoomTypeEditor = { mode: 'create' } | { mode: 'edit'; roomType: AdminRoomType };
type DeleteTarget = { kind: 'room'; room: AdminRoom } | { kind: 'roomType'; roomType: AdminRoomType };

const editableRoomStatuses: EditableRoomStatus[] = ['Available', 'Maintenance'];
const statusLabel: Record<RoomStatus, string> = {
  Available: 'Sẵn sàng',
  Occupied: 'Đang sử dụng',
  Maintenance: 'Bảo trì',
};
const statusVariant: Record<RoomStatus, 'success' | 'info' | 'warning'> = {
  Available: 'success',
  Occupied: 'info',
  Maintenance: 'warning',
};

function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="mb-5 flex flex-col gap-3 rounded-lg border border-danger/20 bg-danger-muted p-4 text-sm text-danger sm:flex-row sm:items-center">
      <div className="flex min-w-0 items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <p>{message}</p>
      </div>
      {onRetry && (
        <Button className="sm:ml-auto" variant="outline" size="sm" onClick={onRetry}>
          Thử lại
        </Button>
      )}
    </div>
  );
}

function RoomEditorDialog({
  editor,
  roomTypes,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  editor: RoomEditor;
  roomTypes: AdminRoomType[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: CreateRoomInput) => Promise<void>;
}) {
  const room = editor.mode === 'edit' ? editor.room : null;
  const [roomNumber, setRoomNumber] = useState(room?.room_number ?? '');
  const [typeId, setTypeId] = useState(String(room?.type_id ?? roomTypes[0]?.type_id ?? ''));
  const [status, setStatus] = useState<RoomStatus>(room?.current_status ?? 'Available');
  const [validationError, setValidationError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedRoomNumber = roomNumber.trim();
    const parsedTypeId = Number(typeId);
    if (!normalizedRoomNumber) return setValidationError('Vui lòng nhập số phòng.');
    if (normalizedRoomNumber.length > 10) return setValidationError('Số phòng tối đa 10 ký tự.');
    if (!/^[A-Za-z0-9-]+$/.test(normalizedRoomNumber)) {
      return setValidationError('Số phòng chỉ gồm chữ cái, chữ số và dấu gạch ngang.');
    }
    if (!Number.isInteger(parsedTypeId) || parsedTypeId < 1 || parsedTypeId > 2_147_483_647) {
      return setValidationError('Vui lòng chọn loại phòng.');
    }
    if (status === 'Occupied') {
      return setValidationError('Trạng thái đang sử dụng chỉ được cập nhật bằng thao tác nhận/trả phòng.');
    }
    setValidationError('');
    await onSubmit({ room_number: normalizedRoomNumber, type_id: parsedTypeId, current_status: status });
  }

  return (
    <Dialog
      open
      onClose={saving ? () => undefined : onClose}
      title={room ? `Chỉnh sửa phòng ${room.room_number}` : 'Thêm phòng mới'}
      description="Cập nhật phòng vật lý và trạng thái vận hành hiện tại."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>Hủy</Button>
          <Button type="submit" form="admin-room-form" disabled={saving || roomTypes.length === 0}>
            {saving && <LoaderCircle className="animate-spin" />}
            {room ? 'Lưu thay đổi' : 'Tạo phòng'}
          </Button>
        </>
      }
    >
      <form id="admin-room-form" className="grid gap-4" onSubmit={submit}>
        {(error || validationError) && (
          <p className="rounded-md bg-danger-muted px-3 py-2 text-sm text-danger" role="alert">
            {validationError || error}
          </p>
        )}
        <label className="grid gap-1.5 font-medium">
          Số phòng
          <Input
            value={roomNumber}
            onChange={(event) => setRoomNumber(event.target.value)}
            placeholder="Ví dụ: 305"
            maxLength={10}
            autoFocus
            disabled={saving}
          />
        </label>
        <label className="grid gap-1.5 font-medium">
          Loại phòng
          <Select value={typeId} onChange={(event) => setTypeId(event.target.value)} disabled={saving}>
            {roomTypes.length === 0 && <option value="">Chưa có loại phòng</option>}
            {roomTypes.map((item) => (
              <option key={item.type_id} value={item.type_id}>
                {item.type_name} · {formatCurrency(Number(item.base_price))}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1.5 font-medium">
          Trạng thái
          <Select value={status} onChange={(event) => setStatus(event.target.value as RoomStatus)} disabled={saving}>
            {status === 'Occupied' && <option value="Occupied" disabled>Đang sử dụng (tự động)</option>}
            {editableRoomStatuses.map((item) => <option key={item} value={item}>{statusLabel[item]}</option>)}
          </Select>
        </label>
      </form>
    </Dialog>
  );
}

function RoomTypeEditorDialog({
  editor,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  editor: RoomTypeEditor;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: RoomTypeInput) => Promise<void>;
}) {
  const roomType = editor.mode === 'edit' ? editor.roomType : null;
  const [name, setName] = useState(roomType?.type_name ?? '');
  const [basePrice, setBasePrice] = useState(String(roomType?.base_price ?? ''));
  const [capacity, setCapacity] = useState(String(roomType?.capacity ?? 2));
  const [validationError, setValidationError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = name.trim();
    const parsedPrice = Number(basePrice);
    const parsedCapacity = Number(capacity);
    if (!normalizedName) return setValidationError('Vui lòng nhập tên loại phòng.');
    if (normalizedName.length > 50) return setValidationError('Tên loại phòng tối đa 50 ký tự.');
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0 || parsedPrice > 99_999_999.99) {
      return setValidationError('Giá cơ sở phải lớn hơn 0 và không vượt quá 99.999.999,99 VND.');
    }
    if (!Number.isInteger(parsedPrice * 100)) {
      return setValidationError('Giá cơ sở chỉ được có tối đa 2 chữ số thập phân.');
    }
    if (!Number.isInteger(parsedCapacity) || parsedCapacity < 1 || parsedCapacity > 1_000) {
      return setValidationError('Sức chứa phải là số nguyên từ 1 đến 1.000.');
    }
    setValidationError('');
    await onSubmit({ name: normalizedName, base_price: parsedPrice, capacity: parsedCapacity });
  }

  return (
    <Dialog
      open
      onClose={saving ? () => undefined : onClose}
      title={roomType ? `Chỉnh sửa ${roomType.type_name}` : 'Thêm loại phòng'}
      description="Giá cơ sở là đầu vào để AI tính giá bán theo nhu cầu."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>Hủy</Button>
          <Button type="submit" form="admin-room-type-form" disabled={saving}>
            {saving && <LoaderCircle className="animate-spin" />}
            {roomType ? 'Lưu thay đổi' : 'Tạo loại phòng'}
          </Button>
        </>
      }
    >
      <form id="admin-room-type-form" className="grid gap-4" onSubmit={submit}>
        {(error || validationError) && (
          <p className="rounded-md bg-danger-muted px-3 py-2 text-sm text-danger" role="alert">
            {validationError || error}
          </p>
        )}
        <label className="grid gap-1.5 font-medium">
          Tên loại phòng
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={50} autoFocus disabled={saving} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 font-medium">
            Giá cơ sở (VND/đêm)
            <Input type="number" min="1" step="1000" value={basePrice} onChange={(event) => setBasePrice(event.target.value)} disabled={saving} />
          </label>
          <label className="grid gap-1.5 font-medium">
            Sức chứa
            <Input type="number" min="1" step="1" value={capacity} onChange={(event) => setCapacity(event.target.value)} disabled={saving} />
          </label>
        </div>
      </form>
    </Dialog>
  );
}

export function AdminRoomsManager() {
  const { accessToken } = useAuth();
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [roomTypes, setRoomTypes] = useState<AdminRoomType[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [roomEditor, setRoomEditor] = useState<RoomEditor | null>(null);
  const [roomTypeEditor, setRoomTypeEditor] = useState<RoomTypeEditor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [statusUpdating, setStatusUpdating] = useState<number | null>(null);

  const loadData = useCallback(async (silent = false) => {
    if (!accessToken) return;
    silent ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const [nextRooms, nextRoomTypes] = await Promise.all([
        getAdminRooms(accessToken),
        getAdminRoomTypes(accessToken),
      ]);
      setRooms(nextRooms);
      setRoomTypes(nextRoomTypes);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể tải dữ liệu phòng.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [accessToken]);

  useEffect(() => { void loadData(); }, [loadData]);

  const counts = useMemo(() => ({
    Available: rooms.filter((room) => room.current_status === 'Available').length,
    Occupied: rooms.filter((room) => room.current_status === 'Occupied').length,
    Maintenance: rooms.filter((room) => room.current_status === 'Maintenance').length,
  }), [rooms]);

  async function submitRoom(input: CreateRoomInput) {
    if (!accessToken || !roomEditor) return;
    setSaving(true);
    setActionError('');
    try {
      if (roomEditor.mode === 'create') {
        await createAdminRoom(accessToken, input);
        setNotice(`Đã tạo phòng ${input.room_number}.`);
      } else {
        await updateAdminRoom(accessToken, roomEditor.room.room_id, input);
        setNotice(`Đã cập nhật phòng ${input.room_number}.`);
      }
      setRoomEditor(null);
      await loadData(true);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Không thể lưu phòng.');
    } finally {
      setSaving(false);
    }
  }

  async function submitRoomType(input: RoomTypeInput) {
    if (!accessToken || !roomTypeEditor) return;
    setSaving(true);
    setActionError('');
    try {
      if (roomTypeEditor.mode === 'create') {
        await createAdminRoomType(accessToken, input);
        setNotice(`Đã tạo loại phòng ${input.name}.`);
      } else {
        await updateAdminRoomType(accessToken, roomTypeEditor.roomType.type_id, input);
        setNotice(`Đã cập nhật loại phòng ${input.name}.`);
      }
      setRoomTypeEditor(null);
      await loadData(true);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Không thể lưu loại phòng.');
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(room: AdminRoom, currentStatus: EditableRoomStatus) {
    if (!accessToken || currentStatus === room.current_status) return;
    setStatusUpdating(room.room_id);
    setError('');
    setNotice('');
    try {
      await updateAdminRoom(accessToken, room.room_id, { current_status: currentStatus });
      setRooms((current) => current.map((item) => (
        item.room_id === room.room_id ? { ...item, current_status: currentStatus } : item
      )));
      setNotice(`Đã chuyển phòng ${room.room_number} sang “${statusLabel[currentStatus]}”.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể cập nhật trạng thái phòng.');
    } finally {
      setStatusUpdating(null);
    }
  }

  async function confirmDelete() {
    if (!accessToken || !deleteTarget) return;
    setSaving(true);
    setActionError('');
    try {
      if (deleteTarget.kind === 'room') {
        await deleteAdminRoom(accessToken, deleteTarget.room.room_id);
        setNotice(`Đã xóa phòng ${deleteTarget.room.room_number}.`);
      } else {
        await deleteAdminRoomType(accessToken, deleteTarget.roomType.type_id);
        setNotice(`Đã xóa loại phòng ${deleteTarget.roomType.type_name}.`);
      }
      setDeleteTarget(null);
      await loadData(true);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Không thể xóa dữ liệu.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Phòng & loại phòng"
        description="Quản lý kho phòng vật lý, trạng thái vận hành và giá cơ sở cho AI Pricing."
        actions={
          <>
            <Button variant="outline" onClick={() => void loadData(true)} disabled={refreshing}>
              <RefreshCw className={refreshing ? 'animate-spin' : ''} />
              Làm mới
            </Button>
            <Button onClick={() => { setActionError(''); setRoomEditor({ mode: 'create' }); }} disabled={roomTypes.length === 0}>
              <Plus />
              Thêm phòng
            </Button>
          </>
        }
      />

      {error && <ErrorNotice message={error} onRetry={() => void loadData()} />}
      {notice && (
        <div className="mb-5 rounded-lg border border-success/20 bg-success-muted px-4 py-3 text-sm text-success" role="status">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Đang tải thống kê phòng">
          {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Tổng số phòng', value: rooms.length, tone: 'text-foreground' },
            { label: 'Sẵn sàng', value: counts.Available, tone: 'text-success' },
            { label: 'Đang sử dụng', value: counts.Occupied, tone: 'text-info' },
            { label: 'Bảo trì', value: counts.Maintenance, tone: 'text-warning' },
          ].map((item) => (
            <Card key={item.label}>
              <CardContent className="flex items-center justify-between pt-5">
                <div>
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                  <p className={`mt-1 text-2xl font-semibold tabular-nums ${item.tone}`}>{item.value}</p>
                </div>
                <BedDouble className="size-5 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="grid gap-6">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Kho phòng</CardTitle>
              <CardDescription>{rooms.length} phòng vật lý trong hệ thống</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-0">
            {loading ? (
              <div className="grid gap-3 px-5 pb-2">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-12" />)}</div>
            ) : rooms.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <BedDouble className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-3 font-medium">Chưa có phòng nào</p>
                <p className="mt-1 text-sm text-muted-foreground">Tạo loại phòng trước, sau đó thêm phòng vật lý vào kho.</p>
                <Button className="mt-4" onClick={() => setRoomEditor({ mode: 'create' })} disabled={roomTypes.length === 0}>
                  <Plus /> Thêm phòng
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Phòng</TableHead>
                    <TableHead>Loại phòng</TableHead>
                    <TableHead>Giá cơ sở</TableHead>
                    <TableHead>Sức chứa</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead className="text-right">Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rooms.map((room) => (
                    <TableRow key={room.room_id}>
                      <TableCell><span className="font-semibold">{room.room_number}</span></TableCell>
                      <TableCell>{room.type_name}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{formatCurrency(Number(room.base_price))}</TableCell>
                      <TableCell className="tabular-nums">{room.capacity} khách</TableCell>
                      <TableCell>
                        <div className="flex min-w-44 items-center gap-2">
                          <Badge variant={statusVariant[room.current_status]} dot>{statusLabel[room.current_status]}</Badge>
                          <Select
                            className="h-8 min-w-32"
                            aria-label={`Trạng thái phòng ${room.room_number}`}
                            value={room.current_status}
                            disabled={statusUpdating === room.room_id || room.occupancy_booking_id !== null}
                            onChange={(event) => void changeStatus(room, event.target.value as EditableRoomStatus)}
                          >
                            {room.current_status === 'Occupied' && <option value="Occupied" disabled>Đang sử dụng (tự động)</option>}
                            {editableRoomStatuses.map((item) => <option key={item} value={item}>{statusLabel[item]}</option>)}
                          </Select>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" disabled={room.occupancy_booking_id !== null} aria-label={`Sửa phòng ${room.room_number}`} onClick={() => { setActionError(''); setRoomEditor({ mode: 'edit', room }); }}>
                            <Pencil />
                          </Button>
                          <Button variant="ghost" size="icon" disabled={room.occupancy_booking_id !== null} className="text-danger hover:bg-danger-muted" aria-label={`Xóa phòng ${room.room_number}`} onClick={() => { setActionError(''); setDeleteTarget({ kind: 'room', room }); }}>
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Loại phòng & giá cơ sở</CardTitle>
              <CardDescription>AI dùng giá này làm mốc trước khi áp dụng hệ số nhu cầu.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => { setActionError(''); setRoomTypeEditor({ mode: 'create' }); }}>
              <Plus /> Thêm loại
            </Button>
          </CardHeader>
          <CardContent className="px-0">
            {loading ? (
              <div className="grid gap-3 px-5 pb-2">{[0, 1].map((item) => <Skeleton key={item} className="h-12" />)}</div>
            ) : roomTypes.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <Layers3 className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-3 font-medium">Chưa có loại phòng</p>
                <Button className="mt-4" onClick={() => setRoomTypeEditor({ mode: 'create' })}><Plus /> Thêm loại phòng</Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Loại phòng</TableHead>
                    <TableHead>Giá cơ sở / đêm</TableHead>
                    <TableHead>Sức chứa</TableHead>
                    <TableHead>Số phòng</TableHead>
                    <TableHead className="text-right">Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roomTypes.map((roomType) => (
                    <TableRow key={roomType.type_id}>
                      <TableCell className="font-medium">{roomType.type_name}</TableCell>
                      <TableCell className="whitespace-nowrap font-medium tabular-nums">{formatCurrency(Number(roomType.base_price))}</TableCell>
                      <TableCell className="tabular-nums">{roomType.capacity} khách</TableCell>
                      <TableCell className="tabular-nums">{Number(roomType.room_count)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" aria-label={`Sửa loại phòng ${roomType.type_name}`} onClick={() => { setActionError(''); setRoomTypeEditor({ mode: 'edit', roomType }); }}>
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-danger hover:bg-danger-muted"
                            aria-label={`Xóa loại phòng ${roomType.type_name}`}
                            title={Number(roomType.room_count) > 0 ? 'Cần xóa hoặc chuyển các phòng thuộc loại này trước' : 'Xóa loại phòng'}
                            disabled={Number(roomType.room_count) > 0}
                            onClick={() => { setActionError(''); setDeleteTarget({ kind: 'roomType', roomType }); }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {roomEditor && (
        <RoomEditorDialog
          key={roomEditor.mode === 'edit' ? `room-${roomEditor.room.room_id}` : 'new-room'}
          editor={roomEditor}
          roomTypes={roomTypes}
          saving={saving}
          error={actionError}
          onClose={() => setRoomEditor(null)}
          onSubmit={submitRoom}
        />
      )}
      {roomTypeEditor && (
        <RoomTypeEditorDialog
          key={roomTypeEditor.mode === 'edit' ? `type-${roomTypeEditor.roomType.type_id}` : 'new-type'}
          editor={roomTypeEditor}
          saving={saving}
          error={actionError}
          onClose={() => setRoomTypeEditor(null)}
          onSubmit={submitRoomType}
        />
      )}
      {deleteTarget && (
        <Dialog
          open
          onClose={saving ? () => undefined : () => setDeleteTarget(null)}
          title={deleteTarget.kind === 'room' ? `Xóa phòng ${deleteTarget.room.room_number}?` : `Xóa ${deleteTarget.roomType.type_name}?`}
          description="Thao tác này không thể hoàn tác."
          footer={
            <>
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={saving}>Giữ lại</Button>
              <Button variant="danger" onClick={() => void confirmDelete()} disabled={saving}>
                {saving ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                Xác nhận xóa
              </Button>
            </>
          }
        >
          {actionError && <p className="mb-3 rounded-md bg-danger-muted px-3 py-2 text-danger" role="alert">{actionError}</p>}
          <p className="leading-6 text-muted-foreground">
            {deleteTarget.kind === 'room'
              ? 'Phòng có lịch sử đặt chỗ có thể được máy chủ từ chối xóa để bảo toàn dữ liệu. Khi đó, hãy chuyển phòng sang trạng thái Bảo trì.'
              : 'Chỉ loại phòng không còn phòng vật lý và dữ liệu liên quan mới có thể xóa an toàn.'}
          </p>
        </Dialog>
      )}
    </PageContainer>
  );
}
