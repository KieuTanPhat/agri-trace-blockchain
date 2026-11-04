import { readFileSync } from 'node:fs';
import {
  parseBindingNodeConfigs,
  type BindingNodeConfig,
} from './binding-config.js';

/** Operator-owned connection template. No enterprise request can select a ledger. */
interface PlatformLedgerConfig {
  network: string;
  channelId: 'agritrace';
  chaincodeName: string;
  contractName: string;
  writerAuthority: string;
  governanceDigest: string;
  node: Omit<BindingNodeConfig, 'bindingDigest'>;
}

export function loadPlatformLedgerConfig(
  env: NodeJS.ProcessEnv = process.env,
): PlatformLedgerConfig | undefined {
  if (!env.FABRIC_BINDINGS_CONFIG) return;
  const root = JSON.parse(readFileSync(env.FABRIC_BINDINGS_CONFIG, 'utf8')) as {
    version?: number;
    platform?: PlatformLedgerConfig;
  };
  if (!root.platform) return;
  const config = root.platform;
  if (
    root.version !== 1 ||
    config.channelId !== 'agritrace' ||
    !/^[a-f0-9]{64}$/.test(config.governanceDigest) ||
    ![
      config.network,
      config.chaincodeName,
      config.contractName,
      config.writerAuthority,
    ].every(
      (v) => typeof v === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(v),
    ) ||
    config.node?.mspId !== 'AgritraceMSP'
  )
    throw new Error('Invalid platform ledger target');
  const [node] = parseBindingNodeConfigs(
    JSON.stringify({
      version: 1,
      bindings: [{ ...config.node, bindingDigest: '0'.repeat(64) }],
    }),
  );
  if (!node.controller || !node.admin)
    throw new Error(
      'Platform provisioning requires technical controller and registry admin identities',
    );
  return { ...config, node };
}

export function matchesPlatform(
  config: PlatformLedgerConfig,
  binding: {
    network: string;
    channelId: string;
    chaincodeName: string;
    contractName: string;
    writerAuthority: string;
    writerMspId: string;
    governanceDigest: string;
  },
): boolean {
  return (
    binding.network === config.network &&
    binding.channelId === config.channelId &&
    binding.chaincodeName === config.chaincodeName &&
    binding.contractName === config.contractName &&
    binding.writerAuthority === config.writerAuthority &&
    binding.writerMspId === 'AgritraceMSP' &&
    binding.governanceDigest === config.governanceDigest
  );
}
