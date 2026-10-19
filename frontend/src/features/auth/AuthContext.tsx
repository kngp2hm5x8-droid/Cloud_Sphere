import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import axios from 'axios';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, ensureCsrf, getData, postData, setUnauthorizedHandler } from '@/lib/api-client';
import type { User } from '@/types/api';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'unavailable';

interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Session restoration on page load / refresh.
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    getData<User>('/auth/me', undefined, controller.signal)
      .then((me) => {
        setUser(me);
        setError(null);
        setStatus('authenticated');
      })
      .catch((e: unknown) => {
        if (axios.isCancel(e)) return;
        if (e instanceof ApiError && e.isNetworkError) {
          setError(e.message);
          setStatus('unavailable');
        } else {
          setUser(null);
          setStatus('anonymous');
        }
      });
    return () => controller.abort();
  }, [attempt]);

  // Any 401 from a non-auth call means the session expired.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setStatus('anonymous');
      queryClient.clear();
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  const login = useCallback(async (email: string, password: string) => {
    await ensureCsrf();
    const me = await postData<User>('/auth/login', { email, password });
    setUser(me);
    setError(null);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await postData<unknown>('/auth/logout');
    } finally {
      setUser(null);
      setStatus('anonymous');
      queryClient.clear();
    }
  }, [queryClient]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo(() => ({ user, status, error, login, logout, retry }), [user, status, error, login, logout, retry]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
