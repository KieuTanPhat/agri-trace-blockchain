import {expect,it}from"vitest";
import {getAuthorizationScope}from"../auth-scope";
import {actorA,actorB}from"@/test/ledger-actors";
import {ledgerQueryKey as key}from"./query-scope";
it("partitions private queries by account, organization and permission revision",()=>{
  expect(key(actorA.user,["products"])).toEqual(["ledger",getAuthorizationScope(actorA.user),"products"]);
  expect(key(actorA.user,["products"])).not.toEqual(key(actorB.user,["products"]));
  expect(key({...actorA.user,accessRevision:"next"},["products"])).not.toEqual(key(actorA.user,["products"]));
});
