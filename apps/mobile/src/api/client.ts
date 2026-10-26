import type { components } from './generated/api';

export type Schemas = components['schemas'];

/** Public test/dev API including `/api`. Never put secrets in EXPO_PUBLIC_*. */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080/api').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

type Options = {
  method?: 'GET' | 'POST';
  body?: unknown;
  form?: FormData;
  token?: string | null;
  idempotencyKey?: string;
  signal?: AbortSignal;
};

/** One HTTP call against the API envelope. No automatic retries. */
export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? (options.body !== undefined || options.form ? 'POST' : 'GET'),
      headers,
      body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
      signal: options.signal,
    });
  } catch {
    throw new ApiError(0, 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.');
  }
  const payload = (await response.json().catch(() => null)) as
    | { success: true; data: T }
    | { success: false; error?: { message?: string | string[] } }
    | null;
  if (!response.ok || !payload || payload.success !== true) {
    const raw = payload && 'error' in payload ? payload.error?.message : undefined;
    const message = Array.isArray(raw) ? raw[0] : raw;
    const retry = Number(response.headers.get('Retry-After'));
    // The global rate limiter answers in English; show our own wording.
    const text = response.status === 429 && (!message || /Throttler/i.test(message)) ? fallbackMessage(429) : message;
    throw new ApiError(response.status, text ?? fallbackMessage(response.status), Number.isFinite(retry) && retry > 0 ? retry : undefined);
  }
  return payload.data;
}

function fallbackMessage(status: number) {
  if (status === 429) return 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.';
  if (status === 503) return 'Tính năng tạm chưa sẵn sàng.';
  if (status >= 500) return 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.';
  return 'Yêu cầu không thành công.';
}

export const errorText = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Đã có lỗi xảy ra. Vui lòng thử lại.';

/** A fresh key per user action; a retry of an unknown outcome reuses it. */
export function newIdempotencyKey() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
