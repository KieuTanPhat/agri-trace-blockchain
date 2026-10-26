import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  publicContact,
  publication,
  visibleDirectoryImage,
} from '../public-directory/public-directory.presentation.js';
import {
  PUBLIC_ENTERPRISE_SELECT,
  publicLotWhere,
} from '../public-directory/public-directory.policy.js';
import {
  publicLotInclude,
  PUBLIC_TRACE_INCLUDE,
  type PublicLot,
  type PublicTraceEvent,
} from './lot-query.types.js';
import { eventSummary } from './lot.presenter.js';
import { vietnamCalendarDate } from '../../common/expiry-date.js';
import type {
  PublicJourneyGroupDto,
  JourneyFactDto,
} from './public-journey.dto.js';
type Line = Prisma.DistributionLineGetPayload<{ include: { transfer: true } }>;
type Media = {
  evidenceId: string;
  lotId: string;
  groupKey: string;
  caption: string;
  organizationId: string;
};
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, 1000) : '');
const fact = (label: string, v: unknown): JourneyFactDto[] =>
  v != null && String(v).trim() ? [{ label, value: String(v) }] : [];
export function publishedJourneyMedia(
  value: unknown,
  lotId: string,
  organizationId: string,
): Media[] {
  const p = publication(value);
  if (p.published !== true || !Array.isArray(p.traceMedia)) return [];
  return p.traceMedia
    .map(object)
    .filter(
      (m) =>
        m.lotId === lotId &&
        typeof m.evidenceId === 'string' &&
        /^[0-9a-f-]{36}$/i.test(m.evidenceId) &&
        typeof m.groupKey === 'string',
    )
    .map((m) => ({
      lotId,
      evidenceId: text(m.evidenceId),
      groupKey: text(m.groupKey),
      caption: text(m.caption),
      organizationId,
    }));
}
@Injectable()
export class PublicJourneyService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  private async context(
    lot: PublicLot,
    events: PublicTraceEvent[],
    lines: Line[],
  ) {
    const shipment = await this.db.shipment.findUnique({
      where: { lotId: lot.id },
      select: {
        transporterOrgId: true,
        retailerOrgId: true,
        status: true,
        pickupTime: true,
        receivedTime: true,
        createdAt: true,
      },
    });
    const ids = [
      ...new Set(
        [
          lot.farmOrgId,
          ...events.map((e) => e.actorOrganizationId),
          ...lines.flatMap((l) => [
            l.transfer.senderId,
            l.transfer.carrierId,
            l.transfer.receiverId,
          ]),
          shipment?.transporterOrgId,
          shipment?.retailerOrgId,
        ].filter((v): v is string => !!v),
      ),
    ];
    const [orgs, sites, care] = await Promise.all([
      this.db.organization.findMany({
        where: { id: { in: ids }, status: 'ACTIVE' },
        select: PUBLIC_ENTERPRISE_SELECT,
      }),
      this.db.enterpriseSite.findMany({
        where: { organizationId: { in: ids } },
        select: { id: true, organizationId: true, farmId: true },
      }),
      lot.harvest
        ? this.db.careRecord.findMany({
            where: {
              cycleId: lot.harvest.cycleId,
              eventTime: { lte: lot.harvest.harvestTime },
            },
            select: {
              id: true,
              name: true,
              careType: true,
              eventTime: true,
              method: true,
              materialName: true,
              quantity: true,
              unit: true,
              cropCondition: true,
              evidenceIds: true,
            },
          })
        : Promise.resolve([]),
    ]);
    const media = orgs.flatMap((o) =>
      publishedJourneyMedia(
        o.directoryPublications[0]?.presentation,
        lot.id,
        o.id,
      ),
    );
    const harvest = lot.harvest,
      privateFarm = !!harvest && harvest.cycle.farm.privacy !== 'PUBLIC';
    const rows = media.length
      ? await this.db.traceEvidence.findMany({
          where: {
            id: { in: media.map((m) => m.evidenceId) },
            withdrawal: null,
            mediaType: { in: ['image/jpeg', 'image/png'] },
          },
          select: {
            id: true,
            organizationId: true,
            entityType: true,
            entityId: true,
            kind: true,
            createdAt: true,
          },
        })
      : [];
    const superseded = rows.length
      ? await this.db.traceEvidence.findMany({
          where: { supersedesId: { in: rows.map((r) => r.id) } },
          select: { supersedesId: true },
        })
      : [];
    const today = new Date(`${vietnamCalendarDate(new Date())}T00:00:00.000Z`);
    const certs = await this.db.certificate.findMany({
      where: {
        isPublic: true,
        status: 'APPROVED',
        replacements: { none: { status: 'APPROVED' } },
        issueDate: { lte: today },
        AND: [
          { OR: [{ expiryDate: null }, { expiryDate: { gte: today } }] },
          {
            OR: [
              { lotId: lot.id },
              ...(harvest ? [{ cycleId: harvest.cycleId }] : []),
            ],
          },
        ],
      },
      select: {
        id: true,
        lotId: true,
        cycleId: true,
        type: true,
        issuer: true,
        issueDate: true,
        expiryDate: true,
        documentRef: true,
      },
    });
    const valid = media.filter((m) => {
      const e = rows.find(
        (r) => r.id === m.evidenceId && r.organizationId === m.organizationId,
      );
      if (!e || superseded.some((s) => s.supersedesId === e.id)) return false;
      if (e.entityType === 'LOT')
        return e.entityId === lot.id && e.kind === 'LOT_IMAGE';
      if (e.entityType === 'CYCLE')
        return (
          !privateFarm &&
          e.entityId === harvest?.cycleId &&
          (['CYCLE_IMAGE', 'CARE_IMAGE', 'HARVEST_IMAGE'].includes(e.kind) ||
            (e.kind === 'CERTIFICATE_IMAGE' &&
              certs.some(
                (c) =>
                  c.documentRef ===
                  `/enterprise-workspace/evidence/${e.id}/file`,
              )))
        );
      if (e.entityType === 'CARE')
        return (
          !privateFarm &&
          care.some((c) => c.id === e.entityId) &&
          e.kind === 'CARE_IMAGE'
        );
      if (e.entityType === 'HARVEST')
        return (
          !privateFarm &&
          e.entityId === harvest?.id &&
          e.kind === 'HARVEST_IMAGE'
        );
      if (e.entityType === 'SITE')
        return (
          sites.some(
            (s) => s.id === e.entityId && s.organizationId === e.organizationId,
          ) &&
          (m.groupKey === `site:${e.entityId}` ||
            m.groupKey === `org:${e.organizationId}`) &&
          e.kind === 'SITE_IMAGE' &&
          !(
            privateFarm &&
            sites.find((s) => s.id === e.entityId)?.farmId ===
              harvest?.cycle.farmId
          )
        );
      if (e.entityType === 'TRANSFER')
        return (
          lines.some(
            (l) =>
              l.transferId === e.entityId &&
              [
                l.transfer.senderId,
                l.transfer.carrierId,
                l.transfer.receiverId,
              ].includes(e.organizationId),
          ) && e.kind === 'TRANSFER_IMAGE'
        );
      if (e.entityType === 'CERTIFICATE')
        return (
          certs.some((c) => c.id === e.entityId) &&
          e.kind === 'CERTIFICATE_IMAGE'
        );
      return false;
    });
    return { orgs, sites, care, media: valid, shipment, certs, privateFarm };
  }
  async build(
    lot: PublicLot,
    events: PublicTraceEvent[],
    lines: Line[],
    token: string,
    depth = 0,
    visited = new Set<string>(),
  ): Promise<PublicJourneyGroupDto[]> {
    if (visited.has(lot.id) || visited.size >= 20) return [];
    visited.add(lot.id);
    const c = await this.context(lot, events, lines),
      groups: PublicJourneyGroupDto[] = [];
    const company = (id: string) => {
      const org = c.orgs.find((o) => o.id === id);
      if (!org) return null;
      const {
        published: _,
        logoEvidenceId,
        ...contact
      } = publicContact(org.directoryPublications[0]?.presentation);
      return {
        id: org.id,
        name: org.name,
        type: org.type,
        ...contact,
        logoUrl: logoEvidenceId ? `/public/enterprises/${org.id}/logo?v=${logoEvidenceId}` : null,
      };
    };
    const group = (
      orgId: string,
      siteId: string | null | undefined,
      stage: string,
      privateGroup = false,
    ) => {
      const key = privateGroup
        ? `private-farm:${lot.id}`
        : siteId
          ? siteId.startsWith('farm:')
            ? siteId
            : `site:${siteId}`
          : `org:${orgId}`;
      const existing = groups.find((g) => g.id === key);
      if (existing) return existing;
      const org = c.orgs.find((o) => o.id === orgId),
        p = publication(org?.directoryPublications[0]?.presentation);
      const site =
        p.published === true && Array.isArray(p.traceSites)
          ? p.traceSites.map(object).find((s) => s.id === siteId)
          : null;
      const co = privateGroup ? null : company(orgId);
      const g: PublicJourneyGroupDto = {
        id: key,
        stage,
        title: privateGroup
          ? 'Vùng sản xuất riêng tư'
          : text(site?.name) || co?.name || 'Địa điểm xử lý lô hàng',
        address: privateGroup
          ? null
          : text(site?.address) || co?.address || null,
        company: co,
        entries: [],
        photos: [],
        facts: [],
        certificates: [],
      };
      groups.push(g);
      return g;
    };
    const harvest = lot.harvest,
      farmSite = c.sites.find((s) => s.farmId === harvest?.cycle.farmId);
    const farm = harvest
      ? group(
          lot.farmOrgId,
          farmSite?.id ?? `farm:${harvest.cycle.farmId}`,
          'Trồng và thu hoạch',
          c.privateFarm,
        )
      : null;
    if (farm && !c.privateFarm) {
      if (!farmSite) {
        const snapshot = publication(
          c.orgs.find((o) => o.id === lot.farmOrgId)?.directoryPublications[0]
            ?.presentation,
        );
        const place = Array.isArray(snapshot.traceFarms)
          ? snapshot.traceFarms
              .map(object)
              .find((f) => f.id === harvest!.cycle.farmId)
          : null;
        farm.title = harvest!.cycle.farm.name;
        farm.address =
          snapshot.published === true ? text(place?.address) || null : null;
      }
      const enabled =
        publication(
          c.orgs.find((o) => o.id === lot.farmOrgId)?.directoryPublications[0]
            ?.presentation,
        ).traceDetailsPublished === true;
      farm.facts = [
        ...fact('Mùa vụ', harvest!.cycle.name ?? harvest!.cycle.cycleCode),
        ...(enabled
          ? [
              ...fact('Cách trồng', harvest!.cycle.cultivationMethod),
              ...fact('Cách thu hoạch', harvest!.harvestMethod),
              ...fact('Phân loại', harvest!.grade),
            ]
          : []),
        ...fact('Sản lượng thu hoạch', `${harvest!.quantity} ${harvest!.unit}`),
      ];
    }
    const owner =
      c.privateFarm && lot.initialStorageSiteId === farmSite?.id
        ? farm!
        : lot.processingRun
          ? group(
              lot.farmOrgId,
              lot.processingRun.siteId,
              'Chế biến và đóng gói',
            )
          : lot.initialStorageSiteId
            ? group(
                lot.farmOrgId,
                lot.initialStorageSiteId,
                'Sơ chế và bảo quản',
              )
            : (farm ?? group(lot.farmOrgId, null, 'Sản xuất'));
    if (lot.processingRun)
      owner.facts.push(
        ...fact('Lô chế biến', lot.processingRun.code),
        ...fact('Thành phẩm', `${lot.initialQuantity} ${lot.unit}`),
      );
    const transferGroup = (l: Line, orgId: string) => {
      const t = l.transfer;
      return group(
        orgId,
        orgId === t.senderId
          ? t.senderSiteId
          : orgId === t.receiverId
            ? t.receiverSiteId
            : t.carrierSiteId,
        orgId === t.carrierId
          ? 'Vận chuyển'
          : orgId === t.receiverId
            ? c.orgs.find((o) => o.id === orgId)?.type === 'RETAILER'
              ? 'Cửa hàng bán lẻ'
              : 'Tiếp nhận và phân phối'
            : 'Xuất hàng',
      );
    };
    for (const l of lines) {
      transferGroup(l, l.transfer.senderId);
      if (['IN_TRANSIT', 'DELIVERED'].includes(l.transfer.status))
        transferGroup(l, l.transfer.carrierId);
      if (l.transfer.status === 'DELIVERED')
        transferGroup(l, l.transfer.receiverId);
    }
    for (const e of events) {
      if (
        ['EVIDENCE_ATTACHED', 'SENSOR_READING_RECORDED'].includes(e.eventType)
      )
        continue;
      const data = object(e.businessData),
        line = lines.find(
          (l) =>
            l.transferId === e.entityId ||
            l.transferId === data.transferId ||
            l.transferId === data.transferRef,
        );
      if (e.eventType === 'DISTRIBUTION_SITE_ALLOCATED' && !data.toSiteId)
        continue;
      let target = owner;
      if (farm && (e.lotId === null || e.eventType === 'HARVEST_RECORDED'))
        target = farm;
      else if (line) {
        const t = line.transfer;
        const org =
          e.eventType === 'DISTRIBUTION_DELIVERED'
            ? t.receiverId
            : e.eventType === 'DISTRIBUTION_IN_TRANSIT'
              ? t.carrierId
              : (e.actorOrganizationId ?? t.senderId);
        target = transferGroup(line, org);
      } else if (
        typeof data.siteId === 'string' ||
        typeof data.toSiteId === 'string'
      ) {
        const place =
          typeof data.siteId === 'string'
            ? data.siteId
            : data.stage === 'TRANSFER_DISPATCHED'
              ? data.fromSiteId
              : data.toSiteId;
        const orgId = e.actorOrganizationId ?? lot.farmOrgId;
        target =
          c.privateFarm && place === farmSite?.id
            ? farm!
            : group(
                orgId,
                typeof place === 'string' ? place : null,
                'Bảo quản và xử lý hàng',
              );
      } else if (
        e.actorOrganizationId &&
        e.actorOrganizationId !== lot.farmOrgId
      )
        target = group(
          e.actorOrganizationId,
          typeof data.siteId === 'string' ? data.siteId : null,
          e.actorOrganizationId === c.shipment?.transporterOrgId
            ? 'Vận chuyển'
            : e.actorOrganizationId === c.shipment?.retailerOrgId
              ? 'Cửa hàng bán lẻ'
              : 'Kiểm tra và hồ sơ',
        );
      const record = c.care.find(
          (r) => r.id === e.entityId || r.id === data.careId,
        ),
        p = publication(
          c.orgs.find((o) => o.id === e.actorOrganizationId)
            ?.directoryPublications[0]?.presentation,
        );
      const details =
        record && p.traceDetailsPublished === true && !c.privateFarm
          ? [
              ...fact('Công việc', record.name),
              ...fact('Cách thực hiện', record.method),
              ...fact('Vật tư', record.materialName),
              ...(record.quantity
                ? fact(
                    'Lượng sử dụng',
                    `${record.quantity} ${record.unit ?? ''}`,
                  )
                : []),
              ...fact('Tình trạng cây', record.cropCondition),
            ]
          : [];
      target.entries.push({
        id: e.id,
        title:
          e.eventType === 'DISTRIBUTION_SITE_ALLOCATED'
            ? data.stage === 'TRANSFER_RECEIVED'
              ? 'Đã nhận hàng tại địa điểm mới.'
              : 'Chuyển hàng giữa các cơ sở.'
            : record && details.length
              ? (record.name ?? 'Chăm sóc cây trồng')
              : eventSummary(e.eventType),
        time: e.eventTime.toISOString(),
        facts: details,
      });
    }
    if (c.shipment) {
      const s = c.shipment;
      if (s.pickupTime) group(s.transporterOrgId, null, 'Vận chuyển');
      if (s.receivedTime) group(s.retailerOrgId, null, 'Cửa hàng bán lẻ');
    }
    for (const g of groups) {
      g.photos = c.media
        .filter((m) => m.groupKey === g.id)
        .map((m) => ({
          id: m.evidenceId,
          url: `/public/trace/${token}/media/${m.evidenceId}`,
          caption: m.caption || 'Hình ảnh tại địa điểm',
        }));
      g.certificates = c.certs
        .filter((cert) => (cert.cycleId ? g === farm : g === owner))
        .map((cert) => ({
          type: cert.type,
          issuer: cert.issuer,
          issueDate: cert.issueDate.toISOString(),
          expiryDate: cert.expiryDate?.toISOString() ?? null,
        }));
      g.entries.sort((a, b) => a.time.localeCompare(b.time));
    }
    const visible = groups.filter(
      (g) =>
        g.entries.length ||
        g.photos.length ||
        g.facts.length ||
        g.stage === 'Cửa hàng bán lẻ',
    );
    if (lot.processingRun && depth < 3) {
      const sources = await this.db.lot.findMany({
        where: publicLotWhere({
          id: { in: lot.processingRun.inputs.map((i) => i.lotId) },
        }),
        include: { ...publicLotInclude(), traceQr: true },
        take: 20,
      });
      const sourceGroups: PublicJourneyGroupDto[] = [];
      for (const source of sources) {
        const sourceEvents = await this.db.traceEvent.findMany({
          where: {
            OR: [
              { lotId: source.id },
              ...(source.harvest
                ? [{ cycleId: source.harvest.cycleId, lotId: null }]
                : []),
            ],
          },
          include: PUBLIC_TRACE_INCLUDE,
          orderBy: [{ eventTime: 'asc' }, { createdAt: 'asc' }],
        });
        const sourceLines = await this.db.distributionLine.findMany({
          where: {
            lotId: source.id,
            transfer: { status: { not: 'CANCELLED' } },
          },
          include: { transfer: true },
        });
        sourceGroups.push(
          ...(await this.build(
            source,
            sourceEvents,
            sourceLines,
            source.traceQr!.traceToken,
            depth + 1,
            visited,
          )),
        );
      }
      const merged: PublicJourneyGroupDto[] = [];
      for (const g of [...sourceGroups, ...visible]) {
        const found = merged.find((m) => m.id === g.id);
        if (!found) {
          merged.push(g);
          continue;
        }
        found.entries = [
          ...new Map(
            [...found.entries, ...g.entries].map((e) => [e.id, e]),
          ).values(),
        ].sort((a, b) => a.time.localeCompare(b.time));
        found.photos = [
          ...new Map(
            [...found.photos, ...g.photos].map((p) => [p.id, p]),
          ).values(),
        ];
        found.certificates = [
          ...new Map(
            [...found.certificates, ...g.certificates].map((c) => [
              JSON.stringify(c),
              c,
            ]),
          ).values(),
        ];
        found.facts = [
          ...new Map(
            [...found.facts, ...g.facts].map((f) => [JSON.stringify(f), f]),
          ).values(),
        ];
      }
      return merged;
    }
    return visible;
  }
  private async thumbnailEvidence(lotId:string) {
    const rows=await this.db.traceEvidence.findMany({where:{entityType:'LOT',entityId:lotId},select:{id:true,public:true,kind:true,mediaType:true,supersedesId:true,withdrawal:{select:{evidenceId:true}}},orderBy:{createdAt:'desc'}});
    return visibleDirectoryImage(rows);
  }
  async thumbnailUrl(token:string,lotId:string){
    const image=await this.thumbnailEvidence(lotId);
    return `/public/trace/${token}/thumbnail${image?`?v=${image.id}`:''}`;
  }
  async image(token: string, id?: string) {
    const qr = await this.db.traceQr.findUnique({
      where: { traceToken: token },
      include: { lot: { include: publicLotInclude() } },
    });
    if (!qr) throw new NotFoundException();
    if (!id) {
      const visible = await this.thumbnailEvidence(qr.lotId);
      if (!visible || visible.withdrawal) throw new NotFoundException();
      id = visible.id;
    } else {
      const lines = await this.db.distributionLine.findMany({
        where: { lotId: qr.lotId, transfer: { status: { not: 'CANCELLED' } } },
        include: { transfer: true },
      });
      const c = await this.context(qr.lot, [], lines);
      if (!c.media.some((m) => m.evidenceId === id))
        throw new NotFoundException();
    }
    return this.db.traceEvidence.findUniqueOrThrow({
      where: { id },
      select: { content: true, mediaType: true },
    });
  }
}
