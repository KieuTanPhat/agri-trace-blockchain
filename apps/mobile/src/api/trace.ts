import type { components } from "./generated/api";
import { TOKEN_PATTERN } from "../scan/parse-token";

export type PublicLot = components["schemas"]["PublicLotDto"];
type Fetcher = typeof fetch;

export class TraceApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value);
const timestamp = (value: unknown) =>
  text(value) && Number.isFinite(Date.parse(value));
const decimalQuantity = (value: unknown) =>
  text(value) && /^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(value);

function processingOrigin(value: unknown): boolean {
  return (
    record(value) &&
    text(value.code) &&
    text(value.processType) &&
    text(value.processorName) &&
    (value.completedAt === null || timestamp(value.completedAt)) &&
    Array.isArray(value.inputs) &&
    value.inputs.every(
      (input) =>
        record(input) &&
        text(input.lotCode) &&
        text(input.productName) &&
        text(input.producerName) &&
        finite(input.quantity) &&
        text(input.unit) &&
        ["HARVEST", "TRANSFORMATION"].includes(String(input.originType)) &&
        (input.harvestTime === null || timestamp(input.harvestTime)),
    )
  );
}

/** Validate rendered data as well as the generated compile-time contract. */
export function isPublicLot(value: unknown): value is PublicLot {
  if (!record(value)) return false;
  const { farmOrg, productionCycle, sensorEvidence, shipment } = value;
  return (
    ["lotId", "lotCode", "productName", "traceToken", "unit"].every((key) =>
      text(value[key]),
    ) &&
    TOKEN_PATTERN.test(value.traceToken as string) &&
    timestamp(value.harvestTime) &&
    finite(value.initialQuantity) &&
    finite(value.availableQuantity) &&
    (value.expiryDate === null || timestamp(value.expiryDate)) &&
    typeof value.isExpired === "boolean" &&
    typeof value.quantityReconciled === "boolean" &&
    typeof value.stateReconciled === "boolean" &&
    [
      "CONSUMED",
      "HARVESTED",
      "IN_TRANSPORT",
      "ARRIVED",
      "RETAIL_RECEIVED",
      "FOR_SALE",
      "SOLD",
      "RECALLED",
      "EXPIRED",
      "DAMAGED",
      "REJECTED",
    ].includes(String(value.currentState)) &&
    [
      "VERIFIED",
      "PENDING",
      "INTEGRITY_WARNING",
      "BLOCKCHAIN_UNAVAILABLE",
    ].includes(String(value.proofStatus)) &&
    record(farmOrg) &&
    text(farmOrg.name) &&
    ((value.originType === "HARVEST" &&
      value.processing === null &&
      record(productionCycle) &&
      text(productionCycle.cycleCode)) ||
      (value.originType === "TRANSFORMATION" &&
        productionCycle === null &&
        processingOrigin(value.processing))) &&
    record(sensorEvidence) &&
    ["FINALIZED", "NO_DATA", "NOT_APPLICABLE", "INTEGRITY_WARNING"].includes(
      String(sensorEvidence.status),
    ) &&
    finite(sensorEvidence.readingCount) &&
    finite(sensorEvidence.lateReadingCount) &&
    (sensorEvidence.periodStart === null ||
      timestamp(sensorEvidence.periodStart)) &&
    (sensorEvidence.periodEnd === null ||
      timestamp(sensorEvidence.periodEnd)) &&
    Array.isArray(value.allowedCommands) &&
    value.allowedCommands.length === 0 &&
    Array.isArray(value.warnings) &&
    value.warnings.every(text) &&
    (value.productionWarnings === undefined ||
      (Array.isArray(value.productionWarnings) &&
        value.productionWarnings.every(text))) &&
    (value.notices === undefined ||
      (Array.isArray(value.notices) &&
        value.notices.every(
          (notice) =>
            record(notice) &&
            ["WARNING", "RECALL"].includes(String(notice.kind)) &&
            text(notice.message) &&
            timestamp(notice.createdAt),
        ))) &&
    (value.distributionJourney === undefined ||
      (Array.isArray(value.distributionJourney) &&
        value.distributionJourney.every(
          (leg) =>
            record(leg) &&
            text(leg.senderName) &&
            text(leg.carrierName) &&
            text(leg.receiverName) &&
            text(leg.unit) &&
            decimalQuantity(leg.quantity) &&
            ["PROPOSED", "READY", "IN_TRANSIT", "DELIVERED"].includes(
              String(leg.status),
            ) &&
            timestamp(leg.recordedAt) &&
            [
              "PLANNED",
              "CARRIER",
              "RECEIVER",
              "RECEIVER_WITH_REMAINDER",
            ].includes(String(leg.custodyStage)) &&
            [
              leg.receivedQuantity,
              leg.pendingQuantity,
              leg.returnedQuantity,
            ].every(
              (quantity) => quantity === null || decimalQuantity(quantity),
            ),
        ))) &&
    Array.isArray(value.timeline) &&
    value.timeline.every(
      (event) =>
        record(event) &&
        text(event.eventId) &&
        text(event.summary) &&
        timestamp(event.eventTime) &&
        record(event.actor) &&
        text(event.actor.organizationName),
    ) &&
    Array.isArray(value.certificates) &&
    value.certificates.every(
      (cert) =>
        record(cert) &&
        cert.status === "APPROVED" &&
        text(cert.documentHash) &&
        text(cert.type) &&
        text(cert.issuer) &&
        timestamp(cert.issueDate) &&
        (cert.expiryDate === null || timestamp(cert.expiryDate)),
    ) &&
    (shipment === null ||
      (record(shipment) &&
        text(shipment.origin) &&
        text(shipment.destination) &&
        (shipment.receivedTime === null || timestamp(shipment.receivedTime))))
  );
}

export function createTraceClient(
  baseUrl: string,
  fetcher: Fetcher = fetch,
  timeoutMs = 12000,
) {
  return async (token: string, signal?: AbortSignal): Promise<PublicLot> => {
    if (!TOKEN_PATTERN.test(token))
      throw new TraceApiError("Mã truy xuất không hợp lệ.");
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) abort.abort();
    const timer = setTimeout(cancel, timeoutMs);
    try {
      const response = await fetcher(
        `${baseUrl}/public/trace/${encodeURIComponent(token)}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          signal: abort.signal,
        },
      );
      if (response.redirected)
        throw new TraceApiError(
          "Máy chủ trả về chuyển hướng không được hỗ trợ.",
        );
      const body: unknown = await response.json().catch(() => null);
      const requestId =
        record(body) && text(body.requestId) ? body.requestId : undefined;
      if (!response.ok) {
        const message =
          response.status === 404
            ? "Mã truy xuất không hợp lệ hoặc không còn được công khai."
            : response.status === 429
              ? "Bạn tra cứu quá nhanh. Vui lòng đợi một lát rồi thử lại."
              : "Chưa lấy được dữ liệu truy xuất. Vui lòng thử lại sau.";
        throw new TraceApiError(message, response.status, requestId);
      }
      if (
        !record(body) ||
        body.success !== true ||
        !isPublicLot(body.data) ||
        body.data.traceToken !== token
      )
        throw new TraceApiError(
          "Dữ liệu truy xuất chưa hợp lệ. Vui lòng thử lại sau.",
          undefined,
          requestId,
        );
      return body.data;
    } catch (error) {
      if (error instanceof TraceApiError) throw error;
      if (signal?.aborted) throw error;
      throw new TraceApiError(
        "Không kết nối được máy chủ hoặc yêu cầu đã hết thời gian. Kiểm tra mạng rồi thử lại.",
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  };
}
