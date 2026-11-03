import { chainApi } from "./ledger/chain-api";
import { newLedgerCommandKey } from "./ledger/command-context";
import { deviceScope, distributionKeyStore, generateDeviceKey } from "./distribution-signer";

export type DeviceKeyState =
  | { state: "active"; keyId: string }
  | { state: "pending"; keyId: string; email?: string; resendAfter?: string };
type Member = { id: string; organizationId: string };

/** Single flight per member: two components asking at once never create two keys. */
const inflight = new Map<string, Promise<DeviceKeyState>>();

/**
 * Makes sure the signed-in member has a personal signing key in this browser.
 * The key is generated here without asking anything; it signs only after the
 * member enters the code emailed to the account address.
 */
export function ensureDeviceKey(member: Member): Promise<DeviceKeyState> {
  const running = inflight.get(member.id);
  if (running) return running;
  const next = ensure(member).finally(() => inflight.delete(member.id));
  inflight.set(member.id, next);
  return next;
}

async function ensure(member: Member): Promise<DeviceKeyState> {
  const server = (await chainApi.distributionKeys()).filter((k) => k.userId === member.id);
  const local = await distributionKeyStore.list(deviceScope(member.id), member.organizationId);
  const status = (id: string) => server.find((k) => k.id === id)?.status;
  // Keys the server revoked or never recorded are dropped; a browser key
  // cannot be exported, so a lost registration is simply replaced.
  for (const key of local) if (status(key.id) !== "ACTIVE" && status(key.id) !== "PENDING") await distributionKeyStore.remove(key.id);
  const active = local.find((k) => status(k.id) === "ACTIVE");
  if (active) return { state: "active", keyId: active.id };
  const pending = local.find((k) => status(k.id) === "PENDING");
  if (pending) return { state: "pending", keyId: pending.id };
  const request = await generateDeviceKey(member.organizationId, member.id, "Trình duyệt");
  const issued = await chainApi.requestDeviceKey(request, { idempotencyKey: newLedgerCommandKey() });
  return { state: "pending", keyId: issued.record.id, email: issued.record.email, resendAfter: issued.record.resendAfter };
}
