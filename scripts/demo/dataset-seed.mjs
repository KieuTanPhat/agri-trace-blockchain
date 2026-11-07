// Local operator seed. Run only after seed-current.ps1 backup/target checks,
// or explicitly authorized fresh-cluster checks (see database migration runbook).
import assert from "node:assert/strict";
import { canonicalize } from "json-canonicalize";
import {ensureSeedAccount,seedContentId} from "./seed-recovery.mjs";
import { publishDatasetPresentation } from "./publish-dataset-presentation.mjs";
import { seedTarget, LEDGER_REQUIRED_EXIT } from "./seed-target.mjs";
import {
  createHash,
  randomUUID,
  randomBytes,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { appendFile, readFile, readdir, writeFile, mkdir, rename } from "node:fs/promises";
import { hash } from "bcrypt";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../apps/api/dist/generated/prisma/client.js";
import {
  appendPlatformAudit,
  lockPlatformAudit,
} from "../../apps/api/dist/modules/platform-governance/platform-audit.js";

import { mergeServiceContract } from "../../apps/api/dist/modules/enterprise-onboarding/service-contract-pdf.js";

// Production allows 120 requests a minute from one address: stay under it.
const rawFetch = globalThis.fetch;
const requestTimes = [];
globalThis.fetch = async function pacedFetch(...args) {
  for (;;) {
    const now = Date.now();
    while (requestTimes.length && now - requestTimes[0] > 60000) requestTimes.shift();
    if (requestTimes.length < 100) break;
    await new Promise((resolve) => setTimeout(resolve, 60000 - (now - requestTimes[0]) + 50));
  }
  requestTimes.push(Date.now());
  return rawFetch(...args);
};
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
  for (let attempt = 0; ; attempt++) {
    try { await rename(`${target}.tmp`, target); break; }
    catch (error) { if (error.code !== "EPERM" || attempt > 20) throw error; await new Promise((r) => setTimeout(r, 100)); }
  }
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
try {
  for (const line of (await readFile(`${local}/commands.jsonl`, "utf8")).split("\n")) {
    if (!line) continue;
    try { const row = JSON.parse(line); state.commands[row.label] = row.command; } catch { /* torn final line */ }
  }
} catch (e) { if (e.code !== "ENOENT") throw e; }
async function journal(label) {
  await appendFile(`${local}/commands.jsonl`, `${JSON.stringify({ label, command: state.commands[label] })}\n`, { mode: 0o600 });
}
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
  await save("progress", { ...state, commands: {} });
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
      await journal(label);
    }
    if (!command) {
      command = state.commands[label] = {
        key: randomUUID(),
        route,
        method,
        body,
      };
      await journal(label);
    }
    assert.equal(command.route, route);
    assert.equal(command.method, method);
    body = command.body; // Recovery always uses the original body and key.
  }
  await ensureFresh(actor);
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
      await journal(label);
    }
    throw new Error(
      `${response.status} ${method} ${route}: ${JSON.stringify(result.message ?? result.error ?? result).slice(0, 1400)}`,
    );
  }
  const data = result.data ?? result;
  if (command) {
    command.complete = true;
    command.result = data;
    await journal(label);
  }
  return data;
}
const datasetDir = new URL("./dataset/", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("catalog.json", datasetDir), "utf8"));
const scenario = JSON.parse(await readFile(new URL("scenario.json", datasetDir), "utf8"));
const enterprises = Object.fromEntries(catalog.enterprises.map((e) => [e.code, e]));
const productOf = Object.fromEntries(catalog.products.map((p) => [p.key, p]));
const accountOf = (code) => scenario.accounts.find((a) => a.code === code);
const stem = (file) => file.split("/").pop().replace(/\.[^.]+$/, "");
const orgWard = (e) => e.area.replace(/^Khu (vực|công nghiệp) /, "");
const NORTH = new Set(["E06", "E09", "E14", "E08", "E17", "E19", "E02", "E16", "E15"]);
const region = (code) => (NORTH.has(code) ? "N" : "S");
const ROLE_BY_TYPE = { FARM: "FARM_STAFF", TRANSPORTER: "TRANSPORTER", DISTRIBUTOR: "DISTRIBUTOR", RETAILER: "RETAILER", PROCESSOR: "PROCESSOR", AUDITOR: "AUDITOR" };
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
  "FARM_STAFF",
  "TRANSPORTER",
  "DISTRIBUTOR",
  "RETAILER",
  "PROCESSOR",
  "ENTERPRISE_STAFF",
  "AUDITOR",
];
const orgDefs = catalog.enterprises.map((e) => [e.code, e.name, e.type, ROLE_BY_TYPE[e.type], e.province, orgWard(e)]);
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
        ["operator", "SYSTEM_ADMIN", "Lê Tuấn Khang"],
        ["cases", "SYSTEM_ADMIN", "Phạm Ngọc Mai"],
        ["privacy", "SYSTEM_ADMIN", "Võ Khánh Linh"],
      ])
        result.users[key] = await makeUser(
          tx,
          `${key}@example.test`,
          name,
          roleCode,
        );
      for (let i = 0; i < orgDefs.length; i++) {
        const [key, name, type, roleCode, province, ward] = orgDefs[i];
        // ADR-005: the cooperative owns the product chains; partners are members.
        const organization = await tx.organization.create({
          data: { name, type, status: "ACTIVE", participationStatus: ["FARM", "PROCESSOR"].includes(type) ? "CHAIN_OWNER" : "MEMBER" },
        });
        const owner = await makeUser(
          tx,
          accountOf(`${key}-OWNER`).email,
          accountOf(`${key}-OWNER`).fullName,
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
            accountOf("E15-NV1").email,
            accountOf("E15-NV1").fullName,
            "AUDITOR",
            {
              organizationId: organization.id,
              jobTitle: "Chuyên viên xét duyệt độc lập",
            },
          );
          continue;
        }
        const caps = [type];
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
            legalForm: enterprises[key].legalForm === "Hợp tác xã" ? "COOPERATIVE" : "ENTERPRISE",
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
              taxCode: `AGT-MST-${key}`,
              representative: owner.fullName,
              position: "Giám đốc",
              issuedBy: "Cơ quan đăng ký  - không có giá trị pháp lý",
              issuedAt: "2025-01-15",
            },
            registrationData: {
              schemaVersion: 2,
             synthetic: true,
              participationStatus: ["FARM", "PROCESSOR"].includes(type) ? "CHAIN_OWNER" : "MEMBER",
              legalForm: enterprises[key].legalForm === "Hợp tác xã" ? "COOPERATIVE" : "ENTERPRISE",
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
              servicePreferences: ["TRACEABILITY"],
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
          ...(["FARM", "PROCESSOR"].includes(type) ? ["CREATE_CHAIN"] : []),
        ])
          await tx.scopedRoleGrant.create({
            data: {
              userId: owner.id,
              organizationId: organization.id,
              scope: "ORGANIZATION",
              role,
            },
          });
        // Members below the owner are enterprise employees; inspection bodies keep AUDITOR.
        const staffRoleCode =
          roleCode === "AUDITOR" ? "AUDITOR" : "ENTERPRISE_STAFF";
        const [manager, staff] = await (async () => {
          const manager = await makeUser(
            tx,
            accountOf(`${key}-NV1`).email,
          accountOf(`${key}-NV1`).fullName,
            staffRoleCode,
            {
              organizationId: organization.id,
              // No manager tier: every employee reports directly to the owner.
              enterpriseTier: 3,
              supervisorId: owner.id,
              memberCode: "NV0002",
              jobTitle: "Quản lý nghiệp vụ",
            },
          );
          const staff = await makeUser(
            tx,
            accountOf(`${key}-NV2`).email,
          accountOf(`${key}-NV2`).fullName,
            staffRoleCode,
            {
              organizationId: organization.id,
              enterpriseTier: 3,
              supervisorId: owner.id,
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
          where: { status: "PUBLISHED", planCode: "OWNER_ENTERPRISE" },
          orderBy: { createdAt: "desc" },
        });
        if (["FARM", "PROCESSOR"].includes(type) && plan)
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
          "ENTERPRISE_STAFF",
          {
            organizationId: result.orgs.E01.id,
            enterpriseTier: 3,
            supervisorId: result.users.E01.id,
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
  if (!["admin", "operator", "cases", "privacy", "reviewer", ...Object.keys(enterprises)].includes(key)) {
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
    expiresAt: sessions[key].expiresAt,
    sessionKey: key,
  };
}
async function ensureFresh(actor) {
  if (!actor?.sessionKey || actor.expiresAt > Date.now() + 120000) return;
  const credential = accounts.users.find((x) => x.email === actor.email);
  let r;
  for (let attempt = 0; attempt < 12; attempt++) {
    r = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: credential.email, password: credential.password }) });
    if (r.status !== 429) break;
    await r.arrayBuffer();
    console.log("Login throttle active; waiting without changing credentials.");
    await new Promise((resolve) => setTimeout(resolve, 60000));
  }
  const payload = await r.json();
  const data = payload.data ?? payload;
  assert.equal(r.status, 201, `Login failed for ${actor.sessionKey}`);
  actor.token = data.accessToken;
  actor.expiresAt = JSON.parse(Buffer.from(data.accessToken.split(".")[1], "base64url")).exp * 1000;
  sessions[actor.sessionKey] = { token: actor.token, expiresAt: actor.expiresAt };
  await save("sessions", sessions);
}
for (const [alias, code] of Object.entries({ farm: "E01", berry: "E03", garden: "E04", carrier: "E16", distributor: "E19", retailer: "E02", processor: "E17", auditor: "E15" })) actors[alias] = actors[code];
const unwrap = (v) => v.record ?? v;
async function evidence(key, type, id, kind, photoKey, suffix = "") {
  const label = `evidence:${key}:${type}:${id}:${kind}:${photoKey}:${suffix}`;
  if (state.commands[label]?.complete) return state.commands[label].result;
  await ensureFresh(actors[key]);
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
  form.set("file", new Blob([bytes], { type: "image/jpeg" }), asset.file.replace("/", "-"));
  const command = (state.commands[label] ??= { key: randomUUID() });
  await journal(label);
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
  await journal(label);
  return command.result;
}

// All subsequent domain writes use the normal authorized HTTP command handlers.
const codes = catalog.enterprises.map((e) => e.code);
const siteCode = (code, i = 0) => resources.sites[code][i];
const chainOf = (code) => chains.find((c) => c.code === code);
const qty = (n) => `${Number(n).toFixed(3)}`;
const siteKind = (type, i) => ({ FARM: i ? "COLD_STORAGE" : "WAREHOUSE", PROCESSOR: "PROCESSING", RETAILER: "RETAIL", DISTRIBUTOR: i ? "COLD_STORAGE" : "WAREHOUSE", TRANSPORTER: "WAREHOUSE" })[type];

const resources = await step("resources", async () => {
  const result = { farms: [], products: [], sites: {}, materials: [], plots: [], vehicles: [] };
  for (const s of scenario.sites) {
    const key = s.owner, e = enterprises[key], j = (result.sites[key] ?? []).length, kind = siteKind(e.type, j);
    const site = unwrap(await api(actors[key], "/enterprise-workspace/sites", {
      name: s.name, kind, region: e.province, ward: orgWard(e), areaM2: 500 + j * 200, capacityKg: 50000,
      ...(kind === "COLD_STORAGE" ? { coldAreaM2: 200 } : {}), expectedOutputTons: 60,
      address: `${e.area}, ${e.province}`, manager: actors[key].fullName, representative: actors[key].fullName,
      phone: "0900000000", email: `${key.toLowerCase()}.site${j}@demo.agritrace.dev`, staffUserId: actors[key].id,
      otherInfo: "Cơ sở có phân khu tiếp nhận, bảo quản và kiểm soát vệ sinh theo quy trình nội bộ.",
    }, `site:${s.code}`));
    await evidence(key, "SITE", site.id, "SITE_IMAGE", `site/${stem(s.photo)}`);
    const active = unwrap(await api(actors[key], `/enterprise-workspace/sites/${site.id}/complete`, { version: site.version }, `site-complete:${site.id}`));
    (result.sites[key] ??= []).push(active);
  }
  for (const v of scenario.vehicles)
    result.vehicles.push({ ...unwrap(await api(actors[v.owner], "/enterprise-workspace/vehicles", { registration: v.plate, kind: v.type }, `vehicle:${v.code}`)), code: v.code });
  for (const key of codes.filter((c) => enterprises[c].type === "FARM")) {
    const actor = actors[key], e = enterprises[key];
    for (let j = 0; j < 3; j++) {
      const material = unwrap(await api(actor, "/enterprise-workspace/materials", {
        name: ["Giống cây trồng tuyển chọn", "Phân hữu cơ vi sinh", "Chế phẩm sinh học phòng sâu"][j], kind: ["SEED", "FERTILIZER", "PROTECTION"][j], unit: j ? "kg" : "g",
        code: `${key}-VT-${j + 1}`, supplier: "Công ty Vật tư Nông nghiệp Xanh", manufacturer: "Cơ sở vật tư nông nghiệp", batchCode: `AGT-VT-2026-${key}${j}`, origin: "Việt Nam",
        seedType: j ? undefined : "Giống chọn lọc", activeIngredient: j === 2 ? "Bacillus thuringiensis" : undefined, description: "Vật tư được quản lý theo lô nhập.", withdrawalDays: j === 2 ? 7 : 0, expiryDate: day(300).slice(0, 10),
      }, `material:${key}:${j}`));
      await evidence(key, "MATERIAL", material.id, j ? "MATERIAL_IMAGE" : "SEED_IMAGE", "care/kiemtra1");
      result.materials.push({ ...unwrap(await api(actor, `/enterprise-workspace/materials/${material.id}/complete`, { version: material.version }, `material-complete:${material.id}`)), key });
    }
    const farm = await api(actor, "/catalog/farms", {
      organizationId: actor.organizationId, name: `Vùng sản xuất ${orgWard(e)}`, kind: "CROP", region: e.province, address: `${e.area}, ${e.province}`, areaM2: 200000, expectedOutput: 300000, outputUnit: "kg/năm", privacy: "PUBLIC",
      representative: actor.fullName, phone: "0900000000", email: `${key.toLowerCase()}.farm@demo.agritrace.dev`,
      seedMaterialIds: result.materials.filter((x) => x.key === key && x.kind === "SEED").map((x) => x.id), inputMaterialIds: result.materials.filter((x) => x.key === key && x.kind !== "SEED").map((x) => x.id),
      otherInfo: "Vùng có phân lô, nhật ký tưới, chăm sóc và thu hoạch theo đợt.",
    }, `farm:${key}`);
    const land = scenario.documents.find((d) => d.owner === key && d.type === "Quyền sử dụng đất");
    await evidence(key, "FARM", farm.id, "LAND_CERTIFICATE", `document/${stem(land.file)}`);
    result.farms.push({ ...(await api(actor, `/catalog/farms/${farm.id}/complete`, { version: farm.version }, `farm-complete:${farm.id}`)), key });
    for (const plot of scenario.plots.filter((p) => p.owner === key))
      result.plots.push({ ...(await api(actor, "/catalog/plots", { farmId: farm.id, name: plot.name, area: plot.areaM2, unit: "m2", location: "Phân khu, có rãnh thoát nước" }, `plot:${plot.code}`)), key, code: plot.code });
  }
  for (const [j, p] of catalog.products.entries()) {
    const key = p.owner, actor = actors[key], raw = p.kind === "Thô";
    const farm = result.farms.find((f) => f.key === key);
    const distributorName = enterprises[region(key) === "N" ? "E19" : "E20"].name, carrierName = enterprises[region(key) === "N" ? "E16" : "E13"].name;
    const product = await api(actor, "/catalog/products", {
      productName: p.name, ...(p.variety ? { variety: p.variety } : {}), sku: `${key}-SP-${j + 1}`, category: p.category, defaultUnit: p.unit,
      ...(raw ? { originFarmId: farm.id } : {}), storageConditions: p.storage, ingredients: p.ingredients, usageInstructions: p.usage, description: p.description,
      rawMaterials: raw ? "Nông sản thu hoạch theo lô" : `${(p.source || "").replace("HÀNG NGOÀI: ", "")} từ các lô nguồn có truy xuất`,
      manufacturingSiteId: result.sites[key][0].id, managerUserId: actor.id, distributor: distributorName, carrier: carrierName,
    }, `product:${p.key}`);
    await evidence(key, "PRODUCT", product.id, "PRODUCT_IMAGE", `product/${p.key}`);
    result.products.push({ ...(await api(actor, `/catalog/products/${product.id}/complete`, { version: product.version }, `product-complete:${product.id}`)), key, slug: p.key });
  }
  return result;
});
const chains = await step("chains", async () => {
  const result = [];
  const pairs = new Set();
  const pair = (a, b) => { if (a && b && a !== b && enterprises[a].type !== "AUDITOR" && enterprises[b].type !== "AUDITOR") pairs.add([a, b].sort().join("|")); };
  for (const c of scenario.chains) for (const m of c.members) pair(c.owner, m);
  for (const t of scenario.transfers) { pair(t.sender, t.receiver); pair(t.sender, t.carrier); pair(t.receiver, t.carrier); }
  for (const item of [...pairs].sort()) {
    const [key, other] = item.split("|");
    const existing = await db.enterprisePartner.findFirst({ where: { OR: [{ inviterId: actors[key].organizationId, inviteeId: actors[other].organizationId }, { inviterId: actors[other].organizationId, inviteeId: actors[key].organizationId }] } });
    if (existing) continue;
    const businessId = (await db.enterpriseEnrollment.findUniqueOrThrow({ where: { organizationId: actors[other].organizationId } })).businessId;
    const partner = unwrap(await api(actors[key], "/enterprise-workspace/partners", { businessId, note: "Đối tác giao nhận nông sản có kiểm tra hai phía." }, `partner:${key}:${other}`));
    await api(actors[other], `/enterprise-workspace/partners/${partner.id}`, { version: partner.version, decision: "ACCEPT" }, `partner-accept:${partner.id}`);
  }
  for (const c of scenario.chains) {
    const key = c.owner, owner = enterprises[key];
    const business = c.members.filter((m) => enterprises[m].type !== "AUDITOR");
    const participants = [{ stage: owner.type, organizationId: actors[key].organizationId }, ...business.map((m) => ({ stage: enterprises[m].type, organizationId: actors[m].organizationId }))];
    const chain = await api(actors[key], "/supply-chains", {
      name: c.name.charAt(0).toUpperCase() + c.name.slice(1), chainType: c.type, description: "Chuỗi có tổ chức độc lập tại từng khâu sản xuất, giao nhận và phân phối.", participants,
      productIds: resources.products.filter((p) => p.key === key).map((p) => p.id), plannedStartDate: day(-400).slice(0, 10),
    }, `chain:${c.code}`);
    for (const other of business) {
      const memberships = await api(actors[key], `/supply-chains/${chain.id}/memberships`);
      const m = memberships.find((x) => x.organizationId === actors[other].organizationId);
      if (m?.status === "INVITED") await api(actors[other], `/supply-chains/${chain.id}/memberships/${actors[other].organizationId}/accept`, { version: m.version }, `membership:${chain.id}:${other}`);
    }
    const profile = await api(actors[key], `/supply-chains/${chain.id}/business-profile`);
    if (profile.state !== "ACTIVE") await api(actors[key], `/supply-chains/${chain.id}/business-profile/activate`, { version: profile.version }, `chain-activate:${chain.id}`);
    const m = await api(actors[key], `/supply-chains/${chain.id}/memberships`, { organizationId: actors.E15.organizationId }, `audit-member:${chain.id}`);
    await api(actors.E15, `/supply-chains/${chain.id}/memberships/${actors.E15.organizationId}/accept`, { version: m.version }, `audit-accept:${chain.id}`);
    for (const other of [key, ...business, "E15"]) {
      const role = ROLE_BY_TYPE[enterprises[other].type];
      for (const userKey of [other, `${other}Manager`, `${other}Staff`].filter((x) => actors[x])) {
        if (!(await db.scopedRoleGrant.findFirst({ where: { userId: actors[userKey].id, chainId: chain.id, role, revokedAt: null } })))
          await db.scopedRoleGrant.create({ data: { userId: actors[userKey].id, organizationId: actors[other].organizationId, scope: "CHAIN", chainId: chain.id, role } });
      }
    }
    if (!(await db.scopedRoleGrant.findFirst({ where: { userId: actors.reviewer.id, chainId: chain.id, role: "COMPLIANCE_REVIEWER", revokedAt: null } })))
      await db.scopedRoleGrant.create({ data: { userId: actors.reviewer.id, organizationId: actors.E15.organizationId, scope: "CHAIN", chainId: chain.id, role: "COMPLIANCE_REVIEWER" } });
    await evidence(key, "CHAIN", chain.id, "CHAIN_IMAGE", "care/kiemtra1");
    result.push({ ...chain, key, code: c.code });
  }
  return result;
});
await step("delegation", async () => {
  const allPermissions = ["profile.read", "members.read", "partners.read", "partners.manage", "catalog.read", "catalog.manage", "sites.read", "sites.manage", "vehicles.read", "vehicles.manage", "production.read", "production.write", "distribution.read", "distribution.write", "distribution.sign", "distribution.drive", "trace.read", "qr.manage", "reports.read", "quantity.adjust", "profile.manage", "cases.read", "cases.respond", "inventory.manage", "quarantine.manage", "evidence.read", "evidence.manage", "materials.read", "materials.manage", "processing.read", "processing.write"];
  for (const key of codes.filter((c) => enterprises[c].type !== "AUDITOR")) {
    const chainIds = (await db.chainMembership.findMany({ where: { organizationId: actors[key].organizationId, status: "ACTIVE" } })).map((x) => x.chainId);
    const siteIds = [...resources.sites[key].map((x) => x.id), ...resources.farms.filter((x) => x.key === key).map((x) => x.id)];
    for (const tier of ["Manager", "Staff"]) {
      const permissions = allPermissions.filter((x) => !(tier === "Staff" && ["profile.manage", "partners.manage"].includes(x)));
      const role = unwrap(await api(actors[key], "/enterprise-workspace/roles", { name: tier === "Manager" ? "Quản lý nghiệp vụ" : "Thực hiện nghiệp vụ", permissions }, `role:${key}:${tier}`));
      await db.enterpriseMemberRole.upsert({ where: { userId_roleId: { userId: actors[`${key}${tier}`].id, roleId: role.id } }, create: { userId: actors[`${key}${tier}`].id, organizationId: actors[key].organizationId, roleId: role.id, chainIds, siteIds }, update: {} });
    }
  }
  for (const farm of resources.farms)
    if (!(await db.complianceAssignment.findFirst({ where: { farmId: farm.id, reviewerUserId: actors.reviewer.id, revokedAt: null } })))
      await api(actors.admin, "/compliance/assignments", { farmId: farm.id, reviewerUserId: actors.reviewer.id, reason: "Phân công kiểm định viên độc lập cho vùng sản xuất trong hồ sơ." }, `compliance-assignment:${farm.id}`);
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


const deviceState = await load("devices", {});
async function deviceFor(key, kind, deviceCode, name, bind) {
  if (deviceState[deviceCode]?.id) return deviceState[deviceCode];
  const pair = generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
  const privateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  deviceState[deviceCode] = { deviceCode, publicKey, privateKeyPem, sequence: 0 };
  await save("devices", deviceState);
  const device = unwrap(await api(actors[key], "/iot/v2/devices", { kind, deviceCode, name, publicKey: deviceState[deviceCode].publicKey, simulated: true, ...bind }, `device:${deviceCode}`));
  deviceState[deviceCode].id = device.id;
  await save("devices", deviceState);
  return deviceState[deviceCode];
}
async function deviceUpload(device, kind, records) {
  for (let attempt = 1; ; attempt++) {
    const body = { deviceCode: device.deviceCode, sentAt: new Date().toISOString(), [kind]: records };
    const message = Buffer.concat([Buffer.from("agritrace:iot-device:1", "utf8"), Buffer.from([0]), Buffer.from(canonicalize(body), "utf8")]);
    const signature = sign(null, message, device.privateKeyPem).toString("base64url");
    const response = await fetch(`${base}/iot/v2/ingest/${kind}`, { method: "POST", headers: { "content-type": "application/json", "x-device-signature": signature }, body: JSON.stringify(body) });
    if (response.ok) break;
    // Repeated sequences are ignored by ingest, so a failed batch is safe to resend.
    if (response.status >= 500 && attempt < 4) { await new Promise((done) => setTimeout(done, attempt * 5000)); continue; }
    throw new Error(`Device ${device.deviceCode} ${kind}: ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  await save("devices", deviceState);
}
async function sensorHistory(c, plantedAt, lastDay) {
  if (deviceState[`sensor:${c.code}`]) return;
  const key = c.owner, plot = resources.plots.find((p) => p.code === c.plot);
  const device = await deviceFor(key, "FIELD_SENSOR", `AGT-${c.plot}-SENSOR`, `Cảm biến ${plot.name} ${key}`, { plotId: plot.id });
  const end = new Date(day(lastDay)).getTime() - 3600000, hours = Math.min(72, Math.floor((end - new Date(plantedAt).getTime()) / 3600000));
  const records = [];
  for (let h = hours; h >= 0; h--) {
    const at = new Date(end - h * 3600000), hour = (at.getUTCHours() + 7) % 24, wave = Math.sin(((hour - 8) / 24) * 2 * Math.PI);
    for (const [sensorType, value, unit] of [["TEMPERATURE", 26 + wave * 5, "°C"], ["HUMIDITY", 74 - wave * 12, "%"], ["SOIL_MOISTURE", 42 + Math.sin(h / 9) * 5, "%"]])
      records.push({ sequence: ++device.sequence, sensorType, value: Number(value.toFixed(2)), unit, recordedAt: at.toISOString() });
  }
  for (let i = 0; i < records.length; i += 30) await deviceUpload(device, "readings", records.slice(i, i + 30));
  deviceState[`sensor:${c.code}`] = true;
  await save("devices", deviceState);
}
const packagingOf = (category) => (["Ngũ cốc", "Đậu đỗ", "Hạt và cây công nghiệp"].includes(category) ? "Bao 25 kg có tem lô" : ["Rau ăn lá", "Rau gia vị", "Nấm ăn"].includes(category) ? "Thùng nhựa thực phẩm 5 kg có tem lô" : "Thùng nhựa thực phẩm 10 kg có tem lô");
const production = await step("production", async () => {
  await ledgerSettled();
  const cycles = [], lots = [];
  for (const [index, c] of scenario.cycles.entries()) {
    const key = c.owner, actor = actors[key], chain = chainOf(c.chain), p = productOf[c.product];
    const farm = resources.farms.find((f) => f.key === key), plot = resources.plots.find((x) => x.code === c.plot), product = resources.products.find((x) => x.slug === c.product);
    const cycleLots = scenario.lots.filter((l) => l.cycle === c.code);
    const total = cycleLots.reduce((s, l) => s + l.quantity, 0);
    const seed = resources.materials.find((x) => x.key === key && x.kind === "SEED");
    const cycle = await api(actor, "/production-cycles", {
      chainId: chain.id, farmId: farm.id, plotId: plot.id, productId: product.id, cycleCode: c.code, name: `${p.name} - vụ 2026`, startDate: day(c.startDay).slice(0, 10), plannedHarvest: day(cycleLots[0].harvestDay).slice(0, 10),
      maxHarvestQuantity: Math.ceil(total * 1.2), harvestUnit: "kg", cultivatedArea: plot.area ?? 6000, seedMaterialId: seed.id, responsibleUserId: actor.id, cultivationMethod: "Canh tác quản lý tổng hợp, ghi nhật ký theo lô", note: "Vụ được quản lý theo thửa và nhật ký chăm sóc.",
    }, `cycle:${c.code}`);
    cycles.push({ ...cycle, key });
    await evidence(key, "CYCLE", cycle.id, "CYCLE_IMAGE", `product/${c.product}`);
    let current = await db.productionCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    await api(actor, `/production-cycles/${cycle.id}/plant`, { version: current.version, plantedAt: day(c.plantDay) }, `plant:${cycle.id}`);
    for (const [n, care] of c.care.entries()) {
      const proof = unwrap(await evidence(key, "CYCLE", cycle.id, "CARE_IMAGE", `care/${stem(care.photo)}`, `care${n}`));
      current = await db.productionCycle.findUniqueOrThrow({ where: { id: cycle.id } });
      await api(actor, `/production-cycles/${cycle.id}/care`, { version: current.version, name: care.name, careType: care.name, eventTime: day(care.day), evidenceRef: proof.id, method: care.method, cropCondition: "Cây sinh trưởng đồng đều", performerUserId: actor.id, note: "Ghi nhận theo nhật ký chăm sóc." }, `care:${cycle.id}:${n}`);
    }
    if (c.sensors) await sensorHistory(c, day(c.plantDay), cycleLots[0].harvestDay);
    for (const [h, l] of cycleLots.entries()) {
      const harvestEvidence = unwrap(await evidence(key, "CYCLE", cycle.id, "HARVEST_IMAGE", `care/${stem(l.photo)}`, `harvest${h}`));
      const lotEvidence = unwrap(await evidence(key, "CYCLE", cycle.id, "LOT_IMAGE", `product/${c.product}`, `lot${h}`));
      current = await db.productionCycle.findUniqueOrThrow({ where: { id: cycle.id } });
      const receipt = await api(actor, `/production-cycles/${cycle.id}/harvests`, {
        version: current.version, lotName: `${p.name} - đợt ${h + 1}`, representativeUserId: actor.id, evidenceRef: harvestEvidence.id, lotImageEvidenceRef: lotEvidence.id, quantity: l.quantity, unit: "kg", harvestTime: day(l.harvestDay), lotCode: l.code, grade: l.grade, expiryDate: day(l.expiryDay).slice(0, 10),
        packaging: packagingOf(p.category), packageCount: Math.max(1, Math.round(l.quantity / 10)), harvestArea: `${plot.name}`, harvestMethod: "Thu hoạch thủ công, phân loại tại nơi sản xuất", qualityNote: "Đạt yêu cầu phân loại nội bộ.", note: "Thu hoạch theo đợt, giữ nguyên nguồn lô.", initialStorageSiteId: siteCode(key).id,
      }, `harvest:${cycle.id}:${h}`);
      lots.push({ ...receipt.lot, key, code: l.code, cycleId: cycle.id, chainId: chain.id, traceToken: receipt.traceQr.traceToken, allocated: true, productSlug: `product/${c.product}` });
    }
    if (index % 2 === 0) {
      current = await db.productionCycle.findUniqueOrThrow({ where: { id: cycle.id } });
      await api(actor, `/production-cycles/${cycle.id}/close`, { version: current.version }, `cycle-close:${cycle.id}`);
    }
    if (index % 20 === 0) console.log(`Production ${index + 1}/${scenario.cycles.length}`);
  }
  return { cycles, lots };
});
await step("first-login-delegation", async () => {
  const source = await db.enterpriseMemberRole.findFirstOrThrow({
    where: { userId: bootstrap.users.E01Staff.id },
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
    "/distribution/device-keys",
    {
      id: value.id,
      publicKey: value.publicKey,
      popSignature,
      label: "Khóa local - không phải khóa của doanh nghiệp thật",
    },
    `key:${key}`,
  );
  // Demo data only: the seed confirms the emailed code on behalf of its own
  // test account instead of reading a mailbox.
  await db.distributionKey.updateMany({
    where: { id: value.id, status: "PENDING" },
    data: { status: "ACTIVE", verifiedAt: new Date() },
  });
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

const lotByCode = (code) => production.lots.find((l) => l.code === code) ?? finishedLots[code];
const finishedLots = await load("finished-lots", {});
const transferState = await load("transfers", {});
const busyVehicles = new Set();
const sitePhotoMap = Object.fromEntries(scenario.sites.map((s) => [s.owner, s.photo]));
function sitePhoto(key) { return sitePhotoMap[key]; }
async function handoverPhoto(id, phase, key, siteFile) {
  const row = await db.distributionTransfer.findUniqueOrThrow({ where: { id } });
  const proof = unwrap(await evidence(key, "TRANSFER", id, "TRANSFER_IMAGE", siteFile, phase));
  await api(actors[key], `/distribution/transfers/${id}/photos`, { version: row.version, phase, photos: [proof.id] }, `photo:${id}:${phase}`);
}
const orgKey = (organizationId) => codes.find((c) => actors[c].organizationId === organizationId);
const parties = (row, phase) => [...new Set((phase === "CONSENT" ? [row.senderId, row.carrierId, row.receiverId] : phase === "PICKUP" ? [row.senderId, row.carrierId] : [row.carrierId, row.receiverId]).filter(Boolean).map(orgKey))];
async function createTransfer(t) {
  if (transferState[t.code]?.id) return transferState[t.code];
  const lot = lotByCode(t.lot), carrierSite = t.mode === "PLATFORM_CARRIER" ? { carrierId: actors[t.carrier].organizationId, carrierSiteId: siteCode(t.carrier).id } : {};
  const vehicle = t.vehicle && !busyVehicles.has(t.vehicle) && t.mode !== "EXTERNAL_CARRIER" ? resources.vehicles.find((v) => v.code === t.vehicle) : null;
  const created = unwrap(await api(actors[t.sender], "/distribution/transfers", {
    chainId: lot.chainId, receiverId: actors[t.receiver].organizationId, ...carrierSite, senderSiteId: siteCode(t.sender).id, receiverSiteId: siteCode(t.receiver).id, ...(vehicle ? { vehicleId: vehicle.id } : {}),
    transportMode: t.mode, ...(t.mode === "EXTERNAL_CARRIER" ? { externalHirer: "SENDER", transportDetails: { carrierName: "Công ty Vận tải Thuê Ngoài Phương Bắc" } } : {}), ...(t.mode === "SELF_DELIVERY" ? { driverUserId: bootstrap.users[`${t.sender}Staff`].id } : {}),
    origin: `${enterprises[t.sender].area}, ${enterprises[t.sender].province}`, destination: `${enterprises[t.receiver].area}, ${enterprises[t.receiver].province}`,
    plannedPickupAt: new Date(Date.now() + 3600000).toISOString(), plannedDeliveryAt: new Date(Date.now() + 8 * 3600000).toISOString(), lines: [{ lotId: lot.id, quantity: qty(t.quantity), unit: lot.unit ?? "kg" }], note: t.purpose,
  }, `transfer:${t.code}`));
  transferState[t.code] = { id: created.id, vehicle: vehicle?.code ?? null };
  await save("transfers", transferState);
  return transferState[t.code];
}
async function consentAndPickup(t, stopAt = "PICKUP") {
  const { id } = await createTransfer(t);
  let row = await db.distributionTransfer.findUniqueOrThrow({ where: { id } });
  for (const key of parties(row, "CONSENT")) await attest(id, key, "CONSENT");
  if (stopAt === "CONSENT") return id;
  await handoverPhoto(id, "PICKUP", t.sender, `site/${stem(sitePhoto(t.sender))}`);
  row = await db.distributionTransfer.findUniqueOrThrow({ where: { id } });
  for (const key of parties(row, "PICKUP")) await attest(id, key, "PICKUP");
  return id;
}
async function receiveAndDeliver(t, split = {}) {
  const id = transferState[t.code].id;
  const row = await db.distributionTransfer.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  await handoverPhoto(id, "DELIVERY", t.receiver, `site/${stem(sitePhoto(t.receiver))}`);
  const issue = split.rejected || split.quarantined ? unwrap(await evidence(t.receiver, "TRANSFER", id, "TRANSFER_IMAGE", `site/${stem(sitePhoto(t.receiver))}`, "receipt")) : null;
  const fresh = await db.distributionTransfer.findUniqueOrThrow({ where: { id } });
  await api(actors[t.receiver], `/distribution/transfers/${id}/receipt`, {
    version: fresh.version, lines: row.lines.map((l) => { const total = Number(l.quantity), bad = split.rejected ?? 0, hold = split.quarantined ?? 0; return { lotId: l.lotId, received: qty(total - bad), rejected: qty(bad), quarantined: qty(hold) }; }),
    ...(issue ? { photos: [issue.id] } : {}),
    reason: split.reason ?? "Đã đối chiếu đủ số lượng và tình trạng hàng.",
  }, `transfer-receipt:${id}`);
  for (const key of parties(row, "DELIVERY")) await attest(id, key, "DELIVERY");
  transferState[t.code].delivered = true;
  await save("transfers", transferState);
}
async function fullTransfer(t) {
  if (transferState[t.code]?.delivered) return;
  await consentAndPickup(t);
  await receiveAndDeliver(t);
}
// GPS: xe chạy nền với tốc độ thật trong lúc các phiếu khác được seed.
const COORD = { "Đồng Tháp": [10.35, 106.1], "Đồng Nai": [10.93, 107.24], "Lâm Đồng": [11.8, 108.5], "Tây Ninh": [10.85, 106.42], "Hưng Yên": [20.93, 105.94], "Đà Nẵng": [15.88, 108.33], "Thái Nguyên": [21.42, 105.93], "An Giang": [10.3, 105.3], "Đắk Lắk": [12.78, 108.1], "Sơn La": [20.85, 104.63], "Bắc Ninh": [21.15, 106.2], "Cần Thơ": [10.09, 105.75], "Hà Nội": [21.03, 105.85], "TP. Hồ Chí Minh": [10.85, 106.77] };
const trips = [];
function startTrip(t, device, startedAt) {
  const from = COORD[enterprises[t.sender].province], to = COORD[enterprises[t.receiver].province];
  const km = Math.max(5, Math.hypot((to[0] - from[0]) * 111, (to[1] - from[1]) * 106));
  trips.push({ t, device, from, to, km, startedAt });
}
async function tripTick() {
  for (const trip of trips) {
    const hours = (Date.now() - trip.startedAt) / 3600000, progress = Math.min(1, (hours * 70) / trip.km);
    const jitter = () => (Math.random() - 0.5) * 0.0004;
    await deviceUpload(trip.device, "positions", [{ sequence: ++trip.device.sequence, recordedAt: new Date().toISOString(), latitude: Number((trip.from[0] + (trip.to[0] - trip.from[0]) * progress + jitter()).toFixed(6)), longitude: Number((trip.from[1] + (trip.to[1] - trip.from[1]) * progress + jitter()).toFixed(6)), accuracyM: 8, speedKmh: 70 }]);
  }
}
let lastTick = 0;
async function maybeTick() {
  if (!trips.length || Date.now() - lastTick < 60000) return;
  lastTick = Date.now();
  await tripTick();
}
const mainTransfers = scenario.transfers.filter((t) => t.outcome === "DELIVERED");
const finishedLeg = (t) => !!scenario.runs.find((r) => r.outputLot === t.lot);
const transfers = await step("distribution", async () => {
  const gps = mainTransfers.filter((t) => t.gps && !finishedLeg(t));
  const dependsOn = (t) => mainTransfers.find((x) => x.lot === t.lot && x.receiver === t.sender);
  for (const t of gps) {
    if (transferState[t.code]?.delivered) continue;
    const vehicle = resources.vehicles.find((v) => v.code === t.vehicle);
    const owner = enterprises[t.carrier]?.type ? t.carrier : t.sender;
    const device = await deviceFor(owner, "GPS_TRACKER", `AGT-${t.vehicle}-GPS`, `GPS xe ${vehicle.registration}`, { vehicleId: vehicle.id });
    await consentAndPickup(t);
    busyVehicles.add(t.vehicle);
    startTrip(t, device, Date.now());
  }
  const started = new Set(gps.map((t) => t.code));
  const deferred = [];
  for (const [i, t] of mainTransfers.filter((x) => !finishedLeg(x) && !started.has(x.code)).entries()) {
    const dep = dependsOn(t);
    if (dep && started.has(dep.code)) { deferred.push(t); continue; }
    await fullTransfer(t);
    await maybeTick();
    if (i % 25 === 0) console.log(`Distribution ${i + 1}`);
  }
  const minimum = Date.now() + 12 * 60000;
  while (Date.now() < minimum && trips.length) { await tripTick(); await new Promise((r) => setTimeout(r, 60000)); }
  for (const trip of trips.splice(0)) { await receiveAndDeliver(trip.t); busyVehicles.delete(trip.t.vehicle); }
  for (const t of deferred) await fullTransfer(t);
  return true;
});
const processing = await step("processing", async () => {
  const result = [];
  const typeOf = (p) => ({ "Trái cây sấy": "DRYING", "Đồ uống": "JUICE_EXTRACT", "Bánh và bột": "MILLING" })[p.category] ?? "OTHER";
  for (const r of scenario.runs) {
    const p = productOf[r.product], key = r.owner, actor = actors[key], chain = chainOf(r.chain), site = siteCode(key), product = resources.products.find((x) => x.slug === r.product);
    let externalInputs = [], inputs = [];
    if (r.crossChainInput) inputs = [{ lotId: lotByCode(r.crossChainInput).id, quantity: qty(r.inputQty) }];
    else {
      const supplier = (await db.enterpriseExternalPartner.findFirst({ where: { organizationId: actor.organizationId, name: "Công ty Mía Đường Sông Lam Xanh" } })) ?? (await db.enterpriseExternalPartner.create({ data: { organizationId: actor.organizationId, businessId: `AGT-NCC-${key}`, name: "Công ty Mía Đường Sông Lam Xanh", kind: "FARM", address: "Nghệ An" } }));
      const receipt = unwrap(await api(actor, "/processing-runs/receipts", { siteId: site.id, materialName: "Mía nguyên liệu", supplierId: supplier.id, documentNo: `HD-${r.code}`, receivedAt: day(-3), quantity: qty(r.inputQty), unit: "kg", expiryDate: day(60).slice(0, 10), note: "Nguyên liệu mua ngoài theo chứng từ." }, `receipt:${r.code}`));
      await evidence(key, "MATERIAL_RECEIPT", receipt.id, "INVOICE", "document/kiemdinhkiemnghiem");
      externalInputs = [{ receiptId: receipt.id, quantity: qty(r.inputQty) }];
    }
    const run = unwrap(await api(actor, "/processing-runs", { chainId: chain.id, siteId: site.id, productId: product.id, baseUnit: "kg", processType: typeOf(p), recipe: "Tiếp nhận, phân loại, sơ chế, chế biến theo mẻ và đóng gói kín.", inputs, externalInputs, note: "Đối soát khối lượng nguyên liệu, thành phẩm và hao hụt theo mẻ." }, `processing:${r.code}`));
    const started = unwrap(await api(actor, `/processing-runs/${run.id}/start`, { version: run.version }, `processing-start:${run.id}`));
    for (const [n, [stepName, note]] of [["SORTING", "Phân loại, loại bỏ nguyên liệu không đạt."], ["PRELIMINARY", "Sơ chế theo quy trình của sản phẩm."], ["PACKING", "Đóng gói và dán tem lô."]].entries())
      await api(actor, `/processing-runs/${run.id}/logs`, { step: stepName, occurredAt: new Date().toISOString(), note }, `processing-log:${run.id}:${n}`);
    const outputQty = Math.min(r.outputQty, r.inputQty), lossQty = r.inputQty - outputQty;
    if (p.unit !== "kg") await api(actor, "/processing-runs/unit-conversions", { productId: product.id, unit: p.unit, baseUnit: "kg", factor: "1", note: "Quy đổi theo khối lượng đóng chai." }, `unit-conversion:${product.id}`);
    const lot = scenario.lots.find((l) => l.code === r.outputLot);
    const currentRun = await db.processingRun.findUniqueOrThrow({ where: { id: run.id } });
    const done = currentRun.status === "COMPLETED" ? currentRun : unwrap(await api(actor, `/processing-runs/${run.id}/complete`, { version: currentRun.version, output: { quantity: qty(outputQty), unit: p.unit, lotName: `${p.name} - mẻ 1`, packaging: p.unit === "kg" ? "Túi kín 500 g" : "Chai 1 lít", packageCount: Math.max(1, Math.round(outputQty)), expiryDate: day(lot.expiryDay).slice(0, 10) }, byProducts: [], losses: lossQty > 0 ? [{ reason: "MOISTURE", quantity: qty(lossQty), note: "Hao hụt trong quá trình sơ chế và chế biến." }] : [] }, `processing-complete:${run.id}`));
    const created = await db.lot.findFirstOrThrow({ where: { processingRunId: run.id }, orderBy: { createdAt: "desc" } });
    finishedLots[r.outputLot] = { id: created.id, code: r.outputLot, key, chainId: chain.id, unit: p.unit, productSlug: `product/${r.product}` };
    await save("finished-lots", finishedLots);
    result.push({ id: run.id, done: !!done });
    if (result.length % 10 === 0) console.log(`Processing ${result.length}/${scenario.runs.length}`);
  }
  return result;
});
await step("finished-distribution", async () => {
  for (const t of mainTransfers.filter(finishedLeg)) await fullTransfer(t);
  return true;
});
await step("situations", async () => {
  const extras = scenario.transfers.filter((t) => t.outcome !== "DELIVERED");
  for (const t of extras.filter((x) => x.outcome !== "IN_TRANSIT")) {
    if (t.outcome === "WAIT_CONSENT") await createTransfer(t);
    if (t.outcome === "WAIT_PICKUP") await consentAndPickup(t, "CONSENT");
    if (t.outcome === "SHORT_RECEIPT") { await consentAndPickup(t); await receiveAndDeliver(t, { rejected: Math.round(t.quantity * 0.2), reason: "Nhận thiếu do một phần hàng bị dập khi vận chuyển." }); }
    if (t.outcome === "QUARANTINE") { await consentAndPickup(t); await receiveAndDeliver(t, { quarantined: Math.round(t.quantity * 0.3), reason: "Một phần hàng đưa vào cách ly chờ kiểm tra." }); }
    if (t.outcome === "CANCELLED") { const { id } = await createTransfer(t); const row = await db.distributionTransfer.findUniqueOrThrow({ where: { id } }); await api(actors[t.sender], `/distribution/transfers/${id}/cancel`, { version: row.version }, `transfer-cancel:${id}`); }
  }
  for (const t of extras.filter((x) => x.outcome === "IN_TRANSIT")) await consentAndPickup(t);
  return true;
});
await step("compliance", async () => {
  const sample = production.lots.filter((_, i) => i % 8 === 0);
  for (const lot of sample) await api(actors.reviewer, "/inspections", { lotId: lot.id, result: "PASS", inspectedAt: day(-1), note: "Kiểm tra độc lập theo phân công của tổ chức kiểm định." }, `inspection:${lot.id}`);
  for (const s of scenario.situations.filter((x) => x.kind === "RECALL")) {
    const lot = lotByCode(s.lot);
    await api(actors[lot.key], "/distribution/notices", { lotId: lot.id, kind: "RECALL", message: "Tạm dừng lưu thông lô để kiểm tra tình trạng bao bì và đối chiếu chất lượng." }, `recall:${lot.id}`);
  }
  return true;
});
await step("billing-reference-correction", async () => {
  const plan = await db.servicePlanVersion.findFirstOrThrow({
    where: { planCode: "OWNER_ENTERPRISE", status: "PUBLISHED" },
  });
  await db.$transaction(async (tx) => {
    await lockPlatformAudit(tx);
    const invalid = await tx.subscription.findMany({
      where: {
        status: "ACTIVE",
        planVersion: { planCode: "OWNER_ENTERPRISE" },
        organization: { participationStatus: "MEMBER" },
      },
    });
    for (const old of invalid) {
      const reason =
        "Điều chỉnh gói khởi tạo: thành viên không giữ gói chủ chuỗi; hủy snapshot không phù hợp và tạo snapshot đúng, không ghi thanh toán thật.";
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
          planCode: "OWNER_ENTERPRISE",
        },
      });
    }
  });
  return true;
});

await step("administration", async () => {
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
  for (const key of ["E01", "E03", "E04"])
    await api(
      actors[key],
      "/enterprise-billing/renewals",
      { planCode: "OWNER_ENTERPRISE" },
      `renewal-invoice-valid:${key}`,
    );
  return true;
});

await step("public-media", async () => {
  for (const lot of production.lots) await evidence(lot.key, "LOT", lot.id, "LOT_IMAGE", lot.productSlug, "public");
  for (const lot of Object.values(finishedLots)) await evidence(lot.key, "LOT", lot.id, "LOT_IMAGE", lot.productSlug, "public");
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
      where: { planCode: "OWNER_ENTERPRISE", status: "PUBLISHED" },
    });
    const user = await db.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: `HTX ${stage} `, type: "FARM", participationStatus: "CHAIN_OWNER" },
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
        const contractPdf = await mergeServiceContract({organizationName: org.name, representative: user.fullName,
          businessId: `AGT-${stage}`, billingName: org.name, billingEmail: email, billingAddress: "Đức Trọng, Lâm Đồng",
          planName: plan.planCode, planCode: plan.planCode, termMonths: plan.termMonths,
          setup: Number(plan.setupFee), annual: Number(plan.annualFee), total: Number(plan.setupFee+plan.annualFee),
          limits: plan.limits, reference: enrollment.id});
        const order = await tx.enterpriseServiceOrder.create({
          data: {
            enrollmentId: enrollment.id,
            planCode: plan.planCode,
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
            contractPdf: contractPdf.bytes, contractPdfHash: contractPdf.sha256, contractTemplateVersion: contractPdf.templateVersion,
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
  for (const [i, key] of ["E01", "E03", "E02"].entries())
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
  for (const [i, key] of ["E01", "E03", "E04"].entries()) {
    const cycle = production.cycles.filter((x) => x.key === key)[2],
      farm = resources.farms.find((x) => x.key === key);
    const document = unwrap(await evidence(key,"CYCLE",cycle.id,"CERTIFICATE_IMAGE","document/kiemdinhkiemnghiem"));
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
  for (const key of Object.keys(enterprises).filter((c) => enterprises[c].type !== "AUDITOR")) await evidence(key,"PROFILE",actors[key].organizationId,"OTHER",`logo/${key}`);
  for (const d of scenario.documents.filter((x) => !x.file.startsWith("MẪU") && x.type !== "Quyền sử dụng đất" && enterprises[x.owner].type !== "AUDITOR")) await evidence(d.owner,"PROFILE",actors[d.owner].organizationId,d.type === "Đăng ký doanh nghiệp" ? "BUSINESS_LICENSE" : "CERTIFICATE_IMAGE",`document/${stem(d.file)}`,d.type);
  for (const d of scenario.documents.filter((x) => x.file.startsWith("MẪU"))) await evidence(d.owner,"PROFILE",actors[d.owner].organizationId,"OTHER",`document/hop-dong-${d.owner}`,d.type);
  return true;
});

await step("cycle-team", async () => {
  for (const cycle of production.cycles)
    await api(actors[cycle.key],`/production-cycles/${cycle.id}/staff`,{staffUserIds:[actors[cycle.key].id,bootstrap.users[`${cycle.key}Manager`].id,bootstrap.users[`${cycle.key}Staff`].id]},`cycle-team:${cycle.id}`);
  return true;
});

await step("directory-publication", () => publishDatasetPresentation(db));

await step("consumer-content", async () => {
  const dir = new URL("news/", datasetDir);
  for (const name of (await readdir(dir)).sort()) {
    const text = await readFile(new URL(name, dir), "utf8");
    const field = (k) => new RegExp(`^${k}: (.*)$`, "m").exec(text)[1].trim();
    const body = text.split("BODY:").slice(1).join("BODY:").trim();
    const asset = manifest.photos.find((x) => x.key === `news/${name.replace(/\.txt$/, "")}`);
    const id = seedContentId(state.startedAt, `news-${name}`);
    await db.consumerNews.upsert({ where: { id }, update: {}, create: { id, title: field("TITLE"), summary: field("SUMMARY"), body, coverContent: await readFile(`${assets}/${asset.file}`), coverMimeType: "image/jpeg", isPublished: true, publishedAt: new Date(day(-Number(name.slice(0, 2)) * 3)) } });
  }
  const id = seedContentId(state.startedAt, "announcement");
  await db.consumerAnnouncement.upsert({ where: { id }, update: {}, create: { id, title: "Kiểm tra mã lô khi nhận hàng", body: "Quét mã QR trên tem để đối chiếu tên sản phẩm, ngày thu hoạch và thông tin giao nhận.", severity: "INFO", isActive: true, startsAt: new Date(day(-2)), endsAt: new Date(day(60)) } });
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
  finishedLots,
  transfers,
  processing,
});
console.log("Domain dataset stages completed.");
await save("processed-traces", await db.$queryRaw`
  SELECT q.lot_id AS "lotId", q.trace_token AS "traceToken"
  FROM trace_qr q JOIN lot l ON q.lot_id=l.lot_id
  WHERE l.origin_type='TRANSFORMATION'
`);
await db.$disconnect();
