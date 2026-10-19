"use client";
import { useState, type FormEvent } from "react";
import {
  useWorkspaceData,
  useWorkspaceCommand,
  textValue,
  type Overview,
  type Row,
} from "@/lib/workspace";
import { CommandState, LoadState, PageHeader } from "@/components/manage";

const status: Record<string, string> = {
  PENDING: "Chờ người nhận chấp nhận",
  ACCEPTED: "Đã chuyển",
  DECLINED: "Người nhận từ chối",
  CANCELLED: "Đã hủy",
  EXPIRED: "Hết hạn",
};
const person = (value: unknown) => {
  const p = value as Row | null;
  return p ? `${textValue(p.fullName)} (${textValue(p.email)})` : "—";
};

export default function OwnershipPage() {
  const overview = useWorkspaceData<Overview>("/enterprise-workspace");
  const transfers = useWorkspaceData<{ items: Row[] }>(
    "/enterprise-workspace/ownership-transfers",
  );
  const primary = !!overview.data?.member.primary;
  const members = useWorkspaceData<{ items: Row[] }>(
    primary ? "/enterprise-workspace/members" : null,
  );
  const me = overview.data?.member.id;
  const propose = useWorkspaceCommand(),
    resolve = useWorkspaceCommand();
  const [action, setAction] = useState<{
    row: Row;
    kind: "accept" | "decline" | "cancel";
  } | null>(null);
  const [done, setDone] = useState("");
  const pending = transfers.data?.items.find(
    (r) => r.status === "PENDING" && !r.expired,
  );
  async function submitProposal(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setDone("");
    if (
      await propose.run("/enterprise-workspace/ownership-transfers", {
        toUserId: String(form.get("toUserId")),
        retainPreviousAdmin: form.get("retainPreviousAdmin") === "true",
        reason: String(form.get("reason") ?? "").trim(),
      })
    ) {
      setDone("Đã gửi yêu cầu. Quyền chỉ đổi khi người nhận chấp nhận.");
      transfers.reload();
    }
  }
  async function submitResolution(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!action) return;
    const note = String(new FormData(e.currentTarget).get("note") ?? "").trim();
    if (
      await resolve.run(
        `/enterprise-workspace/ownership-transfers/${action.row.id}/${action.kind}`,
        {
          version: Number(action.row.version),
          note,
        },
      )
    ) {
      setDone(
        action.kind === "accept"
          ? "Bạn đã nhận quyền chủ quản cấp 1. Tải lại trang để cập nhật menu và quyền."
          : "Đã ghi nhận.",
      );
      setAction(null);
      transfers.reload();
      overview.reload();
    }
  }
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        backLabel="Quay lại danh sách"
        title="Chuyển quyền chủ quản"
        description="Chủ quản cấp 1 chỉ định người nhận. Quyền chỉ đổi khi người nhận chấp nhận; lịch sử ký và dữ liệu đã ghi giữ nguyên người thực hiện."
        back="/enterprise/members"
      />
      <LoadState {...overview} />
      <LoadState {...transfers} />
      {done && (
        <p className="notice" role="status">
          {done}
        </p>
      )}
      {primary && !pending && (
        <form className="panel workspace-form" onSubmit={submitProposal}>
          <h2>Tạo yêu cầu chuyển quyền</h2>
          <p className="muted">
            Người nhận có quyền quản trị cấp 1 sau khi chấp nhận. Nếu bỏ quyền
            của bạn, các thành viên bạn trực tiếp quản lý được chuyển sang người
            nhận và phiên đăng nhập của bạn bị thu hồi.
          </p>
          <CommandState command={propose} />
          <fieldset
            disabled={propose.pending || propose.frozen}
            className="enterprise-fields"
          >
            <label>
              Người nhận
              <select
                className="input"
                name="toUserId"
                required
                defaultValue=""
              >
                <option value="">Chọn thành viên đang hoạt động</option>
                {members.data?.items
                  .filter((m) => m.id !== me && m.accountStatus === "ACTIVE")
                  .map((m) => (
                    <option key={String(m.id)} value={String(m.id)}>
                      {textValue(m.fullName)} · {textValue(m.email)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Sau khi chuyển
              <select
                className="input"
                name="retainPreviousAdmin"
                defaultValue="false"
              >
                <option value="false">Bỏ quyền quản trị cấp 1 của tôi</option>
                <option value="true">Giữ quyền quản trị cấp 1 của tôi</option>
              </select>
            </label>
            <label>
              Lý do
              <textarea
                className="input"
                name="reason"
                required
                minLength={10}
                maxLength={1000}
              />
            </label>
          </fieldset>
          <button className="button" disabled={propose.pending}>
            {propose.frozen ? "Thử lại yêu cầu cũ" : "Gửi yêu cầu"}
          </button>
        </form>
      )}
      <section className="panel">
        <h2>Yêu cầu chuyển quyền</h2>
        <CommandState command={resolve} />
        {transfers.data?.items.length ? (
          <ul>
            {transfers.data.items.map((r) => (
              <li key={String(r.id)}>
                {person(r.from)} → {person(r.to)} ·{" "}
                <strong>
                  {r.expired
                    ? status.EXPIRED
                    : (status[String(r.status)] ?? textValue(r.status))}
                </strong>{" "}
                ·{" "}
                {r.retainPreviousAdmin
                  ? "người chuyển giữ quyền cấp 1"
                  : "người chuyển bỏ quyền cấp 1"}{" "}
                · hạn {new Date(String(r.expiresAt)).toLocaleString("vi-VN")}
                <br />
                <small>Lý do: {textValue(r.reason)}</small>
                {r.resolutionNote ? (
                  <small> · Ghi chú: {textValue(r.resolutionNote)}</small>
                ) : null}
                {r.status === "PENDING" && !r.expired && (
                  <span className="workspace-actions">
                    {(r.to as Row | null)?.id === me && (
                      <>
                        <button
                          type="button"
                          className="button"
                          onClick={() => setAction({ row: r, kind: "accept" })}
                        >
                          Chấp nhận
                        </button>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => setAction({ row: r, kind: "decline" })}
                        >
                          Từ chối
                        </button>
                      </>
                    )}
                    {(r.from as Row | null)?.id === me && (
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => setAction({ row: r, kind: "cancel" })}
                      >
                        Hủy yêu cầu
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Chưa có yêu cầu.</p>
        )}
        {action && (
          <form className="workspace-form" onSubmit={submitResolution}>
            <fieldset
              disabled={resolve.pending || resolve.frozen}
              className="enterprise-fields"
            >
              <label>
                {action.kind === "accept"
                  ? "Xác nhận nhận trách nhiệm chủ quản"
                  : action.kind === "decline"
                    ? "Lý do từ chối"
                    : "Lý do hủy"}
                <textarea
                  className="input"
                  name="note"
                  required
                  minLength={10}
                  maxLength={1000}
                />
              </label>
            </fieldset>
            <div className="workspace-actions">
              <button className="button" disabled={resolve.pending}>
                {resolve.frozen ? "Thử lại yêu cầu cũ" : "Xác nhận"}
              </button>
              <button
                type="button"
                className="text-link"
                disabled={resolve.frozen}
                onClick={() => setAction(null)}
              >
                Đóng
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
