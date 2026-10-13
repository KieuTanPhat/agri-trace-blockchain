/**
 * Platform-operator CLI for release-B ledger bindings. Not an HTTP surface:
 * it names networks, channels and MSPs and may use admin identities, which
 * business users and the API must never hold.
 *
 *   npx tsx scripts/ledger-operator.ts register-binding --chain <uuid> \
 *     --network <name> --channel <id> --writer-authority <id> --writer-msp <MSP> \
 *     --governance-digest <sha256> --profile SERVICE|MANAGED_ORG|SELF_MANAGED_ORG
 *   npx tsx scripts/ledger-operator.ts onboard --binding <digest> --config operator.json
 *   npx tsx scripts/ledger-operator.ts activate --binding <digest>
 *   npx tsx scripts/ledger-operator.ts pause|resume --binding <digest>
 *   npx tsx scripts/ledger-operator.ts resolve-hold --hold <uuid> --resolution "<text>"
 *   npx tsx scripts/ledger-operator.ts status [--chain <uuid>]
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
  type LedgerProfile,
} from '../src/generated/prisma/client.js';
import {
  activateBinding,
  registerBinding,
  setBindingPaused,
} from '../src/modules/ledger/ledger-bindings.js';
import {
  mirrorCredential,
  onboardBindingOnLedger,
} from '../src/modules/ledger/ledger-onboarding.js';

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
          operator: new RegistryOperator(controller.client, admins),
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
          const [permissions, outbox, holds, jobs] = await Promise.all([
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
          });
        }
        console.log(JSON.stringify(report, null, 2));
        break;
      }
      default:
        throw new Error(
          'Usage: ledger-operator <register-binding|onboard|activate|pause|resume|resolve-hold|status> [--option value ...]',
        );
    }
  } finally {
    for (const connection of open) connection.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
