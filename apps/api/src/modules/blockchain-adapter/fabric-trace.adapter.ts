import type { FabricBlockchainAdapter } from '@agri-trace/fabric-gateway';
import type {
  BlockchainAdapter,
  BlockchainReceipt,
  BlockchainTraceEventInput,
} from '../../common/ports/blockchain.port.js';

/** The gateway's untyped JSON result crosses the application boundary here. */
export class FabricTraceAdapter implements BlockchainAdapter {
  constructor(
    private readonly gateway: Pick<
      FabricBlockchainAdapter,
      'submitTraceEvent' | 'getProof'
    >,
  ) {}

  async submitTraceEvent(
    input: BlockchainTraceEventInput,
  ): Promise<BlockchainReceipt> {
    return (await this.gateway.submitTraceEvent(input)) as BlockchainReceipt;
  }

  async getProof(eventId: string): Promise<BlockchainReceipt> {
    return (await this.gateway.getProof(eventId)) as BlockchainReceipt;
  }
}
