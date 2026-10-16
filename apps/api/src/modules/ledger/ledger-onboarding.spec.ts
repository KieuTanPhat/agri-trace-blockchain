import { describe, expect, it, vi } from 'vitest';
import type { BindingLedgerClient, RegistryOperator } from '@agri-trace/fabric-gateway';
import { onboardBindingOnLedger } from './ledger-onboarding.js';

describe('Ledger onboarding stable proposal identity', () => {
  it('resumes the same bootstrap/binding/credential proposals after an unknown response', async () => {
    const apply = vi.fn().mockResolvedValue({ proposalId: 'p' });
    const input = {
      operator: { apply } as unknown as RegistryOperator,
      reader: { health: vi.fn().mockResolvedValue({ governanceDigest: 'a'.repeat(64), channelPolicy: null }) } as unknown as BindingLedgerClient,
      channelId: 'hybrid-hosted', approvers: ['Org1MSP', 'Org2MSP'],
      binding: { digest: 'b'.repeat(64), network: 'hosted', chaincodeName: 'agritrace', contractName: 'AgriTraceContract',
        chainRef: '55690720-e988-4a97-8ef9-4f9c35c34b98', writerAuthority: 'hosted-relayer', writerMspId: 'Org1MSP', governanceDigest: 'a'.repeat(64) },
      relayerFingerprint: 'c'.repeat(64),
    };
    await onboardBindingOnLedger(input);
    await onboardBindingOnLedger(input);
    const calls = apply.mock.calls as unknown as Array<[string, unknown, string[], string, string]>;
    expect(calls.slice(0, 3).map((row) => row[4])).toEqual(calls.slice(3).map((row) => row[4]));
    await onboardBindingOnLedger({ ...input, binding: { ...input.binding, digest: 'd'.repeat(64) } });
    expect(calls[0]?.[4]).toBe(calls[6]?.[4]);
    expect(calls[1]?.[4]).not.toBe(calls[7]?.[4]);
  });
});
