// Concatenated with verify-hosted.mjs by the installed controller; no worker-image changes needed.
import cookieAssert from 'node:assert/strict';
import {setTimeout as smokeDelay} from 'node:timers/promises';

// Public QR verification may exhaust the normal per-IP window on a populated
// installation. Respect it; never exempt the verifier from production limits.
// Only safe reads are retried. Commands retain their persisted key and outcome.
export async function smokeRead(url, {fetcher = fetch, sleep = smokeDelay, now = Date.now} = {}) {
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    const response = await fetcher(url, {signal: AbortSignal.timeout(30_000)});
    if (response.status !== 429 || attempt >= 3) return response;
    const retry = response.headers.get('retry-after');
    const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : NaN;
    const ms = Number.isFinite(seconds) ? seconds * 1000 : retry ? Date.parse(retry) - now() : 60_000;
    const pause = Math.max(1000, ms + 250);
    if (!Number.isFinite(pause) || pause > 65_000 || waited + pause > 180_000) return response;
    await response.body?.cancel();
    waited += pause;
    await sleep(pause);
  }
}

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
