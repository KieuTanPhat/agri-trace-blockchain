// Local operator seed. Run only through seed-current.ps1 after its backup/target checks.
import assert from "node:assert/strict";
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

const root = fileURLToPath(new URL("../../", import.meta.url));
const local = `${root}.codex/seed-current`;
const assets = `${root}scripts/demo/assets`;
const url = new URL(process.env.DATABASE_URL);
assert.equal(
  process.env.AGRITRACE_LOCAL_SEED_TARGET,
  "agri-trace-demo-local/agri_trace",
);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "5433");
assert.equal(url.pathname, "/agri_trace");
assert.equal(process.env.FABRIC_ENABLED, "false");
assert.match(
  process.env.PUBLIC_TRACE_BASE_URL,
  /^http:\/\/localhost:3000\/trace\/?$/,
);
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url.href }),
});
process.on("unhandledRejection", async (error) => {
  console.error(error.message);
  await db.$disconnect();
  process.exitCode = 1;
});
const base = "http://127.0.0.1:8080/api";
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
  assert.ok(bytes.length > 10000 && bytes.length < 5e6);
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
    "HTX Nông sản Bình Minh (Demo)",
    "FARM",
    "FARM_STAFF",
    "Lâm Đồng",
    "Đơn Dương",
  ],
  [
    "berry",
    "Nông trại Dâu Cao Nguyên (Demo)",
    "FARM",
    "FARM_STAFF",
    "Lâm Đồng",
    "Đà Lạt",
  ],
  [
    "garden",
    "HTX Vườn Xanh Sông Hồng (Demo)",
    "FARM",
    "FARM_STAFF",
    "Hà Nội",
    "Đông Anh",
  ],
  [
    "carrier",
    "Vận tải Lạnh An Tâm (Demo)",
    "TRANSPORTER",
    "TRANSPORTER",
    "TP. Hồ Chí Minh",
    "Thủ Đức",
  ],
  [
    "distributor",
    "Phân phối Nông sản Việt (Demo)",
    "DISTRIBUTOR",
    "DISTRIBUTOR",
    "TP. Hồ Chí Minh",
    "Thủ Đức",
  ],
  [
    "retailer",
    "Cửa hàng Thực phẩm An Lành (Demo)",
    "RETAILER",
    "RETAILER",
    "TP. Hồ Chí Minh",
    "Bến Thành",
  ],
  [
    "processor",
    "Chế biến Nông sản Mùa Vàng (Demo)",
    "PROCESSOR",
    "PROCESSOR",
    "Lâm Đồng",
    "Đức Trọng",
  ],
  [
    "auditor",
    "Trung tâm Kiểm định Độc lập (Demo)",
    "AUDITOR",
    "AUDITOR",
    "TP. Hồ Chí Minh",
    "Tân Bình",
  ],
];
let accounts = await load("accounts", null);
const bootstrap = await step("bootstrap", async () => {
  assert.equal(
    await db.user.count(),
    0,
    "Reset must be performed by the operator wrapper first",
  );
  accounts = {
    createdAt: now.toISOString(),
    warning: "Local demo credentials. Never commit, publish or email.",
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
        ["admin", "SYSTEM_ADMIN", "Nguyễn Minh An - Quản trị demo"],
        ["checker", "SYSTEM_ADMIN", "Trần Gia Hân - Phê duyệt demo"],
        ["operator", "PLATFORM_OPERATOR", "Lê Tuấn Khang - Vận hành demo"],
        ["cases", "PLATFORM_CASE_MANAGER", "Phạm Ngọc Mai - Hỗ trợ demo"],
        ["privacy", "PLATFORM_PRIVACY_OFFICER", "Võ Khánh Linh - Dữ liệu demo"],
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
          `${name} - Nguyễn An`,
          roleCode,
          {
            organizationId: organization.id,
            enterpriseTier: 1,
            memberCode: "NV0001",
            jobTitle: "Chủ quản doanh nghiệp",
            contactAddress: `${ward}, ${province}`,
            memberNote:
              "Tài khoản và thông tin giả lập được tạo cho demo local.",
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
            "Nguyễn Thu Hà - Kiểm định độc lập demo",
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
            businessId: `DEMO-2026-${String(i + 1).padStart(4, "0")}`,
            hostingMode: i % 2 ? "SELF_MANAGED_ORG" : "MANAGED_ORG",
            status: "APPROVED",
            activationRequired: true,
            serviceActivatedAt: now,
            serviceActivatedBy: result.users.admin.id,
            serviceActivationReason:
              "Khởi tạo dataset local được chủ dự án cho phép; không phải nghiệm thu Fabric.",
            reviewedBy: result.users.admin.id,
            reviewNote: "Hồ sơ demo đã duyệt; không phải pháp nhân thật.",
          },
        });
        await tx.enterpriseProfile.create({
          data: {
            organizationId: organization.id,
            legalForm: type === "FARM" ? "COOPERATIVE" : "ENTERPRISE",
            address: `Khu nông nghiệp mẫu ${i + 1}, ${ward}, ${province}`,
            province,
            ward,
            phone: `0287300000${i}`,
            contactEmail: `${key}.contact@example.test`,
            representative: `${owner.fullName}`,
            activities: caps,
            website: `https://${key}.example.test`,
            description: `${name}: ${type === "FARM" ? "Trồng trọt có nhật ký chăm sóc, thu hoạch theo lô và kiểm soát chất lượng." : "Đối tác trong chuỗi nông sản mẫu, lưu đầy đủ thông tin và chứng từ giao nhận."} Dữ liệu demo, không đại diện pháp nhân có thật.`,
            declarationAcceptedAt: now,
            legalData: {
              registrationNumber: `DEMO-DKKD-${i + 1}`,
              taxCode: `DEMO-MST-${i + 1}`,
              representative: owner.fullName,
              position: "Giám đốc",
              issuedBy: "Cơ quan đăng ký mẫu - không có giá trị pháp lý",
              issuedAt: "2025-01-15",
            },
            registrationData: {
              schemaVersion: 2,
              demo: true,
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
              policyVersion: "DEMO-2026-10",
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
            `Trần Quang Minh - ${name}`,
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
            `Lê Thảo Vy - ${name}`,
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
            name: `Doanh nghiệp ${key === "pending" ? "Chờ duyệt" : "Bị từ chối"} (Demo)`,
            type: "FARM",
          },
        });
        await tx.organizationCapability.deleteMany({
          where: { organizationId: org.id },
        });
        const owner = await makeUser(
          tx,
          `${key}.owner@example.test`,
          `Chủ hồ sơ ${key} demo`,
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
            businessId: `DEMO-${key}`,
            status,
            activationRequired: true,
            ...(key === "rejected"
              ? {
                  reviewedBy: result.users.admin.id,
                  reviewNote: "Hồ sơ demo thiếu chứng từ; bổ sung rồi gửi lại.",
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
          `Tài khoản ${key} demo`,
          "FARM_STAFF",
          {
            organizationId: result.orgs.farm.id,
            enterpriseTier: 3,
            supervisorId: result.users.farmManager.id,
            ...fields,
          },
        );
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
    `Ảnh chụp minh họa dataset demo; không phải ảnh tại doanh nghiệp hoặc chứng nhận thật. ${asset.author}; ${asset.source}; Unsplash License.`,
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
      `Evidence ${type}/${kind}: ${response.status} ${JSON.stringify(result.message).slice(0, 900)}`,
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
            address: `Khu sản xuất mẫu ${j + 1}, Đức Trọng, Lâm Đồng`,
            manager: actors[key].fullName,
            representative: actors[key].fullName,
            phone: "0900000000",
            email: `${key}.site${j}@example.test`,
            staffUserId: actors[key].id,
            otherInfo:
              "Cơ sở demo: kiểm soát vệ sinh, phân khu tiếp nhận và bảo quản; ảnh stock minh họa.",
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
            registration: `DEMO-51D-${String(12001 + i)}`,
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
              i === 1 ? "Giống dâu tây Nhật" : "Hạt giống cà chua bi",
              "Phân hữu cơ vi sinh",
              "Chế phẩm sinh học phòng sâu",
            ][j],
            kind: ["SEED", "FERTILIZER", "PROTECTION"][j],
            unit: j ? "kg" : "g",
            code: `${key.toUpperCase()}-VT-${j + 1}`,
            supplier: "Nhà cung cấp Nông nghiệp Xanh (Demo)",
            manufacturer: "Cơ sở vật tư mẫu",
            batchCode: `DEMO-VT-2026-${i}${j}`,
            origin: "Việt Nam (dữ liệu demo)",
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
          "Vùng cà chua Bình Minh",
          "Vườn dâu Cao Nguyên",
          "Vùng cà chua Sông Hồng",
        ][i],
        kind: "CROP",
        region: i === 2 ? "Hà Nội" : "Lâm Đồng",
        address:
          i === 2
            ? "Khu canh tác mẫu, Đông Anh, Hà Nội"
            : "Khu canh tác mẫu, Đơn Dương, Lâm Đồng",
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
          "Vùng demo có phân lô, nhật ký tưới/chăm sóc, thu hoạch theo đợt; chứng từ mẫu không có giá trị pháp lý.",
      },
      `farm:${key}`,
    );
    for (const kind of ["AREA_IMAGE", "INSPECTION_IMAGE"])
      await evidence(
        key,
        "FARM",
        farm.id,
        kind,
        i === 1 ? "berry3" : "tomatoField",
      );
    // Legal documents are explicitly watermarked demo samples, never stock photos masquerading as certificates.
    for (const kind of [
      "LAND_CERTIFICATE",
      "PRODUCTION_CONTRACT",
      "QUALITY_CERTIFICATE",
    ]) {
      const label = `document:${farm.id}:${kind}`;
      if (!state.commands[label]?.complete) {
        const bytes = await readFile(`${assets}/demo-${kind}.jpg`);
        const form = new FormData();
        form.set("entityType", "FARM");
        form.set("entityId", farm.id);
        form.set("kind", kind);
        form.set(
          "description",
          "DEMO - Hồ sơ mẫu cho phần mềm, không có giá trị pháp lý, không chứng nhận chất lượng hoặc quyền sử dụng đất.",
        );
        form.set(
          "file",
          new Blob([bytes], { type: "image/jpeg" }),
          `DEMO-${kind}.jpg`,
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
            location: "Phân khu demo, tưới nhỏ giọt, có rãnh thoát nước",
          },
          `plot:${key}:${j}`,
        )),
        key,
      });
    for (let j = 0; j < 3; j++) {
      const product = await api(
        actor,
        "/catalog/products",
        {
          productName: `${i === 1 ? "Dâu tây Nhật" : "Cà chua bi"} ${["loại 1", "đóng hộp 500 g", "tuyển chọn"][j]}`,
          variety: i === 1 ? "Dâu Nhật" : "Cà chua bi đỏ",
          sku: `${key.toUpperCase()}-SP-${j + 1}`,
          category: i === 1 ? "Trái cây tươi" : "Rau quả tươi",
          defaultUnit: "kg",
          originFarmId: farm.id,
          price: i === 1 ? 180000 + j * 20000 : 45000 + j * 5000,
          storageConditions:
            i === 1
              ? "Bảo quản 2-5°C, không rửa trước khi cất lạnh"
              : "Bảo quản nơi thoáng mát 10-15°C, tránh ánh nắng",
          ingredients: i === 1 ? "100% dâu tây tươi" : "100% cà chua bi tươi",
          usageInstructions:
            "Rửa sạch trước khi dùng; loại bỏ quả hư; đọc hạn sử dụng trên tem.",
          description: `Sản phẩm demo của ${bootstrap.orgs[key].name}. Ảnh chụp stock đúng loại nông sản, không phải chứng nhận chất lượng.`,
          rawMaterials: "Nông sản tươi thu hoạch theo lô",
          manufacturingSiteId: result.sites[key][1].id,
          managerUserId: actor.id,
          distributor: bootstrap.orgs.distributor.name,
          carrier: bootstrap.orgs.carrier.name,
        },
        `product:${key}:${j}`,
      );
      for (let k = 1; k <= 3; k++)
        await evidence(
          key,
          "PRODUCT",
          product.id,
          "PRODUCT_IMAGE",
          `${i === 1 ? "berry" : "tomato"}${k}`,
        );
      result.products.push({
        ...(await api(
          actor,
          `/catalog/products/${product.id}/complete`,
          { version: product.version },
          `product-complete:${product.id}`,
        )),
        key,
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
            note: "Đối tác demo, giao nhận nông sản có kiểm tra hai phía.",
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
          "Chuỗi cà chua Bình Minh",
          "Chuỗi dâu Cao Nguyên",
          "Chuỗi chăn nuôi mẫu",
          "Chuỗi thủy sản mẫu",
        ][i],
        chainType: ["CROP", "PROCESSED_FOOD", "LIVESTOCK", "AQUACULTURE"][i],
        description:
          "Chuỗi demo có tổ chức độc lập tại từng khâu. Loại ngoài CROP chỉ phân loại; nghiệp vụ sản xuất hiện vẫn là trồng trọt.",
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
      key === "berry" ? "berry3" : "tomatoField",
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
            "Phân công reviewer độc lập cho vùng sản xuất trong dataset demo.",
        },
        `compliance-assignment:${farm.id}`,
      );
  }
  return true;
});

const production = await step("production", async () => {
  const cycles = [],
    lots = [];
  for (const farm of resources.farms) {
    const key = farm.key,
      actor = actors[key],
      chain = chains.find((x) => x.key === key);
    for (let i = 0; i < 5; i++) {
      const product = resources.products.filter((x) => x.key === key)[i % 3];
      const cycle = await api(
        actor,
        "/production-cycles",
        {
          chainId: chain.id,
          farmId: farm.id,
          plotId: resources.plots.filter((x) => x.key === key)[i % 2].id,
          productId: product.id,
          cycleCode: `DEMO-202610-${key.toUpperCase()}-${i + 1}`,
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
          note: "Vụ demo có ảnh chụp minh họa; không tuyên bố chứng nhận hoặc dữ liệu cảm biến vật lý thật.",
        },
        `cycle:${key}:${i}`,
      );
      cycles.push({ ...cycle, key });
      await evidence(
        key,
        "CYCLE",
        cycle.id,
        "CYCLE_IMAGE",
        key === "berry" ? "berry3" : "tomatoField",
      );
      if (i === 0) continue;
      if (i === 4) {
        await api(
          actor,
          `/production-cycles/${cycle.id}/cancel`,
          {
            version: cycle.version,
            reason:
              "Hủy vụ mẫu trước khi trồng do điều chỉnh kế hoạch canh tác.",
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
      if (i === 1) continue;
      const careEvidence = unwrap(
        await evidence(
          key,
          "CYCLE",
          cycle.id,
          "CARE_IMAGE",
          key === "berry" ? "berry3" : "tomatoField",
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
          cropCondition: "Lá xanh, cây sinh trưởng đồng đều (mô tả demo)",
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
            deviceCode: `DEMO-${key}-TEMP`,
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
          key === "berry" ? "berry3" : "tomato3",
        ),
      );
      const lotEvidence = unwrap(
        await evidence(
          key,
          "CYCLE",
          cycle.id,
          "LOT_IMAGE",
          key === "berry" ? "berry1" : "tomato1",
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
            lotCode: `DEMO-${key.toUpperCase()}-${i}-${h + 1}`,
            grade: h ? "Loại 2" : "Loại 1",
            expiryDate: day(21).slice(0, 10),
            packaging: "Thùng nhựa thực phẩm 10 kg có tem lô",
            packageCount: 25 + h * 5,
            harvestArea: "6.000 m²",
            harvestMethod: "Thu hái thủ công, phân loại tại vườn",
            qualityNote:
              "Mô tả chất lượng demo; cần kiểm định thực tế trước sử dụng.",
            note: "Thu hoạch nhiều đợt giữ nguyên nguồn lô.",
            ...(i === 3
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
          allocated: i === 3,
        });
      }
      if (i === 3) {
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
  for (let i = 0; i < 4; i++) {
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
        origin: "Vùng sản xuất demo",
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
    if (i === 0) continue;
    let row = await db.shipment.findUniqueOrThrow({ where: { id } }),
      current = await db.lot.findUniqueOrThrow({ where: { id: lot.id } });
    await api(
      actors.carrier,
      `/shipments/${id}/start`,
      { version: row.version, lotVersion: current.version },
      `shipment-start:${id}`,
    );
    if (i === 1) continue;
    row = await db.shipment.findUniqueOrThrow({ where: { id } });
    current = await db.lot.findUniqueOrThrow({ where: { id: lot.id } });
    await api(
      actors.carrier,
      `/shipments/${id}/arrive`,
      { version: row.version, lotVersion: current.version },
      `shipment-arrive:${id}`,
    );
    if (i === 2) continue;
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
        note: "Đã nhận đủ số lượng demo; bảo quản mát.",
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
      label: "Khóa demo local - không phải khóa của doanh nghiệp thật",
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
  for (let i = 0; i < 4; i++) {
    const lot = production.lots.filter((l) => l.allocated)[i],
      receiver = i === 0 ? "processor" : i === 3 ? "retailer" : "distributor";
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
          origin: "Kho nguồn demo",
          destination: resources.sites[receiver][0].address,
          plannedPickupAt: new Date(Date.now() + 3600000).toISOString(),
          plannedDeliveryAt: new Date(Date.now() + 5 * 3600000).toISOString(),
          lines: [{ lotId: lot.id, quantity: "100.000", unit: "kg" }],
          note: "Chặng giao nhận demo, ký Ed25519 hai phía; không có proof Fabric.",
        },
        `transfer:${i}`,
      ),
    );
    result.push({ ...transfer, key: lot.key, receiver, lotId: lot.id });
    if (i === 1) continue;
    for (const key of [lot.key, "carrier", receiver])
      await attest(transfer.id, key, "CONSENT");
    if (i === 2) continue;
    for (const key of [lot.key, "carrier"])
      await attest(transfer.id, key, "PICKUP");
    if (i === 3) continue;
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
        reason: "Đã đối chiếu đủ số lượng và tình trạng hàng demo.",
      },
      `transfer-receipt:${transfer.id}`,
    );
    for (const key of ["carrier", receiver])
      await attest(transfer.id, key, "DELIVERY");
  }
  return result;
});

const processing = await step("processing", async () => {
  const product = await api(
    actors.processor,
    "/catalog/products",
    {
      productName: "Cà chua sơ chế đóng khay 500 g",
      sku: "DEMO-CB-001",
      category: "Nông sản sơ chế",
      defaultUnit: "kg",
      price: 65000,
      storageConditions: "Bảo quản lạnh 2-5°C, dùng trong hạn ghi trên tem",
      ingredients: "100% cà chua tươi",
      rawMaterials: "Cà chua bi từ lô có truy xuất nguồn gốc",
      usageInstructions:
        "Rửa sạch trước khi sử dụng, không dùng bao bì hư hỏng",
      manufacturingSiteId: resources.sites.processor[0].id,
      managerUserId: actors.processor.id,
      description:
        "Thành phẩm sơ chế mẫu; cân bằng khối lượng được kiểm bằng API và SQL. Ảnh stock minh họa.",
    },
    "processed-product",
  );
  for (let k = 1; k <= 3; k++)
    await evidence(
      "processor",
      "PRODUCT",
      product.id,
      "PRODUCT_IMAGE",
      `tomato${k}`,
    );
  await api(
    actors.processor,
    `/catalog/products/${product.id}/complete`,
    { version: product.version },
    "processed-product-complete",
  );
  const source = transfers[0],
    result = [];
  for (let i = 0; i < 3; i++) {
    const quantity = i ? "10.000" : "50.000",
      output = i ? "9.000" : "48.000",
      loss = i ? "1.000" : "2.000";
    const run = unwrap(
      await api(
        actors.processor,
        "/processing-runs",
        {
          chainId: source.chainId,
          siteId: resources.sites.processor[0].id,
          baseUnit: "kg",
          processType: "PRELIMINARY",
          recipe:
            "Phân loại, loại bỏ quả hỏng, làm sạch, để ráo và đóng khay thực phẩm",
          inputs: [{ lotId: source.lotId, quantity }],
          outputs: [
            {
              productId: product.id,
              kind: "PRODUCT",
              quantity: output,
              unit: "kg",
              lotName: `Cà chua sơ chế - mẻ demo ${i + 1}`,
              packaging: "Khay thực phẩm 500 g",
              packageCount: i ? 18 : 96,
              expiryDate: day(7).slice(0, 10),
            },
          ],
          losses: [
            {
              reason: "TRIMMING",
              quantity: loss,
              note: "Loại bỏ phần không đạt (mô phỏng)",
            },
          ],
          note: "Dữ liệu chế biến demo; khối lượng đầu vào = đầu ra + hao hụt.",
        },
        `processing:${i}`,
      ),
    );
    result.push(run);
    if (i === 0)
      await api(
        actors.processor,
        `/processing-runs/${run.id}/complete`,
        { version: run.version },
        `processing-complete:${run.id}`,
      );
    if (i === 2)
      await api(
        actors.processor,
        `/processing-runs/${run.id}/cancel`,
        {
          version: run.version,
          reason:
            "Hủy kế hoạch demo trước thực hiện; không thay đổi lượng nguyên liệu.",
        },
        `processing-cancel:${run.id}`,
      );
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
        note: "Kiểm tra demo bởi tài khoản được phân công độc lập; không phải chứng thư kiểm định thật.",
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
        "DỮ LIỆU DEMO: kiểm tra bao bì và bảo quản theo nhãn; ảnh chụp chỉ có tính minh họa.",
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
        "THU HỒI THỬ TRONG DATASET DEMO: tạm dừng lưu thông lô để đối soát chất lượng; không phải thông báo về sản phẩm ngoài thực tế.",
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
      reason: "Cách ly một phần hàng demo để chờ kiểm tra bao bì.",
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
        "Điều chỉnh gói khởi tạo demo theo mô hình SINGLE: hủy snapshot gói không phù hợp và tạo snapshot đúng, không ghi thanh toán thật.";
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
          demo: true,
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
          body: "Yêu cầu hỗ trợ trong dataset demo. Vui lòng hướng dẫn thao tác và kiểm tra thông tin liên quan. Không có dữ liệu khách hàng thật.",
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
        body: "AgriTrace đã tiếp nhận yêu cầu demo. Hướng dẫn đã được đối chiếu với chức năng hiện hành; vui lòng kiểm tra lại dữ liệu.",
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
          reason: "Đã hoàn tất hướng dẫn và xác nhận đóng yêu cầu hỗ trợ demo.",
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
          "Lịch kiểm tra hệ thống mẫu",
        ][i],
        body: "Thông báo trong dataset demo: mọi tổ chức và thông tin nghiệp vụ là giả lập. Ảnh stock có giấy phép; Fabric đang tắt, không có proof mạng thật.",
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
        title: `Đối soát thông tin lô demo ${i + 1}`,
        description:
          "Hồ sơ sự cố demo dùng để minh họa giao việc và hội thoại; không tự thay đổi quyền giữ hàng hoặc trạng thái chất lượng.",
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
      lot.key === "berry" ? "berry1" : "tomato1",
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
        address: "Khu sản xuất demo, Đức Trọng, Lâm Đồng",
        province: "Lâm Đồng",
        ward: "Đức Trọng",
        phone: "0900000000",
        contactEmail: `${key}.contact@example.test`,
        representative: actor.fullName,
        activities: ["FARM"],
        description:
          "Hồ sơ đầy đủ thông tin liên hệ demo để xem quy trình xét duyệt. Chứng từ và pháp nhân không có giá trị ngoài dataset.",
        declarationAcceptedAt: now,
        legalData: {
          registrationNumber: `DEMO-${key}`,
          taxCode: `DEMO-${key}`,
          issuedBy: "Cơ quan mẫu",
        },
        registrationData: {
          demo: true,
          registrationRole: "PRODUCER",
          production: { type: "CROP", areaM2: 5000 },
          servicePreferences: ["TRACEABILITY"],
          marketingAccepted: false,
        },
      },
    });
  }
  // These are explicit initial snapshots for the demo's onboarding queue.
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
        data: { name: `HTX ${stage} (Demo)`, type: "FARM" },
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
          fullName: `Chủ hồ sơ ${stage} demo`,
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
          businessId: `DEMO-${stage}`,
          hostingMode: "MANAGED_ORG",
          status: "APPROVED",
          activationRequired: true,
          reviewedBy: actors.admin.id,
          reviewNote:
            "Hồ sơ demo đã duyệt, đang ở bước dịch vụ; chưa có quyền nghiệp vụ.",
        },
      });
      await tx.enterpriseProfile.create({
        data: {
          organizationId: org.id,
          legalForm: "COOPERATIVE",
          address: "Khu sản xuất demo, Đức Trọng, Lâm Đồng",
          province: "Lâm Đồng",
          ward: "Đức Trọng",
          phone: "0900000000",
          contactEmail: `${stage}.contact@example.test`,
          representative: user.fullName,
          activities: ["FARM"],
          declarationAcceptedAt: now,
          description: "Hồ sơ minh họa các giai đoạn xét duyệt và dịch vụ.",
          legalData: { demo: true, registrationNumber: `DEMO-${stage}` },
          registrationData: {
            demo: true,
            registrationRole: "PRODUCER",
            servicePreferences: ["TRACEABILITY"],
          },
        },
      });
      if (stage !== "approved") {
        const contractText = `AGRITRACE DEMO - Hợp đồng trải nghiệm không có giá trị pháp lý. Gói ${plan.planCode}, thời hạn ${plan.termMonths} tháng, phí thiết lập ${plan.setupFee} VND, phí năm ${plan.annualFee} VND. Không có thanh toán thật hoặc chữ ký số chứng thực.`;
        const order = await tx.enterpriseServiceOrder.create({
          data: {
            enrollmentId: enrollment.id,
            planCode: plan.planCode,
            hostingMode: "MANAGED_ORG",
            billingEmail: email,
            billingName: org.name,
            billingAddress: "Đức Trọng, Lâm Đồng (Demo)",
            amount: Number(plan.setupFee + plan.annualFee),
            quotation: {
              demo: true,
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
          "Yêu cầu quyền dữ liệu trong môi trường demo: vui lòng cung cấp hướng dẫn kiểm tra thông tin hồ sơ và phạm vi chia sẻ. Không có thông tin cá nhân thật.",
      },
      `privacy-request:${key}`,
    );
  await api(
    actors.privacy,
    "/platform-privacy/breaches",
    {
      detectedAt: new Date(Date.now() - 3600000).toISOString(),
      message:
        "Diễn tập hồ sơ riêng tư trong dataset demo; không phải sự cố rò rỉ thực tế và không gửi báo cáo ra ngoài.",
    },
    "privacy-demo-breach",
  );
  return true;
});

await step("certificates-and-amendment", async () => {
  for (const [i, key] of ["farm", "berry", "garden"].entries()) {
    const cycle = production.cycles.filter((x) => x.key === key)[2],
      farm = resources.farms.find((x) => x.key === key);
    const document = await db.traceEvidence.findFirstOrThrow({
      where: {
        entityType: "FARM",
        entityId: farm.id,
        kind: "QUALITY_CERTIFICATE",
      },
    });
    const cert = await api(
      actors[key],
      "/certificates",
      {
        cycleId: cycle.id,
        type: "Chứng nhận DEMO - không có giá trị pháp lý",
        issuer: "Đơn vị chứng nhận giả lập (không phải chứng nhận thật)",
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
            "Quy trình review demo độc lập. Hồ sơ không có giá trị kiểm định hoặc chứng nhận thật.",
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
        "Đề nghị điều chỉnh thông tin liên hệ trong hồ sơ demo để minh họa hàng chờ xét duyệt.",
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
        note: "Lô demo giao tới cửa hàng, ghi nhận bán một phần qua API.",
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
      reason: "Nhận đủ hàng demo tại cửa hàng, đối chiếu hai phía.",
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
      reason: "Bán lẻ một phần lô demo; không có thanh toán thật.",
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
      "tomato3",
      "public",
    );
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
          "Điều chỉnh thông báo của dataset để chỉ hiển thị hướng dẫn trải nghiệm cần thiết.",
      },
      `withdraw-seed-notice:${notice.id}`,
    );
  await api(
    actors.admin,
    "/platform-admin/notices",
    {
      title: "Không gian trải nghiệm AgriTrace",
      body: "Thông tin doanh nghiệp và nghiệp vụ trong môi trường này là dữ liệu mẫu. Bạn có thể xem hồ sơ, tra cứu lô hàng và trải nghiệm các quy trình theo quyền của tài khoản.",
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
