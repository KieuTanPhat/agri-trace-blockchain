/** Script/style elements require a request nonce or an exact library CSS hash.
 * Element style attributes remain available for React/Radix positioning. */
export function webSecurityHeaders(env: NodeJS.ProcessEnv = process.env, nonce?: string, expo = false) {
  const development = env.NODE_ENV !== 'production';
  if (nonce && !/^[A-Za-z0-9+/=_-]{16,128}$/.test(nonce)) throw new Error('Invalid CSP nonce');
  // Match api-client's browser target, including its local default. Production
  // same-origin builds need no cross-origin API allowlist.
  const sameOrigin = env.NEXT_PUBLIC_API_SAME_ORIGIN === 'true' || !!env.NEXT_PUBLIC_BUSINESS_ORIGIN;
  const apiOrigins = [sameOrigin ? undefined : (env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8080/api')]
    .flatMap(value => {
      if (!value) return [];
      if (value.startsWith('/') && !value.startsWith('//')) return [];
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new Error('Invalid security policy API origin');
      return [url.origin];
    });
  const styleHashes = [
    env.NEXT_PUBLIC_CSP_STYLE_HASH ?? process.env.NEXT_PUBLIC_CSP_STYLE_HASH,
    env.NEXT_PUBLIC_CSP_OFFLINE_STYLE_HASH ?? process.env.NEXT_PUBLIC_CSP_OFFLINE_STYLE_HASH,
  ].filter((value): value is string => !!value);
  if (styleHashes.some(value => !/^[A-Za-z0-9+/]{43}=$/.test(value))) throw new Error('Invalid CSP style hash');
  const nonceSource = nonce ? ` 'nonce-${nonce}'` : '';
  const scriptSources = development || expo
    ? "'self' 'unsafe-inline' 'wasm-unsafe-eval'" + (development ? " 'unsafe-eval'" : '')
    : `'self'${nonceSource}${nonce ? " 'strict-dynamic'" : ''} 'wasm-unsafe-eval'`;
  const styleSources = development || expo ? "'self' 'unsafe-inline'"
    : `'self'${nonceSource}${styleHashes.map(hash => ` 'sha256-${hash}'`).join('')}`;
  const policy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    `script-src ${scriptSources}`,
    "script-src-attr 'none'",
    `style-src ${styleSources}`,
    // Attributes cannot authorize <style> elements or executable scripts.
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' data: blob: https://tile.openstreetmap.org https://vietqr.app ${[...new Set(apiOrigins)].join(' ')}`.trim(),
    "font-src 'self' data:",
    `connect-src 'self' ${[...new Set(apiOrigins)].join(' ')}${development ? ' ws: wss:' : ''}`.trim(),
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "manifest-src 'self'",
    "form-action 'self'",
  ].join('; ');
  return [
    { key: 'Content-Security-Policy', value: policy },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
    { key: 'X-XSS-Protection', value: '0' },
  ];
}

/** Static Expo exports do not pass through the Next renderer. Keep their
 * existing element policy until the Expo exporter supplies nonces/hashes. */
export function expoWebSecurityHeaders(env: NodeJS.ProcessEnv = process.env) {
  return webSecurityHeaders(env, undefined, true);
}
