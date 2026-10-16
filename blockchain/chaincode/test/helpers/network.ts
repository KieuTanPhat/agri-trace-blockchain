import type { Context } from "fabric-contract-api";

import { B_ENVELOPE_VERSION, bindingDigest, sha256, type BindingTuple } from "../../src/binding";
import { GOVERNANCE_DIGEST } from "../../src/governance";
import { AgriTraceContract } from "../../src/traceability-contract";
import { FakeClientIdentity, FakeStub } from "./fake-context";

export const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const AUTHORITY = "technical-relayer:agritrace-b";
export const RELAYER_CERT = "relayer-cert-1";
export const RELAYER_FP = sha256(Buffer.from(RELAYER_CERT));

export type Who = "controller" | "admin1" | "admin2" | "admin3" | "relayer" | "rogue";
const IDENTITIES: Record<Who, { role: string; msp: string; authority?: string; cert?: string }> = {
  controller: { role: "controller", msp: "Org1MSP" },
  admin1: { role: "admin", msp: "Org1MSP" },
  admin2: { role: "admin", msp: "Org2MSP" },
  admin3: { role: "admin", msp: "Org3MSP" },
  relayer: { role: "relayer", msp: "Org1MSP", authority: AUTHORITY, cert: RELAYER_CERT },
  rogue: { role: "relayer", msp: "Org1MSP", authority: AUTHORITY, cert: "rogue-cert" },
};

export class Network {
  public readonly stub = new FakeStub();
  public readonly contract = new AgriTraceContract();
  private tx = 0;
  public constructor(channelId = "hybrid-b") {
    this.stub.channelId = channelId;
  }
  public ctx(who: Who): Context {
    const identity = new FakeClientIdentity().as(IDENTITIES[who]);
    this.tx += 1;
    this.stub.txId = `tx-${String(this.tx).padStart(6, "0")}`;
    this.stub.timestamp = { seconds: 1_788_710_400 + this.tx, nanos: 0 };
    return { stub: this.stub, clientIdentity: identity } as unknown as Context;
  }
  public async propose(kind: string, payload: object, expectedRevision = "0", nonce = u(900 + this.tx)) {
    const proposal = JSON.parse(
      await this.contract.ProposeRegistryChange(
        this.ctx("controller"),
        JSON.stringify({ kind, payload, expectedRevision, nonce }),
      ),
    );
    return proposal.proposalId as string;
  }
  public approve(id: string, who: Who) {
    return this.contract.ApproveRegistryChange(this.ctx(who), id);
  }
  public execute(id: string, who: Who = "controller") {
    return this.contract.ExecuteRegistryChange(this.ctx(who), id);
  }
  /** Propose, approve with every named admin, execute. */
  public async change(
    kind: string,
    payload: object,
    approvers: Who[],
    expectedRevision = "0",
  ) {
    const id = await this.propose(kind, payload, expectedRevision);
    for (const who of approvers) await this.approve(id, who);
    return JSON.parse(await this.execute(id));
  }
}

export const binding: BindingTuple = {
  network: "isolated-hybrid-b",
  channelId: "hybrid-b",
  chaincodeName: "agritrace",
  contractName: "AgriTraceContract",
  chainRef: u(3),
  envelopeVersion: B_ENVELOPE_VERSION,
  writerAuthority: AUTHORITY,
  writerMspId: "Org1MSP",
  writerRole: "relayer",
  governanceDigest: GOVERNANCE_DIGEST,
};
export const DIGEST = bindingDigest(binding);
export const ALL_ENTITIES = ["CARE", "PRODUCTION_CYCLE"];

export async function readyNetwork() {
  const net = new Network();
  await net.change(
    "CHANNEL_BOOTSTRAP",
    { channelId: "hybrid-b", strictB: true, allowLegacyV3Writes: false },
    ["admin1", "admin2"],
  );
  await net.change("BINDING_REGISTER", { binding, bindingDigest: DIGEST }, ["admin1", "admin2"]);
  await net.change(
    "CREDENTIAL_APPROVE",
    { bindingDigest: DIGEST, authority: AUTHORITY, certFingerprint: RELAYER_FP },
    ["admin1", "admin2"],
  );
  await net.change(
    "PERMISSION_GRANT",
    { permissionRef: u(4), bindingDigest: DIGEST, epoch: "1", entityTypes: ALL_ENTITIES },
    ["admin1"],
  );
  return net;
}
