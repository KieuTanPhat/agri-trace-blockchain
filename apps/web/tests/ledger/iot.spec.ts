import {test,expect} from "./fixtures";
import {cycleId} from "./fixtures/production-harvest";
test("IoT unknown response retries the exact original reading and key",async({page,api})=>{
 await api.useActor("org-owner");await api.scenario("iot.unknown");await page.goto("/iot-simulator");
 await page.getByRole("combobox",{name:"Vụ sản xuất",exact:true}).click();await page.getByRole("option",{name:"VU-001",exact:true}).click();
 await page.getByLabel("Mã thiết bị",{exact:true}).fill("device-1");await page.getByLabel("Giá trị",{exact:true}).fill("27.5");
 await page.getByRole("button",{name:"Gửi bản ghi",exact:true}).click();await expect(page.getByTestId("ledger-command-pending")).toBeVisible();
 const first=api.requests().find(r=>r.method==="POST"&&r.path==="/iot/readings")!;expect(JSON.parse(first.body!)).toMatchObject({cycleId,value:27.5,deviceId:"device-1"});
 await page.getByTestId("ledger-command-pending").getByRole("button",{name:"Đối soát",exact:true}).click();
 await expect(page.getByTestId("ledger-command-pending")).toHaveCount(0);
 const sent=api.requests().filter(r=>r.method==="POST"&&r.path==="/iot/readings");expect(sent).toHaveLength(2);expect(sent[1]).toEqual(first);
});
test("IoT validation rejection settles after journal inspection and preserves editable values",async({page,api})=>{
 await api.useActor("org-owner");await api.scenario("iot.rejected");await page.goto("/iot-simulator");
 await page.getByRole("combobox",{name:"Vụ sản xuất",exact:true}).click();await page.getByRole("option",{name:"VU-001",exact:true}).click();
 await page.getByLabel("Mã thiết bị",{exact:true}).fill("device-1");await page.getByLabel("Giá trị",{exact:true}).fill("27.5");
 await page.getByRole("button",{name:"Gửi bản ghi",exact:true}).click();await expect(page.getByText("Chu kỳ không ở trạng thái nhận dữ liệu cảm biến",{exact:true})).toBeVisible();
 await expect(page.getByTestId("ledger-command-pending")).toBeVisible();
 await page.getByTestId("ledger-command-pending").getByRole("button",{name:"Đối soát",exact:true}).click();
 await expect(page.getByTestId("ledger-command-pending")).toHaveCount(0);await expect(page.getByLabel("Giá trị",{exact:true})).toHaveValue("27.5");
 expect(api.requests().filter(r=>r.method==="POST"&&r.path==="/iot/readings")).toHaveLength(1);
});
