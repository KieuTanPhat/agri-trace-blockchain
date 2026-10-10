import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import { assignedFarmWhere } from '../auth/compliance-scope.js';
import type { Actor } from '../trace/trace.service.js';
import {
  INTERNAL_LOT_INCLUDE,
  PUBLIC_LOT_INCLUDE,
  PUBLIC_TRACE_INCLUDE,
} from './lot-query.types.js';
import { toInternalLotDto, toPublicLotDto } from './lot.presenter.js';

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
    return toInternalLotDto(lot, actor);
  }

  async getList(actor: Actor) {
    const lots = await this.prisma.lot.findMany({
      where: ['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role)
        ? undefined
        : actor.role === 'COMPLIANCE_REVIEWER'
          ? { harvest: { cycle: { farm: assignedFarmWhere(actor) } } }
          : {
              OR: [
                {
                  farmOrgId:
                    actor.organizationId ??
                    '00000000-0000-0000-0000-000000000000',
                },
                {
                  shipment: {
                    transporterOrgId:
                      actor.organizationId ??
                      '00000000-0000-0000-0000-000000000000',
                  },
                },
                {
                  shipment: {
                    retailerOrgId:
                      actor.organizationId ??
                      '00000000-0000-0000-0000-000000000000',
                  },
                },
              ],
            },
      include: INTERNAL_LOT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return lots.map((lot) => toInternalLotDto(lot, actor));
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
      include: { lot: { include: PUBLIC_LOT_INCLUDE } },
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
