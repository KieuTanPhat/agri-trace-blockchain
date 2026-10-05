import {
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Actor } from '../trace/trace.service.js';
import {
  ActivityReportQueryDto,
  ReportGroupBy,
} from './dto.js';
import {
  ReportAccessService,
  type ReportAccessScope,
} from './report-access.service.js';

type ReportMetric = {
  time: Date;
  productId: string;
  productName: string;
  organizationId: string;
  organizationName: string;
  harvestedQuantity: number;
  shippedQuantity: number;
  receivedQuantity: number;
  farmDamagedQuantity: number;
  transportDamagedQuantity: number;
  rejectedQuantity: number;
};

type ReportGroup = {
  key: string;
  label: string;
  harvestedQuantity: number;
  shippedQuantity: number;
  receivedQuantity: number;
  farmDamagedQuantity: number;
  transportDamagedQuantity: number;
  rejectedQuantity: number;
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ReportAccessService,
  ) {}

  async getActivityReport(
    query: ActivityReportQueryDto,
    actor: Actor,
  ) {
    const range = this.resolveRange(query.from, query.to);

    const scope = await this.access.resolveScope(
      actor,
      query.organizationId,
    );

    const [harvests, shipments, damageMovements] =
      await Promise.all([
        this.findHarvests(
          scope,
          query.productId,
          range.from,
          range.to,
        ),
        this.findShipments(
          scope,
          query.productId,
          range.from,
          range.to,
        ),
        this.findDamageMovements(
          scope,
          query.productId,
          range.from,
          range.to,
        ),
      ]);

    const metrics: ReportMetric[] = [];

    for (const harvest of harvests) {
      metrics.push({
        time: harvest.harvestTime,
        productId: harvest.cycle.product.id,
        productName: harvest.cycle.product.productName,
        organizationId: harvest.cycle.organization.id,
        organizationName: harvest.cycle.organization.name,
        harvestedQuantity: Number(harvest.quantity),
        shippedQuantity: 0,
        receivedQuantity: 0,
        farmDamagedQuantity: 0,
        transportDamagedQuantity: 0,
        rejectedQuantity: 0,
      });
    }

    for (const shipment of shipments) {
      if (this.isInsideRange(shipment.createdAt, range)) {
        metrics.push({
          time: shipment.createdAt,
          productId: shipment.lot.product.id,
          productName: shipment.lot.product.productName,
          organizationId: shipment.lot.organization.id,
          organizationName: shipment.lot.organization.name,
          harvestedQuantity: 0,
          shippedQuantity: Number(shipment.shippedQuantity),
          receivedQuantity: 0,
          farmDamagedQuantity: 0,
          transportDamagedQuantity: 0,
          rejectedQuantity: 0,
        });
      }

      if (
        shipment.receivedTime &&
        this.isInsideRange(shipment.receivedTime, range)
      ) {
        metrics.push({
          time: shipment.receivedTime,
          productId: shipment.lot.product.id,
          productName: shipment.lot.product.productName,
          organizationId: shipment.retailer.id,
          organizationName: shipment.retailer.name,
          harvestedQuantity: 0,
          shippedQuantity: 0,
          receivedQuantity:
            shipment.receivedQuantity == null
              ? 0
              : Number(shipment.receivedQuantity),
          farmDamagedQuantity: 0,
          transportDamagedQuantity: 0,
          rejectedQuantity:
            shipment.rejectedQuantity == null
              ? 0
              : Number(shipment.rejectedQuantity),
        });
      }
    }

    for (const movement of damageMovements) {
      const stage = this.getDamageStage(
        movement.traceEvent.businessData,
      );

      const isFarmDamage =
        stage === 'FARM_BEFORE_HANDOVER';

      const organization = isFarmDamage
        ? movement.lot.organization
        : movement.lot.shipment?.transporter;

      if (!organization) {
        continue;
      }

      metrics.push({
        time: movement.createdAt,
        productId: movement.lot.product.id,
        productName: movement.lot.product.productName,
        organizationId: organization.id,
        organizationName: organization.name,
        harvestedQuantity: 0,
        shippedQuantity: 0,
        receivedQuantity: 0,
        farmDamagedQuantity: isFarmDamage
          ? Number(movement.quantity)
          : 0,
        transportDamagedQuantity: isFarmDamage
          ? 0
          : Number(movement.quantity),
        rejectedQuantity: 0,
      });
    }

    const totals = this.createEmptyTotals();

    for (const metric of metrics) {
      this.addMetric(totals, metric);
    }

    const groups = this.groupMetrics(
      metrics,
      query.groupBy ?? ReportGroupBy.DAY,
    );

    return {
      filters: {
        from: range.from,
        to: range.to,
        organizationId: scope.organizationId ?? null,
        productId: query.productId ?? null,
        groupBy: query.groupBy ?? ReportGroupBy.DAY,
      },
      totals,
      groups,
    };
  }

  private findHarvests(
    scope: ReportAccessScope,
    productId?: string,
    from?: Date,
    to?: Date,
  ) {
    const where: Prisma.HarvestEventWhereInput = {
        harvestTime: this.dateFilter(from, to),
        AND: [
            productId
            ? {
                cycle: {
                    productId,
                },
                }
            : {},
            this.harvestScopeWhere(scope),
        ],
    };

    return this.prisma.harvestEvent.findMany({
      where,
      select: {
        id: true,
        harvestTime: true,
        quantity: true,
        unit: true,
        cycle: {
          select: {
            product: {
              select: {
                id: true,
                productName: true,
              },
            },
            organization: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        harvestTime: 'asc',
      },
    });
  }

  private findShipments(
    scope: ReportAccessScope,
    productId?: string,
    from?: Date,
    to?: Date,
  ) {
    const dateFilter = this.dateFilter(from, to);

    const where: Prisma.ShipmentWhereInput = {
        AND: [
            productId
            ? {
                lot: {
                    productId,
                },
                }
            : {},
            this.shipmentScopeWhere(scope),
        ],
        OR: dateFilter
            ? [
                {
                createdAt: dateFilter,
                },
                {
                receivedTime: dateFilter,
                },
            ]
            : undefined,
    };

    return this.prisma.shipment.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        receivedTime: true,
        shippedQuantity: true,
        receivedQuantity: true,
        rejectedQuantity: true,
        lot: {
          select: {
            product: {
              select: {
                id: true,
                productName: true,
              },
            },
            organization: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        transporter: {
          select: {
            id: true,
            name: true,
          },
        },
        retailer: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  private findDamageMovements(
    scope: ReportAccessScope,
    productId?: string,
    from?: Date,
    to?: Date,
  ) {
    const where: Prisma.QuantityMovementWhereInput = {
      type: 'DAMAGE_OUT',
      createdAt: this.dateFilter(from, to),
      lot: {
        productId,
        ...this.lotScopeWhere(scope),
      },
    };

    return this.prisma.quantityMovement.findMany({
      where,
      select: {
        id: true,
        quantity: true,
        unit: true,
        createdAt: true,
        traceEvent: {
          select: {
            businessData: true,
          },
        },
        lot: {
          select: {
            product: {
              select: {
                id: true,
                productName: true,
              },
            },
            organization: {
              select: {
                id: true,
                name: true,
              },
            },
            shipment: {
              select: {
                transporter: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  private harvestScopeWhere(
    scope: ReportAccessScope,
  ): Prisma.HarvestEventWhereInput {
    if (scope.unrestricted || !scope.organizationId) {
      return {};
    }

    if (scope.role === 'FARM_STAFF') {
      return {
        cycle: {
          farmOrgId: scope.organizationId,
        },
      };
    }

    if (scope.role === 'TRANSPORTER') {
      return {
        lot: {
          shipment: {
            transporterOrgId: scope.organizationId,
          },
        },
      };
    }

    if (scope.role === 'RETAILER') {
      return {
        lot: {
          shipment: {
            retailerOrgId: scope.organizationId,
          },
        },
      };
    }

    return {
      OR: [
        {
          cycle: {
            farmOrgId: scope.organizationId,
          },
        },
        {
          lot: {
            shipment: {
              transporterOrgId: scope.organizationId,
            },
          },
        },
        {
          lot: {
            shipment: {
              retailerOrgId: scope.organizationId,
            },
          },
        },
      ],
    };
  }

  private shipmentScopeWhere(
    scope: ReportAccessScope,
  ): Prisma.ShipmentWhereInput {
    if (scope.unrestricted || !scope.organizationId) {
      return {};
    }

    if (scope.role === 'FARM_STAFF') {
      return {
        lot: {
          farmOrgId: scope.organizationId,
        },
      };
    }

    if (scope.role === 'TRANSPORTER') {
      return {
        transporterOrgId: scope.organizationId,
      };
    }

    if (scope.role === 'RETAILER') {
      return {
        retailerOrgId: scope.organizationId,
      };
    }

    return {
      OR: [
        {
          lot: {
            farmOrgId: scope.organizationId,
          },
        },
        {
          transporterOrgId: scope.organizationId,
        },
        {
          retailerOrgId: scope.organizationId,
        },
      ],
    };
  }

  private lotScopeWhere(
    scope: ReportAccessScope,
  ): Prisma.LotWhereInput {
    if (scope.unrestricted || !scope.organizationId) {
      return {};
    }

    if (scope.role === 'FARM_STAFF') {
      return {
        farmOrgId: scope.organizationId,
      };
    }

    if (scope.role === 'TRANSPORTER') {
      return {
        shipment: {
          transporterOrgId: scope.organizationId,
        },
      };
    }

    if (scope.role === 'RETAILER') {
      return {
        shipment: {
          retailerOrgId: scope.organizationId,
        },
      };
    }

    return {
      OR: [
        {
          farmOrgId: scope.organizationId,
        },
        {
          shipment: {
            transporterOrgId: scope.organizationId,
          },
        },
        {
          shipment: {
            retailerOrgId: scope.organizationId,
          },
        },
      ],
    };
  }

  private resolveRange(
    fromValue?: string,
    toValue?: string,
  ): {
    from?: Date;
    to?: Date;
  } {
    const from = fromValue
      ? new Date(fromValue)
      : undefined;

    const to = toValue
      ? new Date(toValue)
      : undefined;

    if (from && to && from > to) {
      throw new UnprocessableEntityException(
        'Thời gian bắt đầu không được sau thời gian kết thúc',
      );
    }

    return {
      from,
      to,
    };
  }

  private dateFilter(
    from?: Date,
    to?: Date,
  ): Prisma.DateTimeFilter | undefined {
    if (!from && !to) {
      return undefined;
    }

    return {
      gte: from,
      lte: to,
    };
  }

  private isInsideRange(
    value: Date,
    range: {
      from?: Date;
      to?: Date;
    },
  ): boolean {
    if (range.from && value < range.from) {
      return false;
    }

    if (range.to && value > range.to) {
      return false;
    }

    return true;
  }

  private getDamageStage(
    businessData: Prisma.JsonValue,
  ): string | undefined {
    if (
      !businessData ||
      typeof businessData !== 'object' ||
      Array.isArray(businessData)
    ) {
      return undefined;
    }

    const stage = (
      businessData as Record<string, unknown>
    ).stage;

    return typeof stage === 'string'
      ? stage
      : undefined;
  }

  private groupMetrics(
    metrics: ReportMetric[],
    groupBy: ReportGroupBy,
  ): ReportGroup[] {
    const groups = new Map<string, ReportGroup>();

    for (const metric of metrics) {
      const identity = this.resolveGroupIdentity(
        metric,
        groupBy,
      );

      let group = groups.get(identity.key);

      if (!group) {
        group = {
          key: identity.key,
          label: identity.label,
          ...this.createEmptyTotals(),
        };

        groups.set(identity.key, group);
      }

      this.addMetric(group, metric);
    }

    return [...groups.values()].sort((left, right) =>
      left.key.localeCompare(right.key),
    );
  }

  private resolveGroupIdentity(
    metric: ReportMetric,
    groupBy: ReportGroupBy,
  ): {
    key: string;
    label: string;
  } {
    if (groupBy === ReportGroupBy.MONTH) {
      const key = metric.time
        .toISOString()
        .slice(0, 7);

      return {
        key,
        label: key,
      };
    }

    if (groupBy === ReportGroupBy.PRODUCT) {
      return {
        key: metric.productId,
        label: metric.productName,
      };
    }

    if (groupBy === ReportGroupBy.ORGANIZATION) {
      return {
        key: metric.organizationId,
        label: metric.organizationName,
      };
    }

    const key = metric.time
      .toISOString()
      .slice(0, 10);

    return {
      key,
      label: key,
    };
  }

  private createEmptyTotals() {
    return {
      harvestedQuantity: 0,
      shippedQuantity: 0,
      receivedQuantity: 0,
      farmDamagedQuantity: 0,
      transportDamagedQuantity: 0,
      rejectedQuantity: 0,
    };
  }

  private addMetric(
    target: {
      harvestedQuantity: number;
      shippedQuantity: number;
      receivedQuantity: number;
      farmDamagedQuantity: number;
      transportDamagedQuantity: number;
      rejectedQuantity: number;
    },
    metric: ReportMetric,
  ): void {
    target.harvestedQuantity +=
      metric.harvestedQuantity;

    target.shippedQuantity +=
      metric.shippedQuantity;

    target.receivedQuantity +=
      metric.receivedQuantity;

    target.farmDamagedQuantity +=
      metric.farmDamagedQuantity;

    target.transportDamagedQuantity +=
      metric.transportDamagedQuantity;

    target.rejectedQuantity +=
      metric.rejectedQuantity;
  }
}