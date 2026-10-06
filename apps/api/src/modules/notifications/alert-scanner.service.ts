import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  NotificationSeverity,
  NotificationType,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from './notifications.service.js';

@Injectable()
export class AlertScannerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AlertScannerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.ALERT_SCAN_ENABLED === 'false') return;
    const interval = Number(process.env.ALERT_SCAN_INTERVAL_MS ?? 60_000);
    if (!Number.isFinite(interval) || interval < 1_000) {
      this.logger.error('ALERT_SCAN_INTERVAL_MS phải là số >= 1000');
      return;
    }
    this.timer = setInterval(() => void this.runSafely(), interval);
    this.timer.unref();
    void this.runSafely();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async runSafely() {
    try {
      await this.scan();
    } catch (error) {
      this.logger.error('Quét cảnh báo thất bại', error);
    }
  }

  async scan(now = new Date()) {
    if (this.running) return { skipped: true, created: 0 };
    this.running = true;
    try {
    const recipients = await this.loadRecipients();
    const lotExpiring = await this.scanLots(now, recipients);
    const certificateExpiring = await this.scanCertificates(now, recipients);
    const sensorThresholdExceeded = await this.scanSensors(now, recipients);
    const blockchainProcessingFailed = await this.scanBlockchain(recipients);

    return {
      lotExpiring,
      certificateExpiring,
      sensorThresholdExceeded,
      blockchainProcessingFailed,
      created:
        lotExpiring + certificateExpiring +
        sensorThresholdExceeded + blockchainProcessingFailed,
    };
    } finally {
      this.running = false;
    }
  }

  private async scanLots(now: Date, recipients: RecipientMap) {
    const [today, end] = this.expiryWindow(now, 7);
    const lots = await this.prisma.lot.findMany({
      where: {
        expiryDate: { gte: today, lt: end },
        currentState: { notIn: ['SOLD', 'RECALLED', 'EXPIRED', 'DAMAGED', 'REJECTED'] },
      },
      select: {
        id: true,
        lotCode: true,
        farmOrgId: true,
        expiryDate: true,
        shipment: { select: { retailerOrgId: true } },
      },
    });

    let created = 0;
    for (const lot of lots) {
      const organizations = new Set([lot.farmOrgId]);
      if (lot.shipment?.retailerOrgId) organizations.add(lot.shipment.retailerOrgId);

      for (const organizationId of organizations) {
        created += (await this.notifications.createForRecipients({
          organizationId,
          recipientUserIds: recipients.byOrganization.get(organizationId) ?? [],
          type: NotificationType.LOT_EXPIRING,
          severity: NotificationSeverity.WARNING,
          title: `Lô ${lot.lotCode} gần hết hạn`,
          message: `Lô ${lot.lotCode} hết hạn vào ${this.day(lot.expiryDate!)}.`,
          entityType: 'LOT',
          entityId: lot.id,
          dedupKey: `lot-expiring:${lot.id}`,
          metadata: { expiryDate: lot.expiryDate!.toISOString() },
        })).count;
      }
    }
    return created;
  }

  private async scanCertificates(now: Date, recipients: RecipientMap) {
    const [today, end] = this.expiryWindow(now, 30);
    const certificates = await this.prisma.certificate.findMany({
      where: {
        expiryDate: { gte: today, lt: end },
        status: 'APPROVED',
      },
      select: {
        id: true,
        type: true,
        expiryDate: true,
        lot: { select: { farmOrgId: true } },
        cycle: { select: { farmOrgId: true } },
      },
    });

    let created = 0;
    for (const certificate of certificates) {
      const organizationId = certificate.lot?.farmOrgId ?? certificate.cycle?.farmOrgId;
      if (!organizationId) continue;

      created += (await this.notifications.createForRecipients({
        organizationId,
        recipientUserIds: recipients.byOrganization.get(organizationId) ?? [],
        type: NotificationType.CERTIFICATE_EXPIRING,
        severity: NotificationSeverity.WARNING,
        title: 'Chứng chỉ gần hết hạn',
        message: `Chứng chỉ ${certificate.type} hết hạn vào ${this.day(certificate.expiryDate!)}.`,
        entityType: 'CERTIFICATE',
        entityId: certificate.id,
        dedupKey: `certificate-expiring:${certificate.id}`,
        metadata: { expiryDate: certificate.expiryDate!.toISOString() },
      })).count;
    }
    return created;
  }

  private async scanSensors(now: Date, recipients: RecipientMap) {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const rules = await this.prisma.sensorAlertRule.findMany({
      where: { enabled: true, organization: { status: 'ACTIVE' } },
      select: {
        id: true,
        organizationId: true,
        deviceId: true,
        sensorType: true,
        minimumValue: true,
        maximumValue: true,
        severity: true,
      },
    });

    let created = 0;
    for (const rule of rules) {
      const readings = await this.prisma.sensorReading.findMany({
        where: {
          sensorType: rule.sensorType,
          recordedAt: { gte: since, lte: now },
          deviceId: rule.deviceId ?? undefined,
          device: { organizationId: rule.organizationId },
        },
        distinct: ['deviceId'],
        orderBy: { recordedAt: 'desc' },
        select: {
          id: true,
          deviceId: true,
          value: true,
          unit: true,
          recordedAt: true,
        },
      });

      for (const reading of readings) {
        const direction =
          rule.minimumValue && reading.value.lessThan(rule.minimumValue)
            ? 'LOW'
            : rule.maximumValue && reading.value.greaterThan(rule.maximumValue)
              ? 'HIGH'
              : null;
        if (!direction) continue;

        created += (await this.notifications.createForRecipients({
          organizationId: rule.organizationId,
          recipientUserIds: recipients.byOrganization.get(rule.organizationId) ?? [],
          type: NotificationType.SENSOR_THRESHOLD_EXCEEDED,
          severity: rule.severity,
          title: 'Cảm biến vượt ngưỡng',
          message: `${rule.sensorType}: ${reading.value.toString()} ${reading.unit} vượt ngưỡng ${direction === 'LOW' ? 'thấp' : 'cao'}.`,
          entityType: 'SENSOR_READING',
          entityId: reading.id,
          dedupKey: `sensor-threshold:${rule.id}:${reading.deviceId}:${direction}:${this.day(reading.recordedAt)}`,
          metadata: {
            ruleId: rule.id,
            deviceId: reading.deviceId,
            direction,
            value: reading.value.toString(),
            unit: reading.unit,
          },
        })).count;
      }
    }
    return created;
  }

  private async scanBlockchain(recipients: RecipientMap) {
    const proofs = await this.prisma.blockchainProof.findMany({
      where: { transactionStatus: 'FAILED' },
      select: {
        id: true,
        eventId: true,
        lastError: true,
        traceEvent: {
          select: {
            actorOrganizationId: true,
            lot: { select: { farmOrgId: true } },
            cycle: { select: { farmOrgId: true } },
          },
        },
      },
    });

    let created = 0;
    for (const proof of proofs) {
      const organizationId =
        proof.traceEvent.lot?.farmOrgId ??
        proof.traceEvent.cycle?.farmOrgId ??
        proof.traceEvent.actorOrganizationId ?? null;

      // Backend failure needs an administrator even when no business org owns the event.
      created += (await this.notifications.createForRecipients({
        organizationId: null,
        recipientUserIds: recipients.admins,
        type: NotificationType.BLOCKCHAIN_PROCESSING_FAILED,
        severity: NotificationSeverity.CRITICAL,
        title: 'Ghi blockchain thất bại',
        message: `Sự kiện ${proof.eventId} chưa được ghi thành công lên blockchain.`,
        entityType: 'BLOCKCHAIN_PROOF',
        entityId: proof.id,
        dedupKey: `blockchain-failed:${proof.id}`,
        metadata: { eventId: proof.eventId, organizationId },
      })).count;

      if (organizationId) {
        created += (await this.notifications.createForRecipients({
          organizationId,
          recipientUserIds: recipients.byOrganization.get(organizationId) ?? [],
          type: NotificationType.BLOCKCHAIN_PROCESSING_FAILED,
          severity: NotificationSeverity.WARNING,
          title: 'Ghi blockchain chưa thành công',
          message: `Sự kiện ${proof.eventId} đang cần được xử lý lại.`,
          entityType: 'BLOCKCHAIN_PROOF',
          entityId: proof.id,
          dedupKey: `blockchain-failed:${proof.id}`,
          metadata: { eventId: proof.eventId },
        })).count;
      }
    }
    return created;
  }

  private async loadRecipients(): Promise<RecipientMap> {
    const users = await this.prisma.user.findMany({
      where: { accountStatus: 'ACTIVE' },
      select: {
        id: true,
        organizationId: true,
        role: { select: { code: true } },
        organization: { select: { status: true } },
      },
    });

    const byOrganization = new Map<string, string[]>();
    const admins: string[] = [];
    for (const user of users) {
      if (user.role.code === 'SYSTEM_ADMIN') {
        admins.push(user.id);
      } else if (user.organizationId && user.organization?.status === 'ACTIVE') {
        const current = byOrganization.get(user.organizationId) ?? [];
        current.push(user.id);
        byOrganization.set(user.organizationId, current);
      }
    }
    return { byOrganization, admins };
  }

  private expiryWindow(now: Date, days: number): [Date, Date] {
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() + days + 1);
    return [today, end];
  }

  private day(value: Date) {
    return value.toISOString().slice(0, 10);
  }
}

type RecipientMap = {
  byOrganization: Map<string, string[]>;
  admins: string[];
};
