import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  fromBase64Url,
  intentDigest,
  keyPopMessage,
  payloadDigest,
  signedMessage,
  toBase64Url,
  verifyPreparedIntent,
  type PreparedIntent,
} from "./canonical";
import { MemoryKeyStore } from "./key-store";
import {
  createSigningKey,
  ed25519Supported,
  signPreparedIntent,
  SigningRefusedError,
} from "./signer";

// Vectors produced by the API encoder (apps/api signed-commitment.ts) for the
// deterministic seed-7 test key. Both implementations must agree on them.
const vector = {
  payload: {
    handoverId: "00000000-0000-4000-8000-000000000040",
    quantity: "100.000",
    note: "Giao hàng — đợt 1",
  },
  intent: {
    protocol: "agritrace-intent/2",
    intentId: "00000000-0000-4000-8000-000000000030",
    chainRef: "00000000-0000-4000-8000-000000000003",
    bindingDigest:
      "f34a78fd87c5dd0ef133144774c919732c8c81095903d4e2f352a3b0756a4ce0",
    signerOrgRef: "00000000-0000-4000-8000-000000000021",
    keyRef: "00000000-0000-4000-8000-000000000020",
    operation: "HANDOVER_OFFER",
    entityType: "SHIPMENT",
    entityId: "00000000-0000-4000-8000-000000000002",
    eventId: "00000000-0000-4000-8000-000000000001",
    eventType: "HANDOVER_OFFERED",
    expectedVersion: "3",
    payloadDigest:
      "bb162cdfcf06c790a480bea75cecb65e2de9f22afb6f24e45a0e5098d14f151d",
    notAfter: "2026-10-14T00:00:00.000Z",
    policyVersion: "2",
  },
  intentDigest:
    "b9af2d5efa90e27b67d036cb0faae7745aae79502d9c0d4f2bc15ea03a026867",
  signedMessage:
    "YWdyaXRyYWNlOmludGVudC1zaWduYXR1cmU6YzIAeyJiaW5kaW5nRGlnZXN0IjoiZjM0YTc4ZmQ4N2M1ZGQwZWYxMzMxNDQ3NzRjOTE5NzMyYzhjODEwOTU5MDNkNGUyZjM1MmEzYjA3NTZhNGNlMCIsImNoYWluUmVmIjoiMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAzIiwiZW50aXR5SWQiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDIiLCJlbnRpdHlUeXBlIjoiU0hJUE1FTlQiLCJldmVudElkIjoiMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwiZXZlbnRUeXBlIjoiSEFORE9WRVJfT0ZGRVJFRCIsImludGVudERpZ2VzdCI6ImI5YWYyZDVlZmE5MGUyN2I2N2QwMzZjYjBmYWFlNzc0NWFhZTc5NTAyZDljMGQ0ZjJiYzE1ZWEwM2EwMjY4NjciLCJrZXlSZWYiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMjAiLCJwYXlsb2FkRGlnZXN0IjoiYmIxNjJjZGZjZjA2Yzc5MGE0ODBiZWE3NWNlY2I2NWUyZGU5ZjIyYWZiNmYyNGU0NWEwZTUwOThkMTRmMTUxZCJ9",
  publicKey: "MCowBQYDK2VwAyEA6kpsY-KcUgq-9VB7Ey7F-ZVHdq6-vnuSQh7qaRRG0iw",
  signature:
    "e-EvWQotO9C2xU2kf4kKG0O9q1s6-JZccjdK9v3yEZoMsg_Jr2hnhFR6m8o7NGQgBeCzXw1ZUmcccfqxbGd3CQ",
  pop: "CMhZFan-e2_lrh2vVmrPuTt8S1GaROSKEqtHANDyTtoBJRLJiX8mygXGIh4JByrfIjQoGp4fhu-Pji7kC7CnCg",
};
const PKCS8_PREFIX = Uint8Array.from(
  Buffer.from("302e020100300506032b657004220420", "hex"),
);

function prepared(overrides: Partial<PreparedIntent> = {}): PreparedIntent {
  return {
    intentId: vector.intent.intentId,
    operation: "HANDOVER_OFFER",
    keyRef: vector.intent.keyRef,
    expiresAt: vector.intent.notAfter,
    intent: { ...vector.intent },
    payload: { ...vector.payload },
    intentDigest: vector.intentDigest,
    signedMessage: vector.signedMessage,
    ...overrides,
  };
}
const beforeExpiry = Date.parse("2026-10-13T12:00:00.000Z");

beforeAll(() => {
  vi.stubGlobal("crypto", webcrypto);
});

describe("browser signing encoder", () => {
  it("matches the API vectors for digests and the signed message", async () => {
    expect(await payloadDigest(vector.payload)).toBe(
      vector.intent.payloadDigest,
    );
    expect(await intentDigest(vector.intent)).toBe(vector.intentDigest);
    expect(toBase64Url(await signedMessage(vector.intent))).toBe(
      vector.signedMessage,
    );
    expect(
      await intentDigest(
        Object.fromEntries(Object.entries(vector.intent).reverse()),
      ),
    ).toBe(vector.intentDigest);
  });

  it("produces the same deterministic signature and proof as the API signer", async () => {
    const seed = new Uint8Array(32).fill(7);
    const pkcs8 = new Uint8Array([...PKCS8_PREFIX, ...seed]);
    const key = await webcrypto.subtle.importKey(
      "pkcs8",
      pkcs8,
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    const sign = async (message: Uint8Array) =>
      toBase64Url(
        new Uint8Array(
          await webcrypto.subtle.sign({ name: "Ed25519" }, key, message),
        ),
      );
    expect(await sign(await signedMessage(vector.intent))).toBe(
      vector.signature,
    );
    expect(
      await sign(
        keyPopMessage({
          bindingDigest: vector.intent.bindingDigest,
          keyRef: vector.intent.keyRef,
          orgRef: vector.intent.signerOrgRef,
          publicKey: vector.publicKey,
        }),
      ),
    ).toBe(vector.pop);
  });

  it("round-trips base64url", () => {
    const bytes = Uint8Array.from([0, 250, 251, 252, 253, 254, 255]);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });
});

describe("prepared intent verification (what you see is what you sign)", () => {
  it("accepts an intent whose every derived value matches", async () => {
    expect(await verifyPreparedIntent(prepared(), beforeExpiry)).toEqual({
      ok: true,
    });
  });

  it("refuses a payload that differs from the signed digest", async () => {
    const result = await verifyPreparedIntent(
      prepared({ payload: { ...vector.payload, quantity: "999.000" } }),
      beforeExpiry,
    );
    expect(result).toEqual({
      ok: false,
      reason: "Nội dung hiển thị không khớp nội dung sẽ ký",
    });
  });

  it("refuses altered intents, digests, messages, keys and expired requests", async () => {
    const refused = async (value: PreparedIntent, now = beforeExpiry) =>
      (await verifyPreparedIntent(value, now)).ok;
    expect(
      await refused(
        prepared({ intent: { ...vector.intent, expectedVersion: "4" } }),
      ),
    ).toBe(false);
    expect(await refused(prepared({ intentDigest: "00".repeat(32) }))).toBe(
      false,
    );
    expect(await refused(prepared({ signedMessage: "AAAA" }))).toBe(false);
    expect(
      await refused(
        prepared({ keyRef: "00000000-0000-4000-8000-0000000000ff" }),
      ),
    ).toBe(false);
    expect(
      await refused(prepared({ intent: { ...vector.intent, protocol: "x" } })),
    ).toBe(false);
    expect(
      await refused(prepared(), Date.parse("2026-10-14T00:00:01.000Z")),
    ).toBe(false);
  });
  it("rejects an invalid expiry and mismatched displayed operation or expiry", async () => {
    for (const extra of [
      { operation: "HANDOVER_CONFIRM" },
      { expiresAt: "2099-10-14T00:00:00.000Z" },
    ])
      expect(
        (await verifyPreparedIntent(prepared(extra), beforeExpiry)).ok,
      ).toBe(false);
    const intent = { ...vector.intent, notAfter: "not-a-date" };
    expect(
      await verifyPreparedIntent(
        prepared({
          intent,
          expiresAt: intent.notAfter,
          intentDigest: await intentDigest(intent),
          signedMessage: toBase64Url(await signedMessage(intent)),
        }),
        beforeExpiry,
      ),
    ).toEqual({ ok: false, reason: "Thời hạn yêu cầu ký không hợp lệ" });
  });
});

describe("device key signer", () => {
  it("generates a non-extractable key and signs only a verified intent", async () => {
    expect(await ed25519Supported()).toBe(true);
    const store = new MemoryKeyStore();
    const created = await createSigningKey(store, {
      chainId: "chain",
      organizationId: vector.intent.signerOrgRef,
      bindingDigest: vector.intent.bindingDigest,
      label: "Máy tính văn phòng",
    });
    const stored = await store.get(created.keyRef);
    expect(stored?.publicKey).toBe(created.publicKey);
    // The private key cannot be exported by any script on the page.
    await expect(
      webcrypto.subtle.exportKey("pkcs8", stored!.privateKey),
    ).rejects.toThrow();
    // The proof of possession verifies against the enrolled public key.
    const publicKey = await webcrypto.subtle.importKey(
      "spki",
      fromBase64Url(created.publicKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    expect(
      await webcrypto.subtle.verify(
        { name: "Ed25519" },
        publicKey,
        fromBase64Url(created.popSignature),
        keyPopMessage({
          bindingDigest: vector.intent.bindingDigest,
          keyRef: created.keyRef,
          orgRef: vector.intent.signerOrgRef,
          publicKey: created.publicKey,
        }),
      ),
    ).toBe(true);

    // Rebuild the vector for the new key and sign it.
    const intent = { ...vector.intent, keyRef: created.keyRef };
    const request: PreparedIntent = {
      ...prepared(),
      keyRef: created.keyRef,
      intent,
      intentDigest: await intentDigest(intent),
      signedMessage: toBase64Url(await signedMessage(intent)),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    request.intent = {
      ...intent,
      notAfter: request.expiresAt,
    };
    request.intentDigest = await intentDigest(request.intent);
    request.signedMessage = toBase64Url(await signedMessage(request.intent));
    const signature = await signPreparedIntent(store, request);
    expect(
      await webcrypto.subtle.verify(
        { name: "Ed25519" },
        publicKey,
        fromBase64Url(signature),
        await signedMessage(request.intent),
      ),
    ).toBe(true);
  });

  it("refuses to sign tampered requests and unknown keys", async () => {
    const store = new MemoryKeyStore();
    await expect(
      signPreparedIntent(
        store,
        prepared({ payload: { ...vector.payload, quantity: "1.000" } }),
      ),
    ).rejects.toBeInstanceOf(SigningRefusedError);
    // A valid-looking, unexpired request for a key this device does not hold.
    const intent = {
      ...vector.intent,
      notAfter: new Date(Date.now() + 60_000).toISOString(),
    };
    const request: PreparedIntent = {
      ...prepared(),
      intent,
      expiresAt: intent.notAfter,
      intentDigest: await intentDigest(intent),
      signedMessage: toBase64Url(await signedMessage(intent)),
    };
    await expect(signPreparedIntent(store, request)).rejects.toThrow(
      /không nằm trên thiết bị/,
    );
  });
  it("refuses a valid server intent whose organization, binding, shipment or selected key differs from the reviewed scope", async () => {
    const store = new MemoryKeyStore();
    const created = await createSigningKey(store, {
      chainId: "db-chain",
      organizationId: vector.intent.signerOrgRef,
      bindingDigest: vector.intent.bindingDigest,
      label: "Scope-bound key",
    });
    const intent = {
      ...vector.intent,
      keyRef: created.keyRef,
      notAfter: new Date(Date.now() + 60_000).toISOString(),
    };
    const request = prepared({
      keyRef: created.keyRef,
      intent,
      expiresAt: intent.notAfter,
      intentDigest: await intentDigest(intent),
      signedMessage: toBase64Url(await signedMessage(intent)),
    });
    const expected = {
      chainId: "db-chain",
      organizationId: vector.intent.signerOrgRef,
      chainRef: vector.intent.chainRef,
      bindingDigest: vector.intent.bindingDigest,
      entityId: vector.intent.entityId,
      operation: vector.intent.operation,
      keyRef: created.keyRef,
    };
    await expect(
      signPreparedIntent(store, request, expected),
    ).resolves.toHaveLength(86);
    for (const extra of [
      { chainId: "another-chain" },
      { organizationId: "another-org" },
      { chainRef: "another-logical-chain" },
      { bindingDigest: "00".repeat(32) },
      { entityId: "another-shipment" },
      { operation: "HANDOVER_CONFIRM" },
      { keyRef: "another-key" },
    ])
      await expect(
        signPreparedIntent(store, request, { ...expected, ...extra }),
      ).rejects.toBeInstanceOf(SigningRefusedError);
    const otherOrg = { ...intent, signerOrgRef: "another-org" };
    await expect(
      signPreparedIntent(store, {
        ...request,
        intent: otherOrg,
        intentDigest: await intentDigest(otherOrg),
        signedMessage: toBase64Url(await signedMessage(otherOrg)),
      }),
    ).rejects.toThrow(/không thuộc tổ chức giữ khóa/);
  });
});
