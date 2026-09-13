"use client";

import { createContext, useContext, useMemo } from "react";
import type { Role } from "./types";

type AuthUser = {
  userId: string;
  organizationId: string;
  organizationName: string;
  role: Role;
};

type AuthStore = {
  user: AuthUser;
  isAuthenticated: boolean;
};

const AuthContext = createContext<AuthStore | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<AuthStore>(
    () => ({
      isAuthenticated: true,
      user: {
        userId: "user-farm-01",
        organizationId: "org-farm-01",
        organizationName: "HTX Rau Sạch Củ Chi",
        role: "FARM_STAFF"
      }
    }),
    []
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
