import { ed25519 } from '@noble/curves/ed25519.js';
import { getRandomBytes, randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { distributionMessage, ed25519Spki, fromBase64Url, keyPopMessage, toBase64Url } from './canonical';

/**
 * Organization signing keys kept on this phone. The 32-byte Ed25519 secret
 * lives in the platform keystore (expo-secure-store, this device only) and is
 * read back only to sign; the API receives the public key and a
 * proof-of-possession, as the Web signer sends.
 */
type DeviceKey = {
  id: string;
  /** Chain id for c2 keys, "device" for the personal standard handover key. */
  chainId: string;
  organizationId: string;
  /** Owner of a personal device key. */
  userId?: string;
  label: string;
  publicKey: string;
  createdAt: string;
};

const INDEX = 'agritrace.signing.index';
const secretName = (id: string) => `agritrace.signing.${id}`;
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

async function readIndex(): Promise<DeviceKey[]> {
  try {
    return JSON.parse((await SecureStore.getItemAsync(INDEX, options)) ?? '[]') as DeviceKey[];
  } catch {
    return [];
  }
}

export async function listDeviceKeys(chainId: string, organizationId: string) {
  return (await readIndex()).filter((k) => k.chainId === chainId && k.organizationId === organizationId);
}

async function createKey(chainId: string, organizationId: string, label: string, id: string, userId?: string) {
  const secret = getRandomBytes(32);
  const publicKey = toBase64Url(ed25519Spki(ed25519.getPublicKey(secret)));
  const key: DeviceKey = { id, chainId, organizationId, userId, label, publicKey, createdAt: new Date().toISOString() };
  // The secret is stored before the index so a listed key always has one.
  await SecureStore.setItemAsync(secretName(id), toBase64Url(secret), options);
  await SecureStore.setItemAsync(INDEX, JSON.stringify([...(await readIndex()), key]), options);
  return { key, secret };
}

/** A c2 key for one chain, bound to its active ledger binding. */
export async function createChainKey(input: { chainId: string; organizationId: string; bindingDigest: string; label: string }) {
  const { key, secret } = await createKey(input.chainId, input.organizationId, input.label, randomUUID());
  const popSignature = toBase64Url(ed25519.sign(keyPopMessage({
    bindingDigest: input.bindingDigest, keyRef: key.id, orgRef: input.organizationId, publicKey: key.publicKey,
  }), secret));
  return { keyRef: key.id, label: key.label, publicKey: key.publicKey, popSignature };
}

/** The signed-in member's own standard handover key on this phone. */
export async function createDeviceKey(organizationId: string, userId: string, label: string) {
  const { key, secret } = await createKey('device', organizationId, label, randomUUID(), userId);
  return { key, request: deviceKeyRequest(key, secret) };
}

/** Registration body: public key plus proof of possession, never the secret. */
function deviceKeyRequest(key: DeviceKey, secret: Uint8Array) {
  const popSignature = toBase64Url(ed25519.sign(
    distributionMessage('agritrace:distribution-key:1', { id: key.id, organizationId: key.organizationId, publicKey: key.publicKey }), secret,
  ));
  return { id: key.id, label: key.label, publicKey: key.publicKey, popSignature };
}

/** Rebuilds the registration of a stored key whose first request was lost. */
export async function deviceKeyRegistration(key: DeviceKey) {
  const secret = await SecureStore.getItemAsync(secretName(key.id), options);
  if (!secret) throw new Error('Khóa ký trên máy đã mất; tạo lại khóa');
  return deviceKeyRequest(key, fromBase64Url(secret));
}

/** The phone's personal keys of one member. */
export async function listUserKeys(organizationId: string, userId: string) {
  return (await readIndex()).filter((k) => k.chainId === 'device' && k.organizationId === organizationId && k.userId === userId);
}

/** Forgets keys the server revoked, so they are never offered again. */
export async function forgetKeys(ids: string[]) {
  if (!ids.length) return;
  for (const id of ids) await SecureStore.deleteItemAsync(secretName(id), options);
  await SecureStore.setItemAsync(INDEX, JSON.stringify((await readIndex()).filter((k) => !ids.includes(k.id))), options);
}

/** Signs with a stored key; refuses a key of another organization. */
export async function signWith(id: string, organizationId: string, message: Uint8Array) {
  const key = (await readIndex()).find((k) => k.id === id);
  const secret = await SecureStore.getItemAsync(secretName(id), options);
  if (!key || !secret || key.organizationId !== organizationId)
    throw new Error('Khóa ký của tổ chức không nằm trên điện thoại này');
  return toBase64Url(ed25519.sign(message, fromBase64Url(secret)));
}
