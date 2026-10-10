import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { BlockchainWorkerService } from '../../apps/api/dist/modules/blockchain-adapter/blockchain-worker.service.js';
import { calculateTraceEventHash } from '../../apps/api/dist/modules/trace/trace-hash.js';
import { parseTraceEventInput } from '../../blockchain/chaincode/dist/validation.js';

test('the production Worker submits an event accepted by the actual chaincode validator', async () => {
  const event = {
    id: randomUUID(), entityType: 'PRODUCTION_CYCLE', entityId: randomUUID(),
    eventType: 'PRODUCTION_CYCLE_CREATED', eventTime: new Date(),
    dataHash: 'a'.repeat(64), previousEventHash: null,
    schemaVersion: '2.0.0', canonicalizationVersion: 'RFC8785',
    actorUserId: randomUUID(), actorOrganizationId: randomUUID(), actorRole: 'FARM_STAFF',
    authProofType: 'TOKEN_FINGERPRINT', actorAuthProof: 'b'.repeat(64),
    businessData: { note: 'PRIVATE BUSINESS DATA MUST STAY OFF CHAIN' },
  };
  event.cycleId = event.entityId;
  event.lotId = null;
  event.dataHash = calculateTraceEventHash(event);
  const job = { id: randomUUID(), eventId: event.id, traceEvent: event, attemptCount: 1, leaseToken: randomUUID() };
  let confirmed = false;
  let submitted;
  const tx = {
    $queryRaw: async () => [{ id: job.id }],
    blockchainOutbox: { updateMany: async () => ({ count: 1 }), findMany: async () => [job] },
    blockchainProof: { upsert: async () => { confirmed = true; } },
  };
  const db = { $transaction: async callback => callback(tx), blockchainOutbox: tx.blockchainOutbox };
  const config = { get: (_name, fallback) => fallback };
  const fabric = { getAdapter: async () => ({
    healthCheck: async () => ({ status: 'OK', envelopeVersion: '3.0.0' }),
    submitTraceEvent: async input => {
      submitted = input;
      parseTraceEventInput(JSON.stringify(input));
      return { ...input, txId: 'c'.repeat(64), recordedAt: new Date().toISOString(), channelId: 'agritrace' };
    },
    getProof: async () => ({ ...submitted, txId: 'c'.repeat(64), recordedAt: new Date().toISOString(), channelId: 'agritrace' }),
  }) };
  await new BlockchainWorkerService(db, config, fabric).processPending();
  assert.ok(submitted, 'Worker must submit the claimed event');
  assert.equal(confirmed, true, 'Chaincode must accept the Worker input before it can be confirmed');
  assert.equal(JSON.stringify(submitted).includes(event.businessData.note), false, 'Private business data must stay off chain');
});
