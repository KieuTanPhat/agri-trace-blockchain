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
  isSessionRestoring,
  login as loginRequest,
  readSession,
  restoreSession,
  revokeSession,
  startSessionSynchronization,
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
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.removeItem(IOT_READING_STORAGE_KEY);
      localStorage.removeItem("agri-traceability:iot-readings:v2");
    } catch {
      // Login remains available when optional browser storage is disabled.
    }
    const sync = () => {
      if (!active) return;
      setUser(readSession()?.user ?? null);
      setIsLoading(isSessionRestoring());
    };
    window.addEventListener("auth-changed", sync);
    const stopSynchronization = startSessionSynchronization();
    void restoreSession()
      .catch(() => undefined)
      .finally(sync);
    return () => {
      active = false;
      stopSynchronization();
      window.removeEventListener("auth-changed", sync);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await loginRequest(email, password);
  }, []);

  const logout = useCallback(async () => {
    await revokeSession();
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
