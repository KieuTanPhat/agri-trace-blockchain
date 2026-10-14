import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import {
  BindingLedgerClient,
  RegistryOperator,
  certificateFingerprint,
  connectGateway,
  type GatewayConnection,
} from '@agri-trace/fabric-gateway';

/** Linux and optional Windows/WSL pilot; never assumes a user's home/UNC path. */
export const PILOT_ROOT =
  process.env.FABRIC_ROOT ?? path.join(homedir(), 'agritrace-fabric');
export const CHAINCODE = 'agritrace';
export const CONTRACT = 'AgriTraceContract';
export const WRITER_AUTHORITY = 'agritrace-relayer-b';

export type Org = 'org1' | 'org2' | 'org3';
const offset = Number(process.env.AGRI_FABRIC_PORT_OFFSET ?? '0');
if (!Number.isInteger(offset) || offset < 0 || offset > 50000)
  throw new Error('Invalid Fabric test port offset');
const ORGS = {
  org1: { dir: 'net', msp: 'Org1MSP', endpoint: `localhost:${7051 + offset}` },
  org2: { dir: 'net', msp: 'Org2MSP', endpoint: `localhost:${9051 + offset}` },
  org3: { dir: 'self', msp: 'Org3MSP', endpoint: `localhost:${11051 + offset}` },
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

const open: GatewayConnection[] = [];
const configDirectories = new Set<string>();

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
  for (const dir of configDirectories) {
    if (path.dirname(dir) !== tmpdir() || !path.basename(dir).startsWith('agritrace-bindings-'))
      throw new Error('Unsafe test config cleanup path');
    rmSync(dir, { recursive: true, force: true });
  }
  configDirectories.clear();
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
  configDirectories.add(dir);
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
    { mode: 0o600 },
  );
  return file;
}

/** Outage injection only selects containers owned by this test instance. */
export function pilotDocker(...args: string[]) {
  const instance = process.env.AGRI_FABRIC_INSTANCE;
  if (!instance || !/^[a-z][a-z0-9-]{3,48}$/.test(instance))
    throw new Error('Fabric outage injection requires an isolated instance');
  if (!['stop', 'start'].includes(args[0]) || args.length < 2 ||
      args.slice(1).some((arg) => !/^peer0\.org[123]\.example\.com$/.test(arg)))
    throw new Error('Unsupported Fabric outage command');
  const scoped = args.map((arg) => /^peer0\.org[123]\.example\.com$/.test(arg) ? `${instance}-${arg}` : arg);
  const executable = process.platform === 'win32' ? 'wsl' : 'docker';
  const prefix = process.platform === 'win32' ? ['-d', process.env.HYBRID_WSL_DISTRO ?? 'Ubuntu', '--exec', 'docker'] : [];
  for (const name of scoped.slice(1)) {
    const ownership = spawnSync(executable, [...prefix, 'inspect', '--format', '{{index .Config.Labels "agritrace.hybrid.instance"}}', name], { encoding: 'utf8' });
    if (ownership.status !== 0 || ownership.stdout.trim() !== instance)
      throw new Error('Fabric outage resource ownership mismatch');
  }
  const result = spawnSync(executable, [...prefix, ...scoped], {
    encoding: 'utf8',
  });
  if (result.status !== 0)
    throw new Error(`docker ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}
