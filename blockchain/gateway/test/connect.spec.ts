import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GatewayConfig } from "../src/config.js";
import { connectGateway } from "../src/connect.js";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  createPrivateKey: vi.fn(),
  newPrivateKeySigner: vi.fn(),
  connect: vi.fn(),
  Client: vi.fn(),
  createSsl: vi.fn(),
  client: { close: vi.fn() },
  gateway: { close: vi.fn() },
  signer: vi.fn(),
  credentials: {},
  privateKey: {}
}));

vi.mock("node:fs/promises", () => ({ default: { readFile: mocks.readFile, readdir: mocks.readdir } }));
vi.mock("node:crypto", () => ({ default: { createPrivateKey: mocks.createPrivateKey } }));
vi.mock("@grpc/grpc-js", () => ({ Client: mocks.Client, credentials: { createSsl: mocks.createSsl } }));
vi.mock("@hyperledger/fabric-gateway", () => ({
  connect: mocks.connect,
  hash: { sha256: "sha256" },
  signers: { newPrivateKeySigner: mocks.newPrivateKeySigner }
}));

const config: GatewayConfig = {
  channelName: "agritrace",
  chaincodeName: "agritrace",
  contractName: "AgriTraceContract",
  mspId: "Org1MSP",
  peerEndpoint: "peer.test:7051",
  peerHostAlias: "peer.test",
  tlsCertPath: "tls.pem",
  identityCertPath: "identity.pem",
  identityKeyDirectory: "keystore"
};

describe("Gateway connection lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.readFile.mockResolvedValue(Buffer.from("test certificate or key"));
    mocks.readdir.mockResolvedValue(["relayer-key.pem"]);
    mocks.createPrivateKey.mockReturnValue(mocks.privateKey);
    mocks.newPrivateKeySigner.mockReturnValue(mocks.signer);
    mocks.createSsl.mockReturnValue(mocks.credentials);
    mocks.Client.mockImplementation(function () { return mocks.client; });
    mocks.connect.mockReturnValue(mocks.gateway);
  });

  afterEach(() => vi.useRealTimers());

  it("does not allocate a client when the TLS certificate cannot be read", async () => {
    const failure = new Error("TLS certificate unavailable");
    mocks.readFile.mockRejectedValueOnce(failure);

    await expect(connectGateway(config)).rejects.toBe(failure);
    expect(mocks.Client).not.toHaveBeenCalled();
    expect(mocks.client.close).not.toHaveBeenCalled();
  });

  it.each(["identity certificate", "key directory", "private key read", "private key parse", "signer", "connect"])(
    "closes the client once and preserves a failure from %s",
    async (stage) => {
      const failure = new Error(`${stage} unavailable`);
      if (stage === "identity certificate") {
        mocks.readFile.mockResolvedValueOnce(Buffer.from("TLS")).mockRejectedValueOnce(failure);
      } else if (stage === "key directory") {
        mocks.readdir.mockRejectedValueOnce(failure);
      } else if (stage === "private key read") {
        mocks.readFile.mockResolvedValueOnce(Buffer.from("TLS"))
          .mockResolvedValueOnce(Buffer.from("identity")).mockRejectedValueOnce(failure);
      } else {
        const operation = stage === "private key parse" ? mocks.createPrivateKey
          : stage === "signer" ? mocks.newPrivateKeySigner : mocks.connect;
        operation.mockImplementationOnce(() => { throw failure; });
      }

      await expect(connectGateway(config)).rejects.toBe(failure);
      expect(mocks.Client).toHaveBeenCalledTimes(1);
      expect(mocks.client.close).toHaveBeenCalledTimes(1);
      expect(mocks.gateway.close).not.toHaveBeenCalled();
    }
  );

  it.each([{ names: [] }, { names: ["first.pem", "second.pem"] }])("closes the client when the key directory is ambiguous: $names", async ({ names }) => {
    mocks.readdir.mockResolvedValueOnce(names);

    await expect(connectGateway(config)).rejects.toThrow("Expected exactly one relayer private key");
    expect(mocks.client.close).toHaveBeenCalledTimes(1);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("preserves the initialization error even if closing the client throws", async () => {
    const failure = new Error("identity certificate unavailable");
    mocks.readFile.mockResolvedValueOnce(Buffer.from("TLS")).mockRejectedValueOnce(failure);
    mocks.client.close.mockImplementationOnce(() => { throw new Error("cleanup failure"); });

    await expect(connectGateway(config)).rejects.toBe(failure);
    expect(mocks.client.close).toHaveBeenCalledTimes(1);
  });

  it("keeps a successful connection open with the existing identity and deadlines until the caller closes it", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-09T00:00:00.000Z");
    vi.setSystemTime(now);

    const connection = await connectGateway(config);

    expect(connection.client).toBe(mocks.client);
    expect(connection.gateway).toBe(mocks.gateway);
    expect(mocks.client.close).not.toHaveBeenCalled();
    expect(mocks.gateway.close).not.toHaveBeenCalled();
    expect(mocks.Client).toHaveBeenCalledWith(config.peerEndpoint, mocks.credentials, {
      "grpc.ssl_target_name_override": config.peerHostAlias
    });
    expect(mocks.readFile).toHaveBeenCalledWith(path.join(config.identityKeyDirectory, "relayer-key.pem"));
    const options = mocks.connect.mock.calls[0][0];
    expect(options).toMatchObject({
      client: mocks.client,
      identity: { mspId: config.mspId, credentials: Buffer.from("test certificate or key") },
      signer: mocks.signer,
      hash: "sha256"
    });
    for (const [name, delay] of [
      ["evaluateOptions", 5_000], ["endorseOptions", 15_000],
      ["submitOptions", 5_000], ["commitStatusOptions", 60_000]
    ] as const) {
      expect(options[name]()).toEqual({ deadline: new Date(now.getTime() + delay) });
    }

    connection.close();
    expect(mocks.gateway.close).toHaveBeenCalledTimes(1);
    expect(mocks.client.close).toHaveBeenCalledTimes(1);
  });
});
