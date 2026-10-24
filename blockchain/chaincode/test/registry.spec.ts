import { describe, expect, it } from "vitest";

import {
  B_ENVELOPE_VERSION,
  bindingDigest,
  bindingEventCommitment,
  sha256,
  type BindingTuple,
  type BindingEventInput,
} from "../src/binding";
import { GOVERNANCE_DIGEST } from "../src/governance";
import { AgriTraceContract } from "../src/traceability-contract";
import { FakeClientIdentity, FakeStub } from "./helpers/fake-context";
import {
  ALL_ENTITIES,
  AUTHORITY,
  binding,
  DIGEST,
  Network,
  readyNetwork,
  RELAYER_FP,
  u,
  type Who,
} from "./helpers/network";

function event(overrides: Partial<BindingEventInput> = {}): BindingEventInput {
  const base: BindingEventInput = {
    envelopeVersion: B_ENVELOPE_VERSION,
    schemaVersion: "3.0.0",
    canonicalizationVersion: "RFC8785",
    eventId: u(1),
    nonce: u(1),
    entityType: "PRODUCTION_CYCLE",
    entityId: u(2),
    cycleId: u(2),
    lotId: null,
    eventType: "PRODUCTION_CYCLE_CREATED",
    eventTime: "2026-10-13T00:00:00.000Z",
    previousEventHash: null,
    privateBodyDigest: "ab".repeat(32),
    bindingDigest: DIGEST,
    chainRef: u(3),
    permissions: [{ permissionRef: u(4), epoch: "1", ordinal: "1" }],
    dataHash: "",
    ...overrides,
  };
  return { ...base, dataHash: bindingEventCommitment(base) };
}

const record = (net: Network, who: Who, e: BindingEventInput, generation = "0") =>
  net.contract.RecordBindingEvent(net.ctx(who), JSON.stringify(e), JSON.stringify({ generation }));

describe("Registry governance", () => {
  it("requires every governed MSP admin to approve before a channel bootstrap executes", async () => {
    const net = new Network();
    const payload = { channelId: "hybrid-b", strictB: true, allowLegacyV3Writes: false };
    const id = await net.propose("CHANNEL_BOOTSTRAP", payload);
    await expect(net.execute(id)).rejects.toThrow("APPROVALS_MISSING");
    await net.approve(id, "admin1");
    await expect(net.execute(id)).rejects.toThrow("APPROVALS_MISSING");
    await expect(net.approve(id, "admin3")).rejects.toThrow("UNAUTHORIZED_CONTROL");
    await net.approve(id, "admin2");
    const executed = JSON.parse(await net.execute(id));
    expect(executed).toMatchObject({ status: "EXECUTED", executedTxId: expect.any(String) });
    await expect(net.execute(id)).rejects.toThrow("PROPOSAL_NOT_OPEN");
    await expect(net.approve(id, "admin1")).rejects.toThrow("PROPOSAL_NOT_OPEN");
    expect(JSON.parse(await net.contract.GetRegistryProposal(net.ctx("controller"), id)).status).toBe("EXECUTED");
  });

  it("keeps controller, admin and relayer roles separate", async () => {
    const net = new Network();
    const request = JSON.stringify({
      kind: "CHANNEL_BOOTSTRAP",
      payload: { channelId: "hybrid-b", strictB: true, allowLegacyV3Writes: false },
      expectedRevision: "0",
      nonce: u(1),
    });
    for (const who of ["admin1", "relayer"] as const)
      await expect(net.contract.ProposeRegistryChange(net.ctx(who), request)).rejects.toThrow("UNAUTHORIZED_CONTROL");
    const id = await net.propose("CHANNEL_BOOTSTRAP", {
      channelId: "hybrid-b",
      strictB: true,
      allowLegacyV3Writes: false,
    });
    await expect(net.contract.ApproveRegistryChange(net.ctx("controller"), id)).rejects.toThrow("UNAUTHORIZED_CONTROL");
    await expect(net.contract.ApproveRegistryChange(net.ctx("relayer"), id)).rejects.toThrow("UNAUTHORIZED_CONTROL");
    await net.approve(id, "admin1");
    await net.approve(id, "admin2");
    await expect(net.execute(id, "admin1")).rejects.toThrow("UNAUTHORIZED_CONTROL");
  });

  it("fails closed on a channel without a reviewed governance descriptor", async () => {
    const net = new Network("agritrace");
    await expect(
      net.propose("CHANNEL_BOOTSTRAP", { channelId: "agritrace", strictB: true, allowLegacyV3Writes: false }),
    ).rejects.toThrow("GOVERNANCE_UNDEFINED");
  });

  it("rejects a binding that disagrees with the reviewed governance or its own digest", async () => {
    const net = new Network();
    await expect(
      net.propose("BINDING_REGISTER", {
        binding: { ...binding, governanceDigest: "33".repeat(32) },
        bindingDigest: bindingDigest({ ...binding, governanceDigest: "33".repeat(32) }),
      }),
    ).rejects.toThrow("reviewed governance");
    await expect(
      net.propose("BINDING_REGISTER", { binding, bindingDigest: "44".repeat(32) }),
    ).rejects.toThrow("bindingDigest does not match");
    await expect(
      net.propose("BINDING_REGISTER", { binding: { ...binding, writerMspId: "Org9MSP" }, bindingDigest: bindingDigest({ ...binding, writerMspId: "Org9MSP" }) }),
    ).rejects.toThrow("reviewed governance");
  });

  it("applies permission grants with the writer-MSP approval only, and revokes with either MSP in an emergency", async () => {
    const net = await readyNetwork();
    const permission = () => net.contract.GetRegistryPermission(net.ctx("controller"), u(4));
    expect(JSON.parse(await permission())).toMatchObject({ status: "ACTIVE", epoch: "1", revision: 1 });
    // The owner MSP alone cannot grant (not in the approval set) but can emergency-revoke.
    const grantId = await net.propose(
      "PERMISSION_GRANT",
      { permissionRef: u(5), bindingDigest: DIGEST, epoch: "1", entityTypes: ["CARE"] },
    );
    await expect(net.approve(grantId, "admin2")).rejects.toThrow("UNAUTHORIZED_CONTROL");
    await net.change("PERMISSION_EMERGENCY_REVOKE", { permissionRef: u(4), epoch: "1" }, ["admin2"], "1");
    expect(JSON.parse(await permission())).toMatchObject({ status: "REVOKED", reviewRequired: true, revision: 2 });
  });

  it("serializes revisions: stale approvals cannot apply over a newer registry state", async () => {
    const net = await readyNetwork();
    const staleRevoke = await net.propose("PERMISSION_REVOKE", { permissionRef: u(4), epoch: "1" }, "1");
    await net.approve(staleRevoke, "admin1");
    await net.change("PERMISSION_REVOKE", { permissionRef: u(4), epoch: "1" }, ["admin1"], "1");
    await expect(net.execute(staleRevoke)).rejects.toThrow("REVISION_CONFLICT");
    // Regrant needs the next epoch and the current revision.
    await expect(
      net.change("PERMISSION_GRANT", { permissionRef: u(4), bindingDigest: DIGEST, epoch: "1", entityTypes: ALL_ENTITIES }, ["admin1"], "2"),
    ).rejects.toThrow("epoch must be 2");
    const regrant = await net.change(
      "PERMISSION_GRANT",
      { permissionRef: u(4), bindingDigest: DIGEST, epoch: "2", entityTypes: ALL_ENTITIES },
      ["admin1"],
      "2",
    );
    expect(regrant.result).toMatchObject({ epoch: "2", status: "ACTIVE" });
  });

  it("is idempotent for a repeated proposal and keeps the nonce in the identity", async () => {
    const net = new Network();
    const payload = { channelId: "hybrid-b", strictB: true, allowLegacyV3Writes: false };
    const first = await net.propose("CHANNEL_BOOTSTRAP", payload, "0", u(1));
    expect(await net.propose("CHANNEL_BOOTSTRAP", payload, "0", u(1))).toBe(first);
    expect(await net.propose("CHANNEL_BOOTSTRAP", payload, "0", u(2))).not.toBe(first);
  });
});

describe("RecordBindingEvent", () => {
  it("records an event with its proof, head and history, and exposes registry reads", async () => {
    const net = await readyNetwork();
    const e = event();
    const receipt = JSON.parse(await record(net, "relayer", e));
    expect(receipt).toMatchObject({ status: "SUBMITTED", eventId: u(1), dataHash: e.dataHash });
    const proof = JSON.parse(await net.contract.GetBindingProof(net.ctx("relayer"), u(3), u(1)));
    expect(proof).toMatchObject({ dataHash: e.dataHash, bindingDigest: DIGEST, privateBodyDigest: e.privateBodyDigest });
    expect(JSON.parse(await net.contract.GetBindingHead(net.ctx("relayer"), u(3), "PRODUCTION_CYCLE", u(2)))).toMatchObject({
      eventCount: 1,
      lastDataHash: e.dataHash,
    });
    const page = JSON.parse(
      await net.contract.QueryBindingHistoryPage(net.ctx("relayer"), u(3), "PRODUCTION_CYCLE", u(2), "10", ""),
    );
    expect(page.records).toHaveLength(1);
    expect(net.stub.events.at(-1)?.name).toBe("BindingEventRecorded");
  });

  it("rejects a dataHash that is not the commitment of the public body, even when only context is swapped", async () => {
    const net = await readyNetwork();
    const good = event();
    await expect(
      record(net, "relayer", { ...good, chainRef: u(9) }),
    ).rejects.toThrow("not the commitment");
    await expect(
      record(net, "relayer", { ...good, permissions: [{ permissionRef: u(4), epoch: "2", ordinal: "1" }] }),
    ).rejects.toThrow("not the commitment");
  });

  it("rejects wrong MSP, authority, role and unapproved or revoked certificates", async () => {
    const net = await readyNetwork();
    await expect(record(net, "rogue", event())).rejects.toThrow("not an approved credential");
    await expect(record(net, "admin1", event())).rejects.toThrow("UNAUTHORIZED_RELAYER");
    const wrongAuthority = net.ctx("relayer");
    (wrongAuthority.clientIdentity as unknown as FakeClientIdentity).attributes["app.authority"] = "technical-relayer:other";
    await expect(
      net.contract.RecordBindingEvent(wrongAuthority, JSON.stringify(event()), JSON.stringify({ generation: "0" })),
    ).rejects.toThrow("differs from the binding writer");
    const otherMsp = net.ctx("relayer");
    (otherMsp.clientIdentity as unknown as FakeClientIdentity).mspId = "Org2MSP";
    await expect(
      net.contract.RecordBindingEvent(otherMsp, JSON.stringify(event()), JSON.stringify({ generation: "0" })),
    ).rejects.toThrow("differs from the binding writer");
    await net.change(
      "CREDENTIAL_REVOKE",
      { bindingDigest: DIGEST, authority: AUTHORITY, certFingerprint: RELAYER_FP },
      ["admin2"],
      "1",
    );
    await expect(record(net, "relayer", event())).rejects.toThrow("not an approved credential");
  });

  it("requires every captured permission to be active at its epoch and to cover the entity", async () => {
    const net = await readyNetwork();
    await expect(
      record(net, "relayer", event({ permissions: [{ permissionRef: u(4), epoch: "2", ordinal: "1" }] })),
    ).rejects.toThrow("PERMISSION_INACTIVE");
    await expect(
      record(net, "relayer", event({ permissions: [{ permissionRef: u(8), epoch: "1", ordinal: "1" }] })),
    ).rejects.toThrow("PERMISSION_INACTIVE");
    await expect(
      record(net, "relayer", event({ entityType: "LOT", entityId: u(6), cycleId: null, lotId: u(6), eventType: "LOT_EXPIRED" })),
    ).rejects.toThrow("does not cover LOT");
    await net.change("PERMISSION_REVOKE", { permissionRef: u(4), epoch: "1" }, ["admin1"], "1");
    await expect(record(net, "relayer", event())).rejects.toThrow("not active at epoch 1");
  });

  it("is idempotent on duplicates, detects conflicting tuples and enforces the hash chain", async () => {
    const net = await readyNetwork();
    const first = event();
    await record(net, "relayer", first);
    await expect(record(net, "relayer", first)).rejects.toThrow("DUPLICATE_EVENT:");
    await expect(
      record(net, "relayer", event({ eventTime: "2026-10-13T00:00:01.000Z" })),
    ).rejects.toThrow("DUPLICATE_EVENT_CONFLICT");
    const orphan = event({ eventId: u(11), nonce: u(11), previousEventHash: null });
    await expect(record(net, "relayer", orphan)).rejects.toThrow("HASH_CHAIN_CONFLICT");
    const second = event({
      eventId: u(12),
      nonce: u(12),
      eventType: "CARE_RECORDED",
      entityType: "PRODUCTION_CYCLE",
      previousEventHash: first.dataHash,
      permissions: [{ permissionRef: u(4), epoch: "1", ordinal: "2" }],
    });
    await record(net, "relayer", second);
    expect(JSON.parse(await net.contract.GetBindingHead(net.ctx("relayer"), u(3), "PRODUCTION_CYCLE", u(2)))).toMatchObject({
      eventCount: 2,
      lastDataHash: second.dataHash,
    });
    await expect(
      record(net, "relayer", event({ eventId: u(13), nonce: u(13), previousEventHash: "cc".repeat(32) })),
    ).rejects.toThrow("HASH_CHAIN_CONFLICT");
  });

  it("fences delivery generations: a stale credential attempt cannot land after a fence", async () => {
    const net = await readyNetwork();
    const e = event();
    const fencePayload = { chainRef: u(3), bindingDigest: DIGEST, eventId: u(1), dataHash: e.dataHash };
    const fenced = await net.change("FENCE_DELIVERY", fencePayload, ["admin1"]);
    expect(fenced.result).toMatchObject({ outcome: "FENCED", generation: "1" });
    await expect(record(net, "relayer", e, "0")).rejects.toThrow("DELIVERY_FENCED");
    await record(net, "relayer", e, "1");
    // After commit the same fence request reports the committed tuple instead.
    const again = await net.change("FENCE_DELIVERY", fencePayload, ["admin1"], "1");
    expect(again.result).toMatchObject({ outcome: "EVENT_COMMITTED", dataHash: e.dataHash });
  });

  it("rejects a fence that pins a different commitment than the event delivered", async () => {
    const net = await readyNetwork();
    await net.change(
      "FENCE_DELIVERY",
      { chainRef: u(3), bindingDigest: DIGEST, eventId: u(1), dataHash: "dd".repeat(32) },
      ["admin1"],
    );
    await expect(record(net, "relayer", event(), "1")).rejects.toThrow("pins a different event commitment");
  });

  it("requires the channel bootstrap, a registered binding and the same channel/chain", async () => {
    const bare = new Network();
    await expect(record(bare, "relayer", event())).rejects.toThrow("CHANNEL_NOT_BOOTSTRAPPED");
    const bootstrapped = new Network();
    await bootstrapped.change("CHANNEL_BOOTSTRAP", { channelId: "hybrid-b", strictB: true, allowLegacyV3Writes: false }, ["admin1", "admin2"]);
    await expect(record(bootstrapped, "relayer", event())).rejects.toThrow("BINDING_UNKNOWN");
    const net = await readyNetwork();
    await expect(
      record(net, "relayer", event({ chainRef: u(77) })),
    ).rejects.toThrow("BINDING_MISMATCH");
  });

  it("refuses a channel bootstrap that claims release-A writes", async () => {
    const net = new Network("hybrid-self");
    await expect(
      net.propose("CHANNEL_BOOTSTRAP", { channelId: "hybrid-self", strictB: true, allowLegacyV3Writes: true }),
    ).rejects.toThrow("INVALID_INPUT");
  });

  it("reports health with governance digest, caller role and channel policy", async () => {
    const net = await readyNetwork();
    const health = JSON.parse(await net.contract.HealthCheck(net.ctx("relayer")));
    expect(health).toMatchObject({
      supportedWriteVersions: ["4.0.0", "6.0.0"],
      governanceDigest: GOVERNANCE_DIGEST,
      callerRole: "relayer",
      channelPolicy: { strictB: true, allowLegacyV3Writes: false },
    });
  });
});
