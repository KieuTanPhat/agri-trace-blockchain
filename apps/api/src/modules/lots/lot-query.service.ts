import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import type { Actor } from '../trace/trace.service.js';
import {
  INTERNAL_LOT_INCLUDE,
  publicLotInclude,
  PUBLIC_TRACE_INCLUDE,
  type InternalLot,
} from './lot-query.types.js';
import { toInternalLotDto, toPublicLotDto } from './lot.presenter.js';
import { scopedLotReadWhere } from '../supply-chains/business-read-scope.js';
import { authorizeBusinessCommand } from '../supply-chains/business-policy.js';
import { getAllowedLotCommands, type LotCommand } from './lot-action.policy.js';

@Injectable()
export class LotQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async getInternal(lotId: string, actor: Actor) {
    await this.access.assertLotAccess(actor, lotId);
    const lot = await this.prisma.lot.findFirst({
      where: { AND: [{ id: lotId }, scopedLotReadWhere(actor)] },
      include: INTERNAL_LOT_INCLUDE,
    });
    if (!lot) throw new NotFoundException('Không tìm thấy lô hàng');
    return this.projectInternal(lot, actor);
  }

  async getList(actor: Actor) {
    const lots = await this.prisma.lot.findMany({
      where: scopedLotReadWhere(actor),
      include: INTERNAL_LOT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(lots.map((lot) => this.projectInternal(lot, actor)));
  }

  private async projectInternal(lot: InternalLot, actor: Actor) {
    const response = toInternalLotDto(lot, actor);
    const allocated = await this.prisma.lotHolding.count({
      where: { lotId: lot.id },
    });
    if (allocated)
      return {
        ...response,
        allowedCommands: [],
        custodian: null,
        distributionMode: true,
      };
    // Shipment-flow lot commands apply to harvested lots only.
    const chainId = lot.harvest?.cycle.chainId;
    if (!chainId) return response;
    const commands = new Set<LotCommand>();
    for (const role of ['FARM_STAFF', 'TRANSPORTER', 'RETAILER'] as const) {
      try {
        const authority = await authorizeBusinessCommand(this.prisma, actor, {
          chainId,
          role,
          subject: { kind: 'lot', id: lot.id },
        });
        for (const command of getAllowedLotCommands(
          { ...lot, quantityReconciled: response.quantityReconciled },
          authority.actor,
        ))
          if (command !== 'createShipment') commands.add(command);
      } catch (error) {
        if (!(
          error instanceof ForbiddenException ||
          error instanceof NotFoundException
        ))
          throw error;
      }
    }
    return { ...response, allowedCommands: [...commands] };
  }

  async getDashboard(actor: Actor) {
    const lots = await this.getList(actor);
    return {
      featuredLot: lots[0] ?? null,
      stats: [
        { label: 'Lô đang theo dõi', value: String(lots.length) },
        {
          label: 'Bằng chứng đang chờ',
          value: String(
            lots.filter((lot) => lot.proofStatus === 'PENDING').length,
          ),
        },
        {
          label: 'Chuyến vận chuyển mở',
          value: String(
            lots.filter((lot) =>
              ['CREATED', 'IN_TRANSIT', 'ARRIVED'].includes(
                lot.shipment?.status ?? '',
              ),
            ).length,
          ),
        },
      ],
    };
  }

  async getPublic(traceToken: string) {
    const qr = await this.prisma.traceQr.findUnique({
      where: { traceToken },
      include: { lot: { include: publicLotInclude() } },
    });
    if (!qr) throw new NotFoundException('Mã truy xuất không hợp lệ');
    const harvest=qr.lot.harvest;
    const materialUses=harvest?await this.prisma.careRecord.findMany({where:{cycleId:harvest.cycle.id,eventTime:{lte:harvest.harvestTime},withdrawalPeriod:{gt:0}},select:{eventTime:true,withdrawalPeriod:true}}):[];
    const productionWarnings=materialUses.filter(r=>r.eventTime.getTime()+(r.withdrawalPeriod??0)*86400000>harvest!.harvestTime.getTime()).map(r=>'Theo nhật ký khai báo, tại thời điểm thu hoạch còn trong thời gian cách ly đầu vào đến '+new Date(r.eventTime.getTime()+(r.withdrawalPeriod??0)*86400000).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})+'. Cần đối chiếu tài liệu; đây không phải kết quả kiểm nghiệm.');
    const traceEvents = await this.prisma.traceEvent.findMany({
      where: {
        OR: [
          { lotId: qr.lot.id },
          ...(harvest ? [{ cycleId: harvest.cycle.id, lotId: null }] : []),
        ],
      },
      orderBy: [{ eventTime: 'asc' }, { createdAt: 'asc' }],
      include: PUBLIC_TRACE_INCLUDE,
    });
    const lines = await this.prisma.distributionLine.findMany({
      where: { lotId: qr.lot.id, transfer: { status: { not: 'CANCELLED' } } },
      include: { transfer: true },
      orderBy: { transfer: { createdAt: 'asc' } },
    });
    const orgs = await this.prisma.organization.findMany({
      where: {
        id: {
          in: lines.flatMap((l) => [
            l.transfer.senderId,
            l.transfer.carrierId,
            l.transfer.receiverId,
          ]),
        },
      },
      select: { id: true, name: true },
    });
    const name = (id: string) =>
      orgs.find((o) => o.id === id)?.name ?? 'Doanh nghiệp tham gia';
    const receipts=await this.prisma.distributionReceipt.findMany({where:{transferId:{in:lines.map(l=>l.transferId)}}});
    const remainders=await this.prisma.distributionRemainder.findMany({where:{lotId:qr.lot.id,transferId:{in:lines.map(l=>l.transferId)}}});
    const notices = await this.prisma.traceNotice.findMany({
      where: { lotId: qr.lot.id },
      select: { kind: true, message: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    // An administrative block keeps the page reachable with a clear warning.
    const block = await this.prisma.traceQrBlock.findFirst({
      where: { lotId: qr.lot.id, unblockedAt: null },
    });
    if (block)
      notices.unshift({
        kind: 'WARNING',
        message: `Mã QR đã bị nền tảng AgriTrace khóa: ${block.publicMessage}`,
        createdAt: block.blockedAt,
      });
    // Anonymous daily counter; a failure here never blocks the public page.
    await this.prisma.$executeRaw`INSERT INTO trace_scan_daily(lot_id, day, scans)
      VALUES (${qr.lot.id}::uuid, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 1)
      ON CONFLICT (lot_id, day) DO UPDATE SET scans = trace_scan_daily.scans + 1`.catch(() => undefined);
    return {
      ...toPublicLotDto(qr.lot, traceToken, traceEvents),
      notices,
      productionWarnings:[...new Set(productionWarnings)],
      distributionJourney: lines.map((l) => {
        const receipt=receipts.find(r=>r.transferId===l.transferId),actual=(receipt?.lines as {lotId:string;received:string}[]|undefined)?.find(r=>r.lotId===qr.lot.id);
        const completed=l.transfer.status==='DELIVERED',received=completed?new Prisma.Decimal(actual?.received??l.quantity):null,pending=completed?(remainders.find(r=>r.transferId===l.transferId)?.quantity??new Prisma.Decimal(0)):null;
        return ({
        senderName: name(l.transfer.senderId),
        carrierName: name(l.transfer.carrierId),
        receiverName: name(l.transfer.receiverId),
        quantity: l.quantity.toFixed(3),
        receivedQuantity:received?.toFixed(3)??null,
        pendingQuantity:pending?.toFixed(3)??null,
        returnedQuantity:received&&pending?l.quantity.sub(received).sub(pending).toFixed(3):null,
        custodyStage:['PROPOSED','READY'].includes(l.transfer.status)?'PLANNED':l.transfer.status==='IN_TRANSIT'?'CARRIER':pending?.gt(0)?'RECEIVER_WITH_REMAINDER':'RECEIVER',
        unit: l.unit,
        status: l.transfer.status,
        recordedAt: l.transfer.createdAt.toISOString(),
      });}),
    };
  }
}
