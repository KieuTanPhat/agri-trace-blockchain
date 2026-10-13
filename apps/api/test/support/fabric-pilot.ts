import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import {
  BindingLedgerClient,
  RegistryOperator,
  certificateFingerprint,
  connectGateway,
  type GatewayConnection,
} from '@agri-trace/fabric-gateway';

/** Local three-organization pilot (blockchain/network/hybrid). The data dir is
 * the Linux side as seen from the Windows host through the WSL UNC share. */
export const PILOT_ROOT =
  process.env.FABRIC_ROOT ??
  '\\\\wsl.localhost\\Ubuntu\\home\\kieup\\agritrace-fabric';
export const CHAINCODE = 'agritrace';
export const CONTRACT = 'AgriTraceContract';
export const WRITER_AUTHORITY = 'agritrace-relayer-b';

export type Org = 'org1' | 'org2' | 'org3';
const ORGS = {
  org1: { dir: 'net', msp: 'Org1MSP', endpoint: 'localhost:7051' },
  org2: { dir: 'net', msp: 'Org2MSP', endpoint: 'localhost:9051' },
  org3: { dir: 'self', msp: 'Org3MSP', endpoint: 'localhost:11051' },
} as const;

const orgDir = (org: Org) =>
  path.join(
    PILOT_ROOT,
    ORGS[org].dir,
    'organizations',
    'peerOrganizations',
    `${org}.example.com`,
  );
export const userMsp = (org: Org, user: string) =>
  path.join(orgDir(org), 'users', `${user}@${org}.example.com`, 'msp');
export const peerCa = (org: Org) =>
  path.join(orgDir(org), 'peers', `peer0.${org}.example.com`, 'tls', 'ca.crt');
export const orgMsp = (org: Org) => ORGS[org].msp;

const open: GatewayConnection[] = [];

export async function pilotClient(org: Org, user: string, channel: string) {
  const msp = userMsp(org, user);
  const connection = await connectGateway({
    channelName: channel,
    chaincodeName: CHAINCODE,
    contractName: CONTRACT,
    mspId: ORGS[org].msp,
    peerEndpoint: ORGS[org].endpoint,
    peerHostAlias: `peer0.${org}.example.com`,
    tlsCertPath: peerCa(org),
    identityCertPath: path.join(msp, 'signcerts', 'cert.pem'),
    identityKeyDirectory: path.join(msp, 'keystore'),
  });
  open.push(connection);
  return {
    client: new BindingLedgerClient(connection.gateway, {
      channelName: channel,
      chaincodeName: CHAINCODE,
      contractName: CONTRACT,
    }),
    fingerprint: certificateFingerprint(
      readFileSync(path.join(msp, 'signcerts', 'cert.pem')),
    ),
  };
}

export function closePilotConnections() {
  for (const connection of open.splice(0)) connection.close();
}

/** Ledger-side operator: the AgriTrace controller plus the admins of the
 * governed MSPs (the harness plays the owner's operator for Org2/Org3). */
export async function pilotOperator(
  channel: string,
  ownerOrg: 'org2' | 'org3',
) {
  const controller = await pilotClient('org1', 'controller', channel);
  const admin1 = await pilotClient('org1', 'Admin', channel);
  const owner = await pilotClient(ownerOrg, 'Admin', channel);
  const relayer = await pilotClient('org1', 'relayer', channel);
  return {
    reader: relayer.client,
    relayerFingerprint: relayer.fingerprint,
    operator: new RegistryOperator(controller.client, {
      Org1MSP: admin1.client,
      [ORGS[ownerOrg].msp]: owner.client,
    }),
    approvers: ['Org1MSP', ORGS[ownerOrg].msp],
  };
}

/** Worker-side connection file: connection details only (the binding row owns
 * channel, chaincode and MSP). Written to a temp file, never committed. */
export function writeBindingsConfig(digests: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'agritrace-bindings-'));
  mkdirSync(dir, { recursive: true });
  const identity = (user: string) => ({
    certPath: path.join(userMsp('org1', user), 'signcerts', 'cert.pem'),
    keyDir: path.join(userMsp('org1', user), 'keystore'),
  });
  const file = path.join(dir, 'bindings.json');
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      bindings: digests.map((bindingDigest) => ({
        bindingDigest,
        peerEndpoint: ORGS.org1.endpoint,
        peerHostAlias: 'peer0.org1.example.com',
        tlsCertPath: peerCa('org1'),
        mspId: 'Org1MSP',
        relayer: identity('relayer'),
        controller: identity('controller'),
        admin: identity('Admin'),
      })),
    }),
  );
  return file;
}

/** Docker control through WSL (outage injection). */
export function pilotDocker(...args: string[]) {
  const result = spawnSync('wsl', ['-d', 'Ubuntu', '--', 'docker', ...args], {
    encoding: 'utf8',
  });
  if (result.status !== 0)
    throw new Error(`docker ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}
