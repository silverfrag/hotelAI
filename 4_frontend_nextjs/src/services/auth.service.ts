import { apiBaseUrl } from '@/services/axiosClient';
import { AuthSession, LoginInput, RegisterInput, User } from '@/types/user.type';

const AUTH_STORAGE_KEY = 'hotelai.auth';
export const AUTH_SESSION_EVENT = 'hotelai:auth-session';

interface AuthApiResponse {
  access_token: string;
  user: User;
}

interface ApiErrorResponse {
  message?: string | string[];
  error?: string;
}

function isUser(value: unknown): value is User {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<User>;
  return typeof user.id === 'string'
    && typeof user.full_name === 'string'
    && typeof user.email === 'string'
    && typeof user.role === 'string';
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<AuthSession>;
  return typeof session.accessToken === 'string'
    && session.accessToken.length > 0
    && isUser(session.user);
}

function errorMessage(payload: ApiErrorResponse | null, fallback: string): string {
  if (Array.isArray(payload?.message)) return payload.message.join(' ');
  return payload?.message ?? payload?.error ?? fallback;
}

async function authenticate(
  path: 'login' | 'register',
  input: LoginInput | RegisterInput,
): Promise<AuthSession> {
  const response = await fetch(`${apiBaseUrl}/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => null) as (AuthApiResponse & ApiErrorResponse) | null;

  if (!response.ok || !payload?.access_token || !isUser(payload.user)) {
    throw new Error(errorMessage(payload, 'Không thể xác thực tài khoản.'));
  }

  return { accessToken: payload.access_token, user: payload.user };
}

export function login(input: LoginInput): Promise<AuthSession> {
  return authenticate('login', input);
}

export function register(input: RegisterInput): Promise<AuthSession> {
  return authenticate('register', input);
}

export function getStoredSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;

  try {
    const rawSession = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!rawSession) return null;
    const session: unknown = JSON.parse(rawSession);
    if (isAuthSession(session)) return session;
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  }

  return null;
}

export function storeSession(session: AuthSession): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
  window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
}
