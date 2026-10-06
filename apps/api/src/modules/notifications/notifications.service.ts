import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  NotificationSeverity,
  NotificationStatus,
  NotificationType,
  Prisma,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Actor } from '../trace/trace.service.js';
import type {
  CreateSensorAlertRuleDto,
  ListNotificationsQueryDto,
  UpdateSensorAlertRuleDto,
} from './dto.js';

export type CreateNotificationInput = {
  organizationId: string | null;
  recipientUserIds: string[];
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  entityType: string;
  entityId: string;
  dedupKey: string;
  metadata?: Prisma.InputJsonValue;
};

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listRules(actor: Actor, organizationId?: string) {
    const scope = this.ruleScope(actor, organizationId);
    return this.prisma.sensorAlertRule.findMany({
      where: scope,
      orderBy: { createdAt: 'desc' },
    });
  }

  async createRule(input: CreateSensorAlertRuleDto, actor: Actor) {
    this.assertCanManageRules(actor, input.organizationId);
    this.assertSensorType(input.sensorType);
    this.validateThresholds(input.minimumValue, input.maximumValue);
    await this.assertActiveOrganization(input.organizationId);
    await this.assertDeviceOwner(input.deviceId, input.organizationId);

    if (!actor.sub) {
      throw new ForbiddenException('Không xác định được người tạo quy tắc');
    }

    return this.prisma.sensorAlertRule.create({
      data: {
        organizationId: input.organizationId,
        deviceId: input.deviceId,
        sensorType: input.sensorType.trim(),
        minimumValue: input.minimumValue,
        maximumValue: input.maximumValue,
        severity: input.severity ?? NotificationSeverity.WARNING,
        createdById: actor.sub,
      },
    });
  }

  async updateRule(id: string, input: UpdateSensorAlertRuleDto, actor: Actor) {
    const existing = await this.prisma.sensorAlertRule.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Không tìm thấy quy tắc cảnh báo');
    }

    this.assertCanManageRules(actor, existing.organizationId);
    if (input.sensorType !== undefined) this.assertSensorType(input.sensorType);
    this.validateThresholds(
      input.minimumValue ?? existing.minimumValue?.toNumber(),
      input.maximumValue ?? existing.maximumValue?.toNumber(),
    );
    await this.assertDeviceOwner(input.deviceId, existing.organizationId);

    return this.prisma.sensorAlertRule.update({
      where: { id },
      data: {
        deviceId: input.deviceId,
        sensorType: input.sensorType?.trim(),
        minimumValue: input.minimumValue,
        maximumValue: input.maximumValue,
        severity: input.severity,
        enabled: input.enabled,
      },
    });
  }

  async listNotifications(actor: Actor, query: ListNotificationsQueryDto) {
    const recipientUserId = this.requireUserId(actor);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.NotificationWhereInput = {
      recipientUserId,
      status: query.status,
      type: query.type,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  markRead(id: string, actor: Actor) {
    return this.updateOwnStatus(id, actor, NotificationStatus.READ);
  }

  resolve(id: string, actor: Actor) {
    return this.updateOwnStatus(id, actor, NotificationStatus.RESOLVED);
  }

  async createForRecipients(input: CreateNotificationInput) {
    const recipientUserIds = [...new Set(input.recipientUserIds)];
    if (recipientUserIds.length === 0) {
      return { count: 0 };
    }

    const recipients = await this.prisma.user.findMany({
      where: { id: { in: recipientUserIds }, accountStatus: 'ACTIVE' },
      select: { id: true, organizationId: true, role: { select: { code: true } } },
    });
    if (
      recipients.length !== recipientUserIds.length ||
      recipients.some((user) =>
        input.organizationId === null
          ? user.role.code !== 'SYSTEM_ADMIN'
          : user.organizationId !== input.organizationId && user.role.code !== 'SYSTEM_ADMIN',
      )
    ) {
      throw new UnprocessableEntityException(
        'Người nhận không hoạt động hoặc không thuộc phạm vi thông báo',
      );
    }

    return this.prisma.notification.createMany({
      data: recipientUserIds.map((recipientUserId) => ({
        organizationId: input.organizationId,
        recipientUserId,
        type: input.type,
        severity: input.severity,
        title: input.title,
        message: input.message,
        entityType: input.entityType,
        entityId: input.entityId,
        dedupKey: input.dedupKey,
        metadata: input.metadata,
      })),
      skipDuplicates: true,
    });
  }

  private async updateOwnStatus(
    id: string,
    actor: Actor,
    status: NotificationStatus,
  ) {
    const recipientUserId = this.requireUserId(actor);
    const now = new Date();
    const updated = await this.prisma.notification.updateMany({
      where: {
        id,
        recipientUserId,
        status:
          status === NotificationStatus.READ
            ? NotificationStatus.UNREAD
            : { not: NotificationStatus.RESOLVED },
      },
      data:
        status === NotificationStatus.READ
          ? { status, readAt: now, updatedAt: now }
          : { status, readAt: now, resolvedAt: now, updatedAt: now },
    });

    if (updated.count === 0) {
      const existing = await this.prisma.notification.findFirst({
        where: { id, recipientUserId },
      });
      if (!existing) {
        throw new NotFoundException('Không tìm thấy thông báo');
      }
      return existing;
    }

    return this.prisma.notification.findUniqueOrThrow({ where: { id } });
  }

  private ruleScope(actor: Actor, organizationId?: string) {
    if (actor.role === 'SYSTEM_ADMIN') {
      return organizationId ? { organizationId } : {};
    }
    if (!actor.organizationId || (organizationId && organizationId !== actor.organizationId)) {
      throw new ForbiddenException('Không có quyền xem quy tắc của tổ chức này');
    }
    return { organizationId: actor.organizationId };
  }

  private assertCanManageRules(actor: Actor, organizationId: string) {
    if (actor.role === 'SYSTEM_ADMIN') return;
    if (actor.role !== 'FARM_STAFF' || actor.organizationId !== organizationId) {
      throw new ForbiddenException('Không có quyền quản lý quy tắc cảnh báo');
    }
  }

  private requireUserId(actor: Actor): string {
    if (!actor.sub) {
      throw new ForbiddenException('Không xác định được người dùng');
    }
    return actor.sub;
  }

  private validateThresholds(minimum?: number, maximum?: number) {
    if (minimum == null && maximum == null) {
      throw new UnprocessableEntityException('Cần ít nhất một ngưỡng cảm biến');
    }
    if (minimum != null && maximum != null && minimum >= maximum) {
      throw new UnprocessableEntityException('Ngưỡng thấp phải nhỏ hơn ngưỡng cao');
    }
  }

  private assertSensorType(value: string) {
    if (!value.trim()) {
      throw new UnprocessableEntityException('Loại cảm biến không được để trống');
    }
  }

  private async assertActiveOrganization(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { status: true },
    });
    if (!organization || organization.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('Tổ chức không tồn tại hoặc không hoạt động');
    }
  }

  private async assertDeviceOwner(deviceId: string | undefined, organizationId: string) {
    if (!deviceId) return;
    const device = await this.prisma.iotDevice.findUnique({
      where: { id: deviceId },
      select: { organizationId: true, status: true },
    });
    if (!device || device.organizationId !== organizationId || device.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('Thiết bị không thuộc tổ chức hoặc không hoạt động');
    }
  }
}
