import type { components } from "../../../src/lib/generated/api";
import { registerScenario, readScenario } from "./scenarios";
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

export const privacyRecord: S["PrivacyDetailDto"] = {
  id: caseId,
  kind: "REQUEST",
  requestType: "ACCESS",
  status: "OPEN",
  reporting: "UNASSESSED",
  message: "IN_SCOPE_PRIVACY_RECORD",
  createdAt: "2026-10-22T00:00:00.000Z",
  detectedAt: null,
  deadlineAt: null,
  reportedAt: null,
  overdue: false,
  version: 4,
  events: [],
};
for (const id of ["privacy.scoped", "privacy.self"])
  registerScenario(id, {
    handle(request) {
      const root =
        id === "privacy.self" ? "/privacy-requests" : "/platform-privacy";
      if (request.method === "GET" && request.path === root)
        return {
          data: {
            items: [privacyTicket(privacyRecord)],
            nextCursor: null,
          } satisfies S["PrivacyPageDto"],
        };
      if (request.method === "GET" && request.path === root + "/" + caseId)
        return { data: privacyRecord };
    },
  });

for (const id of ["privacy.review", "privacy.unknown-review", "privacy.create"])
  registerScenario(id, {
    handle(request, state) {
      const root =
        id === "privacy.create" ? "/privacy-requests" : "/platform-privacy";
      const ticket: S["PrivacyTicketDto"] = {
        id: caseId,
        kind: "REQUEST",
        requestType: "ACCESS",
        status: "OPEN",
        reporting: "UNASSESSED",
        createdAt: privacyRecord.createdAt,
        detectedAt: null,
        deadlineAt: null,
        reportedAt: null,
        overdue: false,
        version: 4,
      };
      if (request.method === "GET" && request.path === root)
        return {
          data: {
            items: [
              ticket,
              {
                ...ticket,
                id: "22222222-2222-4222-8222-222222222222",
                requestType: "CORRECTION",
              },
            ],
            nextCursor: null,
          } satisfies S["PrivacyPageDto"],
        };
      if (request.method === "GET" && request.path === root + "/" + caseId)
        return { data: state.values.get("record") ?? privacyRecord };
      if (
        request.method === "POST" &&
        request.path === root + "/" + caseId + "/review"
      ) {
        const body = JSON.parse(request.body ?? "{}");
        if (
          !request.idempotencyKey ||
          JSON.stringify(Object.keys(body).sort()) !==
            JSON.stringify(
              ["version", "status", "note", "visibility"].sort(),
            ) ||
          body.version !== 4 ||
          body.note !== "PRIVATE_REVIEW_NOTE_789" ||
          body.status !== "IN_REVIEW" ||
          body.visibility !== "INTERNAL"
        )
          throw new Error("Wrong privacy review command");
        if (id === "privacy.unknown-review" && !state.values.has("lost")) {
          state.values.set("lost", true);
          return {
            status: 503,
            error: { code: "UNAVAILABLE", message: "Chưa nhận được kết quả" },
          };
        }
        state.values.set("record", {
          ...privacyRecord,
          status: "IN_REVIEW",
          version: 5,
          events: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              action: "UPDATED",
              createdAt: privacyRecord.createdAt,
              note: body.note,
              notificationReference: null,
              visibility: body.visibility,
            },
          ],
        });
        return { data: ticket };
      }
      if (
        id === "privacy.create" &&
        request.method === "POST" &&
        request.path === root
      ) {
        const body = JSON.parse(request.body ?? "{}");
        if (
          !request.idempotencyKey ||
          body.requestType !== "DELETION" ||
          body.message !== "Tôi yêu cầu xóa dữ liệu cá nhân" ||
          Object.keys(body).length !== 2
        )
          throw new Error("Wrong self privacy command");
        return { data: ticket };
      }
    },
  });

registerScenario("privacy.breach", {
  handle(request, state) {
    const ticket: S["PrivacyTicketDto"] = {
      id: caseId,
      kind: "BREACH",
      requestType: "INCIDENT",
      status: "OPEN",
      reporting: "UNASSESSED",
      createdAt: privacyRecord.createdAt,
      detectedAt: "2026-10-22T00:00:00.000Z",
      deadlineAt: "2026-10-25T00:00:00.000Z",
      reportedAt: null,
      overdue: false,
      version: 4,
    };
    if (request.method === "GET" && request.path === "/platform-privacy")
      return {
        data: {
          items: state.values.get("created") ? [ticket] : [],
          nextCursor: null,
        },
      };
    if (
      request.method === "GET" &&
      request.path === "/platform-privacy/" + caseId
    )
      return { data: { ...ticket, message: "PRIVATE_BREACH_456", events: [] } };
    if (
      request.method === "POST" &&
      request.path === "/platform-privacy/breaches"
    ) {
      const body = JSON.parse(request.body ?? "{}");
      if (
        !request.idempotencyKey ||
        request.mfaCode !== "123456" ||
        body.message !== "PRIVATE_BREACH_456" ||
        !Number.isFinite(Date.parse(body.detectedAt)) ||
        Object.keys(body).sort().join() !== "detectedAt,message"
      )
        throw new Error("Invalid breach DTO or optional MFA");
      state.values.set("created", true);
      return { data: ticket };
    }
  },
});
registerScenario("privacy.pagination", {
  handle(request) {
    if (request.method !== "GET") return;
    const u = new URL(request.path, "http://fixture.invalid");
    if (u.pathname === "/platform-privacy") {
      if (
        [...u.searchParams.keys()].some((k) => k !== "cursor") ||
        (u.searchParams.has("cursor") &&
          u.searchParams.get("cursor") !== caseId)
      )
        throw new Error("Wrong privacy cursor");
      const second = u.searchParams.has("cursor");
      const { message, events, ...ticket } = privacyRecord;
      void message;
      void events;
      return {
        data: {
          items: [
            second
              ? {
                  ...ticket,
                  id: "22222222-2222-4222-8222-222222222222",
                  requestType: "CORRECTION",
                }
              : ticket,
          ],
          nextCursor: second ? null : caseId,
        },
      };
    }
    if (u.pathname === "/platform-privacy/" + caseId)
      return { data: privacyRecord };
    if (u.pathname === "/platform-privacy/22222222-2222-4222-8222-222222222222")
      return {
        data: {
          ...privacyRecord,
          id: "22222222-2222-4222-8222-222222222222",
          message: "SECOND_PRIVACY_RECORD",
          requestType: "CORRECTION",
        },
      };
  },
});

function privacyTicket(record: S["PrivacyDetailDto"]): S["PrivacyTicketDto"] {
  const { message, events, ...ticket } = record;
  void message;
  void events;
  return ticket;
}

export const supportTicket = {
  id: caseId,
  code: "SUP-17",
  organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationName: "Doanh nghiệp được giao",
  category: "TECHNICAL",
  priority: "NORMAL",
  subject: "SUPPORT_IN_SCOPE_RECORD",
  status: "OPEN",
  assigneeId: null,
  assigneeName: null,
  dueAt: "2026-10-24T00:00:00.000Z",
  overdue: false,
  resolution: null,
  closedAt: null,
  version: 7,
  createdAt: privacyRecord.createdAt,
  updatedAt: privacyRecord.createdAt,
  messages: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      authorSide: "ENTERPRISE",
      authorName: "Người gửi",
      body: "Đề nghị kiểm tra kết nối",
      internal: false,
      createdAt: privacyRecord.createdAt,
    },
  ],
};
for (const scenario of ["support.open", "support.closed"])
  registerScenario(scenario, {
    handle(request, state) {
      if (
        request.method === "GET" &&
        request.path === "/platform-admin/tickets"
      )
        return {
          data: {
            items: [
              state.values.get("ticket") ?? {
                ...supportTicket,
                status: scenario === "support.closed" ? "CLOSED" : "OPEN",
              },
            ],
          },
        };
      if (
        request.method === "GET" &&
        request.path === "/platform-admin/support-staff"
      )
        return {
          data: {
            items: [
              {
                id: "55555555-5555-4555-8555-555555555555",
                fullName: "Người phụ trách",
                email: "staff@example.invalid",
                role: "PLATFORM_CASE_MANAGER",
              },
            ],
          },
        };
      if (
        request.method === "POST" &&
        request.path === "/platform-admin/tickets/" + caseId + "/reply"
      ) {
        const body = JSON.parse(request.body ?? "{}");
        if (
          !request.idempotencyKey ||
          body.version !== 7 ||
          body.body !== "Nội dung phản hồi cần xử lý" ||
          body.internal !== false ||
          body.status !== "WAITING_CUSTOMER"
        )
          throw new Error("Wrong baseline ticket reply");
        state.values.set("ticket", {
          ...supportTicket,
          status: "WAITING_CUSTOMER",
          version: 8,
          messages: [
            ...supportTicket.messages,
            {
              ...supportTicket.messages[0],
              id: "44444444-4444-4444-8444-444444444444",
              authorSide: "PLATFORM",
              body: body.body,
            },
          ],
        });
        return { data: { record: { id: caseId } } };
      }
    },
  });

registerScenario("support.unknown", {
  async handle(request, state) {
    if (
      request.method === "POST" &&
      request.path.endsWith("/reply") &&
      !state.values.has("lost")
    ) {
      state.values.set("lost", true);
      return {
        status: 503,
        error: { code: "UNAVAILABLE", message: "Chưa nhận được kết quả" },
      };
    }
    return readScenario("support.open").handle(request, state);
  },
});

registerScenario("support.actions", {
  handle(request, state) {
    const u = new URL(request.path, "http://fixture.invalid");
    if (request.method === "GET" && u.pathname === "/platform-admin/tickets") {
      if (
        [...u.searchParams.keys()].some((k) => k !== "status") ||
        (u.searchParams.has("status") &&
          u.searchParams.get("status") !== "CLOSED")
      )
        throw new Error("Wrong ticket filter");
      return {
        data: {
          items: [
            u.searchParams.has("status")
              ? { ...supportTicket, status: "CLOSED" }
              : (state.values.get("ticket") ?? supportTicket),
          ],
        },
      };
    }
    if (
      request.method === "GET" &&
      request.path === "/platform-admin/support-staff"
    )
      return {
        data: {
          items: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              fullName: "Người phụ trách",
              email: "staff@example.invalid",
              role: "PLATFORM_CASE_MANAGER",
            },
          ],
        },
      };
    if (
      request.method !== "POST" ||
      !u.pathname.startsWith("/platform-admin/tickets/" + caseId + "/")
    )
      return;
    const b = JSON.parse(request.body ?? "{}");
    if (!request.idempotencyKey || b.version !== 7)
      throw new Error("Wrong ticket command identity/version");
    const a = u.pathname.split("/").at(-1);
    if (a === "assign") {
      if (
        b.assigneeId !== "55555555-5555-4555-8555-555555555555" ||
        b.priority !== "NORMAL" ||
        Object.keys(b).length !== 3
      )
        throw new Error("Wrong assignment DTO");
      state.values.set("ticket", {
        ...supportTicket,
        assigneeId: b.assigneeId,
        assigneeName: "Người phụ trách",
        status: "IN_PROGRESS",
        version: 8,
      });
    } else if (a === "reply") {
      if (
        b.internal !== true ||
        "status" in b ||
        b.body !== "Ghi chú nền tảng riêng tư" ||
        Object.keys(b).length !== 3
      )
        throw new Error("Internal note leaked a state transition");
      state.values.set("ticket", {
        ...supportTicket,
        version: 8,
        messages: [
          ...supportTicket.messages,
          {
            ...supportTicket.messages[0],
            id: "44444444-4444-4444-8444-444444444444",
            authorSide: "PLATFORM",
            body: b.body,
            internal: true,
          },
        ],
      });
    } else if (a === "close") {
      if (
        b.reason !== "Đã hoàn thành xử lý hỗ trợ" ||
        Object.keys(b).length !== 2
      )
        throw new Error("Wrong close DTO");
      state.values.set("ticket", {
        ...supportTicket,
        status: "CLOSED",
        version: 8,
        resolution: b.reason,
        closedAt: privacyRecord.createdAt,
      });
    } else throw new Error("Unknown ticket action");
    return { data: { record: { id: caseId } } };
  },
});
