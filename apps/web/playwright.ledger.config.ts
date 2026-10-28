import {defineConfig} from "@playwright/test";
import path from "node:path";
const root=path.resolve(__dirname,"../..");
export default defineConfig({
  testDir:"./tests/ledger",fullyParallel:false,workers:1,retries:0,reporter:"dot",timeout:30_000,
  outputDir:path.join(root,".superpowers/sdd/2026-10-22-ledger-ui-migration/browser-results"),
  use:{baseURL:"http://127.0.0.1:3300",viewport:{width:1440,height:900},screenshot:"off",trace:"off",actionTimeout:10_000},
  projects:[{name:"contract",use:{browserName:"chromium"}}],
  webServer:{command:"npm run dev --workspace apps/web -- --hostname 127.0.0.1 --port 3300",cwd:root,url:"http://127.0.0.1:3300/login",reuseExistingServer:false,timeout:120_000,stdout:"ignore",stderr:"pipe",env:{NEXT_PUBLIC_API_SAME_ORIGIN:"true",NEXT_PUBLIC_MOCK_API:"false",NEXT_PUBLIC_USE_MOCK_API:"false",NEXT_PUBLIC_API_MODE:"api",NEXT_TELEMETRY_DISABLED:"1"}},
});
