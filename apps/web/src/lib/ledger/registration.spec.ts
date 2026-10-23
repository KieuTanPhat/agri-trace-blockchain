import {expect,it}from"vitest";
import {registrationDefaults,type RegistrationDraft}from"../registration-form";
import type{components}from"../generated/api";
type Build=(draft:RegistrationDraft,id:string,proof:components["schemas"]["RegistrationOtpVerifiedView"],documents:string[])=>components["schemas"]["RegisterDto"];
const modules=import.meta.glob<{buildLedgerRegistration:Build;sanitizeLedgerRegistrationDraft:(input:unknown)=>RegistrationDraft}>("./registration.ts",{eager:true});
const draft:RegistrationDraft={...registrationDefaults,organizationName:"Hộ sản xuất kiểm thử",legalForm:"INDIVIDUAL_PRODUCER",representative:"Nguyễn An",fullName:"Nguyễn An",email:"owner@example.invalid",contactEmail:"contact@example.invalid",phone:"0912345678",provinceCode:"79",province:"Thành phố Hồ Chí Minh",wardCode:"001",ward:"Phường kiểm thử",address:"Số 1 đường kiểm thử",productGroups:"Xoài, Cam, Xoài",declaration:true,termsAccepted:true,privacyAcknowledged:true};
const proof={verificationId:"11111111-1111-4111-8111-111111111111",token:"fixture-otp-proof",expiresAt:"2026-10-24T00:00:00.000Z"};
it("builds the baseline v2 profile with one owner OTP and source-preserving requested capabilities",()=>{
 const build=modules["./registration.ts"]?.buildLedgerRegistration;expect(build,"Ledger registration payload builder is missing").toBeTypeOf("function");
 const payload=build!(draft,"22222222-2222-4222-8222-222222222222",proof,[]);
 expect(payload.requestId).toBe("22222222-2222-4222-8222-222222222222");
 expect(payload.emailVerifications).toEqual([{verificationId:"11111111-1111-4111-8111-111111111111",token:"fixture-otp-proof"}]);
 expect(payload.details).toMatchObject({formVersion:2,legalForm:"INDIVIDUAL_PRODUCER",activities:["FARM"],production:{sector:"CROP",productGroups:["Xoài","Cam"]},documentIds:[],declarationAccepted:true,termsAccepted:true,privacyAcknowledged:true,marketingAccepted:false});
 expect(payload).not.toHaveProperty("password");expect(payload).not.toHaveProperty("capabilities");
});
it("cannot manufacture policy acknowledgement for an unchecked registration",()=>{
 const build=modules["./registration.ts"]?.buildLedgerRegistration;expect(build).toBeTypeOf("function");
 expect(()=>build!({...draft,termsAccepted:false},"22222222-2222-4222-8222-222222222222",proof,[])).toThrow(/xác nhận|điều khoản/i);
});
it("draft persistence strips OTP/proof/files/attempt IDs and resets every acknowledgement",()=>{
 const sanitize=modules["./registration.ts"]?.sanitizeLedgerRegistrationDraft;expect(sanitize,"private draft sanitization is missing").toBeTypeOf("function");
 const safe=sanitize!({...draft,verificationId:proof.verificationId,token:proof.token,code:"123456",files:{LEGAL_REGISTRATION:"private-bytes"},requestId:"private-attempt",marketingAccepted:true});
 expect(safe.organizationName).toBe("Hộ sản xuất kiểm thử");expect(safe.declaration).toBe(false);expect(safe.termsAccepted).toBe(false);expect(safe.privacyAcknowledged).toBe(false);expect(safe.marketingAccepted).toBe(false);
 for(const key of ["verificationId","token","code","files","requestId"])expect(safe).not.toHaveProperty(key);
});
