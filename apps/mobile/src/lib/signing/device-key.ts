import { newIdempotencyKey } from '../../api/client';
import { createDeviceKey, deviceKeyRegistration, forgetKeys, listUserKeys } from './keys';

type Call = <T>(path: string, init?: { body?: unknown; idempotencyKey?: string }) => Promise<T>;
type ServerKey = { id: string; status: string; userId: string | null };
export type DeviceKeyState = { state: 'active'; keyId: string };
type Issued = { record: { id: string; status: string } };

/**
 * Makes sure the signed-in member has a personal signing key on this phone.
 * The key is generated here on first use and registered without asking the
 * member anything; it signs right away.
 */
// Single flight per member: two screens asking at once never create two keys.
const inflight = new Map<string, Promise<DeviceKeyState>>();
export function ensureDeviceKey(call: Call, user: { id: string; organizationId: string }): Promise<DeviceKeyState> {
  const running = inflight.get(user.id);
  if (running) return running;
  const next = ensure(call, user).finally(() => inflight.delete(user.id));
  inflight.set(user.id, next);
  return next;
}

async function ensure(call: Call, user: { id: string; organizationId: string }): Promise<DeviceKeyState> {
  const server = (await call<{ items: ServerKey[] }>('/distribution/keys')).items.filter((k) => k.userId === user.id);
  const local = await listUserKeys(user.organizationId, user.id);
  const status = (id: string) => server.find((k) => k.id === id)?.status;
  await forgetKeys(local.filter((k) => status(k.id) === 'REVOKED').map((k) => k.id));
  const active = local.find((k) => status(k.id) === 'ACTIVE');
  if (active) return { state: 'active', keyId: active.id };
  // A stored key the server never recorded is registered again with its own proof.
  const unsent = local.find((k) => !status(k.id));
  const request = unsent ? await deviceKeyRegistration(unsent) : (await createDeviceKey(user.organizationId, user.id, 'Điện thoại')).request;
  const issued = await call<Issued>('/distribution/device-keys', { body: request, idempotencyKey: newIdempotencyKey() });
  return { state: 'active', keyId: issued.record.id };
}
