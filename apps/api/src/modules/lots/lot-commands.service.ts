import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  commandTransaction,
  lockAggregate,
} from '../../common/idempotency/command-transaction.js';
import { assertQuantityReconciled, quantity } from '../../common/quantity.js';
import { isPastExpiry } from '../../common/expiry-date.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { Actor } from '../trace/trace.service.js';
import { TraceService } from '../trace/trace.service.js';
import { assertBusinessActor } from '../auth/business-write.policy.js';
import type {
  DamageLotDto,
  LotReasonCommandDto,
  LotVersionCommandDto,
} from './dto.js';
import {
  CUSTODY_EVENT_SELECT,
  lotStateMatchesShipment,
  resolveLotCustodian,
} from './lot-custody.js';

type Command = 'markForSale' | 'markSold' | 'recall' | 'expire' | 'damage';
const ACTIVE_STATES = [
  'HARVESTED',
  'IN_TRANSPORT',
  'ARRIVED',
  'RETAIL_RECEIVED',
  'FOR_SALE',
];

@Injectable()
export class LotCommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trace: TraceService,
  ) {}

  markForSale(id: string, input: LotVersionCommandDto, actor: Actor) {
    return this.execute(id, input, actor, 'markForSale');
  }
  markSold(id: string, input: LotVersionCommandDto, actor: Actor) {
    return this.execute(id, input, actor, 'markSold');
  }
  recall(id: string, input: LotReasonCommandDto, actor: Actor) {
    return this.execute(id, input, actor, 'recall');
  }
  expire(id: string, input: LotReasonCommandDto, actor: Actor) {
    return this.execute(id, input, actor, 'expire');
  }
  damage(id: string, input: DamageLotDto, actor: Actor) {
    return this.execute(id, input, actor, 'damage');
  }

  private execute(
    id: string,
    input: LotVersionCommandDto,
    actor: Actor,
    command: Command,
  ) {
    assertBusinessActor(
      actor,
      command === 'damage'
        ? ['FARM_STAFF']
        : ['markForSale', 'markSold'].includes(command)
          ? ['RETAILER']
          : ['FARM_STAFF', 'TRANSPORTER', 'RETAILER'],
    );
    return commandTransaction(this.prisma, async (tx) => {
      await lockAggregate(tx, 'lot', id);
      const lot = await tx.lot.findUnique({
        where: { id },
        include: { shipment: true, traceEvents: CUSTODY_EVENT_SELECT },
      });
      if (!lot) throw new NotFoundException('Không tìm thấy lô hàng');
      if (!lotStateMatchesShipment(lot))
        throw new ConflictException(
          'Trạng thái Lot và Shipment không khớp; cần đối soát',
        );
      const custodian = resolveLotCustodian(lot);
      if (
        !custodian ||
        custodian.role !== actor.role ||
        custodian.organizationId !== actor.organizationId
      )
        throw new ForbiddenException('Tổ chức hiện tại không giữ lô hàng');
      if (
        lot.version !== input.version ||
        (lot.shipment && lot.shipment.version !== input.shipmentVersion)
      )
        throw new ConflictException(
          'Phiên bản Lot hoặc Shipment đã thay đổi; tải lại trước khi gửi',
        );
      await assertQuantityReconciled(tx, lot);
      const now = new Date();
      const before = lot.availableQuantity;
      let after = before;
      let state = lot.currentState;
      let eventType: string;
      let movementType: string | null = null;
      const reason =
        'reason' in input && typeof input.reason === 'string'
          ? input.reason.trim()
          : null;
      if (
        ['damage', 'recall', 'expire'].includes(command) &&
        (!reason || reason.length > 1000)
      )
        throw new UnprocessableEntityException('Cần lý do từ 1 đến 1000 ký tự');
      switch (command) {
        case 'markForSale':
        case 'markSold':
          if (
            lot.shipment?.status !== 'DELIVERED' ||
            state !==
              (command === 'markSold' ? 'FOR_SALE' : 'RETAIL_RECEIVED') ||
            !before.greaterThan(0)
          )
            throw new ConflictException(
              'Lô không đủ điều kiện bán ở trạng thái hiện tại',
            );
          if (isPastExpiry(lot.expiryDate, now))
            throw new ConflictException('Lô đã quá hạn sử dụng');
          state = command === 'markSold' ? 'SOLD' : 'FOR_SALE';
          eventType = command === 'markSold' ? 'LOT_SOLD' : 'MARKED_FOR_SALE';
          if (command === 'markSold') {
            after = new Prisma.Decimal(0);
            movementType = 'SALE_OUT';
          }
          break;
        case 'recall':
          if (![...ACTIVE_STATES, 'SOLD'].includes(state))
            throw new ConflictException(
              'Không thể thu hồi ở trạng thái hiện tại',
            );
          state = 'RECALLED';
          eventType = 'RECALL_RECORDED';
          after = new Prisma.Decimal(0);
          if (before.greaterThan(0)) movementType = 'RECALL_OUT';
          break;
        case 'expire':
          if (!ACTIVE_STATES.includes(state) || !before.greaterThan(0))
            throw new ConflictException(
              'Không thể ghi hết hạn ở trạng thái hiện tại',
            );
          if (!isPastExpiry(lot.expiryDate, now))
            throw new ConflictException(
              'Lô chưa quá hạn hoặc chưa có ngày hết hạn',
            );
          state = 'EXPIRED';
          eventType = 'LOT_EXPIRED';
          after = new Prisma.Decimal(0);
          movementType = 'EXPIRE_OUT';
          break;
        case 'damage': {
          if (
            lot.shipment ||
            state !== 'HARVESTED' ||
            actor.organizationId !== lot.farmOrgId
          )
            throw new ConflictException(
              'Farm chỉ ghi hỏng khi lô HARVESTED và chưa có Shipment',
            );
          const damaged = quantity((input as DamageLotDto).quantity);
          if (damaged.greaterThan(before))
            throw new UnprocessableEntityException(
              'Lượng hư hỏng vượt lượng còn lại',
            );
          after = before.sub(damaged);
          state = after.isZero() ? 'DAMAGED' : state;
          eventType = after.isZero()
            ? 'DAMAGE_RECORDED'
            : 'PARTIAL_DAMAGE_RECORDED';
          movementType = 'DAMAGE_OUT';
          break;
        }
      }
      if (
        ['recall', 'expire'].includes(command) &&
        lot.shipment &&
        ['CREATED', 'IN_TRANSIT', 'ARRIVED'].includes(lot.shipment.status)
      ) {
        const failed = await tx.shipment.updateMany({
          where: {
            id: lot.shipment.id,
            status: lot.shipment.status,
            version: input.shipmentVersion,
          },
          data: { status: 'FAILED', version: { increment: 1 } },
        });
        if (failed.count !== 1)
          throw new ConflictException('Chuyến hàng đã thay đổi');
      }
      const updated = await tx.lot.updateMany({
        where: { id, version: input.version, currentState: lot.currentState },
        data: {
          currentState: state,
          availableQuantity: after,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new ConflictException('Lô hàng đã thay đổi');
      const delta = after.sub(before);
      const event = await this.trace.createInTransaction(tx, {
        entityType: 'LOT',
        entityId: id,
        lotId: id,
        eventType,
        actor,
        eventTime: now,
        businessData: {
          beforeState: lot.currentState,
          afterState: state,
          beforeQuantity: before.toString(),
          afterQuantity: after.toString(),
          quantity: delta.abs().toString(),
          unit: lot.unit,
          reason,
          evidenceRef:
            'evidenceRef' in input
              ? ((input as DamageLotDto).evidenceRef ?? null)
              : null,
          expiryDate: lot.expiryDate?.toISOString().slice(0, 10) ?? null,
          custodianOrganizationId: custodian.organizationId,
          shipmentStateBefore: lot.shipment?.status ?? null,
          shipmentId: lot.shipment?.id ?? null,
          lotVersionBefore: lot.version,
          lotVersionAfter: lot.version + 1,
        },
      });
      if (movementType)
        await tx.quantityMovement.create({
          data: {
            lotId: id,
            eventId: event.id,
            type: movementType,
            quantity: delta.abs(),
            unit: lot.unit,
            beforeQty: before,
            delta,
            afterQty: after,
          },
        });
      return {
        lotId: id,
        currentState: state,
        version: lot.version + 1,
        availableQuantity: after.toNumber(),
        eventId: event.id,
      };
    });
  }
}
