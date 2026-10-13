import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadBindingNodeConfigs,
  parseBindingNodeConfigs,
} from './binding-config.js';
import { BindingConnectionPool } from './binding-pool.js';

const digest = (c: string) => c.repeat(64);
const entry = (overrides: Record<string, unknown> = {}) => ({
  bindingDigest: digest('a'),
  peerEndpoint: 'localhost:7051',
  peerHostAlias: 'peer0.org1.example.com',
  tlsCertPath: 'tls/ca.crt',
  mspId: 'Org1MSP',
  relayer: { certPath: 'relayer/cert.pem', keyDir: 'relayer/keystore' },
  ...overrides,
});
const config = (bindings: unknown[], version: unknown = 1) =>
  JSON.stringify({ version, bindings });

describe('deployment-owned binding configuration', () => {
  it('parses connection details and resolves identity paths without reading keys', () => {
    const [parsed] = parseBindingNodeConfigs(
      config([
        entry({
          controller: { certPath: 'c/cert.pem', keyDir: 'c/keystore' },
          admin: { certPath: 'a/cert.pem', keyDir: 'a/keystore' },
        }),
      ]),
    );
    expect(parsed.bindingDigest).toBe(digest('a'));
    expect(path.isAbsolute(parsed.relayer.certPath)).toBe(true);
    expect(parsed.controller?.keyDir).toMatch(/keystore$/);
    expect(parsed.admin).toBeDefined();
  });

  it('cannot redirect a ledger: channel, chaincode and contract are not accepted', () => {
    for (const field of [
      'channelId',
      'chaincodeName',
      'contractName',
      'writerMspId',
      'privateKey',
    ])
      expect(() =>
        parseBindingNodeConfigs(config([entry({ [field]: 'other' })])),
      ).toThrow(/Unknown field/);
    expect(() =>
      parseBindingNodeConfigs(
        config([entry({ relayer: { certPath: 'c', keyDir: 'k', key: 'x' } })]),
      ),
    ).toThrow(/Unknown field/);
  });

  it('rejects malformed, duplicated and unsupported configurations', () => {
    expect(() => parseBindingNodeConfigs(config([], 2))).toThrow(/version/);
    expect(() => parseBindingNodeConfigs('[]')).toThrow(/object/);
    expect(() =>
      parseBindingNodeConfigs(config([entry({ bindingDigest: 'abc' })])),
    ).toThrow(/bindingDigest/);
    expect(() => parseBindingNodeConfigs(config([entry(), entry()]))).toThrow(
      /duplicate/,
    );
    expect(() =>
      parseBindingNodeConfigs(config([entry({ peerEndpoint: '' })])),
    ).toThrow(/peerEndpoint/);
    expect(() =>
      parseBindingNodeConfigs(config([entry({ relayer: null })])),
    ).toThrow(/relayer/);
  });

  it('loads from FABRIC_BINDINGS_CONFIG and is empty when unset', () => {
    expect(loadBindingNodeConfigs({})).toEqual([]);
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'cfg-')), 'b.json');
    writeFileSync(file, config([entry()]));
    expect(
      loadBindingNodeConfigs({ FABRIC_BINDINGS_CONFIG: file }),
    ).toHaveLength(1);
  });

  it('tells the Worker which bindings it can serve per identity role', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'cfg-')), 'b.json');
    writeFileSync(
      file,
      config([
        entry({ bindingDigest: digest('a') }),
        entry({
          bindingDigest: digest('b'),
          controller: { certPath: 'c', keyDir: 'k' },
          admin: { certPath: 'a', keyDir: 'k' },
        }),
      ]),
    );
    const pool = new BindingConnectionPool();
    pool.environment = { FABRIC_BINDINGS_CONFIG: file };
    expect(pool.configuredDigests(['relayer'])).toEqual([
      digest('a'),
      digest('b'),
    ]);
    // A binding without controller and admin identities is not ours to
    // control, so its jobs can never starve the bindings that are.
    expect(pool.configuredDigests(['controller', 'admin'])).toEqual([
      digest('b'),
    ]);
    expect(pool.configured(digest('a'), 'admin')).toBe(false);
    expect(pool.configured(digest('c'), 'relayer')).toBe(false);
  });
});
