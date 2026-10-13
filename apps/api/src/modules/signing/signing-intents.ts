import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  Prisma,
  SigningIntent,
  SigningKey,
  SigningOperation,
} from '../../generated/prisma/client.js';
import {
  INTENT_PROTOCOL,
  SIGNING_POLICY_VERSION,
  intentDigest,
  payloadDigest,
  signedMessageForIntent,
  verifyEd25519,
  type IntentBody,
  type IntentPayload,
} from '../trace/signed-commitment.js';

/** Default and maximum time a prepared intent can wait for its signature. */
export const DEFAULT_SIGNING_WINDOW_MINUTES = 15;
export const MAX_SIGNING_WINDOW_MINUTES = 24 * 60;

export type PreparedIntentView = {
  intentId: string;
  operation: SigningOperation;
  entityType: string;
  entityId: string;
  eventType: string;
  keyRef: string;
  expiresAt: string;
  intent: IntentBody;
  payload: IntentPayload;
  intentDigest: string;
  /** Exact bytes the key must sign, base64url. Signers should recompute it. */
  signedMessage: string;
};

const EVENT_TYPE: Record<SigningOperation, string> = {
  HANDOVER_OFFER: 'HANDOVER_OFFERED',
  HANDOVER_CONFIRM: 'HANDOVER_CONFIRMED',
};

/** The organization's single ACTIVE key on a binding (or the named one). */
export async function resolveSigningKey(
  tx: Prisma.TransactionClient,
  bindingDigest: string,
  organizationId: string,
  keyRef?: string,
): Promise<SigningKey> {
  const keys = await tx.signingKey.findMany({
    where: {
      bindingDigest,
      organizationId,
      status: 'ACTIVE',
      ...(keyRef ? { keyRef } : {}),
    },
  });
  if (!keys.length)
    throw new ConflictException(
      'Tổ chức chưa có khóa ký hoạt động trên binding của chuỗi',
    );
  if (keys.length > 1)
    throw new ConflictException('Có nhiều khóa ký hoạt động, cần chọn keyRef');
  return keys[0];
}

export async function prepareSigningIntent(
  tx: Prisma.TransactionClient,
  input: {
    chainId: string;
    chainRef: string;
    bindingDigest: string;
    organizationId: string;
    userId: string;
    key: SigningKey;
    operation: SigningOperation;
    entityType: string;
    entityId: string;
    eventId?: string;
    expectedVersion: number;
    payload: IntentPayload;
    windowMinutes: number;
  },
): Promise<PreparedIntentView> {
  const minutes = Math.min(
    Math.max(Math.trunc(input.windowMinutes), 5),
    MAX_SIGNING_WINDOW_MINUTES,
  );
  const intentId = randomUUID();
  const eventId = input.eventId ?? randomUUID();
  const expiresAt = new Date(Date.now() + minutes * 60_000);
  const body: IntentBody = {
    protocol: INTENT_PROTOCOL,
    intentId,
    chainRef: input.chainRef,
    bindingDigest: input.bindingDigest,
    signerOrgRef: input.organizationId,
    keyRef: input.key.keyRef,
    operation: input.operation,
    entityType: input.entityType,
    entityId: input.entityId,
    eventId,
    eventType: EVENT_TYPE[input.operation],
    expectedVersion: String(input.expectedVersion),
    payloadDigest: payloadDigest(input.payload),
    notAfter: expiresAt.toISOString(),
    policyVersion: SIGNING_POLICY_VERSION,
  };
  const digest = intentDigest(body);
  await tx.signingIntent.create({
    data: {
      id: intentId,
      chainId: input.chainId,
      bindingDigest: input.bindingDigest,
      organizationId: input.organizationId,
      keyRef: input.key.keyRef,
      createdBy: input.userId,
      operation: input.operation,
      entityType: input.entityType,
      entityId: input.entityId,
      eventId,
      eventType: body.eventType,
      expectedVersion: input.expectedVersion,
      payload: input.payload,
      payloadDigest: body.payloadDigest,
      intent: body as unknown as Prisma.InputJsonObject,
      intentDigest: digest,
      policyVersion: SIGNING_POLICY_VERSION,
      expiresAt,
    },
  });
  return viewOf({
    id: intentId,
    operation: input.operation,
    entityType: input.entityType,
    entityId: input.entityId,
    eventType: body.eventType,
    keyRef: input.key.keyRef,
    expiresAt,
    intent: body as unknown as Prisma.JsonValue,
    payload: input.payload as unknown as Prisma.JsonValue,
    intentDigest: digest,
  });
}

export function viewOf(
  row: Pick<
    SigningIntent,
    | 'id'
    | 'operation'
    | 'entityType'
    | 'entityId'
    | 'eventType'
    | 'keyRef'
    | 'expiresAt'
    | 'intent'
    | 'payload'
    | 'intentDigest'
  >,
): PreparedIntentView {
  const intent = row.intent as unknown as IntentBody;
  return {
    intentId: row.id,
    operation: row.operation,
    entityType: row.entityType,
    entityId: row.entityId,
    eventType: row.eventType,
    keyRef: row.keyRef,
    expiresAt: row.expiresAt.toISOString(),
    intent,
    payload: row.payload as unknown as IntentPayload,
    intentDigest: row.intentDigest,
    signedMessage: signedMessageForIntent(intent).toString('base64url'),
  };
}

/** Verifies the signature against the intent the caller prepared and consumes
 * it exactly once. Runs inside the domain transaction: a stale version, a
 * revoked key or an expired intent rolls the consumption back with the write.
 * No network call happens here; the signature was produced elsewhere. */
export async function consumeSigningIntent(
  tx: Prisma.TransactionClient,
  intentId: string,
  actor: { sub: string | null; organizationId: string | null },
  signature: string,
): Promise<SigningIntent & { key: SigningKey }> {
  await tx.$queryRaw`SELECT intent_id FROM signing_intent WHERE intent_id = ${intentId}::uuid FOR UPDATE`;
  const intent = await tx.signingIntent.findUnique({
    where: { id: intentId },
    include: { key: true },
  });
  if (!intent) throw new NotFoundException('Không tìm thấy yêu cầu ký');
  if (
    !actor.sub ||
    intent.createdBy !== actor.sub ||
    intent.organizationId !== actor.organizationId
  )
    throw new ForbiddenException('Yêu cầu ký thuộc người dùng khác');
  if (intent.status !== 'PENDING')
    throw new ConflictException('Yêu cầu ký đã được dùng hoặc đã hết hạn');
  if (intent.expiresAt.getTime() <= Date.now())
    throw new ConflictException('Yêu cầu ký đã hết hạn');
  if (intent.key.status !== 'ACTIVE')
    throw new ConflictException('Khóa ký đã bị thu hồi');
  const body = intent.intent as unknown as IntentBody;
  if (intentDigest(body) !== intent.intentDigest)
    throw new ConflictException('Yêu cầu ký không toàn vẹn');
  if (
    !verifyEd25519(
      intent.key.publicKey,
      signedMessageForIntent(body),
      signature,
    )
  )
    throw new UnprocessableEntityException('Chữ ký không hợp lệ');
  const consumed = await tx.signingIntent.updateMany({
    where: { id: intent.id, status: 'PENDING' },
    data: { status: 'CONSUMED', signature, consumedAt: new Date() },
  });
  if (consumed.count !== 1)
    throw new ConflictException('Yêu cầu ký đã được dùng');
  return { ...intent, status: 'CONSUMED', signature, key: intent.key };
}
