import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../apps/api/src/generated/prisma/client.ts";

function isolatedDatabase() {
  const input = process.env.TEST_DATABASE_URL;
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.HYBRID_DRAFT_TESTS !== "1" ||
    process.env.HYBRID_CI_TESTS !== "1" ||
    process.env.FABRIC_ENABLED !== "false" ||
    !input ||
    process.env.DATABASE_URL !== input
  )
    throw new Error("ORM check requires explicit isolated CI inputs");
  const url = new URL(input);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.port !== "25488" ||
    url.pathname !== "/scope_test" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "ORM check requires the reserved isolated loopback database",
    );
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30000,
    windowsHide: true,
  }).trim();
  if (
    !/^[a-f0-9]{40}$/.test(sourceSha) ||
    process.env.HYBRID_CI_SHA !== sourceSha
  )
    throw new Error("ORM check requires the exact source SHA");
  return input;
}

let db;
let sourceSha;
try {
  db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: isolatedDatabase() }),
  });
  const plans = await db.shipmentPlan.findMany({
    include: {
      current: { include: { acceptances: true } },
      revisions: true,
      lot: { include: { harvest: { include: { cycle: true } } } },
    },
  });
  assert.equal(plans.length, 1);
  const original = plans[0];
  assert.equal(original.status, "FINALIZED");
  assert.equal(original.currentRevision, 2);
  assert.equal(original.current.acceptances.length, 3);
  assert.equal(original.revisions.length, 3);
  assert.equal(original.lot.harvest.cycle.chainId, original.chainId);
  const originalConsents = await db.shipmentPlanAcceptance.count({
    where: { planId: original.id },
  });
  assert.equal(originalConsents, 9);
  const assignments = await db.stageAssignment.findMany({
    include: { membership: true, cycle: true, lot: true, shipment: true },
  });
  assert.equal(assignments.length, 3);
  assert(
    assignments.every(
      (assignment) =>
        assignment.chainId === original.chainId &&
        assignment.status === "ACCEPTED",
    ),
  );
  const members = await db.chainMembership.findMany({
    where: { chainId: original.chainId },
    select: { organizationId: true },
  });
  const organizationCutovers = await db.organizationBusinessScope.count({
    where: {
      organizationId: { in: members.map((member) => member.organizationId) },
    },
  });
  assert.equal(organizationCutovers, 4);
  await db.chainBusinessProfile.update({
    where: { chainId: original.chainId },
    data: { state: "ACTIVE", version: { increment: 1 } },
  });
  const id = randomUUID();
  const current = await db.$transaction(async (tx) => {
    await tx.shipmentPlan.create({
      data: {
        id,
        chainId: original.chainId,
        lotId: original.lotId,
        currentRevision: 0,
      },
    });
    await tx.shipmentPlanRevision.create({
      data: {
        planId: id,
        revision: 0,
        producerOrgId: original.current.producerOrgId,
        transporterOrgId: original.current.transporterOrgId,
        retailerOrgId: original.current.retailerOrgId,
        quantity: "10.000",
        unit: "kg",
        origin: "farm",
        destination: "shop-v2",
        payloadDigest: "d".repeat(64),
      },
    });
    return tx.shipmentPlan.findUniqueOrThrow({
      where: { id },
      include: { current: true },
    });
  });
  assert.equal(current.current.planId, id);
  assert.equal(current.current.revision, 0);
  const consent = original.current.acceptances.find(
    (acceptance) => acceptance.party === "PRODUCER",
  );
  await db.shipmentPlanAcceptance.create({
    data: {
      planId: id,
      revision: 0,
      party: consent.party,
      organizationId: consent.organizationId,
      userId: consent.userId,
      grantId: consent.grantId,
      grantRevision: consent.grantRevision,
    },
  });
  const loaded = await db.shipmentPlan.findUniqueOrThrow({
    where: { id },
    include: {
      current: {
        include: {
          acceptances: {
            include: { user: true, organization: true, grant: true },
          },
        },
      },
    },
  });
  assert.equal(loaded.current.acceptances.length, 1);
  assert.equal(loaded.current.acceptances[0].grant.userId, consent.userId);
  console.log(
    JSON.stringify({
      result: "orm-schema-alignment-passed",
      sourceSha,
      originalAssignments: assignments.length,
      originalRevisions: original.revisions.length,
      originalConsents,
      organizationCutovers,
      deferredRevisionCreate: "passed",
      consentRelations: "passed",
      applicationWorkflowAcceptance: "not-evaluated",
      synthetic: true,
      fabricAcceptance: false,
    }),
  );
} catch {
  console.error("Isolated ORM check failed; no database details are printed.");
  process.exitCode = 1;
} finally {
  if (db)
    try {
      await db.$disconnect();
    } catch {
      console.error(
        "Isolated ORM cleanup failed; no database details are printed.",
      );
      process.exitCode = 1;
    }
}
