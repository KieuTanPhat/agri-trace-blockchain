import {test,expect} from "@playwright/test";

test("offline navigation cannot serve a previous account or trace response",async({page,context})=>{
  await page.goto("/offline.html");
  await page.evaluate(async()=>{
    const legacy=await caches.open("agri-traceability-retired");
    await legacy.put("/lots",new Response("PRIVATE_ACCOUNT_A"));
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  // Simulate a cache left by an older app/account and an unrelated worker.
  await page.evaluate(async()=>{
    const old=await caches.open("unrelated-old-account");
    for(const path of ["/lots","/trace/old-token","/offline.html"])
      await old.put(path,new Response("PRIVATE_ACCOUNT_A",{headers:{"Content-Type":"text/html"}}));
  });
  expect(await page.evaluate(()=>caches.has("agri-traceability-retired"))).toBe(false);
  expect(await page.evaluate(async()=>{
    const cache=await caches.open("agri-traceability-ledger-v1");
    return (await cache.keys()).map(r=>new URL(r.url).pathname);
  })).toEqual(["/offline.html"]);
  await context.setOffline(true);
  expect(await page.evaluate(()=>fetch("/api/lots").then(()=>"unexpected response",()=>"network error"))).toBe("network error");
  for(const path of ["/lots","/trace/old-token"]){
    await page.goto(path);
    await expect(page.getByRole("heading",{name:"Chưa có kết nối mạng"})).toBeVisible();
    await expect(page.locator("body")).not.toContainText("PRIVATE_ACCOUNT_A");
  }
  await context.setOffline(false);
});
