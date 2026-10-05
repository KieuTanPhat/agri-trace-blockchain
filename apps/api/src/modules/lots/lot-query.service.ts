import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import type { Actor } from '../trace/trace.service.js';
import {
  INTERNAL_LOT_INCLUDE,
  PUBLIC_TRACE_INCLUDE,
  PUBLIC_EVENT_INCLUDE,
  DASHBOARD_LOT_SELECT,
} from './lot-query.types.js';
import { presentInternalLot, presentPublicLot } from './lot.presenter.js';
import { lotReadScope } from './lot-read.scope.js';
import { aggregateProofStatus } from './lot-proof-status.js';
@Injectable()
export class LotQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}
  async getInternal(lotId: string, actor: Actor) {
    await this.access.assertLotAccess(actor, lotId);
    const lot = await this.prisma.lot.findUnique({
      where: { id: lotId },
      include: INTERNAL_LOT_INCLUDE,
    });
    if (!lot) throw new NotFoundException('Không tìm thấy lô hàng');
    return presentInternalLot(lot, actor);
  }
  async getList(actor: Actor) {
    const lots = await this.prisma.lot.findMany({
      where: lotReadScope(actor),
      include: INTERNAL_LOT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return lots.map((lot) => presentInternalLot(lot, actor));
  }
  async getDashboard(actor: Actor) {
    const lots = await this.prisma.lot.findMany({
      where: lotReadScope(actor),
      select: DASHBOARD_LOT_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    // Only the featured lot needs the complete internal projection.
    const featured = lots[0]
      ? await this.prisma.lot.findUnique({
          where: { id: lots[0].id },
          include: INTERNAL_LOT_INCLUDE,
        })
      : null;
    return {
      featuredLot: featured ? presentInternalLot(featured, actor) : null,
      stats: [
        { label: 'Lô đang theo dõi', value: String(lots.length) },
        {
          label: 'Bằng chứng đang chờ',
          value: String(
            lots.filter(
              (lot) =>
                aggregateProofStatus([
                  ...lot.harvest.cycle.traceEvents,
                  ...lot.traceEvents,
                ]) === 'PENDING',
            ).length,
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
      include: PUBLIC_TRACE_INCLUDE,
    });
    if (!qr) throw new NotFoundException('Mã truy xuất không hợp lệ');
    const { lot } = qr;
    const traceEvents = await this.prisma.traceEvent.findMany({
      where: {
        OR: [{ lotId: lot.id }, { cycleId: lot.harvest.cycle.id, lotId: null }],
      },
      orderBy: [{ eventTime: 'asc' }, { createdAt: 'asc' }],
      include: PUBLIC_EVENT_INCLUDE,
    });
    return presentPublicLot(lot, traceToken, traceEvents);
  }
}
