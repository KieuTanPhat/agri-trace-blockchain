"use client";
import { useState } from "react";
import { EvidenceThumbnails } from "@/components/workspace/image-gallery";
import { Download, FileCheck2 } from "lucide-react";
import { request } from "@/lib/api-client";
import { onboardingError } from "@/lib/enterprise-onboarding";
import {
  INTEREST_OPTIONS,
  CERTIFICATION_OPTIONS,
} from "@/lib/registration-form";
import type { components } from "@/lib/generated/api";
type S = components["schemas"];
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
    : Array.isArray(value)
      ? value.join(", ")
      : "Chưa khai báo";
const labels = (
  options: readonly (readonly [string, string])[],
  value: unknown,
) =>
  Array.isArray(value)
    ? value.map((v) => options.find(([key]) => key === v)?.[1] ?? v).join(", ")
    : "Chưa khai báo";
const kinds: Record<string, string> = {
  LOGO: "Logo",
  LEGAL_REGISTRATION: "Giấy đăng ký",
  AUTHORIZATION: "Giấy ủy quyền",
  CERTIFICATE: "Chứng nhận",
};
export function RegistrationProfileDetails({
  details,
  documents = [],
}: {
  details: Record<string, unknown> | null | undefined;
  documents?: S["RegistrationDocumentViewDto"][];
}) {
  const data = record(details?.registrationData),
    production = record(data.production),
    services = record(data.services);
  const [pending, setPending] = useState(""),
    [error, setError] = useState("");
  async function download(id: string) {
    if (pending) return;
    setPending(id);
    setError("");
    try {
      const file = await request<S["RegistrationDocumentContentDto"]>(
        `/enterprise-registration-documents/${id}`,
      );
      const bytes = Uint8Array.from(atob(file.contentBase64), (c) =>
        c.charCodeAt(0),
      );
      const url = URL.createObjectURL(
          new Blob([bytes], { type: file.mediaType }),
        ),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(onboardingError(cause));
    } finally {
      setPending("");
    }
  }
  const groups = [
    {
      title: "Thông tin đăng ký bổ sung",
      rows: [
        ["Số giấy đăng ký", data.registrationNumber],
        ["Ngày thành lập", data.establishedDate],
        ["Chức vụ người đại diện", data.representativeTitle],
        [
          "Người đăng ký",
          data.registrantRelationship === "AUTHORIZED"
            ? "Được ủy quyền"
            : "Người đại diện / chủ hồ sơ",
        ],
      ],
    },
    ...(Object.keys(production).length
      ? [
          {
            title: "Thông tin sản xuất",
            rows: [
              ["Lĩnh vực", "Trồng trọt"],
              ["Nhóm sản phẩm", production.productGroups],
              ["Mã vùng trồng", production.growingAreaCode],
              ["Mã cơ sở đóng gói", production.packingFacilityCode],
              ["Quy mô dự kiến", production.scaleEstimate],
              ["Số cơ sở dự kiến", production.facilityCount],
              [
                "Chứng nhận khai báo",
                labels(CERTIFICATION_OPTIONS, production.certifications),
              ],
            ],
          },
        ]
      : []),
    {
      title: "Dịch vụ sử dụng",
      rows: [
        [
          "Dịch vụ quan tâm",
          labels(
            [
              ...INTEREST_OPTIONS,
              ["PRODUCTION_MANAGEMENT", "Quản lý sản xuất"],
              ["DISTRIBUTION", "Phân phối & giao nhận"],
            ],
            services.interests,
          ),
        ],
        [
          "Gói quan tâm",
          services.planCode
            ? `Truy xuất ${String(services.planCode).replace("TRACE_", "")} sản phẩm`
            : "Tư vấn sau xét duyệt",
        ],
        [
          "Sản phẩm dự kiến",
          (
            {
              UP_TO_10: "1–10",
              UP_TO_100: "11–100",
              OVER_100: "Trên 100",
              UNDECIDED: "Chưa xác định",
            } as Record<string, string>
          )[String(services.expectedProducts)],
        ],
        ["Số lô/tháng", services.expectedLotsPerMonth],
        [
          "Kết nối đối tác",
          services.partnerIntent === "YES" ? "Có nhu cầu" : "Thực hiện sau",
        ],
        ["Tích hợp / yêu cầu bổ sung", services.integrationNotes],
      ],
    },
    {
      title: "Xác nhận của người đăng ký",
      rows: [
        [
          "Điều khoản sử dụng",
          data.termsAccepted === true ? "Đã đồng ý" : "Chưa có thông tin",
        ],
        [
          "Chính sách quyền riêng tư",
          data.privacyAcknowledged === true
            ? "Đã xác nhận đọc"
            : "Chưa có thông tin",
        ],
        ["Phiên bản điều khoản", data.termsVersion],
        ["Phiên bản chính sách", data.privacyVersion],
        [
          "Thời điểm xác nhận",
          typeof data.acceptedAt === "string"
            ? new Intl.DateTimeFormat("vi-VN", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Asia/Ho_Chi_Minh",
              }).format(new Date(data.acceptedAt))
            : "Chưa có thông tin",
        ],
        [
          "Nhận tin giới thiệu dịch vụ",
          data.marketingAccepted === true ? "Có đăng ký" : "Không đăng ký",
        ],
      ],
    },
  ];
  return (
    <>
      {data.formVersion === 2 ? (
        groups.map((group) => (
          <section
            className="manage-section manage-detail-section"
            key={group.title}
          >
            <h2>{group.title}</h2>
            <dl className="manage-detail-list">
              {group.rows.map(([label, value]) => (
                <div key={String(label)}>
                  <dt>{String(label)}</dt>
                  <dd style={{ overflowWrap: "anywhere" }}>{text(value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))
      ) : (
        <p className="notice">
          Hồ sơ được tạo theo phiên bản trước; không tự bổ sung xác nhận hoặc
          tài liệu chưa được người đăng ký cung cấp.
        </p>
      )}
      <section className="manage-section manage-detail-section">
        <h2>Tài liệu hồ sơ</h2>
        <p className="manage-section-help">
          Tài liệu riêng tư dành cho chủ hồ sơ và quản trị viên xét duyệt, không
          tự hiển thị trên QR.
        </p>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {documents.length ? (
          <div className="grid">
            {documents.map((file) => (
              <div className="panel" key={file.id}>
                <p>
                  <FileCheck2 size={18} />{" "}
                  <strong>{kinds[file.kind] ?? file.kind}</strong>
                </p>
                <EvidenceThumbnails
                  rows={[file]}
                  contentPath={(docId) => `/enterprise-registration-documents/${docId}`}
                  onOpenFile={(row) => void download(row.id)}
                  caption={(row) => `${row.fileName} · ${(row.size / 1024).toFixed(0)} KB`}
                />
                <button
                  className="button secondary"
                  type="button"
                  disabled={!!pending}
                  onClick={() => void download(file.id)}
                >
                  <Download size={16} />{" "}
                  {pending === file.id ? "Đang tải…" : "Tải tài liệu"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Không có tài liệu đính kèm.</p>
        )}
      </section>
    </>
  );
}
