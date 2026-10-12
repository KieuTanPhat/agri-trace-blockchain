import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { TraceService } from "../../apps/api/dist/modules/trace/trace.service.js";

/** Domain rows are synthetic fixtures; invitations, consents, revisions and
 * finalization all go through the real UI/API with separate JWT sessions. */
export async function checkPartyConsent({
  db,
  page,
  browser,
  owner,
  transport,
  retail,
  chain,
  login,
  until,
  cases,
  control,
  setLastPage,
}) {
  const contexts = [];
  const form = (target, title) =>
    target
      .locator("form")
      .filter({
        has: target.getByRole("button", { name: title, exact: true }),
      });
  async function select(target) {
    await target.reload();
    await target
      .getByRole("combobox", { name: /^Chọn chuỗi/ })
      .locator(`option[value="${chain.id}"]`)
      .waitFor({ state: "attached" });
    await target
      .getByText("Đang tải chuỗi được cấp quyền…", { exact: true })
      .waitFor({ state: "hidden" });
    await target
      .getByRole("combobox", { name: /^Chọn chuỗi/ })
      .selectOption(chain.id);
    await target
      .getByRole("region", { name: "Trạng thái nghiệp vụ chuỗi" })
      .getByText("Đang hoạt động", { exact: true })
      .waitFor();
  }
  async function submit(target, title, path) {
    const response = target.waitForResponse(
      (reply) =>
        reply.request().method() === "POST" && reply.url().endsWith(path),
    );
    await form(target, title)
      .getByRole("button", { name: title, exact: true })
      .click();
    return response;
  }
  try {
    const partners = [];
    for (const user of [transport, retail]) {
      setLastPage(page);
      await select(page);
      const invitation = form(page, "Mời đối tác");
      await invitation.getByLabel(/^Tổ chức/).selectOption(user.organizationId);
      assert.equal(
        (
          await submit(
            page,
            "Mời đối tác",
            `/supply-chains/${chain.id}/memberships`,
          )
        ).status(),
        201,
      );
      const context = await browser.newContext({
        viewport: { width: 1365, height: 900 },
      });
      contexts.push(context);
      const partner = await context.newPage();
      setLastPage(partner);
      await login(partner, user, false);
      await partner
        .getByRole("combobox", { name: /^Chọn chuỗi/ })
        .selectOption(chain.id);
      assert.equal(
        (
          await submit(
            partner,
            "Chấp nhận tham gia",
            `/supply-chains/${chain.id}/memberships/${user.organizationId}/accept`,
          )
        ).status(),
        201,
      );
      await until(
        async () =>
          (
            await db.chainMembership.findUniqueOrThrow({
              where: {
                chainId_organizationId: {
                  chainId: chain.id,
                  organizationId: user.organizationId,
                },
              },
            })
          ).status === "ACTIVE",
        "partner membership committed",
      );
      partners.push(partner);
    }
    cases.push("real-ui-invitations-and-current-partner-membership-consent");
    const lot = await db.$transaction(async (tx) => {
      const farm = await tx.farm.create({
        data: {
          organizationId: owner.organizationId,
          name: "Synthetic browser plan farm",
        },
      });
      const product = await tx.product.create({
        data: { productName: randomUUID(), defaultUnit: "kg" },
      });
      const created = await tx.productionCycle.create({
        data: {
          cycleCode: randomUUID(),
          farmId: farm.id,
          farmOrgId: owner.organizationId,
          chainId: chain.id,
          productId: product.id,
          maxHarvestQuantity: "10",
          harvestUnit: "kg",
        },
      });
      const cycle = await tx.productionCycle.update({
        where: { id: created.id },
        data: { currentState: "PLANTED", version: 1, startDate: new Date() },
      });
      await tx.stageAssignment.create({
        data: {
          chainId: chain.id,
          organizationId: owner.organizationId,
          cycleId: cycle.id,
          stage: "PRODUCTION",
          status: "ACCEPTED",
        },
      });
      const harvest = await tx.harvestEvent.create({
        data: {
          cycleId: cycle.id,
          harvestTime: new Date(),
          quantity: "10",
          unit: "kg",
        },
      });
      const lot = await tx.lot.create({
        data: {
          lotCode: randomUUID(),
          harvestId: harvest.id,
          productId: product.id,
          farmOrgId: owner.organizationId,
          initialQuantity: "10",
          availableQuantity: "10",
          unit: "kg",
        },
      });
      const trace = new TraceService(db, {});
      const event = await trace.createInTransaction(tx, {
        entityType: "HARVEST",
        entityId: harvest.id,
        cycleId: cycle.id,
        lotId: lot.id,
        eventType: "HARVEST_RECORDED",
        actor: {
          sub: owner.id,
          organizationId: owner.organizationId,
          role: "FARM_STAFF",
        },
        businessData: { quantity: "10", unit: "kg" },
      });
      await tx.quantityMovement.create({
        data: {
          lotId: lot.id,
          eventId: event.id,
          type: "HARVEST_IN",
          quantity: "10",
          unit: "kg",
          beforeQty: "0",
          delta: "10",
          afterQty: "10",
        },
      });
      return lot;
    });
    setLastPage(page);
    await select(page);
    const planning = page.getByRole("region", { name: "Kế hoạch vận chuyển" });
    await planning
      .getByRole("combobox", { name: /^Lô cần điều phối/ })
      .selectOption(lot.id);
    const create = form(page, "Lập kế hoạch mới");
    await create
      .getByLabel(/^Đơn vị vận chuyển/)
      .selectOption(transport.organizationId);
    await create
      .getByLabel(/^Đơn vị bán lẻ/)
      .selectOption(retail.organizationId);
    await create.getByLabel(/^Điểm lấy hàng/).fill("Synthetic browser farm");
    await create.getByLabel(/^Điểm giao hàng/).fill("Synthetic browser shop");
    assert.equal(
      (
        await submit(
          page,
          "Lập kế hoạch mới",
          `/supply-chains/${chain.id}/shipment-plans`,
        )
      ).status(),
      201,
    );
    const plan = await db.shipmentPlan.findFirstOrThrow({
      where: { lotId: lot.id },
    });
    const path = `/supply-chains/${chain.id}/shipment-plans/${plan.id}`;
    const titles = [
      "Xác nhận vai trò sản xuất",
      "Xác nhận vai trò vận chuyển",
      "Xác nhận vai trò bán lẻ",
    ];
    async function consentAll(revision) {
      for (const [index, target] of [page, ...partners].entries()) {
        setLastPage(target);
        await select(target);
        assert.equal(
          (await submit(target, titles[index], path + "/accept")).status(),
          201,
        );
      }
      assert.equal(
        await db.shipmentPlanAcceptance.count({
          where: { planId: plan.id, revision },
        }),
        3,
      );
    }
    await consentAll(0);
    const oldGrant = await db.scopedRoleGrant.findFirstOrThrow({
      where: {
        userId: transport.id,
        scope: "ORGANIZATION",
        role: "ORG_ADMIN",
        revokedAt: null,
      },
    });
    const newGrant = await db.$transaction(async (tx) => {
      await tx.scopedRoleGrant.update({
        where: { id: oldGrant.id },
        data: { revokedAt: new Date(), revision: { increment: 1 } },
      });
      return tx.scopedRoleGrant.create({
        data: {
          userId: transport.id,
          organizationId: transport.organizationId,
          scope: "ORGANIZATION",
          role: "ORG_ADMIN",
        },
      });
    });
    setLastPage(page);
    await select(page);
    const rejected = await submit(
      page,
      "Tạo chuyến theo kế hoạch đã xác nhận",
      path + "/finalize",
    );
    assert(
      rejected.status() >= 400 && rejected.status() < 500,
      "revoked consent must block finalization",
    );
    assert.equal(
      (await db.shipmentPlan.findUniqueOrThrow({ where: { id: plan.id } }))
        .status,
      "DRAFT",
    );
    assert.equal(await db.shipment.count({ where: { lotId: lot.id } }), 0);
    assert.equal(
      (
        await db.shipmentPlanAcceptance.findUniqueOrThrow({
          where: {
            planId_revision_party: {
              planId: plan.id,
              revision: 0,
              party: "TRANSPORTER",
            },
          },
        })
      ).grantId,
      oldGrant.id,
    );
    const revise = form(page, "Sửa kế hoạch và yêu cầu xác nhận lại");
    await revise
      .getByLabel(/^Đơn vị vận chuyển/)
      .selectOption(transport.organizationId);
    await revise
      .getByLabel(/^Đơn vị bán lẻ/)
      .selectOption(retail.organizationId);
    await revise.getByLabel(/^Điểm lấy hàng/).fill("Synthetic browser farm");
    await revise.getByLabel(/^Điểm giao hàng/).fill("Synthetic revised shop");
    assert.equal(
      (
        await submit(
          page,
          "Sửa kế hoạch và yêu cầu xác nhận lại",
          path + "/revise",
        )
      ).status(),
      201,
    );
    assert.equal(
      await db.shipmentPlanAcceptance.count({
        where: { planId: plan.id, revision: 1 },
      }),
      0,
    );
    await consentAll(1);
    assert.equal(
      (
        await db.shipmentPlanAcceptance.findUniqueOrThrow({
          where: {
            planId_revision_party: {
              planId: plan.id,
              revision: 1,
              party: "TRANSPORTER",
            },
          },
        })
      ).grantId,
      newGrant.id,
    );
    setLastPage(page);
    await select(page);
    assert.equal(
      (
        await submit(
          page,
          "Tạo chuyến theo kế hoạch đã xác nhận",
          path + "/finalize",
        )
      ).status(),
      201,
    );
    await until(
      async () =>
        (await db.shipmentPlan.findUniqueOrThrow({ where: { id: plan.id } }))
          .status === "FINALIZED",
      "atomic plan finalization",
    );
    assert.equal(await db.shipment.count({ where: { lotId: lot.id } }), 1);
    assert.equal(
      await db.shipmentPlanRevision.count({ where: { planId: plan.id } }),
      2,
    );
    assert.equal(
      await db.shipmentPlanAcceptance.count({ where: { planId: plan.id } }),
      6,
    );
    await page.screenshot({
      path: control + "/desktop-three-party-consent.png",
      fullPage: true,
    });
    cases.push(
      "three-party-current-consent-regrant-hold-new-revision-atomic-finalize",
    );
  } catch (error) {
    for (const [index, context] of contexts.entries()) {
      for (const [pageIndex, target] of context.pages().entries()) {
        await target
          .screenshot({
            path: `${control}/party-failure-${index}-${pageIndex}.png`,
            fullPage: true,
          })
          .catch(() => {});
        writeFileSync(
          `${control}/party-failure-${index}-${pageIndex}.html`,
          await target.content().catch(() => ""),
        );
      }
    }
    throw error;
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
}
