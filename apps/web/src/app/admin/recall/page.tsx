"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
          <Input
            className="input"
            required
            value={lotId}
            onChange={(event) => setLotId(event.target.value)}
            placeholder="UUID của lô cần diễn tập"
          />
        </label>
        <Button className="button" disabled={loading}>
          {loading ? "Đang tổng hợp…" : "Tạo bản diễn tập"}
        </Button>
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
              <Button
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
              </Button>
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
              <Table className="manage-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Lô</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead>Lượng ban đầu</TableHead>
                    <TableHead>Lượng khả dụng ghi nhận</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.lots.map((lot) => (
                    <TableRow key={lot.id}>
                      <TableCell data-label="Lô">
                        {lot.lotCode}
                        <small>{lot.id}</small>
                      </TableCell>
                      <TableCell data-label="Trạng thái">{lot.state}</TableCell>
                      <TableCell data-label="Lượng ban đầu">
                        {lot.initialQuantity} {lot.unit}
                      </TableCell>
                      <TableCell data-label="Lượng khả dụng ghi nhận">
                        {lot.availableQuantity} {lot.unit}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
          <section className="manage-section">
            <h2>Phân bổ theo doanh nghiệp</h2>
            {data.holdings.length ? (
              <div className="manage-table-scroll">
                <Table className="manage-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Doanh nghiệp</TableHead>
                      <TableHead>Lô</TableHead>
                      <TableHead>Đang phân bổ</TableHead>
                      <TableHead>Trong đó giữ chỗ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.holdings.map((h) => (
                      <TableRow key={`${h.lotId}:${h.organizationId}`}>
                        <TableCell data-label="Doanh nghiệp">{h.organizationName}</TableCell>
                        <TableCell data-label="Lô">
                          {data.lots.find((l) => l.id === h.lotId)?.lotCode}
                        </TableCell>
                        <TableCell data-label="Đang phân bổ">{h.quantity}</TableCell>
                        <TableCell data-label="Trong đó giữ chỗ">{h.reserved}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
              <Table className="manage-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Chặng</TableHead>
                    <TableHead>Lô</TableHead>
                    <TableHead>Bên nhận (ID)</TableHead>
                    <TableHead>Lượng giao</TableHead>
                    <TableHead>Trạng thái</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.movements.map((m) => (
                    <TableRow key={`${m.kind}:${m.id}:${m.lotId}`}>
                      <TableCell data-label="Chặng">{m.id}</TableCell>
                      <TableCell data-label="Lô">
                        {data.lots.find((l) => l.id === m.lotId)?.lotCode}
                      </TableCell>
                      <TableCell data-label="Bên nhận (ID)">{m.receiverId}</TableCell>
                      <TableCell data-label="Lượng giao">
                        {m.quantity} {m.unit}
                      </TableCell>
                      <TableCell data-label="Trạng thái">{m.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
