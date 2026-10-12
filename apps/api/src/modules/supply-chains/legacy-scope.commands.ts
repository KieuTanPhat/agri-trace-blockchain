import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type {
  AuthorizedCommand,
  CommandActor,
} from '../../common/idempotency/command-authorization.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import { lockChainScope } from './chain-policy.js';
import { inventoryLegacyScope } from './legacy-scope-inventory.js';
import { validateLegacyScopeManifest } from './legacy-scope-manifest.js';
import { planLegacyScopeAssignments } from './legacy-scope-plan.js';
import {
  requireLegacyScopePin,
  assertLegacyScopeProvenance,
  type LegacyScopePin,
} from './legacy-scope-pins.js';

export const LEGACY_SCOPE_OPERATIONS = [
  'SCOPE_REGISTER_LEGACY_MANIFEST',
  'SCOPE_CONFIRM_LEGACY_ASSIGNMENT',
  'SCOPE_APPLY_LEGACY_ROOT',
] as const;

export function legacyReviewKeys(pin: LegacyScopePin) {
  return Object.fromEntries(
    [
      ...new Set(
        pin.manifest.entries.flatMap((entry) =>
          entry.chainId ? [entry.chainId] : [],
        ),
      ),
    ]
      .sort()
      .map((chainId) => [
        canonicalSha256({
          schema: 'agritrace-legacy-owner-review-1',
          manifestDigest: pin.digest,
          planDigest: pin.plan.digest,
          chainId,
        }),
        chainId,
      ]),
  );
}

function assertStored(
  pin: LegacyScopePin,
  record: {
    digest: string;
    document: unknown;
    plan: unknown;
    reviewKeys: unknown;
  },
) {
  if (
    record.digest !== pin.digest ||
    canonicalSha256(record.document) !== pin.digest ||
    canonicalSha256(record.plan) !== canonicalSha256(pin.plan) ||
    canonicalSha256(record.reviewKeys) !==
      canonicalSha256(legacyReviewKeys(pin))
  )
    throw new ForbiddenException('Manifest legacy không khớp pin ngoài DB');
}

export async function lockLegacyScope(
  db: Prisma.TransactionClient,
  pin: LegacyScopePin,
  actor: CommandActor,
) {
  const consents = await db.legacyScopeConsent.findMany({
    where: { manifestId: pin.manifest.id },
  });
  const orgs = [
    ...new Set([
      ...pin.plan.proposals.map((p) => p.organizationId),
      ...pin.manifest.entries.map((entry) => entry.producerOrgId),
      ...(actor.organizationId ? [actor.organizationId] : []),
    ]),
  ].sort();
  const users = [
    ...new Set([
      actor.sub!,
      pin.manifest.reviewerId,
      ...consents.map((c) => c.userId),
    ]),
  ].sort();
  for (const org of orgs)
    await db.$queryRaw`SELECT organization_id FROM organization WHERE organization_id=${org}::uuid FOR SHARE`;
  for (const user of users)
    await db.$queryRaw`SELECT user_id FROM app_user WHERE user_id=${user}::uuid FOR SHARE`;
  for (const org of orgs) await lockChainScope(db, `org:${org}`);
  for (const chain of [
    ...new Set(pin.plan.proposals.map((p) => p.chainId)),
  ].sort()) {
    await lockChainScope(db, chain);
    await db.$queryRaw`SELECT chain_id FROM chain_business_profile WHERE chain_id=${chain}::uuid FOR SHARE`;
    await db.$queryRaw`SELECT membership_id FROM chain_membership WHERE chain_id=${chain}::uuid ORDER BY organization_id FOR SHARE`;
    await db.$queryRaw`SELECT grant_id FROM scoped_role_grant WHERE chain_id=${chain}::uuid OR user_id=${actor.sub}::uuid OR user_id IN(SELECT user_id FROM legacy_scope_consent WHERE manifest_id=${pin.manifest.id}::uuid) ORDER BY grant_id FOR SHARE`;
  }
  for (const org of orgs)
    await db.$queryRaw`SELECT organization_id FROM organization_capability WHERE organization_id=${org}::uuid ORDER BY code FOR SHARE`;
}

/** Authentication/session is performed by authorizeCommand before this policy.
 * The manifest ID selects an independently pinned artifact; clients cannot
 * submit their own digest, party, mapping or authority snapshot. */
export async function authorizeLegacyScopeCommand(
  db: Prisma.TransactionClient,
  input: AuthorizedCommand,
  lock = false,
) {
  const data = input.payload as {
    manifestId: string;
    proposalKey?: string;
    cycleId?: string;
  };
  const actor = input.actor!;
  const pin = requireLegacyScopePin(data.manifestId);
  if (!actor.sub) throw new ForbiddenException('Legacy cutover cần xác thực');
  if (lock) await lockLegacyScope(db, pin, actor);
  const record = await db.legacyScopeManifestRecord.findUnique({
    where: { id: pin.manifest.id },
  });
  if (record) assertStored(pin, record);
  else if (input.operation !== 'SCOPE_REGISTER_LEGACY_MANIFEST')
    throw new NotFoundException('Manifest chưa đăng ký');
  const base = {
    protocol: 'legacy-scope-command-v1',
    manifestDigest: pin.digest,
    planDigest: pin.plan.digest,
    actor: actor.sub,
    operation: input.operation,
  };
  if (input.operation !== 'SCOPE_CONFIRM_LEGACY_ASSIGNMENT') {
    if (actor.role !== 'SYSTEM_ADMIN' || actor.sub !== pin.manifest.operatorId)
      throw new ForbiddenException(
        'Chỉ operator đã review được thực hiện cutover',
      );
    if (process.env.HYBRID_LEGACY_APPLY_ENABLED !== '1')
      throw new ForbiddenException('Controlled legacy apply chưa được bật');
    if (input.operation === 'SCOPE_APPLY_LEGACY_ROOT') {
      const entry = pin.manifest.entries.find(
        (item) => item.cycleId === data.cycleId,
      );
      if (!entry) throw new NotFoundException('Root ngoài manifest');
      const previous = await db.legacyScopeMapping.findUnique({
        where: { cycleId: entry.cycleId },
      });
      if (previous) {
        if (previous.manifestId !== pin.manifest.id)
          throw new ConflictException('Root đã có provenance khác');
        await assertLegacyScopeProvenance(db, entry.cycleId);
      } else if (entry.chainId) {
        const profile = await db.chainBusinessProfile.findUnique({
          where: { chainId: entry.chainId },
        });
        if (profile?.state !== 'PREPARING')
          throw new ConflictException('Target cần PREPARING');
      }
    }
    return canonicalSha256(base);
  }
  if (!actor.organizationId || actor.role === 'SYSTEM_ADMIN')
    throw new ForbiddenException('Operator không xác nhận thay đối tác');
  const reviewChain = legacyReviewKeys(pin)[data.proposalKey ?? ''];
  const proposal = pin.plan.proposals.find((p) => p.key === data.proposalKey);
  const chainId = reviewChain ?? proposal?.chainId;
  if (
    !chainId ||
    (!reviewChain && proposal?.organizationId !== actor.organizationId) ||
    (reviewChain && actor.sub !== pin.manifest.reviewerId)
  )
    throw new ForbiddenException('Sai bên hoặc proposal');
  const [profile, membership, permission] = await Promise.all([
    db.chainBusinessProfile.findUnique({
      where: { chainId },
      include: { chain: true },
    }),
    db.chainMembership.findUnique({
      where: {
        chainId_organizationId: {
          chainId,
          organizationId: actor.organizationId,
        },
      },
    }),
    db.scopedRoleGrant.findFirst({
      where: {
        userId: actor.sub,
        organizationId: actor.organizationId,
        chainId: reviewChain ? chainId : null,
        scope: reviewChain ? 'CHAIN' : 'ORGANIZATION',
        role: reviewChain ? 'CHAIN_MANAGER' : 'ORG_ADMIN',
        revokedAt: null,
      },
    }),
  ]);
  if (
    !profile ||
    profile.state !== 'PREPARING' ||
    membership?.status !== 'ACTIVE' ||
    !permission ||
    (reviewChain && profile.chain.ownerOrganizationId !== actor.organizationId)
  )
    throw new ForbiddenException('Quyền xác nhận legacy không còn hiệu lực');
  const code =
    proposal?.stage === 'PRODUCTION'
      ? 'FARM'
      : proposal?.stage === 'TRANSPORT'
        ? 'TRANSPORTER'
        : 'RETAILER';
  const capability = reviewChain
    ? null
    : await db.organizationCapability.findUnique({
        where: {
          organizationId_code: { organizationId: actor.organizationId, code },
        },
      });
  if (!reviewChain && (!capability || capability.revokedAt))
    throw new ForbiddenException('Thiếu capability của bên nhận');
  if (lock)
    await db.$queryRaw`SELECT grant_id FROM scoped_role_grant WHERE grant_id=${permission.id}::uuid FOR SHARE`;
  return canonicalSha256({
    ...base,
    proposalKey: data.proposalKey,
    grant: { id: permission.id, revision: permission.revision },
    membership: { id: membership.id, version: membership.version },
    capability: capability?.revision ?? null,
  });
}

/** Short maintenance snapshot. SHARE ROW EXCLUSIVE blocks concurrent writers
 * including Worker state changes while each root is checked and committed.
 * Locks do not stand in for the external operational pause/rehearsal gate. */
async function lockLegacySnapshot(db: Prisma.TransactionClient) {
  await db.$executeRawUnsafe(`LOCK TABLE production_cycle, care_record, harvest_event, lot, shipment,
    sensor_reading, sensor_digest, iot_device, harvest_sensor_window, harvest_sensor_membership,
    late_sensor_reading, cycle_sensor_reconciliation, certificate, inspection, quantity_movement,
    shipment_tracking_binding, shipment_telemetry, shipment_telemetry_digest, trace_qr,
    trace_event, blockchain_outbox, blockchain_proof IN SHARE ROW EXCLUSIVE MODE`);
}

export async function registerLegacyScopeManifest(
  db: Prisma.TransactionClient,
  actor: CommandActor,
  manifestId: string,
) {
  await authorizeLegacyScopeCommand(
    db,
    {
      actor,
      requesterId: actor.sub!,
      operation: LEGACY_SCOPE_OPERATIONS[0],
      payload: { manifestId },
    },
    true,
  );
  const pin = requireLegacyScopePin(manifestId);
  const existing = await db.legacyScopeManifestRecord.findUnique({
    where: { id: manifestId },
  });
  if (existing) {
    assertStored(pin, existing);
    return { manifestId, digest: pin.digest };
  }
  await lockLegacySnapshot(db);
  const inventory = await inventoryLegacyScope(db);
  validateLegacyScopeManifest(pin.manifest, inventory, pin.digest, {
    environment: pin.manifest.environment,
    sourceSha: pin.manifest.sourceSha,
  });
  const plan = await planLegacyScopeAssignments(
    db,
    pin.manifest,
    inventory,
    pin.digest,
    {
      environment: pin.manifest.environment,
      sourceSha: pin.manifest.sourceSha,
    },
  );
  if (canonicalSha256(plan) !== canonicalSha256(pin.plan))
    throw new ConflictException('Assignment plan không khớp pin đã review');
  await db.legacyScopeManifestRecord.create({
    data: {
      id: manifestId,
      digest: pin.digest,
      document: pin.manifest as unknown as Prisma.InputJsonValue,
      inventory: inventory as unknown as Prisma.InputJsonValue,
      plan: plan as unknown as Prisma.InputJsonValue,
      reviewKeys: legacyReviewKeys(pin),
    },
  });
  return { manifestId, digest: pin.digest };
}

export async function confirmLegacyScopeProposal(
  db: Prisma.TransactionClient,
  actor: CommandActor,
  manifestId: string,
  proposalKey: string,
) {
  await authorizeLegacyScopeCommand(
    db,
    {
      actor,
      requesterId: actor.sub!,
      operation: LEGACY_SCOPE_OPERATIONS[1],
      payload: { manifestId, proposalKey },
    },
    true,
  );
  const pin = requireLegacyScopePin(manifestId);
  const chainId = legacyReviewKeys(pin)[proposalKey];
  const grant = await db.scopedRoleGrant.findFirstOrThrow({
    where: {
      userId: actor.sub!,
      organizationId: actor.organizationId!,
      chainId: chainId ?? null,
      role: chainId ? 'CHAIN_MANAGER' : 'ORG_ADMIN',
      scope: chainId ? 'CHAIN' : 'ORGANIZATION',
      revokedAt: null,
    },
  });
  const previous = await db.legacyScopeConsent.findUnique({
    where: { manifestId_proposalKey: { manifestId, proposalKey } },
  });
  if (previous) {
    if (
      previous.userId !== actor.sub ||
      previous.grantId !== grant.id ||
      previous.grantRevision !== grant.revision
    )
      throw new ConflictException(
        'Xác nhận đã có; cần manifest/review mới khi đổi grant',
      );
    return { manifestId, proposalKey, accepted: true };
  }
  await db.legacyScopeConsent.create({
    data: {
      manifestId,
      proposalKey,
      userId: actor.sub!,
      organizationId: actor.organizationId!,
      grantId: grant.id,
      grantRevision: grant.revision,
    },
  });
  return { manifestId, proposalKey, accepted: true };
}

export async function applyLegacyScopeRoot(
  db: Prisma.TransactionClient,
  actor: CommandActor,
  manifestId: string,
  cycleId: string,
) {
  await authorizeLegacyScopeCommand(
    db,
    {
      actor,
      requesterId: actor.sub!,
      operation: LEGACY_SCOPE_OPERATIONS[2],
      payload: { manifestId, cycleId },
    },
    true,
  );
  const pin = requireLegacyScopePin(manifestId);
  const previous = await db.legacyScopeMapping.findUnique({
    where: { cycleId },
  });
  if (previous)
    return {
      manifestId,
      cycleId,
      checkpointDigest: previous.checkpointDigest,
      applied: true,
    };
  await lockLegacySnapshot(db);
  const entry = pin.manifest.entries.find((item) => item.cycleId === cycleId)!;
  const inventory = await inventoryLegacyScope(db, { cycleIds: [cycleId] });
  if (
    inventory.roots.length !== 1 ||
    inventory.roots[0].inventoryDigest !== entry.inventoryDigest
  )
    throw new ConflictException('Root inventory đã đổi; cần review/pin mới');
  const proposals = pin.plan.proposals.filter((p) => p.cycleId === cycleId);
  const grants = entry.chainId
    ? await db.scopedRoleGrant.findMany({
        where: {
          chainId: entry.chainId,
          scope: 'CHAIN',
          revokedAt: null,
          OR: proposals.map((p) => ({
            organizationId: p.organizationId,
            role:
              p.stage === 'PRODUCTION'
                ? 'FARM_STAFF'
                : p.stage === 'TRANSPORT'
                  ? 'TRANSPORTER'
                  : 'RETAILER',
          })),
          user: {
            accountStatus: 'ACTIVE',
            role: { code: { not: 'SYSTEM_ADMIN' } },
          },
        },
        orderBy: { id: 'asc' },
      })
    : [];
  for (const proposal of proposals) {
    const role =
      proposal.stage === 'PRODUCTION'
        ? 'FARM_STAFF'
        : proposal.stage === 'TRANSPORT'
          ? 'TRANSPORTER'
          : 'RETAILER';
    if (
      !grants.some(
        (g) => g.organizationId === proposal.organizationId && g.role === role,
      )
    )
      throw new ConflictException('Actor grant không còn sẵn sàng');
  }
  const actorGrants = grants.map((g) => ({
    userId: g.userId,
    organizationId: g.organizationId,
    role: g.role,
    grantId: g.id,
    grantRevision: g.revision,
  }));
  const checkpointDigest = canonicalSha256({
    schema: 'agritrace-legacy-checkpoint-1',
    manifestDigest: pin.digest,
    entry,
    proposalKeys: proposals.map((p) => p.key),
    actorGrants,
  });
  // Preserve PostgreSQL's microsecond timestamp without a lossy JS Date round
  // trip. The mapping trigger compares this exact value to the locked root.
  await db.$executeRaw`INSERT INTO legacy_scope_mapping(cycle_id,manifest_id,chain_id,checkpoint_digest,actor_grants,original_updated_at)
    SELECT cycle_id,${manifestId}::uuid,${entry.chainId}::uuid,${checkpointDigest},${JSON.stringify(actorGrants)}::jsonb,updated_at
    FROM production_cycle WHERE cycle_id=${cycleId}::uuid`;
  if (entry.chainId) {
    await db.productionCycle.update({
      where: { id: cycleId },
      data: { chainId: entry.chainId },
    });
    for (const p of proposals)
      await db.stageAssignment.create({
        data: {
          chainId: p.chainId,
          organizationId: p.organizationId,
          stage: p.stage,
          status: 'ACCEPTED',
          ...(p.subject.kind === 'cycle'
            ? { cycleId: p.subject.id }
            : p.subject.kind === 'lot'
              ? { lotId: p.subject.id }
              : { shipmentId: p.subject.id }),
        },
      });
    const lots = await db.lot.findMany({
      where: { harvest: { cycleId } },
      select: { id: true },
    });
    const events = await db.traceEvent.findMany({
      where: { OR: [{ cycleId }, { lotId: { in: lots.map((l) => l.id) } }] },
      select: { id: true },
    });
    for (const event of events)
      await db.eventChainContext.create({
        data: { eventId: event.id, chainId: entry.chainId },
      });
  }
  for (const organizationId of new Set([
    entry.producerOrgId,
    ...proposals.map((p) => p.organizationId),
  ]))
    await db.organizationBusinessScope.upsert({
      where: { organizationId },
      create: { organizationId },
      update: {},
    });
  const after = await inventoryLegacyScope(db, { cycleIds: [cycleId] });
  if (after.roots[0]?.inventoryDigest !== entry.inventoryDigest)
    throw new ConflictException('Backfill đã làm đổi lịch sử nghiệp vụ');
  return { manifestId, cycleId, checkpointDigest, applied: true };
}
