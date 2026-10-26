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
  '/enterprise-workspace/profile/contact':'EW_PROFILE_CONTACT',
  '/enterprise-workspace/profile/amendments':'EW_PROFILE_SUBMIT',
  '/production-cycles/drafts':'EW_CREATE_CYCLE_DRAFT',
  "/distribution/transfers": "DIST_CREATE",
  "/distribution/keys": "EW_REGISTER_DISTRIBUTION_KEY",
  "/distribution/notices": "EW_TRACE_NOTICE",
  "/distribution/quantities": "EW_DISPOSITION",
  '/distribution/allocations':'EW_ALLOCATE',
  '/distribution/quarantine':'EW_QUARANTINE',
  '/distribution/site-transfers':'EW_SITE_TRANSFER_CREATE',
  '/enterprise-messages':'EW_MESSAGE_SEND',
  '/distribution/pickup-requests':'EW_PICKUP_REQUEST',
  '/enterprise-workspace/materials':'EW_CREATE_MATERIAL',
  '/enterprise-workspace/products-import/apply':'EW_IMPORT_PRODUCTS',
  "/enterprise-workspace/roles": "EW_CREATE_ROLE",
  '/enterprise-workspace/member-invitations':'EW_INVITE_MEMBER',
  "/enterprise-workspace/partners": "EW_INVITE_PARTNER",
  "/enterprise-workspace/sites": "EW_CREATE_SITE",
  "/enterprise-workspace/vehicles": "EW_CREATE_VEHICLE",
  "/enterprise-connections": "ENTERPRISE_CONNECT",
  "/production-cycles": "CREATE_PRODUCTION_CYCLE",
  "/shipments": "CREATE_SHIPMENT",
  "/inspections": "CREATE_INSPECTION",
  "/certificates": "CREATE_CERTIFICATE",
  "/supply-chains": "HYB_CREATE_CHAIN",
};

/** Normalize the request fields assembled by the NestJS controllers. Signing
 * key inspection derives the organization from the authenticated actor on the
 * server; credentials and private keys never enter this allowlist. */
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
  const draftLink = match(path, `/production-cycles/drafts/(${uuid})/link`);
  if (draftLink && method === "POST")
    return result("EW_LINK_CYCLE_DRAFT", { id: draftLink[1] });
  const profileAmendment=match(path,`/(enterprise-workspace/profile/amendments|enterprise-profile-amendments)/(${uuid})/(withdraw|review)`);
  if(profileAmendment&&method==='POST')return result(profileAmendment[3]==='review'?'ENTERPRISE_PROFILE_REVIEW':'EW_PROFILE_WITHDRAW',{id:profileAmendment[2]});
  const transfer = match(
    path,
    `/distribution/transfers/(${uuid})/(sign|cancel|journal|receipt|returns|consent-renewal|join-chain|c2/prepare|c2/submit)`,
  );
  if (transfer && method === "POST")
    return result(
      ({receipt:'DIST_RECEIPT',returns:'DIST_RETURN','consent-renewal':'DIST_RENEW_CONSENT','c2/prepare':'DIST_C2_PREPARE','c2/submit':'DIST_C2_SUBMIT'} as Record<string,Operation>)[transfer[2]] ?? (transfer[2] === "sign"
        ? "DIST_SIGN"
        : transfer[2] === "journal"
          ? "DIST_OBSERVE"
          : "DIST_CANCEL"),
      { id: transfer[1] },
    );
  const message=match(path,`/enterprise-messages/(${uuid})/(replies|read)`);
  if(message&&method==='POST')return result(message[2]==='replies'?'EW_MESSAGE_REPLY':'EW_MESSAGE_READ',{id:message[1]});
  const pickup=match(path,`/distribution/pickup-requests/(${uuid})/(decline|cancel)`);
  if(pickup&&method==='POST')return result(pickup[2]==='decline'?'EW_PICKUP_DECLINE':'EW_PICKUP_CANCEL',{id:pickup[1]});
  const siteTransfer=match(path,`/distribution/site-transfers/(${uuid})/(dispatch|receive|resolve|cancel)`);
  if(siteTransfer&&method==='POST')return result(({dispatch:'EW_SITE_TRANSFER_DISPATCH',receive:'EW_SITE_TRANSFER_RECEIVE',resolve:'EW_SITE_TRANSFER_RESOLVE',cancel:'EW_SITE_TRANSFER_CANCEL'} as Record<string,Operation>)[siteTransfer[2]],{id:siteTransfer[1]});
  const returnSign=match(path,`/distribution/transfers/(${uuid})/returns/(${uuid})/sign`);
  const invitation=match(path,`/enterprise-workspace/member-invitations/(${uuid})/revoke`);
  if(invitation&&method==='POST')return result('EW_REVOKE_MEMBER_INVITATION',{id:invitation[1]});
  const enterpriseCase=match(path,`/enterprise-cases/(${uuid})/(acknowledge|respond)`);
  if(enterpriseCase&&method==='POST')return result(enterpriseCase[2]==='acknowledge'?'EW_CASE_ACK':'EW_CASE_RESPOND',{id:enterpriseCase[1]});
  if(returnSign&&method==='POST')return result('DIST_RETURN_SIGN',{id:returnSign[1],returnId:returnSign[2]});
  const revision=match(path,`/enterprise-workspace/(products|materials|sites|vehicles)/(${uuid})(/revisions)?`);
  if(revision&&method==='POST'&&(revision[1]==='products'||revision[1]==='materials'||revision[3]))return result(({products:'EW_UPDATE_PRODUCT',materials:'EW_UPDATE_MATERIAL',sites:'EW_REVISE_SITE',vehicles:'EW_REVISE_VEHICLE'} as Record<string,Operation>)[revision[1]],{id:revision[2]});
  const manualActivation=match(path,`/enterprise-enrollments/(${uuid})/activate`);
  if(manualActivation&&method==='POST')return result('ENTERPRISE_ACTIVATE',{id:manualActivation[1]});
  const distributionKey = match(path, `/distribution/keys/(${uuid})/revoke`);
  if (distributionKey && method === "POST")
    return result("EW_REVOKE_DISTRIBUTION_KEY", { id: distributionKey[1] });
  const supervisor = match(path, `/enterprise-workspace/members/(${uuid})/supervisor`);
  if (supervisor && method === "POST")
    return result("EW_CHANGE_MEMBER_SUPERVISOR", { id: supervisor[1] });
  const roleDelete = match(path, `/enterprise-workspace/roles/(${uuid})/delete`);
  if (roleDelete && method === "POST")
    return result("EW_DELETE_ROLE", { id: roleDelete[1] });
  const workspace = match(
    path,
    `/enterprise-workspace/(members|roles|partners|sites|vehicles)/(${uuid})(/status)?`,
  );
  if (workspace && method === "POST") {
    const operations: Record<string, Operation> = {
      members: "EW_UPDATE_MEMBER",
      roles: "EW_UPDATE_ROLE",
      partners: "EW_RESOLVE_PARTNER",
      sites: "EW_UPDATE_SITE",
      vehicles: "EW_UPDATE_VEHICLE",
    };
    return result(operations[workspace[1]], { id: workspace[2] });
  }
  const enterprise = match(
    path,
    `/(enterprise-enrollments|enterprise-connections)/(${uuid})/review`,
  );
  if (enterprise && method === "POST")
    return result(
      enterprise[1] === "enterprise-enrollments"
        ? "ENTERPRISE_REVIEW"
        : "ENTERPRISE_CONNECTION_REVIEW",
      { id: enterprise[2] },
    );
  let signing = match(path, `/shipments/(${uuid})/handover-offers/intent`);
  if (signing && method === "POST")
    return result("PREPARE_HANDOVER_OFFER", { shipmentId: signing[1] });
  signing = match(path, `/handovers/(${uuid})/confirmation/intent`);
  if (signing && method === "POST")
    return result("PREPARE_HANDOVER_CONFIRM", { handoverId: signing[1] });
  signing = match(path, `/signing-intents/(${uuid})/submit`);
  if (signing && method === "POST")
    return result("SUBMIT_SIGNED_INTENT", { intentId: signing[1] });
  signing = match(path, `/handovers/(${uuid})/(reject|cancel)`);
  if (signing && method === "POST")
    return result(
      signing[2] === "reject" ? "REJECT_HANDOVER" : "CANCEL_HANDOVER",
      { handoverId: signing[1] },
    );
  signing = match(
    path,
    `/supply-chains/(${uuid})/signing-keys(?:/(${uuid})/revoke)?`,
  );
  if (signing && method === "POST")
    return result(
      signing[2] ? "HYB_REVOKE_SIGNING_KEY" : "HYB_REGISTER_SIGNING_KEY",
      { chainId: signing[1], ...(signing[2] ? { keyRef: signing[2] } : {}) },
      signing[2] ? "" : String(data.keyRef ?? ""),
    );
  const activation = match(
    path,
    `/supply-chains/(${uuid})/business-profile/activate`,
  );
  if (activation && method === "POST")
    return result("HYB_ACTIVATE_BUSINESS_PROFILE", { chainId: activation[1] });
  let m = match(
    path,
    `/production-cycles/(${uuid})/(plant|care|sensor-readings|close|cancel|harvests)`,
  );
  if (m && method === "POST") {
    const operations: Record<string, Operation> = {
      plant: "PLANT_PRODUCTION_CYCLE",
      care: "RECORD_CARE",
      "sensor-readings": "RECORD_SENSOR",
      close: "CLOSE_PRODUCTION_CYCLE",
      cancel: "CANCEL_PRODUCTION_CYCLE",
      harvests: "RECORD_HARVEST",
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
  // User-session ingest only; device-key ingest keeps its own key/transport.
  // One pending reading per device blocks a replacement until reconciled.
  if (path === "/iot/readings" && method === "POST")
    return result("INGEST_SENSOR_READING", {}, String(data.deviceId ?? ""));
  m = match(path, `/iot/shipments/(${uuid})/telemetry`);
  if (m && method === "POST")
    return result(
      "INGEST_SHIPMENT_TELEMETRY",
      { shipmentId: m[1] },
      String(data.deviceId ?? ""),
    );
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
