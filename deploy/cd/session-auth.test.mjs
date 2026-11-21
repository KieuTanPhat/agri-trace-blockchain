import assert from 'node:assert/strict';
import test from 'node:test';
import {readSessionCredential, sessionRequest, smokeRead, smokeFailureDetails} from './session-auth.mjs';

test('public GET transport and body timeouts retry the identical URL with a finite budget', async () => {
  const calls = [], pauses = [];
  let attempt = 0;
  const response = await smokeRead('https://example.test/trace/original', {
    fetcher: async (url, options) => {
      calls.push(url); assert.equal(options.method, undefined);
      if (attempt++ === 0) throw new TypeError('fetch failed');
      if (attempt === 2) return new Response(new ReadableStream({start(c) {c.error(new DOMException('body timeout', 'TimeoutError'));}}));
      return new Response('{"verified":true}');
    }, sleep: async ms => pauses.push(ms),
  });
  assert.deepEqual(await response.json(), {verified: true});
  assert.deepEqual(calls, Array(3).fill('https://example.test/trace/original'));
  assert.deepEqual(pauses, [250, 500]);
  let failures = 0;
  const error = new TypeError('fetch failed');
  await assert.rejects(smokeRead('https://example.test', {
    fetcher: async () => {failures++; throw error;}, sleep: async () => {},
  }), e => e === error);
  assert.equal(failures, 4);
});

test('read diagnostics omit private URLs, payloads and raw error messages', () => {
  const error = new TypeError('fetch failed at private-url-and-password', {cause: {code: 'ETIMEDOUT'}});
  assert.deepEqual(smokeFailureDetails(error), {errorType: 'TypeError', networkCode: 'ETIMEDOUT'});
  assert.deepEqual(smokeFailureDetails({name: 'private-secret', cause: {code: 'private-password'}}), {errorType: 'UnknownError'});
});

test('public smoke reads respect Retry-After and retry the identical URL', async () => {
  const calls = [], pauses = [];
  const responses = [new Response('', {status: 429, headers: {'Retry-After': '12'}}), new Response('{}')];
  const result = await smokeRead('https://example.test/api/public/trace/same', {
    fetcher: async url => { calls.push(url); return responses.shift(); },
    sleep: async ms => pauses.push(ms),
  });
  assert.equal(result.status, 200);
  assert.deepEqual(pauses, [12250]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], calls[1]);
});

test('public smoke reads stop on persistent limits and never retry other failures', async () => {
  for (const status of [401, 403, 500]) {
    let calls = 0;
    const response = await smokeRead('https://example.test', {fetcher: async () => { calls++; return new Response('', {status}); }});
    assert.equal(response.status, status); assert.equal(calls, 1);
  }
  let calls = 0;
  assert.equal((await smokeRead('https://example.test', {
    fetcher: async () => { calls++; return new Response('', {status: 429, headers: {'Retry-After': '1'}}); }, sleep: async () => {},
  })).status, 429);
  assert.equal(calls, 4);
});

const id = '11111111-1111-4111-8111-111111111111';
const response = (...cookies) => ({headers: {getSetCookie: () => cookies}});
const selector = `agritrace_session=${id}; HttpOnly; Secure`;
const family = token => `agritrace_refresh_${id}=${token}; HttpOnly; Secure`;

test('baseline and rollback can authenticate the historical JSON token API', () => {
  const credential = readSessionCredential(response(), {refreshToken: 'historical-token-1234'});
  assert.deepEqual(sessionRequest(credential), {body: {refreshToken: 'historical-token-1234'}});
  const rotated = readSessionCredential(response(), {refreshToken: 'historical-rotated-token'}, credential);
  assert.equal(rotated.kind, 'legacy');
  assert.equal(rotated.token, 'historical-rotated-token');
});

test('candidate must use family cookies and keep refresh tokens out of JSON', () => {
  assert.throws(() => readSessionCredential(response(), {refreshToken: 'historical-token-1234'}, undefined, true));
  assert.throws(() => readSessionCredential(response(selector, family('token')), {refreshToken: 'disclosed-token'}, undefined, true));
  const credential = readSessionCredential(response(selector, family('initial_token')), {}, undefined, true);
  assert.deepEqual(sessionRequest(credential), {body: {}, cookie: `agritrace_session=${id}; agritrace_refresh_${id}=initial_token`});
});

test('family refresh preserves the selector and replaces only its own refresh cookie', () => {
  const initial = readSessionCredential(response(selector, family('initial')), {}, undefined, true);
  const rotated = readSessionCredential(response(family('rotated'), 'unrelated_cookie=value'), {}, initial, true);
  assert.equal(rotated.cookie, `agritrace_session=${id}; agritrace_refresh_${id}=rotated`);
  assert.throws(() => readSessionCredential(response(family(''), family('old') + '; Max-Age=0'), {}, initial));
  assert.throws(() => readSessionCredential(response(family('rotated')), {refreshToken: 'historical-token-1234'}, initial));
});

test('incomplete or malformed family credentials cannot fall back to a legacy token', () => {
  for (const headers of [[selector], [selector.replace(id, '-'.repeat(36)), family('token')],
    [selector, family('has space')], [selector + '; Max-Age=0', family('token')]]) {
    assert.throws(() => readSessionCredential(response(...headers), {}, undefined, true));
  }
});
