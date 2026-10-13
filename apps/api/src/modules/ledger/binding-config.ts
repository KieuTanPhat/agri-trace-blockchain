import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface IdentityRef {
  certPath: string;
  keyDir: string;
}

/** Connection details only. Channel, chaincode, contract and writer MSP come
 * from the immutable binding row, so this file can never redirect a ledger. */
export interface BindingNodeConfig {
  bindingDigest: string;
  peerEndpoint: string;
  peerHostAlias: string;
  tlsCertPath: string;
  mspId: string;
  relayer: IdentityRef;
  controller?: IdentityRef;
  admin?: IdentityRef;
}

const HASH = /^[a-f0-9]{64}$/;

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024)
    throw new Error(`Invalid binding config field ${label}`);
  return value;
}

function identity(value: unknown, label: string): IdentityRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`Invalid binding config identity ${label}`);
  const item = value as Record<string, unknown>;
  const unknown = Object.keys(item).filter(
    (key) => !['certPath', 'keyDir'].includes(key),
  );
  if (unknown.length) throw new Error(`Unknown field ${label}.${unknown[0]}`);
  return {
    certPath: path.resolve(text(item.certPath, `${label}.certPath`)),
    keyDir: path.resolve(text(item.keyDir, `${label}.keyDir`)),
  };
}

/** Parses the deployment-owned bindings file. Only secret *references* (paths)
 * appear here; private keys are read by the process that signs. */
export function parseBindingNodeConfigs(json: string): BindingNodeConfig[] {
  const root = JSON.parse(json) as unknown;
  if (typeof root !== 'object' || root === null || Array.isArray(root))
    throw new Error('Binding config must be an object');
  const body = root as { version?: unknown; bindings?: unknown };
  if (body.version !== 1 || !Array.isArray(body.bindings))
    throw new Error('Unsupported binding config version');
  const seen = new Set<string>();
  return body.bindings.map((entry: unknown, index: number) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
      throw new Error(`Invalid binding config entry ${index}`);
    const item = entry as Record<string, unknown>;
    const allowed = [
      'bindingDigest',
      'peerEndpoint',
      'peerHostAlias',
      'tlsCertPath',
      'mspId',
      'relayer',
      'controller',
      'admin',
    ];
    const unknown = Object.keys(item).filter((key) => !allowed.includes(key));
    if (unknown.length)
      throw new Error(`Unknown field bindings[${index}].${unknown[0]}`);
    const digest = text(item.bindingDigest, 'bindingDigest');
    if (!HASH.test(digest) || seen.has(digest))
      throw new Error(`Invalid or duplicate bindingDigest at ${index}`);
    seen.add(digest);
    return {
      bindingDigest: digest,
      peerEndpoint: text(item.peerEndpoint, 'peerEndpoint'),
      peerHostAlias: text(item.peerHostAlias, 'peerHostAlias'),
      tlsCertPath: path.resolve(text(item.tlsCertPath, 'tlsCertPath')),
      mspId: text(item.mspId, 'mspId'),
      relayer: identity(item.relayer, 'relayer'),
      ...(item.controller
        ? { controller: identity(item.controller, 'controller') }
        : {}),
      ...(item.admin ? { admin: identity(item.admin, 'admin') } : {}),
    };
  });
}

export function loadBindingNodeConfigs(
  environment: NodeJS.ProcessEnv = process.env,
): BindingNodeConfig[] {
  const file = environment.FABRIC_BINDINGS_CONFIG;
  if (!file) return [];
  return parseBindingNodeConfigs(readFileSync(file, 'utf8'));
}
