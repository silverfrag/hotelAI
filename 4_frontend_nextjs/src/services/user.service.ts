import { clearSession } from '@/services/auth.service';
import { apiBaseUrl } from '@/services/axiosClient';
import {
  CoreApiError,
  CoreApiErrorMetadata,
  CoreApiSuccessMetadata,
  parseCoreResponse,
} from '@/services/core-api';
import type { UserProfile } from '@/types/user.type';

interface DataResponse<T> extends CoreApiSuccessMetadata {
  data: T;
}

export class AccountApiError extends CoreApiError {
  constructor(message: string, status: number, metadata: CoreApiErrorMetadata = {}) {
    super(message, status, metadata);
    this.name = 'AccountApiError';
  }
}

function fallbackMessage(status: number): string {
  if (status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  if (status === 403) return 'Tài khoản hiện không được phép thực hiện thao tác này.';
  if (status === 409) return 'Dữ liệu đã thay đổi. Vui lòng tải lại và thử lại.';
  return 'Không thể kết nối với máy chủ. Vui lòng thử lại.';
}

const createAccountError = (
  message: string,
  status: number,
  metadata: CoreApiErrorMetadata,
) => new AccountApiError(message, status, metadata);

async function accountRequest<T>(
  path: string,
  init: RequestInit = {},
  allowEmpty = false,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${apiBaseUrl}/users${path}`, {
    ...init,
    headers,
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok && (response.status === 401 || response.status === 403)) clearSession();
  const payload = await parseCoreResponse<T>(response, {
    fallbackMessage: fallbackMessage(response.status),
    allowEmpty,
    createError: createAccountError,
  });
  return payload as T;
}

export async function getOwnProfile(signal?: AbortSignal): Promise<UserProfile> {
  const response = await accountRequest<DataResponse<UserProfile>>('/me', { signal });
  return response.data;
}

export async function updateOwnProfile(input: {
  full_name: string;
  phone: string | null;
  nationality: string | null;
  expected_version: number;
}): Promise<UserProfile> {
  const response = await accountRequest<DataResponse<UserProfile>>('/me', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function changeOwnPassword(input: {
  current_password: string;
  new_password: string;
}): Promise<void> {
  await accountRequest<void>('/me/password', {
    method: 'PATCH',
    body: JSON.stringify(input),
  }, true);
}

export async function deactivateOwnAccount(password: string): Promise<void> {
  await accountRequest<void>('/me/deactivate', {
    method: 'POST',
    body: JSON.stringify({ password }),
  }, true);
}
