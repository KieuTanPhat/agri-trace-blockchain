import { createHash, randomUUID } from 'node:crypto';
import type {
  BindingLedgerClient,
  RegistryOperator,
} from '@agri-trace/fabric-gateway';
import type { Prisma } from '../../generated/prisma/client.js';
import { recordCredential } from './ledger-bindings.js';

export interface OnboardInput {
  /** Operator with the controller and every governed MSP admin. */
  operator: RegistryOperator;
  /** Any client on the channel (reads the chaincode health/registry). */
  reader: BindingLedgerClient;
  channelId: string;
  /** MSPs that must approve registry changes on this channel, e.g. writer + owner. */
  approvers: string[];
  binding: {
    digest: string;
    network: string;
    chaincodeName: string;
    contractName: string;
    chainRef: string;
    writerAuthority: string;
    writerMspId: string;
    governanceDigest: string;
  };
  /** SHA-256 fingerprint of the relayer certificate to approve. */
  relayerFingerprint: string;
}

/** Brings one binding up on the ledger: channel bootstrap (once), binding
 * registration and relayer credential approval, each with the approvals the
 * reviewed governance descriptor demands. Idempotent: every step names a stable
 * nonce, so a rerun after a lost response converges instead of duplicating. */
export async function onboardBindingOnLedger(input: OnboardInput) {
  const health = (await input.reader.health()) as {
    governanceDigest: string;
    channelPolicy: unknown;
  };
  if (health.governanceDigest !== input.binding.governanceDigest)
    throw new Error(
      'Binding governance digest differs from the deployed chaincode',
    );
  const nonce = (label: string) =>
    // Deterministic nonce per (binding, step) so retries resume the same proposal.
    [8, 4, 4, 4, 12]
      .reduce<{ parts: string[]; rest: string }>(
        (acc, size) => ({
          parts: [...acc.parts, acc.rest.slice(0, size)],
          rest: acc.rest.slice(size),
        }),
        { parts: [], rest: stableHex(`${input.binding.digest}:${label}`) },
      )
      .parts.join('-');
  const steps: string[] = [];
  if (!health.channelPolicy) {
    await input.operator.apply(
      'CHANNEL_BOOTSTRAP',
      { channelId: input.channelId, strictB: true, allowLegacyV3Writes: false },
      input.approvers,
      '0',
      randomUUID(),
    );
    steps.push('CHANNEL_BOOTSTRAP');
  }
  const tuple = {
    network: input.binding.network,
    channelId: input.channelId,
    chaincodeName: input.binding.chaincodeName,
    contractName: input.binding.contractName,
    chainRef: input.binding.chainRef,
    envelopeVersion: '4.0.0',
    writerAuthority: input.binding.writerAuthority,
    writerMspId: input.binding.writerMspId,
    writerRole: 'relayer',
    governanceDigest: input.binding.governanceDigest,
  };
  await input.operator.apply(
    'BINDING_REGISTER',
    { binding: tuple, bindingDigest: input.binding.digest },
    input.approvers,
    '0',
    nonce('binding'),
  );
  steps.push('BINDING_REGISTER');
  await input.operator.apply(
    'CREDENTIAL_APPROVE',
    {
      bindingDigest: input.binding.digest,
      authority: input.binding.writerAuthority,
      certFingerprint: input.relayerFingerprint,
    },
    input.approvers,
    '0',
    nonce(`credential:${input.relayerFingerprint}`),
  );
  steps.push('CREDENTIAL_APPROVE');
  return steps;
}

/** Mirror the ledger credential in PostgreSQL (fingerprint only). */
export function mirrorCredential(
  tx: Prisma.TransactionClient,
  bindingDigest: string,
  fingerprint: string,
) {
  return recordCredential(tx, bindingDigest, fingerprint);
}

function stableHex(value: string): string {
  // 32 hex chars (UUID shape) derived from SHA-256; identity only, not a secret.
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}
