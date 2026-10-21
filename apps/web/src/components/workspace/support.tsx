"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { useWorkspaceCommand, useWorkspaceData } from "@/lib/workspace";
import {
  CommandState,
  EmptyState,
  InfoDialog,
  LoadState,
  PageHeader,
  ReloadButton,
  StatusBadge,
} from "@/components/manage";
import {
  dateTime,
  label,
  priorityLabels,
  ticketCategoryLabels,
  ticketStatusLabels,
  type Items,
  type Row,
} from "@/lib/platform-admin";

const PATH = "/enterprise-support/tickets";
const tone = (status: unknown) =>
  status === "CLOSED"
    ? "INACTIVE"
    : status === "RESOLVED"
      ? "ACTIVE"
      : "PENDING_REVIEW";
const lastActivity = (t: Row) => {
  const messages = (t.messages as Row[] | undefined) ?? [];
  return String(messages.at(-1)?.createdAt ?? t.updatedAt ?? t.createdAt ?? "");
};

/** Requests sent to AgriTrace, newest activity first. */
export function SupportList() {
  const router = useRouter();
  const state = useWorkspaceData<Items>(PATH);
  const [status, setStatus] = useState("");
  const rows = useMemo(
    () =>
      [...(state.data?.items ?? [])]
        .filter((t) =>
          !status
            ? true
            : status === "OPEN"
              ? !["RESOLVED", "CLOSED"].includes(String(t.status))
              : ["RESOLVED", "CLOSED"].includes(String(t.status)),
        )
        .sort((a, b) => lastActivity(b).localeCompare(lastActivity(a))),
    [state.data, status],
  );
  return (
    <div className="manage-console">
      <PageHeader
        title="Hỗ trợ từ AgriTrace"
        description="Gửi yêu cầu về tài khoản, thanh toán, truy xuất, blockchain hoặc chế biến. Bấm vào một yêu cầu để xem trao đổi và trả lời."
        action={{ href: "/enterprise/support/new", label: "Gửi yêu cầu mới" }}
        actions={<ReloadButton onClick={state.reload} />}
      />
      <div className="support-filter" role="tablist" aria-label="Lọc yêu cầu">
        {[
          ["", "Tất cả"],
          ["OPEN", "Đang mở"],
          ["DONE", "Đã xong"],
        ].map(([value, text]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={status === value}
            className={`button ${status === value ? "" : "secondary"} small`}
            onClick={() => setStatus(value)}
          >
            {text}
          </button>
        ))}
      </div>
      <LoadState loading={state.loading} error={state.error} />
      {state.data && !rows.length ? (
        <EmptyState
          title="Chưa có yêu cầu"
          description="Gửi yêu cầu mới khi cần AgriTrace hỗ trợ."
        />
      ) : (
        <div className="manage-section manage-table-scroll">
          <table className="manage-table support-table">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Chủ đề</th>
                <th>Loại</th>
                <th>Ưu tiên</th>
                <th>Trạng thái</th>
                <th>Cập nhật</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr
                  key={String(t.id)}
                  className="clickable-row"
                  onClick={() => router.push(`/enterprise/support/${t.id}`)}
                >
                  <td data-label="Mã">
                    <strong>{String(t.code)}</strong>
                  </td>
                  <td data-label="Chủ đề">
                    {String(t.subject)}
                    <small>
                      {((t.messages as Row[] | undefined) ?? []).length} tin nhắn
                    </small>
                  </td>
                  <td data-label="Loại">{label(ticketCategoryLabels, t.category)}</td>
                  <td data-label="Ưu tiên">{label(priorityLabels, t.priority)}</td>
                  <td data-label="Trạng thái">
                    <StatusBadge
                      value={tone(t.status)}
                      label={label(ticketStatusLabels, t.status)}
                    />
                  </td>
                  <td data-label="Cập nhật">{dateTime(lastActivity(t))}</td>
                  <td data-label="Thao tác">
                    <Link
                      className="text-link"
                      href={`/enterprise/support/${t.id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Xem chi tiết
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** New request form; the created request code is shown before leaving. */
export function SupportCreate() {
  const router = useRouter();
  const command = useWorkspaceCommand();
  const [form, setForm] = useState({
    category: "TECHNICAL",
    priority: "NORMAL",
    subject: "",
    body: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<{ id: string; code: string } | null>(
    null,
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (form.subject.trim().length < 5)
      next.subject = "Chủ đề cần từ 5 ký tự.";
    if (form.body.trim().length < 10)
      next.body = "Mô tả cần từ 10 ký tự để AgriTrace hiểu vấn đề.";
    setErrors(next);
    if (Object.keys(next).length) return;
    const result = await command.run<{ record?: { id: string; code: string } }>(
      PATH,
      { ...form, subject: form.subject.trim(), body: form.body.trim() },
    );
    if (result && result.record) setCreated(result.record);
  }
  const fieldError = (name: string) =>
    errors[name] ? (
      <span className="field-error" role="alert" id={`support-${name}-error`}>
        {errors[name]}
      </span>
    ) : null;
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        title="Gửi yêu cầu hỗ trợ"
        description="Mô tả rõ vấn đề, thời điểm xảy ra và mã lô/chuỗi liên quan nếu có."
        back="/enterprise/support"
        backLabel="Quay lại danh sách"
      />
      <form className="panel workspace-form support-form" onSubmit={submit} noValidate>
        <CommandState command={command} />
        <fieldset className="enterprise-fields" disabled={command.pending}>
          <label>
            Loại yêu cầu
            <select
              className="input"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {Object.entries(ticketCategoryLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mức ưu tiên
            <select
              className="input"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
            >
              {Object.entries(priorityLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="full-row">
            Chủ đề <span aria-hidden="true">*</span>
            <input
              className="input"
              maxLength={200}
              value={form.subject}
              aria-invalid={errors.subject ? true : undefined}
              aria-describedby={errors.subject ? "support-subject-error" : undefined}
              onChange={(e) => {
                setForm({ ...form, subject: e.target.value });
                setErrors({ ...errors, subject: "" });
              }}
            />
            {fieldError("subject")}
          </label>
          <label className="full-row">
            Nội dung <span aria-hidden="true">*</span>
            <textarea
              className="input"
              rows={6}
              maxLength={4000}
              value={form.body}
              aria-invalid={errors.body ? true : undefined}
              aria-describedby={errors.body ? "support-body-error" : undefined}
              onChange={(e) => {
                setForm({ ...form, body: e.target.value });
                setErrors({ ...errors, body: "" });
              }}
            />
            <small className="muted">{form.body.length}/4000 ký tự</small>
            {fieldError("body")}
          </label>
        </fieldset>
        <div className="form-actions">
          <Link className="button secondary" href="/enterprise/support">
            Hủy
          </Link>
          <button className="button" type="submit" disabled={command.pending}>
            {command.pending ? "Đang gửi…" : "Gửi yêu cầu"}
          </button>
        </div>
      </form>
      <InfoDialog
        open={!!created}
        title="Đã gửi yêu cầu hỗ trợ"
        description="AgriTrace sẽ phản hồi trong mục chi tiết của yêu cầu này."
        rows={[
          ["Mã yêu cầu", created?.code ?? ""],
          ["Chủ đề", form.subject],
          ["Loại", label(ticketCategoryLabels, form.category)],
          ["Ưu tiên", label(priorityLabels, form.priority)],
        ]}
        onClose={() => router.push("/enterprise/support")}
        actions={
          <>
            <button
              type="button"
              className="button secondary"
              onClick={() => router.push("/enterprise/support")}
            >
              Về danh sách
            </button>
            <button
              type="button"
              className="button"
              onClick={() => router.push(`/enterprise/support/${created?.id}`)}
            >
              Xem chi tiết
            </button>
          </>
        }
      />
    </div>
  );
}

/** One request with its conversation and a reply box while it is open. */
export function SupportDetail({ id }: { id: string }) {
  const state = useWorkspaceData<Items>(PATH);
  const command = useWorkspaceCommand();
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState("");
  const ticket = state.data?.items.find((t) => String(t.id) === id);
  const messages = (ticket?.messages as Row[] | undefined) ?? [];
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (reply.trim().length < 2) {
      setReplyError("Nhập nội dung trả lời.");
      return;
    }
    if (
      ticket &&
      (await command.run(`${PATH}/${id}/reply`, {
        body: reply.trim(),
        version: ticket.version,
      })) !== false
    ) {
      setReply("");
      state.reload();
    }
  }
  return (
    <div className="manage-console">
      <PageHeader
        title={ticket ? `${ticket.code} · ${ticket.subject}` : "Yêu cầu hỗ trợ"}
        back="/enterprise/support"
        backLabel="Quay lại danh sách"
        actions={<ReloadButton onClick={state.reload} />}
      />
      <LoadState loading={state.loading} error={state.error} />
      {state.data && !ticket && (
        <EmptyState
          title="Không tìm thấy yêu cầu"
          description="Yêu cầu không tồn tại hoặc không thuộc doanh nghiệp của bạn."
        />
      )}
      {ticket && (
        <div className="support-detail">
          <aside className="panel support-meta">
            <h2>Thông tin yêu cầu</h2>
            <dl className="dialog-summary">
              {[
                ["Mã", String(ticket.code)],
                ["Trạng thái", label(ticketStatusLabels, ticket.status)],
                ["Loại", label(ticketCategoryLabels, ticket.category)],
                ["Ưu tiên", label(priorityLabels, ticket.priority)],
                ["Tạo lúc", dateTime(ticket.createdAt)],
                ["Cập nhật", dateTime(lastActivity(ticket))],
              ].map(([k, v]) => (
                <div className="info-dialog-row" key={k}>
                  <dt>{k}</dt>
                  <dd>
                    {k === "Trạng thái" ? (
                      <StatusBadge value={tone(ticket.status)} label={v} />
                    ) : (
                      v
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </aside>
          <section className="panel support-thread">
            <h2>Trao đổi</h2>
            <ol className="support-messages">
              {messages.map((m) => (
                <li
                  key={String(m.id)}
                  className={m.authorSide === "PLATFORM" ? "from-platform" : "from-enterprise"}
                >
                  <div className="support-message-head">
                    <strong>
                      {m.authorSide === "PLATFORM"
                        ? "AgriTrace"
                        : String(m.authorName ?? "Doanh nghiệp")}
                    </strong>
                    <small>{dateTime(m.createdAt)}</small>
                  </div>
                  <p>{String(m.body)}</p>
                </li>
              ))}
            </ol>
            {ticket.status !== "CLOSED" ? (
              <form className="support-reply" onSubmit={send} noValidate>
                <CommandState command={command} />
                <label>
                  Trả lời
                  <textarea
                    className="input"
                    rows={3}
                    maxLength={4000}
                    value={reply}
                    aria-invalid={replyError ? true : undefined}
                    onChange={(e) => {
                      setReply(e.target.value);
                      setReplyError("");
                    }}
                  />
                  {replyError && (
                    <span className="field-error" role="alert">
                      {replyError}
                    </span>
                  )}
                </label>
                <div className="form-actions">
                  <button className="button" disabled={command.pending}>
                    {command.pending ? "Đang gửi…" : "Gửi trả lời"}
                  </button>
                </div>
              </form>
            ) : (
              <p className="notice">Yêu cầu đã đóng; gửi yêu cầu mới nếu cần hỗ trợ thêm.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
