import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  scopedCycleReadWhere,
  scopedLotReadWhere,
  scopedShipmentReadWhere,
} from '../supply-chains/business-read-scope.js';
type Actor = {
  sub?: string | null;
  role: string;
  organizationId: string | null;
};

/** Private business reads are always resolved through chain scope. Absent and
 * out-of-scope resources share one response so IDs cannot be probed. */
@Injectable()
export class OrganizationAccessService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async assertFarmAccess(actor: Actor, farmId: string) {
    const farm = await this.prisma.farm.findUnique({
      where: { id: farmId },
      select: { id: true, organizationId: true, status: true },
    });

    if (!farm) {
      throw new NotFoundException('Không tìm thấy nông trại');
    }

    if (farm.status === 'INACTIVE') {
      throw new ForbiddenException('Nông trại hiện không hoạt động');
    }

    this.assertOrganizationAccess(actor, farm.organizationId, 'nông trại này');
    return farm;
  }

  async assertProductionCycleAccess(actor: Actor, cycleId: string) {
    const cycle = await this.prisma.productionCycle.findFirst({
      where: {
        AND: [
          { id: cycleId },
          scopedCycleReadWhere({ ...actor, sub: actor.sub ?? null }),
        ],
      },
      select: {
        id: true,
        currentState: true,
        farmOrgId: true,
        chainId: true,
        farm: { select: { id: true, organizationId: true } },
      },
    });
    if (!cycle) throw new NotFoundException('Không tìm thấy vụ sản xuất');
    return cycle;
  }

  async assertLotAccess(actor: Actor, lotId: string) {
    const lot = await this.prisma.lot.findFirst({
      where: {
        AND: [
          { id: lotId },
          scopedLotReadWhere({ ...actor, sub: actor.sub ?? null }),
        ],
      },
      select: {
        id: true,
        farmOrgId: true,
        harvest: {
          select: {
            cycle: { select: { id: true, farmId: true, chainId: true } },
          },
        },
        shipment: {
          select: { transporterOrgId: true, retailerOrgId: true },
        },
      },
    });
    if (!lot) throw new NotFoundException('Không tìm thấy lô hàng');
    return lot;
  }

  async assertShipmentAccess(actor: Actor, shipmentId: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: {
        AND: [
          { id: shipmentId },
          scopedShipmentReadWhere({ ...actor, sub: actor.sub ?? null }),
        ],
      },
      select: {
        id: true,
        transporterOrgId: true,
        retailerOrgId: true,
        lot: {
          select: {
            farmOrgId: true,
            harvest: {
              select: {
                cycle: { select: { id: true, farmId: true, chainId: true } },
              },
            },
          },
        },
      },
    });
    if (!shipment)
      throw new NotFoundException('Không tìm thấy chuyến vận chuyển');
    return shipment;
  }

  async assertTraceEventAccess(actor: Actor, eventId: string) {
    const event = await this.prisma.traceEvent.findUnique({
      where: { id: eventId },
      select: { id: true, lotId: true, cycleId: true },
    });
    if (!event) throw new NotFoundException('Trace event not found');
    if (event.lotId) {
      await this.assertLotAccess(actor, event.lotId);
      return;
    }
    if (event.cycleId) {
      await this.assertProductionCycleAccess(actor, event.cycleId);
      return;
    }
    throw new ForbiddenException('No access to this trace event');
  }

  assertOrganizationAccess(
    actor: Actor,
    resourceOrganizationId: string,
    resourceName: string,
  ): void {
    if (actor.role === 'SYSTEM_ADMIN') {
      return;
    }

    if (
      !actor.organizationId ||
      actor.organizationId !== resourceOrganizationId
    ) {
      throw new ForbiddenException(
        `Bạn không có quyền truy cập ${resourceName}`,
      );
    }
  }
}
