/**
 * Real-ledger acceptance for the hybrid release B protocol (HYB-AC-09/11/12/13/
 * 19/20 at ledger level). Runs on the host against the local three-organization
 * pilot started by hybrid-network.sh. Not a mock: every check commits to or
 * queries real peers, endorsement policies and the Raft orderer.
 *
 *   FABRIC_ROOT   Linux data dir as seen by this host (UNC path under WSL)
 *   HYBRID_SCRIPT WSL path of hybrid-network.sh (for certificate rotation)
 *
 * Org3 (self-managed) keys are read from its own directory solely to act as
 * the owner's operator in this harness; the API/Worker export never contains them.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { verifyExport, wslPath } from "./export-check.mts";

import {
  BindingLedgerClient,
  RegistryOperator,
  certificateFingerprint,
  classifyFabricError,
  connectGateway,
  type FabricFailure,
  type GatewayConnection,
} from "../../../gateway/src/index.ts";
import chaincodeBinding from "../../../chaincode/src/binding.ts";
import type { BindingEventInput, BindingTuple } from "../../../chaincode/src/binding.ts";
import chaincodeSigning from "../../../chaincode/src/signing.ts";
import type { SignatureAssertion, SignedBindingEventInput } from "../../../chaincode/src/signing.ts";
import { createHash, generateKeyPairSync, sign as edSign } from "node:crypto";

// The chaincode package is CommonJS; read its encoders through the default export.
const { bindingDigest, bindingEventCommitment } = chaincodeBinding as unknown as typeof import("../../../chaincode/src/binding.ts");
const { assertionDigest, intentSignedMessage, keyPopMessage, signedBindingEventCommitment, signedPrivateBodyDigest } =
  chaincodeSigning as unknown as typeof import("../../../chaincode/src/signing.ts");

const ROOT = process.env.FABRIC_ROOT ?? path.join(homedir(), 'agritrace-fabric');
const SCRIPT =
  process.env.HYBRID_SCRIPT ??
  fileURLToPath(new URL('../hybrid-network.sh', import.meta.url));
const CHAINCODE = "agritrace";
const CONTRACT = "AgriTraceContract";
const AUTHORITY = "agritrace-relayer-b";

type Org = "org1" | "org2" | "org3";
const offset = Number(process.env.AGRI_FABRIC_PORT_OFFSET ?? '0');
if (!Number.isInteger(offset) || offset < 0 || offset > 50000) throw new Error('Invalid Fabric test port offset');
const ORG = {
  org1: { dir: "net", msp: "Org1MSP", endpoint: `localhost:${7051 + offset}` },
  org2: { dir: "net", msp: "Org2MSP", endpoint: `localhost:${9051 + offset}` },
  org3: { dir: "self", msp: "Org3MSP", endpoint: `localhost:${11051 + offset}` },
} as const;

const orgDir = (org: Org) => path.join(ROOT, ORG[org].dir, "organizations", "peerOrganizations", `${org}.example.com`);
const userDir = (org: Org, name: string) => path.join(orgDir(org), "users", `${name}@${org}.example.com`, "msp");
const peerCa = (org: Org) => path.join(orgDir(org), "peers", `peer0.${org}.example.com`, "tls", "ca.crt");

const connections: GatewayConnection[] = [];
async function identity(org: Org, user: string, channel: string) {
  const msp = user === "Admin" ? userDir(org, "Admin") : userDir(org, user);
  const connection = await connectGateway({
    channelName: channel,
    chaincodeName: CHAINCODE,
    contractName: CONTRACT,
    mspId: ORG[org].msp,
    peerEndpoint: ORG[org].endpoint,
    peerHostAlias: `peer0.${org}.example.com`,
    tlsCertPath: peerCa(org),
    identityCertPath: path.join(msp, "signcerts", "cert.pem"),
    identityKeyDirectory: path.join(msp, "keystore"),
  });
  connections.push(connection);
  return {
    client: new BindingLedgerClient(connection.gateway, { channelName: channel, chaincodeName: CHAINCODE, contractName: CONTRACT }),
    fingerprint: certificateFingerprint(readFileSync(path.join(msp, "signcerts", "cert.pem"))),
  };
}

interface Result { id: string; ac: string; name: string; status: "PASS" | "FAIL"; detail?: string }
const results: Result[] = [];
async function check(ac: string, name: string, run: () => Promise<string | void>) {
  const id = `${ac}-${String(results.filter((r) => r.ac === ac).length + 1).padStart(2, "0")}`;
  try {
    const detail = await run();
    results.push({ id, ac, name, status: "PASS", ...(detail ? { detail } : {}) });
    console.log(`PASS ${id} ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ id, ac, name, status: "FAIL", detail });
    console.log(`FAIL ${id} ${name} — ${detail}`);
  }
}

async function failure(run: () => Promise<unknown>): Promise<FabricFailure> {
  try {
    await run();
  } catch (error) {
    const code = (error as { validationCode?: string }).validationCode;
    if (code)
      return { kind: "COMMIT_INVALID", validationCode: code, message: (error as Error).message, unknownOutcome: false };
    return classifyFabricError(error);
  }
  throw new Error("expected a failure but the operation succeeded");
}
function expectChaincode(fail: FabricFailure, code: string) {
  if (fail.kind !== "CHAINCODE" || fail.chaincodeCode !== code)
    throw new Error(`expected chaincode ${code}, got ${fail.kind}/${fail.chaincodeCode ?? fail.validationCode}: ${fail.message.slice(0, 160)}`);
}

interface Channel {
  name: string;
  ownerOrg: Org;
  controller: BindingLedgerClient;
  admin1: BindingLedgerClient;
  adminOwner: BindingLedgerClient;
  relayer: BindingLedgerClient;
  relayerFingerprint: string;
  operator: RegistryOperator;
  governanceDigest: string;
}
const NEEDED = ["CARE", "LOT", "PRODUCTION_CYCLE", "SHIPMENT"];
const u = () => randomUUID();

async function openChannel(name: string, ownerOrg: Org): Promise<Channel> {
  const controller = await identity("org1", "controller", name);
  const admin1 = await identity("org1", "Admin", name);
  const adminOwner = await identity(ownerOrg, "Admin", name);
  const relayer = await identity("org1", "relayer", name);
  const operator = new RegistryOperator(controller.client, {
    Org1MSP: admin1.client,
    [ORG[ownerOrg].msp]: adminOwner.client,
  });
  const health = (await relayer.client.health()) as { governanceDigest: string; channelPolicy: unknown };
  if (!health.channelPolicy)
    await operator.apply(
      "CHANNEL_BOOTSTRAP",
      { channelId: name, strictB: true, allowLegacyV3Writes: false },
      ["Org1MSP", ORG[ownerOrg].msp],
    );
  return {
    name, ownerOrg,
    controller: controller.client, admin1: admin1.client, adminOwner: adminOwner.client,
    relayer: relayer.client, relayerFingerprint: relayer.fingerprint,
    operator, governanceDigest: health.governanceDigest,
  };
}

interface Binding { tuple: BindingTuple; digest: string; permissionRef: string }
async function registerBinding(channel: Channel, options: { fingerprint?: string } = {}): Promise<Binding> {
  const tuple: BindingTuple = {
    network: "agritrace-hybrid-local", channelId: channel.name, chaincodeName: CHAINCODE, contractName: CONTRACT,
    chainRef: u(), envelopeVersion: "4.0.0", writerAuthority: AUTHORITY, writerMspId: "Org1MSP", writerRole: "relayer",
    governanceDigest: channel.governanceDigest,
  };
  const digest = bindingDigest(tuple);
  const both = ["Org1MSP", ORG[channel.ownerOrg].msp];
  await channel.operator.apply("BINDING_REGISTER", { binding: tuple, bindingDigest: digest }, both);
  await channel.operator.apply(
    "CREDENTIAL_APPROVE",
    { bindingDigest: digest, authority: AUTHORITY, certFingerprint: options.fingerprint ?? channel.relayerFingerprint },
    both,
  );
  return { tuple, digest, permissionRef: u() };
}
async function grant(channel: Channel, binding: Binding, ref: string, epoch = "1", revision = "0", entityTypes = NEEDED) {
  return channel.operator.apply(
    "PERMISSION_GRANT",
    { permissionRef: ref, bindingDigest: binding.digest, epoch, entityTypes },
    ["Org1MSP"],
    revision,
  );
}

let ordinal = 0;
function eventFor(binding: Binding, overrides: Partial<BindingEventInput> & { epoch?: string; ref?: string } = {}): BindingEventInput {
  const { epoch, ref, ...rest } = overrides;
  const id = rest.eventId ?? u();
  ordinal += 1;
  const entityId = rest.entityId ?? u();
  const base: BindingEventInput = {
    envelopeVersion: "4.0.0", schemaVersion: "3.0.0", canonicalizationVersion: "RFC8785",
    eventId: id, nonce: id, entityType: "PRODUCTION_CYCLE", entityId, cycleId: entityId, lotId: null,
    eventType: "PRODUCTION_CYCLE_CREATED", eventTime: new Date().toISOString(), previousEventHash: null,
    privateBodyDigest: "ab".repeat(32), bindingDigest: binding.digest, chainRef: binding.tuple.chainRef,
    permissions: [{ permissionRef: ref ?? binding.permissionRef, epoch: epoch ?? "1", ordinal: String(ordinal) }],
    dataHash: "", ...rest,
  };
  return { ...base, dataHash: bindingEventCommitment(base) };
}
const send = async (channel: Channel, event: BindingEventInput, generation = "0", client = channel.relayer, orgs?: string[]) => {
  const endorsed = await client.recordBindingEvent(JSON.stringify(event), JSON.stringify({ generation }), orgs).endorse();
  const outcome = await endorsed.submit();
  if (!outcome.successful)
    throw Object.assign(new Error(`committed as ${outcome.status}`), { validationCode: outcome.status });
  return outcome;
};

function newSigner() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
    sign: (message: Buffer) => edSign(null, message, privateKey).toString("base64url"),
  };
}
type Signer = ReturnType<typeof newSigner>;

/** Registers an organization key through the governed registry (proof of
 * possession, writer and owner approvals). */
async function registerKey(channel: Channel, binding: Binding, signer: Signer, keyRef = u(), orgRef = u()) {
  const fields = { bindingDigest: binding.digest, keyRef, orgRef, algorithm: "Ed25519" as const, publicKey: signer.publicKey };
  const payload = { ...fields, popSignature: signer.sign(keyPopMessage(fields)) };
  await channel.operator.apply("SIGNING_KEY_REGISTER", payload, ["Org1MSP", ORG[channel.ownerOrg].msp]);
  return { keyRef, orgRef };
}

function signedEventFor(
  binding: Binding,
  signer: Signer,
  keyRef: string,
  options: { signAs?: Partial<Record<"chainRef" | "eventId" | "entityId" | "eventType" | "bindingDigest", string>>; intentDigest?: string } = {},
): { event: SignedBindingEventInput; assertion: SignatureAssertion } {
  const eventId = u();
  const entityId = u();
  const intentDigest = options.intentDigest ?? createHash("sha256").update(u()).digest("hex");
  ordinal += 1;
  const signedFields = {
    intentDigest,
    payloadDigest: createHash("sha256").update("quantity:100.000").digest("hex"),
    chainRef: binding.tuple.chainRef,
    eventId,
    entityType: "SHIPMENT",
    entityId,
    eventType: "HANDOVER_OFFERED",
    bindingDigest: binding.digest,
    keyRef,
    ...options.signAs,
  };
  const assertion: SignatureAssertion = {
    algorithm: "Ed25519",
    keyRef,
    intentDigest,
    payloadDigest: signedFields.payloadDigest,
    signature: signer.sign(intentSignedMessage(signedFields)),
  };
  const base: SignedBindingEventInput = {
    envelopeVersion: "6.0.0", schemaVersion: "5.0.0", canonicalizationVersion: "RFC8785",
    eventId, nonce: eventId, entityType: "SHIPMENT", entityId, cycleId: null, lotId: null,
    eventType: "HANDOVER_OFFERED", eventTime: new Date().toISOString(), previousEventHash: null,
    privateBodyDigest: "ab".repeat(32), bindingDigest: binding.digest, chainRef: binding.tuple.chainRef,
    permissions: [{ permissionRef: binding.permissionRef, epoch: "1", ordinal: String(ordinal) }],
    dataHash: "",
    signature: { keyRef, intentDigest, assertionDigest: assertionDigest(assertion), payloadDigest: signedFields.payloadDigest, metadataDigest: "ab".repeat(32) },
  };
  base.privateBodyDigest = signedPrivateBodyDigest(base.signature);
  return { event: { ...base, dataHash: signedBindingEventCommitment(base) }, assertion };
}

const sendSigned = async (
  channel: Channel,
  built: { event: SignedBindingEventInput; assertion: SignatureAssertion },
  generation = "0",
  orgs?: string[],
) => {
  const endorsed = await channel.relayer
    .recordSignedBindingEvent(JSON.stringify(built.event), JSON.stringify(built.assertion), JSON.stringify({ generation }), orgs)
    .endorse();
  const outcome = await endorsed.submit();
  if (!outcome.successful)
    throw Object.assign(new Error(`committed as ${outcome.status}`), { validationCode: outcome.status });
  return outcome;
};

/** Release C on the real ledger: organization signatures, key registry and
 * the handover event types that cannot be written without them. */
async function releaseC(b: Channel, s: Channel) {
  const bind = await registerBinding(b);
  await grant(b, bind, bind.permissionRef);
  const signer = newSigner();
  const { keyRef, orgRef } = await registerKey(b, bind, signer);

  await check("AC-14", "a key registers only with proof of possession and the writer and owner approvals", async () => {
    const stranger = newSigner();
    const fields = { bindingDigest: bind.digest, keyRef: u(), orgRef: u(), algorithm: "Ed25519" as const, publicKey: stranger.publicKey };
    const copied = { ...fields, popSignature: signer.sign(keyPopMessage(fields)) };
    const fail = await failure(() => b.operator.propose("SIGNING_KEY_REGISTER", copied));
    if (!/SIGNATURE_INVALID/.test(fail.message)) throw new Error(fail.message.slice(0, 200));
    const proposal = await b.operator.propose("SIGNING_KEY_REGISTER", { ...fields, popSignature: stranger.sign(keyPopMessage(fields)) });
    await b.operator.approve(proposal, "Org1MSP");
    expectChaincode(await failure(() => b.operator.execute(proposal)), "APPROVALS_MISSING");
    const registered = (await b.relayer.getRegistrySigningKey(bind.digest, keyRef)) as { status: string; orgRef: string };
    if (registered.status !== "ACTIVE" || registered.orgRef !== orgRef) throw new Error(JSON.stringify(registered));
  });
  await check("AC-14", "a signed handover event commits with the signature verified on the ledger", async () => {
    const built = signedEventFor(bind, signer, keyRef);
    await sendSigned(b, built);
    const proof = (await b.relayer.getBindingProof(bind.tuple.chainRef, built.event.eventId)) as {
      signature?: { keyRef: string; orgRef: string; assertionDigest: string };
      dataHash: string;
    };
    if (proof.dataHash !== built.event.dataHash || proof.signature?.orgRef !== orgRef || proof.signature.keyRef !== keyRef)
      throw new Error(JSON.stringify(proof));
    return `signed by org ${orgRef.slice(0, 8)}`;
  });
  await check("AC-14", "a handover event without a signature is refused (no unsigned bypass)", async () => {
    const unsigned = eventFor(bind, { entityType: "SHIPMENT", eventType: "HANDOVER_CONFIRMED", cycleId: null });
    expectChaincode(await failure(() => send(b, unsigned)), "SIGNATURE_REQUIRED");
  });
  await check("AC-21", "a signature moved to another event, entity, type, chain or binding never verifies", async () => {
    const variants: Array<[string, Partial<Record<"chainRef" | "eventId" | "entityId" | "eventType" | "bindingDigest", string>>]> = [
      ["event", { eventId: u() }],
      ["entity", { entityId: u() }],
      ["event type", { eventType: "HANDOVER_CONFIRMED" }],
      ["chain", { chainRef: u() }],
    ];
    for (const [label, signAs] of variants) {
      const built = signedEventFor(bind, signer, keyRef, { signAs });
      expectChaincode(await failure(() => sendSigned(b, built)), "SIGNATURE_INVALID");
      void label;
    }
  });
  await check("AC-21", "a substituted dataHash, intent digest or assertion is refused", async () => {
    const built = signedEventFor(bind, signer, keyRef);
    expectChaincode(
      await failure(() => sendSigned(b, { ...built, event: { ...built.event, dataHash: "ff".repeat(32) } })),
      "INVALID_INPUT",
    );
    const flipped = Buffer.from(built.assertion.signature, "base64url");
    flipped[0] ^= 1;
    expectChaincode(
      await failure(() => sendSigned(b, { ...built, assertion: { ...built.assertion, signature: flipped.toString("base64url") } })),
      "SIGNATURE_INVALID",
    );
    const other = newSigner();
    const forged = signedEventFor(bind, other, keyRef);
    expectChaincode(await failure(() => sendSigned(b, forged)), "SIGNATURE_INVALID");
    const changedAssertion = { ...built.assertion, payloadDigest: createHash("sha256").update("quantity:999.000").digest("hex") };
    const changedSignature = { ...built.event.signature, payloadDigest: changedAssertion.payloadDigest, assertionDigest: assertionDigest(changedAssertion) };
    const changed = { ...built.event, signature: changedSignature, privateBodyDigest: signedPrivateBodyDigest(changedSignature) };
    expectChaincode(await failure(() => sendSigned(b, { assertion: changedAssertion, event: { ...changed, dataHash: signedBindingEventCommitment(changed) } })), "SIGNATURE_INVALID");
    const legacy = { ...built.event, envelopeVersion: "5.0.0", schemaVersion: "4.0.0" };
    expectChaincode(await failure(() => sendSigned(b, { ...built, event: { ...legacy, dataHash: signedBindingEventCommitment(legacy) } })), "INVALID_INPUT");
  });
  await check("AC-14", "an intent signed twice for two events can authorize only one (replay)", async () => {
    const intentDigest = createHash("sha256").update("shared-intent").digest("hex");
    const first = signedEventFor(bind, signer, keyRef, { intentDigest });
    const second = signedEventFor(bind, signer, keyRef, { intentDigest });
    await sendSigned(b, first);
    expectChaincode(await failure(() => sendSigned(b, second)), "SIGNATURE_REPLAY");
    expectChaincode(await failure(() => sendSigned(b, first)), "DUPLICATE_EVENT");
  });
  await check("AC-14", "the owner peer must endorse signed events on its channel", async () => {
    const fail = await failure(() => sendSigned(b, signedEventFor(bind, signer, keyRef), "0", ["Org1MSP"]));
    if (fail.kind !== "COMMIT_INVALID" || fail.validationCode !== "ENDORSEMENT_POLICY_FAILURE")
      throw new Error(`${fail.kind}/${fail.validationCode}`);
  });
  await check("AC-22", "a revoked key refuses even an event whose time claims it was signed earlier", async () => {
    const queued = signedEventFor(bind, signer, keyRef);
    queued.event.eventTime = "2020-01-01T00:00:00.000Z";
    const refreshed = { ...queued.event };
    refreshed.dataHash = signedBindingEventCommitment(refreshed);
    await b.operator.apply("SIGNING_KEY_REVOKE", { bindingDigest: bind.digest, keyRef }, ["Org2MSP"], "1");
    expectChaincode(await failure(() => sendSigned(b, { ...queued, event: refreshed })), "SIGNING_KEY_INACTIVE");
    const state = (await b.relayer.getRegistrySigningKey(bind.digest, keyRef)) as { status: string };
    if (state.status !== "REVOKED") throw new Error(state.status);
  });
  await check("AC-14", "the self-managed channel enforces the same signature rules with its own owner approval", async () => {
    const bindS = await registerBinding(s);
    await grant(s, bindS, bindS.permissionRef);
    const signerS = newSigner();
    const registered = await registerKey(s, bindS, signerS);
    await sendSigned(s, signedEventFor(bindS, signerS, registered.keyRef));
    expectChaincode(
      await failure(() => sendSigned(s, signedEventFor(bindS, newSigner(), registered.keyRef))),
      "SIGNATURE_INVALID",
    );
  });
}

async function main() {
  const b = await openChannel("hybrid-b", "org2");
  const s = await openChannel("hybrid-self", "org3");

  // ---------------------------------------------------------------- AC-09
  const bindB = await registerBinding(b);
  const bindS = await registerBinding(s);
  await grant(b, bindB, bindB.permissionRef);
  await grant(s, bindS, bindS.permissionRef);

  await check("AC-09", "valid events commit on the channel their binding is registered on", async () => {
    const eb = eventFor(bindB);
    const es = eventFor(bindS);
    await send(b, eb);
    await send(s, es);
    const proof = (await b.relayer.getBindingProof(bindB.tuple.chainRef, eb.eventId)) as { dataHash: string; channelId: string };
    if (proof.dataHash !== eb.dataHash || proof.channelId !== "hybrid-b") throw new Error("proof mismatch");
    return `tx on ${proof.channelId}`;
  });
  await check("AC-09", "a binding digest from another channel is unknown here (hash right, route wrong)", async () => {
    expectChaincode(await failure(() => send(s, eventFor(bindB))), "BINDING_UNKNOWN");
    expectChaincode(await failure(() => send(b, eventFor(bindS))), "BINDING_UNKNOWN");
  });
  await check("AC-09", "a binding cannot be registered for a different channel than the one invoked", async () => {
    const tuple = { ...bindS.tuple, chainRef: u() };
    const fail = await failure(() =>
      b.operator.propose("BINDING_REGISTER", { binding: tuple, bindingDigest: bindingDigest(tuple) }),
    );
    if (!/reviewed governance/.test(fail.message)) throw new Error(fail.message.slice(0, 200));
  });
  await check("AC-09", "events of one chain are invisible to the other channel's ledger", async () => {
    const e = eventFor(bindB);
    await send(b, e);
    const fail = await failure(() => s.relayer.getBindingProof(bindB.tuple.chainRef, e.eventId));
    if (!/NOT_FOUND|does not exist/.test(fail.message)) throw new Error(fail.message.slice(0, 200));
  });

  // ---------------------------------------------------------------- AC-11
  await check("AC-11", "a non-relayer identity cannot write binding events", async () => {
    expectChaincode(await failure(() => send(b, eventFor(bindB), "0", b.admin1)), "UNAUTHORIZED_RELAYER");
  });
  await check("AC-11", "the release-A writer is blocked on strict-B channels (V3 downgrade)", async () => {
    const legacy = JSON.stringify({
      envelopeVersion: "3.0.0", nonce: u(), eventId: u(), entityType: "PRODUCTION_CYCLE", entityId: u(), eventType: "PRODUCTION_CYCLE_CREATED",
      eventTime: new Date().toISOString(), dataHash: "cd".repeat(32), schemaVersion: "2.0.0", canonicalizationVersion: "RFC8785",
    });
    expectChaincode(await failure(() => b.relayer.prepare("RecordTraceEvent", [legacy]).endorse()), "LEGACY_WRITES_DISABLED");
  });
  await check("AC-11", "missing endorsement of the owner peer never commits VALID (hosted owner)", async () => {
    const fail = await failure(() => send(b, eventFor(bindB), "0", b.relayer, ["Org1MSP"]));
    if (fail.kind !== "COMMIT_INVALID" || fail.validationCode !== "ENDORSEMENT_POLICY_FAILURE")
      throw new Error(`${fail.kind}/${fail.validationCode} ${fail.message.slice(0, 160)}`);
    return `${fail.kind}/${fail.validationCode}`;
  });
  await check("AC-11", "self-managed peer endorsement is required on its channel and is given when asked", async () => {
    const fail = await failure(() => send(s, eventFor(bindS), "0", s.relayer, ["Org1MSP"]));
    if (fail.kind !== "COMMIT_INVALID" || fail.validationCode !== "ENDORSEMENT_POLICY_FAILURE")
      throw new Error(`${fail.kind}/${fail.validationCode}`);
    await send(s, eventFor(bindS), "0", s.relayer, ["Org1MSP", "Org3MSP"]);
    return `${fail.kind}/${fail.validationCode}`;
  });
  await check("AC-11", "the self-managed peer queries and holds the same committed state", async () => {
    const e = eventFor(bindS);
    await send(s, e);
    const ownerView = await identity("org3", "Admin", "hybrid-self");
    await new Promise((r) => setTimeout(r, 2000));
    const proof = (await ownerView.client.getBindingProof(bindS.tuple.chainRef, e.eventId)) as { dataHash: string };
    if (proof.dataHash !== e.dataHash) throw new Error("owner peer disagrees");
  });
  await check("AC-11", "a wrong-MSP or foreign relayer certificate is not an approved credential", async () => {
    // The owner admin identity (Org3) is neither the writer MSP nor a relayer.
    const foreign = await identity("org3", "Admin", "hybrid-self");
    expectChaincode(await failure(() => send(s, eventFor(bindS), "0", foreign.client)), "UNAUTHORIZED_RELAYER");
  });

  // ---------------------------------------------------------------- AC-12
  await check("AC-12", "the Org3 peer holds no hybrid-b ledger and Org2 none of hybrid-self", async () => {
    const org3OnB = await identity("org3", "Admin", "hybrid-b");
    const org2OnSelf = await identity("org2", "Admin", "hybrid-self");
    const f1 = await failure(() => org3OnB.client.health());
    const f2 = await failure(() => org2OnSelf.client.health());
    return `org3→b: ${f1.kind}; org2→self: ${f2.kind}`;
  });
  await check("AC-12", "the public ledger record holds only reviewed fields (no business data or actor)", async () => {
    const e = eventFor(bindB);
    await send(b, e);
    const stored = (await b.relayer.queryBindingEvent(bindB.tuple.chainRef, e.eventId)) as Record<string, unknown>;
    const allowed = new Set([
      "docType", "envelopeVersion", "schemaVersion", "canonicalizationVersion", "eventId", "nonce", "entityType", "entityId",
      "cycleId", "lotId", "eventType", "eventTime", "previousEventHash", "privateBodyDigest", "bindingDigest", "chainRef",
      "permissions", "dataHash", "txId", "channelId", "recordedAt", "submitterMspId", "submitterId",
    ]);
    const extra = Object.keys(stored).filter((k) => !allowed.has(k));
    if (extra.length) throw new Error(`unexpected public fields: ${extra.join(",")}`);
    if (JSON.stringify(stored).match(/businessData|actorUserId|actorAuthProof|organizationId/)) throw new Error("private field leaked");
  });

  // ---------------------------------------------------------------- AC-13
  await check("AC-13", "private keys of the self-managed owner stay out of the AgriTrace export", async () => {
    // Export this instance into its own isolated root; a missing, unreadable or
    // stale export is a failure, never a pass. Key bytes are compared, not logged.
    const exportDir = path.join(ROOT, `acceptance-export-${randomUUID()}`);
    try {
      const run = process.platform === "win32"
        ? spawnSync("wsl", ["-d", process.env.HYBRID_WSL_DISTRO ?? "Ubuntu", "--exec", "bash", SCRIPT, "export", wslPath(exportDir)], { encoding: "utf8" })
        : spawnSync("bash", [SCRIPT, "export", exportDir], { encoding: "utf8" });
      if (run.status !== 0) throw new Error(`export failed with status ${run.status}`);
      return verifyExport(exportDir, orgDir("org3"));
    } finally {
      rmSync(exportDir, { recursive: true, force: true });
    }
  });
  const r2Run = process.platform === 'win32'
    ? spawnSync('wsl', ['-d', process.env.HYBRID_WSL_DISTRO ?? 'Ubuntu', '--exec', 'bash', SCRIPT, 'rotate-relayer', 'r2'], { encoding: 'utf8' })
    : spawnSync('bash', [SCRIPT, 'rotate-relayer', 'r2'], { encoding: 'utf8' });
  await check("AC-13", "a rotated certificate of the same authority is rejected until governance approves it", async () => {
    if (r2Run.status !== 0) throw new Error(`rotation failed: ${r2Run.stderr?.slice(0, 200)}`);
    const rotated = await identity("org1", "relayer-r2", "hybrid-b");
    expectChaincode(await failure(() => send(b, eventFor(bindB), "0", rotated.client)), "UNAUTHORIZED_RELAYER");
    // Approve the new certificate with both MSPs, then retire the old one (either MSP may revoke).
    await b.operator.apply("CREDENTIAL_APPROVE", { bindingDigest: bindB.digest, authority: AUTHORITY, certFingerprint: rotated.fingerprint }, ["Org1MSP", "Org2MSP"]);
    await send(b, eventFor(bindB), "0", rotated.client);
    await b.operator.apply("CREDENTIAL_REVOKE", { bindingDigest: bindB.digest, authority: AUTHORITY, certFingerprint: b.relayerFingerprint }, ["Org2MSP"], "1");
    expectChaincode(await failure(() => send(b, eventFor(bindB))), "UNAUTHORIZED_RELAYER");
    await send(b, eventFor(bindB), "0", rotated.client);
  });

  // ---------------------------------------------------------------- AC-20
  await check("AC-20", "a grant that is not confirmed on the ledger opens no write", async () => {
    expectChaincode(await failure(() => send(s, eventFor(bindS, { ref: u() }))), "PERMISSION_INACTIVE");
  });
  const permB = { ...bindB, permissionRef: u() };
  await grant(b, permB, permB.permissionRef);
  const rotatedB = await identity("org1", "relayer-r2", "hybrid-b");
  const writeB = (event: BindingEventInput, generation = "0") => send(b, event, generation, rotatedB.client);
  await check("AC-20", "normal revoke: a transaction endorsed before the revoke is invalidated by MVCC", async () => {
    const pre = await rotatedB.client.recordBindingEvent(JSON.stringify(eventFor(permB)), JSON.stringify({ generation: "0" })).endorse();
    await b.operator.apply("PERMISSION_REVOKE", { permissionRef: permB.permissionRef, epoch: "1" }, ["Org1MSP"], "1");
    const outcome = await pre.submit();
    if (outcome.successful || outcome.status !== "MVCC_READ_CONFLICT") throw new Error(`expected MVCC_READ_CONFLICT, got ${outcome.status}`);
    expectChaincode(await failure(() => writeB(eventFor(permB))), "PERMISSION_INACTIVE");
    return outcome.status;
  });
  await check("AC-20", "regrant uses a fresh epoch: the old epoch stays dead", async () => {
    await grant(b, permB, permB.permissionRef, "2", "2");
    expectChaincode(await failure(() => writeB(eventFor(permB, { epoch: "1" }))), "PERMISSION_INACTIVE");
    await writeB(eventFor(permB, { epoch: "2" }));
  });
  await check("AC-20", "emergency revoke needs only one governed MSP and marks the permission for review", async () => {
    const result = await b.operator.apply("PERMISSION_EMERGENCY_REVOKE", { permissionRef: permB.permissionRef, epoch: "2" }, ["Org2MSP"], "3");
    const state = (await b.relayer.getRegistryPermission(permB.permissionRef)) as { status: string; reviewRequired: boolean };
    if (state.status !== "REVOKED" || !state.reviewRequired) throw new Error(JSON.stringify(state));
    expectChaincode(await failure(() => writeB(eventFor(permB, { epoch: "2" }))), "PERMISSION_INACTIVE");
    return `proposal ${result.proposalId.slice(0, 12)}`;
  });

  // ---------------------------------------------------------------- AC-19
  await check("AC-19", "a pre-fence attempt cannot land after the fence; the retry on generation 1 does", async () => {
    const e = eventFor(bindS);
    const stale = await s.relayer.recordBindingEvent(JSON.stringify(e), JSON.stringify({ generation: "0" })).endorse();
    const payload = { chainRef: bindS.tuple.chainRef, bindingDigest: bindS.digest, eventId: e.eventId, dataHash: e.dataHash };
    const fenced = await s.operator.apply("FENCE_DELIVERY", payload, ["Org1MSP"]);
    if ((fenced.result as { outcome?: string })?.outcome !== "FENCED") throw new Error(JSON.stringify(fenced.result));
    const outcome = await stale.submit();
    if (outcome.successful) throw new Error("stale attempt committed after the fence");
    expectChaincode(await failure(() => send(s, e, "0")), "DELIVERY_FENCED");
    await send(s, e, "1");
    const again = await s.operator.apply("FENCE_DELIVERY", payload, ["Org1MSP"], "1");
    if ((again.result as { outcome?: string })?.outcome !== "EVENT_COMMITTED") throw new Error(JSON.stringify(again.result));
    return `stale tx ${outcome.status}`;
  });
  await check("AC-19", "a repeated fence request after a lost response converges on the same proposal", async () => {
    const e = eventFor(bindS);
    const payload = { chainRef: bindS.tuple.chainRef, bindingDigest: bindS.digest, eventId: e.eventId, dataHash: e.dataHash };
    const nonce = u();
    const first = await s.operator.apply("FENCE_DELIVERY", payload, ["Org1MSP"], "0", nonce);
    const second = await s.operator.apply("FENCE_DELIVERY", payload, ["Org1MSP"], "0", nonce);
    if (first.proposalId !== second.proposalId || second.status !== "EXECUTED") throw new Error("not idempotent");
    const fence = (await s.relayer.getDeliveryFence(bindS.tuple.chainRef, e.eventId)) as { generation: string };
    if (fence.generation !== "1") throw new Error(`generation ${fence.generation}`);
  });
  await check("AC-19", "the same event tuple and hash commit with the rotated credential (no changed tuple)", async () => {
    const e = eventFor(bindB);
    const first = await rotatedB.client.recordBindingEvent(JSON.stringify(e), JSON.stringify({ generation: "0" })).endorse();
    const outcome = await first.submit();
    if (!outcome.successful) throw new Error(outcome.status);
    const proof = (await b.relayer.getBindingProof(bindB.tuple.chainRef, e.eventId)) as { dataHash: string; submitterId: string };
    if (proof.dataHash !== e.dataHash) throw new Error("tuple changed");
    // Replay by the retired credential cannot create a second proof.
    const dup = await failure(() => send(b, e, "0", rotatedB.client));
    if (dup.chaincodeCode !== "DUPLICATE_EVENT") throw new Error(`${dup.kind}/${dup.chaincodeCode}`);
  });

  await releaseC(b, s);

  const failed = results.filter((r) => r.status === "FAIL");
  const evidenceDir = path.resolve("blockchain", ".fabric", "evidence");
  mkdirSync(evidenceDir, { recursive: true });
  const file = path.join(evidenceDir, `ledger-acceptance-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), sha: process.env.RELEASE_SHA ?? process.env.GITHUB_SHA,
    runtime: { node: process.version, platform: process.platform }, instance: process.env.AGRI_FABRIC_INSTANCE,
    governanceDigest: process.env.HYBRID_GOVERNANCE_DIGEST, images: JSON.parse(process.env.HYBRID_IMAGE_DIGESTS ?? '{}'),
    passed: results.length - failed.length, failed: failed.length, skipped: 0, results }, null, 2), { mode: 0o600 });
  console.log(`\n${results.length - failed.length}/${results.length} passed. Evidence: ${file}`);
  for (const c of connections) c.close();
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  for (const c of connections) c.close();
  process.exit(2);
});
