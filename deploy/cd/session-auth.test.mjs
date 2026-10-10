import assert from 'node:assert/strict';
import test from 'node:test';
import {readSessionCredential, sessionRequest} from './session-auth.mjs';

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
