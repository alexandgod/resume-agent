/**
 * 全局登录态：React Context + localStorage('ra_token')，不引入状态库。
 * 刷新时调用 /api/auth/me 恢复登录态；401 由 apiFetch 统一清 token 并回跳登录页。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiFetch, clearToken, getToken, setToken } from '../api/client';
import type { User } from '../types';

export type AuthStatus = 'loading' | 'guest' | 'authed';

export interface AuthContextValue {
  user: User | null;
  token: string | null;
  status: AuthStatus;
  login: (user: User, token: string) => void;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [status, setStatus] = useState<AuthStatus>(() => (getToken() ? 'loading' : 'guest'));

  const markGuest = useCallback(() => {
    clearToken();
    setTokenState(null);
    setUser(null);
    setStatus('guest');
  }, []);

  const refreshMe = useCallback(async () => {
    const current = getToken();
    if (!current) {
      markGuest();
      return;
    }
    try {
      const data = await apiFetch<{ user: User }>('/auth/me');
      setUser(data.user);
      setTokenState(current);
      setStatus('authed');
    } catch {
      markGuest();
    }
  }, [markGuest]);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  const login = useCallback((nextUser: User, nextToken: string) => {
    setToken(nextToken);
    setTokenState(nextToken);
    setUser(nextUser);
    setStatus('authed');
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch<{ revoked: boolean }>('/auth/logout', { method: 'POST' });
    } catch {
      // 无论服务端是否成功，前端都必须清除本地登录态。
    }
    markGuest();
  }, [markGuest]);

  const deleteAccount = useCallback(async () => {
    await apiFetch<{ deleted: boolean }>('/auth/me', { method: 'DELETE' });
    markGuest();
  }, [markGuest]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, status, login, logout, refreshMe, deleteAccount }),
    [user, token, status, login, logout, refreshMe, deleteAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** 读取登录态；必须在 AuthProvider 内使用。 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth 必须在 AuthProvider 内使用');
  }
  return context;
}
