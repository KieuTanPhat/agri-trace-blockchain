import {cleanup,render,screen,waitFor}from"@testing-library/react";
import {afterEach,beforeEach,expect,it,vi}from"vitest";
import type{ComponentType}from"react";
import {AuthProvider}from"@/lib/auth-store";
import {clearSession}from"@/lib/api-client";
import {actorA}from"@/test/ledger-actors";
const routing=vi.hoisted(()=>({replace:vi.fn(),path:"/enterprise"}));
vi.mock("next/navigation",()=>({usePathname:()=>routing.path,useRouter:()=>({replace:routing.replace})}));
const modules=import.meta.glob<{LedgerAuthRouteGate:ComponentType<{children:React.ReactNode}>}>("./auth-route-gate.tsx",{eager:true});
let expired=true,anonymous=false;
beforeEach(()=>{clearSession(false);localStorage.clear();routing.replace.mockClear();expired=true;anonymous=false;
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
    if(String(input).endsWith("/auth/refresh"))return anonymous?Response.json({success:false},{status:401}):Response.json({success:true,data:{...actorA,user:{...actorA.user,mustChangePassword:expired}}});
    if(String(input).endsWith("/chain-permissions"))return Response.json({success:true,data:{accessRevision:"a".repeat(64),productionChains:[]}});
    throw new Error("Unexpected request");
  }));
});
afterEach(()=>{cleanup();clearSession(false);vi.unstubAllGlobals();});
for(const mode of ["expired","anonymous"]as const)it(`${mode} authority redirects before an unmigrated private child can mount`,async()=>{
  anonymous=mode==="anonymous";
  const Gate=modules["./auth-route-gate.tsx"]?.LedgerAuthRouteGate;
  expect(Gate,"root auth gate is missing").toBeTypeOf("function");if(!Gate)return;
  const mounted=vi.fn();function Private(){mounted();return <div>PRIVATE_RECORD</div>;}
  render(<AuthProvider><Gate><Private/></Gate></AuthProvider>);
  await waitFor(()=>expect(routing.replace).toHaveBeenCalledWith(mode==="expired"?"/account/password":"/login?next=%2Fenterprise"));
  expect(mounted).not.toHaveBeenCalled();expect(screen.queryByText("PRIVATE_RECORD")).not.toBeInTheDocument();
});
it("mounts the private child after current baseline authority is ready",async()=>{
  expired=false;
  const Gate=modules["./auth-route-gate.tsx"]?.LedgerAuthRouteGate;
  expect(Gate,"root auth gate is missing").toBeTypeOf("function");if(!Gate)return;
  render(<AuthProvider><Gate><div>CURRENT_PRIVATE_RECORD</div></Gate></AuthProvider>);
  await screen.findByText("CURRENT_PRIVATE_RECORD");
});
