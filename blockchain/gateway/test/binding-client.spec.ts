import { CommitError, CommitStatusError, EndorseError } from "@hyperledger/fabric-gateway";
import { describe, expect, it, vi } from "vitest";

import {
  BindingLedgerClient,
  certificateFingerprint,
  classifyFabricError,
  validationCodeName,
  validationCodeOf,
} from "../src/index.js";
import { RegistryOperator } from "../src/registry-ops.js";

const grpc = { code: 10, details: [], cause: {} as never, transactionId: "tx" };
const detail = (message: string) => ({ address: "peer0", message, mspId: "Org1MSP" });

describe("classifyFabricError", () => {
  it("separates a chaincode rejection from an endorsement outage", () => {
    const rejected = new EndorseError({
      ...grpc,
      details: [detail("chaincode response 500, PERMISSION_INACTIVE: permission is not active")],
      message: "failed to endorse transaction",
    });
    expect(classifyFabricError(rejected)).toMatchObject({
      kind: "CHAINCODE",
      chaincodeCode: "PERMISSION_INACTIVE",
      unknownOutcome: false,
    });
    const outage = new EndorseError({
      ...grpc,
      details: [detail("no combination of peers can be derived which satisfy the endorsement policy")],
      message: "failed to endorse transaction",
    });
    expect(classifyFabricError(outage)).toMatchObject({ kind: "ENDORSEMENT", unknownOutcome: false });
  });

  it("treats a lost commit status as an unknown outcome that must be reconciled", () => {
    const lost = new CommitStatusError({ ...grpc, code: 14, details: [], message: "unavailable" });
    expect(classifyFabricError(lost)).toMatchObject({ kind: "COMMIT_STATUS", unknownOutcome: true });
    expect(classifyFabricError(new Error("socket hang up"))).toMatchObject({ kind: "UNKNOWN", unknownOutcome: true });
  });

  it("reports the validation code name of a transaction committed as invalid", () => {
    const invalid = new CommitError({ code: 11, transactionId: "tx", message: "mvcc" });
    expect(classifyFabricError(invalid)).toMatchObject({
      kind: "COMMIT_INVALID",
      validationCode: "MVCC_READ_CONFLICT",
      unknownOutcome: false,
    });
    expect(validationCodeName(10)).toBe("ENDORSEMENT_POLICY_FAILURE");
    expect(validationCodeName(999)).toBe("CODE_999");
  });
});

describe("validationCodeOf", () => {
  it("reads the validation code from a ProcessedTransaction protobuf", () => {
    // field 1 (envelope, length-delimited 3 bytes) then field 2 varint 11
    const bytes = Uint8Array.from([0x0a, 0x03, 1, 2, 3, 0x10, 0x0b]);
    expect(validationCodeOf(bytes)).toBe(11);
    expect(validationCodeOf(Uint8Array.from([0x0a, 0x00]))).toBe(0);
    expect(() => validationCodeOf(Uint8Array.from([0x0b, 0x01]))).toThrow("wire type");
  });

  it("never reads empty, truncated or envelope-less bytes as VALID", () => {
    for (const bytes of [
      [],
      [10, 127],
      [0x0a, 0x03, 1],
      [0x0a, 0x03, 1, 2, 3, 0x10],
      [0x0a, 0x03, 1, 2, 3, 0x10, 0x80],
      [0x10, 0x00],
      [0x0a, 0x00, 0x12, 0x00],
      [0x00, 0x00],
    ])
      expect(() => validationCodeOf(Uint8Array.from(bytes))).toThrow();
  });
});

describe("certificateFingerprint", () => {
  it("hashes the DER body, ignoring PEM armour and line breaks", () => {
    const der = Buffer.from("not-a-real-certificate-but-stable");
    const pem = `-----BEGIN CERTIFICATE-----\n${der.toString("base64").replace(/(.{20})/g, "$1\n")}\n-----END CERTIFICATE-----\n`;
    const flat = `-----BEGIN CERTIFICATE-----${der.toString("base64")}-----END CERTIFICATE-----`;
    expect(certificateFingerprint(pem)).toBe(certificateFingerprint(flat));
    expect(certificateFingerprint(pem)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("BindingLedgerClient and RegistryOperator", () => {
  const contract = () => {
    const calls: Array<{ name: string; args: string[] }> = [];
    const newProposal = vi.fn((name: string, options: { arguments: string[] }) => {
      calls.push({ name, args: options.arguments });
      return {
        getTransactionId: () => "abc",
        endorse: async () => ({
          getTransactionId: () => "abc",
          getResult: () => new TextEncoder().encode(JSON.stringify({ proposalId: "p".repeat(64), status: "OPEN" })),
          getBytes: () => new Uint8Array(),
          submit: async () => ({
            getStatus: async () => ({ transactionId: "abc", successful: true, blockNumber: 7n, code: 0 }),
          }),
        }),
      };
    });
    const evaluateTransaction = vi.fn(async () => new TextEncoder().encode(JSON.stringify({ status: "OPEN" })));
    const gateway = {
      getNetwork: () => ({ getContract: () => ({ newProposal, evaluateTransaction }), getName: () => "hybrid-b" }),
    };
    return { calls, client: new BindingLedgerClient(gateway as never, { channelName: "hybrid-b", chaincodeName: "agritrace", contractName: "AgriTraceContract" }) };
  };

  it("exposes the transaction id before any network traffic so the attempt can be persisted", () => {
    const { client } = contract();
    expect(client.prepare("RecordBindingEvent", ["{}", "{}"]).transactionId).toBe("abc");
  });

  it("proposes with an exact request body and uses a stable nonce for idempotent resumes", async () => {
    const { client, calls } = contract();
    const operator = new RegistryOperator(client, {});
    const id = await operator.propose("PERMISSION_GRANT", { a: 1 }, "0", "n-1");
    expect(id).toBe("p".repeat(64));
    expect(JSON.parse(calls[0].args[0])).toEqual({
      kind: "PERMISSION_GRANT",
      payload: { a: 1 },
      expectedRevision: "0",
      nonce: "n-1",
    });
    await expect(operator.approve(id, "Org9MSP")).rejects.toThrow("No admin client configured");
  });
});
