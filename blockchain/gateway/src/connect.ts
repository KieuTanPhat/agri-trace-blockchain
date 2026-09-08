import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { connect, hash, signers, type Gateway } from "@hyperledger/fabric-gateway";
import * as grpc from "@grpc/grpc-js";

import type { GatewayConfig } from "./config.js";

export interface GatewayConnection {
  gateway: Gateway;
  client: grpc.Client;
  close(): void;
}

export async function connectGateway(config: GatewayConfig): Promise<GatewayConnection> {
  const tlsRootCert = await fs.readFile(config.tlsCertPath);
  const credentials = grpc.credentials.createSsl(tlsRootCert);
  const client = new grpc.Client(config.peerEndpoint, credentials, {
    "grpc.ssl_target_name_override": config.peerHostAlias
  });

  const certificate = await fs.readFile(config.identityCertPath);
  const privateKeyPath = await findSinglePrivateKey(config.identityKeyDirectory);
  const privateKey = crypto.createPrivateKey(await fs.readFile(privateKeyPath));
  const gateway = connect({
    client,
    identity: { mspId: config.mspId, credentials: certificate },
    signer: signers.newPrivateKeySigner(privateKey),
    hash: hash.sha256,
    evaluateOptions: () => ({ deadline: deadlineAfter(5_000) }),
    endorseOptions: () => ({ deadline: deadlineAfter(15_000) }),
    submitOptions: () => ({ deadline: deadlineAfter(5_000) }),
    commitStatusOptions: () => ({ deadline: deadlineAfter(60_000) })
  });

  return {
    gateway,
    client,
    close: () => {
      gateway.close();
      client.close();
    }
  };
}

async function findSinglePrivateKey(directory: string): Promise<string> {
  const names = (await fs.readdir(directory)).filter((name) => !name.startsWith("."));
  if (names.length !== 1) {
    throw new Error(`Expected exactly one relayer private key in ${directory}; found ${names.length}`);
  }
  return path.join(directory, names[0]);
}

function deadlineAfter(milliseconds: number): Date {
  return new Date(Date.now() + milliseconds);
}
