import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { enterpriseAuthority } from '../enterprise-workspace/enterprise-policy.js';
import { scopedCycleReadWhere } from '../supply-chains/business-read-scope.js';
import type {
  BindDeviceInput,
  DeviceStatusInput,
  RegisterDeviceInput,
  RotateDeviceKeyInput,
} from './device-dto.js';

/** A device that reported within this window is shown as online. */
export const DEVICE_ONLINE_MS = 10 * 60_000;
const RUNNING_STATES = ['PLANTED', 'GROWING'] as const;

const DEVICE_SELECT = {
  id: true,
  deviceCode: true,
  name: true,
  type: true,
  status: true,
  simulated: true,
  authorityRevision: true,
  lastSeenAt: true,
  createdAt: true,
  plotId: true,
  vehicleId: true,
  publicKey: true,
  plot: { select: { id: true, name: true, farm: { select: { id: true, name: true } } } },
  vehicle: { select: { id: true, registration: true, kind: true } },
} satisfies Prisma.IotDeviceSelect;

/**
 * ADR-006 device registry. Devices belong to an enterprise and are bound to one
 * of its plots (field sensor) or vehicles (GPS tracker). The private key never
 * reaches the API; the device registers its Ed25519 public key.
 */
@Injectable()
export class DeviceRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: CommandActor) {
    await enterpriseAuthority(this.prisma, actor, 'devices.read');
    const devices = await this.prisma.iotDevice.findMany({
      where: {
        organizationId: actor.organizationId!,
        type: { in: ['FIELD_SENSOR', 'GPS_TRACKER'] },
      },
      select: DEVICE_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    const plotIds = devices.flatMap((d) => (d.plotId ? [d.plotId] : []));
    const vehicleIds = devices.flatMap((d) => (d.vehicleId ? [d.vehicleId] : []));
    const [cycles, transfers] = await Promise.all([
      this.prisma.productionCycle.findMany({
        where: { plotId: { in: plotIds }, farmOrgId: actor.organizationId!, currentState: { in: [...RUNNING_STATES] } },
        select: { id: true, cycleCode: true, plotId: true },
      }),
      this.prisma.distributionTransfer.findMany({
        where: { vehicleId: { in: vehicleIds }, status: 'IN_TRANSIT' },
        select: { id: true, vehicleId: true, origin: true, destination: true },
      }),
    ]);
    const now = Date.now();
    return {
      items: devices.map((d) => ({
        ...d,
        online: !!d.lastSeenAt && now - d.lastSeenAt.getTime() <= DEVICE_ONLINE_MS,
        runningCycles: cycles.filter((c) => c.plotId && c.plotId === d.plotId),
        activeTransfer: transfers.find((t) => t.vehicleId && t.vehicleId === d.vehicleId) ?? null,
      })),
    };
  }

  /** What one device is reporting now: latest values, recent records and context. */
  async detail(actor: CommandActor, id: string) {
    await enterpriseAuthority(this.prisma, actor, 'devices.read');
    const device = await this.prisma.iotDevice.findFirst({
      where: { id, organizationId: actor.organizationId!, type: { in: ['FIELD_SENSOR', 'GPS_TRACKER'] } },
      select: DEVICE_SELECT,
    });
    if (!device) throw new NotFoundException('Không tìm thấy thiết bị');
    const since = new Date(Date.now() - 24 * 3_600_000);
    const base = {
      ...device,
      online: !!device.lastSeenAt && Date.now() - device.lastSeenAt.getTime() <= DEVICE_ONLINE_MS,
      keyFingerprint: device.publicKey ? createHash('sha256').update(device.publicKey).digest('hex').slice(0, 16) : null,
    };
    if (device.type === 'FIELD_SENSOR') {
      // A plot reading is stored once per running cycle; show each sequence once.
      const rows = await this.prisma.sensorReading.findMany({
        where: { deviceId: id },
        orderBy: [{ recordedAt: 'desc' }, { deviceSequence: 'desc' }],
        take: 120,
        select: { deviceSequence: true, sensorType: true, value: true, unit: true, recordedAt: true, ingestTime: true, cycle: { select: { id: true, cycleCode: true } } },
      });
      const seen = new Map<string, { sequence: string | null; sensorType: string; value: number; unit: string; recordedAt: Date; ingestTime: Date; cycles: { id: string; cycleCode: string }[] }>();
      for (const r of rows) {
        const key = r.deviceSequence != null ? String(r.deviceSequence) : `${r.sensorType}:${r.recordedAt.toISOString()}`;
        const entry = seen.get(key);
        if (entry) entry.cycles.push(r.cycle);
        else seen.set(key, { sequence: r.deviceSequence != null ? String(r.deviceSequence) : null, sensorType: r.sensorType, value: Number(r.value.toString()), unit: r.unit, recordedAt: r.recordedAt, ingestTime: r.ingestTime, cycles: [r.cycle] });
      }
      const recent = [...seen.values()];
      const latest = ['TEMPERATURE', 'HUMIDITY', 'SOIL_MOISTURE'].flatMap((t) => {
        const r = recent.find((x) => x.sensorType === t);
        return r ? [{ sensorType: t, value: r.value, unit: r.unit, recordedAt: r.recordedAt }] : [];
      });
      const [runningCycles, last24h] = await Promise.all([
        device.plotId
          ? this.prisma.productionCycle.findMany({ where: { plotId: device.plotId, farmOrgId: actor.organizationId!, currentState: { in: [...RUNNING_STATES] } }, select: { id: true, cycleCode: true, currentState: true } })
          : [],
        this.prisma.sensorReading.findMany({ where: { deviceId: id, recordedAt: { gte: since } }, distinct: ['deviceSequence'], select: { id: true } }),
      ]);
      return { ...base, runningCycles, latest, recordsLast24h: last24h.length, recent: recent.slice(0, 30) };
    }
    const [activeTransfer, positions, last24h] = await Promise.all([
      device.vehicleId
        ? this.prisma.distributionTransfer.findFirst({ where: { vehicleId: device.vehicleId, status: 'IN_TRANSIT' }, select: { id: true, origin: true, destination: true, inTransitAt: true } })
        : null,
      this.prisma.distributionPosition.findMany({
        where: { deviceId: id },
        orderBy: [{ recordedAt: 'desc' }, { deviceSequence: 'desc' }],
        take: 30,
        select: { deviceSequence: true, recordedAt: true, receivedAt: true, latitude: true, longitude: true, accuracyM: true, speedKmh: true, heading: true, satellites: true, battery: true, validity: true, anomalyCode: true, transferId: true },
      }),
      this.prisma.distributionPosition.count({ where: { deviceId: id, recordedAt: { gte: since } } }),
    ]);
    const recent = positions.map((p) => ({
      sequence: String(p.deviceSequence),
      recordedAt: p.recordedAt,
      receivedAt: p.receivedAt,
      latitude: Number(p.latitude.toString()),
      longitude: Number(p.longitude.toString()),
      accuracyM: p.accuracyM == null ? null : Number(p.accuracyM.toString()),
      speedKmh: p.speedKmh == null ? null : Number(p.speedKmh.toString()),
      heading: p.heading == null ? null : Number(p.heading.toString()),
      satellites: p.satellites,
      battery: p.battery == null ? null : Number(p.battery.toString()),
      validity: p.validity,
      anomalyCode: p.anomalyCode,
      transferId: p.transferId,
    }));
    return { ...base, activeTransfer, latestPosition: recent.find((p) => p.validity === 'VALID') ?? null, recordsLast24h: last24h, recent };
  }

  /** Plots and vehicles this user may bind devices to. */
  async options(actor: CommandActor) {
    await enterpriseAuthority(this.prisma, actor, 'devices.read');
    const [plots, vehicles] = await Promise.all([
      this.prisma.plot.findMany({
        where: { farm: { organizationId: actor.organizationId! }, status: 'ACTIVE' },
        select: { id: true, name: true, farm: { select: { id: true, name: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.enterpriseVehicle.findMany({
        where: { organizationId: actor.organizationId!, status: 'ACTIVE' },
        select: { id: true, registration: true, kind: true },
        orderBy: { registration: 'asc' },
      }),
    ]);
    return { plots, vehicles };
  }

  register(actor: CommandActor, input: RegisterDeviceInput) {
    return commandTransaction(this.prisma, async (tx) => {
      await enterpriseAuthority(tx, actor, 'devices.manage', undefined, undefined, true);
      const binding = await this.assertBinding(tx, actor, input.kind, input.plotId ?? null, input.vehicleId ?? null);
      if (await tx.iotDevice.findUnique({ where: { deviceCode: input.deviceCode } }))
        throw new ConflictException('Mã thiết bị đã được đăng ký');
      if (await tx.iotDevice.findFirst({ where: { publicKey: input.publicKey } }))
        throw new ConflictException('Khóa công khai đã thuộc một thiết bị khác');
      const record = await tx.iotDevice.create({
        data: {
          organizationId: actor.organizationId!,
          deviceCode: input.deviceCode,
          name: input.name,
          type: input.kind,
          publicKey: input.publicKey,
          simulated: input.simulated,
          ...binding,
        },
        select: DEVICE_SELECT,
      });
      return { record };
    });
  }

  bind(actor: CommandActor, id: string, input: BindDeviceInput) {
    return commandTransaction(this.prisma, async (tx) => {
      await enterpriseAuthority(tx, actor, 'devices.manage', undefined, undefined, true);
      const device = await this.lockDevice(tx, actor, id, input.version);
      const binding = await this.assertBinding(tx, actor, device.type, input.plotId ?? null, input.vehicleId ?? null, true, id);
      if (device.vehicleId && device.vehicleId !== binding.vehicleId && (await tx.distributionTransfer.count({ where: { vehicleId: device.vehicleId, status: 'IN_TRANSIT' } })))
        throw new ConflictException('Xe đang chở hàng; tháo GPS sau khi phiếu được ký nhận');
      const record = await tx.iotDevice.update({ where: { id }, data: binding, select: DEVICE_SELECT });
      return { record };
    });
  }

  rotateKey(actor: CommandActor, id: string, input: RotateDeviceKeyInput) {
    return commandTransaction(this.prisma, async (tx) => {
      await enterpriseAuthority(tx, actor, 'devices.manage', undefined, undefined, true);
      const device = await this.lockDevice(tx, actor, id, input.version);
      if (device.publicKey === input.publicKey)
        throw new UnprocessableEntityException('Khóa mới trùng khóa hiện tại');
      if (await tx.iotDevice.findFirst({ where: { publicKey: input.publicKey, id: { not: id } } }))
        throw new ConflictException('Khóa công khai đã thuộc một thiết bị khác');
      const record = await tx.iotDevice.update({ where: { id }, data: { publicKey: input.publicKey }, select: DEVICE_SELECT });
      return { record };
    });
  }

  setStatus(actor: CommandActor, id: string, input: DeviceStatusInput) {
    return commandTransaction(this.prisma, async (tx) => {
      await enterpriseAuthority(tx, actor, 'devices.manage', undefined, undefined, true);
      const device = await this.lockDevice(tx, actor, id, input.version);
      if (device.status === input.status)
        throw new ConflictException('Thiết bị đã ở trạng thái này');
      if (input.status === 'ACTIVE' && device.vehicleId && (await tx.iotDevice.count({ where: { vehicleId: device.vehicleId, status: 'ACTIVE', id: { not: id } } })))
        throw new ConflictException('Xe đã có GPS khác đang hoạt động');
      const record = await tx.iotDevice.update({ where: { id }, data: { status: input.status }, select: DEVICE_SELECT });
      return { record };
    });
  }

  /** Readings of one cycle grouped by sensor type, averaged per time bucket. */
  async cycleReadings(actor: CommandActor, cycleId: string, hours?: number) {
    const cycle = await this.prisma.productionCycle.findFirst({
      where: { AND: [{ id: cycleId }, scopedCycleReadWhere(actor)] },
      select: { id: true, plotId: true, farmOrgId: true, currentState: true },
    });
    if (!cycle) throw new NotFoundException('Không tìm thấy chu kỳ sản xuất');
    const since = hours ? new Date(Date.now() - hours * 3_600_000) : undefined;
    const readings = await this.prisma.sensorReading.findMany({
      where: { cycleId, ...(since ? { recordedAt: { gte: since } } : {}) },
      select: {
        sensorType: true,
        value: true,
        unit: true,
        recordedAt: true,
        lateMarker: { select: { readingId: true } },
        device: { select: { simulated: true } },
      },
      orderBy: { recordedAt: 'asc' },
    });
    const devices = cycle.plotId
      ? await this.prisma.iotDevice.findMany({
          where: { plotId: cycle.plotId, organizationId: cycle.farmOrgId },
          select: { id: true, deviceCode: true, name: true, status: true, simulated: true, lastSeenAt: true },
        })
      : [];
    const first = readings[0]?.recordedAt.getTime();
    const last = readings.at(-1)?.recordedAt.getTime();
    // At most ~240 buckets per series keeps the payload small for a whole season.
    const bucketMs = first && last ? Math.max(5 * 60_000, Math.ceil((last - first) / 240)) : 5 * 60_000;
    const series = new Map<string, { unit: string; buckets: Map<number, { sum: number; n: number; min: number; max: number }>; latest: { value: number; recordedAt: Date } | null }>();
    for (const r of readings) {
      const value = Number(r.value.toString());
      const entry = series.get(r.sensorType) ?? { unit: r.unit, buckets: new Map(), latest: null };
      const key = Math.floor(r.recordedAt.getTime() / bucketMs) * bucketMs;
      const b = entry.buckets.get(key) ?? { sum: 0, n: 0, min: value, max: value };
      b.sum += value;
      b.n += 1;
      b.min = Math.min(b.min, value);
      b.max = Math.max(b.max, value);
      entry.buckets.set(key, b);
      entry.latest = { value, recordedAt: r.recordedAt };
      series.set(r.sensorType, entry);
    }
    return {
      cycleId,
      simulated: readings.some((r) => r.device.simulated) || devices.some((d) => d.simulated),
      readingCount: readings.length,
      lateCount: readings.filter((r) => r.lateMarker).length,
      bucketMinutes: Math.round(bucketMs / 60_000),
      devices: devices.map((d) => ({
        ...d,
        online: !!d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() <= DEVICE_ONLINE_MS,
      })),
      series: [...series.entries()].map(([sensorType, s]) => ({
        sensorType,
        unit: s.unit,
        latest: s.latest,
        points: [...s.buckets.entries()].map(([t, b]) => ({
          t: new Date(t),
          avg: Math.round((b.sum / b.n) * 100) / 100,
          min: b.min,
          max: b.max,
        })),
      })),
    };
  }

  private async lockDevice(tx: Prisma.TransactionClient, actor: CommandActor, id: string, version: number) {
    await tx.$queryRaw`SELECT device_id FROM iot_device WHERE device_id=${id}::uuid FOR UPDATE`;
    const device = await tx.iotDevice.findUnique({ where: { id } });
    if (!device || device.organizationId !== actor.organizationId)
      throw new NotFoundException('Không tìm thấy thiết bị');
    if (!['FIELD_SENSOR', 'GPS_TRACKER'].includes(device.type))
      throw new ConflictException('Thiết bị đời cũ không quản lý ở đây');
    if (device.authorityRevision !== version)
      throw new ConflictException('Thiết bị đã thay đổi; tải lại trước khi thao tác');
    return device;
  }

  /** Field sensors bind to plots (production.write), trackers to vehicles (vehicles.manage). */
  private async assertBinding(
    tx: Prisma.TransactionClient,
    actor: CommandActor,
    kind: string,
    plotId: string | null,
    vehicleId: string | null,
    allowNone = false,
    deviceId?: string,
  ) {
    if (plotId && vehicleId) throw new UnprocessableEntityException('Thiết bị chỉ gắn vào một thửa hoặc một xe');
    if (kind === 'FIELD_SENSOR') {
      if (vehicleId) throw new UnprocessableEntityException('Cảm biến vùng trồng gắn vào thửa, không gắn xe');
      if (!plotId) {
        if (allowNone) return { plotId: null, vehicleId: null };
        throw new UnprocessableEntityException('Chọn thửa để gắn cảm biến');
      }
      await enterpriseAuthority(tx, actor, 'production.write');
      const plot = await tx.plot.findFirst({ where: { id: plotId, farm: { organizationId: actor.organizationId! } } });
      if (!plot || plot.status !== 'ACTIVE') throw new ForbiddenException('Thửa không thuộc doanh nghiệp hoặc đã ngừng');
      return { plotId, vehicleId: null };
    }
    if (kind === 'GPS_TRACKER') {
      if (plotId) throw new UnprocessableEntityException('GPS gắn vào xe, không gắn thửa');
      if (!vehicleId) {
        if (allowNone) return { plotId: null, vehicleId: null };
        throw new UnprocessableEntityException('Chọn xe để gắn GPS');
      }
      await enterpriseAuthority(tx, actor, 'vehicles.manage');
      const vehicle = await tx.enterpriseVehicle.findFirst({ where: { id: vehicleId, organizationId: actor.organizationId! } });
      if (!vehicle || vehicle.status !== 'ACTIVE') throw new ForbiddenException('Xe không thuộc doanh nghiệp hoặc đã ngừng');
      if (await tx.iotDevice.count({ where: { vehicleId, status: 'ACTIVE', ...(deviceId ? { id: { not: deviceId } } : {}) } }))
        throw new ConflictException('Xe đã có GPS đang hoạt động');
      return { plotId: null, vehicleId };
    }
    throw new UnprocessableEntityException('Loại thiết bị không hỗ trợ');
  }
}
