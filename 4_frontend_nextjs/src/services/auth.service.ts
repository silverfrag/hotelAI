import { apiBaseUrl } from '@/services/axiosClient';
import {
  CoreApiSuccessMetadata,
  invalidCoreResponseError,
  parseCoreResponse,
} from '@/services/core-api';
import { AuthSession, LoginInput, RegisterInput, User } from '@/types/user.type';

const LEGACY_AUTH_STORAGE_KEY = 'hotelai.auth';
export const AUTH_SESSION_EVENT = 'hotelai:auth-session-cleared';

interface AuthApiResponse extends CoreApiSuccessMetadata {
  user: User;
}

function isUser(value: unknown): value is User {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<User>;
  return typeof user.id === 'string'
    && typeof user.full_name === 'string'
    && typeof user.email === 'string'
    && (user.phone === null || typeof user.phone === 'string')
    && (user.nationality === null || typeof user.nationality === 'string')
    && (user.role === 'customer' || user.role === 'admin')
    && (user.account_status === 'Active'
      || user.account_status === 'Suspended'
      || user.account_status === 'Deactivated')
    && typeof user.version === 'number';
}

async function authenticate(
  path: 'login' | 'register',
  input: LoginInput | RegisterInput,
): Promise<AuthSession> {
  const response = await fetch(`${apiBaseUrl}/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    credentials: 'include',
  });
  const payload = await parseCoreResponse<AuthApiResponse>(response, {
    fallbackMessage: 'Không thể xác thực tài khoản.',
  });

  if (!payload || !isUser(payload.user)) {
    throw invalidCoreResponseError(
      response,
      'Máy chủ trả về thông tin tài khoản không hợp lệ.',
      payload,
    );
  }

  // This is a non-secret compatibility marker for existing feature hooks.
  // The actual JWT lives only in the backend-issued HttpOnly cookie.
  return { accessToken: 'cookie-session', user: payload.user };
}

export function login(input: LoginInput): Promise<AuthSession> {
  return authenticate('login', input);
}

export function register(input: RegisterInput): Promise<AuthSession> {
  return authenticate('register', input);
}

export async function getCurrentSession(): Promise<AuthSession | null> {
  removeLegacyStoredToken();
  const response = await fetch(`${apiBaseUrl}/auth/me`, {
    credentials: 'include',
    cache: 'no-store',
  });
  if (response.status === 401) return null;
  const payload = await parseCoreResponse<User & CoreApiSuccessMetadata>(response, {
    fallbackMessage: 'Không thể kiểm tra phiên đăng nhập.',
  });
  if (!isUser(payload)) {
    throw invalidCoreResponseError(
      response,
      'Máy chủ trả về thông tin tài khoản không hợp lệ.',
      payload,
    );
  }
  return { accessToken: 'cookie-session', user: payload };
}

export async function logoutRequest(): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
  const payload = await parseCoreResponse<CoreApiSuccessMetadata>(response, {
    fallbackMessage: 'Không thể đăng xuất. Vui lòng thử lại.',
    allowEmpty: true,
  });
  if (response.status !== 204 && response.status !== 205 && payload?.status !== 'success') {
    throw invalidCoreResponseError(response, 'Máy chủ chưa xác nhận đăng xuất. Vui lòng thử lại.', payload);
  }
}

export function clearSession(): void {
  removeLegacyStoredToken();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
}

export function removeLegacyStoredToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
  } catch {
    // Restricted browser storage must not prevent cookie-session operations.
  }
}
