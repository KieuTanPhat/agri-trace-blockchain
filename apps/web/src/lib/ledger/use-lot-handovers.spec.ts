import { webcrypto } from "node:crypto";
import {
  cleanup,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { act } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { useLotHandovers } from "./use-lot-handovers";
import {
  fromBase64Url,
  intentDigest,
  payloadDigest,
  signedMessage,
  toBase64Url,
  type PreparedIntent,
} from "@/lib/signing/canonical";
import { MemoryKeyStore } from "@/lib/signing/key-store";
import { createSigningKey } from "@/lib/signing/signer";

const api = vi.hoisted(() => ({
  request: vi.fn(),
  listPendingCommands: vi.fn().mockResolvedValue([]),
}));
const auth = vi.hoisted(() => ({
  user: {
    id: "one",
    organizationId: "00000000-0000-4000-8000-0000000000a1",
    role: { code: "FARM_STAFF" },
    accountStatus: "ACTIVE",
    accessRevision: "first",
  },
  privateAccessStatus: "ready",
}));
vi.mock("@/lib/api-client", () => api);
vi.mock("@/lib/auth-store", () => ({ useAuth: () => auth }));

const ids = {
  chain: "chain",
  farm: "00000000-0000-4000-8000-0000000000a1",
  carrier: "00000000-0000-4000-8000-0000000000a2",
  retailer: "00000000-0000-4000-8000-0000000000a3",
  shipment: "00000000-0000-4000-8000-0000000000b1",
};
let enrolled: Array<{
  keyRef: string;
  label: string;
  publicKey: string;
  organizationId: string;
  status: string;
}> = [];
let roles = ["FARM_STAFF", "TRANSPORTER", "RETAILER"];
function mockRequests(handler: (path: string, init?: RequestInit) => unknown) {
  api.request.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/chain-permissions")
      return Promise.resolve({
        businessChains: [ids.chain],
        memberships: [
          {
            chainId: ids.chain,
            organizationId: auth.user.organizationId,
            status: "ACTIVE",
          },
        ],
        capabilities: ["FARM", "TRANSPORTER", "RETAILER"].map((code) => ({
          organizationId: auth.user.organizationId,
          code,
          revokedAt: null,
        })),
        grants: roles.map((role) => ({
          chainId: ids.chain,
          organizationId: auth.user.organizationId,
          role,
          scope: "CHAIN",
          revokedAt: null,
        })),
      });
    if (path.endsWith("/signing-keys"))
      return Promise.resolve({
        chainId: ids.chain,
        chainRef: "00000000-0000-4000-8000-0000000000f1",
        organizationId: auth.user.organizationId,
        bindingDigest: "ab".repeat(32),
        handoverMode: "DUAL_SIGNED",
        keys: enrolled.filter(
          (key) => key.organizationId === auth.user.organizationId,
        ),
      });
    return Promise.resolve(handler(path, init));
  });
}
const handover = (overrides: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-0000000000c1",
  shipmentId: ids.shipment,
  chainId: "chain",
  kind: "PICKUP",
  state: "OFFERED",
  giverOrgId: ids.farm,
  receiverOrgId: ids.carrier,
  custodyLabel: "CROSS_ORG",
  quantity: "2.000",
  unit: "kg",
  shipmentVersion: 0,
  lotVersion: 0,
  note: null,
  reason: null,
  offerEventId: "00000000-0000-4000-8000-0000000000d1",
  resolveEventId: null,
  offeredAt: "2026-10-13T00:00:00.000Z",
  expiresAt: "2099-10-14T00:00:00.000Z",
  resolvedAt: null,
  ...overrides,
});

beforeAll(() => {
  vi.stubGlobal("crypto", webcrypto);
});
beforeEach(() => {
  auth.user = {
    id: "one",
    organizationId: ids.farm,
    role: { code: "FARM_STAFF" },
    accountStatus: "ACTIVE",
    accessRevision: "first",
  };
  auth.privateAccessStatus = "ready";
  enrolled = [];
  roles = ["FARM_STAFF", "TRANSPORTER", "RETAILER"];
  api.listPendingCommands.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  api.request.mockReset();
});

/** A prepared intent the way the API would return it for the given key. */
async function preparedFor(
  keyRef: string,
  overrides: { payload?: Record<string, string> } = {},
): Promise<PreparedIntent> {
  const payload = {
    handoverId: handover().id,
    shipmentId: ids.shipment,
    giverOrgId: ids.farm,
    receiverOrgId: ids.carrier,
    kind: "PICKUP",
    quantity: "2.000",
    unit: "kg",
    shipmentVersion: "0",
    offerExpiresAt: "2099-10-14T00:00:00.000Z",
    note: "",
    ...overrides.payload,
  };
  const notAfter = new Date(Date.now() + 15 * 60_000).toISOString();
  const intent = {
    protocol: "agritrace-intent/2",
    intentId: "00000000-0000-4000-8000-0000000000e1",
    chainRef: "00000000-0000-4000-8000-0000000000f1",
    bindingDigest: "ab".repeat(32),
    signerOrgRef: ids.farm,
    keyRef,
    operation: "HANDOVER_OFFER",
    entityType: "SHIPMENT",
    entityId: ids.shipment,
    eventId: "00000000-0000-4000-8000-0000000000e2",
    eventType: "HANDOVER_OFFERED",
    expectedVersion: "0",
    payloadDigest: await payloadDigest(payload),
    notAfter,
    policyVersion: "2",
  };
  return {
    intentId: intent.intentId,
    operation: intent.operation,
    keyRef,
    expiresAt: notAfter,
    intent,
    payload,
    intentDigest: await intentDigest(intent),
    signedMessage: toBase64Url(await signedMessage(intent)),
  };
}

async function newKey(store: MemoryKeyStore) {
  const key = await createSigningKey(store, {
    chainId: "chain",
    organizationId: ids.farm,
    bindingDigest: "ab".repeat(32),
    label: "Thiết bị văn phòng",
  });
  enrolled.push({ ...key, organizationId: ids.farm, status: "ACTIVE" });
  return key;
}


type Props=Parameters<typeof useLotHandovers>[0];
function view(overrides:Partial<Props>={}){
 const props:Props={chainId:ids.chain,shipmentId:ids.shipment,status:"CREATED",organizationId:ids.farm,farmOrgId:ids.farm,transporterOrgId:ids.carrier,retailerOrgId:ids.retailer,keyStore:new MemoryKeyStore(),...overrides};
 if(props.organizationId)auth.user.organizationId=props.organizationId;
 return renderHook((p:Props)=>useLotHandovers(p),{initialProps:props});
}
const offerPath="/shipments/"+ids.shipment+"/handover-offers/intent";
it("signs exactly the reviewed payload and sends only its verifiable signature",async()=>{
 const store=new MemoryKeyStore(),created=await newKey(store),prepared=await preparedFor(created.keyRef,{payload:{note:"Giao buổi sáng"}});
 mockRequests(path=>path.endsWith("/handovers")?[]:path===offerPath?prepared:{});
 const {result}=view({keyStore:store});await waitFor(()=>expect(result.current.canSign).toBe(true));
 await act(()=>result.current.prepare(offerPath,{kind:"PICKUP"},"Review"));
 expect(result.current.review?.prepared.payload).toMatchObject({quantity:"2.000",unit:"kg",note:"Giao buổi sáng"});
 expect(JSON.parse(api.request.mock.calls.find(([p])=>p===offerPath)![1].body)).toEqual({kind:"PICKUP",keyRef:created.keyRef,preparationRef:expect.any(String)});
 await act(()=>result.current.signAndSubmit());
 const submit=api.request.mock.calls.find(([p])=>String(p).endsWith("/submit"))!,body=JSON.parse(submit[1].body);
 expect(Object.keys(body)).toEqual(["signature"]);expect(submit[1].headers["idempotency-key"]).toBeTruthy();
 const stored=(await store.get(created.keyRef))!,publicKey=await webcrypto.subtle.importKey("spki",fromBase64Url(stored.publicKey),{name:"Ed25519"},false,["verify"]);
 expect(await webcrypto.subtle.verify({name:"Ed25519"},publicKey,fromBase64Url(body.signature),await signedMessage(prepared.intent))).toBe(true);
});
it("refuses a payload changed after preparation",async()=>{
 const store=new MemoryKeyStore(),created=await newKey(store),prepared=await preparedFor(created.keyRef);prepared.payload.quantity="999.000";
 mockRequests(path=>path.endsWith("/handovers")?[]:path===offerPath?prepared:{});
 const {result}=view({keyStore:store});await waitFor(()=>expect(result.current.canSign).toBe(true));
 await act(()=>result.current.prepare(offerPath,{kind:"PICKUP"},"Review"));await act(()=>result.current.signAndSubmit());
 expect(result.current.error).toBeTruthy();expect(api.request.mock.calls.some(([p])=>String(p).endsWith("/submit"))).toBe(false);
});
it("requires an explicit choice when two active local keys exist",async()=>{
 const store=new MemoryKeyStore(),one=await newKey(store);await newKey(store);mockRequests(()=>[]);
 const {result}=view({keyStore:store});await waitFor(()=>expect(result.current.activeKeys).toHaveLength(2));
 expect(result.current.keyRef).toBe("");expect(result.current.canSign).toBe(false);
 act(()=>result.current.setKeyRef(one.keyRef));expect(result.current.canSign).toBe(true);
});
it("rejects validity below 15 minutes before any intent POST",async()=>{
 const store=new MemoryKeyStore();await newKey(store);mockRequests(()=>[]);
 const {result}=view({keyStore:store});await waitFor(()=>expect(result.current.canSign).toBe(true));
 await act(()=>result.current.prepare(offerPath,{kind:"PICKUP",offerValidMinutes:14},"Review"));
 expect(result.current.error).toMatch(/15/);expect(api.request.mock.calls.some(([,init])=>init?.method==="POST")).toBe(false);
});
it("uses current chain grants and role for pickup and arrival",async()=>{
 mockRequests(()=>[]);const {result,unmount}=view();await waitFor(()=>expect(result.current.handovers).toEqual([]));
 expect(result.current.offerKind).toBe("PICKUP");roles=[];act(()=>result.current.refresh());await waitFor(()=>expect(result.current.canRole("FARM_STAFF")).toBe(false));expect(result.current.offerKind).toBeNull();unmount();
 roles=["TRANSPORTER"];const arrival=view({status:"IN_TRANSIT",organizationId:ids.carrier});await waitFor(()=>expect(arrival.result.current.offerKind).toBe("ARRIVAL"));
});
it("drops a late intent after the old authorization scope unmounts",async()=>{
 const store=new MemoryKeyStore(),created=await newKey(store),prepared=await preparedFor(created.keyRef);let deliver!:(p:PreparedIntent)=>void;
 mockRequests(path=>path===offerPath?new Promise<PreparedIntent>(r=>{deliver=r;}):[]);
 const {result,unmount}=view({keyStore:store});await waitFor(()=>expect(result.current.canSign).toBe(true));
 let flight!:Promise<void>;act(()=>{flight=result.current.prepare(offerPath,{kind:"PICKUP"},"Review");});unmount();await act(async()=>{deliver(prepared);await flight;});
 expect(result.current.review).toBeNull();expect(api.request.mock.calls.some(([p])=>String(p).endsWith("/submit"))).toBe(false);
});
it("clears signing review when refreshed grants revoke the current role",async()=>{
 const store=new MemoryKeyStore(),created=await newKey(store),prepared=await preparedFor(created.keyRef);
 mockRequests(path=>path===offerPath?prepared:[]);const {result}=view({keyStore:store});await waitFor(()=>expect(result.current.canSign).toBe(true));
 await act(()=>result.current.prepare(offerPath,{kind:"PICKUP"},"Review"));expect(result.current.review).not.toBeNull();roles=[];act(()=>result.current.refresh());
 await waitFor(()=>expect(result.current.canRole("FARM_STAFF")).toBe(false));expect(result.current.review).toBeNull();expect(result.current.offerKind).toBeNull();
});
it("an unresolved signed submission blocks another intent across remount",async()=>{
 api.listPendingCommands.mockResolvedValue([{operation:"SUBMIT_SIGNED_INTENT",idempotencyKey:"original"}]);
 const store=new MemoryKeyStore();await newKey(store);mockRequests(()=>[]);const {result}=view({keyStore:store});await waitFor(()=>expect(result.current.pending).toBe(true));await waitFor(()=>expect(result.current.canSign).toBe(true));
 await act(()=>result.current.prepare(offerPath,{kind:"PICKUP"},"Review"));expect(api.request.mock.calls.some(([p])=>p===offerPath)).toBe(false);
});
it("preserves exact rejection body and internal handover metadata",async()=>{
 mockRequests(path=>path.endsWith("/handovers")?[handover({custodyLabel:"INTERNAL_SAME_ORG"})]:{});
 const {result}=view();await waitFor(()=>expect(result.current.open?.custodyLabel).toBe("INTERNAL_SAME_ORG"));
 await act(()=>result.current.resolve(handover().id,"reject","Sai số lượng"));
 const call=api.request.mock.calls.find(([p])=>String(p).endsWith("/reject"))!;expect(JSON.parse(call[1].body)).toEqual({reason:"Sai số lượng"});expect(call[1].headers["idempotency-key"]).toBeTruthy();
});
