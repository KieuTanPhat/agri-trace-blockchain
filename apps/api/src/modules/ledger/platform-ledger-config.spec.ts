import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  loadPlatformLedgerConfig,
  matchesPlatform,
} from './platform-ledger-config.js';

describe('Operator-owned shared platform target', () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'agritrace-platform-config-'),
  );
  const file = path.join(directory, 'bindings.json');
  const identity = {
    certPath: '/private/technical/cert.pem',
    keyDir: '/private/technical/keystore',
  };
  const platform = {
    network: 'isolated-platform',
    channelId: 'agritrace',
    chaincodeName: 'agritrace',
    contractName: 'AgriTraceContract',
    writerAuthority: 'agritrace-relayer-b',
    governanceDigest: 'ab'.repeat(32),
    node: {
      peerEndpoint: 'localhost:7051',
      peerHostAlias: 'peer0.org1.example.com',
      tlsCertPath: '/public/peer-ca.crt',
      mspId: 'AgritraceMSP',
      relayer: identity,
      controller: identity,
      admin: identity,
    },
  };
  const load = (value: unknown) => {
    writeFileSync(
      file,
      JSON.stringify({ version: 1, bindings: [], platform: value }),
    );
    return loadPlatformLedgerConfig({ FABRIC_BINDINGS_CONFIG: file });
  };
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  it('pins network/channel/contract/authority/MSP/governance for every tenant binding', () => {
    const config = load(platform)!;
    const binding = { ...platform, writerMspId: 'AgritraceMSP' };
    expect(matchesPlatform(config, binding)).toBe(true);
    for (const field of [
      'network',
      'channelId',
      'chaincodeName',
      'contractName',
      'writerAuthority',
      'writerMspId',
      'governanceDigest',
    ]) {
      expect(
        matchesPlatform(config, { ...binding, [field]: 'another-target' }),
      ).toBe(false);
    }
  });
  it('rejects retired tenant MSPs, arbitrary channels and incomplete technical credentials', () => {
    expect(() =>
      load({ ...platform, node: { ...platform.node, mspId: 'Org2MSP' } }),
    ).toThrow();
    expect(() =>
      load({ ...platform, node: { ...platform.node, mspId: 'Org3MSP' } }),
    ).toThrow();
    expect(() => load({ ...platform, channelId: 'hybrid-self' })).toThrow();
    expect(() =>
      load({ ...platform, node: { ...platform.node, admin: undefined } }),
    ).toThrow();
  });
});
