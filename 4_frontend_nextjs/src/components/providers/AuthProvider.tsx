'use client';

import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AUTH_SESSION_EVENT,
  clearSession,
  getCurrentSession,
  login as loginRequest,
  logoutRequest,
  register as registerRequest,
} from '@/services/auth.service';
import { AuthSession, LoginInput, RegisterInput } from '@/types/user.type';

export interface AuthContextValue {
  session: AuthSession | null;
  user: AuthSession['user'] | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  ready: boolean;
  login: (input: LoginInput) => Promise<AuthSession>;
  register: (input: RegisterInput) => Promise<AuthSession>;
  refreshSession: () => Promise<AuthSession | null>;
  logout: () => Promise<void>;
  loggingOut: boolean;
  logoutError: string;
  invalidateSession: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [ready, setReady] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const sessionVersion = useRef(0);
  const logoutInFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let active = true;
    const version = sessionVersion.current;
    void getCurrentSession()
      .then((currentSession) => {
        if (active && version === sessionVersion.current) setSession(currentSession);
      })
      .catch(() => {
        if (active && version === sessionVersion.current) setSession(null);
      })
      .finally(() => {
        if (active) setReady(true);
      });

    const handleSessionCleared = () => {
      sessionVersion.current += 1;
      setSession(null);
    };
    window.addEventListener(AUTH_SESSION_EVENT, handleSessionCleared);
    return () => {
      active = false;
      window.removeEventListener(AUTH_SESSION_EVENT, handleSessionCleared);
    };
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const version = ++sessionVersion.current;
    const nextSession = await loginRequest(input);
    if (version === sessionVersion.current) setSession(nextSession);
    setLogoutError('');
    return nextSession;
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const version = ++sessionVersion.current;
    const nextSession = await registerRequest(input);
    if (version === sessionVersion.current) setSession(nextSession);
    setLogoutError('');
    return nextSession;
  }, []);

  const refreshSession = useCallback(async () => {
    const version = ++sessionVersion.current;
    const currentSession = await getCurrentSession();
    if (version === sessionVersion.current) setSession(currentSession);
    return currentSession;
  }, []);

  const invalidateSession = useCallback(() => {
    sessionVersion.current += 1;
    setSession(null);
    setLogoutError('');
    clearSession();
  }, []);

  const logout = useCallback(() => {
    if (logoutInFlight.current) return logoutInFlight.current;
    setLoggingOut(true);
    setLogoutError('');
    const request = logoutRequest()
      .then(invalidateSession)
      .catch((caught: unknown) => {
        setLogoutError('Đăng xuất chưa thành công. Vui lòng thử lại.');
        throw caught;
      })
      .finally(() => {
        logoutInFlight.current = null;
        setLoggingOut(false);
      });
    logoutInFlight.current = request;
    return request;
  }, [invalidateSession]);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    accessToken: session?.accessToken ?? null,
    isAuthenticated: Boolean(session),
    ready,
    login,
    register,
    refreshSession,
    logout,
    loggingOut,
    logoutError,
    invalidateSession,
  }), [invalidateSession, login, loggingOut, logout, logoutError, ready, refreshSession, register, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
