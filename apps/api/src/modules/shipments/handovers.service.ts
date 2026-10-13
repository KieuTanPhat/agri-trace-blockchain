import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type ShipmentHandover,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  commandTransaction,
  effectiveCommandActor,
  lockAggregate,
} from '../../common/idempotency/command-transaction.js';
import { assertQuantityReconciled } from '../../common/quantity.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import { authorizeBusinessCommand } from '../supply-chains/business-policy.js';
import {
  consumeSigningIntent,
  prepareSigningIntent,
  resolveSigningKey,
  viewOf,
  DEFAULT_SIGNING_WINDOW_MINUTES,
  type PreparedIntentView,
} from '../signing/signing-intents.js';
import { TraceService, type Actor } from '../trace/trace.service.js';
import { ShipmentsService } from './shipments.service.js';
import type {
  CancelHandoverDto,
  PrepareHandoverOfferDto,
  RejectHandoverDto,
} from './handovers.dto.js';
import type {
  PrepareIntentOptionsDto,
  SubmitSignatureDto,
} from '../signing/dto.js';

const DEFAULT_OFFER_VALID_MINUTES = 24 * 60;
type Kind = 'PICKUP' | 'ARRIVAL';
type Db = Prisma.TransactionClient;

const giverRole = (kind: Kind) =>
  kind === 'PICKUP' ? ('FARM_STAFF' as const) : ('TRANSPORTER' as const);
const receiverRole = (kind: Kind) =>
  kind === 'PICKUP' ? ('TRANSPORTER' as const) : ('RETAILER' as const);

export function handoverView(h: ShipmentHandover) {
  return {
    id: h.id,
    shipmentId: h.shipmentId,
    chainId: h.chainId,
    kind: h.kind,
    state: h.state,
    giverOrgId: h.giverOrgId,
    receiverOrgId: h.receiverOrgId,
    custodyLabel: h.custodyLabel,
    quantity: h.quantity.toFixed(3),
    unit: h.unit,
    shipmentVersion: h.shipmentVersion,
    lotVersion: h.lotVersion,
    note: h.note,
    reason: h.reason,
    offerEventId: h.offerEventId,
    resolveEventId: h.resolveEventId,
    offeredAt: h.offeredAt,
    expiresAt: h.expiresAt,
    resolvedAt: h.resolvedAt,
  };
}

/** Two-party custody handover (release C). An offer is signed by the giver's
 * organization key; custody moves only when the receiver's organization
 * confirms that exact offer with its own signature. Reject, cancel and expiry
 * never change custody, and a stale shipment or lot version voids the offer. */
@Injectable()
export class HandoversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
    private readonly trace: TraceService,
    private readonly shipments: ShipmentsService,
  ) {}

  async list(shipmentId: string, actor: Actor) {
    await this.access.assertShipmentAccess(actor, shipmentId);
    await this.expireDue(shipmentId);
    const rows = await this.prisma.shipmentHandover.findMany({
      where: { shipmentId },
      orderBy: { offeredAt: 'desc' },
    });
    return rows.map(handoverView);
  }

  async prepareOffer(
    shipmentId: string,
    input: PrepareHandoverOfferDto,
    actor: Actor,
  ): Promise<PreparedIntentView> {
    await this.expireDue(shipmentId);
    const c = await this.context(this.prisma, shipmentId);
    await authorizeBusinessCommand(this.prisma, actor, {
      chainId: c.chainId,
      role: giverRole(input.kind),
      subject: { kind: 'shipment', id: shipmentId },
    });
    this.assertOfferable(c, input.kind, actor.organizationId);
    if (
      await this.prisma.shipmentHandover.findFirst({
        where: { shipmentId, state: 'OFFERED' },
      })
    )
      throw new ConflictException('Chuyến hàng đang có đề nghị bàn giao mở');
    const receiverOrgId =
      input.kind === 'PICKUP'
        ? c.shipment.transporterOrgId
        : c.shipment.retailerOrgId;
    const offerExpiresAt = new Date(
      Date.now() +
        (input.offerValidMinutes ?? DEFAULT_OFFER_VALID_MINUTES) * 60_000,
    );
    const payload = {
      handoverId: randomUUID(),
      kind: input.kind,
      shipmentId,
      lotId: c.lot.id,
      giverOrgId: actor.organizationId!,
      receiverOrgId,
      quantity: c.lot.availableQuantity.toFixed(3),
      unit: c.lot.unit,
      shipmentVersion: String(c.shipment.version),
      lotVersion: String(c.lot.version),
      offerExpiresAt: offerExpiresAt.toISOString(),
      note: input.note ?? '',
    };
    return this.prisma.$transaction(async (tx) => {
      const key = await resolveSigningKey(
        tx,
        c.binding.digest,
        actor.organizationId!,
        input.keyRef,
      );
      return prepareSigningIntent(tx, {
        chainId: c.chainId,
        chainRef: c.binding.chainRef,
        bindingDigest: c.binding.digest,
        organizationId: actor.organizationId!,
        userId: actor.sub!,
        key,
        operation: 'HANDOVER_OFFER',
        entityType: 'SHIPMENT',
        entityId: shipmentId,
        expectedVersion: c.shipment.version,
        payload,
        windowMinutes:
          input.signingWindowMinutes ?? DEFAULT_SIGNING_WINDOW_MINUTES,
      });
    });
  }

  async prepareConfirm(
    handoverId: string,
    input: PrepareIntentOptionsDto,
    actor: Actor,
  ): Promise<PreparedIntentView> {
    const known = await this.prisma.shipmentHandover.findUnique({
      where: { id: handoverId },
    });
    if (!known) throw new NotFoundException('Không tìm thấy bàn giao');
    await this.expireDue(known.shipmentId);
    const h = await this.prisma.shipmentHandover.findUniqueOrThrow({
      where: { id: handoverId },
      include: { offerIntent: true },
    });
    const c = await this.context(this.prisma, h.shipmentId);
    await authorizeBusinessCommand(this.prisma, actor, {
      chainId: c.chainId,
      role: receiverRole(h.kind),
      subject: { kind: 'shipment', id: h.shipmentId },
    });
    if (actor.organizationId !== h.receiverOrgId)
      throw new ForbiddenException('Chỉ bên nhận được xác nhận bàn giao');
    if (h.state !== 'OFFERED')
      throw new ConflictException('Đề nghị bàn giao không còn mở');
    this.assertUnchanged(h, c);
    const payload = {
      handoverId: h.id,
      kind: h.kind,
      shipmentId: h.shipmentId,
      giverOrgId: h.giverOrgId,
      receiverOrgId: h.receiverOrgId,
      offerIntentDigest: h.offerIntent.intentDigest,
      offerEventId: h.offerEventId,
      quantity: h.quantity.toFixed(3),
      unit: h.unit,
      shipmentVersion: String(h.shipmentVersion),
      lotVersion: String(h.lotVersion),
    };
    return this.prisma.$transaction(async (tx) => {
      const key = await resolveSigningKey(
        tx,
        c.binding.digest,
        actor.organizationId!,
        input.keyRef,
      );
      return prepareSigningIntent(tx, {
        chainId: c.chainId,
        chainRef: c.binding.chainRef,
        bindingDigest: c.binding.digest,
        organizationId: actor.organizationId!,
        userId: actor.sub!,
        key,
        operation: 'HANDOVER_CONFIRM',
        entityType: 'SHIPMENT',
        entityId: h.shipmentId,
        expectedVersion: h.shipmentVersion,
        payload,
        windowMinutes:
          input.signingWindowMinutes ?? DEFAULT_SIGNING_WINDOW_MINUTES,
      });
    });
  }

  async getIntent(intentId: string, actor: Actor): Promise<PreparedIntentView> {
    const intent = await this.prisma.signingIntent.findUnique({
      where: { id: intentId },
    });
    if (
      !intent ||
      intent.createdBy !== actor.sub ||
      intent.organizationId !== actor.organizationId
    )
      throw new NotFoundException('Không tìm thấy yêu cầu ký');
    return viewOf(intent);
  }

  /** Verifies the signature and applies the signed command in one commit. */
  async submit(intentId: string, input: SubmitSignatureDto, actor: Actor) {
    actor = effectiveCommandActor(actor);
    const pre = await this.prisma.signingIntent.findUnique({
      where: { id: intentId },
    });
    if (!pre) throw new NotFoundException('Không tìm thấy yêu cầu ký');
    await this.expireDue(pre.entityId);
    return commandTransaction(this.prisma, async (tx) => {
      const c = await this.context(tx, pre.entityId);
      await lockAggregate(tx, 'lot', c.lot.id);
      const intent = await consumeSigningIntent(
        tx,
        intentId,
        actor,
        input.signature,
      );
      const result =
        intent.operation === 'HANDOVER_OFFER'
          ? await this.applyOffer(tx, intent, actor)
          : await this.applyConfirm(tx, intent, actor);
      return handoverView(result);
    });
  }

  async reject(handoverId: string, input: RejectHandoverDto, actor: Actor) {
    return this.resolve(handoverId, 'REJECTED', input.reason, actor);
  }

  async cancel(handoverId: string, input: CancelHandoverDto, actor: Actor) {
    return this.resolve(handoverId, 'CANCELLED', input.reason ?? null, actor);
  }

  /** Marks overdue offers EXPIRED. Nothing moves: shipment and lot keep the
   * state they had, and the offer's signature can never be used again. */
  async expireDue(shipmentId?: string): Promise<number> {
    const due = await this.prisma.shipmentHandover.findMany({
      where: {
        state: 'OFFERED',
        expiresAt: { lte: new Date() },
        ...(shipmentId ? { shipmentId } : {}),
      },
      select: { id: true },
    });
    for (const { id } of due)
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT handover_id FROM shipment_handover WHERE handover_id = ${id}::uuid FOR UPDATE`,
        );
        const row = await tx.shipmentHandover.findUnique({ where: { id } });
        if (!row || row.state !== 'OFFERED' || row.expiresAt > new Date())
          return;
        await tx.shipmentHandover.update({
          where: { id },
          data: {
            state: 'EXPIRED',
            resolvedAt: new Date(),
            reason: 'Hết hạn chờ xác nhận',
            version: { increment: 1 },
          },
        });
      });
    return due.length;
  }

  private async resolve(
    handoverId: string,
    state: 'REJECTED' | 'CANCELLED',
    reason: string | null,
    actor: Actor,
  ) {
    actor = effectiveCommandActor(actor);
    const known = await this.prisma.shipmentHandover.findUnique({
      where: { id: handoverId },
    });
    if (!known) throw new NotFoundException('Không tìm thấy bàn giao');
    await this.expireDue(known.shipmentId);
    return commandTransaction(this.prisma, async (tx) => {
      const c = await this.context(tx, known.shipmentId);
      await lockAggregate(tx, 'lot', c.lot.id);
      await tx.$queryRaw(
        Prisma.sql`SELECT handover_id FROM shipment_handover WHERE handover_id = ${handoverId}::uuid FOR UPDATE`,
      );
      const h = await tx.shipmentHandover.findUniqueOrThrow({
        where: { id: handoverId },
      });
      if (h.state !== 'OFFERED')
        throw new ConflictException('Đề nghị bàn giao không còn mở');
      const party = state === 'REJECTED' ? h.receiverOrgId : h.giverOrgId;
      if (actor.organizationId !== party)
        throw new ForbiddenException(
          state === 'REJECTED'
            ? 'Chỉ bên nhận được từ chối'
            : 'Chỉ bên giao được hủy đề nghị',
        );
      const event = await this.trace.createInTransaction(tx, {
        entityType: 'SHIPMENT',
        entityId: h.shipmentId,
        lotId: c.lot.id,
        eventType:
          state === 'REJECTED' ? 'HANDOVER_REJECTED' : 'HANDOVER_CANCELLED',
        actor,
        businessData: {
          handoverId: h.id,
          kind: h.kind,
          reason,
          quantity: h.quantity.toFixed(3),
          unit: h.unit,
          shipmentVersion: h.shipmentVersion,
        },
      });
      const updated = await tx.shipmentHandover.update({
        where: { id: h.id },
        data: {
          state,
          reason,
          resolvedAt: new Date(),
          resolvedBy: actor.sub!,
          resolveEventId: event.id,
          version: { increment: 1 },
        },
      });
      return handoverView(updated);
    });
  }

  private async applyOffer(
    tx: Db,
    intent: Prisma.SigningIntentGetPayload<object>,
    actor: Actor,
  ) {
    const payload = intent.payload as Record<string, string>;
    const c = await this.context(tx, intent.entityId);
    const kind = payload.kind as Kind;
    this.assertOfferable(c, kind, actor.organizationId);
    if (
      c.binding.digest !== intent.bindingDigest ||
      c.shipment.version !== intent.expectedVersion ||
      String(c.lot.version) !== payload.lotVersion ||
      c.lot.availableQuantity.toFixed(3) !== payload.quantity ||
      payload.giverOrgId !== actor.organizationId
    )
      throw new ConflictException(
        'Chuyến hàng hoặc lô đã thay đổi sau khi chuẩn bị đề nghị',
      );
    await assertQuantityReconciled(tx, c.lot);
    if (
      await tx.shipmentHandover.findFirst({
        where: { shipmentId: c.shipment.id, state: 'OFFERED' },
      })
    )
      throw new ConflictException('Chuyến hàng đang có đề nghị bàn giao mở');
    const event = await this.trace.createInTransaction(tx, {
      eventId: intent.eventId,
      entityType: 'SHIPMENT',
      entityId: c.shipment.id,
      lotId: c.lot.id,
      eventType: 'HANDOVER_OFFERED',
      actor,
      businessData: { ...payload },
      signature: { intentId: intent.id },
    });
    return tx.shipmentHandover.create({
      data: {
        id: payload.handoverId,
        shipmentId: c.shipment.id,
        chainId: c.chainId,
        kind,
        giverOrgId: payload.giverOrgId,
        receiverOrgId: payload.receiverOrgId,
        custodyLabel:
          payload.giverOrgId === payload.receiverOrgId
            ? 'INTERNAL_SAME_ORG'
            : 'CROSS_ORG',
        quantity: payload.quantity,
        unit: payload.unit,
        shipmentVersion: c.shipment.version,
        lotVersion: c.lot.version,
        offerIntentId: intent.id,
        offerEventId: event.id,
        offeredBy: actor.sub!,
        note: payload.note || null,
        expiresAt: new Date(payload.offerExpiresAt),
      },
    });
  }

  private async applyConfirm(
    tx: Db,
    intent: Prisma.SigningIntentGetPayload<object>,
    actor: Actor,
  ) {
    const payload = intent.payload as Record<string, string>;
    await tx.$queryRaw(
      Prisma.sql`SELECT handover_id FROM shipment_handover WHERE handover_id = ${payload.handoverId}::uuid FOR UPDATE`,
    );
    const h = await tx.shipmentHandover.findUnique({
      where: { id: payload.handoverId },
      include: { offerIntent: true },
    });
    if (!h || h.shipmentId !== intent.entityId)
      throw new NotFoundException('Không tìm thấy bàn giao');
    if (h.state !== 'OFFERED')
      throw new ConflictException('Đề nghị bàn giao không còn mở');
    if (h.expiresAt.getTime() <= Date.now())
      throw new ConflictException('Đề nghị bàn giao đã hết hạn');
    if (actor.organizationId !== h.receiverOrgId)
      throw new ForbiddenException('Chỉ bên nhận được xác nhận bàn giao');
    const c = await this.context(tx, h.shipmentId);
    if (
      payload.offerIntentDigest !== h.offerIntent.intentDigest ||
      payload.offerEventId !== h.offerEventId ||
      payload.quantity !== h.quantity.toFixed(3) ||
      payload.shipmentVersion !== String(h.shipmentVersion) ||
      payload.lotVersion !== String(h.lotVersion) ||
      intent.expectedVersion !== h.shipmentVersion
    )
      throw new ConflictException('Xác nhận không khớp đề nghị đã ký');
    this.assertUnchanged(h, c);
    const event = await this.trace.createInTransaction(tx, {
      eventId: intent.eventId,
      entityType: 'SHIPMENT',
      entityId: h.shipmentId,
      lotId: c.lot.id,
      eventType: 'HANDOVER_CONFIRMED',
      actor,
      businessData: { ...payload },
      signature: { intentId: intent.id },
    });
    const confirmed = await tx.shipmentHandover.update({
      where: { id: h.id },
      data: {
        state: 'CONFIRMED',
        confirmIntentId: intent.id,
        resolveEventId: event.id,
        resolvedBy: actor.sub!,
        resolvedAt: new Date(),
        version: { increment: 1 },
      },
    });
    // The custody transition itself: only now do shipment and lot move.
    await this.shipments.applyHandoverTransition(tx, {
      shipmentId: h.shipmentId,
      kind: h.kind,
      actor,
      shipmentVersion: h.shipmentVersion,
      lotVersion: h.lotVersion,
      handoverId: h.id,
      confirmEventId: event.id,
    });
    return confirmed;
  }

  private async context(db: Db, shipmentId: string) {
    const shipment = await db.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        lot: {
          include: {
            harvest: {
              select: { cycle: { select: { id: true, chainId: true } } },
            },
          },
        },
      },
    });
    if (!shipment)
      throw new NotFoundException('Không tìm thấy chuyến vận chuyển');
    const cycle = shipment.lot.harvest.cycle;
    if (!cycle.chainId)
      throw new ConflictException('Chuyến hàng không thuộc chuỗi cung ứng');
    const origin = await db.cycleLedgerContext.findUnique({
      where: { cycleId: cycle.id },
      include: { binding: { include: { state: true } } },
    });
    if (!origin || origin.binding.state?.status !== 'ACTIVE')
      throw new ConflictException(
        'Binding ledger của chuyến hàng chưa hoạt động',
      );
    return {
      shipment,
      lot: shipment.lot,
      chainId: cycle.chainId,
      binding: origin.binding,
    };
  }

  private assertOfferable(
    c: Awaited<ReturnType<HandoversService['context']>>,
    kind: Kind,
    organizationId: string | null,
  ) {
    if (c.shipment.handoverMode !== 'DUAL_SIGNED')
      throw new ConflictException(
        'Chuyến hàng này không dùng bàn giao hai bên có chữ ký',
      );
    if (!c.lot.availableQuantity.greaterThan(0))
      throw new ConflictException('Lô không còn lượng khả dụng');
    const [status, giver] =
      kind === 'PICKUP'
        ? (['CREATED', c.lot.farmOrgId] as const)
        : (['IN_TRANSIT', c.shipment.transporterOrgId] as const);
    if (c.shipment.status !== status)
      throw new ConflictException(
        kind === 'PICKUP'
          ? 'Chỉ chuyến hàng mới tạo mới được bàn giao lấy hàng'
          : 'Chỉ chuyến hàng đang vận chuyển mới được bàn giao khi đến',
      );
    if (organizationId !== giver)
      throw new ForbiddenException(
        'Chỉ bên đang giữ hàng được đề nghị bàn giao',
      );
  }

  private assertUnchanged(
    h: ShipmentHandover,
    c: Awaited<ReturnType<HandoversService['context']>>,
  ) {
    if (
      c.shipment.version !== h.shipmentVersion ||
      c.lot.version !== h.lotVersion ||
      !c.lot.availableQuantity.equals(h.quantity)
    )
      throw new ConflictException(
        'Chuyến hàng hoặc lô đã thay đổi sau đề nghị; cần hủy và tạo đề nghị mới',
      );
  }
}
