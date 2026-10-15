/**
 * Platform-operator CLI for release-B ledger bindings. Not an HTTP surface:
 * it names networks, channels and MSPs and may use admin identities, which
 * business users and the API must never hold.
 *
 *   node dist/operator/ledger-operator.js register-binding --chain <uuid> \
 *     --network <name> --channel <id> --writer-authority <id> --writer-msp <MSP> \
 *     --governance-digest <sha256> --profile SERVICE|MANAGED_ORG|SELF_MANAGED_ORG
 *   node dist/operator/ledger-operator.js onboard --binding <digest> --config operator.json
 *   node dist/operator/ledger-operator.js activate --binding <digest>
 *   node dist/operator/ledger-operator.js pause|resume --binding <digest>
 *   node dist/operator/ledger-operator.js resolve-hold --hold <uuid> --resolution "<text>"
 *   node dist/operator/ledger-operator.js register-signing-key --key <keyRef> --config operator.json
 *   node dist/operator/ledger-operator.js set-handover-mode --chain <uuid> --mode STANDARD|DUAL_SIGNED
 *   node dist/operator/ledger-operator.js status [--chain <uuid>]
 *
 * operator.json: { "controller": CONN, "reader": CONN, "relayer": CONN,
 *                  "admins": { "<MSP>": CONN, ... } } where CONN is
 *   { mspId, peerEndpoint, peerHostAlias, tlsCertPath, certPath, keyDir }.
 * `admins` must list every MSP the governance descriptor requires.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  BindingLedgerClient,
  RegistryOperator,
  certificateFingerprint,
  connectGateway,
  type GatewayConnection,
} from '@agri-trace/fabric-gateway';
import {
  PrismaClient,
  type HandoverMode,
  type LedgerProfile,
} from '../generated/prisma/client.js';
import {
  activateSigningKey,
  registerSigningKeyOnLedger,
  setHandoverMode,
} from '../modules/ledger/ledger-signing.js';
import {
  activateBinding,
  registerBinding,
  setBindingPaused,
} from '../modules/ledger/ledger-bindings.js';
import {
  mirrorCredential,
  onboardBindingOnLedger,
} from '../modules/ledger/ledger-onboarding.js';
import { bindingObservation } from '../modules/ledger/binding-observation.js';
import {
  AwaitingOwnerApproval,
  ExternalOwnerRegistryOperator,
} from '../modules/ledger/external-owner-operator.js';

interface Conn {
  mspId: string;
  peerEndpoint: string;
  peerHostAlias: string;
  tlsCertPath: string;
  certPath: string;
  keyDir: string;
}

function args(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith('--') || argv[i + 1] === undefined)
      throw new Error(`Expected --name value pairs, got "${key}"`);
    out[key.slice(2)] = argv[i + 1];
  }
  return out;
}
const need = (options: Record<string, string>, name: string) => {
  const value = options[name];
  if (!value) throw new Error(`Missing --${name}`);
  return value;
};

const open: GatewayConnection[] = [];
async function client(
  conn: Conn,
  channelName: string,
  chaincodeName: string,
  contractName: string,
) {
  const connection = await connectGateway({
    channelName,
    chaincodeName,
    contractName,
    mspId: conn.mspId,
    peerEndpoint: conn.peerEndpoint,
    peerHostAlias: conn.peerHostAlias,
    tlsCertPath: conn.tlsCertPath,
    identityCertPath: conn.certPath,
    identityKeyDirectory: conn.keyDir,
  });
  open.push(connection);
  return {
    client: new BindingLedgerClient(connection.gateway, {
      channelName,
      chaincodeName,
      contractName,
    }),
    fingerprint: certificateFingerprint(readFileSync(conn.certPath)),
  };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === '--help') {
    console.log(
      'Usage: node dist/operator/ledger-operator.js <register-binding|onboard|activate|pause|resume|resolve-hold|register-signing-key|set-handover-mode|status> [--option value ...]',
    );
    return;
  }
  const options = args(rest);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  try {
    switch (command) {
      case 'register-binding': {
        const result = await prisma.$transaction((tx) =>
          registerBinding(tx, {
            chainId: need(options, 'chain'),
            network: need(options, 'network'),
            channelId: need(options, 'channel'),
            chaincodeName: options.chaincode ?? 'agritrace',
            contractName: options.contract ?? 'AgriTraceContract',
            writerAuthority: need(options, 'writer-authority'),
            writerMspId: need(options, 'writer-msp'),
            governanceDigest: need(options, 'governance-digest'),
            profile: need(options, 'profile') as LedgerProfile,
          }),
        );
        console.log(JSON.stringify(result, null, 2));
        break;
      }
      case 'onboard': {
        const digest = need(options, 'binding');
        const config = JSON.parse(
          readFileSync(need(options, 'config'), 'utf8'),
        ) as {
          controller: Conn;
          reader: Conn;
          relayer: Conn;
          admins: Record<string, Conn>;
        };
        const binding = await prisma.fabricNetworkBinding.findUniqueOrThrow({
          where: { digest },
        });
        if (
          options['external-owner'] === 'true' &&
          Object.keys(config.admins).some((msp) => msp !== binding.writerMspId)
        )
          throw new Error(
            'External-owner mode accepts only the platform admin; enterprise keys stay on its VPS',
          );
        const open1 = (c: Conn) =>
          client(
            c,
            binding.channelId,
            binding.chaincodeName,
            binding.contractName,
          );
        const controller = await open1(config.controller);
        const admins: Record<string, BindingLedgerClient> = {};
        for (const [msp, conn] of Object.entries(config.admins))
          admins[msp] = (await open1(conn)).client;
        const relayer = await open1(config.relayer);
        const reader = await open1(config.reader);
        const steps = await onboardBindingOnLedger({
          operator:
            options['external-owner'] === 'true'
              ? new ExternalOwnerRegistryOperator(
                  controller.client,
                  admins,
                  binding,
                )
              : new RegistryOperator(controller.client, admins),
          reader: reader.client,
          channelId: binding.channelId,
          approvers: Object.keys(config.admins),
          binding: {
            digest,
            network: binding.network,
            chaincodeName: binding.chaincodeName,
            contractName: binding.contractName,
            chainRef: binding.chainRef,
            writerAuthority: binding.writerAuthority,
            writerMspId: binding.writerMspId,
            governanceDigest: binding.governanceDigest,
          },
          relayerFingerprint: relayer.fingerprint,
        });
        await prisma.$transaction((tx) =>
          mirrorCredential(tx, digest, relayer.fingerprint),
        );
        console.log(
          JSON.stringify(
            { digest, steps, relayerFingerprint: relayer.fingerprint },
            null,
            2,
          ),
        );
        break;
      }
      case 'register-signing-key': {
        // The owner MSP admin approves too (SIGNING_KEY_REGISTER needs writer
        // and owner). External mode waits for approval from the owner's VPS.
        const keyRef = need(options, 'key');
        const config = JSON.parse(
          readFileSync(need(options, 'config'), 'utf8'),
        ) as {
          controller: Conn;
          reader: Conn;
          admins: Record<string, Conn>;
        };
        const key = await prisma.signingKey.findUniqueOrThrow({
          where: { keyRef },
          include: { binding: true },
        });
        if (key.status === 'REVOKED') throw new Error('The key is revoked');
        if (
          options['external-owner'] === 'true' &&
          Object.keys(config.admins).some(
            (msp) => msp !== key.binding.writerMspId,
          )
        )
          throw new Error(
            'External-owner mode accepts only the platform admin',
          );
        const open1 = (c: Conn) =>
          client(
            c,
            key.binding.channelId,
            key.binding.chaincodeName,
            key.binding.contractName,
          );
        const controller = await open1(config.controller);
        const admins: Record<string, BindingLedgerClient> = {};
        for (const [msp, conn] of Object.entries(config.admins))
          admins[msp] = (await open1(conn)).client;
        const reader = await open1(config.reader);
        const ledger = await registerSigningKeyOnLedger({
          operator:
            options['external-owner'] === 'true'
              ? new ExternalOwnerRegistryOperator(
                  controller.client,
                  admins,
                  key.binding,
                )
              : new RegistryOperator(controller.client, admins),
          reader: reader.client,
          approvers: Object.keys(config.admins),
          key,
        });
        const activated = await activateSigningKey(prisma, keyRef);
        console.log(
          JSON.stringify({ keyRef, ...ledger, ...activated }, null, 2),
        );
        break;
      }
      case 'set-handover-mode': {
        const profile = await setHandoverMode(
          prisma,
          need(options, 'chain'),
          need(options, 'mode') as HandoverMode,
        );
        console.log(
          JSON.stringify({
            chainId: profile.chainId,
            handoverMode: profile.handoverMode,
            version: profile.version,
          }),
        );
        break;
      }
      case 'activate':
        console.log(
          JSON.stringify(
            await prisma.$transaction((tx) =>
              activateBinding(tx, need(options, 'binding')),
            ),
            null,
            2,
          ),
        );
        break;
      case 'pause':
      case 'resume':
        console.log(
          JSON.stringify(
            await prisma.$transaction((tx) =>
              setBindingPaused(
                tx,
                need(options, 'binding'),
                command === 'pause',
              ),
            ),
            null,
            2,
          ),
        );
        break;
      case 'resolve-hold': {
        const hold = await prisma.deliveryHold.update({
          where: { id: need(options, 'hold') },
          data: {
            resolvedAt: new Date(),
            resolution: need(options, 'resolution'),
          },
        });
        console.log(
          JSON.stringify({ hold: hold.id, resolvedAt: hold.resolvedAt }),
        );
        break;
      }
      case 'status': {
        const bindings = await prisma.fabricNetworkBinding.findMany({
          where: options.chain ? { chainId: options.chain } : {},
          include: { state: true },
        });
        const report = [];
        for (const binding of bindings) {
          const [permissions, outbox, holds, jobs, oldest, observation] =
            await Promise.all([
              prisma.ledgerPermissionSync.groupBy({
                by: ['state'],
                where: { permission: { bindingDigest: binding.digest } },
                _count: true,
              }),
              prisma.blockchainOutbox.groupBy({
                by: ['status'],
                where: {
                  traceEvent: {
                    ledgerRoute: {
                      definition: { bindingDigest: binding.digest },
                    },
                  },
                },
                _count: true,
              }),
              prisma.deliveryHold.count({
                where: { bindingDigest: binding.digest, resolvedAt: null },
              }),
              prisma.ledgerControlJob.groupBy({
                by: ['status'],
                where: { bindingDigest: binding.digest },
                _count: true,
              }),
              prisma.blockchainOutbox.findFirst({
                where: {
                  status: { in: ['PENDING', 'RETRY', 'PROCESSING'] },
                  traceEvent: {
                    ledgerRoute: {
                      definition: { bindingDigest: binding.digest },
                    },
                  },
                },
                orderBy: { createdAt: 'asc' },
                select: { createdAt: true },
              }),
              prisma.bindingWorkerHealth.findUnique({
                where: { bindingDigest: binding.digest },
              }),
            ]);
          report.push({
            digest: binding.digest,
            chainId: binding.chainId,
            channel: binding.channelId,
            profile: binding.profile,
            status: binding.state?.status,
            permissions,
            outbox,
            openHolds: holds,
            controlJobs: jobs,
            oldestPendingAt: oldest?.createdAt ?? null,
            pendingAgeSeconds: oldest
              ? Math.max(
                  0,
                  Math.floor((Date.now() - oldest.createdAt.getTime()) / 1000),
                )
              : null,
            worker: bindingObservation(observation),
          });
        }
        console.log(JSON.stringify(report, null, 2));
        break;
      }
      default:
        throw new Error(
          'Usage: ledger-operator <register-binding|onboard|register-signing-key|set-handover-mode|activate|pause|resume|resolve-hold|status> [--option value ...]',
        );
    }
  } finally {
    for (const connection of open) connection.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  if (error instanceof AwaitingOwnerApproval) {
    console.log(
      JSON.stringify(
        { status: 'AWAITING_OWNER_APPROVAL', ...error.review },
        null,
        2,
      ),
    );
    process.exitCode = 2;
    return;
  }
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
