import type { Context } from "fabric-contract-api";
import { requireHash, requireUuid } from "./binding";
import { channelGovernance, GOVERNANCE_DIGEST } from "./governance";
import {
  callerCertFingerprint,
  getBinding,
  getCredential,
  getChannelPolicy,
  requireCallerRole,
} from "./registry";
import { fromLedgerBytes, timestampToIso, toLedgerBytes } from "./ledger";
import { contractError } from "./errors";

export async function recordConnectionProbe(
  ctx: Context,
  bindingDigest: string,
  challenge: string,
  organizationRef: string,
) {
  requireCallerRole(ctx, "relayer");
  requireHash(bindingDigest, "bindingDigest");
  requireUuid(challenge, "challenge");
  requireUuid(organizationRef, "organizationRef");
  const binding = await getBinding(ctx, bindingDigest);
  const policy = await getChannelPolicy(ctx);
  const governance = channelGovernance(ctx.stub.getChannelID());
  if (
    !binding ||
    binding.status !== "ACTIVE" ||
    binding.channelId !== ctx.stub.getChannelID() ||
    !policy?.strictB ||
    policy.allowLegacyV3Writes ||
    binding.governanceDigest !== GOVERNANCE_DIGEST
  )
    throw contractError(
      "BINDING_MISMATCH",
      "Probe requires an active strict binding on this channel",
    );
  const credential = await getCredential(
    ctx,
    bindingDigest,
    binding.writerAuthority,
    callerCertFingerprint(ctx),
  );
  if (
    ctx.clientIdentity.getMSPID() !== binding.writerMspId ||
    ctx.clientIdentity.getAttributeValue("app.authority") !==
      binding.writerAuthority ||
    credential?.status !== "ACTIVE"
  )
    throw contractError(
      "UNAUTHORIZED_RELAYER",
      "Probe needs the approved technical writer",
    );
  const key = ctx.stub.createCompositeKey("enterprise.connection", [
    bindingDigest,
    challenge,
  ]);
  if ((await ctx.stub.getState(key)).length)
    throw contractError(
      "DUPLICATE_EVENT",
      "Probe already committed; query its original receipt",
    );
  const proof = {
    protocol: "agritrace-connection/1",
    bindingDigest,
    challenge,
    organizationRef,
    channelId: ctx.stub.getChannelID(),
    ownerMsp: governance.ownerMsp,
    writerMsp: binding.writerMspId,
    governanceDigest: GOVERNANCE_DIGEST,
    txId: ctx.stub.getTxID(),
    recordedAt: timestampToIso(ctx.stub.getTxTimestamp()),
  };
  await ctx.stub.putState(key, toLedgerBytes(proof));
  return proof;
}
export async function readConnectionProbe(
  ctx: Context,
  bindingDigest: string,
  challenge: string,
) {
  requireHash(bindingDigest, "bindingDigest");
  requireUuid(challenge, "challenge");
  return fromLedgerBytes<Record<string, unknown>>(
    await ctx.stub.getState(
      ctx.stub.createCompositeKey("enterprise.connection", [
        bindingDigest,
        challenge,
      ]),
    ),
    "connection probe",
  );
}
