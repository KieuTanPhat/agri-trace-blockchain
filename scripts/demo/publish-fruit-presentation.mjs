/** Explicit local publication authorized by the dataset owner. Never targets production. */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../apps/api/dist/generated/prisma/client.js";
import { datasetContext } from "./dataset-context.mjs";
import { seedContentId } from "./seed-recovery.mjs";
const context = datasetContext(),
  url = new URL(context.databaseUrl);
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url.href }),
});
const accounts = JSON.parse(
  await readFile(`${context.run}/accounts.json`, "utf8"),
).users;
const assets = JSON.parse(
  await readFile(`${context.assets}/manifest.json`, "utf8"),
).photos;
const names = {
  farm: "Bình Minh",
  berry: "Phú An",
  garden: "Cửu Long",
  carrier: "An Tâm",
  distributor: "Việt Xanh",
  retailer: "An Lành",
  processor: "Mùa Vàng",
};
const base = context.base;
async function json(path, options = {}) {
  const r = await fetch(base + path, options);
  const j = await r.json();
  if (!r.ok)
    throw new Error(
      `${path}: HTTP ${r.status} ${JSON.stringify(j.message ?? j.error ?? "").slice(0, 180)}`,
    );
  return j.data ?? j;
}
try {
  const profiles = await db.enterpriseProfile.findMany({
    where: { organization: { status: "ACTIVE" } },
    include: { organization: true },
  });
  const lots = await db.lot.findMany({
    include: {
      product: { select: { productName: true } },
      harvest: { include: { cycle: { include: { farm: true } } } },
      processingRun: true,
    },
  });
  const sites = await db.enterpriseSite.findMany({
    where: { status: "ACTIVE" },
  });
  const evidence = await db.traceEvidence.findMany({
    where: { withdrawal: null },
    select: {
      id: true,
      organizationId: true,
      entityType: true,
      entityId: true,
      kind: true,
      sha256: true,
      fileName: true,
      public: true,
      supersedesId: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const lines = await db.distributionLine.findMany({
    where: { transfer: { status: { not: "CANCELLED" } } },
    include: { transfer: true },
  });
  const shipments = await db.shipment.findMany({
    select: { lotId: true, transporterOrgId: true, retailerOrgId: true },
  });
  const superseded = new Set(evidence.map((e) => e.supersedesId));
  const inspections = await db.inspection.findMany({
    where: { replacement: null },
    select: { lotId: true, inspectorOrgId: true },
  });
  const inspectionBytes = await readFile(`${context.assets}/inspect.jpg`);
  const today = new Date(
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }),
  );
  const certificates = await db.certificate.findMany({
    where: {
      isPublic: true,
      status: "APPROVED",
      replacements: { none: { status: "APPROVED" } },
      issueDate: { lte: today },
      OR: [{ expiryDate: null }, { expiryDate: { gte: today } }],
    },
    select: { lotId: true, cycleId: true, documentRef: true, type: true },
  });
  let total = 0;
  for (const profile of profiles) {
    const key = Object.entries(names).find(([, fragment]) =>
      profile.organization.name.includes(fragment),
    )?.[0];
    if (!key) continue;
    const asset = assets.find((a) => a.key === `logo-${key}`),
      bytes = await readFile(`${context.assets}/${asset.file}`);
    const sha = createHash("sha256").update(bytes).digest("hex");
    let session;
    const ownerSession = async () => {
      if (session) return session;
      const account = accounts.find(
        (a) =>
          a.organizationId === profile.organizationId &&
          a.email?.includes(".owner@"),
      );
      if (!account) throw new Error(`No owner account for ${key}`);
      session = await json("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: account.email,
          password: account.password,
        }),
      });
      return session;
    };
    let logo = evidence.find(
      (e) =>
        e.organizationId === profile.organizationId &&
        e.entityType === "PROFILE" &&
        e.sha256 === sha,
    );
    if (!logo) {
      const account =
        accounts.find(
          (a) =>
            a.organizationId === profile.organizationId && a.tier === "OWNER",
        ) ??
        accounts.find(
          (a) =>
            a.organizationId === profile.organizationId &&
            a.email?.includes(".owner@"),
        );
      if (!account) throw new Error(`No owner account for ${key}`);
      const session = await json("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: account.email,
          password: account.password,
        }),
      });
      const form = new FormData();
      form.set("entityType", "PROFILE");
      form.set("entityId", profile.organizationId);
      form.set("kind", "OTHER");
      form.set("description", `Logo doanh nghiệp do chủ bộ dữ liệu cung cấp.`);
      form.set(
        "file",
        new Blob([bytes], { type: "image/jpeg" }),
        `logo-supplied-${key}-${sha.slice(0, 8)}.jpg`,
      );
      const result = await json("/enterprise-workspace/evidence", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          "Idempotency-Key": seedContentId(
            "supplied-logo",
            profile.organizationId + sha,
          ),
        },
        body: form,
      });
      logo = result.record ?? result;
    }
    const traceMedia = [];
    const add = (lot, e, groupKey, caption) => {
      if (
        !e ||
        superseded.has(e.id) ||
        traceMedia.some(
          (m) =>
            m.lotId === lot.id &&
            m.groupKey === groupKey &&
            m.evidenceId === e.id,
        )
      )
        return;
      traceMedia.push({ lotId: lot.id, evidenceId: e.id, groupKey, caption });
    };
    for (const lot of lots) {
      const owned = lot.farmOrgId === profile.organizationId,
        cycle = lot.harvest?.cycle;
      const farmSite = cycle
        ? sites.find((s) => s.farmId === cycle.farmId)
        : null;
      const ownerKey = lot.processingRun
        ? `site:${lot.processingRun.siteId}`
        : lot.initialStorageSiteId
          ? `site:${lot.initialStorageSiteId}`
          : farmSite
            ? `site:${farmSite.id}`
            : cycle
              ? `farm:${cycle.farmId}`
              : `org:${lot.farmOrgId}`;
      if (owned) {
        const inspection = inspections.find(
          (i) => i.lotId === lot.id && i.inspectorOrgId,
        );
        if (inspection) {
          const fileName = `inspection-stage-${lot.id}.jpg`;
          let image = evidence.find(
            (e) =>
              e.entityType === "LOT" &&
              e.entityId === lot.id &&
              e.fileName === fileName &&
              !superseded.has(e.id),
          );
          if (!image) {
            const auth = await ownerSession();
            const form = new FormData();
            form.set("entityType", "LOT");
            form.set("entityId", lot.id);
            form.set("kind", "LOT_IMAGE");
            form.set(
              "description",
              "Ảnh minh họa công việc kiểm tra do chủ bộ dữ liệu cung cấp; dùng chung cho các lô.",
            );
            form.set(
              "file",
              new Blob([inspectionBytes], { type: "image/jpeg" }),
              fileName,
            );
            const result = await json("/enterprise-workspace/evidence", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${auth.accessToken}`,
                "Idempotency-Key": seedContentId(
                  "inspection-stage-photo",
                  lot.id +
                    createHash("sha256").update(inspectionBytes).digest("hex"),
                ),
              },
              body: form,
            });
            image = result.record ?? result;
          }
          add(
            lot,
            image,
            `org:${inspection.inspectorOrgId}`,
            "Ảnh minh họa công việc kiểm tra, dùng chung cho các lô",
          );
        }
        const productImage = evidence.find(
          (e) =>
            e.entityType === "LOT" &&
            e.entityId === lot.id &&
            e.kind === "LOT_IMAGE" &&
            e.public,
        );
        add(lot, productImage, ownerKey, `${lot.product.productName}`);
        if (cycle?.farm.privacy === "PUBLIC") {
          const farmKey = farmSite
            ? `site:${farmSite.id}`
            : `farm:${cycle.farmId}`;
          for (const certificate of certificates.filter(
            (c) => c.lotId === lot.id || c.cycleId === cycle.id,
          )) {
            const image = evidence.find(
              (e) =>
                certificate.documentRef ===
                  `/enterprise-workspace/evidence/${e.id}/file` &&
                e.kind === "CERTIFICATE_IMAGE" &&
                !superseded.has(e.id),
            );
            add(lot, image, farmKey, certificate.type);
          }
          for (const kind of ["CYCLE_IMAGE", "CARE_IMAGE", "HARVEST_IMAGE"]) {
            const photo = evidence.find(
              (e) =>
                e.entityType === "CYCLE" &&
                e.entityId === cycle.id &&
                e.kind === kind &&
                !superseded.has(e.id),
            );
            add(
              lot,
              photo,
              farmKey,
              {
                CYCLE_IMAGE: "Khu vực canh tác và cây trồng",
                CARE_IMAGE: "Công việc chăm sóc cây trồng",
                HARVEST_IMAGE: "Hoạt động thu hoạch tại vườn",
              }[kind],
            );
          }
        }
      }
      const siteIds = new Set(
        owned
          ? [
              lot.initialStorageSiteId,
              lot.processingRun?.siteId,
              farmSite?.id,
            ].filter(Boolean)
          : [],
      );
      const fallback =
        shipments.some(
          (s) =>
            s.lotId === lot.id &&
            [s.transporterOrgId, s.retailerOrgId].includes(
              profile.organizationId,
            ),
        ) ||
        lines.some(
          (l) =>
            l.lotId === lot.id &&
            ((l.transfer.carrierId === profile.organizationId &&
              !l.transfer.carrierSiteId) ||
              (l.transfer.receiverId === profile.organizationId &&
                !l.transfer.receiverSiteId)),
        );
      if (fallback) {
        const photo = evidence.find(
          (e) =>
            e.organizationId === profile.organizationId &&
            e.entityType === "SITE" &&
            e.kind === "SITE_IMAGE" &&
            !superseded.has(e.id),
        );
        add(
          lot,
          photo,
          `org:${profile.organizationId}`,
          "Hình ảnh cơ sở do doanh nghiệp cung cấp",
        );
      }
      for (const line of lines.filter((l) => l.lotId === lot.id)) {
        const t = line.transfer;
        if (t.senderId === profile.organizationId && t.senderSiteId)
          siteIds.add(t.senderSiteId);
        if (t.carrierId === profile.organizationId && t.carrierSiteId)
          siteIds.add(t.carrierSiteId);
        if (t.receiverId === profile.organizationId && t.receiverSiteId)
          siteIds.add(t.receiverSiteId);
      }
      for (const siteId of siteIds)
        for (const photo of evidence
          .filter(
            (e) =>
              e.organizationId === profile.organizationId &&
              e.entityType === "SITE" &&
              e.entityId === siteId &&
              e.kind === "SITE_IMAGE" &&
              !superseded.has(e.id),
          )
          .slice(0, 2))
          add(
            lot,
            photo,
            `site:${siteId}`,
            "Hình ảnh cơ sở bảo quản và xử lý hàng",
          );
    }
    const presentation = {
      publicDirectory: {
        published: true,
        catalogDetailsPublished: true,
        traceDetailsPublished: true,
        phone: profile.phone,
        address: profile.address,
        province: profile.province,
        ward: profile.ward,
        website: null,
        introduction: profile.description,
        logoEvidenceId: logo.id,
        traceSites: sites
          .filter((s) => s.organizationId === profile.organizationId)
          .map((s) => ({ id: s.id, name: s.name, address: s.address })),
        traceFarms: [
          ...new Map(
            lots
              .filter(
                (l) =>
                  l.farmOrgId === profile.organizationId &&
                  l.harvest?.cycle.farm.privacy === "PUBLIC",
              )
              .map((l) => [
                l.harvest.cycle.farmId,
                {
                  id: l.harvest.cycle.farmId,
                  name: l.harvest.cycle.farm.name,
                  address: l.harvest.cycle.farm.address,
                },
              ]),
          ).values(),
        ],
        traceMedia,
      },
    };
    const latest = await db.publicDirectoryPublication.findFirst({
      where: { organizationId: profile.organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, presentation: true },
    });
    if (!isDeepStrictEqual(latest?.presentation, presentation)) {
      const id = seedContentId(
        "fruit-presentation-v2",
        profile.organizationId +
          (latest?.id ?? "") +
          JSON.stringify(presentation),
      );
      await db.publicDirectoryPublication.upsert({
        where: { id },
        update: {},
        create: { id, organizationId: profile.organizationId, presentation },
      });
    }
    total += traceMedia.length;
    console.log(
      `${profile.organization.name}: logo, ${traceMedia.length} ảnh theo lô/địa điểm.`,
    );
  }
  console.log(
    `Đã công khai ${total} liên kết ảnh trong đúng bộ dữ liệu local.`,
  );
} finally {
  await db.$disconnect();
}
