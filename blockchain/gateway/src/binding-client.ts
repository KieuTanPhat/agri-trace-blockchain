import {
  CommitError,
  CommitStatusError,
  EndorseError,
  GatewayError,
  type Contract,
  type Network,
  type Proposal,
  type Transaction,
} from "@hyperledger/fabric-gateway";

const decoder = new TextDecoder();

export interface BindingChannelConfig {
  channelName: string;
  chaincodeName: string;
  contractName: string;
}

export type FabricFailureKind =
  | "CHAINCODE" // rejected by chaincode logic during endorsement
  | "ENDORSEMENT" // could not gather endorsements (peer down, policy unsatisfiable)
  | "SUBMIT" // orderer refused or was unreachable
  | "COMMIT_STATUS" // outcome unknown: the transaction may still commit
  | "COMMIT_INVALID" // committed as invalid (e.g. MVCC / endorsement policy)
  | "UNKNOWN";

export interface FabricFailure {
  kind: FabricFailureKind;
  /** Chaincode error code (e.g. PERMISSION_INACTIVE) when the contract rejected the call. */
  chaincodeCode?: string;
  /** Validation code name for COMMIT_INVALID (e.g. MVCC_READ_CONFLICT). */
  validationCode?: string;
  message: string;
  /** True when the transaction may still be committed and must be reconciled by txId. */
  unknownOutcome: boolean;
}

const CHAINCODE_CODE = /\b([A-Z][A-Z_]{3,}):/;

/** Normalizes SDK errors so the Worker can decide: retry, hold or reconcile.
 * A transport failure after broadcast is never "absent": it is unknown. */
export function classifyFabricError(error: unknown): FabricFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof CommitError)
    return {
      kind: "COMMIT_INVALID",
      validationCode: validationCodeName(error.code),
      message,
      unknownOutcome: false,
    };
  if (error instanceof CommitStatusError)
    return { kind: "COMMIT_STATUS", message, unknownOutcome: true };
  if (error instanceof GatewayError && error.constructor.name === "SubmitError")
    return { kind: "SUBMIT", message, unknownOutcome: true };
  if (error instanceof EndorseError) {
    const detail = (error.details ?? []).map((item) => item.message).join(" ");
    const code = CHAINCODE_CODE.exec(`${detail} ${message}`)?.[1];
    const logic = /transaction returned with failure|chaincode response|Error:/i.test(
      `${detail} ${message}`,
    );
    return code && logic
      ? { kind: "CHAINCODE", chaincodeCode: code, message: detail || message, unknownOutcome: false }
      : { kind: "ENDORSEMENT", message: detail || message, unknownOutcome: false };
  }
  if (error instanceof GatewayError)
    return { kind: "UNKNOWN", message, unknownOutcome: true };
  return { kind: "UNKNOWN", message, unknownOutcome: true };
}

const VALIDATION_CODES: Record<number, string> = {
  0: "VALID",
  1: "NIL_ENVELOPE",
  2: "BAD_PAYLOAD",
  3: "BAD_COMMON_HEADER",
  4: "BAD_CREATOR_SIGNATURE",
  5: "INVALID_ENDORSER_TRANSACTION",
  6: "INVALID_CONFIG_TRANSACTION",
  7: "UNSUPPORTED_TX_PAYLOAD",
  8: "BAD_PROPOSAL_TXID",
  9: "DUPLICATE_TXID",
  10: "ENDORSEMENT_POLICY_FAILURE",
  11: "MVCC_READ_CONFLICT",
  12: "PHANTOM_READ_CONFLICT",
  13: "UNKNOWN_TX_TYPE",
  14: "TARGET_CHAIN_NOT_FOUND",
  15: "MARSHAL_TX_ERROR",
  16: "NIL_TXACTION",
  17: "EXPIRED_CHAINCODE",
  18: "CHAINCODE_VERSION_CONFLICT",
  19: "BAD_HEADER_EXTENSION",
  20: "BAD_CHANNEL_HEADER",
  21: "BAD_RESPONSE_PAYLOAD",
  22: "BAD_RWSET",
  23: "ILLEGAL_WRITESET",
  24: "INVALID_WRITESET",
  25: "INVALID_CHAINCODE",
  254: "NOT_VALIDATED",
  255: "INVALID_OTHER_REASON",
};

export function validationCodeName(code: number): string {
  return VALIDATION_CODES[code] ?? `CODE_${code}`;
}

export interface CommitOutcome {
  transactionId: string;
  successful: boolean;
  blockNumber: bigint;
  /** Fabric validation code (0 = VALID). */
  code: number;
  status: string;
}

export class EndorsedTransaction {
  public constructor(private readonly transaction: Transaction) {}
  public get transactionId(): string {
    return this.transaction.getTransactionId();
  }
  public get result(): Uint8Array {
    return this.transaction.getResult();
  }
  public get bytes(): Uint8Array {
    return this.transaction.getBytes();
  }
  /** Submits to the orderer and waits for the commit status. */
  public async submit(): Promise<CommitOutcome> {
    const commit = await this.transaction.submit();
    const status = await commit.getStatus();
    return {
      transactionId: status.transactionId,
      successful: status.successful,
      blockNumber: status.blockNumber,
      code: status.code,
      status: validationCodeName(status.code),
    };
  }
}

/** A proposal with a known transaction id and no network traffic yet, so the
 * Worker can persist the attempt before the first byte leaves the process. */
export class PreparedTransaction {
  public constructor(private readonly proposal: Proposal) {}
  public get transactionId(): string {
    return this.proposal.getTransactionId();
  }
  public async endorse(): Promise<EndorsedTransaction> {
    return new EndorsedTransaction(await this.proposal.endorse());
  }
}

/** Client for the strict-B contract on one channel with one identity. */
export class BindingLedgerClient {
  private readonly network: Network;
  private readonly contract: Contract;

  public constructor(
    gateway: { getNetwork(channelName: string): Network },
    config: BindingChannelConfig,
  ) {
    this.network = gateway.getNetwork(config.channelName);
    this.contract = this.network.getContract(config.chaincodeName, config.contractName);
  }

  public prepare(
    name: string,
    args: string[],
    options: { endorsingOrganizations?: string[] } = {},
  ): PreparedTransaction {
    return new PreparedTransaction(
      this.contract.newProposal(name, {
        arguments: args,
        ...(options.endorsingOrganizations
          ? { endorsingOrganizations: options.endorsingOrganizations }
          : {}),
      }),
    );
  }

  /** Prepare, endorse, submit and wait; throws the SDK error on failure. */
  public async invoke(name: string, args: string[]): Promise<unknown> {
    const endorsed = await this.prepare(name, args).endorse();
    const outcome = await endorsed.submit();
    if (!outcome.successful)
      throw new Error(`Transaction ${outcome.transactionId} committed as ${outcome.status}`);
    return parse(endorsed.result);
  }

  public async query(name: string, ...args: string[]): Promise<unknown> {
    return parse(await this.contract.evaluateTransaction(name, ...args));
  }

  public recordBindingEvent(eventJson: string, deliveryJson: string, endorsingOrganizations?: string[]) {
    return this.prepare("RecordBindingEvent", [eventJson, deliveryJson], { endorsingOrganizations });
  }

  /** Release C: the signature assertion travels beside, not inside, the
   * committed event; the chaincode recomputes its digest from dataHash. */
  public recordSignedBindingEvent(
    eventJson: string,
    assertionJson: string,
    deliveryJson: string,
    endorsingOrganizations?: string[],
  ) {
    return this.prepare("RecordSignedBindingEvent", [eventJson, assertionJson, deliveryJson], {
      endorsingOrganizations,
    });
  }

  public getRegistrySigningKey(bindingDigest: string, keyRef: string) {
    return this.query("GetRegistrySigningKey", bindingDigest, keyRef);
  }

  public health() {
    return this.query("HealthCheck");
  }
  public getBindingProof(chainRef: string, eventId: string) {
    return this.query("GetBindingProof", chainRef, eventId);
  }
  public queryBindingEvent(chainRef: string, eventId: string) {
    return this.query("QueryBindingEvent", chainRef, eventId);
  }
  public getBindingHead(chainRef: string, entityType: string, entityId: string) {
    return this.query("GetBindingHead", chainRef, entityType, entityId);
  }
  public queryBindingHistoryPage(chainRef: string, entityType: string, entityId: string, pageSize = 100, bookmark = "") {
    return this.query("QueryBindingHistoryPage", chainRef, entityType, entityId, String(pageSize), bookmark);
  }
  public getRegistryBinding(digest: string) {
    return this.query("GetRegistryBinding", digest);
  }
  public getRegistryPermission(permissionRef: string) {
    return this.query("GetRegistryPermission", permissionRef);
  }
  public getRegistryProposal(proposalId: string) {
    return this.query("GetRegistryProposal", proposalId);
  }
  public getDeliveryFence(chainRef: string, eventId: string) {
    return this.query("GetDeliveryFence", chainRef, eventId);
  }

  /** Committed validation outcome of a past transaction through qscc. Used to
   * reconcile unknown attempts: an absent transaction on one peer is not proof
   * that it never committed (callers must still consult the event state). */
  public async transactionValidationCode(txId: string): Promise<number | null> {
    const qscc = this.network.getContract("qscc");
    try {
      const bytes = await qscc.evaluateTransaction("GetTransactionByID", this.network.getName(), txId);
      return validationCodeOf(bytes);
    } catch (error) {
      if (/not found|NOT_FOUND|no such transaction/i.test(String(error))) return null;
      throw error;
    }
  }
}

/** ProcessedTransaction protobuf: field 1 is the transaction envelope and
 * field 2 (varint) the validation code. proto3 omits a VALID (0) code, so 0 is
 * returned only for a well-formed message that carries its envelope; empty,
 * truncated or malformed bytes throw instead of reading as VALID. */
export function validationCodeOf(processedTransaction: Uint8Array): number {
  const bytes = processedTransaction;
  let offset = 0;
  const malformed = () => new Error("Malformed ProcessedTransaction from qscc");
  const read = () => {
    let value = 0;
    for (let shift = 0; shift < 64; shift += 7) {
      if (offset >= bytes.length) throw malformed();
      const byte = bytes[offset++]!;
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) {
        if (!Number.isSafeInteger(value)) throw malformed();
        return value;
      }
    }
    throw malformed();
  };
  const skip = (length: number) => {
    if (length > bytes.length - offset) throw malformed();
    offset += length;
  };
  let envelope = false;
  let code: number | undefined;
  while (offset < bytes.length) {
    const tag = read();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (![0, 1, 2, 5].includes(wire))
      throw new Error("Unsupported protobuf wire type");
    if (field === 0) throw malformed();
    if (field === 2 && wire !== 0) throw malformed();
    if (field === 1 && wire !== 2) throw malformed();
    if (wire === 0) {
      const value = read();
      if (field === 2) code = value;
    } else if (wire === 2) {
      skip(read());
      if (field === 1) envelope = true;
    } else if (wire === 1) skip(8);
    else skip(4);
  }
  if (!envelope) throw malformed();
  return code ?? 0;
}

function parse(bytes: Uint8Array): unknown {
  const text = decoder.decode(bytes);
  return text.length === 0 ? null : JSON.parse(text);
}
