// Read-only: proves every stored trace event is a binding (B) or signed (C)
// commitment that the compiled chaincode accepts and recomputes to its dataHash.
// Runs inside the production API image of a disposable CI project; it never submits or creates proofs.
import { pathToFileURL } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/dist/generated/prisma/client.js';
import { privateTraceEvidenceMatches } from '../../apps/api/dist/modules/trace/trace-evidence.js';
import { harvestSensorTraceEvidenceMatches } from '../../apps/api/dist/modules/iot/harvest-sensor-evidence.js';
import { unsignedBindingBody } from '../../apps/api/dist/modules/trace/binding-commitment.js';
import { C_ENVELOPE_VERSION, C_SCHEMA_VERSION, signedMetadataDigest } from '../../apps/api/dist/modules/trace/signed-commitment.js';
import { EVENT_BINDING_CONTEXT_INCLUDE } from '../../apps/api/dist/modules/trace/ledger-route.js';

/** Public envelope the Worker delivers for one stored event. */
function publicEnvelope(event) {
  const context = event.bindingContext;
  const tuple = {
    eventId: event.id, entityType: event.entityType, entityId: event.entityId,
    cycleId: event.cycleId, lotId: event.lotId, eventType: event.eventType, eventTime: event.eventTime,
    previousEventHash: event.previousEventHash, bindingDigest: context.bindingDigest, chainRef: context.binding.chainRef,
    permissions: context.permissions.map(item => ({ permissionRef: item.permissionRef, epoch: String(item.epoch), ordinal: String(item.ordinal) })),
  };
  if (context.commitmentVersion !== 'c2')
    return { signed: false, body: { ...unsignedBindingBody(tuple, context.privateBodyDigest), dataHash: event.dataHash } };
  const stored = context.event.actorSignature;
  return { signed: true, body: {
    ...unsignedBindingBody(tuple, context.privateBodyDigest, { envelope: C_ENVELOPE_VERSION, schema: C_SCHEMA_VERSION }),
    dataHash: event.dataHash,
    signature: { keyRef: stored.keyRef, intentDigest: stored.intentDigest, assertionDigest: stored.assertionDigest,
      payloadDigest: event.businessData.actorSignature.intent.payloadDigest, metadataDigest: signedMetadataDigest(event) },
  } };
}

export async function inspectEvents(database, chaincode) {
  return database.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const failures = [];
    let checked = 0;
    let cursor;
    while (true) {
      const events = await tx.traceEvent.findMany({ take: 100, orderBy: { id: 'asc' },
        include: { bindingContext: EVENT_BINDING_CONTEXT_INCLUDE },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (events.length === 0) break;
      for (const event of events) {
        const reasons = [];
        if (!privateTraceEvidenceMatches(event)) reasons.push('PRIVATE_EVIDENCE_MISMATCH');
        if (!(await harvestSensorTraceEvidenceMatches(tx, event))) reasons.push('SENSOR_EVIDENCE_MISMATCH');
        try {
          if (!event.bindingContext) throw new Error('unbound');
          const { signed, body } = publicEnvelope(event);
          const parsed = signed
            ? chaincode.signing.parseSignedBindingEvent(JSON.stringify(body))
            : chaincode.binding.parseBindingEvent(JSON.stringify(body));
          const commitment = signed
            ? chaincode.signing.signedBindingEventCommitment(parsed)
            : chaincode.binding.bindingEventCommitment(parsed);
          if (commitment !== event.dataHash) reasons.push('CHAINCODE_COMMITMENT_MISMATCH');
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
    if (process.env.CI_REHEARSAL !== '1' || !process.env.DATABASE_URL || !process.env.CI_CHAINCODE_DIST) throw new Error('Rehearsal read-check configuration is incomplete');
    const load = name => import(pathToFileURL(`${process.env.CI_CHAINCODE_DIST}/${name}.js`).href);
    const chaincode = { binding: await load('binding'), signing: await load('signing') };
    if (typeof chaincode.binding.parseBindingEvent !== 'function' || typeof chaincode.signing.parseSignedBindingEvent !== 'function')
      throw new Error('Compiled chaincode validator is unavailable');
    database = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    const result = await inspectEvents(database, chaincode);
    console.log(JSON.stringify(result));
    if (result.result !== 'passed' || result.checked === 0) {
      const groups = new Map();
      for (const failure of result.failures) {
        const key = JSON.stringify([failure.eventType, failure.reasons]);
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }
      console.error(JSON.stringify({
        eventCheck: {
          result: result.result,
          checked: result.checked,
          writes: result.writes,
          failureCount: result.failures.length,
          failures: [...groups].map(([key, count]) => ({
            eventType: JSON.parse(key)[0],
            reasons: JSON.parse(key)[1],
            count,
          })),
        },
      }));
      process.exitCode = 1;
    }
  } catch { console.error('Event check failed; private payloads and connection diagnostics withheld'); process.exitCode = 1; }
  finally { await database?.$disconnect(); }
}
