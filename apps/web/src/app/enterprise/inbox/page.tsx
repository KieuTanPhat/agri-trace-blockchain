"use client";
import Link from "next/link";
import { CaseRequests } from "@/components/workspace/case-requests";
import {
  useWorkspaceData,
  textValue,
  type Overview,
  type Row,
} from "@/lib/workspace";
import { LoadState, PageHeader } from "@/components/manage";
import { stockKinds, transferActions } from "@/lib/task-labels";

type Tasks = { transfers: Row[]; stock: Row[]; counts: Record<string, number> };

/** One place for work waiting on this account. Counts follow server scope; each
 * action is re-authorized when submitted. */
export default function InboxPage() {
  const overview = useWorkspaceData<Overview>("/enterprise-workspace");
  const tasks = useWorkspaceData<Tasks>("/distribution/tasks");
  const ownership = useWorkspaceData<{ items: Row[] }>(
    "/enterprise-workspace/ownership-transfers",
  );
  const me = overview.data?.member.id;
  const incoming = ownership.data?.items.filter(
    (r) =>
      r.status === "PENDING" && !r.expired && (r.to as Row | null)?.id === me,
  );
  const empty =
    !tasks.data?.transfers.length &&
    !tasks.data?.stock.length &&
    !incoming?.length;
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        back="/enterprise"
        backLabel="Doanh nghiệp"
        title="Hộp công việc"
        description="Việc đang chờ bạn theo quyền và phạm vi được phân công: ký giao nhận, đối soát, lô bị chặn, yêu cầu chuyển quyền và hồ sơ từ nền tảng."
      />
      <LoadState {...tasks} />
      {!tasks.loading && !tasks.error && empty && (
        <p className="notice" role="status">
          Không có việc giao nhận, lô cần xử lý hoặc yêu cầu chuyển quyền đang
          chờ bạn.
        </p>
      )}
      {!!incoming?.length && (
        <section className="panel">
          <h2>Yêu cầu chuyển quyền chủ quản</h2>
          {incoming.map((r) => (
            <p key={String(r.id)}>
              {textValue((r.from as Row | null)?.fullName)} đề nghị chuyển quyền
              chủ quản cho bạn.{" "}
              <Link className="text-link" href="/enterprise/ownership">
                Xem và phản hồi →
              </Link>
            </p>
          ))}
        </section>
      )}
      {!!tasks.data?.transfers.length && (
        <section className="panel">
          <h2>Giao nhận chờ bạn ({tasks.data.transfers.length})</h2>
          <ul>
            {tasks.data.transfers.map((t, i) => (
              <li key={`${t.transferId}-${t.action}-${i}`}>
                <strong>
                  {transferActions[String(t.action)] ?? textValue(t.action)}
                </strong>{" "}
                · {textValue(t.origin)} → {textValue(t.destination)}{" "}
                <Link
                  className="text-link"
                  href={`/distribution/${t.transferId}`}
                >
                  Mở chặng →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!!tasks.data?.stock.length && (
        <section className="panel">
          <h2>Lô cần xử lý ({tasks.data.stock.length})</h2>
          <ul>
            {tasks.data.stock.map((s) => (
              <li key={`${s.lotId}-${s.kind}`}>
                <strong>{textValue(s.lotCode)}</strong> ·{" "}
                {textValue(s.productName)} ·{" "}
                {stockKinds[String(s.kind)] ?? textValue(s.kind)} · đang giữ{" "}
                {textValue(s.held)} {textValue(s.unit)}
                {s.expiryDate
                  ? ` · HSD ${new Date(String(s.expiryDate)).toLocaleDateString("vi-VN")}`
                  : ""}
              </li>
            ))}
          </ul>
          <Link className="text-link" href="/enterprise/inventory">
            Mở tồn và cách ly →
          </Link>
        </section>
      )}
      {overview.data?.permissions.includes("cases.read") && <CaseRequests />}
    </div>
  );
}
