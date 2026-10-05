import { vi } from 'vitest';
import { FabricTraceAdapter } from './fabric-trace.adapter.js';
import type { BlockchainTraceEventInput } from '../../common/ports/blockchain.port.js';

const input: BlockchainTraceEventInput = {
  eventId: 'event',
  entityType: 'LOT',
  entityId: 'lot',
  eventType: 'HARVEST_RECORDED',
  eventTime: '2026-09-26T00:00:00.000Z',
  dataHash: 'a'.repeat(64),
  schemaVersion: '2.0.0',
  canonicalizationVersion: 'RFC8785',
  actorContext: {
    role: 'SYSTEM',
    authProofType: 'SYSTEM_ASSERTION',
    actorAuthProof: 'proof',
  },
};

describe('Fabric implementation of the blockchain port', () => {
  it('forwards the canonical input and receipt without transforming them', async () => {
    const receipt = {
      txId: 'tx',
      dataHash: input.dataHash,
      recordedAt: input.eventTime,
      channelId: 'agritrace',
    };
    const gateway = {
      submitTraceEvent: vi.fn().mockResolvedValue(receipt),
      getProof: vi.fn(),
    };
    const adapter = new FabricTraceAdapter(gateway);
    expect(await adapter.submitTraceEvent(input)).toBe(receipt);
    expect(gateway.submitTraceEvent).toHaveBeenCalledWith(input);
  });

  it('forwards duplicate-event proof lookup and keeps the same receipt', async () => {
    const receipt = { txId: 'original-tx', dataHash: input.dataHash };
    const gateway = {
      submitTraceEvent: vi.fn(),
      getProof: vi.fn().mockResolvedValue(receipt),
    };
    expect(await new FabricTraceAdapter(gateway).getProof('event')).toBe(
      receipt,
    );
    expect(gateway.getProof).toHaveBeenCalledWith('event');
  });

  it('preserves submission error identity for existing retry classification', async () => {
    const error = new Error('DUPLICATE_EVENT: already recorded');
    const gateway = {
      submitTraceEvent: vi.fn().mockRejectedValue(error),
      getProof: vi.fn(),
    };
    await expect(
      new FabricTraceAdapter(gateway).submitTraceEvent(input),
    ).rejects.toBe(error);
  });

  it.each([
    {},
    { txId: 'tx' },
    { txId: 'tx', dataHash: input.dataHash, recordedAt: 'invalid' },
    null,
  ])('leaves malformed receipts to the worker validation', async (receipt) => {
    const gateway = {
      submitTraceEvent: vi.fn().mockResolvedValue(receipt),
      getProof: vi.fn(),
    };
    expect(await new FabricTraceAdapter(gateway).submitTraceEvent(input)).toBe(
      receipt,
    );
  });
});
