import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assertionDigest,
  intentDigest,
  intentSignedMessage,
  keyPopMessage,
  parseEd25519PublicKey,
  payloadDigest,
  publicKeyHash,
  signedBindingEventCommitment,
  signedMessageForIntent,
  verifyEd25519,
  type IntentBody,
  type SignatureAssertion,
} from './signed-commitment.js';

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Same fixed binding as the chaincode design vectors.
const BINDING = 'f34a78fd87c5dd0ef133144774c919732c8c81095903d4e2f352a3b0756a4ce0';

export function testKey(seedByte: number) {
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.alloc(32, seedByte)]),
    format: 'der',
    type: 'pkcs8',
  });
  return {
    publicKey: createPublicKey(privateKey)
      .export({ format: 'der', type: 'spki' })
      .toString('base64url'),
    sign: (message: Buffer) =>
      sign(null, message, privateKey).toString('base64url'),
  };
}

describe('Release C commitments (API side)', () => {
  // Literals below are the chaincode design vectors (blockchain/chaincode
  // test/signing.spec.ts). Any divergence fails both suites.
  const signer = testKey(7);
  const intent = 'aa'.repeat(32);
  const assertion = (): SignatureAssertion => ({
    algorithm: 'Ed25519',
    keyRef: u(20),
    intentDigest: intent,
    signature: signer.sign(
      intentSignedMessage({
        intentDigest: intent,
        chainRef: u(3),
        eventId: u(1),
        entityType: 'SHIPMENT',
        entityId: u(2),
        eventType: 'HANDOVER_OFFERED',
        bindingDigest: BINDING,
        keyRef: u(20),
      }),
    ),
  });

  it('matches the shared key, proof-of-possession, signature, assertion and commitment vectors', () => {
    expect(signer.publicKey).toBe(
      'MCowBQYDK2VwAyEA6kpsY-KcUgq-9VB7Ey7F-ZVHdq6-vnuSQh7qaRRG0iw',
    );
    expect(
      signer.sign(
        keyPopMessage({
          bindingDigest: BINDING,
          keyRef: u(20),
          orgRef: u(21),
          publicKey: signer.publicKey,
        }),
      ),
    ).toBe(
      'CMhZFan-e2_lrh2vVmrPuTt8S1GaROSKEqtHANDyTtoBJRLJiX8mygXGIh4JByrfIjQoGp4fhu-Pji7kC7CnCg',
    );
    expect(assertion().signature).toBe(
      'vTr8BYI5j0z1tMW7R35pw7Nq1duFt5pfKvETCM8HHnWYg6oVOXGMb_MGvG4pQYGUMJNKCx-7YuOFtEI6C7JyCA',
    );
    expect(assertionDigest(assertion())).toBe(
      'e7134283211249c385eeea22d98e92dbe6443a33420c7d43b3acc8a5662391bb',
    );
    expect(
      signedBindingEventCommitment(
        {
          eventId: u(1),
          entityType: 'SHIPMENT',
          entityId: u(2),
          cycleId: u(7),
          lotId: u(8),
          eventType: 'HANDOVER_OFFERED',
          eventTime: new Date('2026-10-13T00:00:00.000Z'),
          previousEventHash: null,
          bindingDigest: BINDING,
          chainRef: u(3),
          permissions: [{ permissionRef: u(5), epoch: '1', ordinal: '1' }],
        },
        'cd'.repeat(32),
        {
          keyRef: u(20),
          intentDigest: intent,
          assertionDigest: assertionDigest(assertion()),
        },
      ),
    ).toBe('3c7b39789afc0f7d3ac1da7dd5c593c0d5f3c022a60160489db7c7cc9cd43c65');
  });

  it('accepts only canonical Ed25519 keys and verifies signatures strictly', () => {
    const message = Buffer.from('message');
    const signature = signer.sign(message);
    expect(verifyEd25519(signer.publicKey, message, signature)).toBe(true);
    expect(verifyEd25519(signer.publicKey, Buffer.from('x'), signature)).toBe(
      false,
    );
    expect(verifyEd25519(testKey(8).publicKey, message, signature)).toBe(false);
    expect(verifyEd25519(signer.publicKey, message, 'not-a-signature')).toBe(
      false,
    );
    expect(() => parseEd25519PublicKey('AAAA')).toThrow();
    expect(() =>
      parseEd25519PublicKey(Buffer.alloc(44, 1).toString('base64url')),
    ).toThrow();
    expect(publicKeyHash(signer.publicKey)).toMatch(/^[a-f0-9]{64}$/);
  });

  const body = (): IntentBody => ({
    protocol: 'agritrace-intent/1',
    intentId: u(30),
    chainRef: u(3),
    bindingDigest: BINDING,
    signerOrgRef: u(21),
    keyRef: u(20),
    operation: 'HANDOVER_OFFER',
    entityType: 'SHIPMENT',
    entityId: u(2),
    eventId: u(1),
    eventType: 'HANDOVER_OFFERED',
    expectedVersion: '3',
    payloadDigest: payloadDigest({ handoverId: u(40), quantity: '100.000' }),
    notAfter: '2026-10-14T00:00:00.000Z',
    policyVersion: '1',
  });

  it('digests intents deterministically, independent of key order', () => {
    const reordered = Object.fromEntries(
      Object.entries(body()).reverse(),
    ) as IntentBody;
    expect(intentDigest(reordered)).toBe(intentDigest(body()));
    expect(payloadDigest({ b: '2', a: '1' })).toBe(
      payloadDigest({ a: '1', b: '2' }),
    );
  });

  it('rejects malformed intents so nothing odd is ever signed', () => {
    const bad = (patch: Partial<IntentBody>) =>
      expect(() => intentDigest({ ...body(), ...patch })).toThrow();
    bad({ expectedVersion: '03' });
    bad({ expectedVersion: '-1' });
    bad({ notAfter: '2026-10-14T00:00:00Z' });
    bad({ entityId: 'not-a-uuid' });
    bad({ payloadDigest: 'zz' });
    bad({ protocol: 'agritrace-intent/2' as never });
    expect(() =>
      intentDigest({ ...body(), extra: 'x' } as unknown as IntentBody),
    ).toThrow();
    expect(() => payloadDigest({ n: 1 as unknown as string })).toThrow();
  });

  it('binds the signature to the event identity, so no field can be swapped', () => {
    const message = signedMessageForIntent(body());
    const signature = signer.sign(message);
    const check = (patch: Partial<IntentBody>) =>
      verifyEd25519(
        signer.publicKey,
        signedMessageForIntent({ ...body(), ...patch }),
        signature,
      );
    expect(check({})).toBe(true);
    expect(check({ eventId: u(99) })).toBe(false);
    expect(check({ entityId: u(98) })).toBe(false);
    expect(check({ chainRef: u(97) })).toBe(false);
    expect(check({ expectedVersion: '4' })).toBe(false);
    expect(check({ payloadDigest: payloadDigest({ other: 'x' }) })).toBe(false);
    expect(check({ keyRef: u(96) })).toBe(false);
    expect(check({ eventType: 'HANDOVER_CONFIRMED' })).toBe(false);
  });
});
