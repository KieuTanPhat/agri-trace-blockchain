import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { commandTransaction, lockAggregate } from '../../common/idempotency/command-transaction.js';
import { businessTimestamp } from '../../common/timestamp.js';
import type { IotDevice, Prisma } from '../../generated/prisma/client.js';
import { markLateReading, validateSensorTime } from './harvest-sensor-window.js';
import { classifyPosition } from './route-seal.js';
import { sentAtWithinSkew, verifyDeviceSignature } from './device-signature.js';
import type { SignedPositionsInput, SignedReadingsInput } from './device-dto.js';

const RUNNING_STATES = ['PLANTED', 'GROWING'];
/** Device clocks may run slightly ahead; later instants are refused. */
const FUTURE_TOLERANCE_MS = 2 * 60_000;

type Result = { accepted: number; duplicates: number; ignored: number; late: number; anomalies: number; rejected: number };
const empty = (): Result => ({ accepted: 0, duplicates: 0, ignored: 0, late: 0, anomalies: 0, rejected: 0 });

function parseInstant(value: string): Date | null {
  try {
    const t = businessTimestamp(value, 'Thời điểm đo');
    return t.getTime() > Date.now() + FUTURE_TOLERANCE_MS ? null : t;
  } catch {
    return null;
  }
}

/**
 * ADR-006 signed device ingest. Each record carries a per-device sequence;
 * a repeated sequence is a duplicate and is never written twice. Raw data stays
 * off-chain: field readings are sealed by the harvest sensor window, positions
 * by the route seal of the DELIVERY attestation.
 */
@Injectable()
export class DeviceIngestService {
  constructor(private readonly prisma: PrismaService) {}

  private async authenticate(
    deviceCode: string,
    kind: 'FIELD_SENSOR' | 'GPS_TRACKER',
    body: SignedReadingsInput | SignedPositionsInput,
    signature: string | undefined,
  ): Promise<IotDevice> {
    const device = await this.prisma.iotDevice.findUnique({
      where: { deviceCode },
      include: { organization: { select: { status: true } } },
    });
    // One generic answer for unknown, revoked or mismatching devices.
    if (
      !device ||
      !device.publicKey ||
      !signature ||
      !verifyDeviceSignature(device.publicKey, body, signature)
    )
      throw new UnauthorizedException('Chữ ký thiết bị không hợp lệ');
    if (!sentAtWithinSkew(body.sentAt))
      throw new UnauthorizedException('Thời điểm gửi lệch quá giới hạn; đồng bộ đồng hồ thiết bị');
    if (device.status !== 'ACTIVE' || device.organization.status !== 'ACTIVE')
      throw new ForbiddenException('Thiết bị đã ngừng hoặc doanh nghiệp không hoạt động');
    if (device.type !== kind)
      throw new ForbiddenException('Loại dữ liệu không đúng loại thiết bị');
    return device;
  }

  async readings(body: SignedReadingsInput, signature: string | undefined) {
    const device = await this.authenticate(body.deviceCode, 'FIELD_SENSOR', body, signature);
    return commandTransaction(this.prisma, async (tx) => {
      const result = empty();
      const cycles = device.plotId
        ? await tx.productionCycle.findMany({
            where: { plotId: device.plotId, farmOrgId: device.organizationId, currentState: { in: RUNNING_STATES as never } },
            select: { id: true },
            orderBy: { id: 'asc' },
          })
        : [];
      for (const c of cycles) await lockAggregate(tx, 'cycle', c.id);
      for (const r of [...body.readings].sort((a, b) => a.sequence - b.sequence)) {
        const recordedAt = parseInstant(r.recordedAt);
        if (!recordedAt) {
          result.rejected++;
          continue;
        }
        if (!cycles.length) {
          result.ignored++;
          continue;
        }
        let wrote = false;
        let duplicate = false;
        for (const c of cycles) {
          if (await tx.sensorReading.findFirst({ where: { deviceId: device.id, deviceSequence: BigInt(r.sequence), cycleId: c.id }, select: { id: true } })) {
            duplicate = true;
            continue;
          }
          try {
            await validateSensorTime(tx, c.id, recordedAt);
          } catch {
            continue;
          }
          const created = await tx.sensorReading.create({
            data: {
              deviceId: device.id,
              cycleId: c.id,
              sensorType: r.sensorType,
              value: r.value,
              unit: r.unit,
              recordedAt,
              deviceSequence: BigInt(r.sequence),
            },
          });
          if (await markLateReading(tx, created)) result.late++;
          wrote = true;
        }
        if (wrote) result.accepted++;
        else if (duplicate) result.duplicates++;
        else result.rejected++;
      }
      await tx.iotDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
      return result;
    });
  }

  async positions(body: SignedPositionsInput, signature: string | undefined) {
    const device = await this.authenticate(body.deviceCode, 'GPS_TRACKER', body, signature);
    return commandTransaction(this.prisma, async (tx) => {
      const result = empty();
      const vehicleId = device.vehicleId;
      const active = vehicleId
        ? await tx.distributionTransfer.findFirst({ where: { vehicleId, status: 'IN_TRANSIT' }, select: { id: true } })
        : null;
      // Serialize with the DELIVERY seal, which locks the same row.
      if (active) await tx.$queryRaw`SELECT id FROM distribution_transfer WHERE id=${active.id}::uuid FOR UPDATE`;
      const transit = active
        ? await tx.distributionTransfer.findUnique({ where: { id: active.id }, select: { id: true, status: true, inTransitAt: true } })
        : null;
      const delivered = vehicleId
        ? await tx.distributionTransfer.findMany({
            where: { vehicleId, status: { in: ['DELIVERED'] }, deliveredAt: { not: null } },
            select: { id: true, inTransitAt: true, deliveredAt: true },
            orderBy: { deliveredAt: 'desc' },
            take: 3,
          })
        : [];
      let previous: { recordedAt: Date; latitude: number; longitude: number } | null = null;
      if (transit) {
        const last = await tx.distributionPosition.findFirst({
          where: { transferId: transit.id, validity: 'VALID' },
          orderBy: [{ recordedAt: 'desc' }, { deviceSequence: 'desc' }],
        });
        previous = last && { recordedAt: last.recordedAt, latitude: Number(last.latitude), longitude: Number(last.longitude) };
      }
      const items = [...body.positions].sort((a, b) =>
        Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || a.sequence - b.sequence,
      );
      for (const p of items) {
        const recordedAt = parseInstant(p.recordedAt);
        if (!recordedAt) {
          result.rejected++;
          continue;
        }
        if (await tx.distributionPosition.findUnique({ where: { deviceId_deviceSequence: { deviceId: device.id, deviceSequence: BigInt(p.sequence) } }, select: { id: true } })) {
          result.duplicates++;
          continue;
        }
        const base: Omit<Prisma.DistributionPositionUncheckedCreateInput, 'transferId' | 'validity'> = {
          deviceId: device.id,
          vehicleId: vehicleId!,
          deviceSequence: BigInt(p.sequence),
          recordedAt,
          latitude: p.latitude,
          longitude: p.longitude,
          accuracyM: p.accuracyM,
          speedKmh: p.speedKmh,
          heading: p.heading,
          satellites: p.satellites,
          battery: p.battery,
        };
        if (transit?.inTransitAt && recordedAt >= transit.inTransitAt) {
          if (previous && recordedAt < previous.recordedAt) {
            // Out-of-order flush after a gap: keep it, but do not use it as anchor.
            const code = classifyPosition(null, { ...p, recordedAt });
            await tx.distributionPosition.create({ data: { ...base, transferId: transit.id, validity: code ? 'ANOMALY' : 'VALID', anomalyCode: code } });
            if (code) result.anomalies++;
            result.accepted++;
            continue;
          }
          const code = classifyPosition(previous, { ...p, recordedAt });
          await tx.distributionPosition.create({ data: { ...base, transferId: transit.id, validity: code ? 'ANOMALY' : 'VALID', anomalyCode: code } });
          if (code) result.anomalies++;
          else previous = { recordedAt, latitude: p.latitude, longitude: p.longitude };
          result.accepted++;
          continue;
        }
        const sealed = delivered.find((t) => t.inTransitAt && t.deliveredAt && recordedAt >= t.inTransitAt && recordedAt <= t.deliveredAt);
        if (sealed) {
          await tx.distributionPosition.create({ data: { ...base, transferId: sealed.id, validity: 'LATE' } });
          result.late++;
          continue;
        }
        // Outside any transit window: not stored (driver privacy, ADR-006).
        result.ignored++;
      }
      await tx.iotDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
      return result;
    });
  }
}
