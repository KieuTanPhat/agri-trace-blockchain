// Local operator seed. Run only after seed-current.ps1 backup/target checks,
// or explicitly authorized fresh-cluster checks (see database migration runbook).
import assert from "node:assert/strict";
import { freshProducts, processedProducts } from "./fruit-catalog.mjs";
import {ensureSeedAccount,seedContentId} from "./seed-recovery.mjs";
import {publishDirectoryProfiles} from "./publish-directory-profiles.mjs";
import {
  createHash,
  randomUUID,
  randomBytes,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { hash } from "bcrypt";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../apps/api/dist/generated/prisma/client.js";
import {
  appendPlatformAudit,
  lockPlatformAudit,
} from "../../apps/api/dist/modules/platform-governance/platform-audit.js";

const target = seedTarget();
const local = target.run;
const assets = target.assets;
const url = new URL(target.databaseUrl);
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url.href }),
});
process.on("unhandledRejection", async (error) => {
  console.error(error.message);
  await db.$disconnect();
  process.exitCode = 1;
});
const base = target.apiBase;
await mkdir(local, { recursive: true });
const json = (value) =>
  JSON.stringify(
    value,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
async function save(name, value) {
  const target = `${local}/${name}.json`;
  await writeFile(`${target}.tmp`, json(value), { mode: 0o600 });
  await rename(`${target}.tmp`, target);
}
async function load(name, fallback) {
  try {
    return JSON.parse(await readFile(`${local}/${name}.json`, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
const state = await load("progress", {
  startedAt: new Date().toISOString(),
  commands: {},
  steps: {},
});
const now = new Date(state.startedAt);
const day = (n) => new Date(now.getTime() + n * 86400000).toISOString();
const digest = (v) => createHash("sha256").update(v).digest("hex");
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
async function step(name, body) {
  if (state.steps[name]) return state.steps[name];
  // Real Fabric confirms bindings and grants asynchronously; start each step
  // on a settled ledger so business writes never race a pending grant.
  if (target.mode === "production") await ledgerSettled();
  const result = await body();
  state.steps[name] = result ?? true;
  await save("progress", state);
  console.log(`Completed ${name}`);
  return result;
}
async function api(
  actor,
  route,
  body,
  label,
  method = body === undefined ? "GET" : "POST",
) {
  let command;
  if (body !== undefined) {
    assert.ok(label, "Mutations require a stable checkpoint label");
    command = state.commands[label];
    if (command?.complete) return command.result;
    if (command?.definitiveValidationFailure) {
      command.rejectedBodies ??= [];
      command.rejectedBodies.push(command.body);
      command.body = body;
      command.definitiveValidationFailure = false;
      await save("progress", state);
    }
    if (!command) {
      command = state.commands[label] = {
        key: randomUUID(),
        route,
        method,
        body,
      };
      await save("progress", state);
    }
    assert.equal(command.route, route);
    assert.equal(command.method, method);
    body = command.body; // Recovery always uses the original body and key.
  }
  let response;
  for (let attempt = 0; attempt < 8; attempt++) {
    response = await fetch(`${base}${route}`, {
      method,
      headers: {
        ...(body !== undefined
          ? {
              "content-type": "application/json",
              "Idempotency-Key": command.key,
            }
          : {}),
        ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status !== 429) break;
    await response.arrayBuffer();
    console.log(
      "Rate limit reached; preserving command and waiting before retry.",
    );
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(
          60,
          Math.max(10, Number(response.headers.get("retry-after") ?? 60)),
        ) * 1000,
      ),
    );
  }
  const result = await response.json();
  if (!response.ok) {
    if (
      command &&
      response.status === 400 &&
      result.error?.code === "VALIDATION_ERROR"
    ) {
      command.definitiveValidationFailure = true;
      await save("progress", state);
    }
    throw new Error(
      `${response.status} ${method} ${route}: ${JSON.stringify(result.message ?? result.error ?? result).slice(0, 1400)}`,
    );
  }
  const data = result.data ?? result;
  if (command) {
    command.complete = true;
    command.result = data;
    await save("progress", state);
  }
  return data;
}
const manifest = JSON.parse(await readFile(`${assets}/manifest.json`, "utf8"));
for (const asset of manifest.photos) {
  const bytes = await readFile(`${assets}/${asset.file}`);
  assert.equal(digest(bytes), asset.sha256);
  assert.ok(bytes.length > 50 && bytes.length < 5e6);
  assert.ok(
    bytes[0] === 255 && bytes[1] === 216,
    "Photos must be real JPEG files",
  );
}
const roles = [
  "SYSTEM_ADMIN",
  "PLATFORM_OPERATOR",
  "PLATFORM_CASE_MANAGER",
  "PLATFORM_PRIVACY_OFFICER",
  "FARM_STAFF",
  "TRANSPORTER",
  "DISTRIBUTOR",
  "RETAILER",
  "PROCESSOR",
  "AUDITOR",
  "COMPLIANCE_REVIEWER",
];
const orgDefs = [
  [
    "farm",
    "Hợp tác xã Trái cây Bình Minh",
    "FARM",
    "FARM_STAFF",
    "Lâm Đồng",
    "Đơn Dương",
  ],
  [
    "berry",
    "Hợp tác xã Nông nghiệp Phú An",
    "FARM",
    "FARM_STAFF",
    "Lâm Đồng",
    "Đà Lạt",
  ],
  [
    "garden",
    "Hợp tác xã Miệt Vườn Cửu Long",
    "FARM",
    "FARM_STAFF",
    "Hà Nội",
    "Đông Anh",
  ],
  [
    "carrier",
    "Công ty Vận tải lạnh An Tâm",
    "TRANSPORTER",
    "TRANSPORTER",
    "TP. Hồ Chí Minh",
    "Thủ Đức",
  ],
  [
    "distributor",
    "Công ty Phân phối Nông sản Việt Xanh",
    "DISTRIBUTOR",
    "DISTRIBUTOR",
    "TP. Hồ Chí Minh",
    "Thủ Đức",
  ],
  [
    "retailer",
    "Công ty Thực phẩm An Lành",
    "RETAILER",
    "RETAILER",
    "TP. Hồ Chí Minh",
    "Bến Thành",
  ],
  [
    "processor",
    "Công ty Chế biến Nông sản Mùa Vàng",
    "PROCESSOR",
    "PROCESSOR",
    "Lâm Đồng",
    "Đức Trọng",
  ],
  [
    "auditor",
    "Trung tâm Kiểm soát Chất lượng Việt Tín",
    "AUDITOR",
    "AUDITOR",
    "TP. Hồ Chí Minh",
    "Tân Bình",
  ],
];
let accounts = await load("accounts", null);
const bootstrap = await step("bootstrap", async () => {
  const pendingBootstrap=await load("bootstrap-intent",null);
  if(pendingBootstrap) {
    const userIds=Object.values(pendingBootstrap.users).map(u=>u.id);
    const recovered=await db.user.count({where:{id:{in:userIds}}});
    if(recovered===userIds.length)return pendingBootstrap;
    assert.equal(recovered,0,"Partially recovered bootstrap requires reconciliation");
  }
  assert.deepEqual(
    (await db.user.findMany({ select: { id: true } })).map((u) => u.id).sort(),
    [...target.baselineUserIds].sort(),
    "Reset must be performed by the operator wrapper first",
  );
  accounts = {
    createdAt: now.toISOString(),
    warning: "Local credentials. Never commit, publish or email.",
    users: [],
  };
  const passwords = new Map();
  const makeUser = async (tx, email, fullName, roleCode, extra = {}) => {
    const password = `Agri!${randomBytes(18).toString("base64url")}9a`;
    const role = await tx.role.findUniqueOrThrow({ where: { code: roleCode } });
    const user = await tx.user.create({
      data: {
        email,
        fullName,
        roleId: role.id,
        passwordHash: await hash(password, 10),
        passwordChangedAt: now,
        phone: `090${String(accounts.users.length + 1000000)}`,
        ...extra,
      },
    });
    passwords.set(email, password);
    accounts.users.push({
      email,
      password,
      fullName,
      role: roleCode,
      organizationId: user.organizationId,
      tier: user.enterpriseTier,
      accountStatus: user.accountStatus,
      mustChangePassword: user.mustChangePassword,
    });
    return user;
  };
  const result = await db.$transaction(
    async (tx) => {
      const result = { users: {}, orgs: {} };
      for (const code of roles)
        await tx.role.upsert({
          where: { code },
          create: { code, name: code },
          update: {},
        });
      for (const [key, roleCode, name] of [
        ["admin", "SYSTEM_ADMIN", "Nguyễn Minh An"],
        ["checker", "SYSTEM_ADMIN", "Trần Gia Hân"],
        ["operator", "PLATFORM_OPERATOR", "Lê Tuấn Khang"],
        ["cases", "PLATFORM_CASE_MANAGER", "Phạm Ngọc Mai"],
        ["privacy", "PLATFORM_PRIVACY_OFFICER", "Võ Khánh Linh"],
      ])
        result.users[key] = await makeUser(
          tx,
          `${key}@example.test`,
          name,
          roleCode,
        );
      for (let i = 0; i < orgDefs.length; i++) {
        const [key, name, type, roleCode, province, ward] = orgDefs[i];
        const organization = await tx.organization.create({
          data: { name, type, status: "ACTIVE" },
        });
        const owner = await makeUser(
          tx,
          `${key}.owner@example.test`,
          ["Nguyễn Văn Hòa","Trần Thị Thu","Lê Minh Tâm","Phạm Quốc Huy","Võ Thị Lan","Đặng Hoài Nam","Bùi Thanh Phong","Nguyễn Hoàng Anh"][i],
          roleCode,
          {
            organizationId: organization.id,
            enterpriseTier: 1,
            memberCode: "NV0001",
            jobTitle: "Chủ quản doanh nghiệp",
            contactAddress: `${ward}, ${province}`,
            memberNote:
              "Thành viên phụ trách hoạt động sản xuất và giao nhận của đơn vị.",
          },
        );
        result.users[key] = owner;
        result.orgs[key] = organization;
        if (type === "AUDITOR") {
          await tx.organizationCapability.upsert({
            where: {
              organizationId_code: {
                organizationId: organization.id,
                code: type,
              },
            },
            create: { organizationId: organization.id, code: type },
            update: {},
          });
          await tx.scopedRoleGrant.create({
            data: {
              userId: owner.id,
              organizationId: organization.id,
              scope: "ORGANIZATION",
              role: "ORG_ADMIN",
            },
          });
          result.users.reviewer = await makeUser(
            tx,
            "reviewer@example.test",
            "Nguyễn Thu Hà",
            "COMPLIANCE_REVIEWER",
            {
              organizationId: organization.id,
              jobTitle: "Chuyên viên xét duyệt độc lập",
            },
          );
          continue;
        }
        const caps = key === "farm" ? ["FARM", "PROCESSOR"] : [type];
        for (const code of caps)
          await tx.organizationCapability.upsert({
            where: {
              organizationId_code: { organizationId: organization.id, code },
            },
            create: { organizationId: organization.id, code },
            update: {},
          });
        const enrollment = await tx.enterpriseEnrollment.create({
          data: {
            id: randomUUID(),
            organizationId: organization.id,
            ownerId: owner.id,
            registrationDigest: digest(`demo:${organization.id}`),
            businessId: `AGT-2026-${String(i + 1).padStart(4, "0")}`,
            hostingMode: i % 2 ? "SELF_MANAGED_ORG" : "MANAGED_ORG",
            status: "APPROVED",
            serviceActivatedAt: now,
            serviceActivatedBy: result.users.admin.id,
            serviceActivationReason:
              "Khởi tạo hồ sơ local được chủ dự án cho phép; không phải nghiệm thu Fabric.",
            reviewedBy: result.users.admin.id,
            reviewNote: "Đã rà soát thông tin hồ sơ và phân công người phụ trách.",
          },
        });
        await tx.enterpriseProfile.create({
          data: {
            organizationId: organization.id,
            legalForm: type === "FARM" ? "COOPERATIVE" : "ENTERPRISE",
            address: `Khu nông nghiệp  ${i + 1}, ${ward}, ${province}`,
            province,
            ward,
            phone: `0287300000${i}`,
            contactEmail: `${key}.contact@example.test`,
            representative: `${owner.fullName}`,
            activities: caps,
            website: `https://${key}.example.test`,
            description: `${name}: ${type === "FARM" ? "Trồng trọt có nhật ký chăm sóc, thu hoạch theo lô và kiểm soát chất lượng." : "Đối tác trong chuỗi nông sản , lưu đầy đủ thông tin và chứng từ giao nhận."} Quản lý hồ sơ vùng sản xuất, chất lượng và giao nhận theo từng lô.`,
            declarationAcceptedAt: now,
            legalData: {
              registrationNumber: `AGT-DKKD-${i + 1}`,
              taxCode: `AGT-MST-${i + 1}`,
              representative: owner.fullName,
              position: "Giám đốc",
              issuedBy: "Cơ quan đăng ký  - không có giá trị pháp lý",
              issuedAt: "2025-01-15",
            },
            registrationData: {
              schemaVersion: 2,
             synthetic: true,
              registrationRole: type,
              legalForm: type === "FARM" ? "COOPERATIVE" : "ENTERPRISE",
              activities: caps,
              production:
                type === "FARM"
                  ? {
                      type: "CROP",
                      areaM2: 12000,
                      annualOutput: 60,
                      method: "Canh tác quản lý tổng hợp",
                    }
                  : undefined,
              servicePreferences: ["TRACEABILITY", "QR_LABELS"],
              termsAccepted: true,
              privacyAccepted: true,
              accuracyAccepted: true,
              marketingAccepted: false,
              acceptedAt: now.toISOString(),
              policyVersion: "AGT-2026-10",
            },
          },
        });
        for (const role of [
          "ORG_ADMIN",
          ...(type === "FARM" ? ["CREATE_CHAIN"] : []),
        ])
          await tx.scopedRoleGrant.create({
            data: {
              userId: owner.id,
              organizationId: organization.id,
              scope: "ORGANIZATION",
              role,
            },
          });
        const [manager, staff] = await (async () => {
          const manager = await makeUser(
            tx,
            `${key}.manager@example.test`,
            ["Trần Quang Minh","Nguyễn Thị Hạnh","Phạm Minh Đức","Lê Quốc Bảo","Võ Thanh Hà","Trần Ngọc Yến","Nguyễn Văn Khải"][i],
            roleCode,
            {
              organizationId: organization.id,
              enterpriseTier: 2,
              supervisorId: owner.id,
              memberCode: "NV0002",
              jobTitle: "Quản lý nghiệp vụ",
            },
          );
          const staff = await makeUser(
            tx,
            `${key}.staff@example.test`,
            ["Lê Thảo Vy","Phạm Ngọc Hân","Nguyễn Thành Đạt","Trần Văn Dũng","Lê Thị Mỹ","Võ Minh Châu","Đặng Thùy Linh"][i],
            roleCode,
            {
              organizationId: organization.id,
              enterpriseTier: 3,
              supervisorId: manager.id,
              memberCode: "NV0003",
              jobTitle: "Nhân viên nghiệp vụ",
            },
          );
          return [manager, staff];
        })();
        result.users[`${key}Manager`] = manager;
        result.users[`${key}Staff`] = staff;
        // Migration-provided plan versions are authoritative; do not invent a price catalog.
        const plan = await tx.servicePlanVersion.findFirst({
          where: { status: "PUBLISHED", planCode: "TRACE_20" },
          orderBy: { createdAt: "desc" },
        });
        if (type === "FARM" && plan)
          await tx.subscription.create({
            data: {
              organizationId: organization.id,
              planVersionId: plan.id,
              status: "ACTIVE",
              startsAt: new Date(day(-30)),
              endsAt: new Date(day(335)),
            },
          });
        result.orgs[key].enrollmentId = enrollment.id;
      }
      for (const [key, status] of [
        ["pending", "PENDING_REVIEW"],
        ["rejected", "REJECTED"],
      ]) {
        const org = await tx.organization.create({
          data: {
            name: `Doanh nghiệp ${key === "pending" ? "Chờ duyệt" : "Bị từ chối"} `,
            type: "FARM",
          },
        });
        await tx.organizationCapability.deleteMany({
          where: { organizationId: org.id },
        });
        const owner = await makeUser(
          tx,
          `${key}.owner@example.test`,
          `Chủ hồ sơ ${key}`,
          "FARM_STAFF",
          { organizationId: org.id, enterpriseTier: 1 },
        );
        await tx.enterpriseEnrollment.create({
          data: {
            id: randomUUID(),
            ownerId: owner.id,
            organizationId: org.id,
            hostingMode: "MANAGED_ORG",
            registrationDigest: digest(org.id),
            businessId: `AGT-${key}`,
            status,
            ...(key === "rejected"
              ? {
                  reviewedBy: result.users.admin.id,
                  reviewNote: "Hồ sơ thiếu chứng từ; bổ sung rồi gửi lại.",
                }
              : {}),
          },
        });
        result.users[key] = owner;
      }
      for (const [key, fields] of [
        ["firstlogin", { mustChangePassword: true }],
        ["locked", { accountStatus: "LOCKED" }],
        ["inactive", { accountStatus: "INACTIVE" }],
      ])
        result.users[key] = await makeUser(
          tx,
          `${key}@example.test`,
          `Tài khoản ${key}`,
          "FARM_STAFF",
          {
            organizationId: result.orgs.farm.id,
            enterpriseTier: 3,
            supervisorId: result.users.farmManager.id,
            ...fields,
          },
        );
      await save("accounts",accounts);
      await save("bootstrap-intent",result);
      return result;
    },
    { timeout: 120000 },
  );
  await save("accounts", accounts);
  return result;
});
accounts ??= await load("accounts");
const actors = {};
const sessions = await load("sessions", {});
for (const [key, user] of Object.entries(bootstrap.users)) {
  if (
    ![
      "admin",
      "operator",
      "cases",
      "privacy",
      "farm",
      "berry",
      "garden",
      "carrier",
      "distributor",
      "retailer",
      "processor",
      "auditor",
      "reviewer",
    ].includes(key)
  ) {
    actors[key] = { ...user };
    continue;
  }
  const credential = accounts.users.find((x) => x.email === user.email);
  if (!sessions[key] || sessions[key].expiresAt < Date.now() + 300000) {
    let r;
    for (let attempt = 0; attempt < 8; attempt++) {
      r = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: credential.email,
          password: credential.password,
        }),
      });
      if (r.status !== 429) break;
      await r.arrayBuffer();
      console.log(
        "Login throttle active; waiting without changing credentials.",
      );
      await new Promise((resolve) => setTimeout(resolve, 60000));
    }
    const payload = await r.json();
    const data = payload.data ?? payload;
    assert.equal(r.status, 201, `Login failed for ${key}`);
    sessions[key] = {
      token: data.accessToken,
      expiresAt:
        JSON.parse(Buffer.from(data.accessToken.split(".")[1], "base64url"))
          .exp * 1000,
    };
    await save("sessions", sessions);
  }
  actors[key] = {
    ...user,
    organizationId: user.organizationId,
    token: sessions[key].token,
  };
}
const unwrap = (v) => v.record ?? v;
async function evidence(key, type, id, kind, photoKey, suffix = "") {
  const label = `evidence:${key}:${type}:${id}:${kind}:${photoKey}:${suffix}`;
  if (state.commands[label]?.complete) return state.commands[label].result;
  const asset = manifest.photos.find((x) => x.key === photoKey);
  assert.ok(asset, `Missing photo ${photoKey}`);
  const bytes = await readFile(`${assets}/${asset.file}`);
  const form = new FormData();
  form.set("entityType", type);
  form.set("entityId", id);
  form.set("kind", kind);
  if (suffix === "public") {
    assert.equal(type, "LOT");
    form.set("public", "true");
    form.set("publicationConfirmed", "true");
  }
  form.set(
    "description",
    `Ảnh hồ sơ: ${asset.description ?? "Hình ảnh hồ sơ và hoạt động"}.`,
  );
  form.set("file", new Blob([bytes], { type: "image/jpeg" }), asset.file);
  const command = (state.commands[label] ??= { key: randomUUID() });
  await save("progress", state);
  const response = await fetch(`${base}/enterprise-workspace/evidence`, {
    method: "POST",
    body: form,
    headers: {
      Authorization: `Bearer ${actors[key].token}`,
      "Idempotency-Key": command.key,
    },
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      `Evidence ${type}/${kind}: ${response.status} ${JSON.stringify(result.message ?? result.error ?? result).slice(0, 900)}`,
    );
  command.result = result.data ?? result;
  command.complete = true;
  await save("progress", state);
  return command.result;
}

// All subsequent domain writes use the normal authorized HTTP command handlers.
const resources = await step("resources", async () => {
  const result = {
    farms: [],
    products: [],
    sites: {},
    materials: [],
    plots: [],
    vehicles: [],
  };
  for (const [key, org] of Object.entries(bootstrap.orgs)) {
    if (key === "auditor") continue;
    for (let j = 0; j < 2; j++) {
      const kind =
        key === "processor" || (key === "farm" && j === 1)
          ? "PROCESSING"
          : key === "retailer"
            ? "RETAIL"
            : j
              ? "COLD_STORAGE"
              : "WAREHOUSE";
      const site = unwrap(
        await api(
          actors[key],
          "/enterprise-workspace/sites",
          {
            name: `${org.name} - ${j ? "Kho lạnh / sơ chế" : "Cơ sở chính"}`,
            kind,
            region: "Lâm Đồng",
            ward: "Đức Trọng",
            areaM2: 500 + j * 200,
            capacityKg: 10000,
            ...(j ? { coldAreaM2: 200 } : {}),
            expectedOutputTons: 60,
            address: `Khu sản xuất  ${j + 1}, Đức Trọng, Lâm Đồng`,
            manager: actors[key].fullName,
            representative: actors[key].fullName,
            phone: "0900000000",
            email: `${key}.site${j}@example.test`,
            staffUserId: actors[key].id,
            otherInfo:
              "Cơ sở: kiểm soát vệ sinh, phân khu tiếp nhận và bảo quản; ảnh stock minh họa.",
          },
          `site:${key}:${j}`,
        ),
      );
      await evidence(
        key,
        "SITE",
        site.id,
        "SITE_IMAGE",
        j ? "greenhouse" : "logistics",
      );
      const active = unwrap(
        await api(
          actors[key],
          `/enterprise-workspace/sites/${site.id}/complete`,
          { version: site.version },
          `site-complete:${site.id}`,
        ),
      );
      (result.sites[key] ??= []).push(active);
    }
  }
  for (let i = 0; i < 3; i++)
    result.vehicles.push(
      unwrap(
        await api(
          actors.carrier,
          "/enterprise-workspace/vehicles",
          {
            registration: `AGT-51D-${String(12001 + i)}`,
            kind: [
              "Xe tải lạnh 2,5 tấn",
              "Xe tải thùng kín 5 tấn",
              "Xe tải lạnh 8 tấn",
            ][i],
          },
          `vehicle:${i}`,
        ),
      ),
    );
  for (let i = 0; i < 3; i++) {
    const key = ["farm", "berry", "garden"][i];
    const actor = actors[key];
    for (let j = 0; j < 3; j++) {
      const material = unwrap(
        await api(
          actor,
          "/enterprise-workspace/materials",
          {
            name: [
              i === 1 ? "Cây giống ăn trái tuyển chọn" : "Cây giống ăn trái ghép",
              "Phân hữu cơ vi sinh",
              "Chế phẩm sinh học phòng sâu",
            ][j],
            kind: ["SEED", "FERTILIZER", "PROTECTION"][j],
            unit: j ? "kg" : "g",
            code: `${key.toUpperCase()}-VT-${j + 1}`,
            supplier: "Công ty Vật tư Nông nghiệp Xanh",
            manufacturer: "Cơ sở vật tư ",
            batchCode: `AGT-VT-2026-${i}${j}`,
            origin: "Việt Nam (dữ liệu)",
            price: j ? 45000 : 120000,
            seedType: j ? undefined : "Giống chọn lọc",
            activeIngredient: j === 2 ? "Bacillus thuringiensis" : undefined,
            description:
              "Dữ liệu kỹ thuật minh họa; không phải hướng dẫn sử dụng hóa chất.",
            withdrawalDays: j === 2 ? 7 : 0,
            expiryDate: day(200).slice(0, 10),
          },
          `material:${key}:${j}`,
        ),
      );
      await evidence(
        key,
        "MATERIAL",
        material.id,
        j ? "MATERIAL_IMAGE" : "SEED_IMAGE",
        i === 1 ? "berry1" : "tomato1",
      );
      result.materials.push({
        ...unwrap(
          await api(
            actor,
            `/enterprise-workspace/materials/${material.id}/complete`,
            { version: material.version },
            `material-complete:${material.id}`,
          ),
        ),
        key,
      });
    }
    const farm = await api(
      actor,
      "/catalog/farms",
      {
        organizationId: actor.organizationId,
        name: [
          "Vườn cây ăn trái Bình Minh",
          "Vùng dưa và trái cây Phú An",
          "Vườn trái cây Cửu Long",
        ][i],
        kind: "CROP",
        region: i === 2 ? "Hà Nội" : "Lâm Đồng",
        address:
          i === 2
            ? "Khu canh tác , Đông Anh, Hà Nội"
            : "Khu canh tác , Đơn Dương, Lâm Đồng",
        areaM2: 12000,
        expectedOutput: 60000,
        outputUnit: "kg/năm",
        privacy: i === 2 ? "PRIVATE" : "PUBLIC",
        representative: actor.fullName,
        phone: "0900000000",
        email: `${key}.farm@example.test`,
        seedMaterialIds: result.materials
          .filter((x) => x.key === key && x.kind === "SEED")
          .map((x) => x.id),
        inputMaterialIds: result.materials
          .filter((x) => x.key === key && x.kind !== "SEED")
          .map((x) => x.id),
        otherInfo:
          "Vùng có phân lô, nhật ký tưới/chăm sóc, thu hoạch theo đợt; chứng từ  không có giá trị pháp lý.",
      },
      `farm:${key}`,
    );
    // Legal documents are explicitly watermarked samples, never stock photos masquerading as certificates.
    // A farm needs only its land-use right document.
    for (const kind of ["LAND_CERTIFICATE"]) {
      const label = `document:${farm.id}:${kind}`;
      if (!state.commands[label]?.complete) {
        const bytes = await readFile(`${assets}/land-${i + 1}.jpg`);
        const form = new FormData();
        form.set("entityType", "FARM");
        form.set("entityId", farm.id);
        form.set("kind", kind);
        form.set(
          "description",
          "Bản tham khảo đã ẩn thông tin định danh; lưu cùng hồ sơ vùng sản xuất.",
        );
        form.set(
          "file",
          new Blob([bytes], { type: "image/jpeg" }),
          `AGT-${kind}.jpg`,
        );
        const cmd = (state.commands[label] ??= { key: randomUUID() });
        await save("progress", state);
        const r = await fetch(`${base}/enterprise-workspace/evidence`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${actor.token}`,
            "Idempotency-Key": cmd.key,
          },
          body: form,
        });
        const data = await r.json();
        if (!r.ok)
          throw new Error(
            `Demo document: ${r.status} ${JSON.stringify(data.message)}`,
          );
        cmd.complete = true;
        cmd.result = data.data;
        await save("progress", state);
      }
    }
    result.farms.push({
      ...(await api(
        actor,
        `/catalog/farms/${farm.id}/complete`,
        { version: farm.version },
        `farm-complete:${farm.id}`,
      )),
      key,
    });
    for (let j = 0; j < 2; j++)
      result.plots.push({
        ...(await api(
          actor,
          "/catalog/plots",
          {
            farmId: farm.id,
            name: `Khu ${j ? "B" : "A"} - 6.000 m²`,
            area: 6000,
            unit: "m2",
            location: "Phân khu, tưới nhỏ giọt, có rãnh thoát nước",
          },
          `plot:${key}:${j}`,
        )),
        key,
      });
    const catalog = freshProducts.filter(p => p.owner === key);
    for (let j = 0; j < catalog.length; j++) {
      const definition = catalog[j];
      const product = await api(
        actor,
        "/catalog/products",
        {
          productName: definition.name,
          variety: definition.variety,
          sku: `${key.toUpperCase()}-SP-${j + 1}`,
          category: definition.category,
          defaultUnit: "kg",
          originFarmId: farm.id,
          price: definition.price,
          storageConditions:
            definition.storage,
          ingredients: `100% ${definition.name.toLowerCase()}`,
          usageInstructions:
            "Rửa sạch trước khi dùng; loại bỏ quả hư; đọc hạn sử dụng trên tem.",
          description: definition.description,
          rawMaterials: "Nông sản tươi thu hoạch theo lô",
          manufacturingSiteId: result.sites[key][1].id,
          managerUserId: actor.id,
          distributor: bootstrap.orgs.distributor.name,
          carrier: bootstrap.orgs.carrier.name,
        },
        `product:${key}:${j}`,
      );
      for (let k = 1; k <= 1; k++)
        await evidence(
          key,
          "PRODUCT",
          product.id,
          "PRODUCT_IMAGE",
          definition.slug,
        );
      result.products.push({
        ...(await api(
          actor,
          `/catalog/products/${product.id}/complete`,
          { version: product.version },
          `product-complete:${product.id}`,
        )),
        key,
        slug: definition.slug,
      });
    }
  }
  return result;
});

const chains = await step("chains", async () => {
  const result = [];
  // First make every operational relationship through its acceptance command.
  for (const key of [
    "farm",
    "berry",
    "garden",
    "processor",
    "distributor",
    "retailer",
  ]) {
    for (const other of ["carrier", "processor", "distributor", "retailer"]) {
      if (key === other) continue;
      const existing = await db.enterprisePartner.findFirst({
        where: {
          OR: [
            {
              inviterId: actors[key].organizationId,
              inviteeId: actors[other].organizationId,
            },
            {
              inviterId: actors[other].organizationId,
              inviteeId: actors[key].organizationId,
            },
          ],
        },
      });
      if (existing) continue;
      const partner = unwrap(
        await api(
          actors[key],
          "/enterprise-workspace/partners",
          {
            businessId: (
              await db.enterpriseEnrollment.findUniqueOrThrow({
                where: { organizationId: actors[other].organizationId },
              })
            ).businessId,
            note: "Đối tác, giao nhận nông sản có kiểm tra hai phía.",
          },
          `partner:${key}:${other}`,
        ),
      );
      await api(
        actors[other],
        `/enterprise-workspace/partners/${partner.id}`,
        { version: partner.version, decision: "ACCEPT" },
        `partner-accept:${partner.id}`,
      );
    }
  }
  for (let i = 0; i < 4; i++) {
    const key = ["farm", "berry", "garden", "farm"][i];
    const chain = await api(
      actors[key],
      "/supply-chains",
      {
        name: [
          "Chuỗi trái cây Bình Minh",
          "Chuỗi trái cây Phú An",
          "Chuỗi trái cây Cửu Long",
          "Chuỗi chế biến trái cây Mùa Vàng",
        ][i],
        chainType: i === 3 ? "PROCESSED_FOOD" : "CROP",
        description:
          "Chuỗi có tổ chức độc lập tại từng khâu. Loại ngoài CROP chỉ phân loại; nghiệp vụ sản xuất hiện vẫn là trồng trọt.",
        participants: [
          "FARM",
          "PROCESSOR",
          "TRANSPORTER",
          "DISTRIBUTOR",
          "RETAILER",
        ].map((stage, j) => ({
          stage,
          organizationId:
            actors[[key, "processor", "carrier", "distributor", "retailer"][j]]
              .organizationId,
        })),
        productIds: resources.products
          .filter((p) => p.key === key)
          .map((p) => p.id),
        plannedStartDate: day(-60).slice(0, 10),
      },
      `chain:${i}`,
    );
    for (const other of ["processor", "carrier", "distributor", "retailer"]) {
      const memberships = await api(
        actors[key],
        `/supply-chains/${chain.id}/memberships`,
      );
      const m = memberships.find(
        (x) => x.organizationId === actors[other].organizationId,
      );
      if (m?.status === "INVITED")
        await api(
          actors[other],
          `/supply-chains/${chain.id}/memberships/${actors[other].organizationId}/accept`,
          { version: m.version },
          `membership:${chain.id}:${other}`,
        );
    }
    let profile = await api(
      actors[key],
      `/supply-chains/${chain.id}/business-profile`,
    );
    if (profile.state !== "ACTIVE")
      await api(
        actors[key],
        `/supply-chains/${chain.id}/business-profile/activate`,
        { version: profile.version },
        `chain-activate:${chain.id}`,
      );
    for (const other of [
      key,
      "processor",
      "carrier",
      "distributor",
      "retailer",
      "auditor",
    ]) {
      const role =
        other === "auditor"
          ? "AUDITOR"
          : other === key
            ? "FARM_STAFF"
            : other === "processor"
              ? "PROCESSOR"
              : other === "carrier"
                ? "TRANSPORTER"
                : other === "distributor"
                  ? "DISTRIBUTOR"
                  : "RETAILER";
      if (other === "auditor") {
        const m = await api(
          actors[key],
          `/supply-chains/${chain.id}/memberships`,
          { organizationId: actors.auditor.organizationId },
          `audit-member:${chain.id}`,
        );
        await api(
          actors.auditor,
          `/supply-chains/${chain.id}/memberships/${actors.auditor.organizationId}/accept`,
          { version: m.version },
          `audit-accept:${chain.id}`,
        );
      }
      // Seed authorization references are set as operator setup, never as SYSTEM_ADMIN business writes.
      for (const userKey of [other, `${other}Manager`, `${other}Staff`].filter(
        (x) => actors[x],
      )) {
        if (
          !(await db.scopedRoleGrant.findFirst({
            where: {
              userId: actors[userKey].id,
              chainId: chain.id,
              role,
              revokedAt: null,
            },
          }))
        )
          await db.scopedRoleGrant.create({
            data: {
              userId: actors[userKey].id,
              organizationId: actors[other].organizationId,
              scope: "CHAIN",
              chainId: chain.id,
              role,
            },
          });
      }
    }
    if (
      !(await db.scopedRoleGrant.findFirst({
        where: {
          userId: actors.reviewer.id,
          chainId: chain.id,
          role: "COMPLIANCE_REVIEWER",
          revokedAt: null,
        },
      }))
    )
      await db.scopedRoleGrant.create({
        data: {
          userId: actors.reviewer.id,
          organizationId: actors.auditor.organizationId,
          scope: "CHAIN",
          chainId: chain.id,
          role: "COMPLIANCE_REVIEWER",
        },
      });
    await evidence(
      key,
      "CHAIN",
      chain.id,
      "CHAIN_IMAGE",
      "care",
    );
    result.push({ ...chain, key });
  }
  return result;
});

await step("delegation", async () => {
  const allPermissions = [
    "profile.read",
    "members.read",
    "members.manage",
    "roles.manage",
    "partners.read",
    "partners.manage",
    "catalog.read",
    "catalog.manage",
    "sites.read",
    "sites.manage",
    "vehicles.read",
    "vehicles.manage",
    "production.read",
    "production.write",
    "distribution.read",
    "distribution.write",
    "distribution.sign",
    "trace.read",
    "qr.manage",
    "reports.read",
    "quantity.adjust",
    "profile.manage",
    "cases.read",
    "cases.respond",
    "inventory.manage",
    "quarantine.manage",
    "evidence.read",
    "evidence.manage",
    "materials.read",
    "materials.manage",
    "processing.read",
    "processing.write",
  ];
  for (const key of [
    "farm",
    "berry",
    "garden",
    "carrier",
    "distributor",
    "retailer",
    "processor",
  ]) {
    const chainIds = (
      await db.chainMembership.findMany({
        where: { organizationId: actors[key].organizationId, status: "ACTIVE" },
      })
    ).map((x) => x.chainId);
    const siteIds = [
      ...resources.sites[key].map((x) => x.id),
      ...resources.farms.filter((x) => x.key === key).map((x) => x.id),
    ];
    for (const tier of ["Manager", "Staff"]) {
      const permissions =
        tier === "Manager"
          ? allPermissions
          : allPermissions.filter(
              (x) =>
                ![
                  "members.manage",
                  "roles.manage",
                  "profile.manage",
                  "partners.manage",
                ].includes(x),
            );
      const role = unwrap(
        await api(
          actors[key],
          "/enterprise-workspace/roles",
          {
            name:
              tier === "Manager" ? "Quản lý nghiệp vụ" : "Thực hiện nghiệp vụ",
            permissions,
          },
          `role:${key}:${tier}`,
        ),
      );
      await db.enterpriseMemberRole.upsert({
        where: {
          userId_roleId: {
            userId: actors[`${key}${tier}`].id,
            roleId: role.id,
          },
        },
        create: {
          userId: actors[`${key}${tier}`].id,
          organizationId: actors[key].organizationId,
          roleId: role.id,
          chainIds,
          siteIds,
        },
        update: {},
      });
    }
  }
  for (const farm of resources.farms) {
    if (
      !(await db.complianceAssignment.findFirst({
        where: {
          farmId: farm.id,
          reviewerUserId: actors.reviewer.id,
          revokedAt: null,
        },
      }))
    )
      await api(
        actors.admin,
        "/compliance/assignments",
        {
          farmId: farm.id,
          reviewerUserId: actors.reviewer.id,
          reason:
            "Phân công reviewer độc lập cho vùng sản xuất trong hồ sơ.",
        },
        `compliance-assignment:${farm.id}`,
      );
  }
  return true;
});

// Local Fabric is off: the ledger-simulator service binds new chains and
// confirms requested ledger grants. In production the root operator binds the
// new chains on the real ledger (this run exits for it), then the Worker
// confirms the grants on Fabric.
async function ledgerSettled(timeoutMs = target.mode === "production" ? 900_000 : 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const unboundChains = await db.$queryRaw`
      SELECT c.chain_id::text AS id FROM supply_chain c
        LEFT JOIN chain_ledger_profile p ON p.chain_id = c.chain_id
       WHERE p.active_binding_digest IS NULL ORDER BY c.chain_id`;
    const [{ pending }] = await db.$queryRaw`
      SELECT count(*)::int AS pending FROM ledger_permission_sync
       WHERE state IN ('REQUESTED', 'REVOKE_REQUESTED', 'PENDING_LEDGER', 'PENDING_REVOKE_LEDGER')`;
    if (unboundChains.length && target.mode === "production") {
      await save("ledger-required", { chainIds: unboundChains.map((c) => c.id) });
      console.log(`Operator must bind ${unboundChains.length} chain(s) on the ledger; rerun afterwards.`);
      await db.$disconnect();
      process.exit(LEDGER_REQUIRED_EXIT);
    }
    if (unboundChains.length === 0 && pending === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(target.mode === "production"
    ? "Fabric did not confirm ledger grants in time; inspect Worker health"
    : "Simulated ledger did not settle; is ledger-simulator running?");
}

const production = await step("production", async () => {
  await ledgerSettled();
  const cycles = [],
    lots = [];
  for (const farm of resources.farms) {
    const key = farm.key,
      actor = actors[key],
      chain = chains.find((x) => x.key === key);
    const farmProducts = resources.products.filter((x) => x.key === key);
    for (let i = 0; i < farmProducts.length + 3; i++) {
      const product = farmProducts[i % farmProducts.length];
      const allocated = i % 2 === 0 || ["mit", "chuoi", "xoai"].includes(product.slug);
      const cycle = await api(
        actor,
        "/production-cycles",
        {
          chainId: chain.id,
          farmId: farm.id,
          plotId: resources.plots.filter((x) => x.key === key)[i % 2].id,
          productId: product.id,
          cycleCode: `AGT-202610-${key.toUpperCase()}-${i + 1}`,
          name: `${product.productName} - vụ ${i + 1}/2026`,
          startDate: day(-70).slice(0, 10),
          plannedHarvest: day(14).slice(0, 10),
          maxHarvestQuantity: 1500,
          harvestUnit: "kg",
          cultivatedArea: 6000,
          seedMaterialId: resources.materials.find(
            (x) => x.key === key && x.kind === "SEED",
          ).id,
          responsibleUserId: actor.id,
          cultivationMethod:
            "Canh tác quản lý tổng hợp, tưới nhỏ giọt, ghi nhật ký theo lô",
          note: "Vụ có ảnh chụp minh họa; không tuyên bố chứng nhận hoặc dữ liệu cảm biến vật lý thật.",
        },
        `cycle:${key}:${i}`,
      );
      cycles.push({ ...cycle, key });
      await evidence(
        key,
        "CYCLE",
        cycle.id,
        "CYCLE_IMAGE",
        "care",
      );
      if (i === farmProducts.length) continue;
      if (i === farmProducts.length + 2) {
        await api(
          actor,
          `/production-cycles/${cycle.id}/cancel`,
          {
            version: cycle.version,
            reason:
              "Hủy vụ  trước khi trồng do điều chỉnh kế hoạch canh tác.",
          },
          `cycle-cancel:${cycle.id}`,
        );
        continue;
      }
      let current = await db.productionCycle.findUniqueOrThrow({
        where: { id: cycle.id },
      });
      await api(
        actor,
        `/production-cycles/${cycle.id}/plant`,
        { version: current.version, plantedAt: day(-60) },
        `plant:${cycle.id}`,
      );
      if (i === farmProducts.length + 1) continue;
      const careEvidence = unwrap(
        await evidence(
          key,
          "CYCLE",
          cycle.id,
          "CARE_IMAGE",
          "care",
        ),
      );
      current = await db.productionCycle.findUniqueOrThrow({
        where: { id: cycle.id },
      });
      await api(
        actor,
        `/production-cycles/${cycle.id}/care`,
        {
          version: current.version,
          name: "Tưới nước và kiểm tra sinh trưởng tuần 5",
          careType: "Tưới nước / kiểm tra sâu bệnh",
          eventTime: day(-25),
          evidenceRef: careEvidence.id,
          method: "Tưới nhỏ giọt theo luống",
          cropCondition: "Lá xanh, cây sinh trưởng đồng đều (mô tả)",
          performerUserId: actor.id,
          note: "Ghi nhận minh họa, không phải tư vấn kỹ thuật.",
        },
        `care:${cycle.id}`,
      );
      if (i === 2) {
        const device = await api(
          actor,
          "/iot/devices",
          {
            organizationId: actor.organizationId,
            cycleId: cycle.id,
            deviceCode: `AGT-${key}-TEMP`,
            name: "Cảm biến nhiệt độ nhà màng (mô phỏng)",
            type: "TEMPERATURE",
          },
          `device:${cycle.id}`,
        );
        for (let d = 20; d >= 15; d--)
          await api(
            actor,
            `/production-cycles/${cycle.id}/sensor-readings`,
            {
              deviceId: device.id,
              sensorType: "TEMPERATURE",
              value: 22 + (d % 4) * 0.7,
              unit: "°C",
              recordedAt: day(-d),
            },
            `reading:${cycle.id}:${d}`,
          );
      }
      const harvestEvidence = unwrap(
        await evidence(
          key,
          "CYCLE",
          cycle.id,
          "HARVEST_IMAGE",
          `harvest${i % 3 === 0 ? "" : (i % 3) + 1}`,
        ),
      );
      const lotEvidence = unwrap(
        await evidence(
          key,
          "CYCLE",
          cycle.id,
          "LOT_IMAGE",
          product.slug,
        ),
      );
      for (let h = 0; h < 2; h++) {
        current = await db.productionCycle.findUniqueOrThrow({
          where: { id: cycle.id },
        });
        const receipt = await api(
          actor,
          `/production-cycles/${cycle.id}/harvests`,
          {
            version: current.version,
            lotName: `${product.productName} - đợt ${h + 1}`,
            representativeUserId: actor.id,
            evidenceRef: harvestEvidence.id,
            lotImageEvidenceRef: lotEvidence.id,
            quantity: 250 + h * 50,
            unit: "kg",
            harvestTime: day(h ? -7 : -14),
            lotCode: `AGT-${key.toUpperCase()}-${i}-${h + 1}`,
            grade: h ? "Loại 2" : "Loại 1",
            expiryDate: day(21).slice(0, 10),
            packaging: "Thùng nhựa thực phẩm 10 kg có tem lô",
            packageCount: 25 + h * 5,
            harvestArea: "6.000 m²",
            harvestMethod: "Thu hái thủ công, phân loại tại vườn",
            qualityNote:
              "Mô tả chất lượng; cần kiểm định thực tế trước sử dụng.",
            note: "Thu hoạch nhiều đợt giữ nguyên nguồn lô.",
            ...(allocated
              ? { initialStorageSiteId: resources.sites[key][1].id }
              : {}),
          },
          `harvest:${cycle.id}:${h}`,
        );
        lots.push({
          ...receipt.lot,
          key,
          cycleId: cycle.id,
          chainId: chain.id,
          traceToken: receipt.traceQr.traceToken,
          allocated,
          productSlug: product.slug,
        });
      }
      if (i % 3 === 0) {
        current = await db.productionCycle.findUniqueOrThrow({
          where: { id: cycle.id },
        });
        await api(
          actor,
          `/production-cycles/${cycle.id}/close`,
          { version: current.version },
          `cycle-close:${cycle.id}`,
        );
      }
    }
  }
  return { cycles, lots };
});

await step("first-login-delegation", async () => {
  const source = await db.enterpriseMemberRole.findFirstOrThrow({
    where: { userId: bootstrap.users.farmStaff.id },
  });
  await db.enterpriseMemberRole.upsert({
    where: {
      userId_roleId: {
        userId: bootstrap.users.firstlogin.id,
        roleId: source.roleId,
      },
    },
    create: {
      userId: bootstrap.users.firstlogin.id,
      organizationId: source.organizationId,
      roleId: source.roleId,
      chainIds: source.chainIds,
      siteIds: source.siteIds,
    },
    update: {},
  });
  return true;
});

const shipments = await step("shipments", async () => {
  const result = [];
  const legacy = production.lots.filter((l) => !l.allocated);
  for (let i = 0; i < Math.min(12, legacy.length); i++) {
    const lot = legacy[i],
      owner = actors[lot.key],
      path = `/supply-chains/${lot.chainId}/shipment-plans`;
    const plan = await api(
      owner,
      path,
      {
        lotId: lot.id,
        transporterOrgId: actors.carrier.organizationId,
        retailerOrgId: actors.retailer.organizationId,
        quantity: String(lot.availableQuantity),
        unit: "kg",
        origin: "Vùng sản xuất",
        destination: "Cửa hàng An Lành - TP. Hồ Chí Minh",
        vehicleRef: resources.vehicles[i % 3].registration,
      },
      `shipment-plan:${lot.id}`,
    );
    for (const [party, key] of [
      ["PRODUCER", lot.key],
      ["TRANSPORTER", "carrier"],
      ["RETAILER", "retailer"],
    ])
      await api(
        actors[key],
        `${path}/${plan.id}/accept`,
        {
          party,
          revision: plan.currentRevision,
          payloadDigest: plan.current.payloadDigest,
        },
        `plan-accept:${plan.id}:${party}`,
      );
    const finalized = await api(
      owner,
      `${path}/${plan.id}/finalize`,
      { version: plan.version },
      `plan-finalize:${plan.id}`,
    );
    const id = finalized.shipmentId;
    assert.ok(id, "Finalized plan must create a Shipment");
    result.push(id);
    if (i % 4 === 0) continue;
    let row = await db.shipment.findUniqueOrThrow({ where: { id } }),
      current = await db.lot.findUniqueOrThrow({ where: { id: lot.id } });
    await api(
      actors.carrier,
      `/shipments/${id}/start`,
      { version: row.version, lotVersion: current.version },
      `shipment-start:${id}`,
    );
    if (i % 4 === 1) continue;
    row = await db.shipment.findUniqueOrThrow({ where: { id } });
    current = await db.lot.findUniqueOrThrow({ where: { id: lot.id } });
    await api(
      actors.carrier,
      `/shipments/${id}/arrive`,
      { version: row.version, lotVersion: current.version },
      `shipment-arrive:${id}`,
    );
    if (i % 4 === 2) continue;
    row = await db.shipment.findUniqueOrThrow({ where: { id } });
    current = await db.lot.findUniqueOrThrow({ where: { id: lot.id } });
    await api(
      actors.retailer,
      `/shipments/${id}/receive`,
      {
        version: row.version,
        lotVersion: current.version,
        receivedQuantity: Number(current.availableQuantity),
        damagedQuantity: 0,
        note: "Đã nhận đủ số lượng; bảo quản mát.",
      },
      `shipment-receive:${id}`,
    );
  }
  return result;
});

const distributionKeys = await load("signing-keys", {});
async function signingKey(key) {
  if (!distributionKeys[key]) {
    const pair = generateKeyPairSync("ed25519");
    distributionKeys[key] = {
      id: randomUUID(),
      publicKey: pair.publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64url"),
      privateKey: pair.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    };
    await save("signing-keys", distributionKeys);
  }
  const value = distributionKeys[key],
    body = {
      id: value.id,
      organizationId: actors[key].organizationId,
      publicKey: value.publicKey,
    };
  const popSignature = sign(
    null,
    Buffer.from(`agritrace:distribution-key:1\0${canonical(body)}`),
    value.privateKey,
  ).toString("base64url");
  await api(
    actors[key],
    "/distribution/keys",
    {
      id: value.id,
      publicKey: value.publicKey,
      popSignature,
      label: "Khóa local - không phải khóa của doanh nghiệp thật",
    },
    `key:${key}`,
  );
  return value;
}
async function attest(id, key, phase) {
  const label = `attest:${id}:${key}:${phase}`;
  if (state.commands[label]?.complete) return state.commands[label].result;
  const pair = await signingKey(key),
    challenge = await api(
      actors[key],
      `/distribution/transfers/${id}/challenge`,
    );
  const t = await db.distributionTransfer.findUniqueOrThrow({ where: { id } });
  const expiresAt = new Date(Date.now() + 15 * 60000).toISOString();
  const body = {
    snapshotDigest: challenge.snapshotDigest,
    transferId: id,
    phase,
    organizationId: actors[key].organizationId,
    userId: actors[key].id,
    keyRef: pair.id,
    version: String(t.version),
    expiresAt,
  };
  const signature = sign(
    null,
    Buffer.from(`${challenge.domain}\0${canonical(body)}`),
    pair.privateKey,
  ).toString("base64url");
  return api(
    actors[key],
    `/distribution/transfers/${id}/sign`,
    { version: t.version, phase, keyRef: pair.id, expiresAt, signature },
    label,
  );
}
const transfers = await step("distribution", async () => {
  const result = [];
  const ingredientLots = processedProducts.map(p => production.lots.find(l => l.allocated && l.productSlug === p.source));
  const otherLots = production.lots.filter(l => l.allocated && !ingredientLots.some(x => x.id === l.id));
  const selected = [...ingredientLots, ...otherLots.slice(0,3)];
  for (let i = 0; i < selected.length; i++) {
    const lot = selected[i], receiver = i < 3 ? "processor" : i === 5 ? "retailer" : "distributor";
    const transfer = unwrap(
      await api(
        actors[lot.key],
        "/distribution/transfers",
        {
          chainId: lot.chainId,
          receiverId: actors[receiver].organizationId,
          carrierId: actors.carrier.organizationId,
          senderSiteId: resources.sites[lot.key][1].id,
          receiverSiteId: resources.sites[receiver][0].id,
          carrierSiteId: resources.sites.carrier[0].id,
          vehicleId: resources.vehicles[i % 3].id,
          origin: "Kho nguồn",
          destination: resources.sites[receiver][0].address,
          plannedPickupAt: new Date(Date.now() + 3600000).toISOString(),
          plannedDeliveryAt: new Date(Date.now() + 5 * 3600000).toISOString(),
          lines: [{ lotId: lot.id, quantity: "100.000", unit: "kg" }],
          note: "Chặng giao nhận, ký Ed25519 hai phía; không có proof Fabric.",
        },
        `transfer:${i}`,
      ),
    );
    result.push({ ...transfer, key: lot.key, receiver, lotId: lot.id, productSlug: lot.productSlug });
    if (i === 3) continue;
    for (const key of [lot.key, "carrier", receiver])
      await attest(transfer.id, key, "CONSENT");
    if (i === 4) continue;
    for (const key of [lot.key, "carrier"])
      await attest(transfer.id, key, "PICKUP");
    if (i === 5) continue;
    const row = await db.distributionTransfer.findUniqueOrThrow({
      where: { id: transfer.id },
      include: { lines: true },
    });
    await api(
      actors[receiver],
      `/distribution/transfers/${transfer.id}/receipt`,
      {
        version: row.version,
        lines: row.lines.map((l) => ({
          lotId: l.lotId,
          received: String(l.quantity),
          rejected: "0",
          quarantined: "0",
        })),
        reason: "Đã đối chiếu đủ số lượng và tình trạng hàng.",
      },
      `transfer-receipt:${transfer.id}`,
    );
    for (const key of ["carrier", receiver])
      await attest(transfer.id, key, "DELIVERY");
  }
  return result;
});

const processing = await step("processing", async () => {
  const result = [];
  for (const definition of processedProducts) {
    const product = await api(actors.processor, "/catalog/products", {
      productName:definition.name, sku:`MV-${definition.slug.toUpperCase()}`, category:definition.category,
      defaultUnit:"kg", variety:definition.variety, price:definition.price,
      storageConditions:definition.storage, ingredients:`100% ${definition.variety.toLowerCase()}`,
      rawMaterials:`${definition.variety} từ các lô nguồn có truy xuất`, usageInstructions:definition.usage,
      manufacturingSiteId:resources.sites.processor[0].id, managerUserId:actors.processor.id,
      distributor:bootstrap.orgs.distributor.name, carrier:bootstrap.orgs.carrier.name, description:definition.description,
    }, `processed-product:${definition.slug}`);
    await evidence("processor","PRODUCT",product.id,"PRODUCT_IMAGE",definition.slug);
    await api(actors.processor,`/catalog/products/${product.id}/complete`,{version:product.version},`processed-product-complete:${definition.slug}`);
    const source = transfers.find(t => t.receiver === "processor" && t.productSlug === definition.source);
    assert.ok(source, `Missing received ingredient ${definition.source}`);
    for(let i=0;i<3;i++) {
      // Kế hoạch (sản phẩm chính + nguyên liệu) → bắt đầu (giữ chỗ) → nhật ký → ra lò.
      const run = unwrap(await api(actors.processor,"/processing-runs",{
        chainId:source.chainId,siteId:resources.sites.processor[0].id,productId:product.id,baseUnit:"kg",processType:"DRYING",
        recipe:"Tiếp nhận, phân loại, sơ chế, sấy theo mẻ và đóng gói kín.",
        inputs:[{lotId:source.lotId,quantity:i===0?"50.000":"10.000"}],externalInputs:[],
        note:"Đối soát khối lượng nguyên liệu, thành phẩm và hao hụt theo mẻ.",
      },`processing:${definition.slug}:${i}`));
      result.push(run);
      if(i===0) {
        const started = unwrap(await api(actors.processor,`/processing-runs/${run.id}/start`,{version:run.version},`processing-start:${run.id}`));
        for (const [n,[step,note]] of [["SORTING","Phân loại, loại bỏ quả dập."],["DRYING","Sấy 60°C trong 8 giờ, độ ẩm còn khoảng 12%."],["PACKING","Đóng túi kín 200 g, dán tem truy xuất."]].entries())
          await api(actors.processor,`/processing-runs/${run.id}/logs`,{step,occurredAt:new Date(Date.now()+n*1000).toISOString(),note},`processing-log:${run.id}:${n}`);
        await api(actors.processor,`/processing-runs/${run.id}/complete`,{
          version:started.version,
          output:{quantity:"12.000",unit:"kg",lotName:`${definition.name} - mẻ ${i+1}`,packaging:"Túi kín 200 g",packageCount:60,expiryDate:day(180).slice(0,10)},
          byProducts:[],
          losses:[{reason:"MOISTURE",quantity:"38.000",note:"Nước thoát ra trong quá trình sấy và phần sơ chế"}],
        },`processing-complete:${run.id}`);
      }
      if(i===2) await api(actors.processor,`/processing-runs/${run.id}/cancel`,{version:run.version,reason:"Điều chỉnh lịch sản xuất, chưa thực hiện cấp phát nguyên liệu."},`processing-cancel:${run.id}`);
    }
  }
  return result;
});

await step("compliance", async () => {
  for (const lot of production.lots.filter((x) => x.allocated)) {
    await api(
      actors.reviewer,
      "/inspections",
      {
        lotId: lot.id,
        result: "PASS",
        inspectedAt: day(-1),
        note: "Kiểm tra bởi tài khoản được phân công độc lập; không phải chứng thư kiểm định thật.",
      },
      `inspection:${lot.id}`,
    );
  }
  const warning = production.lots.filter((l) => l.allocated).at(-1);
  await api(
    actors[warning.key],
    "/distribution/notices",
    {
      lotId: warning.id,
      kind: "WARNING",
      message:
        "DỮ LIỆU AGT: kiểm tra bao bì và bảo quản theo nhãn; ảnh chụp chỉ có tính minh họa.",
    },
    `notice:${warning.id}`,
  );
  const recalled = production.lots.filter((l) => !l.allocated).at(-1);
  await api(
    actors[recalled.key],
    "/distribution/notices",
    {
      lotId: recalled.id,
      kind: "RECALL",
      message:
        "Tạm dừng lưu thông lô để kiểm tra tình trạng bao bì và đối chiếu chất lượng tại điểm nhận.",
    },
    `recall:${recalled.id}`,
  );
  const lotRow = await db.lot.findUniqueOrThrow({ where: { id: warning.id } });
  await api(
    actors[warning.key],
    "/distribution/quarantine",
    {
      lotId: warning.id,
      quantity: "10.000",
      unit: "kg",
      siteId: resources.sites[warning.key][1].id,
      version: lotRow.version,
      reason: "Cách ly một phần hàng để chờ kiểm tra bao bì.",
      action: "HOLD",
      cause: "AWAITING_INSPECTION",
      note: "Không thay đổi lịch sử quyền giữ hàng.",
    },
    `quarantine:${warning.id}`,
  );
  return true;
});

await step("billing-reference-correction", async () => {
  const plan = await db.servicePlanVersion.findFirstOrThrow({
    where: { planCode: "TRACE_20", status: "PUBLISHED" },
  });
  await db.$transaction(async (tx) => {
    await lockPlatformAudit(tx);
    const invalid = await tx.subscription.findMany({
      where: {
        status: "ACTIVE",
        planVersion: { planCode: "CHAIN_PRO" },
        organization: { participationModel: "SINGLE" },
      },
    });
    for (const old of invalid) {
      const reason =
        "Điều chỉnh gói khởi tạo theo mô hình SINGLE: hủy snapshot gói không phù hợp và tạo snapshot đúng, không ghi thanh toán thật.";
      await tx.subscription.update({
        where: { id: old.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelReason: reason,
          version: { increment: 1 },
        },
      });
      const current = await tx.subscription.create({
        data: {
          organizationId: old.organizationId,
          planVersionId: plan.id,
          status: "ACTIVE",
          startsAt: old.startsAt,
          endsAt: old.endsAt,
        },
      });
      await appendPlatformAudit(tx, {
        actor: { sub: actors.admin.id, role: "SYSTEM_ADMIN" },
        action: "SEED_REFERENCE_CORRECTED",
        subjectType: "SUBSCRIPTION",
        subjectId: current.id,
        organizationId: old.organizationId,
        reason,
        details: {
         synthetic: true,
          cancelledSnapshotId: old.id,
          planCode: "TRACE_20",
        },
      });
    }
  });
  return true;
});

await step("administration", async () => {
  for (let i = 0; i < 7; i++) {
    const key = [
      "farm",
      "berry",
      "garden",
      "carrier",
      "distributor",
      "retailer",
      "processor",
    ][i];
    const t = unwrap(
      await api(
        actors[key],
        "/enterprise-support/tickets",
        {
          category: [
            "ACCOUNT",
            "BILLING",
            "TECHNICAL",
            "TRACEABILITY",
            "BLOCKCHAIN",
            "PROCESSING",
            "OTHER",
          ][i],
          priority: ["LOW", "NORMAL", "HIGH", "URGENT"][i % 4],
          subject: [
            "Hướng dẫn phân quyền quản lý vùng",
            "Cần đối chiếu gói dịch vụ",
            "Hỗ trợ quản lý nhật ký chăm sóc",
            "Kiểm tra chặng giao nhận lạnh",
            "Hỏi trạng thái bằng chứng blockchain",
            "Hỗ trợ tra cứu tem hàng nhận",
            "Cần hướng dẫn cân bằng khối lượng chế biến",
          ][i],
          body: "Yêu cầu hỗ trợ trong hồ sơ. Vui lòng hướng dẫn thao tác và kiểm tra thông tin liên quan. Không có dữ liệu khách hàng thật.",
        },
        `ticket:${key}`,
      ),
    );
    if (i === 0) continue;
    let row = await db.supportTicket.findUniqueOrThrow({ where: { id: t.id } });
    await api(
      actors.admin,
      `/platform-admin/tickets/${t.id}/assign`,
      { version: row.version, assigneeId: actors.cases.id },
      `ticket-assign:${t.id}`,
    );
    row = await db.supportTicket.findUniqueOrThrow({ where: { id: t.id } });
    await api(
      actors.cases,
      `/platform-admin/tickets/${t.id}/reply`,
      {
        version: row.version,
        body: "AgriTrace đã tiếp nhận yêu cầu. Hướng dẫn đã được đối chiếu với chức năng hiện hành; vui lòng kiểm tra lại dữ liệu.",
        status: ["IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED"][(i - 1) % 3],
      },
      `ticket-reply:${t.id}`,
    );
    if (i === 6) {
      row = await db.supportTicket.findUniqueOrThrow({ where: { id: t.id } });
      await api(
        actors.admin,
        `/platform-admin/tickets/${t.id}/close`,
        {
          version: row.version,
          reason: "Đã hoàn tất hướng dẫn và xác nhận đóng yêu cầu hỗ trợ.",
        },
        `ticket-close:${t.id}`,
      );
    }
  }
  for (let i = 0; i < 3; i++)
    await api(
      actors.admin,
      "/platform-admin/notices",
      {
        title: [
          "Dữ liệu trải nghiệm AgriTrace",
          "Hướng dẫn bảo quản và giao nhận",
          "Lịch kiểm tra hệ thống ",
        ][i],
        body: "Thông báo trong hồ sơ: mọi tổ chức và thông tin nghiệp vụ là tham khảo. Ảnh stock có giấy phép; Fabric đang tắt, không có proof mạng thật.",
        audience: i ? "ENTERPRISE" : "ALL",
        severity: ["INFO", "WARNING", "MAINTENANCE"][i],
        startsAt: day(-1),
        endsAt: day(30),
      },
      `system-notice:${i}`,
    );
  for (let i = 0; i < 3; i++)
    await api(
      actors.cases,
      "/platform-cases",
      {
        title: `Đối soát thông tin lô ${i + 1}`,
        description:
          "Hồ sơ sự cố dùng để minh họa giao việc và hội thoại; không tự thay đổi quyền giữ hàng hoặc trạng thái chất lượng.",
        category: ["QUALITY", "LABELING", "OTHER"][i],
        severity: ["LOW", "MEDIUM", "HIGH"][i],
        source: "INTERNAL",
        lotId: production.lots[i].id,
        responseDueAt: day(3),
      },
      `platform-case:${i}`,
    );
  for (const key of ["farm", "berry", "garden"])
    await api(
      actors[key],
      "/enterprise-billing/renewals",
      { planCode: "TRACE_20" },
      `renewal-invoice-valid:${key}`,
    );
  return true;
});

await step("public-media", async () => {
  for (const lot of production.lots)
    await evidence(
      lot.key,
      "LOT",
      lot.id,
      "LOT_IMAGE",
      lot.productSlug,
      "public",
    );
  return true;
});

await step("onboarding-profiles", async () => {
  for (const key of ["pending", "rejected"]) {
    const actor = bootstrap.users[key];
    await db.enterpriseProfile.upsert({
      where: { organizationId: actor.organizationId },
      update: {},
      create: {
        organizationId: actor.organizationId,
        legalForm: "COOPERATIVE",
        address: "Khu sản xuất, Đức Trọng, Lâm Đồng",
        province: "Lâm Đồng",
        ward: "Đức Trọng",
        phone: "0900000000",
        contactEmail: `${key}.contact@example.test`,
        representative: actor.fullName,
        activities: ["FARM"],
        description:
          "Hồ sơ đầy đủ thông tin liên hệ để xem quy trình xét duyệt. Chứng từ và pháp nhân không có giá trị ngoài hồ sơ.",
        declarationAcceptedAt: now,
        legalData: {
          registrationNumber: `AGT-${key}`,
          taxCode: `AGT-${key}`,
          issuedBy: "Cơ quan ",
        },
        registrationData: {
         synthetic: true,
          registrationRole: "PRODUCER",
          production: { type: "CROP", areaM2: 5000 },
          servicePreferences: ["TRACEABILITY"],
          marketingAccepted: false,
        },
      },
    });
  }
  // These are explicit initial snapshots for the's onboarding queue.
  // They carry no business capabilities, ledger binding, payment receipt or proof.
  for (const stage of [
    "approved",
    "awaiting-payment",
    "paid-awaiting-activation",
  ]) {
    const email = `${stage}.owner@example.test`;
    if (await db.user.findFirst({ where: { email } })) continue;
    const password = `Agri!${randomBytes(18).toString("base64url")}9a`,
      passwordHash = await hash(password, 10);
    const plan = await db.servicePlanVersion.findFirstOrThrow({
      where: { planCode: "TRACE_20", status: "PUBLISHED" },
    });
    const user = await db.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: `HTX ${stage} `, type: "FARM" },
      });
      await tx.organizationCapability.deleteMany({
        where: { organizationId: org.id },
      });
      const role = await tx.role.findUniqueOrThrow({
        where: { code: "FARM_STAFF" },
      });
      const user = await tx.user.create({
        data: {
          email,
          fullName: `Chủ hồ sơ ${stage}`,
          phone: "0900000000",
          jobTitle: "Chủ quản",
          passwordHash,
          passwordChangedAt: now,
          organizationId: org.id,
          roleId: role.id,
          enterpriseTier: 1,
        },
      });
      const enrollment = await tx.enterpriseEnrollment.create({
        data: {
          id: randomUUID(),
          organizationId: org.id,
          ownerId: user.id,
          registrationDigest: digest(org.id),
          businessId: `AGT-${stage}`,
          hostingMode: "MANAGED_ORG",
          status: "APPROVED",
          reviewedBy: actors.admin.id,
          reviewNote:
            "Hồ sơ đã duyệt, đang ở bước dịch vụ; chưa có quyền nghiệp vụ.",
        },
      });
      await tx.enterpriseProfile.create({
        data: {
          organizationId: org.id,
          legalForm: "COOPERATIVE",
          address: "Khu sản xuất, Đức Trọng, Lâm Đồng",
          province: "Lâm Đồng",
          ward: "Đức Trọng",
          phone: "0900000000",
          contactEmail: `${stage}.contact@example.test`,
          representative: user.fullName,
          activities: ["FARM"],
          declarationAcceptedAt: now,
          description: "Hồ sơ minh họa các giai đoạn xét duyệt và dịch vụ.",
          legalData: {synthetic: true, registrationNumber: `AGT-${stage}` },
          registrationData: {
           synthetic: true,
            registrationRole: "PRODUCER",
            servicePreferences: ["TRACEABILITY"],
          },
        },
      });
      if (stage !== "approved") {
        const contractText = `AGRITRACE AGT - Hợp đồng trải nghiệm không có giá trị pháp lý. Gói ${plan.planCode}, thời hạn ${plan.termMonths} tháng, phí thiết lập ${plan.setupFee} VND, phí năm ${plan.annualFee} VND. Không có thanh toán thật hoặc chữ ký số chứng thực.`;
        const order = await tx.enterpriseServiceOrder.create({
          data: {
            enrollmentId: enrollment.id,
            planCode: plan.planCode,
            hostingMode: "MANAGED_ORG",
            billingEmail: email,
            billingName: org.name,
            billingAddress: "Đức Trọng, Lâm Đồng ",
            amount: Number(plan.setupFee + plan.annualFee),
            quotation: {
             synthetic: true,
              planCode: plan.planCode,
              planVersionId: plan.id,
              setup: Number(plan.setupFee),
              annual: Number(plan.annualFee),
              termMonths: plan.termMonths,
            },
            contractText,
            contractDigest: digest(contractText),
            status: "AWAITING_PAYMENT",
            acceptedAt: now,
          },
        });
        if (stage === "paid-awaiting-activation")
          await tx.enterpriseServiceOrder.update({
            where: { id: order.id },
            data: { status: "PAID_SIMULATED", paidAt: now, version: 1 },
          });
      }
      return user;
    });
    accounts.users.push({
      email,
      password,
      fullName: user.fullName,
      role: "FARM_STAFF",
      organizationId: user.organizationId,
      tier: 1,
      accountStatus: "ACTIVE",
      mustChangePassword: false,
      stage,
    });
    await save("accounts", accounts);
  }
  return true;
});

await step("privacy", async () => {
  for (const [i, key] of ["farm", "berry", "retailer"].entries())
    await api(
      actors[key],
      "/privacy-requests",
      {
        requestType: ["ACCESS", "CORRECTION", "RESTRICTION"][i],
        message:
          "Yêu cầu quyền dữ liệu trong môi trường: vui lòng cung cấp hướng dẫn kiểm tra thông tin hồ sơ và phạm vi chia sẻ. Không có thông tin cá nhân thật.",
      },
      `privacy-request:${key}`,
    );
  await api(
    actors.privacy,
    "/platform-privacy/breaches",
    {
      detectedAt: new Date(Date.now() - 3600000).toISOString(),
      message:
        "Diễn tập hồ sơ riêng tư trong hồ sơ; không phải sự cố rò rỉ thực tế và không gửi báo cáo ra ngoài.",
    },
    "privacy-demo-breach",
  );
  return true;
});

await step("certificates-and-amendment", async () => {
  for (const [i, key] of ["farm", "berry", "garden"].entries()) {
    const cycle = production.cycles.filter((x) => x.key === key)[2],
      farm = resources.farms.find((x) => x.key === key);
    const document = unwrap(await evidence(key,"CYCLE",cycle.id,"CERTIFICATE_IMAGE","reference-cert"));
    const cert = await api(
      actors[key],
      "/certificates",
      {
        cycleId: cycle.id,
        type: "Hồ sơ kiểm soát nội bộ vùng sản xuất",
        issuer: "Đơn vị chứng nhận tham khảo (không phải chứng nhận thật)",
        issueDate: day(-1).slice(0, 10),
        expiryDate: day(180).slice(0, 10),
        isPublic: false,
        documentRef: `/enterprise-workspace/evidence/${document.id}/file`,
        documentHash: document.sha256,
      },
      `demo-certificate:${key}`,
    );
    if (i !== 1)
      await api(
        actors.reviewer,
        `/certificates/${cert.id}/review`,
        {
          version: cert.version,
          status: i === 0 ? "APPROVED" : "REJECTED",
          reviewNote:
            "Quy trình review độc lập. Hồ sơ không có giá trị kiểm định hoặc chứng nhận thật.",
        },
        `demo-certificate-review:${key}`,
        "PATCH",
      );
  }
  const profile = await db.enterpriseProfile.findUniqueOrThrow({
    where: { organizationId: actors.farm.organizationId },
  });
  await api(
    actors.farm,
    "/enterprise-workspace/profile/contact",
    {
      version: profile.version,
      reason:
        "Đề nghị điều chỉnh thông tin liên hệ trong hồ sơ để minh họa hàng chờ xét duyệt.",
      phone: "0900000022",
      contactEmail: "farm.updated@example.test",
      website: "https://farm.example.test",
      description: profile.description,
    },
    "demo-contact-amendment",
  );
  return true;
});

const retailDelivery = await step("retail-delivery", async () => {
  const lot = production.lots.filter((l) => l.allocated)[4],
    key = lot.key;
  const transfer = unwrap(
    await api(
      actors[key],
      "/distribution/transfers",
      {
        chainId: lot.chainId,
        receiverId: actors.retailer.organizationId,
        carrierId: actors.carrier.organizationId,
        senderSiteId: resources.sites[key][1].id,
        receiverSiteId: resources.sites.retailer[0].id,
        carrierSiteId: resources.sites.carrier[0].id,
        vehicleId: resources.vehicles[0].id,
        origin: resources.sites[key][1].address,
        destination: resources.sites.retailer[0].address,
        plannedPickupAt: new Date(Date.now() + 3600000).toISOString(),
        plannedDeliveryAt: new Date(Date.now() + 5 * 3600000).toISOString(),
        lines: [{ lotId: lot.id, quantity: "100.000", unit: "kg" }],
        note: "Lô giao tới cửa hàng, ghi nhận bán một phần qua API.",
      },
      "retail-transfer",
    ),
  );
  for (const who of [key, "carrier", "retailer"])
    await attest(transfer.id, who, "CONSENT");
  for (const who of [key, "carrier"]) await attest(transfer.id, who, "PICKUP");
  const row = await db.distributionTransfer.findUniqueOrThrow({
    where: { id: transfer.id },
  });
  await api(
    actors.retailer,
    `/distribution/transfers/${transfer.id}/receipt`,
    {
      version: row.version,
      lines: [
        { lotId: lot.id, received: "100.000", rejected: "0", quarantined: "0" },
      ],
      reason: "Nhận đủ hàng tại cửa hàng, đối chiếu hai phía.",
    },
    "retail-receipt",
  );
  for (const who of ["carrier", "retailer"])
    await attest(transfer.id, who, "DELIVERY");
  const current = await db.lot.findUniqueOrThrow({ where: { id: lot.id } });
  await api(
    actors.retailer,
    "/distribution/quantities",
    {
      lotId: lot.id,
      quantity: "25.000",
      unit: "kg",
      version: current.version,
      kind: "SALE",
      siteId: resources.sites.retailer[0].id,
      reason: "Bán lẻ một phần lô; không có thanh toán thật.",
    },
    "retail-sale",
  );
  return transfer;
});

await step("processed-public-media", async () => {
  for (const lot of await db.lot.findMany({
    where: { originType: "TRANSFORMATION" },
  }))
    await evidence(
      "processor",
      "LOT",
      lot.id,
      "LOT_IMAGE",
      processedProducts.find(p => p.name === lot.lotName?.split(" - mẻ")[0])?.slug ?? (await db.product.findUniqueOrThrow({where:{id:lot.productId}})).sku.replace("MV-", "").toLowerCase(),
      "public",
    );
  return true;
});

await step("consumer-accounts", async () => {
  const locations = JSON.parse(await readFile(new URL("../../apps/api/dist/common/locations/vietnam.json", import.meta.url),"utf8"));
  const province=locations.provinces[0],ward=province.wards[0];
  const role=await db.role.findUniqueOrThrow({where:{code:"CONSUMER"}});
  for(const [i,fullName] of ["Nguyễn Ngọc Hà","Trần Minh Châu","Lê Hoàng Phúc"].entries()) {
    const loginPhone=`+8490000010${i}`, email=`${loginPhone.slice(1)}@phone.invalid`;
    await ensureSeedAccount({records:accounts.users,key:loginPhone,
      lookup:()=>db.user.findUnique({where:{loginPhone}}),
      generate:()=>({email,phone:loginPhone,password:`Agri!${randomBytes(18).toString("base64url")}9a`,fullName,role:"CONSUMER",organizationId:null,tier:null,accountStatus:"ACTIVE",mustChangePassword:false}),
      persist:()=>save("accounts",accounts),
      create:async record=>db.user.create({data:{email,loginPhone,phone:loginPhone,fullName,passwordHash:await hash(record.password,12),passwordChangedAt:now,roleId:role.id,
        consumerProfile:{create:{provinceCode:province.code,provinceName:province.label,wardCode:ward.code,wardName:ward.label,contactEmail:`consumer${i+1}@example.test`,businessAddress:`${12+i*8} đường Hoàng Hoa Thám`,consentVersion:"DEV-CONSUMER-TEST-20261020"}}}}),
    });
  }
  return true;
});

await step("organization-media", async () => {
  for (const key of ["farm","berry","garden","carrier","distributor","retailer","processor"])
    await evidence(key,"PROFILE",actors[key].organizationId,"OTHER",`logo-${key}`);
  return true;
});

await step("cycle-team", async () => {
  for (const cycle of production.cycles)
    await api(actors[cycle.key],`/production-cycles/${cycle.id}/staff`,{staffUserIds:[actors[cycle.key].id,bootstrap.users[`${cycle.key}Manager`].id,bootstrap.users[`${cycle.key}Staff`].id]},`cycle-team:${cycle.id}`);
  return true;
});

await step("directory-publication",()=>publishDirectoryProfiles(db));

await step("consumer-content", async () => {
  for (const [i,title] of ["Đọc thông tin nguồn gốc trên tem QR","Bảo quản trái cây sau khi nhận hàng","Theo dõi hành trình từ vùng trồng đến cửa hàng","Phân biệt lô nguồn và mẻ chế biến","Kiểm tra bao bì trước khi sử dụng","Ghi nhật ký chăm sóc theo vụ"].entries()) {
    const id = seedContentId(state.startedAt,`news-${i}`);
    await db.consumerNews.upsert({where:{id},update:{},create:{id,title,summary:"Hướng dẫn kiểm tra thông tin sản phẩm, bảo quản và đối chiếu nguồn gốc theo mã lô.",body:"Mỗi lô hàng có mã truy xuất riêng. Người mua có thể quét mã trên tem để xem đơn vị sản xuất, ngày thu hoạch, lịch sử giao nhận và các cảnh báo hiện hành. Kiểm tra nhãn, bao bì và điều kiện bảo quản trước khi sử dụng.",isPublished:true,publishedAt:new Date(day(-i-1))}});
  }
  const id=seedContentId(state.startedAt,"announcement");
  await db.consumerAnnouncement.upsert({where:{id},update:{},create:{id,title:"Kiểm tra mã lô khi nhận hàng",body:"Quét mã QR trên tem để đối chiếu tên sản phẩm, ngày thu hoạch và thông tin giao nhận.",severity:"INFO",isActive:true,startsAt:new Date(day(-2)),endsAt:new Date(day(60))}});
  return true;
});

await step("notice-copy", async () => {
  for (const notice of await db.systemNotice.findMany({
    where: { status: "PUBLISHED" },
  }))
    await api(
      actors.admin,
      `/platform-admin/notices/${notice.id}/withdraw`,
      {
        version: notice.version,
        reason:
          "Điều chỉnh thông báo của hồ sơ để chỉ hiển thị hướng dẫn trải nghiệm cần thiết.",
      },
      `withdraw-seed-notice:${notice.id}`,
    );
  await api(
    actors.admin,
    "/platform-admin/notices",
    {
      title: "Thông tin vận hành AgriTrace",
      body: "Tra cứu nguồn gốc bằng mã QR trên tem hàng. Thành viên đăng nhập để cập nhật nhật ký, quản lý lô và đối chiếu giao nhận theo phạm vi được phân công.",
      audience: "ALL",
      severity: "INFO",
      startsAt: day(-1),
      endsAt: day(30),
    },
    "sample-environment-notice",
  );
  return true;
});

await save("dataset", {
  bootstrap,
  resources,
  chains,
  production,
  shipments,
  transfers,
  processing,
  retailDelivery,
});
console.log("Domain dataset stages completed.");
await save("processed-traces", await db.$queryRaw`
  SELECT q.lot_id AS "lotId", q.trace_token AS "traceToken"
  FROM trace_qr q JOIN lot l ON q.lot_id=l.lot_id
  WHERE l.origin_type='TRANSFORMATION'
`);
await db.$disconnect();
