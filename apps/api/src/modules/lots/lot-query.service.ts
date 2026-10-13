import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import type { Actor } from '../trace/trace.service.js';
import {
  INTERNAL_LOT_INCLUDE,
  publicLotInclude,
  PUBLIC_TRACE_INCLUDE,
  type InternalLot,
} from './lot-query.types.js';
import { toInternalLotDto, toPublicLotDto } from './lot.presenter.js';
import { scopedLotReadWhere } from '../supply-chains/business-read-scope.js';
import { authorizeBusinessCommand } from '../supply-chains/business-policy.js';
import { getAllowedLotCommands, type LotCommand } from './lot-action.policy.js';

@Injectable()
export class LotQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async getInternal(lotId: string, actor: Actor) {
    await this.access.assertLotAccess(actor, lotId);
    const lot = await this.prisma.lot.findFirst({
      where: { AND: [{ id: lotId }, scopedLotReadWhere(actor)] },
      include: INTERNAL_LOT_INCLUDE,
    });
    if (!lot) throw new NotFoundException('Không tìm thấy lô hàng');
    return this.projectInternal(lot, actor);
  }

  async getList(actor: Actor) {
    const lots = await this.prisma.lot.findMany({
      where: scopedLotReadWhere(actor),
      include: INTERNAL_LOT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(lots.map((lot) => this.projectInternal(lot, actor)));
  }

  private async projectInternal(lot: InternalLot, actor: Actor) {
    const response = toInternalLotDto(lot, actor);
    const chainId = lot.harvest.cycle.chainId;
    if (!chainId) return response;
    const commands = new Set<LotCommand>();
    for (const role of ['FARM_STAFF', 'TRANSPORTER', 'RETAILER'] as const) {
      try {
        const authority = await authorizeBusinessCommand(this.prisma, actor, {
          chainId,
          role,
          subject: { kind: 'lot', id: lot.id },
        });
        for (const command of getAllowedLotCommands(
          { ...lot, quantityReconciled: response.quantityReconciled },
          authority.actor,
        ))
          if (command !== 'createShipment') commands.add(command);
      } catch (error) {
        if (!(
          error instanceof ForbiddenException ||
          error instanceof NotFoundException
        ))
          throw error;
      }
    }
    return { ...response, allowedCommands: [...commands] };
  }

  async getDashboard(actor: Actor) {
    const lots = await this.getList(actor);
    return {
      featuredLot: lots[0] ?? null,
      stats: [
        { label: 'Lô đang theo dõi', value: String(lots.length) },
        {
          label: 'Bằng chứng đang chờ',
          value: String(
            lots.filter((lot) => lot.proofStatus === 'PENDING').length,
          ),
        },
        {
          label: 'Chuyến vận chuyển mở',
          value: String(
            lots.filter((lot) =>
              ['CREATED', 'IN_TRANSIT', 'ARRIVED'].includes(
                lot.shipment?.status ?? '',
              ),
            ).length,
          ),
        },
      ],
    };
  }

  async getPublic(traceToken: string) {
    const qr = await this.prisma.traceQr.findUnique({
      where: { traceToken },
      include: { lot: { include: publicLotInclude() } },
    });
    if (!qr) throw new NotFoundException('Mã truy xuất không hợp lệ');
    const traceEvents = await this.prisma.traceEvent.findMany({
      where: {
        OR: [
          { lotId: qr.lot.id },
          { cycleId: qr.lot.harvest.cycle.id, lotId: null },
        ],
      },
      orderBy: [{ eventTime: 'asc' }, { createdAt: 'asc' }],
      include: PUBLIC_TRACE_INCLUDE,
    });
    return toPublicLotDto(qr.lot, traceToken, traceEvents);
  }
}
