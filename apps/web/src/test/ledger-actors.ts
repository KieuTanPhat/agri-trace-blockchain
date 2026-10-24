import type { LoginResponse } from "@/lib/types";

export const actorA: LoginResponse = {
  tokenType:"Bearer",accessToken:"test-actor-a-token",
  user:{id:"11111111-1111-4111-8111-111111111111",organizationId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",email:"a@example.invalid",fullName:"Nguyễn An",accountStatus:"ACTIVE",role:{code:"FARM_STAFF",name:"Nhân viên sản xuất"}},
};
export const actorB: LoginResponse = {
  tokenType:"Bearer",accessToken:"test-actor-b-token",
  user:{id:"22222222-2222-4222-8222-222222222222",organizationId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",email:"b@example.invalid",fullName:"Trần Bình",accountStatus:"ACTIVE",role:{code:"FARM_STAFF",name:"Nhân viên sản xuất"}},
};
