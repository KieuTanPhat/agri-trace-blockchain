"use client";
import {
  useWorkspaceData,
  textValue,
  labels,
  type Overview,
} from "@/lib/workspace";
import { ProfileAmendments } from "@/components/workspace/profile-amendments";
import { LEGAL_FORM_OPTIONS } from "@/lib/registration-form";
import { LoadState, PageHeader } from "@/components/manage";
export default function ProfilePage() {
  const state = useWorkspaceData<Overview>("/enterprise-workspace");
  const canManage =
    !!state.data &&
    (state.data.member.enrollmentOwner ||
      state.data.permissions.includes("profile.manage"));
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        back="/enterprise"
        backLabel="Doanh nghiệp"
        title="Hồ sơ doanh nghiệp"
        description="Thông tin doanh nghiệp được sử dụng để xác định chủ thể tham gia truy xuất."
      />
      <LoadState {...state} />
      {state.data && (
        <section className="panel">
          <dl className="review-details">
            <dt>Doanh nghiệp</dt>
            <dd>{state.data.organization.name}</dd>
            <dt>Mã tổ chức AgriTrace</dt>
            <dd>{state.data.organization.code}</dd>
            <dt>Hoạt động đã duyệt</dt>
            <dd>
              {state.data.organization.capabilities
                .map((c) => labels[c] ?? c)
                .join(", ")}
            </dd>
            {Object.entries({
              legalForm: "Loại hình",
              address: "Địa chỉ",
              province: "Tỉnh / thành phố",
              representative: "Người đại diện",
              phone: "Điện thoại",
              contactEmail: "Email liên hệ",
              website: "Website",
              description: "Giới thiệu",
            } as const).map(([key, label]) => (
              <div style={{ display: "contents" }} key={key}>
                <dt>{label}</dt>
                <dd>
                  {key === "legalForm"
                    ? (LEGAL_FORM_OPTIONS.find(
                        ([code]) => code === state.data?.profile?.legalForm,
                      )?.[1] ?? textValue(state.data?.profile?.legalForm))
                    : textValue(
                        state.data?.profile?.[
                          key as keyof NonNullable<Overview["profile"]>
                        ],
                      )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {canManage && <ProfileAmendments />}
    </div>
  );
}
