import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthenticatedRequest } from './auth.types.js';

type Actor = AuthenticatedRequest['user'];

@Injectable()
export class OrganizationAccessService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async assertFarmAccess(actor: Actor, farmId: string) {
    const farm = await this.prisma.farm.findUnique({
      where: { id: farmId },
      select: { id: true, organizationId: true },
    });

    if (!farm) {
      throw new NotFoundException('Không tìm thấy nông trại');
    }

    this.assertOrganizationAccess(actor, farm.organizationId, 'nông trại này');
    return farm;
  }

  async assertProductionCycleAccess(actor: Actor, cycleId: string) {
    const cycle = await this.prisma.productionCycle.findUnique({
      where: { id: cycleId },
      select: {
        id: true,
        farm: {
          select: { organizationId: true },
        },
      },
    });

    if (!cycle) {
      throw new NotFoundException('Không tìm thấy vụ sản xuất');
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
      select: { id: true, farmOrgId: true },
    });

    if (!lot) {
      throw new NotFoundException('Không tìm thấy lô hàng');
    }

    this.assertOrganizationAccess(actor, lot.farmOrgId, 'lô hàng này');
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
          select: { farmOrgId: true },
        },
      },
    });

    if (!shipment) {
      throw new NotFoundException('Không tìm thấy chuyến vận chuyển');
    }

    if (actor.role === 'SYSTEM_ADMIN') {
      return shipment;
    }

    const allowedOrganizationIds = [
      shipment.lot.farmOrgId,
      shipment.transporterOrgId,
      shipment.retailerOrgId,
    ];

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