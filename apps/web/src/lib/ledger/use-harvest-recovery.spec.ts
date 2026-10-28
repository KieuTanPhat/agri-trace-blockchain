import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {act,cleanup,renderHook,waitFor} from "@testing-library/react";
import {
  getHarvestRequestStatus,
  getProductionCycles,
  readSession,
  recordHarvest,
  request,
} from "@/lib/api-client";
import { acceptBusinessAccessRevision } from "@/lib/permission-sync";
import { useHarvestRecovery } from "./use-harvest-recovery";
import { getAuthorizationScope } from "@/lib/auth-scope";

const { user, auth } = vi.hoisted(() => {
  const user = {
    id: "87247bd2-c19b-4f9c-ab44-fd2ea5f96fa0",
    role: { code: "FARM_STAFF" },
    organizationId: "173f44c2-06ef-4221-8c75-f68e292415b0",
    accountStatus: "ACTIVE",
  };
  // useAuth() decorates the raw session user like AuthProvider does.
  return { user, auth: { user: user as typeof user & { accessRevision?: string } } };
});
vi.mock("@/lib/api-client", () => ({
  getHarvestRequestStatus: vi.fn(),
  getProductionCycles: vi.fn(),
  readSession: vi.fn(),
  recordHarvest: vi.fn(),
  request: vi.fn(),
}));
vi.mock("@/lib/auth-store", () => ({ useAuth: () => auth }));
const cycleId = "59c1b564-2736-4ea7-bdb5-701e20423f23";
const harvestEvidenceId = "b42eb5f4-b7c2-4d68-84b7-4f42fe0a0021";
const lotEvidenceId = "f8c20f73-d564-47de-a183-48ee75db763b";
const result = {
  lot: { id: "ad2fbfe8-5837-40db-b8f7-d22cfae5fba2", lotCode: "AUTO-1" },
  traceQr: { traceToken: "restored-qr" },
};

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_name: string, operation: () => Promise<unknown>) =>
        operation(),
    },
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  auth.user = user;
  vi.mocked(readSession).mockReturnValue({ user } as never);
  vi.mocked(getHarvestRequestStatus).mockResolvedValue({ status: "NOT_FOUND" });
  vi.mocked(request).mockResolvedValue({
    items: [
      {
        id: harvestEvidenceId,
        kind: "HARVEST_IMAGE",
        fileName: "harvest.jpg",
        supersedesId: null,
      },
      {
        id: lotEvidenceId,
        kind: "LOT_IMAGE",
        fileName: "lot.jpg",
        supersedesId: null,
      },
    ],
  } as never);
  vi.mocked(getProductionCycles).mockResolvedValue([
    {
      id: cycleId,
      version: 0,
      cycleCode: "CYCLE-1",
      currentState: "GROWING",
      harvestUnit: "kg",
      product: { productName: "Rice", defaultUnit: "kg" },
      farm: { name: "Farm" },
    },
  ] as never);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});


function show(){return renderHook(()=>useHarvestRecovery({scope:getAuthorizationScope(auth.user as never),onCreated:()=>undefined}));}
async function enter(h:ReturnType<typeof show>){
 await waitFor(()=>expect(h.result.current.recovery).not.toBeNull());await waitFor(()=>expect(h.result.current.cycles).toHaveLength(1));
 act(()=>h.result.current.selectCycle(cycleId));act(()=>{h.result.current.setQuantity("10");h.result.current.setLotName("Harvest lot");h.result.current.setEvidenceRef(harvestEvidenceId);h.result.current.setLotImageEvidenceRef(lotEvidenceId);});
 await act(()=>h.result.current.submit({preventDefault(){}} as never));
}
it("restores the committed original lot and QR after an uncertain response and remount",async()=>{
 vi.mocked(recordHarvest).mockRejectedValue(new Error("response lost"));const first=show();await enter(first);expect(recordHarvest).toHaveBeenCalledTimes(1);first.unmount();
 vi.mocked(getHarvestRequestStatus).mockResolvedValue({status:"COMMITTED",result});const second=show();await waitFor(()=>expect(second.result.current.created).toEqual(result));expect(recordHarvest).toHaveBeenCalledTimes(1);
});
it("reuses the original harvest key, timestamp and payload after remount",async()=>{
 vi.mocked(recordHarvest).mockRejectedValueOnce(new Error("request was not delivered"));const first=show();await enter(first);first.unmount();
 vi.mocked(recordHarvest).mockResolvedValue(result as never);const second=show();await enter(second);expect(second.result.current.created).toEqual(result);expect(vi.mocked(recordHarvest).mock.calls[1]).toEqual(vi.mocked(recordHarvest).mock.calls[0]);
});
it("uses the accepted permission revision carried by useAuth",async()=>{
 const revision="a".repeat(64);acceptBusinessAccessRevision(revision);auth.user={...user,accessRevision:revision};vi.mocked(recordHarvest).mockResolvedValue(result as never);const h=show();await enter(h);expect(h.result.current.created).toEqual(result);expect(recordHarvest).toHaveBeenCalledTimes(1);
});
it("refuses submission after an open scope's permission revision changes",async()=>{
 const revision="b".repeat(64);acceptBusinessAccessRevision(revision);auth.user={...user,accessRevision:revision};const h=show();acceptBusinessAccessRevision("c".repeat(64));await enter(h);expect(h.result.current.message).toMatch(/quyền đã thay đổi/);expect(recordHarvest).not.toHaveBeenCalled();
});
