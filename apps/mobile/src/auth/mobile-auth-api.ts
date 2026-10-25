import type { components } from "../api/generated/api";
import type { ConsumerProfile, RegistrationInput } from "./types";
import { SessionFailure, type NativeSession } from "./native-session";

type MobileLogin = components["schemas"]["MobileLoginDto"];
type MobileRegistration = components["schemas"]["MobileRegisterDto"];
type MobileReset = components["schemas"]["MobileResetDto"];
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const bounded = (value: unknown, max: number) =>
  typeof value === "string" && value.length > 0 && value.length <= max;
export function isConsumerProfile(value: unknown): value is ConsumerProfile {
  if (!object(value)) return false;
  return (
    typeof value.id === "string" &&
    /^[0-9a-f-]{36}$/i.test(value.id) &&
    bounded(value.fullName, 255) &&
    typeof value.phone === "string" &&
    /^\+84\d{9}$/.test(value.phone) &&
    bounded(value.province, 255) &&
    bounded(value.ward, 255) &&
    ["contactEmail", "businessAddress"].every(
      (key) => value[key] === undefined || bounded(value[key], 255),
    ) &&
    Object.keys(value).every((key) =>
      [
        "id",
        "fullName",
        "phone",
        "province",
        "ward",
        "contactEmail",
        "businessAddress",
      ].includes(key),
    )
  );
}
export function createMobileAuthApi(
  base: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 12_000,
) {
  // Caller passes apiBaseUrl(): HTTPS in release; only explicit local HTTP in dev.
  const url = new URL(base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Địa chỉ API chưa hợp lệ.");
  let blockedUntil = 0;
  async function request(
    path: string,
    body?: unknown,
    accessToken?: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (blockedUntil > Date.now()) throw new SessionFailure("rejected", 429);
    if (signal?.aborted) throw new SessionFailure("offline");
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, timeoutMs);
    try {
      const response = await fetcher(`${base}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (response.redirected) throw new SessionFailure("uncertain");
      if (!response.ok) {
        if (response.status === 429) {
          const seconds = Number(response.headers.get("retry-after"));
          blockedUntil =
            Date.now() +
            (Number.isFinite(seconds) && seconds > 0
              ? Math.min(seconds, 3600)
              : 60) *
              1000;
        }
        throw new SessionFailure(
          response.status < 500 ? "rejected" : "uncertain",
          response.status,
        );
      }
      const reader = response.body?.getReader();
      let text = "";
      if (reader) {
        const decoder = new TextDecoder();
        let size = 0;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 65536) {
            await reader.cancel();
            throw new SessionFailure("uncertain");
          }
          text += decoder.decode(part.value, { stream: true });
        }
        text += decoder.decode();
      } else {
        text = await response.text();
        if (text.length > 65536) throw new SessionFailure("uncertain");
      }
      const envelope: unknown = JSON.parse(text);
      if (
        !object(envelope) ||
        envelope.success !== true ||
        !object(envelope.data)
      )
        throw new SessionFailure("uncertain");
      return envelope.data;
    } catch (error) {
      if (error instanceof SessionFailure) throw error;
      // Once dispatched, failure may mean commit with lost response. Never retry.
      throw new SessionFailure("uncertain");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
  async function session(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<NativeSession> {
    const value = await request(path, body, undefined, signal);
    if (
      !object(value) ||
      value.tokenType !== "Bearer" ||
      !bounded(value.sessionId, 128) ||
      !bounded(value.accessToken, 16384) ||
      !bounded(value.refreshToken, 1024) ||
      typeof value.refreshExpiresAt !== "string" ||
      !Number.isFinite(Date.parse(value.refreshExpiresAt)) ||
      !isConsumerProfile(value.user)
    )
      throw new SessionFailure("uncertain");
    return {
      sessionId: value.sessionId as string,
      accessToken: value.accessToken as string,
      refreshToken: value.refreshToken as string,
      refreshExpiresAt: value.refreshExpiresAt,
    };
  }
  return {
    login(input: MobileLogin, signal?: AbortSignal) {
      return session("/auth/mobile/login", input, signal);
    },
    register(input: RegistrationInput, signal?: AbortSignal) {
      const { phoneProof, ...draft } = input;
      const body: MobileRegistration = {
        ...draft,
        firebaseIdToken: phoneProof,
      };
      return session("/auth/mobile/register", body, signal);
    },
    async reset(input: MobileReset, signal?: AbortSignal) {
      const data = await request(
        "/auth/mobile/password-reset",
        input,
        undefined,
        signal,
      );
      if (!object(data) || data.reset !== true)
        throw new SessionFailure("uncertain");
    },
    refresh(token: string) {
      return session("/auth/mobile/refresh", { refreshToken: token });
    },
    async revoke(token: string) {
      const data = await request("/auth/mobile/logout", {
        refreshToken: token,
      });
      if (!object(data) || data.revoked !== true)
        throw new SessionFailure("uncertain");
    },
    async me(token: string): Promise<ConsumerProfile> {
      const data = await request("/consumer/me", undefined, token);
      if (!isConsumerProfile(data)) throw new SessionFailure("uncertain");
      return data;
    },
  };
}
