"use client";
import { Button } from "@/components/ui/button";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { CommandState, LoadState, PageHeader, StatusBadge } from "@/components/manage";
import { useConfirm } from "@/lib/confirm";
import {
  textValue,
  useWorkspaceCommand,
  useWorkspaceData,
  type Catalog,
  type EnterpriseMember,
  type EnterpriseSite,
  type Items,
  type Overview,
} from "@/lib/workspace";
import type { components } from "@/lib/generated/api";
import { ImageGallery } from "./image-gallery";
import { SupervisorPanel } from "./member-form";

const tierLabel = (tier: number | null | undefined) =>
  tier === 2 ? "Cấp 2 — quản lý theo ủy quyền" : tier === 3 ? "Cấp 3 — nhân viên" : "Cấp 1 — quản trị doanh nghiệp";

/** Read-only member profile. Editing and removal start from here. */
export function MemberDetail({ id }: { id: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const command = useWorkspaceCommand();
  const members = useWorkspaceData<Items<EnterpriseMember>>("/enterprise-workspace/members"),
    overview = useWorkspaceData<Overview>("/enterprise-workspace"),
    sites = useWorkspaceData<Items<EnterpriseSite>>("/enterprise-workspace/sites"),
    catalog = useWorkspaceData<Catalog>("/catalog"),
    chains = useWorkspaceData<components["schemas"]["ChainRecordDto"][]>("/supply-chains");
  const member = members.data?.items.find((m) => m.id === id);
  const canManage = !!overview.data?.permissions.includes("members.manage");
  const editable =
    !!member &&
    canManage &&
    member.enterpriseTier !== 1 &&
    member.enterpriseTier !== null &&
    member.id !== overview.data?.member.id;
  const places = [...(sites.data?.items ?? []), ...(catalog.data?.farms ?? [])];
  const nameOf = (rows: { id: unknown; name: unknown }[] | undefined, ids: string[]) =>
    ids.map((v) => textValue(rows?.find((r) => String(r.id) === v)?.name ?? v)).join(", ") || "—";
  const grants = member?.enterpriseRoles ?? [];
  const supervisor = members.data?.items.find((m) => m.id === member?.supervisorId && m.enterpriseTier === 2);

  async function remove() {
    if (!member) return;
    if (
      !(await confirm(
        `Xóa thành viên ${member.fullName}${member.memberCode ? ` (${member.memberCode})` : ""}? Tài khoản bị vô hiệu, mọi quyền và phiên đăng nhập bị thu hồi; tài khoản cấp dưới do người này quản lý bị khóa. Lịch sử truy xuất vẫn được giữ.`,
        "Xác nhận xóa thành viên",
      ))
    )
      return;
    if (
      await command.run(
        `/enterprise-workspace/members/${member.id}`,
        { version: member.enterpriseRevision, status: "INACTIVE", roles: [] },
        "POST",
        { confirmed: true },
      )
    )
      router.push("/enterprise/members");
  }

  const rows: [string, ReactNode][] = member
    ? [
        ["Mã nhân viên", member.memberCode ?? "—"],
        ["Họ tên", member.fullName],
        ["Email đăng nhập", member.email],
        ["Số điện thoại", member.phone ?? "—"],
        ["Chức danh", member.jobTitle ?? "—"],
        ["Cấp tài khoản", tierLabel(member.enterpriseTier)],
        [
          "Nhóm quyền",
          member.enterpriseTier === 1 || member.enterpriseTier === null
            ? "Quản trị doanh nghiệp"
            : grants.map((g) => g.role.name).join(", ") || "Chưa gán nhóm",
        ],
        [
          "Trạng thái",
          <StatusBadge
            key="status"
            value={member.accountStatus}
            label={member.accountStatus === "INACTIVE" ? "Đã xóa" : undefined}
          />,
        ],
        ["Cơ sở làm việc", sites.data?.items.find((s) => s.id === member.workSiteId)?.name ?? "—"],
        ["Vùng sản xuất phụ trách", catalog.data?.farms.find((f) => f.id === member.responsibleFarmId)?.name ?? "—"],
        ["Địa chỉ liên hệ", member.contactAddress ?? "—"],
        ["Phạm vi chuỗi", nameOf(chains.data ?? undefined, [...new Set(grants.flatMap((g) => g.chainIds))])],
        ["Cơ sở / nông trại được phân công", nameOf(places, [...new Set(grants.flatMap((g) => g.siteIds))])],
        [
          "Người quản lý trực tiếp",
          member.enterpriseTier === 1 || member.enterpriseTier === null ? "—" : (supervisor?.fullName ?? "Chủ quản doanh nghiệp"),
        ],
        ["Ghi chú", member.memberNote ?? "—"],
      ]
    : [];

  return (
    <div className="manage-console">
      <PageHeader
        back="/enterprise/members"
        backLabel="Quay lại danh sách"
        title={member ? member.fullName : "Chi tiết thành viên"}
        description="Thông tin tài khoản, nhóm quyền và phạm vi được giao."
      />
      <LoadState {...members} />
      <CommandState command={command} />
      {member && (
        <>
          {editable && member.accountStatus !== "INACTIVE" && (
            <div className="workspace-actions detail-actions">
              <Link className="button" replace href={`/enterprise/members/${member.id}/edit`}>
                Sửa thông tin và quyền
              </Link>
              <Button type="button" className="button danger" disabled={command.pending} onClick={() => void remove()}>
                Xóa thành viên
              </Button>
            </div>
          )}
          <section className="panel member-profile">
            <ImageGallery entityType="MEMBER" entityId={member.id} kinds={["MEMBER_AVATAR"]} emptyText="Chưa có ảnh đại diện." />
            <dl className="detail-grid">
              {rows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="panel">
            <h2>Giấy tờ / chứng nhận chuyên môn</h2>
            <ImageGallery entityType="MEMBER" entityId={member.id} kinds={["MEMBER_DOCUMENT"]} emptyText="Chưa có giấy tờ." />
          </section>
          {editable && member.accountStatus !== "INACTIVE" && (
            <SupervisorPanel
              member={member}
              members={members.data?.items ?? []}
              canChange={!!overview.data?.member.primary}
              onChanged={members.reload}
            />
          )}
        </>
      )}
    </div>
  );
}
