import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { legacyScopePins } from '../dist/modules/supply-chains/legacy-scope-pins.js';
import { ledgerRoutePins } from '../dist/modules/trace/ledger-route.js';
import {
  routeImportPins,
  pausedWriterPins,
} from '../dist/modules/trace/ledger-route-import-artifact.js';

try {
  assert.equal(process.argv.length, 2);
  assert.equal(process.env.NODE_ENV, 'production');
  assert.match(process.env.APP_RELEASE_SHA ?? '', /^[a-f0-9]{40}$/);
  const metadata = JSON.parse(
    readFileSync(process.env.HYBRID_LEGACY_MANIFEST_PINS_FILE, 'utf8'),
  );
  assert.equal(metadata.schema, 'agritrace-legacy-scope-pins-1');
  assert(Array.isArray(metadata.pins));
  // Runtime rejects the whole file on a bad canonical digest/plan linkage.
  // Comparing counts distinguishes a valid empty set from a rejected file.
  const legacy = legacyScopePins();
  assert.equal(legacy.length, metadata.pins.length);
  const routes = ledgerRoutePins();
  assert(routes.has(process.env.LEDGER_ACTIVE_ROUTE_DIGEST));
  const imports = routeImportPins();
  const writers = pausedWriterPins();
  console.log(
    JSON.stringify({
      result: 'passed',
      sourceSha: process.env.APP_RELEASE_SHA,
      legacyPinCount: legacy.length,
      routePinCount: routes.size,
      importPinCount: imports.length,
      pausedWriterPinCount: writers.size,
      databaseAccessed: false,
      signingMaterialRead: false,
    }),
  );
} catch {
  console.error(
    'Hybrid metadata validation failed; inspect operator-owned pins.',
  );
  process.exitCode = 1;
}
