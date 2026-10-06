import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Actor } from '../trace/trace.service.js';
import { TraceService } from '../trace/trace.service.js';
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
        : { organizationId: actor.organizationId ?? undefined },
      include: {
        organization: { select: { id: true, name: true, type: true } },
        cycle: { select: { id: true, cycleCode: true, currentState: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createDevice(input: CreateIotDeviceDto, actor: Actor) {
    if (
      actor.role !== 'SYSTEM_ADMIN' &&
      actor.organizationId !== input.organizationId
    )
      throw new ForbiddenException(
        'Không có quyền đăng ký thiết bị cho tổ chức',
      );
    if (input.cycleId) {
      const cycle = await this.prisma.productionCycle.findUnique({
        where: { id: input.cycleId },
      });
      if (!cycle || cycle.farmOrgId !== input.organizationId)
        throw new UnprocessableEntityException(
          'Chu kỳ không thuộc tổ chức đăng ký thiết bị',
        );
    }
    return this.prisma.iotDevice.create({
      data: {
        organizationId: input.organizationId,
        cycleId: input.cycleId,
        deviceCode: input.deviceCode.trim(),
        name: input.name.trim(),
        type: input.type.trim(),
      },
    });
  }

  async ingest(input: IngestSensorReadingDto, authenticatedActor?: Actor) {
    const device = await this.findDevice(input.deviceId);
    if (device.cycleId !== input.cycleId)
      throw new UnprocessableEntityException(
        'Thiết bị không thuộc chu kỳ đã khai báo',
      );
    if (
      authenticatedActor &&
      authenticatedActor.role !== 'SYSTEM_ADMIN' &&
      authenticatedActor.organizationId !== device.organizationId
    )
      throw new ForbiddenException(
        'Không có quyền gửi dữ liệu cho thiết bị này',
      );
    const cycle = await this.prisma.productionCycle.findUnique({
      where: { id: input.cycleId },
    });
    if (!cycle || !['PLANTED', 'GROWING'].includes(cycle.currentState))
      throw new UnprocessableEntityException(
        'Chu kỳ không ở trạng thái nhận dữ liệu cảm biến',
      );

    // Raw readings remain off-chain. Only explicit aggregate digests create a
    // TraceEvent/BlockchainProof, preventing high-frequency IoT ledger spam.
    const reading = await this.prisma.$transaction(async (tx) => {
      const created = await tx.sensorReading.create({
        data: {
          deviceId: device.id,
          cycleId: input.cycleId,
          sensorType: input.sensorType,
          value: input.value,
          unit: input.unit,
          recordedAt: new Date(input.recordedAt),
        },
      });
      await tx.iotDevice.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date() },
      });
      return created;
    });
    return { status: 'accepted', readingId: reading.id };
  }

  async createSensorDigest(
    cycleId: string,
    input: CreateSensorDigestDto,
    actor: Actor,
  ) {
    await this.assertCycleOwner(cycleId, actor);
    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);
    this.assertPeriod(periodStart, periodEnd);
    const readings = await this.prisma.sensorReading.findMany({
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
    return this.prisma.$transaction(async (tx) => {
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
    const device = await this.findDevice(input.deviceId);
    const binding = await this.prisma.shipmentTrackingBinding.findFirst({
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
    if (!['CREATED', 'IN_TRANSIT', 'ARRIVED'].includes(binding.shipment.status))
      throw new ConflictException(
        'Chuyến hàng không còn nhận dữ liệu giám sát',
      );
    if (
      authenticatedActor &&
      authenticatedActor.role !== 'SYSTEM_ADMIN' &&
      authenticatedActor.organizationId !== binding.transporterOrgId
    )
      throw new ForbiddenException(
        'Không có quyền gửi telemetry cho chuyến hàng này',
      );
    if (Math.abs(input.latitude) > 90 || Math.abs(input.longitude) > 180)
      throw new UnprocessableEntityException('Tọa độ không hợp lệ');

    const telemetry = await this.prisma.shipmentTelemetry.create({
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
        recordedAt: new Date(input.recordedAt),
        validityStatus: 'VALID',
      },
    });
    return { status: 'accepted', telemetryId: telemetry.id };
  }

  async bindShipmentDevice(
    shipmentId: string,
    input: BindShipmentDeviceDto,
    actor: Actor,
  ) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
    });
    if (!shipment) throw new NotFoundException('Không tìm thấy chuyến hàng');
    if (
      actor.role !== 'SYSTEM_ADMIN' &&
      actor.organizationId !== shipment.transporterOrgId
    )
      throw new ForbiddenException('Không có quyền gắn thiết bị chuyến hàng');
    const device = await this.findDevice(input.deviceId);
    if (device.organizationId !== shipment.transporterOrgId)
      throw new ForbiddenException(
        'Thiết bị không thuộc đơn vị vận chuyển của chuyến hàng',
      );
    return this.prisma.$transaction(async (tx) => {
      const binding = await tx.shipmentTrackingBinding.create({
        data: {
          shipmentId,
          deviceId: device.id,
          transporterOrgId: shipment.transporterOrgId,
          boundBy: actor.sub,
          note: input.note,
        },
      });
      await this.trace.createInTransaction(tx, {
        entityType: 'SHIPMENT',
        entityId: shipmentId,
        lotId: shipment.lotId,
        eventType: 'TRACKING_DEVICE_BOUND',
        actor,
        businessData: { deviceId: device.id, deviceCode: device.deviceCode },
      });
      return binding;
    });
  }

  async unbindShipmentDevice(
    shipmentId: string,
    deviceId: string,
    actor: Actor,
  ) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
    });
    if (!shipment) throw new NotFoundException('Không tìm thấy chuyến hàng');
    if (
      actor.role !== 'SYSTEM_ADMIN' &&
      actor.organizationId !== shipment.transporterOrgId
    )
      throw new ForbiddenException('Không có quyền tháo thiết bị chuyến hàng');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.shipmentTrackingBinding.updateMany({
        where: { shipmentId, deviceId, status: 'ACTIVE', unboundAt: null },
        data: { status: 'INACTIVE', unboundAt: new Date() },
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
        businessData: { deviceId },
      });
      return { unbound: true };
    });
  }

  async createTelemetryDigest(
    shipmentId: string,
    input: CreateTelemetryDigestDto,
    actor: Actor,
  ) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
    });
    if (!shipment) throw new NotFoundException('Không tìm thấy chuyến hàng');
    if (
      actor.role !== 'SYSTEM_ADMIN' &&
      actor.organizationId !== shipment.transporterOrgId
    )
      throw new ForbiddenException('Không có quyền tạo telemetry digest');
    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);
    this.assertPeriod(periodStart, periodEnd);
    const readings = await this.prisma.shipmentTelemetry.findMany({
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
    return this.prisma.$transaction(async (tx) => {
      if (
        await tx.shipmentTelemetryDigest.findFirst({
          where: { shipmentId, periodStart, periodEnd },
        })
      )
        throw new ConflictException(
          'Digest cho khoảng thời gian này đã tồn tại',
        );
      const previous = await tx.shipmentTelemetryDigest.findFirst({
        where: { shipmentId },
        orderBy: { periodEnd: 'desc' },
      });
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
    const cycle = await this.prisma.productionCycle.findUnique({
      where: { id: cycleId },
      select: { farmOrgId: true },
    });
    if (!cycle) throw new NotFoundException('Không tìm thấy chu kỳ sản xuất');
    if (
      actor.role !== 'SYSTEM_ADMIN' &&
      actor.organizationId !== cycle.farmOrgId
    )
      throw new ForbiddenException('Không có quyền tạo sensor digest');
  }

  private assertPeriod(periodStart: Date, periodEnd: Date) {
    if (periodStart >= periodEnd)
      throw new UnprocessableEntityException(
        'Khoảng thời gian digest không hợp lệ',
      );
  }

  private async findDevice(deviceId: string) {
    const device = await this.prisma.iotDevice.findFirst({
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
