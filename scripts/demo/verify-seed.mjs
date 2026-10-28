import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { verificationInitialization } from "./verification-initialization.mjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../apps/api/dist/generated/prisma/client.js";
import { SIMULATED_NETWORK } from "../../apps/api/dist/modules/ledger/simulated-ledger.js";
import { pathToFileURL } from "node:url";
import { seedTarget } from "./seed-target.mjs";
const target = seedTarget();
const local = pathToFileURL(`${target.run}/`);
const { values } = parseArgs({ options: { fresh: { type: "boolean" } } });
const initialization = await verificationInitialization(local, values.fresh);
const url = new URL(target.databaseUrl);
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url.href }),
});
const accounts = JSON.parse(
  await readFile(new URL("accounts.json", local), "utf8"),
);
const dataset = JSON.parse(
  await readFile(new URL("dataset.json", local), "utf8"),
);
const tests = [],
  sessions = {};
async function request(route, actor, body) {
  let r;
  const commandKey = randomUUID();
  for (let attempt = 0; attempt < 8; attempt++) {
    r = await fetch(`${target.apiBase}${route}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(actor ? { Authorization: `Bearer ${actor}` } : {}),
        ...(body
          ? {
              "content-type": "application/json",
              "Idempotency-Key": commandKey,
            }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (r.status !== 429) break;
    await r.arrayBuffer();
    console.log("Verification is respecting the API rate limit.");
    await new Promise((resolve) => setTimeout(resolve, 60000));
  }
  const result = await r.json();
  return { status: r.status, data: result.data ?? result, error: result.error };
}
async function login(account) {
  const r = await request("/auth/login", null, {
    email: account.email,
    password: account.password,
  });
  assert.equal(r.status, 201, `Login ${account.role}`);
  return r.data.accessToken;
}
async function check(name, fn) {
  await fn();
  tests.push(name);
  console.log(`PASS ${name}`);
}
try {
  if (target.mode === "production") {
    // Real Fabric: wait until the Worker has delivered every committed event.
    const deadline = Date.now() + 45 * 60_000;
    while ((await db.blockchainOutbox.count({ where: { status: { not: "COMPLETED" } } })) > 0) {
      assert.equal(await db.blockchainOutbox.count({ where: { status: "DEAD_LETTER" } }), 0, "Fabric rejected an event");
      assert.ok(Date.now() < deadline, "Worker did not deliver every event to Fabric in time");
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  }
  const counts = {};
  for (const model of [
    "role",
    "user",
    "organization",
    "enterpriseProfile",
    "enterpriseEnrollment",
    "enterpriseServiceOrder",
    "enterpriseProfileAmendment",
    "enterpriseRole",
    "enterpriseMemberRole",
    "enterprisePartner",
    "enterpriseSite",
    "enterpriseVehicle",
    "productionMaterial",
    "farm",
    "plot",
    "product",
    "supplyChain",
    "productionCycle",
    "careRecord",
    "iotDevice",
    "sensorReading",
    "harvestEvent",
    "harvestSensorWindow",
    "lot",
    "shipment",
    "distributionTransfer",
    "distributionAttestation",
    "processingRun",
    "inspection",
    "certificate",
    "traceEvidence",
    "traceQr",
    "traceEvent",
    "blockchainOutbox",
    "blockchainProof",
    "commandCommit",
    "supportTicket",
    "supportMessage",
    "platformCase",
    "platformPrivacyTicket",
    "invoice",
    "subscription",
  ])
    counts[model] = await db[model].count();
  // Production keeps the controller's technical smoke catalog beside the dataset.
  const technical = target.mode === "production"
    ? { farm: await db.farm.count({ where: { name: "Production technical farm" } }),
        product: await db.product.count({ where: { productName: "Production technical product" } }) }
    : { farm: 0, product: 0 };
  await check(
    "Coverage: human roles, organization types, hierarchy and media",
    async () => {
      assert.ok(
        counts.user >= 30 &&
          counts.farm - technical.farm === 3 &&
          counts.product - technical.product === 28 &&
          counts.productionCycle >= 15 &&
          counts.lot >= 13 &&
          counts.traceEvidence >= 120,
      );
      const roleCodes = (
        await db.role.findMany({
          where: { users: { some: { accountStatus: "ACTIVE" } } },
        })
      ).map((x) => x.code);
      for (const role of [
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
      ])
        assert.ok(roleCodes.includes(role));
      assert.equal((await db.organization.groupBy({ by: ["type"] })).length, 6);
      for (const tier of [1, 2, 3])
        assert.ok(
          await db.user.count({
            where: { enterpriseTier: tier, accountStatus: "ACTIVE" },
          }),
        );
      assert.ok(
        counts.enterpriseMemberRole >= 14 && counts.platformPrivacyTicket >= 4,
      );
    },
  );
  await check("Quantity reconciliation and custody exclusivity", async () => {
    const inconsistent = await db.$queryRawUnsafe(
      `SELECT l.lot_id FROM lot l LEFT JOIN quantity_movement m ON m.lot_id=l.lot_id GROUP BY l.lot_id HAVING l.available_quantity <> COALESCE(sum(m.delta),0)`,
    );
    assert.equal(inconsistent.length, 0);
    const doublePath = await db.$queryRawUnsafe(
      `SELECT l.lot_id FROM lot l WHERE EXISTS(SELECT 1 FROM shipment s WHERE s.lot_id=l.lot_id) AND EXISTS(SELECT 1 FROM lot_holding h WHERE h.lot_id=l.lot_id)`,
    );
    assert.equal(doublePath.length, 0);
    const invalid = await db.$queryRawUnsafe(
      `SELECT l.lot_id FROM lot l WHERE EXISTS(SELECT 1 FROM lot_holding h WHERE h.lot_id=l.lot_id) AND l.available_quantity <> COALESCE((SELECT sum(h.quantity) FROM lot_holding h WHERE h.lot_id=l.lot_id),0)+COALESCE((SELECT sum(d.quantity) FROM distribution_line d JOIN distribution_transfer t ON t.id=d.transfer_id WHERE d.lot_id=l.lot_id AND t.status='IN_TRANSIT'),0)`,
    );
    assert.equal(invalid.length, 0);
    assert.equal(
      (
        await db.$queryRawUnsafe(
          `SELECT lot_id FROM lot_site_holding WHERE quantity<0 OR reserved<0 OR quarantined<0 OR reserved+quarantined>quantity`,
        )
      ).length,
      0,
    );
  });
  await check(
    "Real image bytes, stored hashes and public image projections",
    async () => {
      const evidence = await db.traceEvidence.findMany();
      for (const item of evidence) {
        assert.equal(
          createHash("sha256").update(item.content).digest("hex"),
          item.sha256,
        );
        assert.equal(item.size, item.content.length);
      }
      assert.ok(
        evidence.filter((x) => x.public && x.kind === "LOT_IMAGE").length >= 12,
      );
      assert.ok(
        new Set(
          evidence
            .filter((x) => x.kind === "PRODUCT_IMAGE")
            .map((x) => x.sha256),
        ).size >= 6,
      );
    },
  );
  await check(
    target.mode === "production"
      ? "Real Fabric bindings and a stored proof for every delivered event"
      : "Simulated bindings, no fabricated proof; complete SQL event/outbox chain",
    async () => {
      assert.ok((await db.fabricNetworkBinding.count()) > 0);
      if (target.mode === "production") {
        assert.equal(
          await db.fabricNetworkBinding.count({ where: { network: SIMULATED_NETWORK } }),
          0,
        );
        assert.equal(counts.blockchainProof, counts.blockchainOutbox);
      } else {
        assert.equal(counts.blockchainProof, 0);
        assert.equal(
          await db.fabricNetworkBinding.count({
            where: { network: { not: SIMULATED_NETWORK } },
          }),
          0,
        );
      }
      assert.equal(
        await db.traceEvent.count({ where: { bindingContext: null } }),
        0,
      );
      assert.equal(counts.traceEvent, counts.blockchainOutbox);
      assert.ok(counts.commandCommit > 100);
      assert.equal(
        await db
          .$queryRawUnsafe(
            `SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='trg_platform_audit_no_truncate' AND tgenabled='O'`,
          )
          .then((x) => x[0].n),
        1,
      );
    },
  );
  await check(
    "Sealed sensor windows keep DATA and NO_DATA distinct",
    async () => {
      const windows = await db.harvestSensorWindow.findMany();
      assert.equal(windows.length, counts.harvestEvent);
      assert.ok(windows.some((x) => x.readingCount > 0));
      assert.ok(windows.some((x) => x.status === "NO_DATA"));
      for (const w of windows) {
        assert.ok(w.sealedAt);
        if (w.status === "NO_DATA") {
          assert.equal(w.readingCount, 0);
          assert.equal(w.digestHash, null);
        } else assert.ok(w.readingCount > 0 && w.digestHash);
      }
    },
  );
  const expected = [
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
  for (const role of expected)
    await check(`Real authentication: ${role}`, async () => {
      const account = accounts.users.find(
        (x) =>
          x.role === role &&
          x.accountStatus === "ACTIVE" &&
          !x.mustChangePassword,
      );
      const token = await login(account);
      sessions[role] = token;
      assert.equal((await request("/auth/me", token)).status, 200);
    });
  await check(
    "Admin/reviewer cannot write production, and rejected commands preserve counts",
    async () => {
      const count = await db.productionCycle.count(),
        cycle = dataset.production.cycles[0];
      const body = {
        chainId: cycle.chainId,
        farmId: cycle.farmId,
        productId: cycle.productId,
        cycleCode: "FORBIDDEN-SEED-CHECK",
        harvestUnit: "kg",
      };
      for (const role of ["SYSTEM_ADMIN", "COMPLIANCE_REVIEWER"])
        assert.equal(
          (await request("/production-cycles", sessions[role], body)).status,
          403,
        );
      assert.equal(await db.productionCycle.count(), count);
    },
  );
  await check(
    "Cross-organization and tier-3 access remain denied",
    async () => {
      const berry = accounts.users.find(
          (x) => x.email === "berry.owner@example.test",
        ),
        staff = accounts.users.find(
          (x) => x.email === "farm.staff@example.test",
        );
      const b = await login(berry),
        s = await login(staff),
        cycle = dataset.production.cycles.find((x) => x.key === "farm");
      assert.ok(
        [403, 404].includes(
          (await request(`/production-cycles/${cycle.id}`, b)).status,
        ),
      );
      const before = await db.enterpriseRole.count();
      assert.equal(
        (
          await request("/enterprise-workspace/roles", s, {
            name: "Forbidden tier 3 role",
            permissions: ["members.manage"],
          })
        ).status,
        403,
      );
      assert.equal(await db.enterpriseRole.count(), before);
    },
  );
  await check(
    "Initial password gate and disabled/locked accounts",
    async () => {
      const first = accounts.users.find(
          (x) => x.email === "firstlogin@example.test",
        ),
        token = await login(first);
      assert.equal((await request("/enterprise-workspace", token)).status, 403);
      assert.equal((await request("/auth/me", token)).status, 200);
      for (const email of ["locked@example.test", "inactive@example.test"]) {
        const a = accounts.users.find((x) => x.email === email),
          r = await request("/auth/login", null, {
            email: a.email,
            password: a.password,
          });
        assert.ok([401, 403, 423].includes(r.status));
      }
    },
  );
  await check(
    "Public source-lot traces hide personal data and verify integrity",
    async () => {
      for (const lot of dataset.production.lots) {
        const r = await request(`/public/trace/${lot.traceToken}`);
        assert.equal(r.status, 200);
        const text = JSON.stringify(r.data);
        assert.equal(r.data.quantityReconciled, true);
        assert.equal(r.data.stateReconciled, true);
        assert.ok(!text.includes("@example.test"));
        assert.ok(!/passwordHash|accessToken|privateKey/.test(text));
        assert.ok(!text.includes("HASH_MISMATCH"));
      }
    },
  );
  await check(
    "Platform audit hash chain and privacy officer workspace",
    async () => {
      const audit = await request(
        "/platform-audit/verify",
        sessions.SYSTEM_ADMIN,
      );
      assert.equal(audit.status, 200);
      assert.equal(audit.data.ok, true);
      assert.equal(audit.data.firstInvalid, null);
      assert.equal(
        (await request("/platform-privacy", sessions.PLATFORM_PRIVACY_OFFICER))
          .status,
        200,
      );
      assert.equal(
        (await request("/platform-privacy", sessions.AUDITOR)).status,
        403,
      );
    },
  );
  const states = {};
  for (const [model, field] of [
    ["productionCycle", "currentState"],
    ["shipment", "status"],
    ["distributionTransfer", "status"],
    ["processingRun", "status"],
    ["supportTicket", "status"],
    ["enterpriseEnrollment", "status"],
  ])
    states[model] = await db[model].groupBy({ by: [field], _count: true });
  const receipt = {
    completedAt: new Date().toISOString(),
    database: "agri_trace",
    container: "agri-trace-demo-local-postgres-1",
    volume: "agri-trace-demo-local_postgres-data",
    newDatabasesCreated: initialization.newDatabasesCreated,
    fabricEnabled: false,
    counts,
    states,
    tests,
    initialization: initialization.initialization,
    backup: initialization.backup,
    limits: [
      "No real Fabric acceptance; Fabric is disabled.",
      "Stock photographs illustrate fictional entities; demo legal documents have no legal validity.",
      ...initialization.limits,
    ],
  };
  await writeFile(
    new URL("receipt.json", local),
    JSON.stringify(receipt, null, 2),
    { mode: 0o600 },
  );
  console.log(
    `Verification complete: ${tests.length} checks. ${counts.user} users, ${counts.lot} lots, ${counts.traceEvent} trace events.`,
  );
} finally {
  await db.$disconnect();
}
