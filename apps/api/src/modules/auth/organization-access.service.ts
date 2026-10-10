import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { assertAssignedFarm } from './compliance-scope.js';
type Actor = {
  sub?: string | null;
  role: string;
  organizationId: string | null;
};

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
    const cycle = await this.prisma.productionCycle.findUnique({
      where: { id: cycleId },
      select: {
        id: true,
        currentState: true,
        farm: {
          select: { id: true, organizationId: true },
        },
      },
    });

    if (!cycle) {
      throw new NotFoundException('Không tìm thấy vụ sản xuất');
    }

    if (actor.role === 'COMPLIANCE_REVIEWER') {
      await assertAssignedFarm(
        this.prisma,
        { ...actor, sub: actor.sub ?? null },
        cycle.farm.id,
      );
      return cycle;
    }
    this.assertOrganizationAccess(
      actor,
      cycle.farm.organizationId,
      'vụ sản xuất này',
    );

    return cycle;
  }

  async assertLotAccess(actor: Actor, lotId: string) {
    const lot = await this.prisma.lot.findUnique({
      where: { id: lotId },
      select: {
        id: true,
        farmOrgId: true,
        harvest: { select: { cycle: { select: { farmId: true } } } },
        shipment: {
          select: { transporterOrgId: true, retailerOrgId: true },
        },
      },
    });

    if (!lot) {
      throw new NotFoundException('Không tìm thấy lô hàng');
    }

    if (actor.role === 'COMPLIANCE_REVIEWER') {
      await assertAssignedFarm(
        this.prisma,
        { ...actor, sub: actor.sub ?? null },
        lot.harvest.cycle.farmId,
      );
      return lot;
    }
    if (!['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role)) {
      const allowed = [
        lot.farmOrgId,
        lot.shipment?.transporterOrgId,
        lot.shipment?.retailerOrgId,
      ];
      if (!actor.organizationId || !allowed.includes(actor.organizationId)) {
        throw new ForbiddenException('Bạn không có quyền truy cập lô hàng này');
      }
    }
    return lot;
  }

  async assertShipmentAccess(actor: Actor, shipmentId: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        transporterOrgId: true,
        retailerOrgId: true,
        lot: {
          select: {
            farmOrgId: true,
            harvest: { select: { cycle: { select: { farmId: true } } } },
          },
        },
      },
    });

    if (!shipment) {
      throw new NotFoundException('Không tìm thấy chuyến vận chuyển');
    }

    if (['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role)) {
      return shipment;
    }

    const allowedOrganizationIds = [
      shipment.lot.farmOrgId,
      shipment.transporterOrgId,
      shipment.retailerOrgId,
    ];

    if (actor.role === 'COMPLIANCE_REVIEWER') {
      await assertAssignedFarm(
        this.prisma,
        { ...actor, sub: actor.sub ?? null },
        shipment.lot.harvest.cycle.farmId,
      );
      return shipment;
    }

    if (
      !actor.organizationId ||
      !allowedOrganizationIds.includes(actor.organizationId)
    ) {
      throw new ForbiddenException(
        'Bạn không thuộc tổ chức được phép truy cập chuyến vận chuyển này',
      );
    }

    return shipment;
  }

  async assertTraceEventAccess(actor: Actor, eventId: string) {
    const event = await this.prisma.traceEvent.findUnique({
      where: { id: eventId },
      select: { id: true, lotId: true, cycleId: true },
    });
    if (!event) throw new NotFoundException('Trace event not found');
    if (['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role)) return;
    if (!actor.organizationId)
      throw new ForbiddenException('Organization required');
    if (event.lotId) {
      await this.assertLotAccess(actor, event.lotId);
      return;
    }
    if (event.cycleId) {
      if (actor.role === 'COMPLIANCE_REVIEWER') {
        await this.assertProductionCycleAccess(actor, event.cycleId);
        return;
      }
      const cycle = await this.prisma.productionCycle.findFirst({
        where: {
          id: event.cycleId,
          OR: [
            { farmOrgId: actor.organizationId },
            {
              harvestEvents: {
                some: {
                  lot: { shipment: { transporterOrgId: actor.organizationId } },
                },
              },
            },
            {
              harvestEvents: {
                some: {
                  lot: { shipment: { retailerOrgId: actor.organizationId } },
                },
              },
            },
          ],
        },
        select: { id: true },
      });
      if (cycle) return;
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
