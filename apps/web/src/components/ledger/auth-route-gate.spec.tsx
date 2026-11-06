import {cleanup,fireEvent,render,screen,waitFor}from"@testing-library/react";
import {afterEach,beforeEach,expect,it,vi}from"vitest";
import type{ComponentType}from"react";
import {AuthProvider}from"@/lib/auth-store";
import {clearSession,readSession}from"@/lib/api-client";
import {toast} from "sonner";
import {actorA}from"@/test/ledger-actors";
const routing=vi.hoisted(()=>({replace:vi.fn(),path:"/enterprise"}));
vi.mock("next/navigation",()=>({usePathname:()=>routing.path,useRouter:()=>({replace:routing.replace})}));
const modules=import.meta.glob<{LedgerAuthRouteGate:ComponentType<{children:React.ReactNode}>}>("./auth-route-gate.tsx",{eager:true});
vi.mock("sonner",()=>({toast:{error:vi.fn()}}));
async function signOutFromMenu(){
  fireEvent.keyDown(screen.getByRole("button",{name:"Tài khoản"}),{key:"ArrowDown"});
  fireEvent.click(await screen.findByRole("menuitem",{name:"Đăng xuất"}));
}
let expired=true,anonymous=false,unavailable=false,rejectLogout=false;
beforeEach(()=>{clearSession(false);localStorage.clear();routing.replace.mockClear();expired=true;anonymous=false;unavailable=false;rejectLogout=false;vi.mocked(toast.error).mockClear();
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
    if(String(input).endsWith("/auth/refresh"))return anonymous?Response.json({success:false},{status:401}):Response.json({success:true,data:{...actorA,user:{...actorA.user,mustChangePassword:expired}}});
    if(String(input).endsWith("/auth/logout"))return Response.json({success:!rejectLogout},{status:rejectLogout?503:201});
    if(String(input).endsWith("/chain-permissions")&&unavailable)return Response.json({success:false,message:"Unavailable"},{status:503});
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

it("allows sign-out even when permission checks fail before private content can mount",async()=>{
  expired=false;unavailable=true;
  const Gate=modules["./auth-route-gate.tsx"].LedgerAuthRouteGate;
  render(<AuthProvider><Gate><div>PRIVATE_RECORD</div></Gate></AuthProvider>);
  await screen.findByText("Chưa xác minh được quyền truy cập");
  expect(screen.queryByText("PRIVATE_RECORD")).not.toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"Đăng xuất"})).not.toBeInTheDocument();
  await signOutFromMenu();
  await waitFor(()=>expect(readSession()).toBeNull());
  expect(routing.replace).toHaveBeenCalledWith("/login");
});
it("shows an error and allows retry when the logout server cannot be reached",async()=>{
  expired=false;unavailable=true;rejectLogout=true;
  const Gate=modules["./auth-route-gate.tsx"].LedgerAuthRouteGate;
  render(<AuthProvider><Gate><div>PRIVATE_RECORD</div></Gate></AuthProvider>);
  await screen.findByText("Chưa xác minh được quyền truy cập");
  expect(screen.queryByRole("button",{name:"Đăng xuất"})).not.toBeInTheDocument();
  await signOutFromMenu();
  await waitFor(()=>expect(toast.error).toHaveBeenCalledWith("Không thể đăng xuất. Kiểm tra kết nối máy chủ rồi thử lại."));
  expect(readSession()).not.toBeNull();
  expect(routing.replace).not.toHaveBeenCalledWith("/login");
  rejectLogout=false;
  expect(screen.queryByRole("button",{name:"Đăng xuất"})).not.toBeInTheDocument();
  await signOutFromMenu();
  await waitFor(()=>expect(readSession()).toBeNull());
});
