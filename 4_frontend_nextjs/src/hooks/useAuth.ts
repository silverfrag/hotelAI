'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AUTH_SESSION_EVENT,
  clearSession,
  getStoredSession,
  login as loginRequest,
  register as registerRequest,
  storeSession,
} from '@/services/auth.service';
import { AuthSession, LoginInput, RegisterInput } from '@/types/user.type';

export function useAuth() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const syncSession = () => setSession(getStoredSession());
    syncSession();
    setReady(true);
    window.addEventListener('storage', syncSession);
    window.addEventListener(AUTH_SESSION_EVENT, syncSession);

    return () => {
      window.removeEventListener('storage', syncSession);
      window.removeEventListener(AUTH_SESSION_EVENT, syncSession);
    };
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const nextSession = await loginRequest(input);
    storeSession(nextSession);
    setSession(nextSession);
    return nextSession;
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const nextSession = await registerRequest(input);
    storeSession(nextSession);
    setSession(nextSession);
    return nextSession;
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  return {
    session,
    user: session?.user ?? null,
    accessToken: session?.accessToken ?? null,
    isAuthenticated: Boolean(session),
    ready,
    login,
    register,
    logout,
  };
}
