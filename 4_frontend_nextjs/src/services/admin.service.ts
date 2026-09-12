import { apiBaseUrl } from '@/services/axiosClient';
import { clearSession } from '@/services/auth.service';
import {
  CoreApiError,
  CoreApiErrorMetadata,
  CoreApiSuccessMetadata,
  invalidCoreResponseError,
  parseCoreResponse,
} from '@/services/core-api';
import type {
  AdminBooking,
  AdminBookingPage,
  AdminBookingStatus,
  AdminDashboard,
  AdminHousekeepingMutation,
  AdminHousekeepingPage,
  AdminHousekeepingQueueItem,
  AdminPaymentPage,
  AdminPaymentTransaction,
  AdminUser,
  AdminUserAudit,
  AdminUserAuditPage,
  AdminUserPage,
  AdminUserRole,
  AdminUserStatus,
  AdminRoom,
  AdminRoomReassignment,
  AdminRoomType,
  CreateRoomInput,
  ExecuteUpgradeInput,
  HousekeepingStatus,
  PricingLog,
  PricingLogPage,
  PricingSettings,
  PaymentMutationResult,
  RecordPaymentInput,
  ReassignRoomInput,
  RefundPaymentInput,
  RoomTypeInput,
  SmartUpgradeRecommendation,
  UpdateHousekeepingStatusInput,
  UpdateRoomInput,
} from '@/types/admin.type';
import type { BookingFinancialStatus, BookingPaymentSummary, BookingSummary, PaymentMethod, PaymentTransactionType } from '@/types/booking.type';
import type { User } from '@/types/user.type';

export const ADMIN_ACCESS_DENIED_EVENT = 'hotelai:admin-access-denied';

function handleAuthorizationFailure(status: number): void {
  if (typeof window === 'undefined') return;
  if (status === 401) {
    clearSession();
  } else if (status === 403) {
    window.dispatchEvent(new Event(ADMIN_ACCESS_DENIED_EVENT));
  }
}

interface DataResponse<T> extends CoreApiSuccessMetadata {
  data: T;
}

interface ListResponse<T> extends CoreApiSuccessMetadata {
  data: T[];
  count?: number;
  total?: number;
  limit?: number;
  offset?: number;
}

export class AdminApiError extends CoreApiError {
  constructor(message: string, status: number, metadata: CoreApiErrorMetadata = {}) {
    super(message, status, metadata);
    this.name = 'AdminApiError';
  }
}

const createAdminError = (
  message: string,
  status: number,
  metadata: CoreApiErrorMetadata,
) => new AdminApiError(message, status, metadata);

export async function getCurrentUser(_sessionMarker: string): Promise<User> {
  const response = await fetch(`${apiBaseUrl}/auth/me`, {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) handleAuthorizationFailure(response.status);
  const payload = await parseCoreResponse<User & CoreApiSuccessMetadata>(response, {
    fallbackMessage: getFallbackMessage(response.status),
    createError: createAdminError,
  });
  if (!payload || typeof payload.id !== 'string' || typeof payload.role !== 'string') {
    throw invalidCoreResponseError(
      response,
      'Máy chủ trả về thông tin tài khoản không hợp lệ.',
      payload,
      createAdminError,
    );
  }
  return payload;
}

function getFallbackMessage(status: number): string {
  if (status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  if (status === 403) return 'Tài khoản không có quyền thực hiện thao tác này.';
  return 'Không thể kết nối với máy chủ. Vui lòng thử lại.';
}

async function adminRequest<T>(
  path: string,
  _sessionMarker: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${apiBaseUrl}/admin${path}`, {
    ...init,
    headers,
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) handleAuthorizationFailure(response.status);
  const payload = await parseCoreResponse<T>(response, {
    fallbackMessage: getFallbackMessage(response.status),
    invalidResponseMessage: 'Máy chủ trả về dữ liệu không hợp lệ.',
    allowEmpty: true,
    createError: createAdminError,
  });
  return payload ?? ({} as T);
}

async function authenticatedRequest<T>(
  path: string,
  _sessionMarker: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) handleAuthorizationFailure(response.status);
  const payload = await parseCoreResponse<T>(response, {
    fallbackMessage: getFallbackMessage(response.status),
    invalidResponseMessage: 'Máy chủ trả về dữ liệu không hợp lệ.',
    allowEmpty: true,
    createError: createAdminError,
  });
  return payload ?? ({} as T);
}

export async function getAdminRooms(accessToken: string): Promise<AdminRoom[]> {
  const response = await adminRequest<ListResponse<AdminRoom>>('/rooms', accessToken);
  return response.data;
}

export async function createAdminRoom(
  accessToken: string,
  input: CreateRoomInput,
): Promise<AdminRoom> {
  const response = await adminRequest<DataResponse<AdminRoom>>('/rooms', accessToken, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function updateAdminRoom(
  accessToken: string,
  roomId: number,
  input: UpdateRoomInput,
): Promise<AdminRoom> {
  const response = await adminRequest<DataResponse<AdminRoom>>(`/rooms/${roomId}`, accessToken, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function deleteAdminRoom(accessToken: string, roomId: number): Promise<void> {
  await adminRequest<unknown>(`/rooms/${roomId}`, accessToken, { method: 'DELETE' });
}

export interface GetAdminHousekeepingInput {
  limit?: number;
  offset?: number;
  status?: HousekeepingStatus | '';
  signal?: AbortSignal;
}

export async function getAdminHousekeeping(
  accessToken: string,
  input: GetAdminHousekeepingInput = {},
): Promise<AdminHousekeepingPage> {
  const limit = input.limit ?? 20;
  const offset = input.offset ?? 0;
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (input.status) params.set('status', input.status);
  const response = await adminRequest<ListResponse<AdminHousekeepingQueueItem>>(
    `/housekeeping?${params.toString()}`,
    accessToken,
    { signal: input.signal },
  );
  return {
    items: response.data,
    total: response.total ?? response.count ?? response.data.length,
    limit: response.limit ?? limit,
    offset: response.offset ?? offset,
  };
}

export async function updateAdminHousekeepingStatus(
  accessToken: string,
  roomId: number,
  input: UpdateHousekeepingStatusInput,
  idempotencyKey: string,
): Promise<AdminHousekeepingMutation> {
  const response = await adminRequest<DataResponse<AdminHousekeepingMutation>>(
    `/rooms/${roomId}/housekeeping`,
    accessToken,
    {
      method: 'PATCH',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function getAdminUpgradeRecommendations(
  accessToken: string,
): Promise<SmartUpgradeRecommendation[]> {
  const response = await adminRequest<ListResponse<SmartUpgradeRecommendation>>(
    '/allocations/upgrade-recommendations',
    accessToken,
  );
  return response.data;
}

export async function executeAdminUpgrade(
  accessToken: string,
  input: ExecuteUpgradeInput,
  idempotencyKey: string,
): Promise<AdminRoomReassignment> {
  const response = await adminRequest<DataResponse<AdminRoomReassignment>>(
    '/allocations/execute-upgrade',
    accessToken,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function getAdminRoomTypes(accessToken: string): Promise<AdminRoomType[]> {
  const response = await adminRequest<ListResponse<AdminRoomType>>('/room-types', accessToken);
  return response.data;
}

export async function createAdminRoomType(
  accessToken: string,
  input: RoomTypeInput,
): Promise<AdminRoomType> {
  const response = await adminRequest<DataResponse<AdminRoomType>>('/room-types', accessToken, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function updateAdminRoomType(
  accessToken: string,
  typeId: number,
  input: RoomTypeInput,
): Promise<AdminRoomType> {
  const response = await adminRequest<DataResponse<AdminRoomType>>(
    `/room-types/${typeId}`,
    accessToken,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function deleteAdminRoomType(accessToken: string, typeId: number): Promise<void> {
  await adminRequest<unknown>(`/room-types/${typeId}`, accessToken, { method: 'DELETE' });
}

export async function getPricingSettings(accessToken: string): Promise<PricingSettings> {
  const response = await adminRequest<DataResponse<PricingSettings>>('/pricing/settings', accessToken);
  return response.data;
}

export async function updatePricingSettings(
  accessToken: string,
  aiEnabled: boolean,
  expectedVersion: number,
): Promise<PricingSettings> {
  const response = await adminRequest<DataResponse<PricingSettings>>(
    '/pricing/settings',
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify({
        ai_enabled: aiEnabled,
        expected_version: expectedVersion,
      }),
    },
  );
  return response.data;
}

export async function getPricingLogs(
  accessToken: string,
  limit = 50,
  offset = 0,
): Promise<PricingLogPage> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const response = await adminRequest<ListResponse<PricingLog>>(
    `/pricing/logs?${params.toString()}`,
    accessToken,
  );
  return {
    items: response.data,
    total: response.total ?? response.count ?? response.data.length,
    limit: response.limit ?? limit,
    offset: response.offset ?? offset,
  };
}

export async function getAdminDashboard(
  accessToken: string,
  months = 6,
): Promise<AdminDashboard> {
  const params = new URLSearchParams({ months: String(months) });
  const response = await adminRequest<DataResponse<AdminDashboard>>(
    `/dashboard?${params.toString()}`,
    accessToken,
  );
  return response.data;
}

export interface GetAdminBookingsInput {
  limit?: number;
  offset?: number;
  status?: AdminBookingStatus | '';
  search?: string;
  signal?: AbortSignal;
}

export async function getAdminBookings(
  accessToken: string,
  input: GetAdminBookingsInput = {},
): Promise<AdminBookingPage> {
  const limit = input.limit ?? 20;
  const offset = input.offset ?? 0;
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (input.status) params.set('status', input.status);
  if (input.search?.trim()) params.set('search', input.search.trim());

  const response = await adminRequest<ListResponse<AdminBooking>>(
    `/bookings?${params.toString()}`,
    accessToken,
    { signal: input.signal },
  );
  return {
    items: response.data,
    total: response.total ?? response.count ?? response.data.length,
    limit: response.limit ?? limit,
    offset: response.offset ?? offset,
  };
}

export async function markAdminBookingNoShow(
  accessToken: string,
  bookingId: string,
  input: { expected_version: number; reason: string },
  idempotencyKey: string,
): Promise<{ replayed: boolean; booking: BookingFinancialStatus }> {
  const response = await adminRequest<DataResponse<{ replayed: boolean; booking: BookingFinancialStatus }>>(
    `/bookings/${encodeURIComponent(bookingId)}/no-show`,
    accessToken,
    { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(input) },
  );
  return response.data;
}

export async function getAdminBookingPayment(
  accessToken: string,
  bookingId: string,
): Promise<BookingPaymentSummary> {
  const response = await authenticatedRequest<DataResponse<BookingPaymentSummary>>(
    `/bookings/${encodeURIComponent(bookingId)}/payment`,
    accessToken,
  );
  if (!response.data) throw new AdminApiError('Không thể tải trạng thái thanh toán hiện tại.', 502);
  return response.data;
}

export async function checkInAdminBooking(
  accessToken: string,
  bookingId: string,
): Promise<AdminBooking> {
  const response = await adminRequest<DataResponse<AdminBooking>>(
    `/bookings/${encodeURIComponent(bookingId)}/check-in`,
    accessToken,
    { method: 'PATCH' },
  );
  return response.data;
}

export async function checkOutAdminBooking(
  accessToken: string,
  bookingId: string,
): Promise<AdminBooking> {
  const response = await adminRequest<DataResponse<AdminBooking>>(
    `/bookings/${encodeURIComponent(bookingId)}/check-out`,
    accessToken,
    { method: 'PATCH' },
  );
  return response.data;
}

export async function reassignAdminBookingRoom(
  accessToken: string,
  bookingId: string,
  input: ReassignRoomInput,
  idempotencyKey: string,
): Promise<AdminRoomReassignment> {
  const response = await adminRequest<DataResponse<AdminRoomReassignment>>(
    `/bookings/${encodeURIComponent(bookingId)}/reassign-room`,
    accessToken,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function cancelAdminBooking(
  accessToken: string,
  bookingId: string,
): Promise<BookingSummary | null> {
  const response = await authenticatedRequest<DataResponse<BookingSummary> | Record<string, never>>(
    `/bookings/${encodeURIComponent(bookingId)}/cancel`,
    accessToken,
    { method: 'PATCH' },
  );
  return 'data' in response ? response.data : null;
}

export interface GetAdminPaymentsInput {
  limit?: number;
  offset?: number;
  transaction_type?: PaymentTransactionType | '';
  method?: PaymentMethod | '';
  search?: string;
  signal?: AbortSignal;
}

export async function getAdminPayments(
  accessToken: string,
  input: GetAdminPaymentsInput = {},
): Promise<AdminPaymentPage> {
  const limit = input.limit ?? 20;
  const offset = input.offset ?? 0;
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (input.transaction_type) params.set('transaction_type', input.transaction_type);
  if (input.method) params.set('method', input.method);
  if (input.search?.trim()) params.set('search', input.search.trim());
  const response = await adminRequest<ListResponse<AdminPaymentTransaction>>(
    `/payments?${params.toString()}`,
    accessToken,
    { signal: input.signal },
  );
  return {
    items: response.data,
    total: response.total ?? response.count ?? response.data.length,
    limit: response.limit ?? limit,
    offset: response.offset ?? offset,
  };
}

export async function recordAdminPayment(
  accessToken: string,
  bookingId: string,
  input: RecordPaymentInput,
): Promise<PaymentMutationResult> {
  const response = await adminRequest<DataResponse<PaymentMutationResult>>(
    `/bookings/${encodeURIComponent(bookingId)}/payments`,
    accessToken,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function refundAdminPayment(
  accessToken: string,
  paymentId: string,
  input: RefundPaymentInput,
): Promise<PaymentMutationResult> {
  const response = await adminRequest<DataResponse<PaymentMutationResult>>(
    `/payments/${encodeURIComponent(paymentId)}/refunds`,
    accessToken,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.data;
}

export interface GetAdminUsersInput {
  limit?: number;
  offset?: number;
  role?: AdminUserRole | '';
  status?: AdminUserStatus | '';
  search?: string;
  signal?: AbortSignal;
}

export async function getAdminUsers(
  accessToken: string,
  input: GetAdminUsersInput = {},
): Promise<AdminUserPage> {
  const limit = input.limit ?? 20;
  const offset = input.offset ?? 0;
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (input.role) params.set('role', input.role);
  if (input.status) params.set('status', input.status);
  if (input.search?.trim()) params.set('search', input.search.trim());
  const response = await adminRequest<ListResponse<AdminUser>>(
    `/users?${params.toString()}`,
    accessToken,
    { signal: input.signal },
  );
  return {
    items: response.data,
    total: response.total ?? response.count ?? response.data.length,
    limit: response.limit ?? limit,
    offset: response.offset ?? offset,
  };
}

export async function updateAdminUser(
  accessToken: string,
  customerId: string,
  input: {
    role: AdminUserRole;
    account_status: Exclude<AdminUserStatus, 'Deactivated'>;
    expected_version: number;
  },
): Promise<AdminUser> {
  const response = await adminRequest<DataResponse<AdminUser>>(
    `/users/${encodeURIComponent(customerId)}`,
    accessToken,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function getAdminUserAudits(
  accessToken: string,
  customerId: string,
  limit = 50,
  offset = 0,
): Promise<AdminUserAuditPage> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const response = await adminRequest<ListResponse<AdminUserAudit>>(
    `/users/${encodeURIComponent(customerId)}/audits?${params.toString()}`,
    accessToken,
  );
  return {
    items: response.data,
    total: response.total ?? response.count ?? response.data.length,
    limit: response.limit ?? limit,
    offset: response.offset ?? offset,
  };
}
