import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { classifyFabricError, type BindingLedgerClient } from "./binding-client.js";

export const REGISTRY_KINDS = [
  "CHANNEL_BOOTSTRAP",
  "BINDING_REGISTER",
  "CREDENTIAL_APPROVE",
  "CREDENTIAL_REVOKE",
  "PERMISSION_GRANT",
  "PERMISSION_REVOKE",
  "PERMISSION_EMERGENCY_REVOKE",
  "FENCE_DELIVERY",
  "SIGNING_KEY_REGISTER",
  "SIGNING_KEY_REVOKE",
] as const;
export type RegistryKind = (typeof REGISTRY_KINDS)[number];

export interface RegistryProposalView {
  proposalId: string;
  kind: RegistryKind;
  status: "OPEN" | "EXECUTED";
  result?: Record<string, unknown>;
  executedTxId?: string;
}

/** SHA-256 of the DER body of a PEM certificate: the credential identity the
 * chaincode derives from the invoking identity. */
export function certificateFingerprint(pem: string | Uint8Array): string {
  const text = typeof pem === "string" ? pem : Buffer.from(pem).toString("utf8");
  const body = text
    .replace(/-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----/, "")
    .replace(/\s+/g, "");
  return createHash("sha256").update(Buffer.from(body, "base64")).digest("hex");
}

/** Drives the governed registry. The controller proposes and executes; the
 * admins of each governed MSP approve with their own identity, so no single
 * client can complete a change that the descriptor assigns to several MSPs. */
export class RegistryOperator {
  public constructor(
    private readonly controller: BindingLedgerClient,
    private readonly admins: Readonly<Record<string, BindingLedgerClient>>,
  ) {}

  public async propose(
    kind: RegistryKind,
    payload: Record<string, unknown>,
    expectedRevision = "0",
    nonce: string = randomUUID(),
  ): Promise<string> {
    const proposal = (await this.controller.invoke(
      "ProposeRegistryChange",
      [JSON.stringify({ kind, payload, expectedRevision, nonce })],
    )) as RegistryProposalView;
    return proposal.proposalId;
  }

  public async approve(proposalId: string, mspId: string): Promise<void> {
    const admin = this.admins[mspId];
    if (!admin) throw new Error(`No admin client configured for ${mspId}`);
    await admin.invoke("ApproveRegistryChange", [proposalId]);
  }

  public async execute(proposalId: string): Promise<RegistryProposalView> {
    return (await this.controller.invoke("ExecuteRegistryChange", [proposalId])) as RegistryProposalView;
  }

  /** Propose, collect the named approvals, execute. Pass a fixed nonce to make
   * retries after an unknown outcome converge on the same proposal. */
  public async apply(
    kind: RegistryKind,
    payload: Record<string, unknown>,
    approvers: string[],
    expectedRevision = "0",
    nonce: string = randomUUID(),
  ): Promise<RegistryProposalView> {
    let proposalId: string | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        proposalId = await this.propose(kind, payload, expectedRevision, nonce);
        // A concurrent Worker may have finished the same stable proposal.
        const existing = (await this.controller.getRegistryProposal(proposalId)) as RegistryProposalView;
        if (existing.status === "EXECUTED") return existing;
        for (const msp of approvers) await this.approve(proposalId, msp);
        return await this.execute(proposalId);
      } catch (error) {
        const failure = classifyFabricError(error);
        if (proposalId && failure.kind === "CHAINCODE" && failure.chaincodeCode === "PROPOSAL_NOT_OPEN") {
          // The winner can execute between our OPEN read and approval/execute.
          // Only positive ledger evidence for this exact proposal is success.
          const confirmed = await this.controller.getRegistryProposal(proposalId) as RegistryProposalView;
          if (confirmed.proposalId === proposalId && confirmed.kind === kind && confirmed.status === "EXECUTED") return confirmed;
          throw error;
        }
        // These validation codes confirm this transaction made no ledger
        // writes. Resume the identical governed proposal, never a new nonce.
        // Unknown commit outcomes and policy/authorization errors still stop.
        if (attempt >= 2 || failure.kind !== "COMMIT_INVALID" ||
            !["MVCC_READ_CONFLICT", "PHANTOM_READ_CONFLICT"].includes(failure.validationCode ?? "")) throw error;
        await delay(250 * (attempt + 1));
      }
    }
  }
}
