/** Explicit publication snapshot of the 227-product dataset: enterprise contact,
 * logo, trace sites and the per-lot photos each enterprise agrees to show. */
import { seedContentId } from "./seed-recovery.mjs";

const CAPTIONS = {
  CYCLE_IMAGE: "Khu vực canh tác và cây trồng",
  CARE_IMAGE: "Công việc chăm sóc cây trồng",
  HARVEST_IMAGE: "Hoạt động thu hoạch tại vườn",
};

export async function publishDatasetPresentation(db) {
  const profiles = await db.enterpriseProfile.findMany({ where: { organization: { status: "ACTIVE" } } });
  const lots = await db.lot.findMany({ include: { product: { select: { productName: true } }, harvest: { include: { cycle: { include: { farm: true } } } }, processingRun: true } });
  const sites = await db.enterpriseSite.findMany({ where: { status: "ACTIVE" } });
  const evidence = await db.traceEvidence.findMany({
    where: { withdrawal: null },
    select: { id: true, organizationId: true, entityType: true, entityId: true, kind: true, fileName: true, public: true, supersedesId: true },
  });
  const superseded = new Set(evidence.map((e) => e.supersedesId));
  const live = evidence.filter((e) => !superseded.has(e.id));
  const lines = await db.distributionLine.findMany({ where: { transfer: { status: { not: "CANCELLED" } } }, include: { transfer: true } });
  let count = 0;
  for (const profile of profiles) {
    const org = profile.organizationId;
    const logo = live.find((e) => e.organizationId === org && e.entityType === "PROFILE" && e.kind === "OTHER" && e.fileName?.startsWith("logo-"));
    if (!logo) continue;
    const traceMedia = [];
    const add = (lot, e, groupKey, caption) => {
      if (e && !traceMedia.some((m) => m.lotId === lot.id && m.groupKey === groupKey && m.evidenceId === e.id))
        traceMedia.push({ lotId: lot.id, evidenceId: e.id, groupKey, caption });
    };
    for (const lot of lots) {
      const owned = lot.farmOrgId === org;
      const cycle = lot.harvest?.cycle;
      const siteIds = new Set(lines.filter((l) => l.lotId === lot.id).flatMap((l) => {
        const t = l.transfer;
        return [t.senderId === org && t.senderSiteId, t.carrierId === org && t.carrierSiteId, t.receiverId === org && t.receiverSiteId].filter(Boolean);
      }));
      if (owned) {
        const ownerSite = lot.processingRun?.siteId ?? lot.initialStorageSiteId;
        if (ownerSite) siteIds.add(ownerSite);
        const ownerKey = ownerSite ? `site:${ownerSite}` : `org:${org}`;
        add(lot, live.find((e) => e.entityType === "LOT" && e.entityId === lot.id && e.kind === "LOT_IMAGE" && e.public), ownerKey, lot.product.productName);
        if (cycle?.farm.privacy === "PUBLIC")
          for (const e of live.filter((x) => x.entityType === "CYCLE" && x.entityId === cycle.id && CAPTIONS[x.kind]))
            add(lot, e, `farm:${cycle.farmId}`, CAPTIONS[e.kind]);
      }
      for (const siteId of siteIds)
        add(lot, live.find((e) => e.organizationId === org && e.entityType === "SITE" && e.entityId === siteId && e.kind === "SITE_IMAGE"), `site:${siteId}`, "Hình ảnh cơ sở bảo quản và xử lý hàng");
    }
    const traceFarms = new Map();
    for (const lot of lots) {
      const cycle = lot.harvest?.cycle;
      if (lot.farmOrgId === org && cycle?.farm.privacy === "PUBLIC")
        traceFarms.set(cycle.farmId, { id: cycle.farmId, name: cycle.farm.name, address: cycle.farm.address });
    }
    const presentation = {
      publicDirectory: {
        published: true, catalogDetailsPublished: true, traceDetailsPublished: true,
        phone: profile.phone, address: profile.address, province: profile.province, ward: profile.ward,
        website: null, introduction: profile.description, logoEvidenceId: logo.id,
        traceSites: sites.filter((s) => s.organizationId === org).map((s) => ({ id: s.id, name: s.name, address: s.address })),
        traceFarms: [...traceFarms.values()], traceMedia,
      },
    };
    const id = seedContentId("dataset-presentation", org + JSON.stringify(presentation));
    await db.publicDirectoryPublication.upsert({ where: { id }, update: {}, create: { id, organizationId: org, presentation } });
    count++;
  }
  return count;
}
