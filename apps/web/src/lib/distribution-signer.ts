import { IndexedDbKeyStore } from "./signing/key-store";
import { sha256Hex, toBase64Url } from "./signing/canonical";
export const distributionKeyStore = new IndexedDbKeyStore();
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v))
        .join(",") +
      "}"
    );
  throw new Error("Nội dung ký không hợp lệ");
}
const message = (domain: string, body: unknown) =>
  new TextEncoder().encode(domain + "\0" + canonicalJson(body));
export async function signDistributionReturn(record: { transferId: unknown; lines: unknown; reason: unknown; digest: unknown }, body: { returnId: string; transferId: string; digest: string; organizationId: string; userId: string; keyRef: string; version: string; expiresAt: string }) {
  const digest = await sha256Hex(new TextEncoder().encode(canonicalJson({ transferId: record.transferId, lines: record.lines, reason: record.reason })));
  if (digest !== record.digest || digest !== body.digest || record.transferId !== body.transferId) throw new Error('Nội dung trả hàng không khớp dấu kiểm tra');
  const key = await distributionKeyStore.get(body.keyRef);
  if (!key || key.organizationId !== body.organizationId) throw new Error('Thiết bị chưa có khóa ký của tổ chức');
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('Ed25519',key.privateKey,message('agritrace:distribution-return:1',body))));
}
export async function generateDistributionKey(
  organizationId: string,
  label: string,
) {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = toBase64Url(
      new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey)),
    ),
    id = crypto.randomUUID();
  const popSignature = toBase64Url(
    new Uint8Array(
      await crypto.subtle.sign(
        "Ed25519",
        pair.privateKey,
        message("agritrace:distribution-key:1", {
          id,
          organizationId,
          publicKey,
        }),
      ),
    ),
  );
  await distributionKeyStore.put({
    id,
    organizationId,
    chainId: "distribution",
    label,
    publicKey,
    privateKey: pair.privateKey,
    createdAt: new Date().toISOString(),
  });
  return { id, label, publicKey, popSignature };
}
export async function signDistribution(
  input: { snapshot: unknown; snapshotDigest: string; domain: string },
  body: {
    transferId: string;
    phase: string;
    organizationId: string;
    userId: string;
    keyRef: string;
    version: string;
    expiresAt: string;
  },
) {
  if (
    input.domain !== "agritrace:distribution-attestation:1" ||
    (await sha256Hex(
      new TextEncoder().encode(canonicalJson(input.snapshot)),
    )) !== input.snapshotDigest
  )
    throw new Error("Nội dung bàn giao không khớp dấu kiểm tra");
  const key = await distributionKeyStore.get(body.keyRef);
  if (!key || key.organizationId !== body.organizationId)
    throw new Error(
      "Thiết bị này chưa có khóa của doanh nghiệp. Mở trang Khóa ký để tạo khóa.",
    );
  return toBase64Url(
    new Uint8Array(
      await crypto.subtle.sign(
        "Ed25519",
        key.privateKey,
        message(input.domain, {
          ...body,
          snapshotDigest: input.snapshotDigest,
        }),
      ),
    ),
  );
}
