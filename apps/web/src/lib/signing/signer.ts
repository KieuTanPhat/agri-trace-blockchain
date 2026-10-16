import {
  keyPopMessage,
  signedMessage,
  toBase64Url,
  verifyPreparedIntent,
  type PreparedIntent,
} from "./canonical";
import type { KeyStore } from "./key-store";

/** WebCrypto Ed25519 is available in current Chrome, Firefox and Safari. */
export async function ed25519Supported(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
      "sign",
      "verify",
    ]);
    return true;
  } catch {
    return false;
  }
}

export type NewSigningKey = {
  keyRef: string;
  label: string;
  publicKey: string;
  popSignature: string;
};

/** Generates a non-extractable Ed25519 key on this device, keeps the private
 * half in the store and returns what the API needs to enroll the public key:
 * the public key plus a proof that this device holds the private key. */
export async function createSigningKey(
  store: KeyStore,
  input: {
    chainId: string;
    organizationId: string;
    bindingDigest: string;
    label: string;
  },
): Promise<NewSigningKey> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = toBase64Url(
    new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey)),
  );
  const keyRef = crypto.randomUUID();
  const popSignature = toBase64Url(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: "Ed25519" },
        pair.privateKey,
        keyPopMessage({
          bindingDigest: input.bindingDigest,
          keyRef,
          orgRef: input.organizationId,
          publicKey,
        }) as BufferSource,
      ),
    ),
  );
  await store.put({
    id: keyRef,
    chainId: input.chainId,
    organizationId: input.organizationId,
    label: input.label,
    publicKey,
    privateKey: pair.privateKey,
    createdAt: new Date().toISOString(),
  });
  return { keyRef, label: input.label, publicKey, popSignature };
}

export class SigningRefusedError extends Error {}

/** Signs a prepared intent after re-deriving it locally. The key never leaves
 * the device; only the 64-byte signature is returned. */
export async function signPreparedIntent(
  store: KeyStore,
  prepared: PreparedIntent,
  expected?: {
    chainId: string;
    organizationId: string;
    chainRef: string;
    bindingDigest: string;
    entityId: string;
    operation: string;
    keyRef: string;
  },
): Promise<string> {
  const check = await verifyPreparedIntent(prepared);
  if (!check.ok) throw new SigningRefusedError(check.reason);
  const key = await store.get(prepared.keyRef);
  if (!key)
    throw new SigningRefusedError(
      "Khóa ký của tổ chức không nằm trên thiết bị này",
    );
  if (key.organizationId !== prepared.intent.signerOrgRef)
    throw new SigningRefusedError("Yêu cầu ký không thuộc tổ chức giữ khóa");
  if (
    expected &&
    (key.chainId !== expected.chainId ||
      key.organizationId !== expected.organizationId ||
      prepared.keyRef !== expected.keyRef ||
      prepared.intent.chainRef !== expected.chainRef ||
      prepared.intent.bindingDigest !== expected.bindingDigest ||
      prepared.intent.entityType !== "SHIPMENT" ||
      prepared.intent.entityId !== expected.entityId ||
      prepared.intent.operation !== expected.operation)
  )
    throw new SigningRefusedError(
      "Yêu cầu ký không khớp chuỗi, chuyến hàng hoặc khóa đã chọn",
    );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      key.privateKey,
      (await signedMessage(prepared.intent)) as BufferSource,
    ),
  );
  return toBase64Url(signature);
}
