import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TestSigner } from '../../../test/support/signer.js';
import {
  bindingEventCommitment,
  privateBodyDigest,
} from './binding-commitment.js';
import {
  assertionDigest,
  intentDigest,
  payloadDigest,
  signedBindingEventCommitment,
  signedMessageForIntent,
  signedMetadataDigest,
  signedPrivateBodyDigest,
  type IntentBody,
  type IntentPayload,
} from './signed-commitment.js';
import { calculateTraceEventHash } from './trace-hash.js';
import {
  privateTraceEvidenceMatches,
  publicBlockchainDeliveryError,
  type EvidenceEvent,
} from './trace-evidence.js';

describe('public blockchain diagnostics', () => {
  it('does not return raw worker errors to API consumers', () => {
    const response = publicBlockchainDeliveryError(
      'gateway failed with token=private-value',
    );
    expect(response).toBeTruthy();
    expect(response).not.toContain('private-value');
    expect(response).not.toContain('token=');
  });

  it.each([null, undefined, ''])('returns null for %s', (diagnostic) => {
    expect(publicBlockchainDeliveryError(diagnostic)).toBeNull();
  });
});

const u = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BINDING = 'ab'.repeat(32);
const CHAIN_REF = u(3);
const TOKEN_FINGERPRINT = createHash('sha256')
  .update('user:ROLE')
  .digest('hex');
const signer = TestSigner.fromSeed(5);

const base = {
  id: u(1),
  entityType: 'SHIPMENT',
  entityId: u(2),
  cycleId: u(7),
  lotId: u(8),
  eventType: 'HANDOVER_OFFERED',
  eventTime: new Date('2026-10-13T00:00:00.000Z'),
  actorUserId: u(9),
  actorOrganizationId: u(10),
  actorRole: 'FARM_STAFF',
  authProofType: 'TOKEN_FINGERPRINT',
  actorAuthProof: TOKEN_FINGERPRINT,
  previousEventHash: null,
  canonicalizationVersion: 'RFC8785',
};

/** A retired release-A shape: plain V2 hash, no binding commitment. */
function retiredReleaseA(): EvidenceEvent {
  const event = {
    ...base,
    businessData: { note: 'plain' },
    schemaVersion: '2.0.0',
  };
  return { ...event, dataHash: calculateTraceEventHash(event) };
}

const permissions = [{ permissionRef: u(5), epoch: 1, ordinal: 1n }];
const bindingContext = (
  privateDigest: string,
  version: 'b1' | 'c2',
) => ({
  bindingDigest: BINDING,
  privateBodyDigest: privateDigest,
  commitmentVersion: version,
  binding: { chainRef: CHAIN_REF, digest: BINDING },
  permissions,
});
const publicContext = () => ({
  eventId: base.id,
  entityType: base.entityType,
  entityId: base.entityId,
  cycleId: base.cycleId,
  lotId: base.lotId,
  eventType: base.eventType,
  eventTime: base.eventTime,
  previousEventHash: null,
  bindingDigest: BINDING,
  chainRef: CHAIN_REF,
  permissions: [{ permissionRef: u(5), epoch: '1', ordinal: '1' }],
});

function releaseB(): EvidenceEvent {
  const event = {
    ...base,
    eventType: 'CARE_RECORDED',
    entityType: 'CARE',
    businessData: { note: 'care' },
    schemaVersion: '2.0.0',
  };
  const digest = privateBodyDigest(event);
  const context = {
    ...publicContext(),
    eventType: 'CARE_RECORDED',
    entityType: 'CARE',
  };
  return {
    ...event,
    schemaVersion: '3.0.0',
    dataHash: bindingEventCommitment(context, digest),
    bindingContext: bindingContext(digest, 'b1'),
  };
}

/** A release-C event built the same way TraceService builds it. */
function releaseC(
  mutate: (parts: {
    intent: IntentBody;
    payload: IntentPayload;
    signature: string;
  }) => void = () => undefined,
) {
  const payload: IntentPayload = { handoverId: u(40), quantity: '100.000' };
  const intent: IntentBody = {
    protocol: 'agritrace-intent/2',
    intentId: u(30),
    chainRef: CHAIN_REF,
    bindingDigest: BINDING,
    signerOrgRef: u(10),
    keyRef: u(20),
    operation: 'HANDOVER_OFFER',
    entityType: base.entityType,
    entityId: base.entityId,
    eventId: base.id,
    eventType: base.eventType,
    expectedVersion: '3',
    payloadDigest: payloadDigest(payload),
    notAfter: '2026-10-14T00:00:00.000Z',
    policyVersion: '2',
  };
  const signature = signer.signIntent(intent);
  const parts = { intent, payload, signature };
  mutate(parts);
  const assertion = {
    algorithm: 'Ed25519' as const,
    keyRef: u(20),
    intentDigest: intentDigest(parts.intent),
    signature: parts.signature,
    payloadDigest: parts.intent.payloadDigest,
  };
  const event = {
    ...base,
    businessData: {
      handoverId: u(40),
      quantity: '100.000',
      actorSignature: {
        intent: parts.intent,
        payload: parts.payload,
        assertion,
        signerOrgId: u(10),
      },
    },
    schemaVersion: '2.0.0',
  };
  const sidecar = {
    keyRef: u(20),
    intentDigest: assertion.intentDigest,
    assertionDigest: assertionDigest(assertion),
    signature: parts.signature,
    algorithm: 'Ed25519',
    key: { publicKey: signer.publicKey, organizationId: u(10) },
  };
  const content = {
    payloadDigest: parts.intent.payloadDigest,
    metadataDigest: signedMetadataDigest(event),
    assertionDigest: sidecar.assertionDigest,
  };
  const digest = signedPrivateBodyDigest(content);
  return {
    ...event,
    schemaVersion: '5.0.0',
    dataHash: signedBindingEventCommitment(publicContext(), digest, {
      ...sidecar,
      ...content,
    }),
    bindingContext: {
      ...bindingContext(digest, 'c2'),
      event: { actorSignature: sidecar },
    },
  } as EvidenceEvent;
}

describe('Version-dispatched trace evidence', () => {
  it('verifies B (3.0.0) events and rejects the retired release-A shape', () => {
    expect(privateTraceEvidenceMatches(releaseB())).toBe(true);
    expect(privateTraceEvidenceMatches(retiredReleaseA())).toBe(false);
  });

  it('fails closed on unknown versions and on non-fingerprint actor evidence', () => {
    expect(
      privateTraceEvidenceMatches({ ...releaseB(), schemaVersion: '9.0.0' }),
    ).toBe(false);
    // A real signature is never accepted through the fingerprint field.
    const forged = { ...releaseB(), actorAuthProof: 'signature'.repeat(10) };
    expect(privateTraceEvidenceMatches(forged)).toBe(false);
  });

  it('verifies a signed release-C event end to end', () => {
    expect(privateTraceEvidenceMatches(releaseC())).toBe(true);
  });

  it('rejects substituted c2 business content even when a relayer recomputes every commitment', () => {
    const event = releaseC();
    const tampered = {
      ...event,
      businessData: {
        ...(event.businessData as Record<string, unknown>),
        quantity: '999.000',
      },
    };
    const content = {
      payloadDigest: payloadDigest({ handoverId: u(40), quantity: '999.000' }),
      metadataDigest: signedMetadataDigest(tampered),
      assertionDigest:
        event.bindingContext!.event!.actorSignature!.assertionDigest,
    };
    const digest = signedPrivateBodyDigest(content);
    tampered.bindingContext = {
      ...event.bindingContext!,
      privateBodyDigest: digest,
    };
    tampered.dataHash = signedBindingEventCommitment(publicContext(), digest, {
      ...event.bindingContext!.event!.actorSignature!,
      ...content,
    });
    expect(privateTraceEvidenceMatches(tampered)).toBe(false);
  });

  it('does not accept a C event without its signature sidecar or as a B event', () => {
    const event = releaseC();
    expect(
      privateTraceEvidenceMatches({
        ...event,
        bindingContext: {
          ...event.bindingContext!,
          event: { actorSignature: null },
        },
      }),
    ).toBe(false);
    expect(
      privateTraceEvidenceMatches({
        ...event,
        bindingContext: { ...event.bindingContext!, commitmentVersion: 'b1' },
      }),
    ).toBe(false);
    expect(
      privateTraceEvidenceMatches({ ...event, schemaVersion: '3.0.0' }),
    ).toBe(false);
  });

  it('rejects a swapped signature, key, intent, payload, event or commitment (HYB-AC-21)', () => {
    const other = TestSigner.fromSeed(6);
    const swappedSig = releaseC(
      (p) => (p.signature = other.signIntent(p.intent)),
    );
    expect(privateTraceEvidenceMatches(swappedSig)).toBe(false);

    const wrongIntentEvent = releaseC((p) => {
      p.intent = { ...p.intent, eventId: u(99) };
      p.signature = signer.signIntent(p.intent);
    });
    expect(privateTraceEvidenceMatches(wrongIntentEvent)).toBe(false);

    const wrongPayload = releaseC((p) => {
      p.payload = { ...p.payload, quantity: '999.000' };
    });
    expect(privateTraceEvidenceMatches(wrongPayload)).toBe(false);

    const wrongChain = releaseC((p) => {
      p.intent = { ...p.intent, chainRef: u(77) };
      p.signature = signer.signIntent(p.intent);
    });
    expect(privateTraceEvidenceMatches(wrongChain)).toBe(false);

    const event = releaseC();
    expect(
      privateTraceEvidenceMatches({ ...event, dataHash: 'f'.repeat(64) }),
    ).toBe(false);
    expect(
      privateTraceEvidenceMatches({
        ...event,
        previousEventHash: 'e'.repeat(64),
      }),
    ).toBe(false);
    expect(
      privateTraceEvidenceMatches({
        ...event,
        eventType: 'HANDOVER_CONFIRMED',
      }),
    ).toBe(false);
    const stored = event.bindingContext!.event!.actorSignature!;
    expect(
      privateTraceEvidenceMatches({
        ...event,
        bindingContext: {
          ...event.bindingContext!,
          event: {
            actorSignature: {
              ...stored,
              key: { ...stored.key, publicKey: other.publicKey },
            },
          },
        },
      }),
    ).toBe(false);
    expect(
      privateTraceEvidenceMatches({
        ...event,
        bindingContext: {
          ...event.bindingContext!,
          event: {
            actorSignature: {
              ...stored,
              key: { ...stored.key, organizationId: u(11) },
            },
          },
        },
      }),
    ).toBe(false);
  });

  it('still verifies the message the signer saw, byte for byte', () => {
    const event = releaseC();
    const data = event.businessData as {
      actorSignature: { intent: IntentBody };
    };
    expect(
      signedMessageForIntent(data.actorSignature.intent).length,
    ).toBeGreaterThan(0);
  });
});
