import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
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

  private load(): Map<string, BindingNodeConfig> {
    this.configs ??= new Map(
      loadBindingNodeConfigs(this.environment).map((item) => [
        item.bindingDigest,
        item,
      ]),
    );
    return this.configs;
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
    const node = this.config(target.digest);
    const identity = role === 'relayer' ? node?.relayer : node?.[role];
    if (!identity) throw new Error('Binding identity is not configured');
    const bytes = await readFile(identity.certPath);
    const certificate = new X509Certificate(bytes);
    const notBefore = Date.parse(certificate.validFrom);
    const notAfter = Date.parse(certificate.validTo);
    if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter) || Date.now() < notBefore || Date.now() >= notAfter) {
      this.invalidate(target.digest, role);
      throw new Error('BINDING_CERTIFICATE_EXPIRED: identity is outside its validity window');
    }
    let pending = this.connections.get(key);
    if (pending && (await pending).fingerprint !== certificateFingerprint(bytes)) {
      this.invalidate(target.digest, role);
      pending = undefined;
    }
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
        channelPolicy?: { strictB?: boolean; allowLegacyV3Writes?: boolean } | null;
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
        connection.close();
        throw new Error(
          'Binding ledger does not satisfy the writer capability gate',
        );
      }
    }
    const certificateBytes = connection.identityCertificate;
    const certificate = new X509Certificate(certificateBytes);
    if (Date.now() < Date.parse(certificate.validFrom) || Date.now() >= Date.parse(certificate.validTo)) {
      connection.close();
      throw new Error('BINDING_CERTIFICATE_EXPIRED: connected identity is outside its validity window');
    }
    return {
      client,
      fingerprint: certificateFingerprint(certificateBytes),
      certificateExpiresAt: new Date(certificate.validTo),
    };
  }

  public onModuleDestroy(): void {
    for (const connection of this.open.splice(0)) connection.close();
    this.connections.clear();
  }
}
