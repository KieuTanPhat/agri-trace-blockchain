import { describe, expect, it } from 'vitest';
import {
  intentDigest,
  keyPopMessage,
  payloadDigest,
  signedMessageForIntent,
  verifyEd25519,
  type IntentBody,
} from '../trace/signed-commitment.js';
import {
  generateSignerKey,
  publicKeyOf,
  registrationBody,
  SignerRefusal,
  signPreparedIntent,
  type PreparedIntentInput,
} from './org-signer.js';

const u = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BINDING = 'ab'.repeat(32);

function prepared(keyRef: string, now = Date.now()): PreparedIntentInput {
  const payload = { handoverId: u(40), quantity: '2.000' };
  const intent: IntentBody = {
    protocol: 'agritrace-intent/1',
    intentId: u(30),
    chainRef: u(3),
    bindingDigest: BINDING,
    signerOrgRef: u(21),
    keyRef,
    operation: 'HANDOVER_OFFER',
    entityType: 'SHIPMENT',
    entityId: u(2),
    eventId: u(1),
    eventType: 'HANDOVER_OFFERED',
    expectedVersion: '0',
    payloadDigest: payloadDigest(payload),
    notAfter: new Date(now + 60_000).toISOString(),
    policyVersion: '1',
  };
  return {
    intentId: intent.intentId,
    operation: 'HANDOVER_OFFER',
    keyRef,
    expiresAt: intent.notAfter,
    intent,
    payload,
    intentDigest: intentDigest(intent),
    signedMessage: signedMessageForIntent(intent).toString('base64url'),
  };
}

describe('Reference organization signer', () => {
  it('registers a key whose proof of possession verifies for the exact binding and organization', () => {
    const { privatePem, publicKey } = generateSignerKey();
    expect(publicKeyOf(privatePem)).toBe(publicKey);
    const body = registrationBody(privatePem, {
      bindingDigest: BINDING,
      organizationId: u(21),
      label: 'Dịch vụ ký',
      keyRef: u(20),
    });
    expect(Object.keys(body).sort()).toEqual([
      'keyRef',
      'label',
      'popSignature',
      'publicKey',
    ]);
    const message = (orgRef: string) =>
      keyPopMessage({
        bindingDigest: BINDING,
        keyRef: u(20),
        orgRef,
        publicKey,
      });
    expect(verifyEd25519(publicKey, message(u(21)), body.popSignature)).toBe(
      true,
    );
    expect(verifyEd25519(publicKey, message(u(22)), body.popSignature)).toBe(
      false,
    );
  });

  it('signs a prepared intent only after re-deriving it, and the signature verifies', () => {
    const { privatePem, publicKey } = generateSignerKey();
    const request = prepared(u(20));
    const { signature } = signPreparedIntent(privatePem, request);
    expect(
      verifyEd25519(
        publicKey,
        signedMessageForIntent(request.intent),
        signature,
      ),
    ).toBe(true);
  });

  it('refuses tampered payloads, digests, messages, keys and expired requests', () => {
    const { privatePem } = generateSignerKey();
    const request = prepared(u(20));
    const refuse = (value: PreparedIntentInput, now?: number) =>
      expect(() => signPreparedIntent(privatePem, value, now)).toThrow(
        SignerRefusal,
      );
    refuse({
      ...request,
      payload: { ...request.payload, quantity: '900.000' },
    });
    refuse({ ...request, intentDigest: 'cd'.repeat(32) });
    refuse({ ...request, signedMessage: 'AAAA' });
    refuse({ ...request, keyRef: u(99) });
    refuse({ ...request, operation: 'HANDOVER_CONFIRM' });
    refuse({ ...request, expiresAt: 'invalid-date' });
    refuse(request, Date.now() + 120_000);
    refuse({ ...request, intent: { ...request.intent, extra: 'x' } as never });
  });
  it('refuses a non-finite expiry (the shared encoder cannot even digest it)', () => {
    const { privatePem } = generateSignerKey();
    const request = prepared(u(20));
    const intent = { ...request.intent, notAfter: 'invalid-date' };
    expect(() =>
      signPreparedIntent(privatePem, { ...request, intent, expiresAt: intent.notAfter }),
    ).toThrow(SignerRefusal);
  });
  it('checks independently reviewed chain, binding, organization, key, entity and operation', () => {
    const { privatePem } = generateSignerKey();
    const request = prepared(u(20));
    const expected = { chainRef: request.intent.chainRef, bindingDigest: BINDING, signerOrgRef: u(21),
      keyRef: u(20), entityType: 'SHIPMENT', entityId: u(2), operation: 'HANDOVER_OFFER' };
    expect(signPreparedIntent(privatePem, request, Date.now(), expected).signature).toBeTruthy();
    for (const field of Object.keys(expected))
      expect(() => signPreparedIntent(privatePem, request, Date.now(), { ...expected, [field]: 'another-context' })).toThrow('reviewed context');
  });
});
