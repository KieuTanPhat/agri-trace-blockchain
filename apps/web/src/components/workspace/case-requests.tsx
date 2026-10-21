"use client";
import { DataForm } from "@/components/data-form";
import {
  caseCategoryLabels,
  caseSeverityLabels,
  caseStatusLabels,
  formatDateTime,
  type EnterpriseCase,
} from "@/lib/platform-governance";
import { useWorkspaceData } from "@/lib/workspace";
import { LoadState } from "@/components/manage";

/** Requests the platform addressed to this organization. Answering a case is
 * a message back; recalling a lot stays a separate command below. */
export function CaseRequests() {
  const state = useWorkspaceData<EnterpriseCase[]>("/enterprise-cases");
  if (state.error || state.loading) return <LoadState {...state} />;
  if (!state.data?.length)
    return (
      <p className="notice" role="status">
        Chưa có hồ sơ được giao cho tổ chức.
      </p>
    );
  const open = state.data.filter((row) => row.status !== "CLOSED");
  return (
    <section className="panel" aria-label="Yêu cầu từ nền tảng">
      <h2>Yêu cầu từ nền tảng ({open.length} đang mở)</h2>
      <p className="muted">
        Nền tảng gửi yêu cầu xử lý khiếu nại hoặc sự cố. Phản hồi ở đây chỉ là
        trao đổi; việc xử lý hàng và thu hồi vẫn là thao tác nghiệp vụ riêng của
        doanh nghiệp.
      </p>
      {state.data.map((row) => (
        <article className="panel" key={row.id}>
          <h3>
            #{row.caseNumber} · {row.title}
          </h3>
          <p>
            {caseStatusLabels[row.status] ?? row.status} ·{" "}
            {caseSeverityLabels[row.severity] ?? row.severity} ·{" "}
            {caseCategoryLabels[row.category] ?? row.category}
            {row.lot ? ` · lô ${row.lot.lotCode}` : ""}
            {row.responseDueAt
              ? ` · hạn ${formatDateTime(row.responseDueAt)}`
              : ""}
            {row.overdue ? " · QUÁ HẠN" : ""}
          </p>
          <p>{row.description}</p>
          <ul>
            {row.events.map((event) => (
              <li key={event.id}>
                {formatDateTime(event.createdAt)} — {event.note}
              </li>
            ))}
          </ul>
          {row.allowedActions.includes("ACKNOWLEDGE") && (
            <DataForm
              key={`ack-${row.version}`}
              title="Xác nhận đã nhận"
              path={`/enterprise-cases/${row.id}/acknowledge`}
              extra={{ version: row.version }}
              fields={[
                {
                  name: "note",
                  label: "Ghi chú (không bắt buộc)",
                  maxLength: 2000,
                },
              ]}
              onSaved={() => state.reload()}
            />
          )}
          {row.allowedActions.includes("RESPOND") && (
            <DataForm
              key={`respond-${row.version}`}
              title="Gửi phản hồi"
              path={`/enterprise-cases/${row.id}/respond`}
              extra={{ version: row.version }}
              fields={[
                {
                  name: "note",
                  label: "Nội dung phản hồi (tối thiểu 10 ký tự)",
                  required: true,
                  minLength: 10,
                  maxLength: 2000,
                },
              ]}
              onSaved={() => state.reload()}
            />
          )}
        </article>
      ))}
    </section>
  );
}
