"use client";

import { useRef, useState } from "react";
import type { components } from "@/lib/generated/api";
import { request } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import { getAuthorizationScope } from "@/lib/auth-scope";
import { errorMessage } from "@/lib/workspace";
import { downloadText, formatDateTime } from "@/lib/platform-governance";
import { EmptyState, PageHeader } from "@/components/manage";

type Preview = components["schemas"]["RecallPreviewDto"];

export default function RecallPage() {
  const auth = useAuth();
  const userId = auth.user?.id;
  const scope = getAuthorizationScope(auth.user);
  const [lotId, setLotId] = useState("");
  const [result, setResult] = useState<{ owner: string; data: Preview } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const data = result && result.owner === scope ? result.data : null;
  const currentUser = useRef(scope);
  currentUser.current = scope;
  async function preview() {
    const attempt = ++generation.current;
    const owner = scope;
    if (!userId) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await request<Preview>(
        `/platform-recall/${encodeURIComponent(lotId.trim())}`,
      );
      if (attempt === generation.current && owner === currentUser.current)
        setResult({ owner, data: response });
    } catch (cause) {
      if (attempt === generation.current && owner === currentUser.current)
        setError(errorMessage(cause));
    } finally {
      if (attempt === generation.current) setLoading(false);
    }
  }
  return (
    <div className="manage-console">
      <PageHeader
        title="Diễn tập thu hồi"
        description="Tra cứu lô nguồn, lượng phân bổ và các chặng liên quan. Chỉ đọc; không thực hiện thu hồi hoặc gửi thông báo."
      />
      <form
        className="manage-section manage-filter-bar"
        onSubmit={(event) => {
          event.preventDefault();
          void preview();
        }}
      >
        <label className="field">
          ID lô nguồn
          <input
            className="input"
            required
            value={lotId}
            onChange={(event) => setLotId(event.target.value)}
            placeholder="UUID của lô cần diễn tập"
          />
        </label>
        <button className="button" disabled={loading}>
          {loading ? "Đang tổng hợp…" : "Tạo bản diễn tập"}
        </button>
      </form>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <section className="manage-section">
            <div className="manage-section-heading">
              <div>
                <h2>Kết quả lúc {formatDateTime(data.generatedAt)}</h2>
                <p>
                  {data.lots.length} lô · {data.holdings.length} phân bổ ·{" "}
                  {data.movements.length} chặng
                </p>
              </div>
              <button
                className="button secondary"
                type="button"
                onClick={() =>
                  downloadText(
                    `dien-tap-${data.rootLotId}.json`,
                    JSON.stringify(data, null, 2),
                    "application/json",
                  )
                }
              >
                Tải bản diễn tập
              </button>
            </div>
            {data.truncated && (
              <p className="notice error" role="alert">
                Dữ liệu vượt giới hạn. Báo cáo chưa đầy đủ, cần thu hẹp phạm vi
                hoặc đối soát với operator.
              </p>
            )}
            {data.limitations.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </section>
          <section className="manage-section">
            <h2>Lô thuộc phạm vi</h2>
            <div className="manage-table-scroll">
              <table className="manage-table">
                <thead>
                  <tr>
                    <th>Lô</th>
                    <th>Trạng thái</th>
                    <th>Lượng ban đầu</th>
                    <th>Lượng khả dụng ghi nhận</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lots.map((lot) => (
                    <tr key={lot.id}>
                      <td data-label="Lô">
                        {lot.lotCode}
                        <small>{lot.id}</small>
                      </td>
                      <td data-label="Trạng thái">{lot.state}</td>
                      <td data-label="Lượng ban đầu">
                        {lot.initialQuantity} {lot.unit}
                      </td>
                      <td data-label="Lượng khả dụng ghi nhận">
                        {lot.availableQuantity} {lot.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="manage-section">
            <h2>Phân bổ theo doanh nghiệp</h2>
            {data.holdings.length ? (
              <div className="manage-table-scroll">
                <table className="manage-table">
                  <thead>
                    <tr>
                      <th>Doanh nghiệp</th>
                      <th>Lô</th>
                      <th>Đang phân bổ</th>
                      <th>Trong đó giữ chỗ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.holdings.map((h) => (
                      <tr key={`${h.lotId}:${h.organizationId}`}>
                        <td data-label="Doanh nghiệp">{h.organizationName}</td>
                        <td data-label="Lô">
                          {data.lots.find((l) => l.id === h.lotId)?.lotCode}
                        </td>
                        <td data-label="Đang phân bổ">{h.quantity}</td>
                        <td data-label="Trong đó giữ chỗ">{h.reserved}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="Không có phân bổ"
                description="Lô có thể đang dùng luồng giao nhận đơn; xem các chặng bên dưới."
              />
            )}
          </section>
          <section className="manage-section">
            <h2>Chặng liên quan</h2>
            <div className="manage-table-scroll">
              <table className="manage-table">
                <thead>
                  <tr>
                    <th>Chặng</th>
                    <th>Lô</th>
                    <th>Bên nhận (ID)</th>
                    <th>Lượng giao</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {data.movements.map((m) => (
                    <tr key={`${m.kind}:${m.id}:${m.lotId}`}>
                      <td data-label="Chặng">{m.id}</td>
                      <td data-label="Lô">
                        {data.lots.find((l) => l.id === m.lotId)?.lotCode}
                      </td>
                      <td data-label="Bên nhận (ID)">{m.receiverId}</td>
                      <td data-label="Lượng giao">
                        {m.quantity} {m.unit}
                      </td>
                      <td data-label="Trạng thái">{m.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
