import {
  RegistryOperator,
  classifyFabricError,
  type BindingLedgerClient,
  type RegistryProposalView,
} from '@agri-trace/fabric-gateway';

export class AwaitingOwnerApproval extends Error {
  constructor(public readonly review: Record<string, unknown>) {
    super('AWAITING_OWNER_APPROVAL');
  }
}

/** Platform owns only its admin. The enterprise submits its own approval from
 * its VPS, then the same deterministic onboarding command resumes this proposal. */
export class ExternalOwnerRegistryOperator extends RegistryOperator {
  constructor(
    private readonly reader: BindingLedgerClient,
    private readonly localAdmins: Readonly<Record<string, BindingLedgerClient>>,
    private readonly context: {
      channelId: string;
      chaincodeName: string;
      contractName: string;
      governanceDigest: string;
    },
  ) {
    super(reader, localAdmins);
  }

  override async apply(
    ...args: Parameters<RegistryOperator['apply']>
  ): Promise<RegistryProposalView> {
    const [kind, payload, approvers, revision, nonce] = args;
    const id = await this.propose(kind, payload, revision, nonce);
    const existing = (await this.reader.getRegistryProposal(
      id,
    )) as RegistryProposalView;
    if (existing.status === 'EXECUTED') return existing;
    for (const msp of approvers)
      if (this.localAdmins[msp]) await this.approve(id, msp);
    try {
      return await this.execute(id);
    } catch (error) {
      if (classifyFabricError(error).chaincodeCode !== 'APPROVALS_MISSING') throw error;
      throw new AwaitingOwnerApproval({
        ...this.context,
        proposal: await this.reader.getRegistryProposal(id),
      });
    }
  }
}
