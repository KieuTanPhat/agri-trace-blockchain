export const REFRESH_COOKIE_NAME = 'agritrace_refresh';

export function readRefreshCookie(header?: string): string | null {
  const value = header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${REFRESH_COOKIE_NAME}=`))
    ?.slice(REFRESH_COOKIE_NAME.length + 1);
  return value && /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

export function refreshCookie(token: string, expiresAt: Date): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return [
    `${REFRESH_COOKIE_NAME}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/api/auth',
    `Max-Age=${maxAge}`,
    ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
  ].join('; ');
}

export function clearRefreshCookie(): string {
  return [
    `${REFRESH_COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/api/auth',
    'Max-Age=0',
    ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
  ].join('; ');
}
