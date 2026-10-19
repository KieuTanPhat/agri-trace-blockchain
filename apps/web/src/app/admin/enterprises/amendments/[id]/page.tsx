"use client";

import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { request } from "@/lib/api-client";
import {
  useWorkspaceData,
  useWorkspaceCommand,
  errorMessage,
  labels,
  textValue,
  type ProfileAmendmentDetail,
  type ProfileEvidenceContent,
  type RecordOf,
} from "@/lib/workspace";

import { LEGAL_FORM_OPTIONS } from "@/lib/registration-form";
import { CommandState, LoadState, PageHeader } from "@/components/manage";

const legalForm = (value: unknown) =>
  LEGAL_FORM_OPTIONS.find(([code]) => code === value)?.[1] ?? textValue(value);
const decisions: Record<string, string> = {
  APPROVED: "Đã duyệt",
  REJECTED: "Đã từ chối",
  WITHDRAWN: "Doanh nghiệp đã rút",
  PENDING_REVIEW: "Chờ xét duyệt",
};
const list = (values: string[] = []) =>
  values.map((v) => labels[v] ?? v).join(", ") || "—";

export default function ProfileAmendmentReviewPage() {
  const { id } = useParams<{ id: string }>();
  const state = useWorkspaceData<RecordOf<ProfileAmendmentDetail>>(
    `/enterprise-profile-amendments/${id}`,
  );
  const cmd = useWorkspaceCommand();
  const [decision, setDecision] = useState<"APPROVE" | "REJECT">("APPROVE");
  const [fileError, setFileError] = useState("");
  const data = state.data?.record;
  const target = data?.amendment.target;
  const nextLegal = target?.legalData;
  const currentLegal = data?.profile?.legalData;
  const rows: [string, unknown, unknown][] =
    data && target
    ? [
        ["Tên tổ chức", data.organization.name, target.name],
        [
          "Loại hình",
          legalForm(data.profile?.legalForm),
          legalForm(target.legalForm),
        ],
        ["Mã pháp lý", currentLegal?.businessId, nextLegal?.businessId],
        [
          "Số giấy đăng ký",
          currentLegal?.registrationNumber,
          nextLegal?.registrationNumber,
        ],
        ["Người đại diện", data.profile?.representative, target.representative],
        [
          "Chức vụ đại diện",
          currentLegal?.representativeTitle,
          nextLegal?.representativeTitle,
        ],
        [
          "Địa chỉ",
          [data.profile?.address, data.profile?.ward, data.profile?.province]
            .filter(Boolean)
            .join(", "),
          [target.address, target.ward, target.province]
            .filter(Boolean)
            .join(", "),
        ],
        ["Hoạt động", list(data.profile?.activities), list(target.activities)],
      ]
    : [];
  async function download(evidenceId: string) {
    setFileError("");
    try {
      const { record: file } = await request<RecordOf<ProfileEvidenceContent>>(`/enterprise-profile-amendments/${id}/evidence/${evidenceId}`);
      const bytes = Uint8Array.from(atob(file.contentBase64), (c) =>
        c.charCodeAt(0),
      );
      const digest = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      ]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      if (digest !== file.sha256)
        throw new Error("File không khớp hash chứng cứ");
      const url = URL.createObjectURL(
        new Blob([bytes], { type: file.mediaType }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = file.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setFileError(errorMessage(cause));
    }
  }
  async function review(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data) return;
    const reason = String(
      new FormData(e.currentTarget).get("reason") ?? "",
    ).trim();
    if (
      await cmd.run(`/enterprise-profile-amendments/${id}/review`, {
        version: data.amendment.version,
        decision: data.stale ? "REJECT" : decision,
        reason,
      })
    )
      state.reload();
  }
  return (
    <div className="manage-console">
      <PageHeader
        title={
          data
            ? `Điều chỉnh hồ sơ · ${data.organization.name}`
            : "Điều chỉnh hồ sơ"
        }
        description="So sánh thông tin đang hiệu lực với bản đề nghị và giấy tờ riêng tư trước khi quyết định."
        back="/admin/enterprises/amendments"
      />
      <LoadState {...state} />
      {data && (
        <>
          <section className="manage-section">
            <h2>Thông tin thay đổi</h2>
            <dl className="review-details">
              {rows.map(([label, current, next]) => {
                const changed = String(current ?? "") !== String(next ?? "");
                return (
                  <div style={{ display: "contents" }} key={label}>
                    <dt>{label}</dt>
                    <dd>
                      {changed ? (
                        <>
                          Đang hiệu lực: {textValue(current || null)}
                          <br />
                          <strong>Đề nghị: {textValue(next || null)}</strong>
                        </>
                      ) : (
                        <>{textValue(next || null)} (không đổi)</>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p>Lý do doanh nghiệp: {data.amendment.reason}</p>
            <p>
              Trạng thái hồ sơ đăng ký:{" "}
              {decisions[String(data.enrollment?.status)] ??
                textValue(data.enrollment?.status)}
            </p>
          </section>
          <section className="manage-section">
            <h2>Giấy tờ đính kèm</h2>
            {fileError && (
              <p className="notice error" role="alert">
                {fileError}
              </p>
            )}
            <ul>
              {data.evidence.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => void download(r.id)}
                  >
                    {r.fileName}
                  </button>{" "}
                  · {r.description} · SHA-256 {r.sha256.slice(0, 12)}…
                </li>
              ))}
            </ul>
          </section>
          <section className="manage-section">
            <h2>Quyết định</h2>
            {data.amendment.status !== "PENDING" ? (
              <p>
                Đã xử lý:{" "}
                {decisions[String(data.amendment.status)] ??
                  textValue(data.amendment.status)}
                {data.amendment.reviewNote
                  ? ` · ${textValue(data.amendment.reviewNote)}`
                  : ""}
              </p>
            ) : (
              <form className="workspace-form" onSubmit={review}>
                {data.stale && (
                  <p className="notice error" role="alert">
                    Hồ sơ hiệu lực đã thay đổi sau khi doanh nghiệp gửi bản này.
                    Chỉ có thể từ chối; doanh nghiệp cần gửi bản mới.
                  </p>
                )}
                <CommandState command={cmd} />
                <fieldset
                  disabled={cmd.pending || cmd.frozen}
                  className="enterprise-fields"
                >
                  <label>
                    Quyết định
                    <select
                      className="input"
                      value={data.stale ? "REJECT" : decision}
                      onChange={(e) =>
                        setDecision(e.target.value as "APPROVE" | "REJECT")
                      }
                    >
                      {!data.stale && (
                        <option value="APPROVE">Duyệt điều chỉnh</option>
                      )}
                      <option value="REJECT">Từ chối</option>
                    </select>
                  </label>
                  <label>
                    Căn cứ quyết định
                    <textarea
                      className="input"
                      name="reason"
                      required
                      minLength={10}
                      maxLength={1000}
                    />
                  </label>
                </fieldset>
                <button className="button" disabled={cmd.pending}>
                  {cmd.frozen ? "Thử lại yêu cầu cũ" : "Ghi quyết định"}
                </button>
              </form>
            )}
          </section>
        </>
      )}
    </div>
  );
}
