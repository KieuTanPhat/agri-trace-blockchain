import type { Prisma } from '../../generated/prisma/client.js';
import {
  activateBinding,
  recordCredential,
  registerBinding,
} from './ledger-bindings.js';
import { ledgerEntityTypes, requestLedgerGrant } from './ledger-permissions.js';

/** Development, test and CI rehearsal only: a binding that no Fabric network
 * ever confirmed. Events on it stay PENDING because no Worker delivers them.
 * Production must never hold such a binding (see assertSimulationAllowed). */
export const SIMULATED_NETWORK = 'simulated-ledger';
const SIMULATED_CREDENTIAL = '5e'.repeat(32);
const SIMULATED_GOVERNANCE = '00'.repeat(32);

/** Refuse to run against a database that holds any real binding. */
export async function assertSimulationAllowed(db: Prisma.TransactionClient) {
  const real = await db.fabricNetworkBinding.count({
    where: { network: { not: SIMULATED_NETWORK } },
  });
  if (real > 0)
    throw new Error(
      'Database holds a real Fabric binding; ledger simulation is refused',
    );
}

/** Give one chain an ACTIVE simulated binding (idempotent). Isolated test
 * databases that also hold fixture bindings pass `guard: false`. */
export async function simulateChainBinding(
  tx: Prisma.TransactionClient,
  chainId: string,
  { guard = true } = {},
) {
  if (guard) await assertSimulationAllowed(tx);
  const profile = await tx.chainLedgerProfile.findUnique({
    where: { chainId },
  });
  if (profile?.activeBindingDigest) return profile.activeBindingDigest;
  const { digest } = await registerBinding(tx, {
    chainId,
    network: SIMULATED_NETWORK,
    channelId: 'simulated',
    chaincodeName: 'agritrace',
    contractName: 'AgriTraceContract',
    writerAuthority: 'simulated-relayer',
    writerMspId: 'SimulatedMSP',
    governanceDigest: SIMULATED_GOVERNANCE,
    profile: 'SERVICE',
  });
  await recordCredential(tx, digest, SIMULATED_CREDENTIAL);
  await activateBinding(tx, digest);
  return digest;
}

/** Apply requested grants and revokes on simulated bindings the way the
 * Worker does after a ledger commit (REQUESTED -> PENDING_LEDGER -> ACTIVE;
 * REVOKE_REQUESTED -> DRAINING -> PENDING_REVOKE_LEDGER -> REVOKED). No event
 * ever reaches a simulated ledger, so there is nothing to drain. */
export async function confirmSimulatedPermissions(
  tx: Prisma.TransactionClient,
  { guard = true } = {},
) {
  if (guard) await assertSimulationAllowed(tx);
  const jobs = await tx.ledgerControlJob.findMany({
    where: {
      status: 'PENDING',
      operation: { in: ['PERMISSION_GRANT', 'PERMISSION_REVOKE'] },
      binding: { network: SIMULATED_NETWORK },
    },
    orderBy: { createdAt: 'asc' },
  });
  let confirmed = 0;
  for (const job of jobs) {
    if (!job.permissionRef || job.epoch === null) continue;
    const sync = await tx.ledgerPermissionSync.findUnique({
      where: { permissionRef: job.permissionRef },
    });
    const step = (data: Prisma.LedgerPermissionSyncUpdateInput) =>
      tx.ledgerPermissionSync.update({
        where: { permissionRef: job.permissionRef! },
        data: { ...data, version: { increment: 1 } },
      });
    if (sync?.requestedEpoch !== job.epoch) {
      // Superseded by a later request; the Worker records the same outcome.
    } else if (
      job.operation === 'PERMISSION_GRANT' &&
      sync.state === 'REQUESTED'
    ) {
      await step({ state: 'PENDING_LEDGER' });
      await step({ state: 'ACTIVE', confirmedEpoch: job.epoch });
      confirmed += 1;
    } else if (
      job.operation === 'PERMISSION_REVOKE' &&
      sync.state === 'REVOKE_REQUESTED'
    ) {
      await step({ state: 'DRAINING' });
      await step({ state: 'PENDING_REVOKE_LEDGER' });
      await step({ state: 'REVOKED' });
      confirmed += 1;
    }
    await tx.ledgerControlJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        receipt: { simulated: true },
        updatedAt: new Date(),
      },
    });
  }
  return confirmed;
}

/** Request ledger grants for chain role grants written directly to the
 * database (operator setup, demo seed) on simulated bindings, as the API does
 * when it grants a role. */
export async function requestMissingSimulatedGrants(
  tx: Prisma.TransactionClient,
) {
  const grants = await tx.scopedRoleGrant.findMany({
    where: {
      scope: 'CHAIN',
      revokedAt: null,
      user: { accountStatus: 'ACTIVE' },
      chain: {
        ledgerProfile: {
          activeBinding: { network: SIMULATED_NETWORK },
        },
      },
    },
  });
  let requested = 0;
  for (const grant of grants) {
    if (!ledgerEntityTypes(grant.role)) continue;
    if (await tx.ledgerPermissionEpoch.findUnique({ where: { grantId: grant.id } }))
      continue;
    if (await requestLedgerGrant(tx, grant)) requested += 1;
  }
  return requested;
}

/** Bind every chain without an active binding, then confirm grants. */
export async function simulateLedger(tx: Prisma.TransactionClient) {
  await assertSimulationAllowed(tx);
  const chains = await tx.supplyChain.findMany({
    where: {
      OR: [
        { ledgerProfile: null },
        { ledgerProfile: { activeBindingDigest: null } },
      ],
    },
    select: { id: true },
  });
  for (const chain of chains) await simulateChainBinding(tx, chain.id);
  const requestedGrants = await requestMissingSimulatedGrants(tx);
  return {
    boundChains: chains.length,
    requestedGrants,
    confirmedPermissions: await confirmSimulatedPermissions(tx),
  };
}
