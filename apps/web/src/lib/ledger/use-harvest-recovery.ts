"use client";
// AST extraction: pinned baseline non-rendering control flow only.
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { getProductionCycles } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import {
  beginNewHarvest,
  recoverHarvest,
  sendHarvest,
  type HarvestRecovery,
} from "@/lib/harvest-recovery";
import type { ProductionCycleOption } from "@/lib/types";
import {useWorkspaceData,type Items,type TraceEvidence} from "@/lib/workspace";

export function useHarvestRecovery({
  scope,
  onCreated,
}: {
  scope: string;
  onCreated(): void;
}){
const { user } = useAuth();

const busy = useRef(false);
const mounted = useRef(false);
const [recovery, setRecovery] = useState<HarvestRecovery | null>(null);
const [created, setCreated] = useState<{
    lot: { id: string; lotCode: string };
    traceQr: { traceToken: string };
  } | null>(null);
const [open,setOpen]=useState(false);
const [cycles, setCycles] = useState<ProductionCycleOption[]>([]);
const [cycleId, setCycleId] = useState("");
const [quantity, setQuantity] = useState("");
const [unit, setUnit] = useState("kg");
const [lotCode, setLotCode] = useState("");
const [lotName, setLotName] = useState("");
const [evidenceRef, setEvidenceRef] = useState("");
const [additionalEvidenceRefs, setAdditionalEvidenceRefs] = useState<string[]>([]);
const [lotImageEvidenceRef, setLotImageEvidenceRef] = useState("");
const [expiryDate, setExpiryDate] = useState("");
const [pending, setPending] = useState(false);
const [message, setMessage] = useState("");
const evidence = useWorkspaceData<Items<TraceEvidence>>(
    cycleId ? `/enterprise-workspace/evidence?entityType=CYCLE&entityId=${cycleId}` : null,
  );
const currentHarvestImages = (evidence.data?.items ?? []).filter(
    (row) => row.kind === "HARVEST_IMAGE" && !evidence.data?.items.some((newer) => newer.supersedesId === row.id),
  );
const currentLotImages = (evidence.data?.items ?? []).filter(
    (row) => row.kind === "LOT_IMAGE" && !evidence.data?.items.some((newer) => newer.supersedesId === row.id),
  );
const showError = useCallback((cause: unknown) => {
    if (!mounted.current) return;
    setMessage(
      cause && typeof cause === "object" && "message" in cause
        ? String(cause.message)
        : "Không xác định được kết quả thu hoạch. Vui lòng kiểm tra lại.",
    );
  }, []);
const applyRecovery = useCallback((next: HarvestRecovery) => {
    if (!mounted.current) return;
    setRecovery(next);
    if (next.state.intent) setCycleId(next.state.intent.cycleId);
    if (next.status?.status === "COMMITTED" && next.status.result) {
      setCreated(next.status.result);
      setMessage(
        "Đã tìm thấy lô của yêu cầu trước. Chọn ghi nhận lần thu hoạch mới nếu bạn muốn thu hoạch thêm.",
      );
      setOpen(false);
    } else if (next.status?.status === "REJECTED") {
      setMessage(
        "Yêu cầu trước đã bị từ chối và chưa tạo lô. Bạn có thể bắt đầu lần ghi nhận mới để sửa nội dung.",
      );
    } else if (next.state.intent) {
      setMessage(
        next.status?.status === "NOT_FOUND"
          ? "Chưa tìm thấy kết quả. Nhập lại đúng nội dung trước đó để thử lại cùng yêu cầu."
          : "Yêu cầu trước chưa rõ kết quả. Kiểm tra lại hoặc liên hệ hỗ trợ trước khi thu hoạch thêm.",
      );
    } else setMessage("");
  }, []);
useEffect(() => {
    mounted.current = true;
    getProductionCycles()
      .then((items) => {
        if (mounted.current)
          setCycles(
            items.filter((item) =>
              ["PLANTED", "GROWING"].includes(item.currentState),
            ),
          );
      })
      .catch(() => {
        if (mounted.current) setMessage("Không tải được chu kỳ sản xuất.");
      });
    void recoverHarvest(scope).then(applyRecovery).catch(showError);
    return () => {
      mounted.current = false;
    };
  }, [scope, applyRecovery, showError]);
async function checkPrevious() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      applyRecovery(await recoverHarvest(scope));
    } catch (cause) {
      showError(cause);
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
async function startNew() {
    if (busy.current || !recovery) return;
    busy.current = true;
    setPending(true);
    try {
      const state = await beginNewHarvest(scope, recovery.state.revision);
      if (!mounted.current) return;
      applyRecovery({ state });
      setCreated(null);
      setCycleId("");
      setQuantity("");
      setLotCode("");
      setLotName("");
      setEvidenceRef("");
      setAdditionalEvidenceRefs([]);
      setLotImageEvidenceRef("");
      setExpiryDate("");
      setOpen(true);
    } catch (cause) {
      showError(cause);
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
function selectCycle(id: string) {
    setCycleId(id);
    setEvidenceRef("");
    setAdditionalEvidenceRefs([]);
    setLotImageEvidenceRef("");
    const cycle = cycles.find((item) => item.id === id);
    setUnit(cycle?.harvestUnit || cycle?.product.defaultUnit || "kg");
  }
async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current || !recovery) return;
    busy.current = true;
    setPending(true);
    setMessage("");
    try {
      const result = await sendHarvest(
        scope,
        recovery.state.revision,
        cycleId,
        {
          version: cycles.find((cycle) => cycle.id === cycleId)?.version,
          quantity: Number(quantity),
          unit: unit.trim(),
          lotCode: lotCode.trim() || undefined,
          lotName: lotName.trim(),
          representativeUserId: representative(cycles.find((cycle) => cycle.id === cycleId), user?.id),
          evidenceRef,
          additionalEvidenceRefs: additionalEvidenceRefs as Parameters<typeof sendHarvest>[3]["additionalEvidenceRefs"],
          lotImageEvidenceRef,
          expiryDate: expiryDate || undefined,
        },
      );
      applyRecovery(result);
      if (mounted.current && result.status?.status === "COMMITTED") onCreated();
    } catch (cause) {
      showError(cause);
      // The request may have committed even when its response was lost.
      try {
        applyRecovery(await recoverHarvest(scope));
      } catch {
        /* Keep the original error and durable intent. */
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
return {busy,mounted,recovery,setRecovery,created,setCreated,open,setOpen,cycles,setCycles,cycleId,setCycleId,quantity,setQuantity,unit,setUnit,lotCode,setLotCode,lotName,setLotName,evidenceRef,setEvidenceRef,additionalEvidenceRefs,setAdditionalEvidenceRefs,lotImageEvidenceRef,setLotImageEvidenceRef,expiryDate,setExpiryDate,pending,setPending,message,setMessage,evidence,currentHarvestImages,currentLotImages,showError,applyRecovery,checkPrevious,startNew,selectCycle,submit};
}

/** The signed-in employee when assigned to the cycle, else its first assignee. */
function representative(cycle: { staffUserIds?: string[]; responsibleUserId: string | null } | undefined, me?: string) {
  const staff = cycle?.staffUserIds ?? [];
  if (me && staff.includes(me)) return me;
  return staff[0] ?? cycle?.responsibleUserId ?? me ?? "";
}
