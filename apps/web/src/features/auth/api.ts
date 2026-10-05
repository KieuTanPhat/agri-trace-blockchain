import { request } from "@/shared/api/http-client";
import type { AuthUser, LoginResponse } from "@/shared/types/domain";
export { AUTH_STORAGE_KEY, revokeSession } from "@/shared/api/http-client";

export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  return request(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
    false,
  );
}

export async function getProfile(): Promise<AuthUser> {
  return request("/auth/me");
}
