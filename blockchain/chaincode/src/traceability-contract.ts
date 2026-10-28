import {
  Context,
  Contract,
  Info,
  Returns,
  Transaction,
} from "fabric-contract-api";

import {
  readBindingEvent,
  readBindingHead,
  readBindingHistoryPage,
  readBindingProof,
  recordBindingEvent,
  recordSignedBindingEvent,
} from "./binding-events";
import { contractError } from "./errors";
import { GOVERNANCE_DIGEST } from "./governance";
import {
  approveChange,
  callerRole,
  executeChange,
  getBinding,
  getChannelPolicy,
  getCredential,
  getFence,
  getPermission,
  getProposal,
  getSigningKey,
  proposeChange,
} from "./registry";
import { SIGNING_PROTOCOL } from "./signing";
import { recordConnectionProbe, readConnectionProbe } from './connection-probes';
import { requireEntityType, requireHash, requireName, requireUuid } from "./binding";
import { toLedgerBytes } from "./ledger";
import type { HealthResult } from "./types";

@Info({
  title: "AgriTraceContract",
  description: "Binding-scoped agricultural trace commitments and proof registry",
})
export class AgriTraceContract extends Contract {
  public constructor() {
    super("AgriTraceContract");
  }

  @Transaction()
  @Returns("string")
  public async RecordBindingEvent(
    ctx: Context,
    eventJson: string,
    deliveryJson: string,
  ): Promise<string> {
    return this.stringify((await recordBindingEvent(ctx, eventJson, deliveryJson)).receipt);
  }

  @Transaction()
  @Returns("string")
  public async RecordSignedBindingEvent(
    ctx: Context,
    eventJson: string,
    assertionJson: string,
    deliveryJson: string,
  ): Promise<string> {
    return this.stringify(
      (await recordSignedBindingEvent(ctx, eventJson, assertionJson, deliveryJson)).receipt,
    );
  }

  @Transaction(false)
  @Returns("string")
  public async GetRegistrySigningKey(ctx: Context, bindingDigest: string, keyRef: string): Promise<string> {
    const key = await getSigningKey(ctx, requireHash(bindingDigest, "bindingDigest"), requireUuid(keyRef, "keyRef"));
    if (!key) throw contractError("NOT_FOUND", "signing key is not registered");
    return this.stringify(key);
  }

  @Transaction()
  @Returns("string")
  public async ProposeRegistryChange(ctx: Context, requestJson: string): Promise<string> {
    return this.stringify(await proposeChange(ctx, requestJson));
  }

  @Transaction()
  @Returns("string")
  public async ApproveRegistryChange(ctx: Context, proposalId: string): Promise<string> {
    return this.stringify(await approveChange(ctx, proposalId));
  }

  @Transaction()
  @Returns("string")
  public async ExecuteRegistryChange(ctx: Context, proposalId: string): Promise<string> {
    return this.stringify(await executeChange(ctx, proposalId));
  }

  @Transaction(false)
  @Returns("string")
  public async GetBindingProof(ctx: Context, chainRef: string, eventId: string): Promise<string> {
    return this.stringify(await readBindingProof(ctx, chainRef, eventId));
  }

  @Transaction(false)
  @Returns("string")
  public async QueryBindingEvent(ctx: Context, chainRef: string, eventId: string): Promise<string> {
    return this.stringify(await readBindingEvent(ctx, chainRef, eventId));
  }

  @Transaction(false)
  @Returns("string")
  public async GetBindingHead(
    ctx: Context,
    chainRef: string,
    entityType: string,
    entityId: string,
  ): Promise<string> {
    return this.stringify(
      await readBindingHead(ctx, chainRef, requireEntityType(entityType), entityId),
    );
  }

  @Transaction(false)
  @Returns("string")
  public async QueryBindingHistoryPage(
    ctx: Context,
    chainRef: string,
    entityType: string,
    entityId: string,
    pageSize: string,
    bookmark: string,
  ): Promise<string> {
    const size = Number(pageSize);
    if (!Number.isInteger(size) || size < 1 || size > 500)
      throw contractError("INVALID_INPUT", "pageSize must be an integer between 1 and 500");
    return this.stringify(
      await readBindingHistoryPage(ctx, chainRef, requireEntityType(entityType), entityId, size, bookmark),
    );
  }

  @Transaction(false)
  @Returns("string")
  public async GetRegistryBinding(ctx: Context, bindingDigest: string): Promise<string> {
    const found = await getBinding(ctx, requireHash(bindingDigest, "bindingDigest"));
    if (!found) throw contractError("NOT_FOUND", "binding is not registered");
    return this.stringify(found);
  }

  @Transaction(false)
  @Returns("string")
  public async GetRegistryPermission(ctx: Context, permissionRef: string): Promise<string> {
    const found = await getPermission(ctx, requireUuid(permissionRef, "permissionRef"));
    if (!found) throw contractError("NOT_FOUND", "permission is not registered");
    return this.stringify(found);
  }

  @Transaction(false)
  @Returns("string")
  public async GetRegistryCredential(
    ctx: Context,
    bindingDigest: string,
    authority: string,
    certFingerprint: string,
  ): Promise<string> {
    const found = await getCredential(
      ctx,
      requireHash(bindingDigest, "bindingDigest"),
      requireName(authority, "authority"),
      requireHash(certFingerprint, "certFingerprint"),
    );
    if (!found) throw contractError("NOT_FOUND", "credential is not registered");
    return this.stringify(found);
  }

  @Transaction(false)
  @Returns("string")
  public async GetRegistryProposal(ctx: Context, proposalId: string): Promise<string> {
    const found = await getProposal(ctx, requireHash(proposalId, "proposalId"));
    if (!found) throw contractError("NOT_FOUND", "proposal does not exist");
    return this.stringify(found);
  }

  @Transaction(false)
  @Returns("string")
  public async GetDeliveryFence(ctx: Context, chainRef: string, eventId: string): Promise<string> {
    return this.stringify(
      (await getFence(ctx, requireUuid(chainRef, "chainRef"), requireUuid(eventId, "eventId"))) ?? {
        generation: "0",
      },
    );
  }

  @Transaction(false)
  @Returns("string")
  public async HealthCheck(ctx: Context): Promise<string> {
    const result: HealthResult = {
      status: "OK",
      contract: "AgriTraceContract",
      supportedWriteVersions: ["4.0.0", "6.0.0"],
      signingProtocol: SIGNING_PROTOCOL,
      registryProtocol: "agritrace-governance/1",
      governanceDigest: GOVERNANCE_DIGEST,
      channelPolicy: await getChannelPolicy(ctx),
      callerRole: callerRole(ctx),
    };
    return this.stringify(result);
  }

  @Transaction()
  @Returns('string')
  public async RecordConnectionProbe(ctx:Context,bindingDigest:string,challenge:string,organizationRef:string):Promise<string> {
    return this.stringify(await recordConnectionProbe(ctx,bindingDigest,challenge,organizationRef));
  }

  @Transaction(false)
  @Returns('string')
  public async GetConnectionProbe(ctx:Context,bindingDigest:string,challenge:string):Promise<string> {
    return this.stringify(await readConnectionProbe(ctx,bindingDigest,challenge));
  }

  private stringify(value: unknown): string {
    return toLedgerBytes(value).toString("utf8");
  }
}
