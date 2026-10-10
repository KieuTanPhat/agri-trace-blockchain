import crypto from "node:crypto";

import { canonicalize as canonicalizeJson } from "json-canonicalize";

import { FabricBlockchainAdapter, type TraceEventEnvelope } from "./adapter.js";
import { loadConfig } from "./config.js";
import { connectGateway } from "./connect.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const connection = await connectGateway(config);
  try {
    const adapter = new FabricBlockchainAdapter(connection.gateway, config);
    const eventId = crypto.randomUUID();
    const cycleId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const now = new Date().toISOString();
    const payload = {
      cycleId,
      productType: "coffee",
      variety: "Robusta",
      createdAt: now,
    };
    const input: TraceEventEnvelope = {
      eventId,
      nonce: eventId,
      envelopeVersion: "3.0.0",
      entityType: "PRODUCTION_CYCLE",
      entityId: cycleId,
      cycleId,
      eventType: "PRODUCTION_CYCLE_CREATED",
      eventTime: now,
      dataHash: sha256(
        canonicalize({ eventId, actorId, businessData: payload }),
      ),
      schemaVersion: "2.0.0",
      canonicalizationVersion: "RFC8785",
    };

    const receipt = await adapter.submitTraceEvent(input);
    const [event, proof, head, history] = await Promise.all([
      adapter.queryEvent(eventId),
      adapter.getProof(eventId),
      adapter.getEntityHead("PRODUCTION_CYCLE", cycleId),
      adapter.queryEntityHistory("PRODUCTION_CYCLE", cycleId),
    ]);
    const expectedHash = await adapter.getExpectedHash(eventId);
    if (expectedHash !== input.dataHash)
      throw new Error("Expected hash did not match submitted digest");

    console.log(
      JSON.stringify({ receipt, event, proof, head, history }, null, 2),
    );
  } finally {
    connection.close();
  }
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalize(value: unknown): string {
  const result = canonicalizeJson(value);
  if (result === undefined)
    throw new Error("Smoke payload cannot be RFC 8785 canonicalized");
  return result;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
