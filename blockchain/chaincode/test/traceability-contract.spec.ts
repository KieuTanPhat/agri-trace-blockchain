import { describe, expect, it } from "vitest";

import { AgriTraceContract } from "../src/traceability-contract";
import { createFakeContext } from "./helpers/fake-context";
import { AUTHORITY, DIGEST, RELAYER_FP, readyNetwork, u } from "./helpers/network";

describe("AgriTraceContract", () => {
  it("returns stable health metadata", async () => {
    const contract = new AgriTraceContract();
    const { ctx } = createFakeContext();
    const health = JSON.parse(await contract.HealthCheck(ctx));
    expect(health).toMatchObject({
      contract: "AgriTraceContract",
      status: "OK",
      supportedWriteVersions: ["4.0.0", "6.0.0"],
      registryProtocol: "agritrace-governance/1",
      callerRole: "relayer",
    });
    expect(health).not.toHaveProperty("supportedReadVersions");
    expect(health.governanceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(health.channelPolicy ?? null).toBeNull();
  });

  it("reads registry entries and fences, and reports missing ones as NOT_FOUND", async () => {
    const net = await readyNetwork();
    const ctx = () => net.ctx("relayer");
    expect(JSON.parse(await net.contract.GetRegistryBinding(ctx(), DIGEST)).digest ?? DIGEST).toBe(DIGEST);
    expect(JSON.parse(await net.contract.GetRegistryCredential(ctx(), DIGEST, AUTHORITY, RELAYER_FP))).toBeTruthy();
    expect(JSON.parse(await net.contract.GetDeliveryFence(ctx(), u(3), u(1)))).toEqual({ generation: "0" });
    await expect(net.contract.GetRegistryBinding(ctx(), "ab".repeat(32))).rejects.toThrow("NOT_FOUND");
    await expect(net.contract.GetRegistryPermission(ctx(), u(404))).rejects.toThrow("NOT_FOUND");
    await expect(net.contract.GetRegistryCredential(ctx(), DIGEST, AUTHORITY, "cd".repeat(32))).rejects.toThrow("NOT_FOUND");
    await expect(net.contract.GetRegistryProposal(ctx(), "ef".repeat(32))).rejects.toThrow("NOT_FOUND");
    await expect(net.contract.GetRegistrySigningKey(ctx(), DIGEST, u(405))).rejects.toThrow("NOT_FOUND");
    for (const size of ["0", "501", "1.5", "x"])
      await expect(
        net.contract.QueryBindingHistoryPage(ctx(), u(3), "CARE", u(2), size, ""),
      ).rejects.toThrow("INVALID_INPUT");
    await expect(
      net.contract.QueryBindingHistoryPage(ctx(), u(3), "NOT_A_TYPE", u(2), "10", ""),
    ).rejects.toThrow("INVALID_INPUT");
  });

  it("exposes no release-A entrypoints", () => {
    const contract = new AgriTraceContract() as unknown as Record<string, unknown>;
    for (const name of [
      "RecordTraceEvent",
      "QueryEvent",
      "GetProof",
      "GetExpectedHash",
      "GetEntityHead",
      "QueryEntityHistory",
      "QueryEntityHistoryPage",
    ])
      expect(contract[name]).toBeUndefined();
  });
});
