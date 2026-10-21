import { webcrypto, createPublicKey, verify } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  canonicalJson,
  distributionKeyStore,
  generateDistributionKey,
  signDistribution,
} from "./distribution-signer";
import { sha256Hex } from "./signing/canonical";
import type { StoredSigningKey } from "./signing/key-store";
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("generates a non-extractable device key and proves possession for exactly its enterprise", async () => {
  let stored: StoredSigningKey | undefined;
  vi.spyOn(distributionKeyStore, "put").mockImplementation(async (key) => {
    stored = key;
  });
  const result = await generateDistributionKey("org-one", "Device key");
  expect(stored?.privateKey.extractable).toBe(false);
  const message = Buffer.from(
    "agritrace:distribution-key:1\0" +
      canonicalJson({
        id: result.id,
        organizationId: "org-one",
        publicKey: result.publicKey,
      }),
  );
  expect(
    verify(
      null,
      message,
      createPublicKey({
        key: Buffer.from(result.publicKey, "base64url"),
        format: "der",
        type: "spki",
      }),
      Buffer.from(result.popSignature, "base64url"),
    ),
  ).toBe(true);
});
it("refuses a modified snapshot before accessing the private key", async () => {
  const get = vi.spyOn(distributionKeyStore, "get");
  await expect(
    signDistribution(
      {
        snapshot: { lines: [{ quantity: "600.000" }] },
        snapshotDigest: "0".repeat(64),
        domain: "agritrace:distribution-attestation:1",
      },
      {
        transferId: "t",
        phase: "PICKUP",
        organizationId: "o",
        userId: "u",
        keyRef: "k",
        version: "1",
        expiresAt: "2026-10-17T00:00:00Z",
      },
    ),
  ).rejects.toThrow("không khớp");
  expect(get).not.toHaveBeenCalled();
});
it("signs only the canonical phase, actor and version shown for the matching organization", async () => {
  let key: StoredSigningKey | undefined;
  vi.spyOn(distributionKeyStore, "put").mockImplementation(async (value) => {
    key = value;
  });
  const generated = await generateDistributionKey("org-one", "Device key");
  vi.spyOn(distributionKeyStore, "get").mockImplementation(async () => key);
  const snapshot = {
    lines: [{ lotId: "source", quantity: "600.000", unit: "kg" }],
    receiverId: "receiver",
  };
  const snapshotDigest = await sha256Hex(
    new TextEncoder().encode(canonicalJson(snapshot)),
  );
  const challenge = {
      snapshot,
      snapshotDigest,
      domain: "agritrace:distribution-attestation:1",
    },
    body = {
      transferId: "transfer",
      phase: "PICKUP",
      organizationId: "org-one",
      userId: "actor",
      keyRef: generated.id,
      version: "4",
      expiresAt: "2026-10-17T00:00:00Z",
    };
  const signature = await signDistribution(challenge, body),
    publicKey = createPublicKey({
      key: Buffer.from(generated.publicKey, "base64url"),
      format: "der",
      type: "spki",
    });
  const message = Buffer.from(
    challenge.domain + "\0" + canonicalJson({ ...body, snapshotDigest }),
  );
  expect(
    verify(null, message, publicKey, Buffer.from(signature, "base64url")),
  ).toBe(true);
  expect(
    verify(
      null,
      Buffer.from(
        challenge.domain +
          "\0" +
          canonicalJson({ ...body, phase: "DELIVERY", snapshotDigest }),
      ),
      publicKey,
      Buffer.from(signature, "base64url"),
    ),
  ).toBe(false);
  await expect(
    signDistribution(challenge, { ...body, organizationId: "other-org" }),
  ).rejects.toThrow("chưa có khóa");
});
