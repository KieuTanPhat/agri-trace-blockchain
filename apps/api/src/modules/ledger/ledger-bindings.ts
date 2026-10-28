import { ConflictException, NotFoundException } from '@nestjs/common';
import type { LedgerProfile, Prisma } from '../../generated/prisma/client.js';
import {
  B_ENVELOPE_VERSION,
  bindingDigest,
} from '../trace/binding-commitment.js';
import {
  BINDING_ROUTE_PROTOCOL,
  ledgerRouteDigest,
  type RouteDefinition,
} from '../trace/ledger-route.js';
import { ledgerEntityTypes, requestLedgerGrant } from './ledger-permissions.js';

export interface RegisterBindingInput {
  chainId: string;
  network: string;
  channelId: string;
  chaincodeName: string;
  contractName: string;
  writerAuthority: string;
  writerMspId: string;
  /** Digest of the reviewed governance descriptor packaged in the chaincode. */
  governanceDigest: string;
  profile: LedgerProfile;
}

/** Platform-operator operation (CLI), never an HTTP endpoint: it names network,
 * channel and MSP, which business users must never choose. */
export async function registerBinding(
  tx: Prisma.TransactionClient,
  input: RegisterBindingInput,
) {
  const chain = await tx.supplyChain.findUnique({
    where: { id: input.chainId },
  });
  if (!chain) throw new NotFoundException('Không tìm thấy chuỗi');
  const profile =
    (await tx.chainLedgerProfile.findUnique({
      where: { chainId: input.chainId },
    })) ??
    (await tx.chainLedgerProfile.create({ data: { chainId: input.chainId } }));
  const digest = bindingDigest({
    network: input.network,
    channelId: input.channelId,
    chaincodeName: input.chaincodeName,
    contractName: input.contractName,
    chainRef: profile.chainRef,
    envelopeVersion: B_ENVELOPE_VERSION,
    writerAuthority: input.writerAuthority,
    writerMspId: input.writerMspId,
    writerRole: 'relayer',
    governanceDigest: input.governanceDigest,
  });
  const existing = await tx.fabricNetworkBinding.findUnique({
    where: { digest },
  });
  if (existing)
    return {
      digest,
      chainRef: profile.chainRef,
      routeDigest: existing.routeDigest,
    };

  const route: RouteDefinition = {
    protocol: BINDING_ROUTE_PROTOCOL,
    mode: 'WRITE',
    network: input.network,
    channelId: input.channelId,
    chaincodeName: input.chaincodeName,
    contractName: input.contractName,
    envelopeVersion: B_ENVELOPE_VERSION,
    writerAuthority: input.writerAuthority,
    writerMspId: input.writerMspId,
    writerRole: 'relayer',
    chainRef: profile.chainRef,
    bindingDigest: digest,
  };
  const routeDigest = ledgerRouteDigest(route);
  await tx.ledgerRouteDefinition.create({
    data: {
      digest: routeDigest,
      protocol: route.protocol,
      mode: route.mode,
      network: route.network,
      channelId: route.channelId,
      chaincodeName: route.chaincodeName,
      contractName: route.contractName,
      envelopeVersion: route.envelopeVersion,
      writerAuthority: route.writerAuthority,
      writerMspId: route.writerMspId,
      writerRole: route.writerRole,
      chainRef: profile.chainRef,
      bindingDigest: digest,
    },
  });
  await tx.fabricNetworkBinding.create({
    data: {
      digest,
      chainId: input.chainId,
      chainRef: profile.chainRef,
      network: input.network,
      channelId: input.channelId,
      chaincodeName: input.chaincodeName,
      contractName: input.contractName,
      envelopeVersion: B_ENVELOPE_VERSION,
      writerAuthority: input.writerAuthority,
      writerMspId: input.writerMspId,
      writerRole: 'relayer',
      governanceDigest: input.governanceDigest,
      profile: input.profile,
      routeDigest,
    },
  });
  await tx.fabricBindingState.create({ data: { bindingDigest: digest } });
  return { digest, chainRef: profile.chainRef, routeDigest };
}

/** Mirrors an approved ledger credential (certificate fingerprint only). */
export async function recordCredential(
  tx: Prisma.TransactionClient,
  bindingDigestValue: string,
  certFingerprint: string,
) {
  return tx.fabricCredentialRevision.upsert({
    where: {
      bindingDigest_certFingerprint: {
        bindingDigest: bindingDigestValue,
        certFingerprint,
      },
    },
    create: { bindingDigest: bindingDigestValue, certFingerprint },
    update: {},
  });
}

export async function revokeCredentialRecord(
  tx: Prisma.TransactionClient,
  bindingDigestValue: string,
  certFingerprint: string,
) {
  return tx.fabricCredentialRevision.update({
    where: {
      bindingDigest_certFingerprint: {
        bindingDigest: bindingDigestValue,
        certFingerprint,
      },
    },
    data: { status: 'REVOKED', revokedAt: new Date() },
  });
}

/** Activation: the binding becomes the chain's active binding for NEW streams
 * and every currently valid chain grant is queued for ledger confirmation. */
export async function activateBinding(
  tx: Prisma.TransactionClient,
  digest: string,
) {
  const binding = await tx.fabricNetworkBinding.findUnique({
    where: { digest },
    include: { state: true },
  });
  if (!binding?.state) throw new NotFoundException('Không tìm thấy binding');
  if (
    !(await tx.fabricCredentialRevision.findFirst({
      where: { bindingDigest: digest, status: 'APPROVED' },
    }))
  )
    throw new ConflictException('Binding chưa có credential được phê duyệt');
  if (binding.state.status === 'PENDING')
    await tx.fabricBindingState.update({
      where: { bindingDigest: digest },
      data: {
        status: 'ACTIVE',
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });
  else if (binding.state.status === 'PAUSED')
    await tx.fabricBindingState.update({
      where: { bindingDigest: digest },
      data: {
        status: 'ACTIVE',
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });
  await tx.chainLedgerProfile.update({
    where: { chainId: binding.chainId },
    data: { activeBindingDigest: digest, version: { increment: 1 } },
  });
  const grants = await tx.scopedRoleGrant.findMany({
    where: {
      chainId: binding.chainId,
      scope: 'CHAIN',
      revokedAt: null,
      user: { accountStatus: 'ACTIVE' },
    },
  });
  let requested = 0;
  for (const grant of grants) {
    if (!ledgerEntityTypes(grant.role)) continue;
    const exists = await tx.ledgerPermission.findUnique({
      where: {
        bindingDigest_userId_role: {
          bindingDigest: digest,
          userId: grant.userId,
          role: grant.role,
        },
      },
      include: {
        epochs: { where: { grantId: grant.id }, select: { epoch: true } },
      },
    });
    if (exists?.epochs.length) continue;
    if (await requestLedgerGrant(tx, grant, digest)) requested += 1;
  }
  return { digest, chainId: binding.chainId, requestedPermissions: requested };
}

export async function setBindingPaused(
  tx: Prisma.TransactionClient,
  digest: string,
  paused: boolean,
) {
  const state = await tx.fabricBindingState.findUnique({
    where: { bindingDigest: digest },
  });
  if (!state) throw new NotFoundException('Không tìm thấy binding');
  const target = paused ? 'PAUSED' : 'ACTIVE';
  if (state.status === target) return state;
  return tx.fabricBindingState.update({
    where: { bindingDigest: digest },
    data: { status: target, version: { increment: 1 }, updatedAt: new Date() },
  });
}
