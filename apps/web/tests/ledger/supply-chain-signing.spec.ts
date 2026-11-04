import {test,expect} from "./fixtures";
import {chainId,bindingDigest,planId} from "./fixtures/supply-chain-signing";
import {organizationId} from "./fixtures/enterprise-membership";
import {keyPopMessage} from "../../src/lib/signing/canonical";
import {createPublicKey,verify} from "node:crypto";
import {resolve} from "node:path";

test("shipment finalize requires every party's current consent and unchanged exact stock",async({page,api})=>{
 await api.useActor("org-owner");await api.scenario("chains.signing");await page.goto(`/supply-chains/${chainId}/plans`);
 await expect(page.getByRole("heading",{name:"Kế hoạch giao nhận & đồng thuận",exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"Chốt kế hoạch",exact:true})).toHaveCount(0);
 await api.scenario("chains.stock-changed");await page.reload();
 await expect(page.getByText(/Tồn kho đã thay đổi/)).toBeVisible();
 await expect(page.getByRole("button",{name:"Chốt kế hoạch",exact:true})).toHaveCount(0);
 await api.scenario("chains.stock-exact");await page.reload();
 await expect(page.getByRole("button",{name:"Chốt kế hoạch",exact:true})).toBeVisible();
 expect(api.requests().some(r=>r.method==="POST"&&r.path.endsWith("/finalize"))).toBe(false);
});
