import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  B_ENVELOPE_VERSION,
  bindingEventCommitment,
  sha256,
  type BindingEventInput,
} from "../src/binding";
import {
  assertionDigest,
  C_ENVELOPE_VERSION,
  C_SCHEMA_VERSION,
  intentSignedMessage,
  keyPopMessage,
  parseEd25519PublicKey,
  signedBindingEventCommitment,
  signedPrivateBodyDigest,
  verifyEd25519,
  type SignatureAssertion,
  type SignedBindingEventInput,
} from "../src/signing";
import { DIGEST, Network, readyNetwork, u, type Who } from "./helpers/network";

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** Deterministic Ed25519 key (RFC 8032 signatures are deterministic), so the
 * shared vectors below can be asserted byte for byte by the API encoder too. */
export function testKey(seedByte: number) {
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.alloc(32, seedByte)]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .toString("base64url");
  return {
    publicKey,
    sign: (message: Buffer) => sign(null, message, privateKey).toString("base64url"),
  };
}

const KEY_REF = u(20);
const ORG_REF = u(21);
const INTENT = sha256("intent-1");
const SIGNER = testKey(7);

async function readySigningNetwork() {
  const net = await readyNetwork();
  await net.change(
    "PERMISSION_GRANT",
    { permissionRef: u(5), bindingDigest: DIGEST, epoch: "1", entityTypes: ["SHIPMENT"] },
    ["admin1"],
  );
  return net;
}

async function registerKey(
  net: Network,
  signer = SIGNER,
  keyRef = KEY_REF,
  approvers: Who[] = ["admin1", "admin2"],
) {
  const fields = {
    bindingDigest: DIGEST,
    keyRef,
    orgRef: ORG_REF,
    algorithm: "Ed25519" as const,
    publicKey: signer.publicKey,
  };
  return net.change(
    "SIGNING_KEY_REGISTER",
    { ...fields, popSignature: signer.sign(keyPopMessage(fields)) },
    approvers,
  );
}

function signedEvent(
  overrides: Partial<SignedBindingEventInput> = {},
  options: { intentDigest?: string; signer?: ReturnType<typeof testKey>; keyRef?: string; signAs?: Partial<SignedBindingEventInput> } = {},
): { event: SignedBindingEventInput; assertion: SignatureAssertion } {
  const signer = options.signer ?? SIGNER;
  const keyRef = options.keyRef ?? KEY_REF;
  const intentDigest = options.intentDigest ?? INTENT;
  const payloadDigest = sha256('business quantity 100.000');
  const basis = {
    eventId: u(1),
    entityType: "SHIPMENT",
    entityId: u(2),
    eventType: "HANDOVER_OFFERED",
    chainRef: u(3),
    bindingDigest: DIGEST,
    ...overrides,
    ...options.signAs,
  };
  const assertionBase = {
    algorithm: "Ed25519" as const,
    keyRef,
    intentDigest,
    payloadDigest,
    signature: signer.sign(
      intentSignedMessage({
        intentDigest,
        chainRef: basis.chainRef,
        eventId: basis.eventId,
        entityType: basis.entityType,
        entityId: basis.entityId,
        eventType: basis.eventType,
        bindingDigest: basis.bindingDigest,
        keyRef,
        payloadDigest,
      }),
    ),
  };
  const base: SignedBindingEventInput = {
    envelopeVersion: C_ENVELOPE_VERSION,
    schemaVersion: C_SCHEMA_VERSION,
    canonicalizationVersion: "RFC8785",
    eventId: u(1),
    nonce: u(1),
    entityType: "SHIPMENT",
    entityId: u(2),
    cycleId: u(7),
    lotId: u(8),
    eventType: "HANDOVER_OFFERED",
    eventTime: "2026-10-13T00:00:00.000Z",
    previousEventHash: null,
    privateBodyDigest: "cd".repeat(32),
    bindingDigest: DIGEST,
    chainRef: u(3),
    permissions: [{ permissionRef: u(5), epoch: "1", ordinal: "1" }],
    dataHash: "",
    signature: { keyRef, intentDigest, assertionDigest: assertionDigest(assertionBase), payloadDigest, metadataDigest: "cd".repeat(32) },
    ...overrides,
  };
  base.privateBodyDigest = signedPrivateBodyDigest(base.signature);
  if (overrides.eventId && !overrides.nonce) base.nonce = overrides.eventId;
  const event = { ...base, dataHash: signedBindingEventCommitment(base) };
  return { event, assertion: assertionBase };
}

const recordSigned = (
  net: Network,
  built: { event: SignedBindingEventInput; assertion: SignatureAssertion },
  who: Who = "relayer",
  generation = "0",
) =>
  net.contract.RecordSignedBindingEvent(
    net.ctx(who),
    JSON.stringify(built.event),
    JSON.stringify(built.assertion),
    JSON.stringify({ generation }),
  );

/** Fixed design vectors, independent of the reviewed governance digest, so the
 * API encoder (apps/api binding-commitment spec) can assert the same literals. */
export const DESIGN_BINDING_DIGEST = "f34a78fd87c5dd0ef133144774c919732c8c81095903d4e2f352a3b0756a4ce0";
export function designSignedEvent() {
  const signer = testKey(7);
  const intentDigest = "aa".repeat(32);
  const assertion: SignatureAssertion = {
    algorithm: "Ed25519",
    keyRef: u(20),
    intentDigest,
    signature: signer.sign(
      intentSignedMessage({
        intentDigest,
        chainRef: u(3),
        eventId: u(1),
        entityType: "SHIPMENT",
        entityId: u(2),
        eventType: "HANDOVER_OFFERED",
        bindingDigest: DESIGN_BINDING_DIGEST,
        keyRef: u(20),
      }),
    ),
  };
  const base: SignedBindingEventInput = {
    envelopeVersion: "5.0.0",
    schemaVersion: "4.0.0",
    canonicalizationVersion: "RFC8785",
    eventId: u(1),
    nonce: u(1),
    entityType: "SHIPMENT",
    entityId: u(2),
    cycleId: u(7),
    lotId: u(8),
    eventType: "HANDOVER_OFFERED",
    eventTime: "2026-10-13T00:00:00.000Z",
    previousEventHash: null,
    privateBodyDigest: "cd".repeat(32),
    bindingDigest: DESIGN_BINDING_DIGEST,
    chainRef: u(3),
    permissions: [{ permissionRef: u(5), epoch: "1", ordinal: "1" }],
    dataHash: "",
    signature: { keyRef: u(20), intentDigest, assertionDigest: assertionDigest(assertion) },
  };
  return { signer, assertion, event: { ...base, dataHash: signedBindingEventCommitment(base) } };
}

describe("Release C commitment vectors (ledger side)", () => {
  // These literals are asserted by apps/api binding-commitment.spec.ts as well.
  it("matches the shared proof-of-possession, signature, assertion and commitment vectors", () => {
    const { signer, assertion, event } = designSignedEvent();
    expect(signer.publicKey).toMatchInlineSnapshot(`"MCowBQYDK2VwAyEA6kpsY-KcUgq-9VB7Ey7F-ZVHdq6-vnuSQh7qaRRG0iw"`);
    const pop = signer.sign(
      keyPopMessage({
        bindingDigest: DESIGN_BINDING_DIGEST,
        keyRef: u(20),
        orgRef: u(21),
        algorithm: "Ed25519",
        publicKey: signer.publicKey,
      }),
    );
    expect(pop).toMatchInlineSnapshot(`"CMhZFan-e2_lrh2vVmrPuTt8S1GaROSKEqtHANDyTtoBJRLJiX8mygXGIh4JByrfIjQoGp4fhu-Pji7kC7CnCg"`);
    expect(assertion.signature).toMatchInlineSnapshot(`"vTr8BYI5j0z1tMW7R35pw7Nq1duFt5pfKvETCM8HHnWYg6oVOXGMb_MGvG4pQYGUMJNKCx-7YuOFtEI6C7JyCA"`);
    expect(assertionDigest(assertion)).toMatchInlineSnapshot(`"e7134283211249c385eeea22d98e92dbe6443a33420c7d43b3acc8a5662391bb"`);
    expect(event.dataHash).toMatchInlineSnapshot(`"3c7b39789afc0f7d3ac1da7dd5c593c0d5f3c022a60160489db7c7cc9cd43c65"`);
  });

  it("commits to the signature so the signed dataHash differs from the unsigned B commitment", () => {
    const { event } = signedEvent();
    expect(event.dataHash).not.toBe(
      bindingEventCommitment({ ...event, envelopeVersion: B_ENVELOPE_VERSION } as BindingEventInput),
    );
    expect(event.dataHash).not.toBe(
      signedBindingEventCommitment({
        ...event,
        signature: { ...event.signature, intentDigest: sha256("other") },
      }),
    );
  });

  it("verifies a good signature and rejects tampered keys, messages and encodings", () => {
    const message = Buffer.from("message");
    const signature = SIGNER.sign(message);
    expect(verifyEd25519(SIGNER.publicKey, message, signature)).toBe(true);
    expect(verifyEd25519(SIGNER.publicKey, Buffer.from("other"), signature)).toBe(false);
    expect(verifyEd25519(testKey(8).publicKey, message, signature)).toBe(false);
    expect(() => verifyEd25519(SIGNER.publicKey, message, signature.slice(1))).toThrow();
    expect(() => parseEd25519PublicKey("AAAA")).toThrow();
    // An RSA/other-algorithm SPKI must not be accepted as Ed25519.
    expect(() => parseEd25519PublicKey(Buffer.alloc(44, 1).toString("base64url"))).toThrow();
  });
});

describe("Signing key registry", () => {
  it("registers a key only after proof of possession and the owner and writer approvals", async () => {
    const net = await readySigningNetwork();
    const fields = {
      bindingDigest: DIGEST,
      keyRef: KEY_REF,
      orgRef: ORG_REF,
      algorithm: "Ed25519" as const,
      publicKey: SIGNER.publicKey,
    };
    // Someone who only saw the public key cannot enroll it.
    await expect(
      net.propose("SIGNING_KEY_REGISTER", {
        ...fields,
        popSignature: testKey(9).sign(keyPopMessage(fields)),
      }),
    ).rejects.toThrow("SIGNATURE_INVALID");
    // The proof is bound to the org: replaying it for another org fails.
    await expect(
      net.propose("SIGNING_KEY_REGISTER", {
        ...fields,
        orgRef: u(99),
        popSignature: SIGNER.sign(keyPopMessage(fields)),
      }),
    ).rejects.toThrow("SIGNATURE_INVALID");
    const id = await net.propose("SIGNING_KEY_REGISTER", {
      ...fields,
      popSignature: SIGNER.sign(keyPopMessage(fields)),
    });
    await net.approve(id, "admin1");
    await expect(net.execute(id)).rejects.toThrow("APPROVALS_MISSING");
    await net.approve(id, "admin2");
    const executed = JSON.parse(await net.execute(id));
    expect(executed.result).toMatchObject({ keyRef: KEY_REF, orgRef: ORG_REF, status: "ACTIVE" });
    const key = JSON.parse(
      await net.contract.GetRegistrySigningKey(net.ctx("relayer"), DIGEST, KEY_REF),
    );
    expect(key).toMatchObject({ status: "ACTIVE", publicKey: SIGNER.publicKey, orgRef: ORG_REF });
  });

  it("registers a key once; rotation uses a new keyRef and revocation is final", async () => {
    const net = await readySigningNetwork();
    await registerKey(net);
    await expect(registerKey(net)).rejects.toThrow("REVISION_CONFLICT");
    await net.change("SIGNING_KEY_REVOKE", { bindingDigest: DIGEST, keyRef: KEY_REF }, ["admin2"], "1");
    const revoked = JSON.parse(
      await net.contract.GetRegistrySigningKey(net.ctx("relayer"), DIGEST, KEY_REF),
    );
    expect(revoked.status).toBe("REVOKED");
    await expect(registerKey(net)).rejects.toThrow("REVISION_CONFLICT");
    await registerKey(net, testKey(8), u(22));
  });

  it("refuses a key for an unregistered binding", async () => {
    const net = await readySigningNetwork();
    const fields = {
      bindingDigest: "ee".repeat(32),
      keyRef: KEY_REF,
      orgRef: ORG_REF,
      algorithm: "Ed25519" as const,
      publicKey: SIGNER.publicKey,
    };
    const id = await net.propose("SIGNING_KEY_REGISTER", {
      ...fields,
      popSignature: SIGNER.sign(keyPopMessage(fields)),
    });
    await net.approve(id, "admin1");
    await net.approve(id, "admin2");
    await expect(net.execute(id)).rejects.toThrow("NOT_FOUND");
  });
});

describe("RecordSignedBindingEvent", () => {
  it("verifies the signature, records proof, head and history, and exposes the org", async () => {
    const net = await readySigningNetwork();
    await registerKey(net);
    const built = signedEvent();
    const receipt = JSON.parse(await recordSigned(net, built));
    expect(receipt).toMatchObject({ status: "SUBMITTED", eventId: u(1), dataHash: built.event.dataHash });
    const proof = JSON.parse(await net.contract.GetBindingProof(net.ctx("relayer"), u(3), u(1)));
    expect(proof.signature).toEqual({
      keyRef: KEY_REF,
      intentDigest: INTENT,
      assertionDigest: built.event.signature.assertionDigest,
      payloadDigest: built.event.signature.payloadDigest,
      metadataDigest: built.event.signature.metadataDigest,
      orgRef: ORG_REF,
    });
    const stored = JSON.parse(await net.contract.QueryBindingEvent(net.ctx("relayer"), u(3), u(1)));
    expect(stored.signature.signature).toBe(built.assertion.signature);
    const head = JSON.parse(
      await net.contract.GetBindingHead(net.ctx("relayer"), u(3), "SHIPMENT", u(2)),
    );
    expect(head).toMatchObject({ eventCount: 1, lastDataHash: built.event.dataHash });
  });

  it("forbids recording handover events without a signature (no unsigned bypass)", async () => {
    const net = await readySigningNetwork();
    await registerKey(net);
    const base: BindingEventInput = {
      envelopeVersion: B_ENVELOPE_VERSION,
      schemaVersion: "3.0.0",
      canonicalizationVersion: "RFC8785",
      eventId: u(1),
      nonce: u(1),
      entityType: "SHIPMENT",
      entityId: u(2),
      cycleId: u(7),
      lotId: u(8),
      eventType: "HANDOVER_CONFIRMED",
      eventTime: "2026-10-13T00:00:00.000Z",
      previousEventHash: null,
      privateBodyDigest: "cd".repeat(32),
      bindingDigest: DIGEST,
      chainRef: u(3),
      permissions: [{ permissionRef: u(5), epoch: "1", ordinal: "1" }],
      dataHash: "",
    };
    const unsigned = { ...base, dataHash: bindingEventCommitment(base) };
    await expect(
      net.contract.RecordBindingEvent(net.ctx("relayer"), JSON.stringify(unsigned), JSON.stringify({ generation: "0" })),
    ).rejects.toThrow("SIGNATURE_REQUIRED");
  });

  it("rejects a signature moved to another event, entity, type, chain, binding or key (HYB-AC-21)", async () => {
    const net = await readySigningNetwork();
    await registerKey(net);
    await registerKey(net, testKey(8), u(22));
    const cases: Array<[string, ReturnType<typeof signedEvent>]> = [
      ["event", signedEvent({ eventId: u(11) }, { signAs: { eventId: u(1) } })],
      ["entity", signedEvent({ entityId: u(12) }, { signAs: { entityId: u(2) } })],
      ["event type", signedEvent({ eventType: "HANDOVER_CONFIRMED" }, { signAs: { eventType: "HANDOVER_OFFERED" } })],
      ["chain", signedEvent({ chainRef: u(13) }, { signAs: { chainRef: u(3) } })],
      ["binding", signedEvent({ bindingDigest: "ab".repeat(32) }, { signAs: { bindingDigest: DIGEST } })],
    ];
    for (const [label, built] of cases)
      await expect(recordSigned(net, built), label).rejects.toThrow(/SIGNATURE_INVALID|BINDING_UNKNOWN|BINDING_MISMATCH/);
    // A valid signature by key B presented as key A.
    const swapped = signedEvent({}, { signer: testKey(8), keyRef: KEY_REF });
    await expect(recordSigned(net, swapped)).rejects.toThrow("SIGNATURE_INVALID");
  });

  it("rejects substituted dataHash, intent digest and assertion (HYB-AC-21)", async () => {
    const net = await readySigningNetwork();
    await registerKey(net);
    const built = signedEvent();
    const tamper = (event: SignedBindingEventInput, assertion: SignatureAssertion = built.assertion) =>
      recordSigned(net, { event, assertion });
    await expect(tamper({ ...built.event, dataHash: "ff".repeat(32) })).rejects.toThrow("INVALID_INPUT");
    // Recommit with another intent digest but keep the original assertion.
    const otherIntent = { ...built.event, signature: { ...built.event.signature, intentDigest: sha256("x") } };
    await expect(
      tamper({ ...otherIntent, dataHash: signedBindingEventCommitment(otherIntent) }),
    ).rejects.toThrow("SIGNATURE_INVALID");
    // Assertion with a flipped signature bit.
    const forged = Buffer.from(built.assertion.signature, "base64url");
    forged[0] ^= 1;
    await expect(
      tamper(built.event, { ...built.assertion, signature: forged.toString("base64url") }),
    ).rejects.toThrow("SIGNATURE_INVALID");
    // Rehashing the public envelope cannot authorize an arbitrary private body.
    const privateSwap = { ...built.event, privateBodyDigest: "ee".repeat(32) };
    await expect(tamper({ ...privateSwap, dataHash: signedBindingEventCommitment(privateSwap) })).rejects.toThrow("INVALID_INPUT");
    // Recompute all content hashes and assertion refs, but retain the signature.
    const changedAssertion = { ...built.assertion, payloadDigest: sha256('business quantity 999.000') };
    const changedSignature = { ...built.event.signature, payloadDigest: changedAssertion.payloadDigest, assertionDigest: assertionDigest(changedAssertion) };
    const changed = { ...built.event, signature: changedSignature, privateBodyDigest: signedPrivateBodyDigest(changedSignature) };
    await expect(tamper({ ...changed, dataHash: signedBindingEventCommitment(changed) }, changedAssertion)).rejects.toThrow("SIGNATURE_INVALID");
  });

  it('disables legacy c1 writes while preserving their commitment vectors', async () => {
    const net = await readySigningNetwork();
    await registerKey(net);
    const built = signedEvent({ envelopeVersion: '5.0.0', schemaVersion: '4.0.0' });
    await expect(recordSigned(net, built)).rejects.toThrow('INVALID_INPUT');
  });

  it("rejects unregistered and revoked keys, even for events signed earlier (no backdating)", async () => {
    const net = await readySigningNetwork();
    await expect(recordSigned(net, signedEvent())).rejects.toThrow("SIGNING_KEY_INACTIVE");
    await registerKey(net);
    const queued = signedEvent({ eventTime: "2020-01-01T00:00:00.000Z" });
    await net.change("SIGNING_KEY_REVOKE", { bindingDigest: DIGEST, keyRef: KEY_REF }, ["admin1"], "1");
    // The actor-supplied eventTime does not prove the signature predates the revoke.
    await expect(recordSigned(net, queued)).rejects.toThrow("SIGNING_KEY_INACTIVE");
  });

  it("consumes an intent once and treats resubmission as a duplicate", async () => {
    const net = await readySigningNetwork();
    await registerKey(net);
    const first = signedEvent();
    await recordSigned(net, first);
    await expect(recordSigned(net, first)).rejects.toThrow("DUPLICATE_EVENT");
    // A signer that signs the same intent for a second event cannot reuse it.
    const second = signedEvent(
      { eventId: u(31), entityId: u(32), nonce: u(31) },
      { intentDigest: INTENT },
    );
    await expect(recordSigned(net, second)).rejects.toThrow("SIGNATURE_REPLAY");
    // The same eventId with a different signature body is a conflicting tuple.
    const conflicting = signedEvent({}, { intentDigest: sha256("intent-2") });
    await expect(recordSigned(net, conflicting)).rejects.toThrow("DUPLICATE_EVENT_CONFLICT");
  });

  it("still enforces relayer role, permissions and the hash chain for signed events", async () => {
    const net = await readySigningNetwork();
    await registerKey(net);
    const noPermission = signedEvent({ permissions: [{ permissionRef: u(4), epoch: "1", ordinal: "1" }] });
    await expect(recordSigned(net, noPermission)).rejects.toThrow("PERMISSION_INACTIVE");
    await expect(recordSigned(net, signedEvent(), "controller")).rejects.toThrow("UNAUTHORIZED_RELAYER");
    await expect(recordSigned(net, signedEvent(), "rogue")).rejects.toThrow("UNAUTHORIZED_RELAYER");
    const genesis = signedEvent();
    await recordSigned(net, genesis);
    const next = signedEvent(
      {
        eventId: u(41),
        nonce: u(41),
        eventType: "HANDOVER_CONFIRMED",
        previousEventHash: "00".repeat(32),
      },
      { intentDigest: sha256("intent-3") },
    );
    await expect(recordSigned(net, next)).rejects.toThrow("HASH_CHAIN_CONFLICT");
    const chained = signedEvent(
      {
        eventId: u(42),
        nonce: u(42),
        eventType: "HANDOVER_CONFIRMED",
        previousEventHash: genesis.event.dataHash,
      },
      { intentDigest: sha256("intent-4") },
    );
    await recordSigned(net, chained);
  });

  it("honours the delivery fence for signed events like release B", async () => {
    const net = await readySigningNetwork();
    await registerKey(net);
    const built = signedEvent();
    await net.change(
      "FENCE_DELIVERY",
      { chainRef: u(3), bindingDigest: DIGEST, eventId: u(1), dataHash: built.event.dataHash },
      ["admin1"],
    );
    await expect(recordSigned(net, built)).rejects.toThrow("DELIVERY_FENCED");
    await recordSigned(net, built, "relayer", "1");
  });
});
