import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import {
  BindingLedgerClient,
  certificateFingerprint,
  connectGateway,
  type GatewayConnection,
} from '@agri-trace/fabric-gateway';
import {
  loadBindingNodeConfigs,
  type BindingNodeConfig,
  type IdentityRef,
} from './binding-config.js';

export type BindingRole = 'relayer' | 'controller' | 'admin';

/** The authoritative, immutable parts of a binding (from the database). */
export interface BindingTarget {
  digest: string;
  channelId: string;
  chaincodeName: string;
  contractName: string;
  writerMspId: string;
  governanceDigest: string;
}

export interface BindingConnection {
  client: BindingLedgerClient;
  /** SHA-256 of the identity certificate, as the chaincode derives it. */
  fingerprint: string;
}

/** One cached gateway connection per (binding, identity role). Connections are
 * single-flight, never shared between bindings, and dropped on failure so a
 * rotated certificate or moved peer is picked up on the next cycle. */
@Injectable()
export class BindingConnectionPool implements OnModuleDestroy {
  private readonly connections = new Map<string, Promise<BindingConnection>>();
  private readonly open: GatewayConnection[] = [];
  private configs?: Map<string, BindingNodeConfig>;
  /** Overridable for tests; read lazily so the file is parsed once. */
  public environment: NodeJS.ProcessEnv = process.env;

  private config(digest: string): BindingNodeConfig | undefined {
    this.configs ??= new Map(
      loadBindingNodeConfigs(this.environment).map((item) => [
        item.bindingDigest,
        item,
      ]),
    );
    return this.configs.get(digest);
  }

  public configured(digest: string, role: BindingRole): boolean {
    const config = this.config(digest);
    return Boolean(config && (role === 'relayer' || config[role]));
  }

  public async get(
    target: BindingTarget,
    role: BindingRole,
  ): Promise<BindingConnection> {
    const key = `${target.digest}:${role}`;
    let pending = this.connections.get(key);
    if (!pending) {
      pending = this.connect(target, role).catch((error) => {
        this.connections.delete(key);
        throw error;
      });
      this.connections.set(key, pending);
    }
    return pending;
  }

  public invalidate(digest: string, role?: BindingRole): void {
    for (const key of this.connections.keys())
      if (key.startsWith(`${digest}:`) && (!role || key.endsWith(`:${role}`)))
        this.connections.delete(key);
  }

  private async connect(
    target: BindingTarget,
    role: BindingRole,
  ): Promise<BindingConnection> {
    const config = this.config(target.digest);
    if (!config)
      throw new Error(
        `No connection config for binding ${target.digest.slice(0, 12)}`,
      );
    const identity: IdentityRef | undefined =
      role === 'relayer' ? config.relayer : config[role];
    if (!identity)
      throw new Error(
        `Binding ${target.digest.slice(0, 12)} has no ${role} identity`,
      );
    if (config.mspId !== target.writerMspId)
      throw new Error('Configured MSP differs from the binding writer MSP');
    const connection = await connectGateway({
      channelName: target.channelId,
      chaincodeName: target.chaincodeName,
      contractName: target.contractName,
      mspId: config.mspId,
      peerEndpoint: config.peerEndpoint,
      peerHostAlias: config.peerHostAlias,
      tlsCertPath: config.tlsCertPath,
      identityCertPath: identity.certPath,
      identityKeyDirectory: identity.keyDir,
    });
    this.open.push(connection);
    const client = new BindingLedgerClient(connection.gateway, {
      channelName: target.channelId,
      chaincodeName: target.chaincodeName,
      contractName: target.contractName,
    });
    if (role === 'relayer') {
      // The capability gate checks the chaincode actually deployed on this
      // binding, not just a "status OK" string.
      const health = (await client.health()) as {
        status?: string;
        supportedWriteVersions?: string[];
        governanceDigest?: string;
        callerRole?: string | null;
        channelPolicy?: { strictB?: boolean } | null;
      };
      if (
        health.status !== 'OK' ||
        !health.supportedWriteVersions?.includes('4.0.0') ||
        !health.supportedWriteVersions?.includes('5.0.0') ||
        health.channelPolicy?.strictB !== true ||
        health.callerRole !== 'relayer' ||
        health.governanceDigest !== target.governanceDigest
      ) {
        connection.close();
        throw new Error(
          'Binding ledger does not satisfy the writer capability gate',
        );
      }
    }
    return {
      client,
      fingerprint: certificateFingerprint(await readFile(identity.certPath)),
    };
  }

  public onModuleDestroy(): void {
    for (const connection of this.open.splice(0)) connection.close();
    this.connections.clear();
  }
}
