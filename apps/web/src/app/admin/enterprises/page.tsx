"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-store";
import {
  errorLabels,
  hostingLabels,
  listEnrollments,
  onboardingError,
  reviewEnterprise,
  statusLabels,
  type Enrollment,
} from "@/lib/enterprise-onboarding";

function Review({
  kind,
  id,
  version,
  onDone,
}: {
  kind: "enterprise-enrollments" | "enterprise-connections";
  id: string;
  version: number;
  onDone: () => Promise<void>;
}) {
  const [note, setNote] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const original = useRef<{
    key: string;
    input: { version: number; note: string; decision: "APPROVE" | "REJECT" };
  } | null>(null);
  async function send(decision: "APPROVE" | "REJECT") {
    if (pending || !note.trim()) return;
    original.current ??= {
      key: crypto.randomUUID(),
      input: { version, note: note.trim(), decision },
    };
    setPending(true);
    setError("");
    try {
      await reviewEnterprise(
        kind,
        id,
        original.current.input,
        original.current.key,
      );
      original.current = null;
      await onDone();
    } catch (cause) {
      setError(onboardingError(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="grid">
      <label className="field">
        Ghi chú xét duyệt
        <textarea
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          disabled={pending || !!original.current}
        />
      </label>
      {error && (
        <p role="alert" className="notice error">
          {error} Giữ nguyên yêu cầu để đối soát.
        </p>
      )}
      <div className="actions">
        <button
          className="button"
          onClick={() => void send("APPROVE")}
          disabled={pending || !note.trim()}
        >
          {original.current ? "Thử lại quyết định ban đầu" : "Phê duyệt"}
        </button>
        {!original.current && (
          <button
            className="button secondary"
            onClick={() => void send("REJECT")}
            disabled={pending || !note.trim()}
          >
            Từ chối
          </button>
        )}
      </div>
    </div>
  );
}
export default function EnterpriseAdminPage() {
  const auth = useAuth(),
    [rows, setRows] = useState<Enrollment[]>([]),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setRows(await listEnrollments());
      setError("");
    } catch (cause) {
      setError(onboardingError(cause));
    }
  }, []);
  useEffect(() => {
    if (auth.user?.role.code === "SYSTEM_ADMIN") void refresh();
  }, [auth.user?.role.code, refresh]);
  if (auth.user?.role.code !== "SYSTEM_ADMIN")
    return <p role="alert">Bạn không có quyền xét duyệt doanh nghiệp.</p>;
  return (
    <div className="grid">
      <section className="page-header">
        <div>
          <p className="eyebrow">QUẢN TRỊ</p>
          <h1>Doanh nghiệp và kết nối</h1>
        </div>
        <button className="button secondary" onClick={() => void refresh()}>
          Cập nhật
        </button>
      </section>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {!rows.length && !error && (
        <section className="panel">
          <p>Chưa có hồ sơ tự đăng ký.</p>
        </section>
      )}
      {rows.map((row) => (
        <section className="panel grid" key={row.id}>
          <div>
            <h2>{row.organizationName}</h2>
            <p>
              {row.businessId} · {hostingLabels[row.hostingMode]}
            </p>
            <p>{statusLabels[row.status]}</p>
            <p>
              {row.representativeName} · {row.representativeEmail}
            </p>
            <small>Mã hồ sơ: {row.id}</small>
          </div>
          {row.reviewNote && <p>{row.reviewNote}</p>}
          {row.status === "PENDING_REVIEW" && (
            <>
              <p>
                Xác minh thông tin doanh nghiệp trước khi cấp năng lực và quyền
                tạo chuỗi.
              </p>
              <Review
                kind="enterprise-enrollments"
                id={row.id}
                version={row.version}
                onDone={refresh}
              />
            </>
          )}
          {row.connections.map((c) => (
            <article className="enterprise-request" key={c.id}>
              <h3>Yêu cầu kết nối</h3>
              <p>{statusLabels[c.status]}</p>
              <p>
                Mã yêu cầu: <code>{c.id}</code>
              </p>
              <p>
                Chuỗi: <code>{c.chainId}</code>
              </p>
              {c.errorCode && (
                <p role="status">
                  {errorLabels[c.errorCode] ?? "Cần vận hành kiểm tra."}
                </p>
              )}
              {c.reviewNote && <p>{c.reviewNote}</p>}
              <details>
                <summary>Thông tin kết nối công khai</summary>
                <pre className="enterprise-tx">
                  {JSON.stringify(c.publicConfig, null, 2)}
                </pre>
              </details>
              {c.status === "PENDING_REVIEW" && (
                <>
                  <p>
                    Phê duyệt đưa yêu cầu vào hàng chờ chuẩn bị mạng. Worker chỉ
                    kiểm tra đích do vận hành cấu hình và chỉ xác nhận sau giao
                    dịch Fabric hợp lệ.
                  </p>
                  <Review
                    kind="enterprise-connections"
                    id={c.id}
                    version={c.version}
                    onDone={refresh}
                  />
                </>
              )}
              {c.txId && <p className="enterprise-tx">Giao dịch: {c.txId}</p>}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
