// Enterprise-side registry approval. No platform DB or enterprise key transfer.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { canonicalize } from "json-canonicalize";
import {
  BindingLedgerClient,
  connectGateway,
} from "../../gateway/dist/index.js";
import { validateSpec } from "./peer.mjs";

const [operation, specFile, rootArg, reviewFile, reviewedDigest] =
  process.argv.slice(2);
assert.ok(
  ["inspect", "approve"].includes(operation) &&
    specFile &&
    rootArg &&
    reviewFile,
  "Usage: node approve-registry.mjs <inspect|approve> spec.json private-root review.json [reviewed-sha256]",
);
const spec = validateSpec(JSON.parse(readFileSync(specFile, "utf8")));
const root = path.resolve(rootArg),
  review = JSON.parse(readFileSync(reviewFile, "utf8"));
const descriptor = JSON.parse(
  readFileSync(
    new URL("../../chaincode/src/governance.json", import.meta.url),
    "utf8",
  ),
);
const governanceDigest = createHash("sha256")
  .update(canonicalize(descriptor))
  .digest("hex");
assert.equal(review.channelId, spec.channelId);
assert.equal(review.chaincodeName, spec.chaincodeName);
assert.equal(review.contractName, "AgriTraceContract");
assert.equal(review.governanceDigest, governanceDigest);
assert.equal(descriptor.channels[spec.channelId]?.ownerMsp, spec.mspId);
assert.match(review.proposal?.proposalId, /^[a-f0-9]{64}$/);
const digest = createHash("sha256").update(canonicalize(review)).digest("hex");
if (operation === "approve")
  assert.equal(
    reviewedDigest,
    digest,
    "Inspect the exact proposal and pass its reviewed SHA-256",
  );
const org = path.join(root, "crypto/peerOrganizations", spec.domain);
const admin = path.join(org, "users", `Admin@${spec.domain}`, "msp");
const certs = readdirSync(path.join(admin, "signcerts"));
assert.equal(certs.length, 1);
let connection;
try {
  connection = await connectGateway({
    channelName: spec.channelId,
    chaincodeName: spec.chaincodeName,
    contractName: review.contractName,
    mspId: spec.mspId,
    peerEndpoint: `localhost:${spec.peerPort}`,
    peerHostAlias: spec.peerServerName,
    tlsCertPath: path.join(org, "peers", spec.peerServerName, "tls/ca.crt"),
    identityCertPath: path.join(admin, "signcerts", certs[0]),
    identityKeyDirectory: path.join(admin, "keystore"),
  });
  const client = new BindingLedgerClient(connection.gateway, {
    channelName: spec.channelId,
    chaincodeName: spec.chaincodeName,
    contractName: review.contractName,
  });
  const health = await client.health();
  assert.equal(health.governanceDigest, governanceDigest);
  assert.equal(health.callerRole, "admin");
  const existing = await client.getRegistryProposal(review.proposal.proposalId);
  for (const key of [
    "proposalId",
    "kind",
    "payload",
    "expectedRevision",
    "nonce",
    "proposerMsp",
  ])
    assert.equal(
      canonicalize(existing[key]),
      canonicalize(review.proposal[key]),
      `Ledger proposal differs: ${key}`,
    );
  assert.equal(
    existing.proposerMsp,
    descriptor.channels[spec.channelId].writerMsp,
  );
  if (operation === "inspect")
    console.log(
      JSON.stringify(
        { reviewedSha256: digest, review, ledgerStatus: existing.status },
        null,
        2,
      ),
    );
  else if (existing.status === "EXECUTED")
    console.log(
      JSON.stringify({ proposalId: existing.proposalId, status: "EXECUTED" }),
    );
  else {
    await client.invoke("ApproveRegistryChange", [existing.proposalId]);
    console.log(
      JSON.stringify({
        proposalId: existing.proposalId,
        approvedByMsp: spec.mspId,
      }),
    );
  }
} finally {
  connection?.close();
}
