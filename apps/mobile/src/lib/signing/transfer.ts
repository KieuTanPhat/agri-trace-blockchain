import { canonicalJson, distributionMessage, handoverPhotosDigest, sha256Hex, signedMessage, verifyPreparedIntent, type PreparedIntent } from './canonical';
import { listDeviceKeys, listUserKeys, signWith } from './keys';

/**
 * Handover signatures from the phone, the same two protocols as the Web
 * (apps/web/src/lib/distribution-c2.ts and distribution-signer.ts): a chain
 * pinned to DUAL_SIGNED uses c2 intents per lot with the chain key; other
 * chains use the enterprise distribution key over the server challenge.
 */
type Row = Record<string, unknown>;
type Line = { lotId: string; quantity: string; unit: string };
export type SignableTransfer = Row & { id: string; chainId: string; version: number; handoverMode?: string; lines: Line[] };
type Call = <T>(path: string, init?: { body?: unknown; idempotencyKey?: string }) => Promise<T>;
type Signer = { id: string; organizationId: string };

function fixed(value: unknown) {
  const text = String(value);
  if (!/^\d+(\.\d{1,3})?$/.test(text)) throw new Error('Lượng bàn giao không hợp lệ');
  const [integer, fraction = ''] = text.split('.');
  return BigInt(integer).toString() + '.' + fraction.padEnd(3, '0');
}

/** Field for field the snapshot the Web signer derives from the record. */
export function transferSnapshot(t: Row) {
  const mode = t.transportMode as string | undefined;
  return {
    id: t.id, chainId: t.chainId, senderId: t.senderId, carrierId: t.carrierId, receiverId: t.receiverId,
    origin: t.origin, destination: t.destination, vehicleId: t.vehicleId ?? null,
    ...(mode && mode !== 'PLATFORM_CARRIER' ? { transportMode: mode, transportDetails: t.transportDetails ?? null } : {}),
    ...(t.plannedPickupAt ? { plannedPickupAt: t.plannedPickupAt, plannedDeliveryAt: t.plannedDeliveryAt ?? null, note: t.note ?? null } : {}),
    ...(t.handoverMode === 'DUAL_SIGNED' ? { handoverMode: t.handoverMode } : {}),
    ...(t.attestationEpoch ? { attestationEpoch: t.attestationEpoch } : {}),
    ...(t.receiptDigest ? { receiptDigest: t.receiptDigest } : {}),
    ...(t.photosDigest ? { photosDigest: t.photosDigest } : {}),
    ...(t.senderSiteId || t.carrierSiteId || t.receiverSiteId
      ? { senderSiteId: t.senderSiteId ?? null, carrierSiteId: t.carrierSiteId ?? null, receiverSiteId: t.receiverSiteId ?? null } : {}),
    lines: (t.lines as Line[])
      .map((l) => ({ lotId: l.lotId, quantity: fixed(l.quantity), unit: l.unit }))
      .sort((a, b) => a.lotId.localeCompare(b.lotId)),
  };
}

type PhotoRow = { phase: string; evidenceId: string; sha256: string };
/** The photos listed with the transfer are exactly those its snapshot commits to. */
export function assertPhotosDigest(t: Row) {
  const photos = (t.photos as PhotoRow[] | undefined) ?? [];
  if (!t.photosDigest && !photos.length) return;
  if (handoverPhotosDigest(String(t.id), photos) !== t.photosDigest)
    throw new Error('Ảnh bàn giao không khớp nội dung sẽ ký; tải lại chuyến hàng');
}

/** Which key this phone would sign with, or why it cannot. */
export async function deviceSigningKey(call: Call, t: SignableTransfer, signer: Signer) {
  if (t.handoverMode === 'DUAL_SIGNED') {
    const context = await call<{ chainRef: string | null; bindingDigest: string | null; keys: { keyRef: string; status: string }[] }>(
      `/supply-chains/${t.chainId}/signing-keys`);
    const local = await listDeviceKeys(t.chainId, signer.organizationId);
    const key = local.find((k) => context.keys.some((a) => a.keyRef === k.id && a.status === 'ACTIVE'));
    return { mode: 'c2' as const, key, context };
  }
  // The member's own device key, active once its emailed code was confirmed.
  const active = (await call<{ items: { id: string; status: string }[] }>('/distribution/keys')).items;
  const local = await listUserKeys(signer.organizationId, signer.id);
  return { mode: 'standard' as const, key: local.find((k) => active.some((a) => a.id === k.id && a.status === 'ACTIVE')), context: null };
}

/** c2: checks every prepared intent against the displayed transfer, then signs. */
export async function signPrepared(t: SignableTransfer, phase: string, signer: Signer,
  context: { chainRef: string | null; bindingDigest: string | null }, keyRef: string, items: PreparedIntent[]) {
  const canonical = canonicalJson(transferSnapshot(t));
  const digest = sha256Hex(new TextEncoder().encode(canonical));
  if (items.length !== t.lines.length) throw new Error('Số intent không khớp từng nguồn đang hiển thị');
  const seen = new Set<string>();
  const signatures = [];
  for (const p of items) {
    const line = t.lines.find((l) => l.lotId === p.payload.lotId);
    if (!line || seen.has(p.payload.lotId) || p.operation !== 'DISTRIBUTION_ATTEST'
      || p.payload.snapshot !== canonical || p.payload.snapshotDigest !== digest
      || p.payload.quantity !== fixed(line.quantity) || p.payload.unit !== line.unit || p.payload.phase !== phase
      || p.payload.documentId !== t.id || p.payload.signerUserId !== signer.id || p.payload.documentVersion !== String(t.version))
      throw new Error('Nội dung ký khác lô, lượng hoặc bên ký đang hiển thị');
    const check = verifyPreparedIntent(p);
    if (!check.ok) throw new Error(check.reason);
    if (p.keyRef !== keyRef || p.intent.signerOrgRef !== signer.organizationId || p.intent.chainRef !== context.chainRef
      || p.intent.bindingDigest !== context.bindingDigest || p.intent.entityType !== 'LOT' || p.intent.entityId !== p.payload.lotId)
      throw new Error('Yêu cầu ký không khớp chuỗi, lô hoặc khóa đã chọn');
    seen.add(p.payload.lotId);
    signatures.push({ lotId: p.payload.lotId, intentId: p.intentId, signature: await signWith(keyRef, signer.organizationId, signedMessage(p.intent)) });
  }
  return { phase, version: t.version, signatures };
}

/** Standard protocol: signs the server challenge after recomputing its digest. */
export async function signStandard(call: Call, t: SignableTransfer, phase: string, signer: Signer, keyRef: string) {
  const challenge = await call<{ snapshot: unknown; snapshotDigest: string; domain: string; phases: string[] }>(
    `/distribution/transfers/${t.id}/challenge`);
  if (!challenge.phases.includes(phase)) throw new Error('Bước bàn giao đã thay đổi. Tải lại chuyến hàng.');
  if (challenge.domain !== 'agritrace:distribution-attestation:1'
    || sha256Hex(new TextEncoder().encode(canonicalJson(challenge.snapshot))) !== challenge.snapshotDigest)
    throw new Error('Nội dung bàn giao không khớp dấu kiểm tra');
  // The challenge must commit to the photos shown on this screen.
  if (((challenge.snapshot as Row | null)?.photosDigest ?? null) !== (t.photosDigest ?? null))
    throw new Error('Ảnh bàn giao đã thay đổi. Tải lại chuyến hàng.');
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const body = { transferId: t.id, phase, organizationId: signer.organizationId, userId: signer.id, keyRef, version: String(t.version), expiresAt };
  const signature = await signWith(keyRef, signer.organizationId,
    distributionMessage(challenge.domain, { ...body, snapshotDigest: challenge.snapshotDigest }));
  return { phase, version: t.version, keyRef, expiresAt, signature };
}
