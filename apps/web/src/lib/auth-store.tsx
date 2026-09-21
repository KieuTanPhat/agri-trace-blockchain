"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  AUTH_STORAGE_KEY,
  getProfile,
  login as loginRequest,
  revokeSession,
} from "./api-client";
import type { AuthUser } from "./types";

type StoredAuth = {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
  user: AuthUser;
};
type AuthStore = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): void;
};

const AuthContext = createContext<AuthStore | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      setIsLoading(false);
      return;
    }
    try {
      const stored = JSON.parse(raw) as StoredAuth;
      if (!stored.accessToken || !stored.refreshToken)
        throw new Error("missing token");
      setAuth(stored);
      getProfile()
        .then((user) => {
          if (!active) return;
          const refreshed = { ...stored, user };
          localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(refreshed));
          setAuth(refreshed);
        })
        .catch(() => {
          if (!active) return;
          localStorage.removeItem(AUTH_STORAGE_KEY);
          setAuth(null);
        })
        .finally(() => {
          if (active) setIsLoading(false);
        });
    } catch {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      setIsLoading(false);
    }
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await loginRequest(email, password);
    const next = {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      refreshExpiresAt: response.refreshExpiresAt,
      user: response.user,
    };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next));
    setAuth(next);
  }, []);

  const logout = useCallback(() => {
    void revokeSession();
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setAuth(null);
  }, []);

  const value = useMemo<AuthStore>(
    () => ({
      user: auth?.user ?? null,
      isAuthenticated: Boolean(auth),
      isLoading,
      login,
      logout,
    }),
    [auth, isLoading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
