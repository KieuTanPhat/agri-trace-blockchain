// Concatenated with verify.mjs by the installed controller; no worker-image changes needed.
import cookieAssert from 'node:assert/strict';

export function readSessionCredential(response, data, previous, requireFamily = false) {
  const cookies = new Map((previous?.cookie ?? '').split('; ').filter(Boolean).map(pair => pair.split('=')));
  for (const header of response.headers.getSetCookie()) {
    const [name, value] = header.split(';', 1)[0].split('=');
    if (/Max-Age=0(?:;|$)/i.test(header)) cookies.delete(name);
    else cookies.set(name, value);
  }
  const sessionId = cookies.get('agritrace_session');
  if (sessionId !== undefined || previous?.kind === 'family' || requireFamily) {
    cookieAssert.match(sessionId ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, 'Session cookie missing or invalid');
    const token = cookies.get(`agritrace_refresh_${sessionId}`);
    cookieAssert.match(token ?? '', /^[A-Za-z0-9_-]+$/, 'Refresh cookie missing or invalid');
    cookieAssert.equal(data?.refreshToken, undefined, 'Session family must not disclose a refresh token in JSON');
    return {kind: 'family', cookie: `agritrace_session=${sessionId}; agritrace_refresh_${sessionId}=${token}`};
  }
  // Only historical releases can use the pre-cookie API during baseline/rollback checks.
  cookieAssert.ok(typeof data?.refreshToken === 'string' && data.refreshToken.length >= 16 &&
    data.refreshToken.length <= 8192 && /^[A-Za-z0-9_.-]+$/.test(data.refreshToken), 'Historical refresh credential missing');
  return {kind: 'legacy', token: data.refreshToken};
}

export function sessionRequest(credential) {
  return credential.kind === 'family' ? {body: {}, cookie: credential.cookie} : {body: {refreshToken: credential.token}};
}
