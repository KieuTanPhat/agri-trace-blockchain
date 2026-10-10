"use client";
import { useCallback, useEffect, useState } from "react";
import { DataForm, type Field } from "@/components/data-form";
import { getLots, getProductionCycles, request } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import { getAuthorizationScope } from "@/lib/auth-scope";
import type { components } from "@/lib/generated/api";
import type { LotTrace, ProductionCycleOption } from "@/lib/types";

type Certificate = components["schemas"]["CertificateRecordDto"];
type Inspection = components["schemas"]["InspectionListDto"];
type Snapshot = {
  scope: string;
  certificates: Certificate[];
  inspections: Inspection[];
  lots: LotTrace[];
  cycles: ProductionCycleOption[];
};

export default function CompliancePage() {
  const { user } = useAuth();
  const scope = getAuthorizationScope(user);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState({ scope: "", message: "" });
  const load = useCallback(async () => {
    if (!scope) return;
    setError({ scope, message: "" });
    try {
      const [certificates, inspections, lots, cycles] = await Promise.all([
        request<Certificate[]>("/certificates"),
        request<Inspection[]>("/inspections"),
        getLots(),
        getProductionCycles(),
      ]);
      setSnapshot({ scope, certificates, inspections, lots, cycles });
    } catch (cause) {
      setError({
        scope,
        message:
          cause instanceof Error
            ? cause.message
            : String(
                (cause as { message?: string })?.message ??
                  "Không tải được dữ liệu kiểm định.",
              ),
      });
    }
  }, [scope]);
  useEffect(() => {
    void load();
  }, [load]);
  const data = snapshot?.scope === scope ? snapshot : null;
  return (
    <div className="grid">
      <section className="page-header">
        <h1>Kiểm định và chứng nhận</h1>
        <button className="button secondary" onClick={() => void load()}>
          Tải lại
        </button>
      </section>
      {error.scope === scope && error.message && (
        <p className="notice error" role="alert">
          {error.message}
        </p>
      )}
      {data && user ? (
        <ComplianceWorkbench
          key={scope}
          data={data}
          role={user.role.code}
          userId={user.id}
          onSaved={() => void load()}
        />
      ) : (
        <p role="status">Đang tải dữ liệu trong phạm vi được cấp...</p>
      )}
    </div>
  );
}

function ComplianceWorkbench({
  data,
  role,
  userId,
  onSaved,
}: {
  data: Snapshot;
  role: string;
  userId: string;
  onSaved(): void;
}) {
  const [subjectKind, setSubjectKind] = useState<"lotId" | "cycleId">("lotId");
  const [replacementId, setReplacementId] = useState("");
  const [inspectionId, setInspectionId] = useState("");
  const [reviewId, setReviewId] = useState("");
  const { certificates, inspections, lots, cycles } = data;
  const replacements = certificates.filter(
    (item) =>
      item.status === "APPROVED" &&
      !certificates.some(
        (child) =>
          child.supersedesId === item.id &&
          ["PENDING", "APPROVED"].includes(child.status),
      ),
  );
  const replacement = replacements.find((item) => item.id === replacementId);
  const originalInspection = inspections.find(
    (item) =>
      item.id === inspectionId &&
      !inspections.some((child) => child.supersedesId === item.id),
  );
  const pending = certificates.filter(
    (item) => item.status === "PENDING" && item.submittedByUserId !== userId,
  );
  const review = pending.find((item) => item.id === reviewId);
  const correctionFields: Field[] = [
    {
      name: "correctionReason",
      label: "Lý do thay thế",
      required: true,
      maxLength: 1000,
    },
  ];
  const certificateFields: Field[] = [
    ...(!replacement
      ? [
          {
            name: subjectKind,
            label: subjectKind === "lotId" ? "Lô hàng" : "Vụ trồng",
            required: true,
            options:
              subjectKind === "lotId"
                ? lots.map((lot) => ({ value: lot.lotId, label: lot.lotCode }))
                : cycles.map((cycle) => ({
                    value: cycle.id,
                    label: cycle.cycleCode,
                  })),
          },
        ]
      : correctionFields),
    { name: "type", label: "Loại chứng nhận", required: true, maxLength: 120 },
    { name: "issuer", label: "Đơn vị cấp", required: true, maxLength: 255 },
    { name: "issueDate", label: "Ngày cấp", type: "date", required: true },
    { name: "expiryDate", label: "Ngày hết hạn", type: "date" },
    {
      name: "documentRef",
      label: "Tham chiếu tài liệu nội bộ",
      required: true,
      maxLength: 2048,
    },
    {
      name: "documentHash",
      label: "SHA-256 tài liệu (64 ký tự hex chữ thường)",
      required: true,
      pattern: "[a-f0-9]{64}",
      maxLength: 64,
    },
    {
      name: "isPublic",
      label: "Công khai thông tin chứng nhận sau khi được duyệt",
      type: "checkbox",
    },
  ];
  return (
    <>
      {role === "FARM_STAFF" && (
        <section className="grid">
          <label className="field">
            Chứng nhận gốc hoặc bản thay thế
            <select
              className="select"
              value={replacementId}
              onChange={(event) => setReplacementId(event.target.value)}
            >
              <option value="">Nộp chứng nhận mới</option>
              {replacements.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.type} — {item.issuer} — {item.id}
                </option>
              ))}
            </select>
          </label>
          {!replacementId && (
            <label className="field">
              Đối tượng
              <select
                className="select"
                value={subjectKind}
                onChange={(event) =>
                  setSubjectKind(event.target.value as "lotId" | "cycleId")
                }
              >
                <option value="lotId">Lô hàng</option>
                <option value="cycleId">Vụ trồng</option>
              </select>
            </label>
          )}
          {!replacementId || replacement ? (
            <DataForm
              key={subjectKind + replacementId}
              title={
                replacement ? "Nộp bản thay thế để xét duyệt" : "Nộp chứng nhận"
              }
              path="/certificates"
              fields={certificateFields}
              extra={
                replacement
                  ? {
                      supersedesId: replacement.id,
                      ...(replacement.lotId
                        ? { lotId: replacement.lotId }
                        : { cycleId: replacement.cycleId }),
                    }
                  : {}
              }
              onSaved={onSaved}
            />
          ) : (
            <p className="notice">
              Bản gốc đã thay đổi. Chọn lại chứng nhận trước khi nộp.
            </p>
          )}
        </section>
      )}
      {role === "COMPLIANCE_REVIEWER" && (
        <section className="grid two">
          <div className="grid">
            <label className="field">
              Kiểm định gốc hoặc bản sửa
              <select
                className="select"
                value={inspectionId}
                onChange={(event) => setInspectionId(event.target.value)}
              >
                <option value="">Ghi kiểm định mới</option>
                {inspections
                  .filter(
                    (item) =>
                      !inspections.some(
                        (child) => child.supersedesId === item.id,
                      ),
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.lot.lotCode} — {item.result} — {item.inspectedAt}
                    </option>
                  ))}
              </select>
            </label>
            {(!inspectionId || originalInspection) && (
              <DataForm
                key={inspectionId}
                title={
                  originalInspection
                    ? "Ghi bản sửa kiểm định"
                    : "Ghi kiểm định"
                }
                path="/inspections"
                extra={
                  originalInspection
                    ? {
                        lotId: originalInspection.lotId,
                        supersedesId: originalInspection.id,
                      }
                    : {}
                }
                fields={[
                  ...(!originalInspection
                    ? [
                        {
                          name: "lotId",
                          label: "Lô được phân công",
                          required: true,
                          options: lots.map((lot) => ({
                            value: lot.lotId,
                            label: lot.lotCode,
                          })),
                        },
                      ]
                    : correctionFields),
                  {
                    name: "result",
                    label: "Kết quả",
                    required: true,
                    options: [
                      { value: "PASS", label: "Đạt" },
                      { value: "FAIL", label: "Không đạt" },
                      { value: "CONDITIONAL", label: "Có điều kiện" },
                    ],
                  },
                  {
                    name: "inspectedAt",
                    label: "Thời điểm kiểm định",
                    type: "datetime-local",
                    required: true,
                  },
                  { name: "note", label: "Ghi chú nội bộ", maxLength: 1000 },
                  {
                    name: "evidenceRef",
                    label: "Tham chiếu bằng chứng nội bộ",
                    maxLength: 2048,
                  },
                ]}
                onSaved={onSaved}
              />
            )}
          </div>
          <div className="grid">
            <label className="field">
              Chứng nhận đang chờ duyệt
              <select
                className="select"
                value={reviewId}
                onChange={(event) => setReviewId(event.target.value)}
              >
                <option value="">Chọn chứng nhận</option>
                {pending.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.type} — {item.issuer} — {item.id}
                  </option>
                ))}
              </select>
            </label>
            {review && (
              <>
                <p>
                  SHA-256:{" "}
                  <span style={{ overflowWrap: "anywhere" }}>
                    {review.documentHash}
                  </span>
                </p>
                <p>Tham chiếu nội bộ: {review.documentRef}</p>
                <DataForm
                  key={review.id + review.version}
                  title="Ghi quyết định duyệt một lần"
                  path={`/certificates/${review.id}/review`}
                  method="PATCH"
                  extra={{ version: review.version }}
                  fields={[
                    {
                      name: "status",
                      label: "Quyết định",
                      required: true,
                      options: [
                        { value: "APPROVED", label: "Phê duyệt" },
                        { value: "REJECTED", label: "Từ chối" },
                      ],
                    },
                    {
                      name: "reviewNote",
                      label: "Ghi chú xét duyệt nội bộ",
                      maxLength: 1000,
                    },
                  ]}
                  onSaved={onSaved}
                />
              </>
            )}
          </div>
        </section>
      )}
      <section className="panel">
        <h2>Chứng nhận trong phạm vi được cấp</h2>
        {certificates.length ? (
          certificates.map((item) => (
            <article key={item.id}>
              <h3>
                {item.type} — {item.issuer}
              </h3>
              <p>
                {item.status} ·{" "}
                {item.status === "APPROVED" &&
                !certificates.some(
                  (child) =>
                    child.supersedesId === item.id &&
                    child.status === "APPROVED",
                )
                  ? "Đã duyệt, chưa có bản thay thế được duyệt"
                  : "Chưa hiệu lực hoặc đã được thay thế"}{" "}
                · {item.isPublic ? "Cho phép công khai sau duyệt" : "Nội bộ"}
              </p>
              <p>
                Đối tượng: {item.lotId ?? item.cycleId} · Phiên bản{" "}
                {item.version}
              </p>
              {item.supersedesId && (
                <p>
                  Thay thế: {item.supersedesId} · {item.correctionReason}
                </p>
              )}
            </article>
          ))
        ) : (
          <p>Chưa có chứng nhận.</p>
        )}
      </section>
      <section className="panel">
        <h2>Lịch sử kiểm định</h2>
        {inspections.length ? (
          inspections.map((item) => (
            <article key={item.id}>
              <h3>
                {item.lot.lotCode} — {item.result}
              </h3>
              <p>
                {item.inspectedAt} · {item.organization?.name}
              </p>
              {item.note && <p>{item.note}</p>}
              {item.supersedesId && (
                <p>
                  Sửa kiểm định {item.supersedesId}: {item.correctionReason}
                </p>
              )}
            </article>
          ))
        ) : (
          <p>Chưa có kiểm định.</p>
        )}
      </section>
    </>
  );
}
