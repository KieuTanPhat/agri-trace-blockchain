import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { canonicalize as rfc8785 } from "json-canonicalize";
import {
  canonicalJson,
  distributionMessage,
  ed25519Spki,
  handoverPhotosDigest,
  intentDigest,
  keyPopMessage,
  payloadDigest,
  signedMessage,
  toBase64Url,
  verifyPreparedIntent,
  type PreparedIntent,
} from "../src/lib/signing/canonical.ts";
import { commandIdentity } from "../src/lib/command-queue.ts";
import * as server from "../../api/src/modules/trace/signed-commitment.ts";
import * as photos from "../../api/src/modules/distribution/handover-photos.ts";

// The API verifier is the reference: a phone signature must pass it unchanged.
const secret = ed25519.utils.randomSecretKey();
const publicKey = toBase64Url(ed25519Spki(ed25519.getPublicKey(secret)));
const sign = (message: Uint8Array) => toBase64Url(ed25519.sign(message, secret));
const hash = "a".repeat(64);

test("key proof-of-possession verifies with the API verifier", () => {
  const fields = { bindingDigest: hash, keyRef: randomUUID(), orgRef: randomUUID(), publicKey };
  assert.deepEqual(Buffer.from(keyPopMessage(fields)), server.keyPopMessage(fields));
  assert.equal(server.verifyEd25519(publicKey, server.keyPopMessage(fields), sign(keyPopMessage(fields))), true);
  assert.equal(server.verifyEd25519(publicKey, server.keyPopMessage({ ...fields, orgRef: randomUUID() }), sign(keyPopMessage(fields))), false);
});

test("c2 intent digests and signed bytes match the API", () => {
  const payload = { lotId: randomUUID(), phase: "PICKUP", quantity: "10.000", unit: "kg" };
  const intent = {
    protocol: "agritrace-intent/2", intentId: randomUUID(), chainRef: randomUUID(), bindingDigest: hash,
    signerOrgRef: randomUUID(), keyRef: randomUUID(), operation: "DISTRIBUTION_ATTEST", entityType: "LOT",
    entityId: payload.lotId, eventId: randomUUID(), eventType: "DISTRIBUTION_ATTESTED", expectedVersion: "3",
    payloadDigest: payloadDigest(payload), notAfter: new Date(Date.now() + 600_000).toISOString(), policyVersion: "2",
  };
  assert.equal(intent.payloadDigest, server.payloadDigest(payload));
  assert.equal(intentDigest(intent), server.intentDigest(intent));
  assert.deepEqual(Buffer.from(signedMessage(intent)), server.signedMessageForIntent(intent));
  assert.equal(server.verifyEd25519(publicKey, server.signedMessageForIntent(intent), sign(signedMessage(intent))), true);
  const prepared: PreparedIntent = {
    intentId: intent.intentId, operation: intent.operation, keyRef: intent.keyRef, expiresAt: intent.notAfter,
    intent, payload, intentDigest: intentDigest(intent), signedMessage: toBase64Url(signedMessage(intent)),
  };
  assert.deepEqual(verifyPreparedIntent(prepared), { ok: true });
  // A server that swaps the displayed quantity is refused before signing.
  assert.equal(verifyPreparedIntent({ ...prepared, payload: { ...payload, quantity: "99.000" } }).ok, false);
});

test("standard handover messages use the API canonical JSON", () => {
  const body = { transferId: randomUUID(), phase: "DELIVERY", organizationId: randomUUID(), userId: randomUUID(),
    keyRef: randomUUID(), version: "4", expiresAt: new Date().toISOString(), snapshotDigest: hash,
    lines: [{ lotId: "b", quantity: "1.500" }, { lotId: "a", quantity: "2.000" }], vehicleId: null };
  assert.equal(canonicalJson(body), rfc8785(body));
  const expected = Buffer.from(`agritrace:distribution-attestation:1\0${rfc8785(body)}`, "utf8");
  assert.deepEqual(Buffer.from(distributionMessage("agritrace:distribution-attestation:1", body)), expected);
  assert.equal(server.verifyEd25519(publicKey, expected, sign(distributionMessage("agritrace:distribution-attestation:1", body))), true);
});

test("distribution commands reconcile with the Web operation names", () => {
  const body = { phase: "PICKUP", version: 3, keyRef: "k" };
  assert.deepEqual(commandIdentity({ path: "/distribution/transfers/t1/c2/prepare", body }), { operation: "DIST_C2_PREPARE", payload: { ...body, id: "t1" } });
  assert.deepEqual(commandIdentity({ path: "/distribution/transfers/t1/sign", body }).operation, "DIST_SIGN");
  assert.deepEqual(commandIdentity({ path: "/distribution/transfers/t1/receipt", body }).operation, "DIST_RECEIPT");
  assert.deepEqual(commandIdentity({ path: "/distribution/quantities", body }), { operation: "EW_DISPOSITION", payload: body });
});

test("handover photo digest matches the API and changes with any photo", () => {
  const transferId = randomUUID();
  const list = [
    { phase: "PICKUP", evidenceId: randomUUID(), sha256: "b".repeat(64) },
    { phase: "DELIVERY", evidenceId: randomUUID(), sha256: "c".repeat(64) },
  ];
  assert.equal(handoverPhotosDigest(transferId, list), photos.handoverPhotosDigest(transferId, list));
  assert.equal(handoverPhotosDigest(transferId, [...list].reverse()), photos.handoverPhotosDigest(transferId, list));
  // A swapped photo or a photo moved to another phase is a different digest.
  assert.notEqual(handoverPhotosDigest(transferId, [list[0], { ...list[1], sha256: "d".repeat(64) }]), photos.handoverPhotosDigest(transferId, list));
  assert.notEqual(handoverPhotosDigest(transferId, [list[0], { ...list[1], phase: "PICKUP" }]), photos.handoverPhotosDigest(transferId, list));
});

