"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { sha256Hex,toBase64Url } from '@/lib/signing/canonical';
import {
  useWorkspaceCommand,
  useWorkspaceData,
  textValue,
  type Catalog,
  type EnterpriseMember,
  type EnterpriseRole,
  type EnterpriseSite,
  type Items,
  type Overview,
} from "@/lib/workspace";
import type { components } from "@/lib/generated/api";
import { CommandState, LoadState, PageHeader } from "@/components/manage";
import { EvidencePanel } from "./evidence-panel";
export function MemberForm({ id }: { id?: string }) {
  const router = useRouter(),
    cmd = useWorkspaceCommand(),
    roles = useWorkspaceData<Items<EnterpriseRole>>("/enterprise-workspace/roles"),
    overview = useWorkspaceData<Overview>("/enterprise-workspace"),
    members = useWorkspaceData<Items<EnterpriseMember>>(
      "/enterprise-workspace/members",
    ),
    chains = useWorkspaceData<components["schemas"]["ChainRecordDto"][]>(
      "/supply-chains",
    ),
    catalog = useWorkspaceData<Catalog>("/catalog"),
    sites = useWorkspaceData<Items<EnterpriseSite>>(
      "/enterprise-workspace/sites",
    );
  const [roleIds, setRoleIds] = useState<string[]>([]),
    [chainIds, setChainIds] = useState<string[]>([]),
    [siteIds, setSiteIds] = useState<string[]>([]);
  const member = members.data?.items.find((m) => m.id === id);
  const invitation=useRef<{id:string;token:string;tokenDigest:string}|null>(null),[invitationLink,setInvitationLink]=useState('');
  useEffect(() => {
    if (member) {
      const grants = member.enterpriseRoles;
      setRoleIds(grants.map((g) => g.roleId));
      setChainIds([...new Set(grants.flatMap((g) => g.chainIds))]);
      setSiteIds([...new Set(grants.flatMap((g) => g.siteIds))]);
    }
  }, [member]);
  const toggle = (values: string[], value: string, checked: boolean) =>
    checked ? [...values, value] : values.filter((v) => v !== value);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const assignments = roleIds.map((roleId) => ({
      roleId,
      chainIds,
      siteIds,
    }));
    if(!id&&!invitation.current){const token=toBase64Url(crypto.getRandomValues(new Uint8Array(32)));invitation.current={id:crypto.randomUUID(),token,tokenDigest:await sha256Hex(new TextEncoder().encode(token))};}
    const profile = {
      jobTitle: String(data.get("jobTitle") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim() || (id ? null : undefined),
      workSiteId: String(data.get("workSiteId") ?? "") || (id ? null : undefined),
      responsibleFarmId: String(data.get("responsibleFarmId") ?? "") || (id ? null : undefined),
      contactAddress: String(data.get("contactAddress") ?? "").trim() || (id ? null : undefined),
      memberNote: String(data.get("memberNote") ?? "").trim() || (id ? null : undefined),
    };
    const payload = id
      ? {
          ...profile,
          version: member?.enterpriseRevision,
          status: data.get("status"),
          roles: assignments,
        }
      : {
          ...profile,
          fullName: data.get("fullName"),
          email: data.get("email"),
          id:invitation.current?.id,
          tokenDigest:invitation.current?.tokenDigest,
          tier: Number(data.get("tier")),
          roles: assignments,
        };
    if (
      await cmd.run(
        id?`/enterprise-workspace/members/${id}`:'/enterprise-workspace/member-invitations',
        payload,
      )
    ) {
      if(id)router.push('/enterprise/members');else setInvitationLink(`${window.location.origin}/join-organization#invitationId=${invitation.current!.id}&token=${invitation.current!.token}`);
    }
  }
  return (
    <div className="manage-console">
      <PageHeader actionKind="create" backLabel="Quay lại danh sách"
        title={
          id ? `Quyền của ${textValue(member?.fullName)}` : "Thêm thành viên"
        }
        description="Mỗi tài khoản thuộc một doanh nghiệp. Quyền chuỗi vẫn cần doanh nghiệp tham gia và được phân công nghiệp vụ."
        back="/enterprise/members"
      />
      <LoadState loading={roles.loading} error={roles.error} />
      {invitationLink&&<section className="panel"><h2>Đã tạo lời mời trong 72 giờ</h2><p>Gửi liên kết riêng này trực tiếp cho đúng thành viên. Người được mời tự đặt mật khẩu; AgriTrace chỉ lưu hash token.</p><label>Liên kết kích hoạt<input className="input" readOnly value={invitationLink} onFocus={e=>e.currentTarget.select()}/></label><button className="button" type="button" onClick={()=>void navigator.clipboard.writeText(invitationLink)}>Sao chép liên kết</button></section>}
      {!invitationLink&&<>
      <form className="panel workspace-form" onSubmit={submit}>
        <CommandState command={cmd} />
        {id && member?.enterpriseTier === 2 && (
          <p className="notice">
            Cập nhật quyền hoặc trạng thái của quản lý cấp 2 sẽ khóa các tài
            khoản cấp 3 do người này cấp. Bạn cần rà soát và phân quyền lại từng
            tài khoản con.
          </p>
        )}
        <fieldset
          className="enterprise-fields"
          disabled={cmd.pending || cmd.frozen}
        >
          {!id && (
            <>
              <label>
                Họ tên
                <input
                  className="input"
                  name="fullName"
                  required
                  minLength={2}
                />
              </label>
              <label>
                Email đăng nhập
                <input className="input" name="email" type="email" required />
              </label>
              <label>
                Cấp tài khoản
                <select className="input" name="tier" defaultValue="3">
                  {overview.data?.member.primary && (
                    <option value="2">Cấp 2 — quản lý theo ủy quyền</option>
                  )}
                  <option value="3">Cấp 3 — nhân viên</option>
                </select>
              </label>
            </>
          )}
          {id && (
            <label>
              Trạng thái
              <select
                className="input"
                name="status"
                defaultValue={String(member?.accountStatus ?? "ACTIVE")}
                key={String(member?.accountStatus)}
              >
                <option value="ACTIVE">Hoạt động</option>
                <option value="LOCKED">Khóa tài khoản và thu hồi phiên</option>
              </select>
            </label>
          )}
          <label>Chức danh
            <input className="input" name="jobTitle" required minLength={2} maxLength={255} defaultValue={member?.jobTitle ?? ""} key={`title-${member?.id ?? "new"}`} />
          </label>
          <label>Số điện thoại liên hệ
            <input className="input" name="phone" maxLength={30} defaultValue={member?.phone ?? ""} key={`phone-${member?.id ?? "new"}`} />
          </label>
          <label>Cơ sở làm việc
            <select className="input" name="workSiteId" defaultValue={member?.workSiteId ?? ""} key={`site-${member?.id ?? "new"}`}>
              <option value="">Chưa chọn</option>
              {sites.data?.items.filter((site) => site.status === "ACTIVE").map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
            </select>
          </label>
          <label>Vùng sản xuất phụ trách
            <select className="input" name="responsibleFarmId" defaultValue={member?.responsibleFarmId ?? ""} key={`farm-${member?.id ?? "new"}`}>
              <option value="">Chưa chọn</option>
              {catalog.data?.farms.filter((farm) => farm.status === "ACTIVE").map((farm) => <option key={farm.id} value={farm.id}>{farm.name}</option>)}
            </select>
          </label>
          <label>Địa chỉ liên hệ
            <input className="input" name="contactAddress" maxLength={500} defaultValue={member?.contactAddress ?? ""} key={`address-${member?.id ?? "new"}`} />
          </label>
          <label>Ghi chú thành viên
            <textarea className="input" name="memberNote" maxLength={1000} defaultValue={member?.memberNote ?? ""} key={`note-${member?.id ?? "new"}`} />
          </label>
          <fieldset>
            <legend>Nhóm quyền</legend>
            {roles.data?.items.map((r) => (
              <label className="permission-choice" key={String(r.id)}>
                <input
                  type="checkbox"
                  checked={roleIds.includes(String(r.id))}
                  onChange={(e) =>
                    setRoleIds((v) => toggle(v, String(r.id), e.target.checked))
                  }
                />
                <span>{textValue(r.name)}</span>
              </label>
            ))}
            {!roles.data?.items.length && (
              <p className="notice">
                Cần tạo nhóm quyền trước khi cấp tài khoản.
              </p>
            )}
          </fieldset>
          <fieldset>
            <legend>Phạm vi chuỗi</legend>
            {chains.data?.map((c) => (
              <label className="permission-choice" key={String(c.id)}>
                <input
                  type="checkbox"
                  checked={chainIds.includes(String(c.id))}
                  onChange={(e) =>
                    setChainIds((v) =>
                      toggle(v, String(c.id), e.target.checked),
                    )
                  }
                />
                <span>{textValue(c.name)}</span>
              </label>
            ))}
            <small>
              Không chọn chuỗi: chưa được thao tác dữ liệu truy xuất của chuỗi.
            </small>
          </fieldset>
          <fieldset>
            <legend>Cơ sở / nông trại được phân công</legend>
            {[...(sites.data?.items ?? []), ...(catalog.data?.farms ?? [])].map(
              (s) => (
                <label className="permission-choice" key={String(s.id)}>
                  <input
                    type="checkbox"
                    checked={siteIds.includes(String(s.id))}
                    onChange={(e) =>
                      setSiteIds((v) =>
                        toggle(v, String(s.id), e.target.checked),
                      )
                    }
                  />
                  <span>{textValue(s.name)}</span>
                </label>
              ),
            )}
          </fieldset>
        </fieldset>
        <button className="button" type="submit" disabled={cmd.pending}>
          {cmd.pending
            ? "Đang lưu…"
            : cmd.frozen
              ? "Thử lại yêu cầu cũ"
              : id
                ? "Cập nhật quyền và thu hồi phiên cũ"
                : "Tạo tài khoản"}
        </button>
      </form>
      {id && member && (
        <SupervisorPanel
          member={member}
          members={members.data?.items ?? []}
          canChange={!!overview.data?.member.primary}
          onChanged={members.reload}
        />
      )}
      {id && member && <EvidencePanel entityType="MEMBER" entityId={id} />}
      </>}
    </div>
  );
}

/** Who directly manages a member. Only the owner may move a tier-3 member under
 * another active tier-2 manager (or back under the owner); the API requires the
 * new manager to hold every permission and scope the member's roles grant. */
function SupervisorPanel({
  member,
  members,
  canChange,
  onChanged,
}: {
  member: EnterpriseMember;
  members: EnterpriseMember[];
  canChange: boolean;
  onChanged(): void;
}) {
  const cmd = useWorkspaceCommand();
  const [target, setTarget] = useState(
    member.supervisorId && members.some((m) => m.id === member.supervisorId && m.enterpriseTier === 2)
      ? member.supervisorId
      : "",
  );
  const current = members.find((m) => m.id === member.supervisorId && m.enterpriseTier === 2);
  const managers = members.filter(
    (m) => m.enterpriseTier === 2 && m.accountStatus === "ACTIVE" && m.id !== member.id,
  );
  return (
    <section className="panel">
      <h2>Người quản lý trực tiếp</h2>
      <p className="muted">
        Hiện tại: <strong>{current?.fullName ?? "Chủ quản doanh nghiệp"}</strong>. Người quản lý giới hạn những gì thành
        viên được làm và là người quản lý tài khoản này.
      </p>
      {canChange && member.enterpriseTier === 3 ? (
        <form
          className="workspace-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              await cmd.run(`/enterprise-workspace/members/${member.id}/supervisor`, {
                version: member.enterpriseRevision,
                supervisorId: target || null,
              })
            )
              onChanged();
          }}
        >
          <CommandState command={cmd} />
          <fieldset className="enterprise-fields" disabled={cmd.pending || cmd.frozen}>
            <label>
              Người quản lý mới
              <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Chủ quản doanh nghiệp</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                    {m.jobTitle ? ` · ${m.jobTitle}` : ""}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          <p className="notice">
            Người quản lý mới phải có đủ quyền và phạm vi của thành viên. Sau khi đổi, thành viên phải đăng nhập lại.
          </p>
          <button className="button secondary" disabled={cmd.pending || (target || "") === (current?.id ?? "")}>
            {cmd.frozen ? "Thử lại yêu cầu cũ" : "Đổi người quản lý"}
          </button>
        </form>
      ) : (
        canChange && <p className="muted">Quản lý cấp 2 luôn trực thuộc chủ quản doanh nghiệp.</p>
      )}
    </section>
  );
}
