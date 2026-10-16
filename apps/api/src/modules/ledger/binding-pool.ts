import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { X509Certificate, createHash } from 'node:crypto';
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
  certificateExpiresAt: Date;
}

interface PoolEntry {
  promise: Promise<BindingConnection>;
  gateway?: GatewayConnection;
  /** Callers between get() and release(). */
  users: number;
  retired: boolean;
  closed: boolean;
}

/** One cached gateway connection per (binding, identity role). Connections are
 * single-flight, never shared between bindings, and dropped on failure so a
 * rotated certificate or moved peer is picked up on the next cycle. Every
 * get() is paired with release(); an invalidated connection is closed once
 * its last current user releases it, never under an attempt in progress. */
@Injectable()
export class BindingConnectionPool implements OnModuleDestroy {
  private readonly connections = new Map<string, PoolEntry>();
  private readonly entries = new Set<PoolEntry>();
  private readonly owners = new WeakMap<BindingConnection, PoolEntry>();
  private configs?: Map<string, BindingNodeConfig>;
  private configRevision?: string;
  /** Overridable for tests; re-read the operator file for new/changed bindings. */
  public environment: NodeJS.ProcessEnv = process.env;

  private load(): Map<string, BindingNodeConfig> {
    const parsed = loadBindingNodeConfigs(this.environment);
    const revision = createHash('sha256')
      .update(JSON.stringify(parsed))
      .digest('hex');
    if (revision !== this.configRevision) {
      // Existing in-flight work retains its original client/receipt. Future
      // work sees the atomically replaced operator inventory, including additions.
      const next = new Map(parsed.map((item) => [item.bindingDigest, item]));
      for (const [digest, old] of this.configs ?? [])
        if (JSON.stringify(old) !== JSON.stringify(next.get(digest)))
          this.invalidate(digest);
      this.configs = new Map(parsed.map((item) => [item.bindingDigest, item]));
      this.configRevision = revision;
    }
    return this.configs!;
  }

  private config(digest: string): BindingNodeConfig | undefined {
    return this.load().get(digest);
  }

  public configured(digest: string, role: BindingRole): boolean {
    const config = this.config(digest);
    return Boolean(config && (role === 'relayer' || config[role]));
  }

  /** Bindings this process holds every listed identity for. */
  public configuredDigests(roles: BindingRole[]): string[] {
    return [...this.load().keys()].filter((digest) =>
      roles.every((role) => this.configured(digest, role)),
    );
  }

  public async get(
    target: BindingTarget,
    role: BindingRole,
  ): Promise<BindingConnection> {
    const key = `${target.digest}:${role}`;
    const fingerprint = await this.identityFingerprint(target, role);
    let entry = this.connections.get(key);
    if (entry) {
      const cached = await entry.promise.catch(() => undefined);
      if (cached?.fingerprint !== fingerprint) {
        this.invalidate(target.digest, role);
        entry = undefined;
      }
    }
    if (!entry) {
      const created: PoolEntry = {
        promise: undefined as unknown as Promise<BindingConnection>,
        users: 0,
        retired: false,
        closed: false,
      };
      created.promise = this.connect(target, role, created).then(
        (connection) => {
          this.owners.set(connection, created);
          return connection;
        },
        (error: unknown) => {
          if (this.connections.get(key) === created)
            this.connections.delete(key);
          this.retire(created);
          throw error;
        },
      );
      this.entries.add(created);
      this.connections.set(key, created);
      entry = created;
    }
    entry.users += 1;
    try {
      return await entry.promise;
    } catch (error) {
      this.drop(entry);
      throw error;
    }
  }

  /** Fingerprint of the currently configured identity certificate. */
  private async identityFingerprint(
    target: BindingTarget,
    role: BindingRole,
  ): Promise<string> {
    const node = this.config(target.digest);
    const identity = role === 'relayer' ? node?.relayer : node?.[role];
    if (!identity) throw new Error('Binding identity is not configured');
    const bytes = await readFile(identity.certPath);
    const certificate = new X509Certificate(bytes);
    const notBefore = Date.parse(certificate.validFrom);
    const notAfter = Date.parse(certificate.validTo);
    if (
      !Number.isFinite(notBefore) ||
      !Number.isFinite(notAfter) ||
      Date.now() < notBefore ||
      Date.now() >= notAfter
    ) {
      this.invalidate(target.digest, role);
      throw new Error(
        'BINDING_CERTIFICATE_EXPIRED: identity is outside its validity window',
      );
    }
    return certificateFingerprint(bytes);
  }

  /** Ends one get(). Closes the connection if it was invalidated meanwhile. */
  public release(connection: BindingConnection | undefined): void {
    const entry = connection && this.owners.get(connection);
    if (entry) this.drop(entry);
  }

  public invalidate(digest: string, role?: BindingRole): void {
    for (const [key, entry] of this.connections)
      if (key.startsWith(`${digest}:`) && (!role || key.endsWith(`:${role}`))) {
        this.connections.delete(key);
        this.retire(entry);
      }
  }

  /** Number of gateway connections not yet closed (for health and tests). */
  public openCount(): number {
    return [...this.entries].filter((entry) => entry.gateway).length;
  }

  private drop(entry: PoolEntry): void {
    entry.users = Math.max(0, entry.users - 1);
    if (entry.retired && entry.users === 0) this.close(entry);
  }

  private retire(entry: PoolEntry): void {
    entry.retired = true;
    if (entry.users === 0) this.close(entry);
  }

  private close(entry: PoolEntry): void {
    if (entry.closed) return;
    entry.closed = true;
    this.entries.delete(entry);
    entry.gateway?.close();
  }

  private async connect(
    target: BindingTarget,
    role: BindingRole,
    entry: PoolEntry,
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
    if (entry.closed) {
      connection.close();
      throw new Error('Binding connection pool was closed while connecting');
    }
    // Closed by close() when the entry is retired, including a failed gate.
    entry.gateway = connection;
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
        channelPolicy?: {
          strictB?: boolean;
          allowLegacyV3Writes?: boolean;
        } | null;
      };
      if (
        health.status !== 'OK' ||
        !health.supportedWriteVersions?.includes('4.0.0') ||
        !health.supportedWriteVersions?.includes('6.0.0') ||
        health.channelPolicy?.strictB !== true ||
        health.channelPolicy?.allowLegacyV3Writes !== false ||
        health.callerRole !== 'relayer' ||
        health.governanceDigest !== target.governanceDigest
      ) {
        throw new Error(
          'Binding ledger does not satisfy the writer capability gate',
        );
      }
    }
    const certificateBytes = connection.identityCertificate;
    const certificate = new X509Certificate(certificateBytes);
    if (
      Date.now() < Date.parse(certificate.validFrom) ||
      Date.now() >= Date.parse(certificate.validTo)
    ) {
      throw new Error(
        'BINDING_CERTIFICATE_EXPIRED: connected identity is outside its validity window',
      );
    }
    return {
      client,
      fingerprint: certificateFingerprint(certificateBytes),
      certificateExpiresAt: new Date(certificate.validTo),
    };
  }

  public onModuleDestroy(): void {
    for (const entry of this.entries) this.close(entry);
    this.connections.clear();
  }
}
