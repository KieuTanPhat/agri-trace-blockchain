import { configuredWriteRoute } from '../../src/modules/trace/ledger-route.js';

/** Synthetic write route for tests. Not Fabric acceptance evidence. */
export const FIXTURE_ROUTE_ENV = {
  FABRIC_NETWORK_NAME: 'audit-fixture',
  FABRIC_CHANNEL_NAME: 'agritrace',
  FABRIC_CHAINCODE_NAME: 'agritrace',
  FABRIC_CONTRACT_NAME: 'AgriTraceContract',
  FABRIC_MSP_ID: 'FixtureMSP',
  LEDGER_WRITER_AUTHORITY: 'isolated:technical-relayer',
} as const;

export const fixtureRoute = configuredWriteRoute({ ...FIXTURE_ROUTE_ENV });

/** Point the process at the fixture route (API TraceService and Worker). */
export function fixtureRoutePins() {
  Object.assign(process.env, FIXTURE_ROUTE_ENV);
}
