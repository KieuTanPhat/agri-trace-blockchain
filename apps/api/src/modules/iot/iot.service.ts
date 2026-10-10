import {
  assertBusinessActor,
  FARM_WRITE_ROLES,
  TRANSPORT_WRITE_ROLES,
} from '../auth/business-write.policy.js';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import { businessTimestamp } from '../../common/timestamp.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  commandTransaction,
  lockAggregate,
} from '../../common/idempotency/command-transaction.js';
import type { Actor } from '../trace/trace.service.js';
import { TraceService } from '../trace/trace.service.js';
import {
  validateSensorTime,
  markLateReading,
} from './harvest-sensor-window.js';
import type {
  CreateSensorDigestDto,
  CreateTelemetryDigestDto,
  BindShipmentDeviceDto,
  CreateIotDeviceDto,
  IngestSensorReadingDto,
  IngestShipmentTelemetryDto,
} from './dto.js';

@Injectable()
export class IotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trace: TraceService,
  ) {}

  listDevices(actor: Actor) {
    return this.prisma.iotDevice.findMany({
      where: ['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role)
        ? undefined
        : {
            organizationId:
              actor.organizationId ?? '00000000-0000-0000-0000-000000000000',
          },
      include: {
        organization: { select: { id: true, name: true, type: true } },
        cycle: { select: { id: true, cycleCode: true, currentState: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createDevice(input: CreateIotDeviceDto, actor: Actor) {
    assertBusinessActor(actor, ['SYSTEM_ADMIN', 'FARM_STAFF', 'TRANSPORTER']);
    return commandTransaction(this.prisma, async (tx) => {
      if (
        actor.role !== 'SYSTEM_ADMIN' &&
        actor.organizationId !== input.organizationId
      )
        throw new ForbiddenException(
          'Không có quyền đăng ký thiết bị cho tổ chức',
        );
      if (
        !(await tx.organization.findFirst({
          where: { id: input.organizationId },
        }))
      ) {
        throw new UnprocessableEntityException('Organization does not exist');
      }
      if (input.cycleId) {
        const cycle = await tx.productionCycle.findUnique({
          where: { id: input.cycleId },
        });
        if (!cycle || cycle.farmOrgId !== input.organizationId)
          throw new UnprocessableEntityException(
            'Chu kỳ không thuộc tổ chức đăng ký thiết bị',
          );
      }
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: input.organizationId },
      });
      if (
        organization.status !== 'ACTIVE' ||
        !['FARM', 'TRANSPORTER'].includes(organization.type) ||
        (input.cycleId && organization.type !== 'FARM')
      )
        throw new UnprocessableEntityException(
          'Tổ chức đăng ký thiết bị không hợp lệ',
        );
      return tx.iotDevice.create({
        data: {
          organizationId: input.organizationId,
          cycleId: input.cycleId,
          deviceCode: input.deviceCode.trim(),
          name: input.name.trim(),
          type: input.type.trim(),
        },
      });
    });
  }

  async ingest(input: IngestSensorReadingDto, authenticatedActor?: Actor) {
    if (authenticatedActor)
      assertBusinessActor(authenticatedActor, FARM_WRITE_ROLES);
    return commandTransaction(this.prisma, async (tx) => {
      await lockAggregate(tx, 'cycle', input.cycleId);
      const device = await this.findDevice(input.deviceId, tx);
      if (device.cycleId !== input.cycleId)
        throw new UnprocessableEntityException(
          'Thiết bị không thuộc chu kỳ đã khai báo',
        );
      if (
        authenticatedActor &&
        authenticatedActor.organizationId !== device.organizationId
      )
        throw new ForbiddenException(
          'Không có quyền gửi dữ liệu cho thiết bị này',
        );
      const cycle = await tx.productionCycle.findUnique({
        where: { id: input.cycleId },
      });
      if (!cycle || !['PLANTED', 'GROWING'].includes(cycle.currentState))
        throw new UnprocessableEntityException(
          'Chu kỳ không ở trạng thái nhận dữ liệu cảm biến',
        );

      // Raw readings remain off-chain. Only explicit aggregate digests create a
      // TraceEvent/BlockchainProof, preventing high-frequency IoT ledger spam.
      const recordedAt = businessTimestamp(
        input.recordedAt,
        'Thời gian cảm biến',
      );
      await validateSensorTime(tx, input.cycleId, recordedAt);
      const created = await tx.sensorReading.create({
        data: {
          deviceId: device.id,
          cycleId: input.cycleId,
          sensorType: input.sensorType,
          value: input.value,
          unit: input.unit,
          recordedAt,
        },
      });
      await tx.iotDevice.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date() },
      });
      const late = await markLateReading(tx, created);
      return { status: 'accepted', readingId: created.id, late };
    });
  }

  async createSensorDigest(
    cycleId: string,
    input: CreateSensorDigestDto,
    actor: Actor,
  ) {
    await this.assertCycleOwner(cycleId, actor);
    return commandTransaction(this.prisma, async (tx) => {
      await lockAggregate(tx, 'cycle', cycleId);
      const periodStart = businessTimestamp(
        input.periodStart,
        'Đầu khoảng cảm biến',
      );
      const periodEnd = businessTimestamp(
        input.periodEnd,
        'Cuối khoảng cảm biến',
      );
      this.assertPeriod(periodStart, periodEnd);
      const readings = await tx.sensorReading.findMany({
        where: { cycleId, recordedAt: { gte: periodStart, lte: periodEnd } },
        orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
      });
      if (!readings.length)
        throw new UnprocessableEntityException(
          'Không có dữ liệu cảm biến trong khoảng đã chọn',
        );
      const digestHash = canonicalSha256({
        schemaVersion: 'sensor-digest-1',
        cycleId,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        readings: readings.map((reading) => ({
          id: reading.id,
          deviceId: reading.deviceId,
          sensorType: reading.sensorType,
          value: reading.value.toString(),
          unit: reading.unit,
          recordedAt: reading.recordedAt.toISOString(),
        })),
      });
      if (
        await tx.sensorDigest.findFirst({
          where: { cycleId, periodStart, periodEnd },
        })
      )
        throw new ConflictException(
          'Digest cho khoảng thời gian này đã tồn tại',
        );
      if (
        input.isFinal &&
        (await tx.sensorDigest.findFirst({ where: { cycleId, isFinal: true } }))
      )
        throw new ConflictException('Chu kỳ đã có digest cuối cùng');
      const digest = await tx.sensorDigest.create({
        data: {
          cycleId,
          periodStart,
          periodEnd,
          readingCount: readings.length,
          digestHash,
          isFinal: input.isFinal ?? false,
        },
      });
      await this.trace.createInTransaction(tx, {
        entityType: 'SENSOR_DIGEST',
        entityId: digest.id,
        cycleId,
        eventType: input.isFinal
          ? 'SENSOR_DIGEST_FINALIZED'
          : 'SENSOR_DIGEST_CREATED',
        actor,
        businessData: {
          digestHash,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          readingCount: readings.length,
          isFinal: input.isFinal ?? false,
        },
      });
      return digest;
    });
  }

  async ingestShipmentTelemetry(
    shipmentId: string,
    input: IngestShipmentTelemetryDto,
    idempotencyKey?: string,
    authenticatedActor?: Actor,
  ) {
    if (authenticatedActor)
      assertBusinessActor(authenticatedActor, TRANSPORT_WRITE_ROLES);
    return commandTransaction(this.prisma, async (tx) => {
      const shipment = await tx.shipment.findUnique({
        where: { id: shipmentId },
      });
      if (!shipment) throw new NotFoundException('Không tìm thấy chuyến hàng');
      await lockAggregate(tx, 'lot', shipment.lotId);
      const device = await this.findDevice(input.deviceId, tx);
      const binding = await tx.shipmentTrackingBinding.findFirst({
        where: {
          shipmentId,
          deviceId: device.id,
          status: 'ACTIVE',
          unboundAt: null,
        },
        include: { shipment: true },
      });
      if (!binding)
        throw new UnprocessableEntityException(
          'Thiết bị chưa được gắn với chuyến vận chuyển',
        );
      if (binding.shipment.status !== 'IN_TRANSIT')
        throw new ConflictException(
          'Chuyến hàng không còn nhận dữ liệu giám sát',
        );
      const recordedAt = businessTimestamp(
        input.recordedAt,
        'Thời gian telemetry',
        { notBefore: binding.boundAt },
      );
      if (
        input.deviceSequence !== undefined &&
        (!Number.isSafeInteger(input.deviceSequence) ||
          input.deviceSequence < 0)
      )
        throw new UnprocessableEntityException(
          'deviceSequence phải là số nguyên an toàn, không âm',
        );
      if (
        authenticatedActor &&
        authenticatedActor.organizationId !== binding.transporterOrgId
      )
        throw new ForbiddenException(
          'Không có quyền gửi telemetry cho chuyến hàng này',
        );
      if (Math.abs(input.latitude) > 90 || Math.abs(input.longitude) > 180)
        throw new UnprocessableEntityException('Tọa độ không hợp lệ');

      const telemetry = await tx.shipmentTelemetry.create({
        data: {
          shipmentId,
          deviceId: device.id,
          bindingId: binding.id,
          deviceSequence:
            input.deviceSequence === undefined
              ? undefined
              : BigInt(input.deviceSequence),
          idempotencyKey,
          latitude: input.latitude,
          longitude: input.longitude,
          accuracy: input.accuracy,
          speed: input.speed,
          heading: input.heading,
          temperature: input.temperature,
          humidity: input.humidity,
          battery: input.battery,
          recordedAt,
          validityStatus: 'VALID',
        },
      });
      return { status: 'accepted', telemetryId: telemetry.id };
    });
  }

  async bindShipmentDevice(
    shipmentId: string,
    input: BindShipmentDeviceDto,
    actor: Actor,
  ) {
    assertBusinessActor(actor, TRANSPORT_WRITE_ROLES);
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
    });
    if (!shipment) throw new NotFoundException('Không tìm thấy chuyến hàng');
    if (actor.organizationId !== shipment.transporterOrgId)
      throw new ForbiddenException('Không có quyền gắn thiết bị chuyến hàng');
    const device = await this.findDevice(input.deviceId);
    if (device.organizationId !== shipment.transporterOrgId)
      throw new ForbiddenException(
        'Thiết bị không thuộc đơn vị vận chuyển của chuyến hàng',
      );
    return commandTransaction(this.prisma, async (tx) => {
      await lockAggregate(tx, 'lot', shipment.lotId);
      const current = await tx.shipment.findUniqueOrThrow({
        where: { id: shipmentId },
      });
      const activeDevice = await this.findDevice(input.deviceId, tx);
      if (activeDevice.organizationId !== current.transporterOrgId)
        throw new ConflictException('Thiết bị không thuộc đơn vị vận chuyển');
      const binding = await tx.shipmentTrackingBinding.create({
        data: {
          shipmentId,
          deviceId: device.id,
          transporterOrgId: shipment.transporterOrgId,
          boundBy: actor.sub,
          // Match the millisecond precision advertised by the JSON contract;
          // a DB now() microsecond default can be later than its serialized value.
          boundAt: new Date(),
          note: input.note,
        },
      });
      await this.trace.createInTransaction(tx, {
        entityType: 'SHIPMENT',
        entityId: shipmentId,
        lotId: shipment.lotId,
        eventType: 'TRACKING_DEVICE_BOUND',
        actor,
        eventTime: binding.boundAt,
        businessData: {
          bindingId: binding.id,
          deviceId: device.id,
          deviceCode: device.deviceCode,
          boundAt: binding.boundAt.toISOString(),
        },
      });
      return binding;
    });
  }

  async unbindShipmentDevice(
    shipmentId: string,
    deviceId: string,
    actor: Actor,
  ) {
    assertBusinessActor(actor, TRANSPORT_WRITE_ROLES);
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
    });
    if (!shipment) throw new NotFoundException('Không tìm thấy chuyến hàng');
    if (actor.organizationId !== shipment.transporterOrgId)
      throw new ForbiddenException('Không có quyền tháo thiết bị chuyến hàng');
    return commandTransaction(this.prisma, async (tx) => {
      await lockAggregate(tx, 'lot', shipment.lotId);
      const unboundAt = new Date();
      const updated = await tx.shipmentTrackingBinding.updateMany({
        where: { shipmentId, deviceId, status: 'ACTIVE', unboundAt: null },
        data: { status: 'INACTIVE', unboundAt },
      });
      if (updated.count !== 1)
        throw new NotFoundException(
          'Không tìm thấy liên kết thiết bị đang hoạt động',
        );
      await this.trace.createInTransaction(tx, {
        entityType: 'SHIPMENT',
        entityId: shipmentId,
        lotId: shipment.lotId,
        eventType: 'TRACKING_DEVICE_UNBOUND',
        actor,
        eventTime: unboundAt,
        businessData: { deviceId, unboundAt: unboundAt.toISOString() },
      });
      return { unbound: true };
    });
  }

  async createTelemetryDigest(
    shipmentId: string,
    input: CreateTelemetryDigestDto,
    actor: Actor,
  ) {
    assertBusinessActor(actor, TRANSPORT_WRITE_ROLES);
    return commandTransaction(this.prisma, async (tx) => {
      const shipment = await tx.shipment.findUnique({
        where: { id: shipmentId },
      });
      if (!shipment) throw new NotFoundException('Không tìm thấy chuyến hàng');
      await lockAggregate(tx, 'lot', shipment.lotId);
      if (actor.organizationId !== shipment.transporterOrgId)
        throw new ForbiddenException('Không có quyền tạo telemetry digest');
      const periodStart = businessTimestamp(
        input.periodStart,
        'Đầu khoảng telemetry',
      );
      const periodEnd = businessTimestamp(
        input.periodEnd,
        'Cuối khoảng telemetry',
      );
      this.assertPeriod(periodStart, periodEnd);
      const readings = await tx.shipmentTelemetry.findMany({
        where: { shipmentId, recordedAt: { gte: periodStart, lte: periodEnd } },
        orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
      });
      if (!readings.length)
        throw new UnprocessableEntityException(
          'Không có telemetry trong khoảng đã chọn',
        );
      const digestHash = canonicalSha256({
        schemaVersion: 'shipment-telemetry-digest-1',
        shipmentId,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        readings: readings.map((item) => ({
          id: item.id,
          deviceId: item.deviceId,
          latitude: item.latitude.toString(),
          longitude: item.longitude.toString(),
          temperature: item.temperature?.toString() ?? null,
          humidity: item.humidity?.toString() ?? null,
          recordedAt: item.recordedAt.toISOString(),
        })),
      });
      if (
        await tx.shipmentTelemetryDigest.findFirst({
          where: { shipmentId, periodStart, periodEnd },
        })
      )
        throw new ConflictException(
          'Digest cho khoảng thời gian này đã tồn tại',
        );
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telemetry-digest:${shipmentId}`}, 0))`;
      const heads = await tx.$queryRaw<
        Array<{ digestHash: string }>
      >(Prisma.sql`
        SELECT digest.digest_hash AS "digestHash"
        FROM shipment_telemetry_digest digest
        WHERE digest.shipment_id = ${shipmentId}::uuid
          AND NOT EXISTS (
            SELECT 1 FROM shipment_telemetry_digest successor
            WHERE successor.shipment_id = digest.shipment_id
              AND successor.previous_digest_hash = digest.digest_hash
          )
        LIMIT 2
      `);
      if (heads.length > 1)
        throw new ConflictException(
          'Telemetry digest chain has multiple heads',
        );
      const previous = heads[0];
      if (
        input.isFinal &&
        (await tx.shipmentTelemetryDigest.findFirst({
          where: { shipmentId, isFinal: true },
        }))
      )
        throw new ConflictException('Chuyến hàng đã có digest cuối cùng');
      const first = readings[0];
      const last = readings.at(-1)!;
      const digest = await tx.shipmentTelemetryDigest.create({
        data: {
          shipmentId,
          deviceId: first.deviceId,
          periodStart,
          periodEnd,
          readingCount: readings.length,
          firstLatitude: first.latitude,
          firstLongitude: first.longitude,
          lastLatitude: last.latitude,
          lastLongitude: last.longitude,
          digestHash,
          previousDigestHash: previous?.digestHash,
          isFinal: input.isFinal ?? false,
        },
      });
      await this.trace.createInTransaction(tx, {
        entityType: 'SHIPMENT_TELEMETRY',
        entityId: shipmentId,
        lotId: shipment.lotId,
        eventType: input.isFinal
          ? 'SHIPMENT_TELEMETRY_DIGEST_FINALIZED'
          : 'SHIPMENT_TELEMETRY_DIGEST_CREATED',
        actor,
        businessData: {
          digestHash,
          previousDigestHash: previous?.digestHash ?? null,
          readingCount: readings.length,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
        },
      });
      return digest;
    });
  }

  private async assertCycleOwner(cycleId: string, actor: Actor) {
    assertBusinessActor(actor, FARM_WRITE_ROLES);
    const cycle = await this.prisma.productionCycle.findUnique({
      where: { id: cycleId },
      select: { farmOrgId: true },
    });
    if (!cycle) throw new NotFoundException('Không tìm thấy chu kỳ sản xuất');
    if (actor.organizationId !== cycle.farmOrgId)
      throw new ForbiddenException('Không có quyền tạo sensor digest');
  }

  private assertPeriod(periodStart: Date, periodEnd: Date) {
    if (periodStart >= periodEnd)
      throw new UnprocessableEntityException(
        'Khoảng thời gian digest không hợp lệ',
      );
  }

  private async findDevice(
    deviceId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const device = await db.iotDevice.findFirst({
      where: isUUID(deviceId)
        ? { OR: [{ id: deviceId }, { deviceCode: deviceId }] }
        : { deviceCode: deviceId },
    });
    if (!device || device.status !== 'ACTIVE')
      throw new UnprocessableEntityException(
        'Thiết bị không tồn tại hoặc không hoạt động',
      );
    return device;
  }
}
