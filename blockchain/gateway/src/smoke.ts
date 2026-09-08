import crypto from "node:crypto";

import { canonicalize as canonicalizeJson } from "json-canonicalize";

import { FabricBlockchainAdapter, type TraceEventInput } from "./adapter.js";
import { loadConfig } from "./config.js";
import { connectGateway } from "./connect.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const connection = await connectGateway(config);
  try {
    const adapter = new FabricBlockchainAdapter(connection.gateway, config);
    const eventId = crypto.randomUUID();
    const batchId = `SMOKE-${Date.now()}`;
    const actorId = crypto.randomUUID();
    const now = new Date().toISOString();
    const payload = { batchId, productType: "coffee", variety: "Robusta", createdAt: now };
    const input: TraceEventInput = {
      eventId,
      batchId,
      eventType: "BATCH_CREATED",
      eventTime: now,
      dataHash: sha256(canonicalize(payload)),
      schemaVersion: "1.0.0",
      canonicalizationVersion: "RFC8785",
      actorContext: {
        actorId,
        role: "FARM_STAFF",
        organizationId: crypto.randomUUID()
      },
      actorAuthProof: {
        proofType: "BACKEND_AUTH_CONTEXT",
        principalId: actorId,
        authenticatedAt: now,
        requestId: crypto.randomUUID(),
        proofHash: sha256(canonicalize({ actorId, requestId: eventId, authenticatedAt: now }))
      },
      payloadMetadata: { productType: "coffee", variety: "Robusta" }
    };

    const receipt = await adapter.submitTraceEvent(input);
    const [event, proof, state, history] = await Promise.all([
      adapter.queryEvent(eventId),
      adapter.getProof(eventId),
      adapter.getBatchState(batchId),
      adapter.queryBatchHistory(batchId)
    ]);
    const expectedHash = await adapter.getExpectedHash(eventId);
    if (expectedHash !== input.dataHash) throw new Error("Expected hash did not match submitted digest");

    console.log(JSON.stringify({ receipt, event, proof, state, history }, null, 2));
  } finally {
    connection.close();
  }
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalize(value: unknown): string {
  const result = canonicalizeJson(value);
  if (result === undefined) throw new Error("Smoke payload cannot be RFC 8785 canonicalized");
  return result;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
