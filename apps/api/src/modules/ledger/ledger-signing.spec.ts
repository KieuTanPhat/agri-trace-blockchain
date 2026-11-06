import type {
  BindingLedgerClient,
  RegistryOperator,
} from '@agri-trace/fabric-gateway';
import { GatewayError } from '@hyperledger/fabric-gateway';
import { reconcileSigningKeyForRevocation } from './ledger-signing.js';

describe('Signing revocation reconciliation', () => {
  const key = {
    bindingDigest: 'ab'.repeat(32),
    keyRef: 'key',
    organizationId: 'organization',
    publicKey: 'public-key',
    popSignature: 'proof',
  };
  it('resumes the original registration after explicit absence, confirms it and returns for revocation', async () => {
    const absent = new GatewayError({ code: 10, cause: {} as never, message: 'evaluate failed',
      details: [{ address: 'peer0', mspId: 'AgritraceMSP', message: 'chaincode response 500, NOT_FOUND: key is absent' }] });
    const reader = { getRegistrySigningKey: vi.fn().mockRejectedValueOnce(absent).mockResolvedValue({ status: 'ACTIVE', orgRef: key.organizationId, publicKey: key.publicKey }) };
    const apply = vi.fn().mockResolvedValue({ proposalId: 'original', executedTxId: 'tx' });
    const operator = { apply } as unknown as RegistryOperator;
    const input = { reader, operator, approvers: ['AgritraceMSP'], key };
    expect(await reconcileSigningKeyForRevocation(input)).toBe(false);
    expect(apply).toHaveBeenCalledWith('SIGNING_KEY_REGISTER', expect.objectContaining({
      keyRef: key.keyRef, bindingDigest: key.bindingDigest, orgRef: key.organizationId, publicKey: key.publicKey, popSignature: key.popSignature,
    }), ['AgritraceMSP'], '0', expect.any(String));
    const originalNonce = apply.mock.calls[0][4];
    reader.getRegistrySigningKey.mockRejectedValueOnce(absent);
    expect(await reconcileSigningKeyForRevocation(input)).toBe(false);
    expect(apply.mock.calls[1][4]).toBe(originalNonce);
  });
  it('withdraws a registration committed before the Worker could activate the database key', async () => {
    const reader = {
      getRegistrySigningKey: vi
        .fn()
        .mockResolvedValue({
          status: 'ACTIVE',
          orgRef: key.organizationId,
          publicKey: key.publicKey,
        }),
    };
    const operator = { apply: vi.fn() };
    expect(
      await reconcileSigningKeyForRevocation({
        reader,
        operator: operator as unknown as RegistryOperator,
        approvers: ['AgritraceMSP'],
        key,
      }),
    ).toBe(false);
    expect(operator.apply).not.toHaveBeenCalled(); // Caller now executes the durable revoke job.
  });
  it('does not create a new registration or infer absence on an unavailable reader', async () => {
    const error = new Error('connection unavailable');
    const reader = { getRegistrySigningKey: vi.fn().mockRejectedValue(error) };
    const operator = { apply: vi.fn() };
    await expect(
      reconcileSigningKeyForRevocation({
        reader: reader as Pick<BindingLedgerClient, 'getRegistrySigningKey'>,
        operator: operator as unknown as RegistryOperator,
        approvers: ['AgritraceMSP'],
        key,
      }),
    ).rejects.toBe(error);
    expect(operator.apply).not.toHaveBeenCalled();
  });
  it('accepts a previously confirmed revoke but refuses a key belonging to another organization', async () => {
    const reader = {
      getRegistrySigningKey: vi
        .fn()
        .mockResolvedValue({
          status: 'REVOKED',
          orgRef: key.organizationId,
          publicKey: key.publicKey,
        }),
    };
    const operator = { apply: vi.fn() } as unknown as RegistryOperator;
    expect(
      await reconcileSigningKeyForRevocation({
        reader,
        operator,
        approvers: ['AgritraceMSP'],
        key,
      }),
    ).toBe(true);
    reader.getRegistrySigningKey.mockResolvedValue({
      status: 'REVOKED',
      orgRef: 'foreign-org',
      publicKey: key.publicKey,
    });
    await expect(
      reconcileSigningKeyForRevocation({
        reader,
        operator,
        approvers: ['AgritraceMSP'],
        key,
      }),
    ).rejects.toThrow('differs');
  });
});
