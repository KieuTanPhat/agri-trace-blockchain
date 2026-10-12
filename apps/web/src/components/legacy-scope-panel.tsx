"use client";

import { useEffect, useState } from "react";
import { request } from "@/lib/api-client";
import type { components } from "@/lib/generated/api";
import { DataForm } from "./data-form";

type Proposal = components["schemas"]["LegacyProposalDto"];
const labels: Record<string, string> = {
  PRODUCTION: "sản xuất",
  TRANSPORT: "vận chuyển",
  RETAIL: "bán lẻ",
  REVIEW: "điều phối chuỗi",
};

export function LegacyScopePanel({ manifestId }: { manifestId: string }) {
  const [data, setData] = useState<{
    manifestId: string;
    proposals: Proposal[];
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const path = `/legacy-scope/manifests/${manifestId}`;
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setLoading(true);
    request<Proposal[]>(`${path}/proposals`, { signal: controller.signal })
      .then((proposals) => {
        if (!controller.signal.aborted) setData({ manifestId, proposals });
      })
      .catch((cause: Error) => {
        if (!controller.signal.aborted) setError(cause.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, manifestId, revision]);
  const proposals = data?.manifestId === manifestId ? data.proposals : [];
  return (
    <section className="grid" aria-label="Xác nhận dữ liệu chuyển sang chuỗi">
      <div className="panel">
        <h1>Xác nhận dữ liệu chuyển sang chuỗi</h1>
        <p>
          Tổ chức xác nhận từng công đoạn đang đảm nhiệm. Mỗi công đoạn có xác
          nhận riêng, kể cả khi cùng một doanh nghiệp thực hiện nhiều công đoạn.
        </p>
        <button
          className="button secondary"
          onClick={() => setRevision((value) => value + 1)}
        >
          Tải lại phạm vi xác nhận
        </button>
      </div>
      {loading && <p role="status">Đang kiểm tra quyền và bản xác nhận…</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && !proposals.length && (
        <p>Chưa có công đoạn cần xác nhận trong phạm vi hiện hành.</p>
      )}
      {proposals.map((p) => (
        <div className="panel" key={`${manifestId}:${p.key}`} hidden={loading || Boolean(error)} style={loading || error ? { display: "none" } : undefined}>
          <h2>{p.chainName}</h2>
          <p>
            {p.subjectLabel} · {labels[p.stage]}
          </p>
          <details>
            <summary>Mã bản xác nhận</summary>
            <p style={{ overflowWrap: "anywhere" }}>{p.planDigest}</p>
          </details>
          {confirmed.includes(`${manifestId}:${p.key}`) ? (
            <p role="status">Đã ghi nhận xác nhận công đoạn.</p>
          ) : (
            <DataForm
              title={`Xác nhận vai trò ${labels[p.stage]}`}
              path={`${path}/confirm`}
              fields={[]}
              extra={{ proposalKey: p.key }}
              onSaved={() =>
                setConfirmed((current) => [
                  ...current,
                  `${manifestId}:${p.key}`,
                ])
              }
            />
          )}
        </div>
      ))}
    </section>
  );
}
