import { createHash } from 'node:crypto';
import type {
  BindingLedgerClient,
  RegistryOperator,
} from '@agri-trace/fabric-gateway';
import type {
  HandoverMode,
  PrismaClient,
  SigningKey,
} from '../../generated/prisma/client.js';

type Db = Pick<
  PrismaClient,
  '$transaction' | 'signingKey' | 'chainLedgerProfile' | 'ledgerControlJob'
>;

/** Same shape as the onboarding nonce: retries after a lost response resume
 * the very same ledger proposal instead of creating a second one. */
function stableUuid(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** Registers an organization key in the ledger registry with the approvals
 * the reviewed governance descriptor demands (writer MSP and owner MSP), then
 * reads the record back: the DB never trusts a call that was not confirmed. */
export async function registerSigningKeyOnLedger(input: {
  operator: RegistryOperator;
  reader: BindingLedgerClient;
  approvers: string[];
  key: Pick<
    SigningKey,
    'bindingDigest' | 'keyRef' | 'organizationId' | 'publicKey' | 'popSignature'
  >;
}) {
  const { key } = input;
  const view = await input.operator.apply(
    'SIGNING_KEY_REGISTER',
    {
      bindingDigest: key.bindingDigest,
      keyRef: key.keyRef,
      orgRef: key.organizationId,
      algorithm: 'Ed25519',
      publicKey: key.publicKey,
      popSignature: key.popSignature,
    },
    input.approvers,
    '0',
    stableUuid(`signing-key:${key.keyRef}`),
  );
  const onLedger = (await input.reader.getRegistrySigningKey(
    key.bindingDigest,
    key.keyRef,
  )) as { status: string; publicKey: string; orgRef: string };
  if (
    onLedger.status !== 'ACTIVE' ||
    onLedger.publicKey !== key.publicKey ||
    onLedger.orgRef !== key.organizationId
  )
    throw new Error('Ledger signing key differs from the database record');
  return { proposalId: view.proposalId, txId: view.executedTxId ?? null };
}

/** Marks a ledger-confirmed key ACTIVE. If it was revoked while the operator
 * was registering it, the ledger copy is withdrawn through a control job. */
export async function activateSigningKey(db: Db, keyRef: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT key_ref FROM signing_key WHERE key_ref = ${keyRef}::uuid FOR UPDATE`;
    const key = await tx.signingKey.findUniqueOrThrow({ where: { keyRef } });
    if (key.status === 'ACTIVE') return { status: 'ACTIVE' as const };
    if (key.status === 'REVOKED') {
      await tx.ledgerControlJob.create({
        data: {
          bindingDigest: key.bindingDigest,
          operation: 'SIGNING_KEY_REVOKE',
          signingKeyRef: key.keyRef,
          expectedRevision: 1,
        },
      });
      return { status: 'REVOKED' as const, revokeQueued: true };
    }
    await tx.signingKey.update({
      where: { keyRef },
      data: {
        status: 'ACTIVE',
        activatedAt: new Date(),
        version: { increment: 1 },
      },
    });
    return { status: 'ACTIVE' as const };
  });
}

/** Switches the handover protocol of new shipments on a chain. The database
 * refuses it while a handover is open or without an ACTIVE signing key. */
export async function setHandoverMode(
  db: Db,
  chainId: string,
  mode: HandoverMode,
) {
  return db.$transaction((tx) =>
    tx.chainLedgerProfile.update({
      where: { chainId },
      data: { handoverMode: mode, version: { increment: 1 } },
    }),
  );
}
