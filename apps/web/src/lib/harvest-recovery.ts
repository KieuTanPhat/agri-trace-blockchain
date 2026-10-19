import {
  getHarvestRequestStatus,
  readSession,
  recordHarvest,
} from "./api-client";
import { getAuthorizationScope } from "./auth-scope";
import { currentBusinessAccessRevision } from "./permission-sync";
import type { components } from "./generated/api";

type HarvestInput = Omit<components["schemas"]["RecordHarvestDto"], "harvestTime">;
type Input = Pick<HarvestInput, "quantity" | "unit"> & Partial<Omit<HarvestInput, "quantity" | "unit">>;
type Status = components["schemas"]["HarvestRequestStatusDto"];
type Intent = {
  cycleId: string;
  key: string;
  harvestTime: string;
  fingerprint: string;
};
export type HarvestState = {
  version: 1;
  scope: string;
  revision: string;
  intent: Intent | null;
};
export type HarvestRecovery = { state: HarvestState; status?: Status };
export const HARVEST_STORAGE_PREFIX = "agritrace-harvest:v1:";
const storageError =
  "Không lưu hoặc đọc được yêu cầu thu hoạch. Chưa gửi yêu cầu mới; vui lòng kiểm tra trình duyệt hoặc liên hệ hỗ trợ.";
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function assertActor(scope: string) {
  const user = readSession()?.user;
  // The dialog's scope comes from useAuth(), which adds the accepted permission
  // revision; compare like with like so a permission change is still detected.
  if (
    !user ||
    user.role.code !== "FARM_STAFF" ||
    user.accountStatus !== "ACTIVE" ||
    getAuthorizationScope({
      ...user,
      accessRevision: currentBusinessAccessRevision(),
    }) !== scope
  )
    throw new Error("Tài khoản hoặc quyền đã thay đổi. Vui lòng mở lại trang.");
}

function read(scope: string): HarvestState {
  try {
    const raw = window.localStorage.getItem(HARVEST_STORAGE_PREFIX + scope);
    if (!raw) return { version: 1, scope, revision: "", intent: null };
    const state = JSON.parse(raw) as HarvestState;
    if (
      state.version !== 1 ||
      state.scope !== scope ||
      !uuid.test(state.revision)
    )
      throw new Error();
    const intent = state.intent;
    if (
      intent !== null &&
      (!intent ||
        !uuid.test(intent.cycleId) ||
        !uuid.test(intent.key) ||
        !/^[\da-f]{64}$/.test(intent.fingerprint) ||
        typeof intent.harvestTime !== "string" ||
        !Number.isFinite(Date.parse(intent.harvestTime)))
    )
      throw new Error();
    return state;
  } catch {
    throw new Error(storageError);
  }
}

function write(state: HarvestState) {
  try {
    const raw = JSON.stringify(state);
    window.localStorage.setItem(HARVEST_STORAGE_PREFIX + state.scope, raw);
    if (
      window.localStorage.getItem(HARVEST_STORAGE_PREFIX + state.scope) !== raw
    )
      throw new Error();
  } catch {
    throw new Error(storageError);
  }
}

async function locked<T>(
  scope: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!window.navigator.locks)
    throw new Error(
      "Trình duyệt chưa hỗ trợ ghi nhận thu hoạch an toàn. Vui lòng dùng phiên bản Chrome, Edge, Firefox hoặc Safari mới qua HTTPS.",
    );
  return window.navigator.locks.request(
    HARVEST_STORAGE_PREFIX + scope,
    async () => {
      assertActor(scope);
      return operation();
    },
  );
}

async function inspect(state: HarvestState): Promise<HarvestRecovery> {
  const status = state.intent
    ? await getHarvestRequestStatus(state.intent.cycleId, state.intent.key)
    : undefined;
  assertActor(state.scope);
  return { state, status };
}

export function recoverHarvest(scope: string): Promise<HarvestRecovery> {
  return locked(scope, () => inspect(read(scope)));
}

async function fingerprint(cycleId: string, input: Input, harvestTime: string) {
  const payload = { cycleId, ...input, harvestTime };
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function sendHarvest(
  scope: string,
  observedRevision: string,
  cycleId: string,
  input: Input,
): Promise<HarvestRecovery> {
  return locked(scope, async () => {
    let state = read(scope);
    // Another tab may have submitted or explicitly begun a later harvest.
    // A stale form may inspect that intent, but may never invent a replacement.
    if (state.revision !== observedRevision) {
      if (state.intent) return inspect(state);
      throw new Error(
        "Yêu cầu đã thay đổi ở tab khác. Vui lòng mở lại biểu mẫu.",
      );
    }
    if (state.intent) {
      const recovery = await inspect(state);
      if (recovery.status?.status !== "NOT_FOUND") return recovery;
      if (
        state.intent.cycleId !== cycleId ||
        state.intent.fingerprint !==
          (await fingerprint(cycleId, input, state.intent.harvestTime))
      )
        throw new Error(
          "Cần nhập lại đúng nội dung thu hoạch trước đó để thử lại. Chưa thể tạo yêu cầu khác khi kết quả chưa rõ.",
        );
    } else {
      if (
        !uuid.test(cycleId) ||
        !Number.isFinite(input.quantity) ||
        !Number.isInteger(input.version) ||
        (input.version ?? -1) < 0 ||
        input.quantity <= 0 ||
        Math.round(input.quantity * 1000) / 1000 !== input.quantity ||
        !input.unit.trim() ||
        input.unit.length > 30 ||
        !input.lotName?.trim() ||
        !input.representativeUserId || !uuid.test(input.representativeUserId) ||
        (input.additionalEvidenceRefs?.length ?? 0) > 4 ||
        (input.additionalEvidenceRefs ?? []).some((id) => !uuid.test(id) || id === input.evidenceRef) ||
        new Set(input.additionalEvidenceRefs ?? []).size !== (input.additionalEvidenceRefs?.length ?? 0) ||
        !input.evidenceRef || !uuid.test(input.evidenceRef) ||
        !input.lotImageEvidenceRef || !uuid.test(input.lotImageEvidenceRef)
      )
        throw new Error(
          "Nội dung thu hoạch chưa hợp lệ. Kiểm tra chu kỳ, tên lô, người đại diện, ảnh, số lượng và đơn vị trước khi gửi.",
        );
      const harvestTime = new Date().toISOString();
      state = {
        version: 1,
        scope,
        revision: crypto.randomUUID(),
        intent: {
          cycleId,
          key: crypto.randomUUID(),
          harvestTime,
          fingerprint: await fingerprint(cycleId, input, harvestTime),
        },
      };
      assertActor(scope);
      write(state); // Persist before the first possible domain write.
    }
    assertActor(scope);
    const intent = state.intent!;
    const result = await recordHarvest(
      cycleId,
      { ...input, harvestTime: intent.harvestTime } as components["schemas"]["RecordHarvestDto"],
      intent.key,
    );
    assertActor(scope);
    // Retain the intent even on success. Only an explicit new-harvest action
    // can replace it, so a stale tab/reload cannot turn a retry into a new Lot.
    return { state, status: { status: "COMMITTED", result } };
  });
}

export function beginNewHarvest(
  scope: string,
  observedRevision: string,
): Promise<HarvestState> {
  return locked(scope, async () => {
    const state = read(scope);
    if (state.revision !== observedRevision)
      throw new Error(
        "Yêu cầu đã thay đổi ở tab khác. Vui lòng kiểm tra kết quả trước.",
      );
    const recovery = await inspect(state);
    if (
      !state.intent ||
      !["COMMITTED", "REJECTED"].includes(recovery.status?.status ?? "")
    )
      throw new Error(
        "Chưa xác định được kết quả thu hoạch trước. Vui lòng kiểm tra lại hoặc liên hệ hỗ trợ.",
      );
    const next: HarvestState = {
      version: 1,
      scope,
      revision: crypto.randomUUID(),
      intent: null,
    };
    assertActor(scope);
    write(next);
    return next;
  });
}
