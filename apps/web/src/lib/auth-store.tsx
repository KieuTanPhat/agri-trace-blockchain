"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  AUTH_STORAGE_KEY,
  clearSession,
  login as loginRequest,
  readSession,
  restoreSession,
  revokeSession,
} from "./api-client";
import type { AuthUser } from "./types";
import { IOT_READING_STORAGE_KEY } from "./iot-local-store";

type AuthStore = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
};

const AuthContext = createContext<AuthStore | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    // Remove tokens saved by older releases. The new session is memory-only.
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(IOT_READING_STORAGE_KEY);
    const sync = () => setUser(readSession()?.user ?? null);
    window.addEventListener("auth-changed", sync);
    restoreSession()
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          sync();
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
      window.removeEventListener("auth-changed", sync);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const previous = readSession()?.user;
    await loginRequest(email, password);
    if (previous) {
      localStorage.removeItem(
        `${IOT_READING_STORAGE_KEY}:${previous.id}:${previous.organizationId ?? "system"}`,
      );
    }
  }, []);

  const logout = useCallback(async () => {
    await revokeSession();
    const current = readSession()?.user;
    if (current) {
      localStorage.removeItem(
        `${IOT_READING_STORAGE_KEY}:${current.id}:${current.organizationId ?? "system"}`,
      );
    }
    clearSession();
  }, []);

  const value = useMemo<AuthStore>(
    () => ({ user, isAuthenticated: Boolean(user), isLoading, login, logout }),
    [user, isLoading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
