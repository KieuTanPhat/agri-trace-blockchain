import {expect,it}from"vitest";
import {actorA}from"@/test/ledger-actors";
import type{AuthUser}from"../types";
import {WORKSPACE_NAV,PLATFORM_NAV,canonicalNavigationUrls} from "./navigation";
it("all Ledger navigation entries point to an existing canonical URL",()=>{
 expect([...WORKSPACE_NAV,...PLATFORM_NAV].flatMap(g=>g.items).filter(item=>!canonicalNavigationUrls.has(item.href)).map(item=>item.href)).toEqual([]);
});
type Destination=(user:AuthUser,next?:string)=>string;
const modules=import.meta.glob<{ledgerLoginDestination:Destination}>("./session-navigation.ts",{eager:true});
it("keeps baseline role landing and rejects another account's or foreign return URL",()=>{
 const go=modules["./session-navigation.ts"]?.ledgerLoginDestination;
 expect(go,"safe baseline login destination is missing").toBeTypeOf("function");
 expect(go!(actorA.user,"/admin/users")).toBe("/enterprise");
 expect(go!(actorA.user,"//evil.example/trace/token")).toBe("/dashboard");
 expect(go!({...actorA.user,role:{code:"SYSTEM_ADMIN",name:"Admin"},organizationId:null})).toBe("/admin");
 expect(go!({...actorA.user,mustChangePassword:true},"/lots")).toBe("/account/password");
 expect(go!(actorA.user,"/lots?q=TG&page=2")).toBe("/lots?q=TG&page=2");
});
