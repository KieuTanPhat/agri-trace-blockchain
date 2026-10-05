import { request } from "@/shared/api/http-client";
import type {
  AllowedCommand,
  CommandInput,
  LotTrace,
} from "@/shared/types/domain";
import { USE_MOCK_API } from "@/shared/api/config";
import { mockSubmitCommand } from "@/mocks/mock-api";

export async function submitCommand(
  lot: LotTrace,
  command: AllowedCommand,
  input: CommandInput = {},
  idempotencyKey = crypto.randomUUID(),
): Promise<{ message: string }> {
  if (USE_MOCK_API) return mockSubmitCommand(lot.lotId, command);

  if (command === "createShipment") {
    await request("/shipments", {
      headers: { "idempotency-key": idempotencyKey },
      method: "POST",
      body: JSON.stringify({
        lotId: lot.lotId,
        transporterOrgId: input.transporterOrgId,
        retailerOrgId: input.retailerOrgId,
        origin: input.origin,
        destination: input.destination,
      }),
    });
    return { message: "Đã tạo chuyến vận chuyển." };
  }

  if (!lot.shipment)
    throw {
      status: 409,
      code: "SHIPMENT_REQUIRED",
      message: "Lô chưa có chuyến vận chuyển phù hợp.",
    };
  const base = { version: lot.shipment.version, lotVersion: lot.version ?? 0 };
  const endpoint: Record<Exclude<AllowedCommand, "createShipment">, string> = {
    startTransport: "start",
    reportArrival: "arrive",
    receiveRetail: "receive",
    rejectRetail: "reject",
    reportDamage: "damage",
  };
  const body =
    command === "receiveRetail"
      ? {
          ...base,
          receivedQuantity: input.receivedQuantity,
          damagedQuantity: input.damagedQuantity ?? 0,
          note: input.note,
        }
      : command === "rejectRetail"
        ? { ...base, reason: input.reason }
        : command === "reportDamage"
          ? { ...base, quantity: input.quantity, reason: input.reason }
          : base;
  await request(`/shipments/${lot.shipment.shipmentId}/${endpoint[command]}`, {
    headers: { "idempotency-key": idempotencyKey },
    method: "POST",
    body: JSON.stringify(body),
  });
  return { message: "Thao tác đã được ghi nhận thành công." };
}
