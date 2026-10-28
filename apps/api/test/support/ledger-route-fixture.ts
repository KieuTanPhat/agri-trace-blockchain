import {
  BINDING_ROUTE_PROTOCOL,
  ledgerRouteDigest,
  type PinnedRoute,
  type RouteDefinition,
} from '../../src/modules/trace/ledger-route.js';

/** Synthetic binding route for unit tests. Not Fabric acceptance evidence. */
const definition: RouteDefinition = {
  protocol: BINDING_ROUTE_PROTOCOL,
  mode: 'WRITE',
  network: 'audit-fixture',
  channelId: 'agritrace',
  chaincodeName: 'agritrace',
  contractName: 'AgriTraceContract',
  envelopeVersion: '4.0.0',
  writerAuthority: 'isolated:technical-relayer',
  writerMspId: 'FixtureMSP',
  writerRole: 'relayer',
  chainRef: '55690720-e988-4a97-8ef9-4f9c35c34b98',
  bindingDigest: 'f'.repeat(64),
};

export const fixtureRoute: PinnedRoute = Object.freeze({
  ...definition,
  digest: ledgerRouteDigest(definition),
});
