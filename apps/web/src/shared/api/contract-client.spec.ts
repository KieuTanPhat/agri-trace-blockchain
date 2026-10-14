import { describe, expect, it, vi } from "vitest";
import { createContractClient, type ContractTransport } from "./generated/client";

describe("generated contract client transport boundary", () => {
  function setup() {
    const transport = vi.fn<ContractTransport>().mockResolvedValue({});
    return { transport, client: createContractClient(transport as ContractTransport) };
  }

  it("sends generated login body anonymously through the shared transport", async () => {
    const { transport, client } = setup();
    await client.login({ email: "phi@example.test", password: "password" });
    expect(transport).toHaveBeenCalledWith("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "phi@example.test", password: "password" }),
    }, false);
  });

  it("encodes a public trace token exactly once and disables authentication", async () => {
    const { transport, client } = setup();
    await client.getPublicTrace({ token: "a/b %?" });
    expect(transport).toHaveBeenCalledWith("/public/trace/a%2Fb%20%25%3F", { method: "GET" }, false);
  });

  it("keeps authenticated reads and returns already unwrapped data", async () => {
    const { transport, client } = setup();
    const data = { products: [], farms: [], plots: [] };
    transport.mockResolvedValue(data);
    expect(await client.getCatalog()).toBe(data);
    expect(transport).toHaveBeenCalledWith("/catalog", { method: "GET" }, true);
    await client.getLot({ lotId: "lot/1" });
    expect(transport).toHaveBeenLastCalledWith("/lots/lot%2F1", { method: "GET" }, true);
  });

  it("preserves caller headers and cancellation on mutations", async () => {
    const { transport, client } = setup();
    const signal = new AbortController().signal;
    const headers = new Headers({ "idempotency-key": "original-key" });
    // The actual payload shape is checked against the generated operation.
    const input: Parameters<typeof client.recordHarvest>[1] = {
      quantity: 10,
      harvestTime: "2026-10-14T00:00:00.000Z",
      unit: "kg",
    };
    await client.recordHarvest({ cycleId: "cycle-1" }, input, { headers, signal });
    expect(transport).toHaveBeenCalledWith("/production-cycles/cycle-1/harvests", {
      method: "POST", body: JSON.stringify(input), headers, signal,
    }, true);
  });
});
