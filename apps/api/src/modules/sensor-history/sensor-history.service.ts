import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import type { Actor } from '../trace/trace.service.js';
import {
  SensorHistoryInterval,
  SensorHistoryQueryDto,
  ShipmentTelemetryQueryDto,
} from './dto.js';

type SensorAggregateRow = {
  bucket: Date;
  sensorType: string;
  unit: string;
  readingCount: bigint | number;
  minimum: Prisma.Decimal | number | null;
  maximum: Prisma.Decimal | number | null;
  average: Prisma.Decimal | number | null;
};

type TelemetryAggregateRow = {
  bucket: Date;
  readingCount: bigint | number;
  minimumTemperature: Prisma.Decimal | number | null;
  maximumTemperature: Prisma.Decimal | number | null;
  averageTemperature: Prisma.Decimal | number | null;
  minimumHumidity: Prisma.Decimal | number | null;
  maximumHumidity: Prisma.Decimal | number | null;
  averageHumidity: Prisma.Decimal | number | null;
  averageSpeed: Prisma.Decimal | number | null;
  averageBattery: Prisma.Decimal | number | null;
};

@Injectable()
export class SensorHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async getReadings(query: SensorHistoryQueryDto, actor: Actor) {
    const scope = await this.resolveReadingScope(query, actor);
    const range = this.resolveRange(scope.from, scope.to);

    if (query.interval === SensorHistoryInterval.RAW) {
      return this.getRawReadings(
        {
          cycleId: scope.cycleId,
          deviceId: query.deviceId,
          sensorType: query.sensorType,
          from: range.from,
          to: range.to,
        },
        query.page,
        query.limit,
      );
    }

    return this.getReadingAggregation(
      {
        cycleId: scope.cycleId,
        deviceId: query.deviceId,
        sensorType: query.sensorType,
        from: range.from,
        to: range.to,
      },
      query.interval,
    );
  }

  async getReadingSummary(
    query: SensorHistoryQueryDto,
    actor: Actor,
  ) {
    const interval =
      query.interval === SensorHistoryInterval.DAY
        ? SensorHistoryInterval.DAY
        : SensorHistoryInterval.HOUR;

    return this.getReadings(
      {
        ...query,
        interval,
      },
      actor,
    );
  }

  async getShipmentTelemetry(
    query: ShipmentTelemetryQueryDto,
    actor: Actor,
  ) {
    await this.access.assertShipmentAccess(actor, query.shipmentId);

    if (query.deviceId) {
      const device = await this.prisma.iotDevice.findUnique({
        where: {
          id: query.deviceId,
        },
      });

      if (!device) {
        throw new NotFoundException('Không tìm thấy thiết bị');
      }

      const binding =
        await this.prisma.shipmentTrackingBinding.findFirst({
          where: {
            shipmentId: query.shipmentId,
            deviceId: query.deviceId,
          },
          select: {
            id: true,
          },
        });

      if (!binding) {
        throw new UnprocessableEntityException(
          'Thiết bị không được gắn với chuyến vận chuyển này',
        );
      }
    }

    const range = this.resolveRange(query.from, query.to);

    if (query.interval === SensorHistoryInterval.RAW) {
      return this.getRawShipmentTelemetry(
        {
          shipmentId: query.shipmentId,
          deviceId: query.deviceId,
          from: range.from,
          to: range.to,
        },
        query.page,
        query.limit,
      );
    }

    return this.getShipmentTelemetryAggregation(
      {
        shipmentId: query.shipmentId,
        deviceId: query.deviceId,
        from: range.from,
        to: range.to,
      },
      query.interval,
    );
  }

  async getShipmentSummary(
    query: ShipmentTelemetryQueryDto,
    actor: Actor,
  ) {
    const interval =
      query.interval === SensorHistoryInterval.DAY
        ? SensorHistoryInterval.DAY
        : SensorHistoryInterval.HOUR;

    return this.getShipmentTelemetry(
      {
        ...query,
        interval,
      },
      actor,
    );
  }

  private async resolveReadingScope(
    query: SensorHistoryQueryDto,
    actor: Actor,
  ): Promise<{
    cycleId: string;
    from?: string;
    to?: string;
  }> {
    if (!query.cycleId && !query.harvestId && !query.deviceId) {
      throw new UnprocessableEntityException(
        'Phải cung cấp cycleId, harvestId hoặc deviceId',
      );
    }

    let cycleId = query.cycleId;
    let from = query.from;
    let to = query.to;

    if (query.harvestId) {
      const harvest = await this.prisma.harvestEvent.findUnique({
        where: {
          id: query.harvestId,
        },
        include: {
          finalSensorDigest: {
            select: {
              periodStart: true,
              periodEnd: true,
            },
          },
        },
      });

      if (!harvest) {
        throw new NotFoundException('Không tìm thấy lần thu hoạch');
      }

      if (cycleId && cycleId !== harvest.cycleId) {
        throw new UnprocessableEntityException(
          'Lần thu hoạch không thuộc vụ trồng đã chọn',
        );
      }

      cycleId = harvest.cycleId;

      if (harvest.finalSensorDigest) {
        from ??= harvest.finalSensorDigest.periodStart.toISOString();
        to ??= harvest.finalSensorDigest.periodEnd.toISOString();
      } else if (!from || !to) {
        throw new UnprocessableEntityException(
          'Lần thu hoạch chưa có sensor digest; cần cung cấp from và to',
        );
      }
    }

    if (query.deviceId) {
      const device = await this.assertDeviceAccess(
        query.deviceId,
        actor,
      );

      if (!device.cycleId) {
        throw new UnprocessableEntityException(
          'Thiết bị chưa được gắn với vụ trồng',
        );
      }

      if (cycleId && cycleId !== device.cycleId) {
        throw new UnprocessableEntityException(
          'Thiết bị không thuộc vụ trồng đã chọn',
        );
      }

      cycleId ??= device.cycleId;
    }

    if (!cycleId) {
      throw new UnprocessableEntityException(
        'Không xác định được vụ trồng cần tra cứu',
      );
    }

    await this.access.assertProductionCycleAccess(actor, cycleId);

    return {
      cycleId,
      from,
      to,
    };
  }

  private async assertDeviceAccess(
    deviceId: string,
    actor: Actor,
  ) {
    const device = await this.prisma.iotDevice.findUnique({
      where: {
        id: deviceId,
      },
      select: {
        id: true,
        organizationId: true,
        cycleId: true,
      },
    });

    if (!device) {
      throw new NotFoundException('Không tìm thấy thiết bị');
    }

    if (
      !['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role) &&
      actor.organizationId !== device.organizationId
    ) {
      throw new ForbiddenException(
        'Không có quyền xem dữ liệu của thiết bị này',
      );
    }

    return device;
  }

  private resolveRange(
    fromValue?: string,
    toValue?: string,
  ): {
    from?: Date;
    to?: Date;
  } {
    const from = fromValue ? new Date(fromValue) : undefined;
    const to = toValue ? new Date(toValue) : undefined;

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

  private async getRawReadings(
    filter: {
      cycleId: string;
      deviceId?: string;
      sensorType?: string;
      from?: Date;
      to?: Date;
    },
    pageValue?: number,
    limitValue?: number,
  ) {
    const page = pageValue ?? 1;
    const limit = limitValue ?? 100;
    const skip = (page - 1) * limit;

    const where: Prisma.SensorReadingWhereInput = {
      cycleId: filter.cycleId,
      deviceId: filter.deviceId,
      sensorType: filter.sensorType,
      recordedAt:
        filter.from || filter.to
          ? {
              gte: filter.from,
              lte: filter.to,
            }
          : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.sensorReading.findMany({
        where,
        select: {
          id: true,
          cycleId: true,
          deviceId: true,
          sensorType: true,
          value: true,
          unit: true,
          recordedAt: true,
          ingestTime: true,
        },
        orderBy: {
          recordedAt: 'asc',
        },
        skip,
        take: limit,
      }),
      this.prisma.sensorReading.count({
        where,
      }),
    ]);

    return {
      mode: SensorHistoryInterval.RAW,
      items: items.map((item) => ({
        ...item,
        value: Number(item.value),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private async getRawShipmentTelemetry(
    filter: {
      shipmentId: string;
      deviceId?: string;
      from?: Date;
      to?: Date;
    },
    pageValue?: number,
    limitValue?: number,
  ) {
    const page = pageValue ?? 1;
    const limit = limitValue ?? 100;
    const skip = (page - 1) * limit;

    const where: Prisma.ShipmentTelemetryWhereInput = {
      shipmentId: filter.shipmentId,
      deviceId: filter.deviceId,
      recordedAt:
        filter.from || filter.to
          ? {
              gte: filter.from,
              lte: filter.to,
            }
          : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.shipmentTelemetry.findMany({
        where,
        select: {
          id: true,
          shipmentId: true,
          deviceId: true,
          latitude: true,
          longitude: true,
          accuracy: true,
          speed: true,
          heading: true,
          temperature: true,
          humidity: true,
          battery: true,
          validityStatus: true,
          anomalyNote: true,
          recordedAt: true,
          ingestTime: true,
        },
        orderBy: {
          recordedAt: 'asc',
        },
        skip,
        take: limit,
      }),
      this.prisma.shipmentTelemetry.count({
        where,
      }),
    ]);

    return {
      mode: SensorHistoryInterval.RAW,
      items: items.map((item) => ({
        ...item,
        latitude: Number(item.latitude),
        longitude: Number(item.longitude),
        accuracy:
          item.accuracy == null ? null : Number(item.accuracy),
        speed: item.speed == null ? null : Number(item.speed),
        heading:
          item.heading == null ? null : Number(item.heading),
        temperature:
          item.temperature == null
            ? null
            : Number(item.temperature),
        humidity:
          item.humidity == null ? null : Number(item.humidity),
        battery:
          item.battery == null ? null : Number(item.battery),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private async getReadingAggregation(
    filter: {
      cycleId: string;
      deviceId?: string;
      sensorType?: string;
      from?: Date;
      to?: Date;
    },
    interval: SensorHistoryInterval.HOUR | SensorHistoryInterval.DAY,
  ) {
    const bucket =
      interval === SensorHistoryInterval.DAY
        ? Prisma.raw(`date_trunc('day', "recorded_at")`)
        : Prisma.raw(`date_trunc('hour', "recorded_at")`);

    const conditions: Prisma.Sql[] = [
      Prisma.sql`"cycle_id" = ${filter.cycleId}::uuid`,
    ];

    if (filter.deviceId) {
      conditions.push(
        Prisma.sql`"device_id" = ${filter.deviceId}::uuid`,
      );
    }

    if (filter.sensorType) {
      conditions.push(
        Prisma.sql`"sensor_type" = ${filter.sensorType}`,
      );
    }

    if (filter.from) {
      conditions.push(
        Prisma.sql`"recorded_at" >= ${filter.from}`,
      );
    }

    if (filter.to) {
      conditions.push(
        Prisma.sql`"recorded_at" <= ${filter.to}`,
      );
    }

    const rows = await this.prisma.$queryRaw<
      SensorAggregateRow[]
    >(Prisma.sql`
      SELECT
        ${bucket} AS "bucket",
        "sensor_type" AS "sensorType",
        "unit",
        COUNT(*) AS "readingCount",
        MIN("value") AS "minimum",
        MAX("value") AS "maximum",
        AVG("value") AS "average"
      FROM "sensor_reading"
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY
        ${bucket},
        "sensor_type",
        "unit"
      ORDER BY "bucket" ASC
    `);

    return {
      mode: interval,
      interval,
      series: rows.map((row) => ({
        bucket: row.bucket,
        sensorType: row.sensorType,
        unit: row.unit,
        count: Number(row.readingCount),
        min:
          row.minimum == null ? null : Number(row.minimum),
        max:
          row.maximum == null ? null : Number(row.maximum),
        avg:
          row.average == null ? null : Number(row.average),
      })),
    };
  }

  private async getShipmentTelemetryAggregation(
    filter: {
      shipmentId: string;
      deviceId?: string;
      from?: Date;
      to?: Date;
    },
    interval: SensorHistoryInterval.HOUR | SensorHistoryInterval.DAY,
  ) {
    const bucket =
      interval === SensorHistoryInterval.DAY
        ? Prisma.raw(`date_trunc('day', "recorded_at")`)
        : Prisma.raw(`date_trunc('hour', "recorded_at")`);

    const conditions: Prisma.Sql[] = [
      Prisma.sql`"shipment_id" = ${filter.shipmentId}::uuid`,
    ];

    if (filter.deviceId) {
      conditions.push(
        Prisma.sql`"device_id" = ${filter.deviceId}::uuid`,
      );
    }

    if (filter.from) {
      conditions.push(
        Prisma.sql`"recorded_at" >= ${filter.from}`,
      );
    }

    if (filter.to) {
      conditions.push(
        Prisma.sql`"recorded_at" <= ${filter.to}`,
      );
    }

    const rows = await this.prisma.$queryRaw<
      TelemetryAggregateRow[]
    >(Prisma.sql`
      SELECT
        ${bucket} AS "bucket",
        COUNT(*) AS "readingCount",
        MIN("temperature") AS "minimumTemperature",
        MAX("temperature") AS "maximumTemperature",
        AVG("temperature") AS "averageTemperature",
        MIN("humidity") AS "minimumHumidity",
        MAX("humidity") AS "maximumHumidity",
        AVG("humidity") AS "averageHumidity",
        AVG("speed") AS "averageSpeed",
        AVG("battery") AS "averageBattery"
      FROM "shipment_telemetry"
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY ${bucket}
      ORDER BY "bucket" ASC
    `);

    return {
      mode: interval,
      interval,
      series: rows.map((row) => ({
        bucket: row.bucket,
        count: Number(row.readingCount),
        temperature: {
          min:
            row.minimumTemperature == null
              ? null
              : Number(row.minimumTemperature),
          max:
            row.maximumTemperature == null
              ? null
              : Number(row.maximumTemperature),
          avg:
            row.averageTemperature == null
              ? null
              : Number(row.averageTemperature),
        },
        humidity: {
          min:
            row.minimumHumidity == null
              ? null
              : Number(row.minimumHumidity),
          max:
            row.maximumHumidity == null
              ? null
              : Number(row.maximumHumidity),
          avg:
            row.averageHumidity == null
              ? null
              : Number(row.averageHumidity),
        },
        averageSpeed:
          row.averageSpeed == null
            ? null
            : Number(row.averageSpeed),
        averageBattery:
          row.averageBattery == null
            ? null
            : Number(row.averageBattery),
      })),
    };
  }
}