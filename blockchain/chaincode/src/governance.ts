import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";

import { contractError } from "./errors";
import descriptor from "./governance.json";

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

export interface ApprovalRule {
  mode: "ALL" | "ANY";
  msps: string[];
}
export interface ChannelGovernance {
  writerMsp: string;
  ownerMsp: string;
  approvals: Record<RegistryKind, ApprovalRule>;
}

/** The descriptor ships inside the reviewed chaincode package, so the trust
 * anchor (which MSP admins must approve which change) cannot be altered from
 * HTTP, the database or the environment. */
export const GOVERNANCE_DIGEST = createHash("sha256")
  .update(canonicalize(descriptor), "utf8")
  .digest("hex");

export function channelGovernance(channelId: string): ChannelGovernance {
  const channels = descriptor.channels as Record<string, unknown>;
  const found = channels[channelId];
  if (!found)
    throw contractError(
      "GOVERNANCE_UNDEFINED",
      `channel ${channelId} has no governance descriptor`,
    );
  return found as ChannelGovernance;
}

export function approvalSatisfied(
  rule: ApprovalRule,
  approvedMsps: ReadonlySet<string>,
): boolean {
  return rule.mode === "ALL"
    ? rule.msps.every((msp) => approvedMsps.has(msp))
    : rule.msps.some((msp) => approvedMsps.has(msp));
}
