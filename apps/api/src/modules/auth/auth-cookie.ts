import { isUUID } from 'class-validator';

export const SESSION_COOKIE_NAME = 'agritrace_session';
export const REFRESH_COOKIE_PREFIX = 'agritrace_refresh_';

function readCookie(name: string, header?: string): string | null {
  const value = header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return value && /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

export function readRefreshCookie(
  header?: string,
): { sessionId: string; token: string } | null {
  const sessionId = readCookie(SESSION_COOKIE_NAME, header);
  if (!sessionId || !isUUID(sessionId)) return null;
  const token = readCookie(`${REFRESH_COOKIE_PREFIX}${sessionId}`, header);
  return token ? { sessionId, token } : null;
}

function cookie(name: string, value: string, expiresAt: Date): string {
  const maxAge = Math.max(
    0,
    Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  );
  return [
    `${name}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/api/auth',
    `Max-Age=${maxAge}`,
    ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
  ].join('; ');
}

export function sessionCookie(sessionId: string, expiresAt: Date): string {
  return cookie(SESSION_COOKIE_NAME, sessionId, expiresAt);
}

export function refreshCookie(
  sessionId: string,
  token: string,
  expiresAt: Date,
): string {
  return cookie(`${REFRESH_COOKIE_PREFIX}${sessionId}`, token, expiresAt);
}

export function clearRefreshCookie(sessionId: string): string {
  return refreshCookie(sessionId, '', new Date(0));
}
