"use client";

import { useEffect, useRef, useState } from "react";
import type { components } from "@/lib/generated/api";
import { request } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import { getAuthorizationScope } from "@/lib/auth-scope";
import { errorMessage, useWorkspaceData } from "@/lib/workspace";
import { formatDateTime } from "@/lib/platform-governance";
import { EmptyState, LoadState, PageHeader } from "@/components/manage";

type Schemas = components["schemas"];
type Ticket = Schemas["PrivacyTicketDto"];
type Detail = Schemas["PrivacyDetailDto"];
const rights: Record<string, string> = {
  ACCESS: "Truy cập / cung cấp dữ liệu",
  CORRECTION: "Chỉnh sửa dữ liệu",
  DELETION: "Xem xét xóa dữ liệu",
  RESTRICTION: "Hạn chế xử lý",
  WITHDRAWAL: "Rút lại sự đồng ý",
  OBJECTION: "Phản đối xử lý",
  INCIDENT: "Sự cố dữ liệu cá nhân",
};
const statuses: Record<string, string> = {
  OPEN: "Mới tiếp nhận",
  IN_REVIEW: "Đang xem xét",
  RESPONDED: "Đã phản hồi",
  CLOSED: "Đã đóng",
  REJECTED: "Không chấp nhận",
};

/** Private bodies remain in memory; they never enter saved command storage. */
function usePrivateCommand() {
  const original = useRef<{ path: string; body: string; key: string } | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [frozen, setFrozen] = useState(false);
  async function send(
    path: string,
    payload: object,
    done: () => void,
    mfaCode = "",
  ) {
    if (pending) return;
    original.current ??= {
      path,
      body: JSON.stringify(payload),
      key: crypto.randomUUID(),
    };
    const command = original.current;
    setPending(true);
    setFrozen(true);
    setError("");
    try {
      await request<Ticket>(command.path, {
        method: "POST",
        body: command.body,
        headers: {
          "Idempotency-Key": command.key,
          ...(mfaCode.trim() ? { "X-MFA-Code": mfaCode.trim() } : {}),
        },
      });
      original.current = null;
      setFrozen(false);
      done();
    } catch (cause) {
      setError(errorMessage(cause));
      const status = (cause as { status?: number }).status;
      if (status && [400, 401, 403, 404, 409, 422, 429].includes(status)) {
        original.current = null;
        setFrozen(false);
      }
    } finally {
      setPending(false);
    }
  }
  return { send, pending, error, frozen };
}

function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
function Clock({ row, now }: { row: Ticket; now: number }) {
  if (row.kind !== "BREACH") return <>Theo đánh giá của người xử lý</>;
  if (row.reportedAt)
    return <>Đã lưu bằng chứng báo cáo lúc {formatDateTime(row.reportedAt)}</>;
  if (row.reporting === "NOT_REQUIRED")
    return <>Đã ghi căn cứ không thuộc diện báo cáo</>;
  const minutes = row.deadlineAt
    ? Math.ceil((new Date(row.deadlineAt).getTime() - now) / 60_000)
    : null;
  const overdue = minutes !== null && minutes <= 0;
  return (
    <span className={overdue ? "notice error" : ""}>
      {overdue
        ? "Đã quá hạn · "
        : minutes === null
          ? "Hạn 72 giờ · "
          : `Còn ${Math.floor(minutes / 60)} giờ ${minutes % 60} phút · `}
      {row.deadlineAt ? formatDateTime(row.deadlineAt) : "Chưa xác định"}
    </span>
  );
}

function CreateTicket({ admin, reload }: { admin: boolean; reload(): void }) {
  const command = usePrivateCommand();
  const [requestType, setRequestType] = useState("ACCESS");
  const [message, setMessage] = useState("");
  const [detectedAt, setDetectedAt] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  return (
    <details className="manage-section">
      <summary>
        {admin ? "Ghi nhận sự cố dữ liệu cá nhân" : "Gửi yêu cầu quyền dữ liệu"}
      </summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void command.send(
            admin ? "/platform-privacy/breaches" : "/privacy-requests",
            admin
              ? { message, detectedAt: new Date(detectedAt).toISOString() }
              : { requestType, message },
            () => {
              setMessage("");
              reload();
            },
            mfaCode,
          );
        }}
      >
        <fieldset disabled={command.frozen || command.pending}>
          {admin ? (
            <label className="field">
              Thời điểm phát hiện
              <input
                type="datetime-local"
                className="input"
                required
                value={detectedAt}
                onChange={(event) => setDetectedAt(event.target.value)}
              />
              <small>
                Đồng hồ 72 giờ bắt đầu từ thời điểm này. Không thể sửa sau khi
                ghi nhận.
              </small>
            </label>
          ) : (
            <label className="field">
              Loại yêu cầu
              <select
                className="input"
                value={requestType}
                onChange={(event) => setRequestType(event.target.value)}
              >
                {Object.entries(rights)
                  .filter(([key]) => key !== "INCIDENT")
                  .map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label className="field">
            Nội dung riêng tư
            <textarea
              className="input"
              required
              minLength={10}
              maxLength={4000}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
            <small>
              Không nhập mật khẩu, OTP, khóa ký hoặc tài liệu định danh không
              cần thiết.
            </small>
          </label>
        </fieldset>
        {admin && (
          <label className="field">
            Mã xác thực hai yếu tố (nếu đã bật)
            <input
              className="input"
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value)}
              autoComplete="one-time-code"
              maxLength={20}
              disabled={command.pending}
            />
          </label>
        )}
        {command.error && (
          <p className="notice error" role="alert">
            {command.error}
          </p>
        )}
        {command.frozen && (
          <p className="notice">
            Giữ tab này và thử lại cùng yêu cầu để đối soát. Chưa tạo yêu cầu
            khác khi kết quả chưa rõ.
          </p>
        )}
        <button className="button" disabled={command.pending}>
          {command.pending
            ? "Đang xử lý…"
            : "Gửi hồ sơ"}
        </button>
      </form>
    </details>
  );
}

function TicketDetail({
  id,
  admin,
  changed,
}: {
  id: string;
  admin: boolean;
  changed(): void;
}) {
  const now = useMinuteClock();
  const detail = useWorkspaceData<Detail>(
    `${admin ? "/platform-privacy" : "/privacy-requests"}/${id}`,
  );
  const row = detail.data;
  const command = usePrivateCommand();
  const [status, setStatus] = useState("IN_REVIEW");
  const [note, setNote] = useState("");
  const [visibility, setVisibility] = useState("INTERNAL");
  const [reporting, setReporting] = useState("");
  const [reportedAt, setReportedAt] = useState("");
  const [reference, setReference] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  return (
    <section className="manage-section">
      <h2>Chi tiết hồ sơ</h2>
      <LoadState {...detail} />
      {row && (
        <>
          <p>
            {rights[row.requestType]} · {statuses[row.status]}
          </p>
          <p>
            <Clock row={row} now={now} />
          </p>
          <p style={{ whiteSpace: "pre-wrap" }}>{row.message}</p>
          <h3>Lịch sử xử lý</h3>
          {row.events.length ? (
            row.events.map((event) => (
              <article key={event.id}>
                <p>
                  {formatDateTime(event.createdAt)} ·{" "}
                  {event.visibility === "SHARED"
                    ? "Chia sẻ với người yêu cầu"
                    : "Nội bộ"}
                </p>
                <p style={{ whiteSpace: "pre-wrap" }}>{event.note}</p>
                {event.notificationReference && (
                  <p>Bằng chứng: {event.notificationReference}</p>
                )}
              </article>
            ))
          ) : (
            <p>Chưa có phản hồi.</p>
          )}
          {admin && !["CLOSED", "REJECTED"].includes(row.status) && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void command.send(
                  `/platform-privacy/${id}/review`,
                  {
                    version: row.version,
                    status,
                    note,
                    ...(row.kind === "BREACH"
                      ? {
                          ...(reporting ? { reporting } : {}),
                          ...(reportedAt
                            ? {
                                reportedAt: new Date(reportedAt).toISOString(),
                                notificationReference: reference,
                              }
                            : {}),
                        }
                      : { visibility }),
                  },
                  () => {
                    setNote("");
                    detail.reload();
                    changed();
                  },
                  mfaCode,
                );
              }}
            >
              <fieldset disabled={command.frozen || command.pending}>
                <label className="field">
                  Trạng thái tiếp theo
                  <select
                    className="input"
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                  >
                    {["IN_REVIEW", "RESPONDED", "CLOSED", "REJECTED"].map(
                      (value) => (
                        <option key={value} value={value}>
                          {statuses[value]}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                {row.kind === "BREACH" ? (
                  <>
                    <label className="field">
                      Đánh giá nghĩa vụ báo cáo
                      <select
                        className="input"
                        value={reporting}
                        onChange={(event) => setReporting(event.target.value)}
                      >
                        <option value="">
                          Giữ đánh giá hiện tại ({row.reporting})
                        </option>
                        <option value="REQUIRED">Cần báo cáo</option>
                        <option value="NOT_REQUIRED">
                          Không thuộc diện báo cáo (ghi căn cứ)
                        </option>
                      </select>
                    </label>
                    {!row.reportedAt && (
                      <>
                        <label className="field">
                          Đã thông báo bên ngoài lúc
                          <input
                            type="datetime-local"
                            className="input"
                            value={reportedAt}
                            onChange={(event) =>
                              setReportedAt(event.target.value)
                            }
                          />
                        </label>
                        <label className="field">
                          Tham chiếu bằng chứng
                          <input
                            className="input"
                            maxLength={500}
                            required={!!reportedAt}
                            minLength={5}
                            value={reference}
                            onChange={(event) =>
                              setReference(event.target.value)
                            }
                          />
                        </label>
                      </>
                    )}
                  </>
                ) : (
                  <label className="field">
                    Phạm vi phản hồi
                    <select
                      className="input"
                      value={visibility}
                      onChange={(event) => setVisibility(event.target.value)}
                    >
                      <option value="INTERNAL">Ghi chú nội bộ</option>
                      <option value="SHARED">Chia sẻ với người yêu cầu</option>
                    </select>
                  </label>
                )}
                <label className="field">
                  Nội dung / căn cứ
                  <textarea
                    className="input"
                    required
                    minLength={reporting === "NOT_REQUIRED" ? 20 : 10}
                    maxLength={4000}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
              </fieldset>
              <label className="field">
                Mã xác thực hai yếu tố (nếu đã bật)
                <input
                  className="input"
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value)}
                  autoComplete="one-time-code"
                  maxLength={20}
                  disabled={command.pending}
                />
              </label>
              {command.error && (
                <p className="notice error" role="alert">
                  {command.error}
                </p>
              )}
              {command.frozen && (
                <p className="notice">
                  Yêu cầu được giữ nguyên để thử lại. Không đóng tab khi chưa
                  đối soát.
                </p>
              )}
              <button className="button" disabled={command.pending}>
                {command.pending
                  ? "Đang lưu…"
                  : "Lưu xử lý"}
              </button>
              {!command.frozen && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={detail.reload}
                >
                  Tải lại trạng thái hồ sơ
                </button>
              )}
            </form>
          )}
        </>
      )}
    </section>
  );
}

function PrivacyContent({ admin }: { admin: boolean }) {
  const now = useMinuteClock();
  const [cursor, setCursor] = useState("");
  const [selected, setSelected] = useState("");
  const state = useWorkspaceData<Schemas["PrivacyPageDto"]>(
    `${admin ? "/platform-privacy" : "/privacy-requests"}${cursor ? `?cursor=${cursor}` : ""}`,
  );
  return (
    <div className="manage-console">
      <PageHeader
        eyebrow={
          admin ? "Quản trị / Quyền riêng tư" : "Tài khoản / Quyền riêng tư"
        }
        title={admin ? "Hộp thư dữ liệu cá nhân" : "Quyền dữ liệu cá nhân"}
        description={
          admin
            ? "Tiếp nhận yêu cầu, đánh giá sự cố và lưu bằng chứng báo cáo. Hệ thống không tự gửi báo cáo cho cơ quan bên ngoài."
            : "Yêu cầu được xem xét trước khi thực hiện. Việc gửi yêu cầu xóa không tự xóa lịch sử truy xuất hoặc bằng chứng phải lưu giữ."
        }
      />
      <CreateTicket admin={admin} reload={state.reload} />
      <LoadState {...state} />
      <section className="manage-section">
        <h2>{admin ? "Hàng đợi xử lý" : "Yêu cầu của bạn"}</h2>
        {state.data?.items.length ? (
          <div className="manage-table-scroll">
            <table className="manage-table">
              <thead>
                <tr>
                  <th>Loại</th>
                  <th>Tiếp nhận</th>
                  <th>Trạng thái</th>
                  <th>Thời hạn / báo cáo</th>
                  <th>Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Loại">{rights[row.requestType]}</td>
                    <td data-label="Tiếp nhận">{formatDateTime(row.createdAt)}</td>
                    <td data-label="Trạng thái">{statuses[row.status]}</td>
                    <td data-label="Thời hạn / báo cáo">
                      <Clock row={row} now={now} />
                    </td>
                    <td data-label="Chi tiết">
                      <button
                        className="button secondary"
                        onClick={() => setSelected(row.id)}
                      >
                        Xem
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !state.loading &&
          !state.error && (
            <EmptyState
              title="Chưa có hồ sơ"
              description="Hồ sơ mới sẽ xuất hiện sau khi được tiếp nhận."
            />
          )
        )}
        <div className="manage-filter-bar">
          {cursor && (
            <button className="button secondary" onClick={() => setCursor("")}>
              Trang đầu
            </button>
          )}
          {state.data?.nextCursor && (
            <button
              className="button secondary"
              onClick={() => setCursor(state.data!.nextCursor!)}
            >
              Trang tiếp
            </button>
          )}
          <button className="button secondary" onClick={state.reload}>
            Tải lại
          </button>
        </div>
      </section>
      {selected && (
        <TicketDetail
          key={selected}
          id={selected}
          admin={admin}
          changed={state.reload}
        />
      )}
    </div>
  );
}

export function PrivacyWorkspace({ admin = false }: { admin?: boolean }) {
  const auth = useAuth();
  if (
    !auth.user ||
    (admin &&
      !["SYSTEM_ADMIN", "PLATFORM_PRIVACY_OFFICER"].includes(
        auth.user.role.code,
      ))
  )
    return null;
  return (
    <PrivacyContent
      key={`${getAuthorizationScope(auth.user)}:${admin}`}
      admin={admin}
    />
  );
}
