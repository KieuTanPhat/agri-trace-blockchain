"use client";
import type { ReactNode } from "react";
import {
  useWorkspaceData,
  textValue,
  labels,
  type Overview,
} from "@/lib/workspace";
import { ProfileAmendments } from "@/components/workspace/profile-amendments";
import { EntityThumb } from "@/components/workspace/entity-thumb";
import {
  ACTIVITY_OPTIONS,
  CERTIFICATION_OPTIONS,
  INTEREST_OPTIONS,
  LEGAL_FORM_OPTIONS,
  PROCESSING_CERT_OPTIONS,
  PROCESSING_TYPE_OPTIONS,
} from "@/lib/registration-form";
import { LoadState, PageHeader } from "@/components/manage";

type Json = Record<string, unknown>;
const pick = (options: readonly (readonly [string, string])[], value: unknown) =>
  options.find(([code]) => code === value)?.[1] ?? textValue(value);
const pickAll = (options: readonly (readonly [string, string])[], values: unknown) =>
  Array.isArray(values) && values.length
    ? values.map((v) => pick(options, v)).join(", ")
    : "";
const date = (value: unknown) =>
  typeof value === "string" && value
    ? new Date(value).toLocaleDateString("vi-VN")
    : "";
const plans: Record<string, string> = {
  TRACE_5: "Truy xuất 5 sản phẩm",
  TRACE_10: "Truy xuất 10 sản phẩm",
  TRACE_20: "Truy xuất 20 sản phẩm",
  CHAIN_PRO: "Doanh nghiệp chuỗi cung ứng",
};

function Group({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== "" && v !== null && v !== undefined);
  if (!shown.length) return null;
  return (
    <section className="panel profile-group">
      <h2>{title}</h2>
      <dl className="profile-details">
        {shown.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function ProfilePage() {
  const state = useWorkspaceData<Overview>("/enterprise-workspace");
  const canManage =
    !!state.data &&
    (state.data.member.enrollmentOwner ||
      state.data.permissions.includes("profile.manage"));
  const org = state.data?.organization;
  const profile = state.data?.profile;
  const legal = (profile?.legalData ?? {}) as Json;
  const reg = (profile?.registrationData ?? {}) as Json;
  const production = (legal.production ?? reg.production ?? null) as Json | null;
  const processing = (reg.processing ?? null) as Json | null;
  const services = (reg.services ?? {}) as Json;
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        back="/enterprise"
        backLabel="Doanh nghiệp"
        title="Hồ sơ doanh nghiệp"
        description="Thông tin dùng để xác định chủ thể tham gia truy xuất. Thay đổi thông tin pháp lý cần quản trị AgriTrace duyệt trước khi áp dụng."
      />
      <LoadState {...state} />
      {org && (
        <>
          <section className="panel profile-hero">
            <EntityThumb
              entityType="PROFILE"
              entityId={org.id}
              kinds={["PARTNER_LOGO", "BUSINESS_LICENSE"]}
              name={org.name}
            />
            <div>
              <h2>{org.name}</h2>
              <p className="muted">
                Mã AgriTrace <strong>{org.code}</strong>
                {org.businessId ? (
                  <>
                    {" "}· MST <strong>{org.businessId}</strong>
                  </>
                ) : null}
              </p>
              <p className="profile-badges">
                {org.capabilities.map((c) => (
                  <span className="workspace-badge" key={c}>
                    {labels[c] ?? c}
                  </span>
                ))}
              </p>
            </div>
          </section>
          <div className="profile-grid">
            <Group
              title="Thông tin pháp lý"
              rows={[
                ["Tên doanh nghiệp", org.name],
                ["Mã AgriTrace", org.code],
                ["Mã số thuế", textValue(org.businessId ?? legal.businessId)],
                ["Loại hình", pick(LEGAL_FORM_OPTIONS, profile?.legalForm)],
                [
                  "Số giấy chứng nhận đăng ký",
                  textValue(legal.registrationNumber ?? reg.registrationNumber),
                ],
                ["Ngày thành lập", date(reg.establishedDate)],
                [
                  "Mô hình tham gia",
                  org.participationModel === "SUPPLY_CHAIN_ENTERPRISE"
                    ? "Doanh nghiệp có chuỗi cung ứng"
                    : "Một vai trò trong chuỗi",
                ],
                ["Năng lực đăng ký", pickAll(ACTIVITY_OPTIONS, profile?.activities)],
                [
                  "Năng lực đã duyệt",
                  org.capabilities.map((c) => labels[c] ?? c).join(", ") || "Chưa có",
                ],
              ]}
            />
            <Group
              title="Liên hệ & đại diện"
              rows={[
                [
                  "Người đại diện",
                  [
                    textValue(profile?.representative),
                    textValue(legal.representativeTitle ?? reg.representativeTitle),
                  ]
                    .filter((v) => v && v !== "—")
                    .join(" · "),
                ],
                ["Điện thoại", textValue(profile?.phone)],
                ["Email liên hệ", textValue(profile?.contactEmail)],
                [
                  "Địa chỉ",
                  [profile?.address, profile?.ward, profile?.province]
                    .filter(Boolean)
                    .join(", "),
                ],
                [
                  "Website",
                  profile?.website ? (
                    <a href={profile.website} target="_blank" rel="noopener noreferrer">
                      {profile.website}
                    </a>
                  ) : (
                    ""
                  ),
                ],
              ]}
            />
            {production && (
              <Group
                title="Thông tin sản xuất"
                rows={[
                  ["Lĩnh vực", production.sector === "CROP" ? "Trồng trọt" : textValue(production.sector)],
                  [
                    "Nhóm sản phẩm",
                    Array.isArray(production.productGroups)
                      ? production.productGroups.join(", ")
                      : "",
                  ],
                  ["Mã vùng trồng", textValue(production.growingAreaCode)],
                  ["Mã cơ sở đóng gói", textValue(production.packingFacilityCode)],
                  ["Quy mô", textValue(production.scaleEstimate)],
                  ["Số cơ sở", textValue(production.facilityCount)],
                  ["Chứng nhận", pickAll(CERTIFICATION_OPTIONS, production.certifications)],
                ]}
              />
            )}
            {processing && (
              <Group
                title="Thông tin chế biến"
                rows={[
                  ["Loại hình chế biến", pickAll(PROCESSING_TYPE_OPTIONS, processing.processingTypes)],
                  ["Số GCN cơ sở đủ điều kiện ATTP", textValue(processing.foodSafetyCertificateNumber)],
                  ["Hạn GCN ATTP", date(processing.foodSafetyCertificateExpiry)],
                  ["Mã cơ sở chế biến", textValue(processing.facilityCode)],
                  ["Công suất (kg/ngày)", textValue(processing.dailyCapacityKg)],
                  ["Hệ thống quản lý ATTP", pickAll(PROCESSING_CERT_OPTIONS, processing.certifications)],
                ]}
              />
            )}
            <Group
              title="Dịch vụ đăng ký"
              rows={[
                ["Dịch vụ quan tâm", pickAll(INTEREST_OPTIONS, services.interests)],
                ["Gói quan tâm", plans[String(services.planCode ?? "")] ?? ""],
                [
                  "Hình thức vận hành",
                  org.hostingMode === "SELF_MANAGED_ORG"
                    ? "Doanh nghiệp tự vận hành hạ tầng"
                    : org.hostingMode === "MANAGED_ORG"
                      ? "AgriTrace quản lý hạ tầng"
                      : "",
                ],
                ["Số lô dự kiến / tháng", textValue(services.expectedLotsPerMonth)],
              ]}
            />
            <Group
              title="Giới thiệu"
              rows={[["Giới thiệu", textValue(profile?.description)]]}
            />
          </div>
        </>
      )}
      {canManage && <ProfileAmendments />}
    </div>
  );
}
