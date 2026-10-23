import type { components } from "../../../src/lib/generated/api";
import { registerScenario } from "./scenarios";
type S = components["schemas"];
export const caseId = "11111111-1111-4111-8111-111111111111";
export const assignedCase: S["PlatformCaseDto"] = {
  id: caseId,
  caseNumber: 17,
  title: "Hồ sơ cần xác minh nguồn hàng",
  description: "Yêu cầu đối soát thông tin lô hàng từ doanh nghiệp.",
  category: "SAFETY",
  severity: "HIGH",
  source: "CONSUMER",
  status: "ASSIGNED",
  owner: null,
  lot: null,
  overdue: true,
  version: 3,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
  responseDueAt: "2026-10-22T00:00:00.000Z",
  acknowledgedAt: null,
  respondedAt: null,
  escalatedAt: null,
  closedAt: null,
  closeReason: null,
};
registerScenario("cases.assigned", {
  handle(request) {
    if (request.method !== "GET") return;
    const url = new URL(request.path, "http://fixture.invalid");
    if (url.pathname !== "/platform-cases") return;
    for (const key of url.searchParams.keys()) {
      if (!["status", "severity", "overdue", "cursor"].includes(key))
        throw new Error(`Unexpected case filter ${key}`);
    }
    if (
      url.searchParams.has("cursor") &&
      url.searchParams.get("cursor") !== caseId
    )
      throw new Error("Wrong case pagination cursor");
    const second = url.searchParams.has("cursor");
    const record = second
      ? {
          ...assignedCase,
          id: "22222222-2222-4222-8222-222222222222",
          caseNumber: 18,
          title: "Hồ sơ trang tiếp theo",
        }
      : assignedCase;
    const matches =
      (!url.searchParams.has("status") ||
        url.searchParams.get("status") === record.status) &&
      (!url.searchParams.has("severity") ||
        url.searchParams.get("severity") === record.severity);
    const data: S["PlatformCasePageDto"] = {
      items: matches ? [record] : [],
      nextCursor: second || !matches ? null : caseId,
    };
    return { data };
  },
});

registerScenario("cases.detail", {
  handle(request, state) {
    if (
      request.path === "/platform-cases/organization-options" &&
      request.method === "GET"
    )
      return { data: [] };
    if (request.path !== "/platform-cases/" + caseId) return;
    if (request.method === "GET")
      return {
        data: {
          ...assignedCase,
          status: state.values.get("closed") ? "CLOSED" : "ASSIGNED",
          events: [],
        },
      };
  },
});
registerScenario("cases.close", {
  handle(request, state) {
    if (
      request.path === "/platform-cases/organization-options" &&
      request.method === "GET"
    )
      return { data: [] };
    if (
      request.path === "/platform-cases/" + caseId &&
      request.method === "GET"
    )
      return {
        data: {
          ...assignedCase,
          status: state.values.get("closed") ? "CLOSED" : "ASSIGNED",
          events: [],
        },
      };
    if (
      request.path === "/platform-cases/" + caseId + "/close" &&
      request.method === "POST"
    ) {
      if (!request.idempotencyKey) throw new Error("Missing case command key");
      const body = JSON.parse(request.body ?? "{}");
      if (body.version !== 3 || body.reason !== "Đã đối soát đầy đủ hồ sơ")
        throw new Error("Wrong close payload");
      state.values.set("closed", true);
      return { data: { ...assignedCase, status: "CLOSED", events: [] } };
    }
  },
});

registerScenario("cases.create", {
  handle(request) {
    if (
      request.method === "GET" &&
      request.path === "/platform-cases/organization-options"
    )
      return { data: [] };
    if (request.method === "POST" && request.path === "/platform-cases") {
      if (!request.idempotencyKey)
        throw new Error("Missing create command identity");
      const body = JSON.parse(request.body ?? "{}");
      if (
        body.title !== "Hồ sơ xác minh mới" ||
        body.description !== "Đề nghị đối chiếu hồ sơ doanh nghiệp" ||
        body.source !== "INTERNAL" ||
        body.category !== "QUALITY" ||
        body.severity !== "MEDIUM" ||
        "version" in body ||
        "responseDueAt" in body ||
        "lotId" in body ||
        "ownerOrganizationId" in body
      )
        throw new Error("Incorrect case create DTO");
      return {
        data: {
          ...assignedCase,
          title: body.title,
          description: body.description,
          events: [],
        },
      };
    }
    if (
      request.method === "GET" &&
      request.path === "/platform-cases/" + caseId
    )
      return {
        data: { ...assignedCase, title: "Hồ sơ xác minh mới", events: [] },
      };
  },
});

const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
for (const scenario of ["cases.actions", "cases.unknown-note"])
  registerScenario(scenario, {
    handle(request, state) {
      if (
        request.method === "GET" &&
        request.path === "/platform-cases/organization-options"
      )
        return {
          data: [{ id: orgId, name: "Doanh nghiệp được giao", type: "FARM" }],
        };
      if (
        request.method === "GET" &&
        request.path === "/platform-cases/" + caseId
      )
        return {
          data: state.values.get("record") ?? { ...assignedCase, events: [] },
        };
      if (
        request.method !== "POST" ||
        !request.path.startsWith("/platform-cases/" + caseId + "/")
      )
        return;
      const body: unknown = JSON.parse(request.body ?? "{}");
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        !request.idempotencyKey
      )
        throw new Error("Invalid case command");
      const action = request.path.split("/").at(-1);
      const fields: Record<string, string[]> = {
        notes: ["note", "visibility"],
        classify: ["category", "severity", "note", "version"],
        "link-lot": ["lotId", "note", "version"],
        assign: ["ownerOrganizationId", "note", "version"],
        escalate: ["note", "version"],
      };
      if (
        !action ||
        !fields[action] ||
        Object.keys(body).sort().join() !== fields[action].sort().join()
      )
        throw new Error("Unexpected command fields");
      if (action !== "notes" && (!("version" in body) || body.version !== 3))
        throw new Error("Wrong case version");
      if (scenario === "cases.unknown-note" && !state.values.has("lost")) {
        state.values.set("lost", true);
        return {
          status: 503,
          error: { code: "UNAVAILABLE", message: "Chưa nhận được kết quả" },
        };
      }
      const record = { ...assignedCase, events: [] };
      state.values.set("record", record);
      return { data: record };
    },
  });
