import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { api, ApiError } from '../api/client';
import { SessionGate } from './session-gate';

/**
 * Native session for one app. Access token and profile stay in memory; the
 * refresh token lives in SecureStore. The web build is only a local preview
 * without secure storage: it keeps the token in sessionStorage, which the
 * browser drops when the tab closes.
 */
export type Audience = 'consumer' | 'staff';

type Session<U> = { sessionId: string; accessToken: string; refreshToken: string; user: U };
type State<U> = { status: 'loading' | 'anonymous' | 'signed-in'; user: U | null; scope: string };

type Ctx<U> = State<U> & {
  signIn: (path: string, body: object) => Promise<U>;
  signOut: () => Promise<void>;
  /** Authenticated call; refreshes once on 401, then signs out. */
  call: <T>(path: string, init?: { body?: unknown; form?: FormData; idempotencyKey?: string }) => Promise<T>;
};

const Context = createContext<Ctx<unknown> | null>(null);
const tab = () => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
};
const store = {
  get: async (key: string) => (Platform.OS === 'web' ? (tab()?.getItem(key) ?? null) : SecureStore.getItemAsync(key)),
  set: async (key: string, value: string) =>
    Platform.OS === 'web'
      ? void tab()?.setItem(key, value)
      : SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  delete: async (key: string) => (Platform.OS === 'web' ? void tab()?.removeItem(key) : SecureStore.deleteItemAsync(key)),
};

const ROUTES: Record<Audience, { refresh: string; logout: string }> = {
  consumer: { refresh: '/auth/mobile/refresh', logout: '/auth/mobile/logout' },
  staff: { refresh: '/auth/staff/refresh', logout: '/auth/staff/logout' },
};

export function SessionProvider<U>({ audience, children }: { audience: Audience; children: ReactNode }) {
  const key = `agritrace.${audience}.refresh`;
  const [state, setState] = useState<State<U>>({ status: 'loading', user: null, scope: `${audience}:anonymous` });
  const session = useRef<Session<U> | null>(null);
  const refreshing = useRef<Promise<Session<U> | null> | null>(null);
  const [gate] = useState(() => new SessionGate());

  const adopt = useCallback(
    async (next: Session<U>, version: number) => {
      await gate.write(async () => { if (gate.current(version)) await store.set(key, next.refreshToken); });
      if (!gate.current(version)) throw new ApiError(409, 'Phiên này đã được thay thế hoặc đăng xuất.');
      session.current = next;
      setState({ status: 'signed-in', user: next.user, scope: `${audience}:${next.sessionId}` });
      return next;
    },
    [audience, gate, key],
  );

  const clear = useCallback(async () => {
    gate.next();
    session.current = null;
    setState({ status: 'anonymous', user: null, scope: `${audience}:anonymous` });
    await gate.write(() => store.delete(key));
  }, [audience, gate, key]);

  // Single flight: concurrent 401s share one rotation instead of racing it.
  const refresh = useCallback(() => {
    refreshing.current ??= (async () => {
      const version = gate.version;
      const token = session.current?.refreshToken ?? (await store.get(key));
      if (!token || !gate.current(version)) return null;
      try {
        const next = await api<Session<U>>(ROUTES[audience].refresh, { body: { refreshToken: token } });
        if (!gate.current(version)) return null;
        return await adopt(next, version);
      } catch (error) {
        if (gate.current(version) && error instanceof ApiError && (error.status === 401 || error.status === 403)) await clear();
        return null;
      } finally {
        refreshing.current = null;
      }
    })();
    return refreshing.current;
  }, [adopt, audience, clear, gate, key]);

  useEffect(() => {
    void refresh().then((next) => {
      if (!next) setState((s) => (s.status === 'loading' ? { status: 'anonymous', user: null, scope: `${audience}:anonymous` } : s));
    });
  }, [audience, refresh]);

  const value = useMemo<Ctx<U>>(
    () => ({
      ...state,
      async signIn(path, body) {
        const version = gate.next();
        const previousRefreshToken = session.current?.refreshToken ?? (await store.get(key)) ?? undefined;
        const next = await api<Session<U>>(path, { body: { ...body, ...(previousRefreshToken && path.endsWith('/login') ? { previousRefreshToken } : {}) } });
        await adopt(next, version);
        return next.user;
      },
      async signOut() {
        const token = session.current?.refreshToken ?? (await store.get(key));
        try { await clear(); }
        finally { if (token) await api(ROUTES[audience].logout, { body: { refreshToken: token } }).catch(() => undefined); }
      },
      async call<T>(path: string, init: { body?: unknown; form?: FormData; idempotencyKey?: string } = {}) {
        const run = (token: string | null) => api<T>(path, { ...init, token });
        try {
          return await run(session.current?.accessToken ?? null);
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 401) throw error;
          const next = await refresh();
          if (!next) throw new ApiError(401, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
          return run(next.accessToken);
        }
      },
    }),
    [adopt, audience, clear, gate, key, refresh, state],
  );
  return <Context.Provider value={value as Ctx<unknown>}>{children}</Context.Provider>;
}

export function useSession<U>() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx as Ctx<U>;
}

/** Public screens work without a provider; private data keys use the live session ID. */
export function useSessionScope() {
  return useContext(Context)?.scope ?? 'public';
}
