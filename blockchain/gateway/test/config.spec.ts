import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("Gateway configuration", () => {
  it("derives official test-network paths and defaults", () => {
    const config = loadConfig({ FABRIC_SAMPLES_DIR: "./samples", RELAYER_MSP_DIR: "./relayer/msp" });
    expect(config).toMatchObject({
      channelName: "agritrace",
      chaincodeName: "agritrace",
      contractName: "AgriTraceContract",
      mspId: "Org1MSP",
      peerEndpoint: "localhost:7051",
      peerHostAlias: "peer0.org1.example.com"
    });
    expect(config.tlsCertPath).toContain(path.join("test-network", "organizations"));
    expect(config.identityCertPath).toContain(path.join("relayer", "msp", "signcerts", "cert.pem"));
  });

  it("requires the two runtime roots", () => {
    expect(() => loadConfig({})).toThrow("FABRIC_SAMPLES_DIR");
    expect(() => loadConfig({ FABRIC_SAMPLES_DIR: "./samples" })).toThrow("RELAYER_MSP_DIR");
  });
});
