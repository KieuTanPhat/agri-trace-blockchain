import {expect,it}from"vitest";
import {actorA}from"@/test/ledger-actors";
import type{AuthUser}from"../types";
type Destination=(user:AuthUser,next?:string)=>string;
const modules=import.meta.glob<{ledgerLoginDestination:Destination}>("./session-navigation.ts",{eager:true});
it("keeps baseline role landing and rejects another account's or foreign return URL",()=>{
 const go=modules["./session-navigation.ts"]?.ledgerLoginDestination;
 expect(go,"safe baseline login destination is missing").toBeTypeOf("function");
 expect(go!(actorA.user,"/admin/users")).toBe("/enterprise");
 expect(go!(actorA.user,"//evil.example/trace/token")).toBe("/enterprise");
 expect(go!({...actorA.user,role:{code:"SYSTEM_ADMIN",name:"Admin"},organizationId:null})).toBe("/admin");
 expect(go!({...actorA.user,mustChangePassword:true},"/lots")).toBe("/account/password");
 expect(go!(actorA.user,"/lots?q=TG&page=2")).toBe("/lots?q=TG&page=2");
});
