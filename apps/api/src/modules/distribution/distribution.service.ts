import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { canonicalize } from 'json-canonicalize';
import {
  Prisma,
  type DistributionTransfer,
  type DistributionLine,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import { quantity, quantityIsReconciled } from '../../common/quantity.js';
import {
  enterpriseAuthority,
  enterpriseTransferWhere,
} from '../enterprise-workspace/enterprise-policy.js';
import { isPastExpiry } from '../../common/expiry-date.js';
import { businessTimestamp } from '../../common/timestamp.js';
import {
  verifyEd25519,
  parseEd25519PublicKey,
} from '../trace/signed-commitment.js';
import { TraceService } from '../trace/trace.service.js';
import { randomUUID } from 'node:crypto';
import { activeSite, siteBalance, requireSiteStock, addSiteStock, internalInTransit, unslippedQuarantine, consumeQuarantineCase, type ReceiptLine } from './distribution-inventory.js';
import { prepareC2,consumeC2 } from './distribution-c2.js';
import type {
  TransferInput,
  TransferSignature,
  TransferKeyInput,
  TransferVersion,
  TraceNoticeInput,
  TransferObservationInput,
  HoldingDispositionInput,
  SiteAllocationInput,
  QuarantineInput,
  ActualReceiptInput,
  ReturnInput,
  ReturnSignatureInput,
  DistributionC2Prepare, DistributionC2Submit,
  ConsentRenewInput,
  DistributionReportQuery,
} from './dto.js';

export const DISTRIBUTION_SIGNATURE_DOMAIN =
  'agritrace:distribution-attestation:1';
export const DISTRIBUTION_KEY_DOMAIN = 'agritrace:distribution-key:1';
export function distributionSnapshot(
  t: DistributionTransfer & { lines: DistributionLine[] },
) {
  return {
    id: t.id,
    chainId: t.chainId,
    senderId: t.senderId,
    carrierId: t.carrierId,
    receiverId: t.receiverId,
    origin: t.origin,
    destination: t.destination,
    vehicleId: t.vehicleId,
    ...(t.plannedPickupAt ? {
      plannedPickupAt: t.plannedPickupAt.toISOString(),
      plannedDeliveryAt: t.plannedDeliveryAt?.toISOString() ?? null,
      note: t.note,
    } : {}),
    ...(t.handoverMode === 'DUAL_SIGNED' ? {handoverMode:t.handoverMode} : {}),
    ...(t.attestationEpoch ? {attestationEpoch:t.attestationEpoch} : {}),
    ...(t.receiptDigest ? { receiptDigest: t.receiptDigest } : {}),
    ...(t.senderSiteId || t.carrierSiteId || t.receiverSiteId
      ? {
          senderSiteId: t.senderSiteId,
          carrierSiteId: t.carrierSiteId,
          receiverSiteId: t.receiverSiteId,
        }
      : {}),
    lines: t.lines
      .map((l) => ({
        lotId: l.lotId,
        quantity: l.quantity.toFixed(3),
        unit: l.unit,
      }))
      .sort((a, b) => a.lotId.localeCompare(b.lotId)),
  };
}
export const domainMessage = (domain: string, body: unknown) =>
  Buffer.from(`${domain}\0${canonicalize(body)}`, 'utf8');
const participantWhere = (organizationId: string) => ({
  OR: [
    { senderId: organizationId },
    { carrierId: organizationId },
    { receiverId: organizationId },
  ],
});

@Injectable()
export class DistributionService {
  constructor(
    private readonly db: PrismaService,
    private readonly trace: TraceService,
  ) {}
  async options(actor: CommandActor) {
    const auth = await enterpriseAuthority(this.db, actor, 'distribution.read');
    const links = await this.db.enterprisePartner.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { inviterId: actor.organizationId! },
          { inviteeId: actor.organizationId! },
        ],
      },
    });
    const ids = [
      actor.organizationId!,
      ...links.map((l) =>
        l.inviterId === actor.organizationId ? l.inviteeId : l.inviterId,
      ),
    ];
    return {
      vehicles: await this.db.enterpriseVehicle.findMany({
        where: { organizationId: { in: ids }, status: 'ACTIVE' },
        select: {
          id: true,
          organizationId: true,
          registration: true,
          kind: true,
        },
        orderBy: { registration: 'asc' },
      }),
      items: await this.db.enterpriseSite.findMany({
        where: { organizationId: { in: ids }, status: 'ACTIVE', ...(!auth.primary ? {OR:[{organizationId:{not:actor.organizationId!}},{id:{in:auth.matching.flatMap(r=>r.siteIds)}}]}:{}) },
        select: { id: true, organizationId: true, name: true, kind: true },
        orderBy: { name: 'asc' },
      }),
    };
  }
  async list(actor: CommandActor) {
    const auth = await enterpriseAuthority(this.db, actor, 'distribution.read');
    const chains = auth.primary
      ? undefined
      : [
          ...new Set(
            auth.user.enterpriseRoles
              .filter((r) => r.role.permissions.includes('distribution.read'))
              .flatMap((r) => r.chainIds),
          ),
        ];
    const rows = await this.db.distributionTransfer.findMany({
      where: {
        ...enterpriseTransferWhere(actor, auth),
        ...(chains ? { chainId: { in: chains } } : {}),
      },
      include: {
        lines: true,
        attestations: {
          select: {
            id: true,
            organizationId: true,
            phase: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { items: await this.decorate(rows) };
  }
  private async decorate<
    T extends DistributionTransfer & { lines: DistributionLine[] },
  >(rows: T[]) {
    const orgs = await this.db.organization.findMany({
      where: {
        id: {
          in: rows.flatMap((t) => [t.senderId, t.carrierId, t.receiverId]),
        },
      },
      select: { id: true, name: true },
    });
    const lots = await this.db.lot.findMany({
      where: { id: { in: rows.flatMap((t) => t.lines.map((l) => l.lotId)) } },
      select: {
        id: true,
        lotCode: true,
        product: { select: { productName: true } },
      },
    });
    return rows.map((t) => ({
      ...t,
      senderName: orgs.find((o) => o.id === t.senderId)?.name,
      carrierName: orgs.find((o) => o.id === t.carrierId)?.name,
      receiverName: orgs.find((o) => o.id === t.receiverId)?.name,
      lines: t.lines.map((l) => ({
        ...l,
        lotCode: lots.find((x) => x.id === l.lotId)?.lotCode,
        productName: lots.find((x) => x.id === l.lotId)?.product.productName,
      })),
    }));
  }
  async detail(actor: CommandActor, id: string) {
    const t = await this.db.distributionTransfer.findFirst({
      where: {
        id,
        ...participantWhere(
          actor.organizationId ?? '00000000-0000-0000-0000-000000000000',
        ),
      },
      include: { lines: true, attestations: true },
    });
    if (!t) throw new NotFoundException('Không tìm thấy giao nhận');
    const site =
      t.senderId === actor.organizationId
        ? t.senderSiteId
        : t.carrierId === actor.organizationId
          ? t.carrierSiteId
          : t.receiverSiteId;
    const authority = await enterpriseAuthority(
      this.db,
      actor,
      'distribution.read',
      t.chainId,
      site ?? undefined,
    );
    if (!authority.primary && !site)
      throw new ForbiddenException(
        'Giao nhận chưa có cơ sở được phân công cho nhân viên',
      );
    const has = (permission: string) => authority.primary || authority.user.enterpriseRoles.some(r => r.role.permissions.includes(permission) && r.chainIds.includes(t.chainId) && !!site && r.siteIds.includes(site));
    const phases = ['CONSENT','PICKUP','DELIVERY'].filter(phase=>this.phaseAllowed(t,phase,actor.organizationId!));
    const signed = new Set(t.attestations.filter(a => a.organizationId === actor.organizationId && a.epoch===t.attestationEpoch).map(a => a.phase));
    const allowedActions = [
      ...(has('distribution.sign') ? phases.filter(p => !signed.has(p)) : []),
      ...(has('distribution.sign') && t.receiverId === actor.organizationId && t.status === 'IN_TRANSIT' && !t.receiptDigest ? ['ACTUAL_RECEIPT'] : []),
      ...(has('distribution.write') && t.senderId === actor.organizationId && ['PROPOSED','READY'].includes(t.status) ? ['CANCEL'] : []),
      ...(has('distribution.write') && t.carrierId === actor.organizationId && t.status === 'IN_TRANSIT' ? ['OBSERVE'] : []),
      ...(has('distribution.write') && t.carrierId === actor.organizationId && t.status === 'DELIVERED' ? ['RETURN'] : []),
      ...(has('distribution.write') && ['PROPOSED','READY','IN_TRANSIT'].includes(t.status)?['RENEW_CONSENT']:[]),
    ];
    return {
      record: {
        ...(await this.decorate([t]))[0],
        allowedActions,
        receipt: await this.db.distributionReceipt.findUnique({ where: { transferId: id } }),
        remainders: await this.db.distributionRemainder.findMany({ where: { transferId: id } }),
        returns: await Promise.all((await this.db.distributionReturn.findMany({ where: { transferId: id }, orderBy: { createdAt: 'asc' } })).map(async r => {
          const signatures = await this.db.distributionReturnSignature.findMany({ where: { returnId: r.id }, select: { organizationId: true } });
          return { ...r, signedOrganizations: signatures.map(s => s.organizationId), allowedActions: has('distribution.sign') && [t.senderId,t.carrierId].includes(actor.organizationId!) && r.status === 'PROPOSED' && !signatures.some(s => s.organizationId === actor.organizationId) ? ['SIGN_RETURN'] : [] };
        })),
        observations: await this.db.distributionObservation.findMany({
          where: { transferId: id },
          orderBy: { eventTime: 'asc' },
        }),
      },
    };
  }
  async challenge(actor: CommandActor, id: string) {
    const { record: t } = await this.detail(actor, id);
    await enterpriseAuthority(this.db, actor, 'distribution.sign', t.chainId);
    return {
      snapshot: distributionSnapshot(t),
      snapshotDigest: canonicalSha256(distributionSnapshot(t)),
      domain: DISTRIBUTION_SIGNATURE_DOMAIN,
      phases: t.allowedActions.filter(p => ['CONSENT','PICKUP','DELIVERY'].includes(p)),
    };
  }
  private async parties(
    tx: Prisma.TransactionClient,
    t: Pick<
      DistributionTransfer,
      'senderId' | 'carrierId' | 'receiverId' | 'chainId'
    >,
  ) {
    for (const [id, codes] of [
      [t.senderId, ['FARM', 'DISTRIBUTOR', 'RETAILER']],
      [t.carrierId, ['TRANSPORTER']],
      [t.receiverId, ['DISTRIBUTOR', 'RETAILER']],
    ] as const) {
      await tx.$queryRaw`SELECT organization_id FROM organization WHERE organization_id=${id}::uuid FOR SHARE`;
      const org = await tx.organization.findUnique({
        where: { id },
        include: {
          capabilities: { where: { revokedAt: null } },
          chainMemberships: { where: { chainId: t.chainId, status: 'ACTIVE' } },
        },
      });
      if (
        !org ||
        org.status !== 'ACTIVE' ||
        !org.capabilities.some((c) =>
          (codes as readonly string[]).includes(c.code),
        ) ||
        !org.chainMemberships.length
      )
        throw new ForbiddenException(
          'Một bên chưa có năng lực hoặc tư cách tham gia chuỗi phù hợp',
        );
    }
    for (const id of [t.carrierId, t.receiverId]) {
      const partner = await tx.enterprisePartner.findFirst({
        where: {
          status: 'ACTIVE',
          OR: [
            { inviterId: t.senderId, inviteeId: id },
            { inviteeId: t.senderId, inviterId: id },
          ],
        },
      });
      if (!partner)
        throw new ForbiddenException(
          'Các bên phải chấp nhận liên kết doanh nghiệp trước khi giao nhận',
        );
      await tx.$queryRaw`SELECT id FROM enterprise_partner WHERE id=${partner.id}::uuid FOR SHARE`;
      if (
        (
          await tx.enterprisePartner.findUniqueOrThrow({
            where: { id: partner.id },
          })
        ).status !== 'ACTIVE'
      )
        throw new ForbiddenException('Liên kết đã bị thu hồi');
    }
  }
  private async assets(
    tx: Prisma.TransactionClient,
    t: {
      senderId: string;
      carrierId: string;
      receiverId: string;
      senderSiteId?: string | null;
      carrierSiteId?: string | null;
      receiverSiteId?: string | null;
      vehicleId?: string | null;
    },
  ) {
    for (const [id, organizationId] of [
      [t.senderSiteId, t.senderId],
      [t.carrierSiteId, t.carrierId],
      [t.receiverSiteId, t.receiverId],
    ]) {
      if (
        id &&
        !(await tx.enterpriseSite.findFirst({
          where: { id, organizationId: organizationId!, status: 'ACTIVE' },
        }))
      )
        throw new ConflictException(
          'Một cơ sở trong giao nhận đã ngừng hoạt động hoặc đổi phạm vi',
        );
    }
    if (
      t.vehicleId &&
      !(await tx.enterpriseVehicle.findFirst({
        where: {
          id: t.vehicleId,
          organizationId: t.carrierId,
          status: 'ACTIVE',
        },
      }))
    )
      throw new ConflictException(
        'Phương tiện không còn được phép sử dụng cho chặng này',
      );
  }
  private async assertLot(
    tx: Prisma.TransactionClient,
    lotId: string,
    chainId: string,
    allowQuarantineReceipt = false,
  ) {
    await tx.$queryRaw`SELECT lot_id FROM lot WHERE lot_id=${lotId}::uuid FOR UPDATE`;
    const lot = await tx.lot.findUnique({
      where: { id: lotId },
      include: { shipment: true, harvest: { include: { cycle: true } } },
    });
    if (!lot || lot.harvest.cycle.chainId !== chainId)
      throw new NotFoundException('Lô không thuộc chuỗi');
    if (lot.shipment)
      throw new ConflictException(
        'Lô đang sử dụng luồng chuyến hàng cũ; cần đối soát trước khi chuyển luồng',
      );
    if (!allowQuarantineReceipt && (
      ['RECALLED', 'EXPIRED', 'DAMAGED', 'REJECTED', 'SOLD'].includes(
        lot.currentState,
      ) ||
      isPastExpiry(lot.expiryDate)
    ))
      throw new ConflictException(
        'Lô đã bị chặn, hết hạn hoặc không còn khả dụng',
      );
    if (!(await quantityIsReconciled(tx, lot)))
      throw new ConflictException('Lô chưa đối soát số lượng');
    if (!allowQuarantineReceipt && await tx.traceNotice.findFirst({ where: { lotId, kind: 'RECALL' } }))
      throw new ConflictException(
        'Lô nguồn có thông báo thu hồi; dừng giao nhận để đối soát',
      );
    return lot;
  }
  create(actor: CommandActor, input: TransferInput) {
    const { lines, plannedPickupAt: pickupInput, plannedDeliveryAt: deliveryInput, ...data } = input;
    return commandTransaction(this.db, async (tx) => {
      const plannedPickupAt = businessTimestamp(pickupInput, 'Ngày dự kiến lấy hàng', { allowFuture: true });
      const plannedDeliveryAt = deliveryInput
        ? businessTimestamp(deliveryInput, 'Ngày dự kiến giao hàng', { allowFuture: true, notBefore: plannedPickupAt })
        : null;
      await enterpriseAuthority(
        tx,
        actor,
        'distribution.write',
        input.chainId,
        input.senderSiteId,
        true,
      );
      const ledger = await tx.chainLedgerProfile.findUnique({
        where: { chainId: input.chainId },
      });
      if (ledger?.handoverMode === 'DUAL_SIGNED' && process.env.DISTRIBUTION_C2_ENABLED !== 'true')
        throw new ConflictException(
          'Chuỗi đang bắt buộc signed intent c2; dùng bàn giao đã ký của chuyến hàng hiện hành. Luồng phân phối mới cần nghiệm thu binding riêng trước khi mở.',
        );
      const ids = [actor.organizationId!, input.receiverId, input.carrierId];
      if (!input.senderSiteId || !input.carrierSiteId || !input.receiverSiteId)
        throw new UnprocessableEntityException('Chọn cơ sở của cả ba bên để kiểm soát tồn và quyền theo cơ sở');
      if (new Set(ids).size !== 3)
        throw new UnprocessableEntityException(
          'Cần ba doanh nghiệp độc lập: giao, vận chuyển, nhận',
        );
      if (new Set(input.lines.map((l) => l.lotId)).size !== input.lines.length)
        throw new UnprocessableEntityException(
          'Không lặp lô trong cùng giao nhận',
        );
      await this.parties(tx, { senderId: actor.organizationId!, ...input });
      await this.assets(tx, { senderId: actor.organizationId!, ...input });
      if (
        input.vehicleId &&
        !(await tx.enterpriseVehicle.findFirst({
          where: {
            id: input.vehicleId,
            organizationId: input.carrierId,
            status: 'ACTIVE',
          },
        }))
      )
        throw new ForbiddenException(
          'Phương tiện phải thuộc bên vận chuyển và đang hoạt động',
        );
      for (const l of [...input.lines].sort((a, b) =>
        a.lotId.localeCompare(b.lotId),
      )) {
        const lot = await this.assertLot(tx, l.lotId, input.chainId);
        if (lot.unit !== l.unit)
          throw new ConflictException('Đơn vị phải giống lô nguồn');
        const qty = quantity(l.quantity);
        if (!(await tx.lotHolding.count({ where: { lotId: lot.id } }))) {
          if (
            lot.farmOrgId !== actor.organizationId ||
            lot.currentState !== 'HARVESTED'
          )
            throw new ForbiddenException(
              'Chỉ chủ lô nguồn được khởi tạo phân bổ',
            );
          await tx.lotHolding.create({
            data: {
              lotId: lot.id,
              organizationId: lot.farmOrgId,
              quantity: lot.availableQuantity,
            },
          });
        }
        const holding = await tx.lotHolding.findUnique({
          where: {
            lotId_organizationId: {
              lotId: lot.id,
              organizationId: actor.organizationId!,
            },
          },
        });
        if (!holding || holding.quantity.sub(holding.reserved).lt(qty))
          throw new ConflictException(
            'Lượng giao vượt lượng còn có thể phân bổ',
          );
        await requireSiteStock(tx, lot.id, actor.organizationId!, input.senderSiteId, qty);
        await tx.lotSiteHolding.update({ where: { lotId_organizationId_siteId: { lotId: lot.id, organizationId: actor.organizationId!, siteId: input.senderSiteId } }, data: { reserved: { increment: qty }, version: { increment: 1 } } });
        await tx.lotHolding.update({
          where: {
            lotId_organizationId: {
              lotId: lot.id,
              organizationId: actor.organizationId!,
            },
          },
          data: { reserved: { increment: qty }, version: { increment: 1 } },
        });
      }
      const transfer = await tx.distributionTransfer.create({
        data: {
          ...data,
          plannedPickupAt,
          plannedDeliveryAt,
          handoverMode:ledger?.handoverMode??'STANDARD',
          senderId: actor.organizationId!,
          lines: { create: lines },
        },
        include: { lines: true },
      });
      await this.events(tx, transfer, actor, 'DISTRIBUTION_PROPOSED');
      return { record: transfer };
    });
  }
  private async events(
    tx: Prisma.TransactionClient,
    t: DistributionTransfer & { lines: DistributionLine[] },
    actor: CommandActor,
    eventType: string,
    extra: Prisma.InputJsonObject = {},
  ) {
    for (const l of [...t.lines].sort((a, b) => a.lotId.localeCompare(b.lotId)))
      await this.trace.createInTransaction(tx, {
        entityType: 'LOT',
        entityId: l.lotId,
        lotId: l.lotId,
        eventType,
        actor: { ...actor, role: actor.role },
        businessData: {
          transferRef: t.id,
          snapshotDigest: canonicalSha256(distributionSnapshot(t)),
          quantity: l.quantity.toFixed(3),
          unit: l.unit,
          ...extra,
        },
      });
  }
  async keys(actor: CommandActor) {
    await enterpriseAuthority(this.db, actor, 'distribution.sign');
    return {
      items: await this.db.distributionKey.findMany({
        where: { organizationId: actor.organizationId! },
        orderBy: { createdAt: 'desc' },
      }),
    };
  }
  registerKey(actor: CommandActor, input: TransferKeyInput) {
    return commandTransaction(this.db, async (tx) => {
      const auth = await enterpriseAuthority(
        tx,
        actor,
        'roles.manage',
        undefined,
        undefined,
        true,
      );
      if (!auth.primary)
        throw new ForbiddenException(
          'Chỉ tài khoản cấp 1 được đăng ký khóa doanh nghiệp',
        );
      try {
        parseEd25519PublicKey(input.publicKey);
      } catch {
        throw new UnprocessableEntityException(
          'Khóa công khai Ed25519 không hợp lệ',
        );
      }
      if (
        !verifyEd25519(
          input.publicKey,
          domainMessage(DISTRIBUTION_KEY_DOMAIN, {
            id: input.id,
            organizationId: actor.organizationId,
            publicKey: input.publicKey,
          }),
          input.popSignature,
        )
      )
        throw new UnprocessableEntityException(
          'Bằng chứng sở hữu khóa không hợp lệ',
        );
      return {
        record: await tx.distributionKey.create({
          data: {
            id: input.id,
            organizationId: actor.organizationId!,
            publicKey: input.publicKey,
            label: input.label,
          },
        }),
      };
    });
  }
  revokeKey(actor: CommandActor, id: string) {
    return commandTransaction(this.db, async (tx) => {
      const auth = await enterpriseAuthority(
        tx,
        actor,
        'roles.manage',
        undefined,
        undefined,
        true,
      );
      if (!auth.primary) throw new ForbiddenException();
      const changed = await tx.distributionKey.updateMany({
        where: { id, organizationId: actor.organizationId!, status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      });
      if (!changed.count)
        throw new ConflictException('Khóa không còn hoạt động');
      return { record: { id, status: 'REVOKED' } };
    });
  }
  sign(actor: CommandActor, id: string, input: TransferSignature) {
    return this.signInternal(actor,id,input);
  }
  submitC2(actor:CommandActor,id:string,input:DistributionC2Submit) {
    if(input.phase==='RETURN') {
      if(!input.returnId)throw new ConflictException('Thiếu mã chặng trả');
      return this.signReturn(actor,id,input.returnId,{version:input.version,keyRef:'00000000-0000-0000-0000-000000000000',expiresAt:new Date(Date.now()+900_000).toISOString(),signature:input.signatures[0].signature},input);
    }
    return this.signInternal(actor,id,{version:input.version,phase:input.phase,keyRef:'00000000-0000-0000-0000-000000000000',expiresAt:new Date(Date.now()+900_000).toISOString(),signature:input.signatures[0].signature},input);
  }
  prepareC2(actor:CommandActor,id:string,input:DistributionC2Prepare) {
    return commandTransaction(this.db,async tx=>{
      await tx.$queryRaw`SELECT id FROM distribution_transfer WHERE id=${id}::uuid FOR UPDATE`;
      const t=await tx.distributionTransfer.findUniqueOrThrow({where:{id},include:{lines:true,attestations:true}});
      if(![t.senderId,t.receiverId,t.carrierId].includes(actor.organizationId!))throw new NotFoundException();
      const site=(actor.organizationId===t.senderId?t.senderSiteId:actor.organizationId===t.carrierId?t.carrierSiteId:t.receiverSiteId)??undefined;
      const auth=await enterpriseAuthority(tx,actor,'distribution.sign',t.chainId,site,true);
      const r=input.phase==='RETURN'&&input.returnId?await tx.distributionReturn.findUnique({where:{id:input.returnId}}):undefined;
      if(input.phase==='RETURN' && (!r||r.transferId!==id||r.status!=='PROPOSED'||r.version!==input.version||![t.senderId,t.carrierId].includes(actor.organizationId!)))throw new ConflictException('Chặng trả không phù hợp');
      if(input.phase!=='RETURN' && (t.version!==input.version || !this.phaseAllowed(t,input.phase,actor.organizationId!)))throw new ConflictException('Trạng thái hoặc phiên bản bàn giao đã đổi');
      return prepareC2(tx,t,actor,auth.scope,input.phase,distributionSnapshot(t),input.keyRef,r??undefined);
    });
  }
  private phaseAllowed(t:DistributionTransfer & {attestations:{phase:string;epoch:number}[]},phase:string,org:string) {
    const current=t.attestations.filter(a=>a.epoch===t.attestationEpoch);
    if(phase==='CONSENT')return t.status==='PROPOSED'||(t.attestationEpoch>0 && ['READY','IN_TRANSIT'].includes(t.status) && current.filter(a=>a.phase==='CONSENT').length<3);
    if(t.attestationEpoch>0&&current.filter(a=>a.phase==='CONSENT').length!==3)return false;
    return phase==='PICKUP'?t.status==='READY'&&[t.senderId,t.carrierId].includes(org):t.status==='IN_TRANSIT'&&[t.carrierId,t.receiverId].includes(org)&&(!t.receiverSiteId||!!t.receiptDigest);
  }
  renewConsent(actor:CommandActor,id:string,input:ConsentRenewInput) {
   return commandTransaction(this.db,async tx=>{
    await tx.$queryRaw`SELECT id FROM distribution_transfer WHERE id=${id}::uuid FOR UPDATE`;
    const t=await tx.distributionTransfer.findUniqueOrThrow({where:{id},include:{lines:true}});
    if(![t.senderId,t.carrierId,t.receiverId].includes(actor.organizationId!))throw new NotFoundException();
    await enterpriseAuthority(tx,actor,'distribution.write',t.chainId,(t.senderId===actor.organizationId?t.senderSiteId:t.carrierId===actor.organizationId?t.carrierSiteId:t.receiverSiteId)??undefined,true);
    if(t.version!==input.version||!['PROPOSED','READY','IN_TRANSIT'].includes(t.status))throw new ConflictException('Chỉ yêu cầu đồng thuận lại khi chặng chưa hoàn tất');
    const updated=await tx.distributionTransfer.update({where:{id},data:{attestationEpoch:{increment:1},version:{increment:1}},include:{lines:true}});
    await this.events(tx,t,actor,'DISTRIBUTION_CONSENT_RENEWED',{epoch:updated.attestationEpoch,reason:input.reason});
    return {record:updated};
   });
  }
  private signInternal(actor: CommandActor, id: string, input: TransferSignature,c2?:DistributionC2Submit) {
    return commandTransaction(this.db, async (tx) => {
      await tx.$queryRaw`SELECT id FROM distribution_transfer WHERE id=${id}::uuid FOR UPDATE`;
      const t = await tx.distributionTransfer.findUnique({
        where: { id },
        include: { lines: true, attestations: true },
      });
      if (
        !t ||
        ![t.senderId, t.carrierId, t.receiverId].includes(actor.organizationId!)
      )
        throw new NotFoundException();
      const siteId =
        t.senderId === actor.organizationId
          ? t.senderSiteId
          : t.carrierId === actor.organizationId
            ? t.carrierSiteId
            : t.receiverSiteId;
      const auth = await enterpriseAuthority(
        tx,
        actor,
        'distribution.sign',
        t.chainId,
        siteId ?? undefined,
        true,
      );
      if (t.version !== input.version)
        throw new ConflictException(
          'Giao nhận đã thay đổi; tải lại trước khi ký',
        );
      if((t.handoverMode==='DUAL_SIGNED')!==!!c2)throw new ConflictException('Giao thức chữ ký phải khớp chế độ đã ghim của chặng');
      const allowed = this.phaseAllowed(t,input.phase,actor.organizationId!);
      if (!allowed)
        throw new ConflictException(
          'Bước bàn giao không phù hợp trạng thái hoặc bên ký',
        );
      if (input.phase === 'DELIVERY' && t.receiverSiteId && !t.receiptDigest)
        throw new ConflictException('Bên nhận cần lập biên bản thực nhận trước khi hai bên ký');
      const expiry = Date.parse(input.expiresAt);
      if (expiry <= Date.now() || expiry > Date.now() + 20 * 60_000)
        throw new ConflictException('Chữ ký phải có thời hạn trong 20 phút');
      await this.parties(tx, t);
      await this.assets(tx, t);
      const consumed=c2?await consumeC2(tx,t,actor,auth.scope,c2,distributionSnapshot(t)):undefined;
      if(consumed?.length)input={...input,keyRef:consumed[0].intent.keyRef,expiresAt:consumed[0].intent.expiresAt.toISOString(),signature:consumed[0].intent.signature!};
      const key = consumed?.[0].intent.key ?? await tx.distributionKey.findFirst({
        where: {
          id: input.keyRef,
          organizationId: actor.organizationId!,
          status: 'ACTIVE',
        },
      });
      if (!key)
        throw new ForbiddenException(
          'Khóa ký đã bị thu hồi hoặc ngoài doanh nghiệp',
        );
      const snapshotDigest = canonicalSha256(distributionSnapshot(t));
      const body = {
        snapshotDigest,
        transferId: id,
        phase: input.phase,
        organizationId: actor.organizationId,
        userId: actor.sub,
        keyRef: input.keyRef,
        version: String(input.version),
        expiresAt: input.expiresAt,
      };
      const signatureCommitment = canonicalSha256({
        body,
        publicKey: key.publicKey,
        signature: input.signature,
      });
      if (!c2 && (
        !verifyEd25519(
          key.publicKey,
          domainMessage(DISTRIBUTION_SIGNATURE_DOMAIN, body),
          input.signature,
        )
      ))
        throw new UnprocessableEntityException(
          'Chữ ký không khớp nội dung giao nhận',
        );
      // Revalidate earlier consent at every physical transition, including withdrawn staff authority.
      for (const a of t.attestations.filter(a=>a.epoch===t.attestationEpoch)) {
        const old = await tx.user.findUnique({
          where: { id: a.userId },
          include: { role: true },
        });
        if (!old || old.accountStatus !== 'ACTIVE')
          throw new ForbiddenException(
            'Một bên ký trước đã bị thu hồi tài khoản',
          );
        const priorSiteId =
          t.senderId === old.organizationId
            ? t.senderSiteId
            : t.carrierId === old.organizationId
              ? t.carrierSiteId
              : t.receiverSiteId;
        const now = await enterpriseAuthority(
          tx,
          {
            sub: old.id,
            organizationId: old.organizationId,
            role: old.role.code,
          },
          'distribution.sign',
          t.chainId,
          priorSiteId ?? undefined,
        );
        const oldAuth = a.authority as Prisma.JsonObject;
        const oldKey = t.handoverMode==='DUAL_SIGNED'?await tx.signingKey.findUnique({where:{keyRef:a.keyRef}}):await tx.distributionKey.findUnique({where:{id:a.keyRef}});
        if (now.scope !== oldAuth.scope || oldKey?.status !== 'ACTIVE')
          throw new ForbiddenException(
            'Quyền hoặc khóa của một bên đã thay đổi; cần đối soát giao nhận',
          );
      }
      for (const l of [...t.lines].sort((a, b) =>
        a.lotId.localeCompare(b.lotId),
      ))
        await this.assertLot(tx, l.lotId, t.chainId, input.phase === 'DELIVERY');
      await tx.distributionAttestation.create({
        data: {
          transferId: id,
          organizationId: actor.organizationId!,
          userId: actor.sub!,
          phase: input.phase,
          epoch:t.attestationEpoch,
          keyRef: input.keyRef,
          digest: canonicalSha256(body),
          signature: input.signature,
          authority: { scope: auth.scope, body, signatureCommitment },
        },
      });
      const phaseCount =
        t.attestations.filter((a) => a.phase === input.phase && a.epoch===t.attestationEpoch).length + 1;
      let status = t.status;
      if (input.phase === 'CONSENT' && phaseCount === 3 && t.status==='PROPOSED') status = 'READY';
      if (input.phase === 'PICKUP' && phaseCount === 2) {
        status = 'IN_TRANSIT';
        for (const l of t.lines) {
          if (t.senderSiteId) await tx.lotSiteHolding.update({ where: { lotId_organizationId_siteId: { lotId: l.lotId, organizationId: t.senderId, siteId: t.senderSiteId } }, data: { quantity: { decrement: l.quantity }, reserved: { decrement: l.quantity }, version: { increment: 1 } } });
          await tx.lotHolding.update({
            where: {
              lotId_organizationId: {
                lotId: l.lotId,
                organizationId: t.senderId,
              },
            },
            data: {
              quantity: { decrement: l.quantity },
              reserved: { decrement: l.quantity },
              version: { increment: 1 },
            },
          });
        }
      }
      if (input.phase === 'DELIVERY' && phaseCount === 2) {
        status = 'DELIVERED';
        const receipt = await tx.distributionReceipt.findUnique({ where: { transferId: id } });
        const receiptLines = receipt?.lines as ReceiptLine[] | undefined;
        for (const l of t.lines) {
          const actual = receiptLines?.find(r => r.lotId === l.lotId);
          const received = new Prisma.Decimal(actual?.received ?? l.quantity);
          const remaining = l.quantity.sub(received);
          const lot = await tx.lot.findUniqueOrThrow({ where: { id: l.lotId } });
          const recalled = !!await tx.traceNotice.findFirst({ where: { lotId: l.lotId, kind: 'RECALL' } });
          const quarantine = recalled || isPastExpiry(lot.expiryDate) || lot.currentState === 'RECALLED' ? received : new Prisma.Decimal(actual?.quarantined ?? 0);
          if (remaining.gt(0)) await tx.distributionRemainder.create({ data: { transferId: id, lotId: l.lotId, quantity: remaining } });
          await tx.lotHolding.upsert({
            where: {
              lotId_organizationId: {
                lotId: l.lotId,
                organizationId: t.receiverId,
              },
            },
            create: {
              lotId: l.lotId,
              organizationId: t.receiverId,
              quantity: received,
            },
            update: {
              quantity: { increment: received },
              version: { increment: 1 },
            },
          });
          if (t.receiverSiteId) await addSiteStock(tx, l.lotId, t.receiverId, t.receiverSiteId, received, quarantine);
        }
      }
      const updated = await tx.distributionTransfer.update({
        where: { id },
        data: { status, version: { increment: 1 } },
        include: { lines: true },
      });
      if(consumed)for(const row of consumed)await this.trace.createInTransaction(tx,{entityType:'LOT',entityId:row.lotId,lotId:row.lotId,eventId:row.intent.eventId,eventType:row.intent.eventType,actor,businessData:row.payload,signature:{intentId:row.intent.id}});
      else await this.events(
        tx,
        t,
        actor,
        status !== t.status
          ? `DISTRIBUTION_${status}`
          : 'DISTRIBUTION_ATTESTED',
        {
          phase: input.phase,
          attestationDigest: canonicalSha256(body),
          signatureCommitment,
          signerOrganizationId: actor.organizationId!,
        },
      );
      return { record: updated };
    });
  }
  cancel(actor: CommandActor, id: string, input: TransferVersion) {
    return commandTransaction(this.db, async (tx) => {
      await tx.$queryRaw`SELECT id FROM distribution_transfer WHERE id=${id}::uuid FOR UPDATE`;
      const t = await tx.distributionTransfer.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!t || t.senderId !== actor.organizationId)
        throw new ForbiddenException('Chỉ bên giao được hủy trước bàn giao');
      if (
        !['PROPOSED', 'READY'].includes(t.status) ||
        t.version !== input.version
      )
        throw new ConflictException(
          'Không thể hủy; giao nhận đã thay đổi hoặc đã lấy hàng',
        );
      for (const l of [...t.lines].sort((a, b) =>
        a.lotId.localeCompare(b.lotId),
      )) {
        await tx.$queryRaw`SELECT lot_id FROM lot WHERE lot_id=${l.lotId}::uuid FOR UPDATE`;
        if (t.senderSiteId) await tx.lotSiteHolding.update({ where: { lotId_organizationId_siteId: { lotId: l.lotId, organizationId: t.senderId, siteId: t.senderSiteId } }, data: { reserved: { decrement: l.quantity }, version: { increment: 1 } } });
        await tx.lotHolding.update({
          where: {
            lotId_organizationId: {
              lotId: l.lotId,
              organizationId: t.senderId,
            },
          },
          data: {
            reserved: { decrement: l.quantity },
            version: { increment: 1 },
          },
        });
      }
      const updated = await tx.distributionTransfer.update({
        where: { id },
        data: { status: 'CANCELLED', version: { increment: 1 } },
        include: { lines: true },
      });
      await this.events(tx, t, actor, 'DISTRIBUTION_CANCELLED');
      return { record: updated };
    });
  }
  observe(actor: CommandActor, id: string, input: TransferObservationInput) {
    return commandTransaction(this.db, async (tx) => {
      await tx.$queryRaw`SELECT id FROM distribution_transfer WHERE id=${id}::uuid FOR UPDATE`;
      const t = await tx.distributionTransfer.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (
        !t ||
        t.carrierId !== actor.organizationId ||
        t.status !== 'IN_TRANSIT'
      )
        throw new ForbiddenException(
          'Chỉ bên vận chuyển ghi nhật ký khi đang vận chuyển',
        );
      const time = new Date(input.eventTime);
      if (time.getTime() > Date.now() + 60_000 || time < t.createdAt)
        throw new ConflictException('Thời điểm nhật ký ngoài khoảng giao nhận');
      const observation = await tx.distributionObservation.create({
        data: {
          transferId: id,
          organizationId: actor.organizationId!,
          eventTime: time,
          note: input.note,
          temperature: input.temperature,
        },
      });
      await this.events(tx, t, actor, 'DISTRIBUTION_OBSERVED', {
        observationId: observation.id,
        eventTime: time.toISOString(),
        note: input.note,
        temperature: input.temperature ?? null,
        source: 'MANUAL',
      });
      return { record: observation };
    });
  }
  notice(actor: CommandActor, input: TraceNoticeInput) {
    return commandTransaction(this.db, async (tx) => {
      await tx.$queryRaw`SELECT lot_id FROM lot WHERE lot_id=${input.lotId}::uuid FOR UPDATE`;
      const lot = await tx.lot.findUnique({
        where: { id: input.lotId },
        include: { harvest: { include: { cycle: true } } },
      });
      if (!lot || lot.farmOrgId !== actor.organizationId)
        throw new ForbiddenException(
          'Chỉ doanh nghiệp sản xuất lô nguồn được phát cảnh báo công khai',
        );
      await enterpriseAuthority(
        tx,
        actor,
        'distribution.write',
        lot.harvest.cycle.chainId,
        lot.harvest.cycle.farmId,
        true,
      );
      const notice = await tx.traceNotice.create({
        data: { ...input, organizationId: actor.organizationId! },
      });
      await this.trace.createInTransaction(tx, {
        entityType: 'LOT',
        entityId: lot.id,
        lotId: lot.id,
        eventType: 'DISTRIBUTION_NOTICE',
        actor,
        businessData: {
          noticeId: notice.id,
          kind: notice.kind,
          message: notice.message,
        },
      });
      return { record: notice };
    });
  }
  disposition(actor: CommandActor, input: HoldingDispositionInput) {
    return commandTransaction(this.db, async (tx) => {
      await tx.$queryRaw`SELECT lot_id FROM lot WHERE lot_id=${input.lotId}::uuid FOR UPDATE`;
      const lot = await tx.lot.findUnique({
        where: { id: input.lotId },
        include: { harvest: { include: { cycle: true } } },
      });
      if (!lot) throw new NotFoundException('Không tìm thấy lô');
      const authority = await enterpriseAuthority(
        tx,
        actor,
        'quantity.adjust',
        lot.harvest.cycle.chainId,
        input.siteId,
        true,
      );
      if (!input.siteId && !authority.primary) throw new ForbiddenException('Chọn cơ sở được phân công');
      const cap = await tx.organizationCapability.findFirst({
        where: {
          organizationId: actor.organizationId!,
          code:
            input.kind === 'SALE'
              ? 'RETAILER'
              : { in: ['FARM', 'DISTRIBUTOR', 'RETAILER'] },
          revokedAt: null,
        },
      });
      if (!cap)
        throw new ForbiddenException(
          'Năng lực doanh nghiệp không phù hợp ghi giảm lượng này',
        );
      const qty = quantity(input.quantity);
      if(input.fromQuarantine){
        if(input.kind!=='DAMAGE'||!input.siteId)throw new ConflictException('Chỉ ghi hư hỏng lượng cách ly tại cơ sở');
        await enterpriseAuthority(tx,actor,'quarantine.manage',lot.harvest.cycle.chainId,input.siteId);
        const site=await siteBalance(tx,lot.id,actor.organizationId!,input.siteId);
        if(!site||site.quarantined.lt(qty))throw new ConflictException('Vượt lượng cách ly tại cơ sở');
        if(input.quarantineCaseId)await consumeQuarantineCase(tx,input.quarantineCaseId,{lotId:lot.id,organizationId:actor.organizationId!,siteId:input.siteId},qty,'DISPOSE');
        else if((await unslippedQuarantine(tx,lot.id,actor.organizationId!,input.siteId,site.quarantined)).lt(qty))throw new ConflictException('Chọn phiếu cách ly cần xử lý');
      } else if (input.siteId) await requireSiteStock(tx, lot.id, actor.organizationId!, input.siteId, qty);
      else {
        const allocated = await tx.lotSiteHolding.aggregate({ where: { lotId: lot.id, organizationId: actor.organizationId! }, _sum: { quantity: true } });
        const all = await tx.lotHolding.findUnique({ where: { lotId_organizationId: { lotId: lot.id, organizationId: actor.organizationId! } } });
        const moving = await internalInTransit(tx, lot.id, actor.organizationId!);
        // Site quantities already include reservations attached to those sites.
        if (!all || all.quantity.sub(allocated._sum.quantity ?? 0).sub(moving).lt(qty)) throw new ConflictException('Chỉ được ghi giảm phần chưa phân bổ; chọn cơ sở đang giữ hàng');
      }
      const holding = await tx.lotHolding.findUnique({
        where: {
          lotId_organizationId: {
            lotId: lot.id,
            organizationId: actor.organizationId!,
          },
        },
      });
      if (
        !holding ||
        holding.quantity.sub(holding.reserved).lt(qty) ||
        lot.unit !== input.unit ||
        lot.version !== input.version
      )
        throw new ConflictException(
          'Số lượng, đơn vị hoặc phiên bản không khớp phần doanh nghiệp đang giữ',
        );
      if (!(await quantityIsReconciled(tx, lot)))
        throw new ConflictException('Lô cần đối soát trước khi ghi giảm');
      if (
        input.kind === 'SALE' &&
        (isPastExpiry(lot.expiryDate) ||
          (await tx.traceNotice.findFirst({
            where: { lotId: lot.id, kind: 'RECALL' },
          })))
      )
        throw new ConflictException(
          'Dừng ghi bán khi lô hết hạn hoặc có thu hồi',
        );
      const after = lot.availableQuantity.sub(qty);
      const event = await this.trace.createInTransaction(tx, {
        entityType: 'LOT',
        entityId: lot.id,
        lotId: lot.id,
        eventType: 'DISTRIBUTION_QUANTITY_RECORDED',
        actor,
        businessData: {
          kind: input.kind,
          reason: input.reason,
          quantity: qty.toFixed(3),
          unit: lot.unit,
          before: lot.availableQuantity.toFixed(3),
          after: after.toFixed(3),
          organizationId: actor.organizationId!,
          siteId: input.siteId ?? null,
          fromQuarantine: input.fromQuarantine??false,
        },
      });
      await tx.lotHolding.update({
        where: {
          lotId_organizationId: {
            lotId: lot.id,
            organizationId: actor.organizationId!,
          },
        },
        data: { quantity: { decrement: qty }, version: { increment: 1 } },
      });
      if (input.siteId) await tx.lotSiteHolding.update({ where: { lotId_organizationId_siteId: { lotId: lot.id, organizationId: actor.organizationId!, siteId: input.siteId } }, data: { quantity: { decrement: qty }, ...(input.fromQuarantine?{quarantined:{decrement:qty}}:{}), version: { increment: 1 } } });
      await tx.lot.update({
        where: { id: lot.id },
        data: {
          availableQuantity: after,
          version: { increment: 1 },
          ...(after.isZero()
            ? { currentState: input.kind === 'SALE' ? 'SOLD' : 'DAMAGED' }
            : {}),
        },
      });
      await tx.quantityMovement.create({
        data: {
          lotId: lot.id,
          eventId: event.id,
          type: input.kind === 'SALE' ? 'SALE_OUT' : 'DAMAGE_OUT',
          quantity: qty,
          beforeQty: lot.availableQuantity,
          delta: qty.negated(),
          afterQty: after,
          unit: lot.unit,
        },
      });
      return {
        record: {
          lotId: lot.id,
          availableQuantity: after.toFixed(3),
          version: lot.version + 1,
        },
      };
    });
  }
  allocate(actor: CommandActor, input: SiteAllocationInput) {
    return commandTransaction(this.db, async tx => {
      await tx.$queryRaw`SELECT lot_id FROM lot WHERE lot_id=${input.lotId}::uuid FOR UPDATE`;
      const lot = await tx.lot.findUniqueOrThrow({ where: { id: input.lotId }, include: { shipment: true, harvest: { include: { cycle: true } } } });
      const auth = await enterpriseAuthority(tx, actor, 'inventory.manage', lot.harvest.cycle.chainId, input.siteId, true);
      await activeSite(tx, actor.organizationId!, input.siteId);
      if (lot.shipment || lot.unit !== input.unit || lot.version !== input.version) throw new ConflictException('Lô, đơn vị hoặc phiên bản không phù hợp phân bổ');
      if (!await quantityIsReconciled(tx, lot)) throw new ConflictException('Lô cần đối soát số lượng');
      let holding = await tx.lotHolding.findUnique({ where: { lotId_organizationId: { lotId: lot.id, organizationId: actor.organizationId! } } });
      if (!holding) {
        if (!auth.primary || lot.farmOrgId !== actor.organizationId || await tx.lotHolding.count({ where: { lotId: lot.id } })) throw new ForbiddenException('Không có lượng hàng của tổ chức');
        holding = await tx.lotHolding.create({ data: { lotId: lot.id, organizationId: actor.organizationId!, quantity: lot.availableQuantity } });
      }
      const qty = quantity(input.quantity);
      // Physical moves between two sites use a site transfer slip with receipt confirmation.
      if (input.fromSiteId) throw new ConflictException('Chuyển hàng giữa hai cơ sở cần lập phiếu chuyển kho');
      if (!auth.primary) throw new ForbiddenException('Chỉ chủ quản phân bổ lượng chưa xác định cơ sở');
      const allocated = await tx.lotSiteHolding.aggregate({ where: { lotId: lot.id, organizationId: actor.organizationId! }, _sum: { quantity: true } });
      const moving = await internalInTransit(tx, lot.id, actor.organizationId!);
      // Site quantities already include reservations attached to those sites.
      if (holding.quantity.sub(allocated._sum.quantity ?? 0).sub(moving).lt(qty)) throw new ConflictException('Vượt lượng chưa phân bổ');
      const stock = await addSiteStock(tx, lot.id, actor.organizationId!, input.siteId, qty);
      await tx.lot.update({ where: { id: lot.id }, data: { version: { increment: 1 } } });
      await this.trace.createInTransaction(tx, { entityType: 'LOT', entityId: lot.id, lotId: lot.id, eventType: 'DISTRIBUTION_SITE_ALLOCATED', actor, businessData: { siteId: input.siteId, fromSiteId: input.fromSiteId ?? null, quantity: qty.toFixed(3), unit: lot.unit, reason: input.reason } });
      return { record: { ...stock, lotVersion: lot.version + 1 } };
    });
  }
  quarantine(actor: CommandActor, input: QuarantineInput) {
    return commandTransaction(this.db, async tx => {
      await tx.$queryRaw`SELECT lot_id FROM lot WHERE lot_id=${input.lotId}::uuid FOR UPDATE`;
      const lot = await tx.lot.findUniqueOrThrow({ where: { id: input.lotId }, include: { harvest: { include: { cycle: true } } } });
      await enterpriseAuthority(tx, actor, 'quarantine.manage', lot.harvest.cycle.chainId, input.siteId, true);
      const qty = quantity(input.quantity);
      const stock = await siteBalance(tx, lot.id, actor.organizationId!, input.siteId);
      if (!stock || lot.version !== input.version || lot.unit !== input.unit) throw new ConflictException('Tồn cơ sở hoặc phiên bản không khớp');
      const scope = { lotId: lot.id, organizationId: actor.organizationId!, siteId: input.siteId };
      let slip: { id: string; code: string } | null = null;
      if (input.action === 'HOLD') {
        if (!input.cause) throw new UnprocessableEntityException('Chọn nguyên nhân cách ly');
        await requireSiteStock(tx, lot.id, actor.organizationId!, input.siteId, qty);
      } else {
        if (stock.quarantined.lt(qty)) throw new ConflictException('Vượt lượng đang cách ly');
        if (isPastExpiry(lot.expiryDate) || lot.currentState === 'RECALLED' || await tx.traceNotice.findFirst({ where: { lotId: lot.id, kind: 'RECALL' } })) throw new ConflictException('Không giải phóng hàng đã thu hồi hoặc hết hạn');
        if (input.quarantineCaseId) slip = await consumeQuarantineCase(tx, input.quarantineCaseId, scope, qty, 'RELEASE');
        else if ((await unslippedQuarantine(tx, lot.id, actor.organizationId!, input.siteId, stock.quarantined)).lt(qty)) throw new ConflictException('Chọn phiếu cách ly cần giải tỏa');
      }
      const updated = await tx.lotSiteHolding.update({ where: { lotId_organizationId_siteId: { lotId: lot.id, organizationId: actor.organizationId!, siteId: input.siteId } }, data: { quarantined: input.action === 'HOLD' ? { increment: qty } : { decrement: qty }, version: { increment: 1 } } });
      if (input.action === 'HOLD')
        slip = await tx.quarantineCase.create({ data: { code: `CL-${randomUUID().slice(0, 12).toUpperCase()}`, ...scope, quantity: qty, unit: lot.unit, cause: input.cause!, reason: input.reason.trim(), note: input.note?.trim() || null, createdBy: actor.sub! } });
      await tx.lot.update({ where: { id: lot.id }, data: { version: { increment: 1 } } });
      await this.trace.createInTransaction(tx, { entityType: 'LOT', entityId: lot.id, lotId: lot.id, eventType: 'DISTRIBUTION_QUARANTINE_RECORDED', actor, businessData: { siteId: input.siteId, action: input.action, quantity: qty.toFixed(3), reason: input.reason, ...(input.cause && input.action === 'HOLD' ? { cause: input.cause } : {}), ...(slip ? { quarantineCaseId: slip.id, code: slip.code } : {}) } });
      return { record: { ...updated, lotVersion: lot.version + 1, quarantineCase: slip } };
    });
  }
  actualReceipt(actor: CommandActor, id: string, input: ActualReceiptInput) {
    return commandTransaction(this.db, async tx => {
      await tx.$queryRaw`SELECT id FROM distribution_transfer WHERE id=${id}::uuid FOR UPDATE`;
      const t = await tx.distributionTransfer.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      if (t.receiverId !== actor.organizationId) throw new ForbiddenException('Chỉ bên nhận lập biên bản');
      await enterpriseAuthority(tx, actor, 'distribution.sign', t.chainId, t.receiverSiteId ?? undefined, true);
      if (t.status !== 'IN_TRANSIT' || t.version !== input.version || t.receiptDigest || await tx.distributionAttestation.count({ where: { transferId: id, phase: 'DELIVERY' } })) throw new ConflictException('Biên bản chỉ lập một lần trước chữ ký nhận hàng; tải lại giao nhận');
      if (new Set(input.lines.map(l => l.lotId)).size !== t.lines.length || input.lines.length !== t.lines.length) throw new ConflictException('Biên bản phải có đủ từng dòng lô');
      const lines: ReceiptLine[] = t.lines.map(l => {
        const row = input.lines.find(r => r.lotId === l.lotId);
        if (!row) throw new ConflictException('Sai dòng lô trong biên bản');
        const received = new Prisma.Decimal(row.received), rejected = new Prisma.Decimal(row.rejected), quarantined = new Prisma.Decimal(row.quarantined);
        if (received.add(rejected).gt(l.quantity) || quarantined.gt(received)) throw new ConflictException('Thực nhận + từ chối vượt lượng giao hoặc cách ly vượt thực nhận');
        return { lotId: l.lotId, received: received.toFixed(3), rejected: rejected.toFixed(3), quarantined: quarantined.toFixed(3), missing: l.quantity.sub(received).sub(rejected).toFixed(3) };
      }).sort((a,b) => a.lotId.localeCompare(b.lotId));
      const digest = canonicalSha256({ transferId: id, lines, reason: input.reason });
      const record = await tx.distributionReceipt.create({ data: { transferId: id, organizationId: actor.organizationId!, lines, reason: input.reason, digest } });
      await tx.distributionTransfer.update({ where: { id }, data: { receiptDigest: digest, version: { increment: 1 } } });
      await this.events(tx, t, actor, 'DISTRIBUTION_RECEIPT_RECORDED', { receiptId: record.id, receiptDigest: digest });
      return { record };
    });
  }
  proposeReturn(actor: CommandActor, id: string, input: ReturnInput) {
    return commandTransaction(this.db, async tx => {
      await tx.$queryRaw`SELECT id FROM distribution_transfer WHERE id=${id}::uuid FOR UPDATE`;
      const t = await tx.distributionTransfer.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      if (t.carrierId !== actor.organizationId || t.status !== 'DELIVERED' || t.version !== input.version) throw new ConflictException('Chỉ bên vận chuyển đề nghị trả lượng chưa được nhận sau bàn giao');
      await enterpriseAuthority(tx, actor, 'distribution.write', t.chainId, t.carrierSiteId ?? undefined, true);
      if (new Set(input.lines.map(l => l.lotId)).size !== input.lines.length) throw new ConflictException('Lô bị lặp');
      const lines = [];
      for (const line of input.lines) {
        const original = t.lines.find(l => l.lotId === line.lotId);
        const remainder = await tx.distributionRemainder.findUnique({ where: { transferId_lotId: { transferId: id, lotId: line.lotId } } });
        const qty = quantity(line.quantity);
        if (!original || original.unit !== line.unit || !remainder || remainder.quantity.lt(qty)) throw new ConflictException('Vượt lượng chờ đối soát hoặc sai lô/đơn vị');
        lines.push({ lotId: line.lotId, quantity: qty.toFixed(3), unit: line.unit });
      }
      lines.sort((a,b) => a.lotId.localeCompare(b.lotId));
      const digest = canonicalSha256({ transferId: id, lines, reason: input.reason });
      const record = await tx.distributionReturn.create({ data: { transferId: id, lines, reason: input.reason, digest } });
      await this.events(tx, t, actor, 'DISTRIBUTION_RETURN_PROPOSED', { returnId: record.id, digest });
      return { record };
    });
  }
  signReturn(actor: CommandActor, transferId: string, returnId: string, input: ReturnSignatureInput,c2?:DistributionC2Submit) {
    return commandTransaction(this.db, async tx => {
      const r = await tx.distributionReturn.findUniqueOrThrow({ where: { id: returnId } });
      if (r.transferId !== transferId) throw new NotFoundException('Chặng trả không thuộc giao nhận');
      await tx.$queryRaw`SELECT id FROM distribution_transfer WHERE id=${r.transferId}::uuid FOR UPDATE`;
      const current = await tx.distributionReturn.findUniqueOrThrow({ where: { id: returnId } });
      const t = await tx.distributionTransfer.findUniqueOrThrow({ where: { id: r.transferId }, include: { lines: true } });
      if (![t.senderId,t.carrierId].includes(actor.organizationId!) || current.status !== 'PROPOSED' || current.version !== input.version) throw new ConflictException('Chặng trả đã thay đổi hoặc bạn không là bên bàn giao trả');
      const auth = await enterpriseAuthority(tx, actor, 'distribution.sign', t.chainId, (actor.organizationId === t.senderId ? t.senderSiteId : t.carrierSiteId) ?? undefined, true);
      if((t.handoverMode==='DUAL_SIGNED')!==!!c2)throw new ConflictException('Chặng trả phải giữ giao thức chữ ký của chặng gốc');
      const consumed=c2?await consumeC2(tx,t,actor,auth.scope,c2,distributionSnapshot(t),r):undefined;
      if(consumed?.length)input={...input,keyRef:consumed[0].intent.keyRef,expiresAt:consumed[0].intent.expiresAt.toISOString(),signature:consumed[0].intent.signature!};
      const key = consumed?.[0].intent.key ?? await tx.distributionKey.findFirst({ where: { id: input.keyRef, organizationId: actor.organizationId!, status: 'ACTIVE' } });
      const body = { returnId, transferId: t.id, digest: r.digest, organizationId: actor.organizationId, userId: actor.sub, keyRef: input.keyRef, version: String(input.version), expiresAt: input.expiresAt };
      const expiry = Date.parse(input.expiresAt);
      if (!key || expiry <= Date.now() || expiry > Date.now()+20*60_000 || (!c2 && !verifyEd25519(key.publicKey, domainMessage('agritrace:distribution-return:1',body),input.signature))) throw new ConflictException('Chữ ký trả hàng không hợp lệ hoặc đã hết hạn');
      const previous = await tx.distributionReturnSignature.findMany({ where: { returnId } });
      for (const signature of previous) {
        const user = await tx.user.findUniqueOrThrow({ where: { id: signature.userId }, include: { role: true } });
        const authority = await enterpriseAuthority(tx, { sub: user.id, organizationId: user.organizationId, role: user.role.code }, 'distribution.sign', t.chainId, (user.organizationId === t.senderId ? t.senderSiteId : t.carrierSiteId) ?? undefined);
        const oldKey = t.handoverMode==='DUAL_SIGNED'?await tx.signingKey.findUnique({where:{keyRef:signature.keyRef}}):await tx.distributionKey.findUnique({ where: { id: signature.keyRef } });
        if (authority.scope !== (signature.authority as Prisma.JsonObject).scope || oldKey?.status !== 'ACTIVE') throw new ForbiddenException('Quyền hoặc khóa bên ký trả trước đã bị thay đổi');
      }
      await tx.distributionReturnSignature.create({ data: { returnId, organizationId: actor.organizationId!, userId: actor.sub!, keyRef: input.keyRef, signature: input.signature, authority: { scope: auth.scope, body } } });
      if (previous.length === 1) {
        for (const line of r.lines as { lotId: string; quantity: string; unit: string }[]) {
          const lot = await this.assertLot(tx, line.lotId, t.chainId, true);
          const remainder = await tx.distributionRemainder.findUniqueOrThrow({ where: { transferId_lotId: { transferId: t.id, lotId: line.lotId } } });
          const qty = quantity(line.quantity);
          if (remainder.quantity.lt(qty)) throw new ConflictException('Lượng chờ trả đã thay đổi');
          await tx.distributionRemainder.update({ where: { transferId_lotId: { transferId: t.id, lotId: line.lotId } }, data: { quantity: { decrement: qty }, version: { increment: 1 } } });
          await tx.lotHolding.upsert({ where: { lotId_organizationId: { lotId: lot.id, organizationId: t.senderId } }, create: { lotId: lot.id, organizationId: t.senderId, quantity: qty }, update: { quantity: { increment: qty }, version: { increment: 1 } } });
          if (t.senderSiteId) {
            const blocked = isPastExpiry(lot.expiryDate) || lot.currentState === 'RECALLED' || !!await tx.traceNotice.findFirst({ where: { lotId: lot.id, kind: 'RECALL' } });
            await addSiteStock(tx, lot.id, t.senderId, t.senderSiteId, qty, blocked ? qty : new Prisma.Decimal(0));
          }
        }
        await tx.distributionReturn.update({ where: { id: returnId }, data: { status: 'RETURNED', version: { increment: 1 } } });
      }
      if(consumed)for(const row of consumed)await this.trace.createInTransaction(tx,{entityType:'LOT',entityId:row.lotId,lotId:row.lotId,eventId:row.intent.eventId,eventType:row.intent.eventType,actor,businessData:row.payload,signature:{intentId:row.intent.id}});
      else await this.events(tx, t, actor, 'DISTRIBUTION_RETURN_SIGNED', { returnId, digest: r.digest, organizationId: actor.organizationId! });
      return { record: await tx.distributionReturn.findUniqueOrThrow({ where: { id: returnId } }) };
    });
  }
  /** Work waiting on this organization, filtered by the same scope as detail/report.
   * Counts are hints for navigation; each action is re-authorized on submit. */
  async tasks(actor: CommandActor) {
    const transfers: Record<string, unknown>[] = [];
    const stock: Record<string, unknown>[] = [];
    const auth = await enterpriseAuthority(this.db, actor, 'profile.read');
    const may = (permission: string) => auth.primary || auth.user.enterpriseRoles.some(r => r.role.permissions.includes(permission));
    if (may('distribution.read')) {
      const readable = await enterpriseAuthority(this.db, actor, 'distribution.read');
      const rows = await this.db.distributionTransfer.findMany({
        where: { ...enterpriseTransferWhere(actor, readable), status: { in: ['PROPOSED', 'READY', 'IN_TRANSIT', 'DELIVERED'] } },
        include: { attestations: true },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      const org = actor.organizationId!;
      for (const t of rows) {
        const site = t.senderId === org ? t.senderSiteId : t.carrierId === org ? t.carrierSiteId : t.receiverSiteId;
        const has = (permission: string) => readable.primary || readable.user.enterpriseRoles.some(r => r.role.permissions.includes(permission) && r.chainIds.includes(t.chainId) && !!site && r.siteIds.includes(site));
        const signed = new Set(t.attestations.filter(a => a.organizationId === org && a.epoch === t.attestationEpoch).map(a => a.phase));
        const actions = [
          ...(has('distribution.sign') ? ['CONSENT', 'PICKUP', 'DELIVERY'].filter(p => this.phaseAllowed(t, p, org) && !signed.has(p)) : []),
          ...(has('distribution.sign') && t.receiverId === org && t.status === 'IN_TRANSIT' && t.receiverSiteId && !t.receiptDigest ? ['ACTUAL_RECEIPT'] : []),
        ];
        if (t.status === 'DELIVERED' && [t.senderId, t.carrierId].includes(org)) {
          const open = await this.db.distributionReturn.findMany({ where: { transferId: t.id, status: 'PROPOSED' } });
          for (const r of open)
            if (has('distribution.sign') && !(await this.db.distributionReturnSignature.findUnique({ where: { returnId_organizationId: { returnId: r.id, organizationId: org } } })))
              actions.push('SIGN_RETURN');
          if (t.carrierId === org && has('distribution.write') && !open.length && (await this.db.distributionRemainder.count({ where: { transferId: t.id, quantity: { gt: 0 } } })))
            actions.push('RECONCILE_REMAINDER');
        }
        for (const action of actions)
          transfers.push({ transferId: t.id, action, status: t.status, origin: t.origin, destination: t.destination, role: t.senderId === org ? 'SENDER' : t.carrierId === org ? 'CARRIER' : 'RECEIVER', createdAt: t.createdAt });
      }
    }
    if (may('reports.read')) {
      const soon = new Date(Date.now() + 7 * 24 * 3600_000).toISOString().slice(0, 10);
      const { lots } = await this.report(actor, 'reports.read', {});
      for (const l of lots) {
        if (Number(l.held) <= 0) continue;
        const recalled = l.notices.some(n => n.kind === 'RECALL');
        const expiry = l.expiryDate ? l.expiryDate.toISOString().slice(0, 10) : null;
        const kind = recalled ? 'RECALL' : isPastExpiry(l.expiryDate) ? 'EXPIRED' : expiry && expiry <= soon ? 'EXPIRING' : Number(l.quarantined) > 0 ? 'QUARANTINED' : null;
        if (kind) stock.push({ lotId: l.lotId, lotCode: l.lotCode, productName: l.productName, kind, held: l.held, quarantined: l.quarantined, unit: l.unit, expiryDate: l.expiryDate });
      }
    }
    const ownership = await this.db.enterpriseOwnershipTransfer.count({ where: { organizationId: actor.organizationId!, toUserId: actor.sub!, status: 'PENDING', expiresAt: { gt: new Date() } } });
    return { transfers, stock, counts: { transfers: transfers.length, stock: stock.length, ownership, total: transfers.length + stock.length + ownership } };
  }
  async report(
    actor: CommandActor,
    permission: 'reports.read' | 'qr.manage' = 'reports.read',
    query:DistributionReportQuery = {},
  ) {
    const auth = await enterpriseAuthority(this.db, actor, permission);
    const chains = auth.primary
      ? undefined
      : [
          ...new Set(
            auth.user.enterpriseRoles
              .filter((r) => r.role.permissions.includes(permission))
              .flatMap((r) => r.chainIds),
          ),
        ];
    const holdings = await this.db.lotHolding.findMany({
      where: { organizationId: actor.organizationId! },
    });
    if(query.siteId) {
      await enterpriseAuthority(this.db,actor,permission,undefined,query.siteId);
      if(!await this.db.enterpriseSite.findFirst({where:{id:query.siteId,organizationId:actor.organizationId!}}))throw new NotFoundException('Cơ sở ngoài tổ chức');
    }
    const scopedRoles=auth.user.enterpriseRoles.filter(r=>r.role.permissions.includes(permission));
    const siteIds = query.siteId ? [query.siteId] : auth.primary ? undefined : [...new Set(scopedRoles.flatMap(r => r.siteIds))];
    const siteStocks = await this.db.lotSiteHolding.findMany({ where: { organizationId: actor.organizationId!, ...(siteIds ? { siteId: { in: siteIds } } : {}) } });
    const sites = await this.db.enterpriseSite.findMany({ where: { organizationId: actor.organizationId!, ...(siteIds ? { id: { in: siteIds } } : {}) }, select: { id: true, name: true } });
    const moving = await this.db.siteTransfer.findMany({ where: { organizationId: actor.organizationId!, status: { in: ['IN_TRANSIT', 'DISCREPANCY'] } }, select: { lotId: true, status: true, quantity: true, receivedQuantity: true } });
    const movingFor = (lotId: string) => moving.filter(m => m.lotId === lotId).reduce((sum, m) => sum.add(m.status === 'IN_TRANSIT' ? m.quantity : m.quantity.sub(m.receivedQuantity ?? 0)), new Prisma.Decimal(0));
    const sourceLots = await this.db.lot.findMany({
      where: {
        ...(chains ? { harvest: { cycle: { chainId: { in: chains } } } } : {}),
        ...(query.q?{AND:[{OR:[{lotCode:{contains:query.q,mode:'insensitive'}},{product:{productName:{contains:query.q,mode:'insensitive'}}}]}]}:{}),
        ...(query.expiryBefore?{expiryDate:{lte:new Date(query.expiryBefore+'T00:00:00Z')}}:{}),
        OR: auth.primary ? [
          { id: { in: (query.siteId ? siteStocks : holdings).map((h) => h.lotId) } },
          ...(!query.siteId?[{ farmOrgId: actor.organizationId!, shipment: null }]:[]),
          ...(query.siteId?[{id:{in:siteStocks.map(s=>s.lotId)}}]:[]),
        ] : scopedRoles.map(r=>({harvest:{cycle:{chainId:{in:r.chainIds}}},OR:[{id:{in:siteStocks.filter(s=>r.siteIds.includes(s.siteId)).map(s=>s.lotId)}},{farmOrgId:actor.organizationId!,shipment:null,harvest:{cycle:{farmId:{in:query.siteId?[]:r.siteIds}}}}]})),
      },
      include: {
        product: true,
        harvest: {
          include: {
            cycle: { include: { chain: { select: { name: true } } } },
          },
        },
        traceQr: true,
      },
      orderBy:{id:'asc'},
      ...(query.page?{skip:(query.page-1)*(query.pageSize??25),take:(query.pageSize??25)+1}:{}),
    });
    const hasNext=!!query.page&&sourceLots.length>(query.pageSize??25);
    if(hasNext)sourceLots.pop();
    const transfers = await this.db.distributionTransfer.findMany({
      where: {
        ...enterpriseTransferWhere(actor, auth, permission),
        ...(chains ? { chainId: { in: chains } } : {}),
        ...(query.page||query.q||query.siteId||query.expiryBefore?{lines:{some:{lotId:{in:sourceLots.map(l=>l.id)}}}}:{}),
      },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });
    const notices = await this.db.traceNotice.findMany({
      where: { lotId: { in: sourceLots.map((l) => l.id) } },
      select: { lotId: true, kind: true, message: true },
    });
    return {
      page:query.page??1,pageSize:query.pageSize??sourceLots.length,hasNext,
      lots: sourceLots.map((l) => {
        const allocations = siteStocks.filter(s => s.lotId === l.id && (auth.primary || scopedRoles.some(r=>r.chainIds.includes(l.harvest.cycle.chainId)&&r.siteIds.includes(s.siteId))));
        const total = (field: 'quantity' | 'reserved' | 'quarantined') => allocations.reduce((sum,s) => sum.add(s[field]),new Prisma.Decimal(0));
        const aggregate = holdings.find((x) => x.lotId === l.id);
        const h = auth.primary && !query.siteId ? aggregate : { quantity: total('quantity'), reserved: total('reserved') };
        const blocked =
          isPastExpiry(l.expiryDate) ||
          ['RECALLED', 'EXPIRED', 'DAMAGED', 'REJECTED', 'SOLD'].includes(
            l.currentState,
          ) ||
          notices.some((n) => n.lotId === l.id && n.kind === 'RECALL');
        const unreserved = h ? h.quantity.sub(h.reserved).sub(total('quarantined')) : auth.primary ? l.availableQuantity : new Prisma.Decimal(0);
        return {
          lotId: l.id,
          version: l.version,
          chainName: l.harvest.cycle.chain.name,
          lotCode: l.lotCode,
          productName: l.product.productName,
          chainId: l.harvest.cycle.chainId,
          farmOrgId: l.farmOrgId,
          initialQuantity: l.initialQuantity.toFixed(3),
          globalAvailable: auth.primary ? l.availableQuantity.toFixed(3) : null,
          unallocated: auth.primary && !query.siteId ? (aggregate?.quantity ?? l.availableQuantity).sub(total('quantity')).sub(movingFor(l.id)).toFixed(3) : null,
          internalInTransit: auth.primary && !query.siteId ? movingFor(l.id).toFixed(3) : null,
          quarantined: total('quarantined').toFixed(3),
          siteHoldings: allocations.map(s => ({ ...s, siteName: sites.find(site => site.id === s.siteId)?.name, available: blocked ? '0.000' : s.quantity.sub(s.reserved).sub(s.quarantined).toFixed(3) })),
          held: (
            h?.quantity ??
            (l.farmOrgId === actor.organizationId
              ? l.availableQuantity
              : new Prisma.Decimal(0))
          ).toFixed(3),
          reserved: (h?.reserved ?? new Prisma.Decimal(0)).toFixed(3),
          available: blocked ? '0.000' : unreserved.toFixed(3),
          unreserved: unreserved.toFixed(3),
          blocked,
          notices: notices
            .filter((n) => n.lotId === l.id)
            .map((n) => ({ kind: n.kind, message: n.message })),
          unit: l.unit,
          state: l.currentState,
          expiryDate: l.expiryDate,
          traceToken: l.traceQr?.traceToken ?? null,
        };
      }),
      transfers: await this.decorate(transfers),
    };
  }
}
