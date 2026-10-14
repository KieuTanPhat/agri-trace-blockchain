// Read-only: proves every stored trace event is still accepted by the compiled chaincode input validator.
// Runs inside the production API image of a disposable CI project; it never submits or creates proofs.
import { pathToFileURL } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/dist/generated/prisma/client.js';
import { privateTraceEvidenceMatches } from '../../apps/api/dist/modules/trace/trace-evidence.js';
import { harvestSensorTraceEvidenceMatches } from '../../apps/api/dist/modules/iot/harvest-sensor-evidence.js';

export async function inspectEvents(database, validate) {
  return database.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const failures = [];
    let checked = 0;
    let cursor;
    while (true) {
      const events = await tx.traceEvent.findMany({ take: 100, orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (events.length === 0) break;
      for (const event of events) {
        const reasons = [];
        if (!privateTraceEvidenceMatches(event)) reasons.push('PRIVATE_EVIDENCE_MISMATCH');
        if (event.schemaVersion !== '2.0.0' || event.canonicalizationVersion !== 'RFC8785') reasons.push('UNSUPPORTED_CONTRACT_VERSION');
        if (!(await harvestSensorTraceEvidenceMatches(tx, event))) reasons.push('SENSOR_EVIDENCE_MISMATCH');
        try {
          validate(JSON.stringify({
            eventId: event.id, nonce: event.id, envelopeVersion: '3.0.0', entityType: event.entityType, entityId: event.entityId,
            cycleId: event.cycleId ?? undefined, lotId: event.lotId ?? undefined,
            eventType: event.eventType, eventTime: event.eventTime.toISOString(),
            dataHash: event.dataHash, previousEventHash: event.previousEventHash ?? undefined,
            schemaVersion: event.schemaVersion, canonicalizationVersion: event.canonicalizationVersion,
          }));
        } catch { reasons.push('CHAINCODE_INPUT_REJECTED'); }
        if (reasons.length) failures.push({ eventId: event.id, eventType: event.eventType, reasons });
        checked++;
      }
      cursor = events.at(-1).id;
    }
    return { result: failures.length ? 'failed' : 'passed', checked, failures, writes: 0, ledgerChecked: false };
  }, { isolationLevel: 'RepeatableRead', timeout: 30_000 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let database;
  try {
    if (process.env.CI_REHEARSAL !== '1' || !process.env.DATABASE_URL || !process.env.CI_VALIDATOR_PATH) throw new Error('Rehearsal read-check configuration is incomplete');
    const { parseTraceEventInput } = await import(pathToFileURL(process.env.CI_VALIDATOR_PATH).href);
    if (typeof parseTraceEventInput !== 'function') throw new Error('Compiled chaincode validator is unavailable');
    database = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    const result = await inspectEvents(database, parseTraceEventInput);
    console.log(JSON.stringify(result));
    if (result.result !== 'passed' || result.checked === 0) process.exitCode = 1;
  } catch { console.error('Event check failed; private payloads and connection diagnostics withheld'); process.exitCode = 1; }
  finally { await database?.$disconnect(); }
}
