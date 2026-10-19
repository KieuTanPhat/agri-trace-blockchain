import {
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';

const LIMIT = 500;

export class RecallLotDto {
  @ApiProperty() id!: string;
  @ApiProperty() lotCode!: string;
  @ApiProperty() farmOrganizationId!: string;
  @ApiProperty({ type: String, nullable: true }) parentLotId!: string | null;
  @ApiProperty() state!: string;
  @ApiProperty() unit!: string;
  @ApiProperty({
    description:
      'Số thập phân chính xác, không cộng lại với lượng đang phân bổ',
  })
  initialQuantity!: string;
  @ApiProperty() availableQuantity!: string;
}
export class RecallHoldingDto {
  @ApiProperty() lotId!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty() organizationName!: string;
  @ApiProperty() quantity!: string;
  @ApiProperty() reserved!: string;
}
export class RecallMovementDto {
  @ApiProperty() id!: string;
  @ApiProperty() lotId!: string;
  @ApiProperty({ enum: ['DISTRIBUTION', 'SHIPMENT'] }) kind!: string;
  @ApiProperty() senderId!: string;
  @ApiProperty() carrierId!: string;
  @ApiProperty() receiverId!: string;
  @ApiProperty() quantity!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() status!: string;
}
export class RecallPreviewDto {
  @ApiProperty({ enum: [true] }) readOnly!: boolean;
  @ApiProperty({ format: 'date-time' }) generatedAt!: string;
  @ApiProperty() rootLotId!: string;
  @ApiProperty({ type: [RecallLotDto] }) lots!: RecallLotDto[];
  @ApiProperty({ type: [RecallHoldingDto] }) holdings!: RecallHoldingDto[];
  @ApiProperty({ type: [RecallMovementDto] }) movements!: RecallMovementDto[];
  @ApiProperty({ type: [String] }) limitations!: string[];
  @ApiProperty({
    description:
      'Có phần vượt giới hạn; không dùng báo cáo này như danh sách đầy đủ',
  })
  truncated!: boolean;
}

/** A consistent, bounded snapshot. No recall, notice, quantity or ledger write. */
@Injectable()
export class PlatformRecallService {
  constructor(private readonly prisma: PrismaService) {}

  preview(rootLotId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const select = {
          id: true,
          lotCode: true,
          farmOrgId: true,
          parentLotId: true,
          currentState: true,
          unit: true,
          initialQuantity: true,
          availableQuantity: true,
        } as const;
        const root = await tx.lot.findUnique({
          where: { id: rootLotId },
          select,
        });
        if (!root) throw new NotFoundException('Không tìm thấy lô nguồn');
        const lots = [root];
        const visited = new Set([root.id]);
        let frontier = [root.id];
        let truncated = false;
        for (let depth = 0; frontier.length; depth++) {
          if (depth >= 20 || lots.length >= LIMIT) {
            truncated = true;
            break;
          }
          const children = await tx.lot.findMany({
            where: { parentLotId: { in: frontier } },
            select,
            orderBy: { id: 'asc' },
            take: LIMIT - lots.length + 1,
          });
          frontier = [];
          for (const child of children) {
            if (visited.has(child.id)) {
              truncated = true;
              continue;
            }
            if (lots.length >= LIMIT) {
              truncated = true;
              break;
            }
            visited.add(child.id);
            lots.push(child);
            frontier.push(child.id);
          }
        }
        const lotIds = lots.map((lot) => lot.id);
        const holdings = await tx.lotHolding.findMany({
          where: { lotId: { in: lotIds } },
          orderBy: [{ lotId: 'asc' }, { organizationId: 'asc' }],
          take: LIMIT + 1,
        });
        const lines = await tx.distributionLine.findMany({
          where: {
            lotId: { in: lotIds },
            transfer: { status: { not: 'CANCELLED' } },
          },
          select: {
            lotId: true,
            quantity: true,
            unit: true,
            transfer: {
              select: {
                id: true,
                senderId: true,
                carrierId: true,
                receiverId: true,
                status: true,
              },
            },
          },
          orderBy: { id: 'asc' },
          take: LIMIT + 1,
        });
        const shipments = await tx.shipment.findMany({
          where: { lotId: { in: lotIds } },
          select: {
            id: true,
            lotId: true,
            transporterOrgId: true,
            retailerOrgId: true,
            shippedQuantity: true,
            unit: true,
            status: true,
          },
          orderBy: { id: 'asc' },
          take: LIMIT + 1,
        });
        const orgIds = [
          ...new Set([
            ...lots.map((lot) => lot.farmOrgId),
            ...holdings.map((h) => h.organizationId),
            ...lines.flatMap((l) => [
              l.transfer.senderId,
              l.transfer.carrierId,
              l.transfer.receiverId,
            ]),
            ...shipments.flatMap((s) => [s.transporterOrgId, s.retailerOrgId]),
          ]),
        ];
        const organizations = await tx.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true },
        });
        const names = new Map(organizations.map((o) => [o.id, o.name]));
        return {
          readOnly: true,
          generatedAt: new Date().toISOString(),
          rootLotId,
          lots: lots.map((lot) => ({
            id: lot.id,
            lotCode: lot.lotCode,
            farmOrganizationId: lot.farmOrgId,
            parentLotId: lot.parentLotId,
            state: lot.currentState,
            unit: lot.unit,
            initialQuantity: lot.initialQuantity.toFixed(3),
            availableQuantity: lot.availableQuantity.toFixed(3),
          })),
          holdings: holdings
            .slice(0, LIMIT)
            .map((h) => ({
              lotId: h.lotId,
              organizationId: h.organizationId,
              organizationName: names.get(h.organizationId) ?? h.organizationId,
              quantity: h.quantity.toFixed(3),
              reserved: h.reserved.toFixed(3),
            })),
          movements: [
            ...lines
              .slice(0, LIMIT)
              .map((l) => ({
                id: l.transfer.id,
                lotId: l.lotId,
                kind: 'DISTRIBUTION',
                senderId: l.transfer.senderId,
                carrierId: l.transfer.carrierId,
                receiverId: l.transfer.receiverId,
                quantity: l.quantity.toFixed(3),
                unit: l.unit,
                status: l.transfer.status,
              })),
            ...shipments
              .slice(0, LIMIT)
              .map((s) => ({
                id: s.id,
                lotId: s.lotId,
                kind: 'SHIPMENT',
                senderId: lots.find((l) => l.id === s.lotId)!.farmOrgId,
                carrierId: s.transporterOrgId,
                receiverId: s.retailerOrgId,
                quantity: s.shippedQuantity.toFixed(3),
                unit: s.unit,
                status: s.status,
              })),
          ],
          truncated:
            truncated ||
            holdings.length > LIMIT ||
            lines.length > LIMIT ||
            shipments.length > LIMIT,
          limitations: [
            'Diễn tập chỉ đọc, không gửi thông báo hoặc thực hiện thu hồi.',
            'Lượng ở các chặng là lịch sử luân chuyển, không cộng thành tồn kho; lượng giữ chỗ đã nằm trong lượng phân bổ.',
            'Số liệu trong hệ thống cần được doanh nghiệp đối chiếu với hàng thực tế. Mỗi phần tối đa 500 dòng, cây lô tối đa 20 cấp.',
          ],
        };
      },
      { isolationLevel: 'RepeatableRead', timeout: 20_000 },
    );
  }
}

@ApiTags('platform-recall')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SYSTEM_ADMIN', 'AUDITOR', 'PLATFORM_OPERATOR', 'PLATFORM_CASE_MANAGER')
@Controller('platform-recall')
export class PlatformRecallController {
  constructor(private readonly service: PlatformRecallService) {}
  @ApiDataResponse(RecallPreviewDto)
  @Get(':lotId')
  preview(@Param('lotId', ParseUUIDPipe) lotId: string) {
    return this.service.preview(lotId);
  }
}
