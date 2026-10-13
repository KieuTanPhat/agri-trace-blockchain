import type { components } from "./generated/api";

type Operation = components["schemas"]["InspectCommandRequestDto"]["operation"];
export type CommandRequest = {
  operation: Operation;
  payload: Record<string, unknown>;
  discriminator: string;
};
const uuid = "[\\da-f]{8}-[\\da-f]{4}-[\\da-f]{4}-[\\da-f]{4}-[\\da-f]{12}";
const match = (path: string, pattern: string) =>
  path.match(new RegExp("^" + pattern + "$"));
const creates: Record<string, Operation> = {
  "/production-cycles": "CREATE_PRODUCTION_CYCLE",
  "/shipments": "CREATE_SHIPMENT",
  "/inspections": "CREATE_INSPECTION",
  "/certificates": "CREATE_CERTIFICATE",
  "/supply-chains": "HYB_CREATE_CHAIN",
};

/** Normalize exactly the payload assembled by the NestJS controllers. This
 * allowlist excludes authentication, user/password and signer-key endpoints. */
export function commandRequest(
  path: string,
  method: string,
  body: string,
): CommandRequest | null {
  if (!["POST", "PATCH"].includes(method)) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const result = (
    operation: Operation,
    ids: Record<string, unknown> = {},
    discriminator = "",
  ) => ({ operation, payload: { ...data, ...ids }, discriminator });
  if (method === "POST" && creates[path]) return result(creates[path]);
  const activation = match(
    path,
    `/supply-chains/(${uuid})/business-profile/activate`,
  );
  if (activation && method === "POST")
    return result("HYB_ACTIVATE_BUSINESS_PROFILE", { chainId: activation[1] });
  let m = match(
    path,
    `/production-cycles/(${uuid})/(plant|care|sensor-readings|close|cancel|harvests|sensor-reconciliations)`,
  );
  if (m && method === "POST") {
    const operations: Record<string, Operation> = {
      plant: "PLANT_PRODUCTION_CYCLE",
      care: "RECORD_CARE",
      "sensor-readings": "RECORD_SENSOR",
      close: "CLOSE_PRODUCTION_CYCLE",
      cancel: "CANCEL_PRODUCTION_CYCLE",
      harvests: "RECORD_HARVEST",
      "sensor-reconciliations": "RECONCILE_CYCLE_SENSOR",
    };
    return result(
      operations[m[2]],
      m[2] === "harvests" ? { cycleId: m[1] } : { id: m[1] },
    );
  }
  m = match(path, `/shipments/(${uuid})/(start|arrive|receive|reject|damage)`);
  if (m && method === "POST") {
    const operations: Record<string, Operation> = {
      start: "START_SHIPMENT",
      arrive: "ARRIVE_SHIPMENT",
      receive: "RECEIVE_SHIPMENT",
      reject: "REJECT_SHIPMENT",
      damage: "DAMAGE_SHIPMENT",
    };
    return result(operations[m[2]], { id: m[1] });
  }
  m = match(
    path,
    `/lots/(${uuid})/(mark-for-sale|mark-sold|recall|expire|damage)`,
  );
  if (m && method === "POST") {
    const operations: Record<string, Operation> = {
      "mark-for-sale": "MARK_FOR_SALE",
      "mark-sold": "MARK_SOLD",
      recall: "RECALL_LOT",
      expire: "EXPIRE_LOT",
      damage: "DAMAGE_LOT",
    };
    return result(operations[m[2]], { lotId: m[1] });
  }
  m = match(path, `/certificates/(${uuid})/review`);
  if (m && method === "PATCH")
    return result("REVIEW_CERTIFICATE", { id: m[1] });
  m = match(
    path,
    `/supply-chains/(${uuid})/shipment-plans(?:/(${uuid})/(revise|accept|cancel|finalize))?`,
  );
  if (m && method === "POST") {
    const operations: Record<string, Operation> = {
      revise: "SCOPE_REVISE_SHIPMENT_PLAN",
      accept: "SCOPE_ACCEPT_SHIPMENT_PLAN",
      cancel: "SCOPE_CANCEL_SHIPMENT_PLAN",
      finalize: "SCOPE_FINALIZE_SHIPMENT_PLAN",
    };
    return result(
      m[3] ? operations[m[3]] : "SCOPE_CREATE_SHIPMENT_PLAN",
      { chainId: m[1], ...(m[2] ? { planId: m[2] } : {}) },
      m[3] === "accept" ? String(data.party ?? "") : "",
    );
  }
  m = match(
    path,
    `/supply-chains/(${uuid})/memberships(?:/(${uuid})/(accept|status))?`,
  );
  if (m && method === "POST")
    return result(
      m[3] === "accept"
        ? "HYB_ACCEPT_MEMBERSHIP"
        : m[3] === "status"
          ? "HYB_CHANGE_MEMBERSHIP"
          : "HYB_INVITE_MEMBERSHIP",
      { chainId: m[1], ...(m[2] ? { organizationId: m[2] } : {}) },
    );
  m = match(
    path,
    `/organizations/(${uuid})/(scoped-grants|capabilities)(?:/(${uuid})/revoke)?`,
  );
  if (m && method === "POST")
    return result(
      m[2] === "capabilities"
        ? "HYB_SET_CAPABILITY"
        : m[3]
          ? "HYB_REVOKE_ROLE"
          : "HYB_GRANT_ROLE",
      { organizationId: m[1], ...(m[3] ? { grantId: m[3] } : {}) },
    );
  m = match(path, `/iot/cycles/(${uuid})/digests`);
  if (m && method === "POST")
    return result("CREATE_SENSOR_DIGEST", { cycleId: m[1] });
  m = match(
    path,
    `/iot/shipments/(${uuid})/(devices|telemetry-digests)(?:/(${uuid})/unbind)?`,
  );
  if (m && method === "POST")
    return result(
      m[2] === "telemetry-digests"
        ? "CREATE_SHIPMENT_TELEMETRY_DIGEST"
        : m[3]
          ? "UNBIND_SHIPMENT_DEVICE"
          : "BIND_SHIPMENT_DEVICE",
      { shipmentId: m[1], ...(m[3] ? { deviceId: m[3] } : {}) },
    );
  return null;
}
