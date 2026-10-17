"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { request } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import {
  connectEnterprise,
  errorLabels,
  getEnrollment,
  hostingLabels,
  onboardingError,
  statusLabels,
  type Enrollment,
} from "@/lib/enterprise-onboarding";
import type { components } from "@/lib/generated/api";

export default function EnterprisePage() {
  const auth = useAuth();
  const [row, setRow] = useState<Enrollment | null>(null),
    [chains, setChains] = useState<
      Array<{ id: string; name: string; ownerOrganizationId: string }>
    >([]),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const original = useRef<{
    input: components["schemas"]["EnterpriseConnectionDto"];
    key: string;
  } | null>(null);
  const refresh = useCallback(async () => {
    try {
      const [enrollment, items] = await Promise.all([
        getEnrollment(),
        request<typeof chains>("/supply-chains"),
      ]);
      setRow(enrollment);
      setChains(
        items.filter(
          (c) => c.ownerOrganizationId === auth.user?.organizationId,
        ),
      );
      setError("");
    } catch (cause) {
      setError(onboardingError(cause));
    }
  }, [auth.user?.organizationId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const availableChains = chains.filter(
    (chain) =>
      !row?.connections.some(
        (connection) =>
          connection.chainId === chain.id &&
          !["REJECTED", "FAILED"].includes(connection.status),
      ),
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !row) return;
    const data = new FormData(event.currentTarget);
    if (!original.current)
      original.current = {
        key: crypto.randomUUID(),
        input: {
          id: crypto.randomUUID(),
          chainId: String(data.get("chainId")),
          ...(row.hostingMode === "SELF_MANAGED_ORG"
            ? {
                peerHost: String(data.get("peerHost")),
                peerPort: Number(data.get("peerPort")),
                peerServerName: String(data.get("peerServerName")),
                mspId: String(data.get("mspId")),
                tlsCaPem: String(data.get("tlsCaPem")),
              }
            : {}),
        },
      };
    setPending(true);
    setError("");
    try {
      await connectEnterprise(original.current.input, original.current.key);
      original.current = null;
      await refresh();
    } catch (cause) {
      setError(onboardingError(cause));
      const { status, canRestart } = cause as {
        status?: number;
        canRestart?: boolean;
      };
      if (canRestart || (status && [400, 403, 404, 422].includes(status)))
        original.current = null;
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="grid">
      <section className="page-header">
        <div>
          <p className="eyebrow">KHÔNG GIAN DOANH NGHIỆP</p>
          <h1>Đăng ký và kết nối</h1>
        </div>
        <button
          className="button secondary"
          onClick={() => void refresh()}
          disabled={pending}
        >
          Cập nhật trạng thái
        </button>
      </section>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {row ? (
        <>
          <section className="panel">
            <h2>{row.organizationName}</h2>
            <p>
              {row.businessId} · {hostingLabels[row.hostingMode]}
            </p>
            <p className="notice" role="status">
              {statusLabels[row.status]}
            </p>
            {row.reviewNote && <p>Phản hồi: {row.reviewNote}</p>}
            {row.status === "APPROVED" && (
              <p><Link className="text-link" href="/enterprise/devices">Quản lý thiết bị giám sát</Link></p>
            )}
            <ol className="enterprise-steps">
              <li>Đăng ký doanh nghiệp</li>
              <li>Duyệt hồ sơ và quyền quản lý tổ chức</li>
              <li>Tạo chuỗi và gửi thông tin peer</li>
              <li>Chuẩn bị mạng, phê duyệt và kiểm chứng trên Fabric</li>
            </ol>
          </section>
          {row.status === "APPROVED" && (
            <section className="panel">
              <h2>Kết nối một chuỗi</h2>
              {!chains.length ? (
                <p>
                  Bạn đã được duyệt.{" "}
                  <Link className="text-link" href="/supply-chains">
                    Tạo chuỗi của doanh nghiệp
                  </Link>{" "}
                  trước khi gửi yêu cầu kết nối.
                </p>
              ) : !availableChains.length && !original.current ? (
                <p>
                  Các chuỗi hiện có đã có yêu cầu kết nối. Theo dõi trạng thái
                  bên dưới.
                </p>
              ) : (
                <form onSubmit={submit} className="grid">
                  <fieldset
                    className="enterprise-fields"
                    disabled={pending || !!original.current}
                  >
                    <label className="field">
                      Chuỗi của doanh nghiệp
                      <select className="input" name="chainId" required>
                        {availableChains.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {row.hostingMode === "SELF_MANAGED_ORG" ? (
                      <>
                        <p>
                          Chuẩn bị peer theo gói cài đặt được vận hành cấp cho
                          yêu cầu của bạn. Điền thông tin công khai bên dưới để
                          AgriTrace kiểm tra và duyệt.
                        </p>
                        <label className="field">
                          Địa chỉ peer (IP hoặc DNS)
                          <input
                            className="input"
                            name="peerHost"
                            required
                            maxLength={253}
                          />
                        </label>
                        <label className="field">
                          Cổng peer
                          <input
                            className="input"
                            name="peerPort"
                            type="number"
                            defaultValue={7051}
                            min={1}
                            max={65535}
                            required
                          />
                        </label>
                        <label className="field">
                          Tên máy trong chứng thư TLS
                          <input
                            className="input"
                            name="peerServerName"
                            required
                            maxLength={253}
                          />
                        </label>
                        <label className="field">
                          MSP của doanh nghiệp
                          <input
                            className="input"
                            name="mspId"
                            required
                            maxLength={100}
                          />
                        </label>
                        <label className="field">
                          Chứng thư TLS CA công khai (PEM)
                          <textarea
                            className="input"
                            name="tlsCaPem"
                            rows={6}
                            required
                            maxLength={16384}
                          />
                        </label>
                        <p className="muted">
                          Chỉ cung cấp chứng thư công khai. Giữ private key và
                          tài khoản SSH tại VPS của bạn.
                        </p>
                      </>
                    ) : (
                      <p>
                        AgriTrace chuẩn bị peer, chứng thư và kết nối cho chuỗi
                        sau khi yêu cầu được duyệt.
                      </p>
                    )}
                  </fieldset>
                  <button className="button" disabled={pending}>
                    {pending
                      ? "Đang gửi…"
                      : original.current
                        ? "Thử lại yêu cầu ban đầu"
                        : "Gửi yêu cầu kết nối"}
                  </button>
                </form>
              )}
            </section>
          )}
          <section className="panel">
            <h2>Yêu cầu kết nối</h2>
            {!row.connections.length && <p>Chưa có yêu cầu kết nối.</p>}
            {row.connections.map((c) => (
              <article className="enterprise-request" key={c.id}>
                <h3>
                  {chains.find((chain) => chain.id === c.chainId)?.name ??
                    "Kết nối chuỗi"}
                </h3>
                <p role="status">{statusLabels[c.status]}</p>
                {c.reviewNote && <p>{c.reviewNote}</p>}
                {c.errorCode && (
                  <p className="notice">
                    {errorLabels[c.errorCode] ??
                      "Yêu cầu đang được vận hành kiểm tra."}
                  </p>
                )}
                {c.checkedAt && (
                  <p>
                    Đã kiểm chứng lúc{" "}
                    {new Date(c.checkedAt).toLocaleString("vi-VN")}
                  </p>
                )}
                {c.txId && (
                  <details>
                    <summary>Mã giao dịch kiểm chứng</summary>
                    <code className="enterprise-tx">{c.txId}</code>
                  </details>
                )}
                <small>Mã yêu cầu: {c.id}</small>
              </article>
            ))}
          </section>
        </>
      ) : (
        !error && <p role="status">Đang tải hồ sơ…</p>
      )}
    </div>
  );
}
