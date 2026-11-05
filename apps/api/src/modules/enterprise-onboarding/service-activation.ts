import { ConflictException } from '@nestjs/common';
import type { OrganizationType, Prisma } from '../../generated/prisma/client.js';
import { chainOwner } from './registration-profile.dto.js';
import { enterprisePaymentsEnabled } from './payment-policy.js';
import { ensurePersonalChain } from '../supply-chains/personal-chain.js';
import { acceptPartnerInvitation } from '../supply-chains/partner-invitations.js';

async function grantOrganizationRole(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
  role: 'ORG_ADMIN' | 'CREATE_CHAIN',
) {
  if (
    !(await tx.scopedRoleGrant.findFirst({
      where: { userId, organizationId, scope: 'ORGANIZATION', role, revokedAt: null },
    }))
  )
    await tx.scopedRoleGrant.create({
      data: { userId, organizationId, scope: 'ORGANIZATION', role },
    });
}

/** CREATE_CHAIN belongs to an activated chain owner whose subscription is
 * ACTIVE, or to any activated chain owner while collection is deferred
 * (ADR-005). Idempotent; called by activation and by invoice settlement. */
export async function grantChainCreation(
  tx: Prisma.TransactionClient,
  organizationId: string,
) {
  const org = await tx.organization.findUniqueOrThrow({
    where: { id: organizationId },
    include: { enterpriseEnrollment: true },
  });
  const enrollment = org.enterpriseEnrollment;
  if (!chainOwner(org.participationStatus) || !enrollment?.serviceActivatedAt)
    return false;
  if (
    enterprisePaymentsEnabled() &&
    !(await tx.subscription.findFirst({
      where: { organizationId, status: 'ACTIVE' },
    }))
  )
    return false;
  await grantOrganizationRole(tx, organizationId, enrollment.ownerId, 'CREATE_CHAIN');
  return true;
}

/** Capabilities that keep their own free ledger: a farm records its cycles,
 * a retailer or distributor records goods bought outside AgriTrace. */
export const OWN_LEDGER_CAPABILITIES = ['FARM', 'RETAILER', 'DISTRIBUTOR'] as const;

/** Gives an organization with one of those capabilities its own ledger, for
 * members and chain owners alike. Idempotent. */
export async function ensureOwnLedger(
  tx: Prisma.TransactionClient,
  row: { organizationId: string; ownerId: string },
) {
  if (
    await tx.organizationCapability.findFirst({
      where: { organizationId: row.organizationId, code: { in: [...OWN_LEDGER_CAPABILITIES] }, revokedAt: null },
    })
  )
    await ensurePersonalChain(tx, row);
}

/** Called only within the activation journal transaction. Grants the
 * capabilities an administrator approved one by one; enrollments created before
 * per-capability review keep their registered activities. Activation gives
 * ORG_ADMIN; chain creation follows the participation status. */
async function grantEnterpriseBusiness(
  tx: Prisma.TransactionClient,
  row: { organizationId: string; ownerId: string },
) {
  const org = await tx.organization.findUniqueOrThrow({
    where: { id: row.organizationId },
    include: { profile: true, capabilityRequests: true },
  });
  const reviewed = org.capabilityRequests.length > 0;
  const codes = reviewed
    ? org.capabilityRequests
        .filter((r) => r.status === 'APPROVED')
        .map((r) => r.code)
    : ((org.profile?.activities ?? [org.type]) as OrganizationType[]);
  if (!codes.length)
    throw new ConflictException('Chưa có năng lực nào được phê duyệt');
  for (const code of codes)
    if (
      !(await tx.organizationCapability.findFirst({
        where: { organizationId: org.id, code, revokedAt: null },
      }))
    )
      await tx.organizationCapability.create({
        data: { organizationId: org.id, code },
      });
  await grantOrganizationRole(tx, org.id, row.ownerId, 'ORG_ADMIN');
  await ensureOwnLedger(tx, row);
}

/** Shared activation step (admin activation, or a chain owner's payment):
 * marks the enrollment active, grants reviewed capabilities and ORG_ADMIN,
 * turns a pending partner invitation into a chain invitation and grants
 * CREATE_CHAIN when the participation status allows it. */
export async function activateEnrollmentTx(
  tx: Prisma.TransactionClient,
  row: {
    id: string;
    organizationId: string;
    ownerId: string;
    organization: { profile?: { registrationData?: unknown } | null };
  },
  by: string | null,
  reason: string,
) {
  await tx.enterpriseEnrollment.update({
    where: { id: row.id },
    data: { serviceActivatedAt: new Date(), serviceActivatedBy: by, serviceActivationReason: reason, version: { increment: 1 } },
  });
  await grantEnterpriseBusiness(tx, row);
  await acceptPartnerInvitation(
    tx,
    row.organizationId,
    (row.organization.profile?.registrationData as { invitationHash?: string | null } | null)?.invitationHash,
  );
  return grantChainCreation(tx, row.organizationId);
}
