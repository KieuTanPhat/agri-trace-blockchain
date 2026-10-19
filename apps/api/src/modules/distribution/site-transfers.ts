import { Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { Prisma, type SiteTransfer } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { quantity, quantityIsReconciled } from '../../common/quantity.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { enterpriseAuthority } from '../enterprise-workspace/enterprise-policy.js';
import { WorkspaceListDto, WorkspaceRecordDto } from '../enterprise-workspace/dto.js';
import { TraceService } from '../trace/trace.service.js';
import { activeSite, addSiteStock, requireSiteStock } from './distribution-inventory.js';
import { SiteTransferInput, SiteTransferReceiptInput, SiteTransferResolutionInput, SiteTransferVersion } from './dto.js';

type Tx = Prisma.TransactionClient;

/** Internal moves between two sites of the holding organization (aaa.txt 1.2).
 * The organization holding and the lot total never change; only the confirmed
 * quantity enters the destination and any shortfall waits for reconciliation. */
@Injectable()
export class SiteTransfersService {
  constructor(private readonly db: PrismaService, private readonly trace: TraceService) {}

  private async lockedLot(tx: Tx, lotId: string) {
    await tx.$queryRaw`SELECT lot_id FROM lot WHERE lot_id=${lotId}::uuid FOR UPDATE`;
    const lot = await tx.lot.findUnique({ where: { id: lotId }, include: { shipment: true, harvest: { include: { cycle: true } } } });
    if (!lot) throw new NotFoundException('Không tìm thấy lô');
    return lot;
  }

  /** Locks the lot first (same order as other lot commands), then the slip. */
  private async lockedSlip(tx: Tx, actor: CommandActor, id: string, version: number) {
    const first = await tx.siteTransfer.findUnique({ where: { id } });
    if (!first || first.organizationId !== actor.organizationId) throw new NotFoundException('Không tìm thấy phiếu chuyển');
    const lot = await this.lockedLot(tx, first.lotId);
    await tx.$queryRaw`SELECT id FROM site_transfer WHERE id=${id}::uuid FOR UPDATE`;
    const slip = await tx.siteTransfer.findUniqueOrThrow({ where: { id } });
    if (slip.version !== version) throw new ConflictException('Phiếu chuyển đã thay đổi; tải lại trước khi thao tác');
    return { slip, lot };
  }

  private async event(tx: Tx, actor: CommandActor, slip: SiteTransfer, stage: string, extra: Record<string, unknown> = {}) {
    await this.trace.createInTransaction(tx, {
      entityType: 'LOT', entityId: slip.lotId, lotId: slip.lotId, eventType: 'DISTRIBUTION_SITE_ALLOCATED', actor,
      businessData: { stage, siteTransferId: slip.id, code: slip.code, fromSiteId: slip.fromSiteId, toSiteId: slip.toSiteId, quantity: slip.quantity.toFixed(3), unit: slip.unit, ...extra },
    });
  }

  private async dispatchLocked(tx: Tx, actor: CommandActor, slip: SiteTransfer, lot: { id: string; initialQuantity: Prisma.Decimal; availableQuantity: Prisma.Decimal; unit: string; harvest: { cycle: { chainId: string } } }) {
    await enterpriseAuthority(tx, actor, 'inventory.manage', lot.harvest.cycle.chainId, slip.fromSiteId, true);
    if (!await quantityIsReconciled(tx, lot)) throw new ConflictException('Lô cần đối soát số lượng trước khi chuyển');
    await requireSiteStock(tx, lot.id, actor.organizationId!, slip.fromSiteId, slip.quantity);
    await activeSite(tx, actor.organizationId!, slip.toSiteId);
    await tx.lotSiteHolding.update({
      where: { lotId_organizationId_siteId: { lotId: lot.id, organizationId: actor.organizationId!, siteId: slip.fromSiteId } },
      data: { quantity: { decrement: slip.quantity }, version: { increment: 1 } },
    });
    const updated = await tx.siteTransfer.update({ where: { id: slip.id }, data: { status: 'IN_TRANSIT', dispatchedBy: actor.sub!, dispatchedAt: new Date(), version: { increment: 1 } } });
    await tx.lot.update({ where: { id: lot.id }, data: { version: { increment: 1 } } });
    await this.event(tx, actor, updated, 'TRANSFER_DISPATCHED');
    return updated;
  }

  create(actor: CommandActor, input: SiteTransferInput) {
    return commandTransaction(this.db, async tx => {
      const lot = await this.lockedLot(tx, input.lotId);
      const chainId = lot.harvest.cycle.chainId;
      await enterpriseAuthority(tx, actor, 'inventory.manage', chainId, input.fromSiteId, true);
      await enterpriseAuthority(tx, actor, 'inventory.manage', chainId, input.toSiteId);
      if (input.fromSiteId === input.toSiteId) throw new ConflictException('Cơ sở xuất và cơ sở nhận phải khác nhau');
      await activeSite(tx, actor.organizationId!, input.fromSiteId);
      await activeSite(tx, actor.organizationId!, input.toSiteId);
      if (lot.shipment || lot.unit !== input.unit || lot.version !== input.version) throw new ConflictException('Lô, đơn vị hoặc phiên bản không phù hợp; tải lại tồn kho');
      if (!await tx.lotHolding.findUnique({ where: { lotId_organizationId: { lotId: lot.id, organizationId: actor.organizationId! } } })) throw new ForbiddenException('Không có lượng hàng của tổ chức');
      const qty = quantity(input.quantity);
      await requireSiteStock(tx, lot.id, actor.organizationId!, input.fromSiteId, qty);
      if (input.receiverUserId && !await tx.user.findFirst({ where: { id: input.receiverUserId, organizationId: actor.organizationId!, accountStatus: 'ACTIVE' } }))
        throw new ConflictException('Người nhận phải là thành viên đang hoạt động của doanh nghiệp');
      const slip = await tx.siteTransfer.create({
        data: {
          code: `CK-${randomUUID().slice(0, 12).toUpperCase()}`, organizationId: actor.organizationId!, lotId: lot.id,
          fromSiteId: input.fromSiteId, toSiteId: input.toSiteId, quantity: qty, unit: lot.unit,
          reason: input.reason.trim(), note: input.note?.trim() || null, receiverUserId: input.receiverUserId ?? null, createdBy: actor.sub!,
        },
      });
      const record = input.dispatch ? await this.dispatchLocked(tx, actor, slip, lot) : slip;
      return { record };
    });
  }

  dispatch(actor: CommandActor, id: string, input: SiteTransferVersion) {
    return commandTransaction(this.db, async tx => {
      const { slip, lot } = await this.lockedSlip(tx, actor, id, input.version);
      if (slip.status !== 'PENDING') throw new ConflictException('Chỉ xuất phiếu đang chờ chuyển');
      return { record: await this.dispatchLocked(tx, actor, slip, lot) };
    });
  }

  receive(actor: CommandActor, id: string, input: SiteTransferReceiptInput) {
    return commandTransaction(this.db, async tx => {
      const { slip, lot } = await this.lockedSlip(tx, actor, id, input.version);
      await enterpriseAuthority(tx, actor, 'inventory.manage', lot.harvest.cycle.chainId, slip.toSiteId, true);
      if (slip.status !== 'IN_TRANSIT') throw new ConflictException('Chỉ xác nhận phiếu đang chuyển');
      await activeSite(tx, actor.organizationId!, slip.toSiteId);
      const received = quantity(input.receivedQuantity, true);
      if (received.gt(slip.quantity)) throw new ConflictException('Lượng thực nhận vượt lượng chuyển');
      if (received.gt(0)) await addSiteStock(tx, lot.id, actor.organizationId!, slip.toSiteId, received);
      const shortfall = slip.quantity.sub(received);
      const updated = await tx.siteTransfer.update({
        where: { id },
        data: { status: shortfall.gt(0) ? 'DISCREPANCY' : 'RECEIVED', receivedQuantity: received, receiptNote: input.note?.trim() || null, receivedBy: actor.sub!, receivedAt: new Date(), version: { increment: 1 } },
      });
      await tx.lot.update({ where: { id: lot.id }, data: { version: { increment: 1 } } });
      await this.event(tx, actor, updated, 'TRANSFER_RECEIVED', { received: received.toFixed(3), shortfall: shortfall.toFixed(3) });
      return { record: updated };
    });
  }

  resolve(actor: CommandActor, id: string, input: SiteTransferResolutionInput) {
    return commandTransaction(this.db, async tx => {
      const { slip, lot } = await this.lockedSlip(tx, actor, id, input.version);
      if (slip.status !== 'DISCREPANCY' || !slip.receivedQuantity) throw new ConflictException('Chỉ xử lý phiếu đang chênh lệch');
      const chainId = lot.harvest.cycle.chainId;
      const shortfall = slip.quantity.sub(slip.receivedQuantity);
      if (input.resolution === 'RETURNED') {
        await enterpriseAuthority(tx, actor, 'inventory.manage', chainId, slip.fromSiteId, true);
        await activeSite(tx, actor.organizationId!, slip.fromSiteId);
        await addSiteStock(tx, lot.id, actor.organizationId!, slip.fromSiteId, shortfall);
      } else {
        await enterpriseAuthority(tx, actor, 'quantity.adjust', chainId, slip.fromSiteId, true);
        if (!await tx.organizationCapability.findFirst({ where: { organizationId: actor.organizationId!, code: { in: ['FARM', 'DISTRIBUTOR', 'RETAILER'] }, revokedAt: null } }))
          throw new ForbiddenException('Năng lực doanh nghiệp không phù hợp ghi hao hụt');
        const after = lot.availableQuantity.sub(shortfall);
        const event = await this.trace.createInTransaction(tx, {
          entityType: 'LOT', entityId: lot.id, lotId: lot.id, eventType: 'DISTRIBUTION_QUANTITY_RECORDED', actor,
          businessData: { kind: 'DAMAGE', reason: input.note.trim(), quantity: shortfall.toFixed(3), unit: lot.unit, before: lot.availableQuantity.toFixed(3), after: after.toFixed(3), organizationId: actor.organizationId!, siteId: slip.fromSiteId, siteTransferId: slip.id },
        });
        await tx.lotHolding.update({ where: { lotId_organizationId: { lotId: lot.id, organizationId: actor.organizationId! } }, data: { quantity: { decrement: shortfall }, version: { increment: 1 } } });
        await tx.lot.update({ where: { id: lot.id }, data: { availableQuantity: after, ...(after.isZero() ? { currentState: 'DAMAGED' } : {}) } });
        await tx.quantityMovement.create({ data: { lotId: lot.id, eventId: event.id, type: 'DAMAGE_OUT', quantity: shortfall, beforeQty: lot.availableQuantity, delta: shortfall.negated(), afterQty: after, unit: lot.unit } });
      }
      const updated = await tx.siteTransfer.update({
        where: { id },
        data: { status: 'RECEIVED', resolution: input.resolution, resolutionNote: input.note.trim(), resolvedBy: actor.sub!, resolvedAt: new Date(), version: { increment: 1 } },
      });
      await tx.lot.update({ where: { id: lot.id }, data: { version: { increment: 1 } } });
      if (input.resolution === 'RETURNED') await this.event(tx, actor, updated, 'TRANSFER_SHORTFALL_RETURNED', { returned: shortfall.toFixed(3) });
      return { record: updated };
    });
  }

  cancel(actor: CommandActor, id: string, input: SiteTransferVersion) {
    return commandTransaction(this.db, async tx => {
      const { slip, lot } = await this.lockedSlip(tx, actor, id, input.version);
      await enterpriseAuthority(tx, actor, 'inventory.manage', lot.harvest.cycle.chainId, slip.fromSiteId, true);
      if (slip.status !== 'PENDING') throw new ConflictException('Chỉ hủy phiếu chưa xuất hàng');
      const updated = await tx.siteTransfer.update({ where: { id }, data: { status: 'CANCELLED', cancelledBy: actor.sub!, cancelledAt: new Date(), version: { increment: 1 } } });
      return { record: updated };
    });
  }

  /** Slips touching a site the member may manage; the primary sees every slip. */
  async list(actor: CommandActor) {
    const auth = await enterpriseAuthority(this.db, actor, 'inventory.manage');
    const roles = auth.user.enterpriseRoles.filter(r => r.role.permissions.includes('inventory.manage'));
    const siteIds = auth.primary ? undefined : [...new Set(roles.flatMap(r => r.siteIds))];
    const rows = await this.db.siteTransfer.findMany({
      where: { organizationId: actor.organizationId!, ...(siteIds ? { OR: [{ fromSiteId: { in: siteIds } }, { toSiteId: { in: siteIds } }] } : {}) },
      orderBy: { createdAt: 'desc' }, take: 200,
    });
    const visible = auth.primary ? rows : rows.filter(r => roles.some(role => role.siteIds.some(s => s === r.fromSiteId || s === r.toSiteId)));
    const lots = await this.db.lot.findMany({ where: { id: { in: [...new Set(visible.map(r => r.lotId))] } }, select: { id: true, lotCode: true, product: { select: { productName: true } }, harvest: { select: { cycle: { select: { chainId: true } } } } } });
    const chainByLot = new Map(lots.map((lot) => [lot.id, lot.harvest.cycle.chainId]));
    const scoped = auth.primary
      ? visible
      : visible.filter((row) => {
          const chainId = chainByLot.get(row.lotId);
          return roles.some(
            (role) =>
              !!chainId &&
              role.chainIds.includes(chainId) &&
              (role.siteIds.includes(row.fromSiteId) ||
                role.siteIds.includes(row.toSiteId)),
          );
        });
    const sites = await this.db.enterpriseSite.findMany({ where: { organizationId: actor.organizationId! }, select: { id: true, name: true } });
    const people = await this.db.user.findMany({ where: { id: { in: [...new Set(scoped.flatMap(r => [r.createdBy, r.receiverUserId, r.receivedBy].filter((x): x is string => !!x)))] } }, select: { id: true, fullName: true } });
    const name = (id: string | null) => people.find(p => p.id === id)?.fullName ?? null;
    return {
      items: scoped.map(r => {
        const lot = lots.find(l => l.id === r.lotId);
        return {
          ...r, quantity: r.quantity.toFixed(3), receivedQuantity: r.receivedQuantity?.toFixed(3) ?? null,
          shortfall: r.receivedQuantity ? r.quantity.sub(r.receivedQuantity).toFixed(3) : null,
          lotCode: lot?.lotCode ?? null, productName: lot?.product.productName ?? null,
          fromSiteName: sites.find(s => s.id === r.fromSiteId)?.name ?? null, toSiteName: sites.find(s => s.id === r.toSiteId)?.name ?? null,
          createdByName: name(r.createdBy), receiverName: name(r.receiverUserId), receivedByName: name(r.receivedBy),
        };
      }),
    };
  }
}

/** Quarantine slips at sites the member may manage for quarantine. */
@Injectable()
export class QuarantineCasesService {
  constructor(private readonly db: PrismaService) {}
  async list(actor: CommandActor) {
    const auth = await enterpriseAuthority(this.db, actor, 'quarantine.manage');
    const roles = auth.user.enterpriseRoles.filter(r => r.role.permissions.includes('quarantine.manage'));
    const rows = await this.db.quarantineCase.findMany({
      where: { organizationId: actor.organizationId!, ...(auth.primary ? {} : { siteId: { in: [...new Set(roles.flatMap(r => r.siteIds))] } }) },
      orderBy: { createdAt: 'desc' }, take: 200,
    });
    const lots = await this.db.lot.findMany({ where: { id: { in: [...new Set(rows.map(r => r.lotId))] } }, select: { id: true, lotCode: true, product: { select: { productName: true } }, harvest: { select: { cycle: { select: { chainId: true } } } } } });
    const scoped = auth.primary ? rows : rows.filter(r => { const chain = lots.find(l => l.id === r.lotId)?.harvest.cycle.chainId; return roles.some(role => role.siteIds.includes(r.siteId) && !!chain && role.chainIds.includes(chain)); });
    const sites = await this.db.enterpriseSite.findMany({ where: { organizationId: actor.organizationId! }, select: { id: true, name: true } });
    const people = await this.db.user.findMany({ where: { id: { in: [...new Set(scoped.map(r => r.createdBy))] } }, select: { id: true, fullName: true } });
    return {
      items: scoped.map(r => {
        const lot = lots.find(l => l.id === r.lotId);
        return {
          ...r, quantity: r.quantity.toFixed(3), releasedQuantity: r.releasedQuantity.toFixed(3), disposedQuantity: r.disposedQuantity.toFixed(3),
          openQuantity: r.quantity.sub(r.releasedQuantity).sub(r.disposedQuantity).toFixed(3),
          lotCode: lot?.lotCode ?? null, productName: lot?.product.productName ?? null,
          siteName: sites.find(s => s.id === r.siteId)?.name ?? null, createdByName: people.find(p => p.id === r.createdBy)?.fullName ?? null,
        };
      }),
    };
  }
}

@ApiTags('distribution') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('distribution/quarantine-cases')
export class QuarantineCasesController {
  constructor(private readonly service: QuarantineCasesService) {}
  @Get() @ApiDataResponse(WorkspaceListDto) list(@Req() req: AuthenticatedRequest) { return this.service.list(req.user); }
}

@ApiTags('distribution') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('distribution/site-transfers')
export class SiteTransfersController {
  constructor(private readonly service: SiteTransfersService, private readonly idem: IdempotencyService) {}
  private run(req: AuthenticatedRequest, key: string, operation: string, payload: unknown, fn: () => Promise<unknown>) {
    return this.idem.executeCommand({ idempotencyKey: key, requesterId: req.user.sub, actor: req.user, responseStatus: 201, operation, payload, requestType: 'COMMAND' }, fn);
  }
  @Get() @ApiDataResponse(WorkspaceListDto) list(@Req() req: AuthenticatedRequest) { return this.service.list(req.user); }
  @Post() @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiDataResponse(WorkspaceRecordDto, 201)
  create(@Req() req: AuthenticatedRequest, @Body() dto: SiteTransferInput, @IdempotencyKey() key: string) {
    return this.run(req, key, 'EW_SITE_TRANSFER_CREATE', dto, () => this.service.create(req.user, dto));
  }
  @Post(':id/dispatch') @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiDataResponse(WorkspaceRecordDto, 201)
  dispatch(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SiteTransferVersion, @IdempotencyKey() key: string) {
    return this.run(req, key, 'EW_SITE_TRANSFER_DISPATCH', { id, ...dto }, () => this.service.dispatch(req.user, id, dto));
  }
  @Post(':id/receive') @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiDataResponse(WorkspaceRecordDto, 201)
  receive(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SiteTransferReceiptInput, @IdempotencyKey() key: string) {
    return this.run(req, key, 'EW_SITE_TRANSFER_RECEIVE', { id, ...dto }, () => this.service.receive(req.user, id, dto));
  }
  @Post(':id/resolve') @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiDataResponse(WorkspaceRecordDto, 201)
  resolve(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SiteTransferResolutionInput, @IdempotencyKey() key: string) {
    return this.run(req, key, 'EW_SITE_TRANSFER_RESOLVE', { id, ...dto }, () => this.service.resolve(req.user, id, dto));
  }
  @Post(':id/cancel') @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiDataResponse(WorkspaceRecordDto, 201)
  cancel(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SiteTransferVersion, @IdempotencyKey() key: string) {
    return this.run(req, key, 'EW_SITE_TRANSFER_CANCEL', { id, ...dto }, () => this.service.cancel(req.user, id, dto));
  }
}
