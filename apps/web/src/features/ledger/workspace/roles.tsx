"use client";

import { useRouter } from "next/navigation";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { Controller } from "react-hook-form";
import { z } from "zod";
import { Plus } from "lucide-react";
import { wapi } from "@/lib/ledger/workspace-api";
import type { EnterpriseRole } from "@/lib/ledger/workspace-types";
import { ENTERPRISE_PERMISSION_CODES, PERMISSION_GROUPS, PERMISSION_LABEL, withDependencies } from "@/lib/ledger/workspace-permissions";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { Button } from "@/components/ledger/ui/button";
import { Checkbox } from "@/components/ledger/ui/checkbox";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { TextField } from "@/components/ledger/kit/form-fields";
import { Callout, EmptyState, ErrorState, LoadingRows, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
const permissionsSchema = z.array(z.enum(ENTERPRISE_PERMISSION_CODES));
const roleSchema = z.object({ name: z.string().trim().min(2, { error: () => tr("Bắt buộc") }).max(100, { error: () => tr("Tối đa 100 ký tự") }), permissions: z.array(z.enum(ENTERPRISE_PERMISSION_CODES)) });

export default function RolesPage({ roleId }: { roleId?: string }) {
  const router = useRouter();
  const { can, primary, access, tier } = useWorkspaceAccess();
  const roles = useQuery({ queryKey: ["ws-roles"], queryFn: wapi.roles, enabled: can("members.read") });
  const members = useQuery({ queryKey: ["ws-members"], queryFn: wapi.members, enabled: can("members.read") });
  const manage = can("roles.manage") && tier !== 3;
  const templates = useQuery({ queryKey: ["ws-templates"], queryFn: wapi.roleTemplates, enabled: manage });
  const edit = useDialog<EnterpriseRole | "new">();
  const del = useDialog<EnterpriseRole>();

  if (!can("members.read")) return <ErrorState error={new Error(tr("Bạn chưa có quyền members.read"))} />;
  const holders = (id: string) => (members.data ?? []).filter((m) => m.enterpriseRoles.some((g) => g.roleId === id)).length;
  const owned = new Set(access?.permissions ?? []);
  const list = roles.data ?? [];
  const target = roleId === "new" ? "new" : roleId ? list.find(r => r.id === roleId) : edit.target;
  const role = target && target !== "new" ? target : null;
  const invalidate = [["ws-roles"], ["ws-members"], ["ws-access"]];

  return (
    <>
      <PageHeader
        title={tr("Nhóm quyền")}
        description={tr("Hàng là quyền, cột là nhóm. Sửa nhóm đang gán áp dụng ngay cho mọi người giữ nhóm (không thu hồi phiên). Khi lưu, hệ thống tự thêm quyền xem hồ sơ và các quyền phụ thuộc.")}
        actions={
          manage && (
            <Button size="sm" onClick={() => edit.open("new")}>
              <Plus /> {tr("Tạo nhóm quyền")}
            </Button>
          )
        }
      />
      <PageBody wide>
        {!primary && <Callout>{tr("Bạn chỉ thấy các nhóm mà mọi quyền trong nhóm đều nằm trong quyền của bạn, và chỉ sửa được nhóm khi mọi người giữ nhóm do bạn quản lý.")}</Callout>}
        {roles.error ? (
          <ErrorState error={roles.error} onRetry={() => roles.refetch()} />
        ) : !roles.data ? (
          <LoadingRows />
        ) : !list.length ? (
          <EmptyState title={tr("Chưa có nhóm quyền")}>{tr("Tạo nhóm từ mẫu theo năng lực của doanh nghiệp.")}</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-card">
            <table className="w-full border-collapse text-[13px]" style={{ minWidth: 260 + list.length * 150 }}>
              <caption className="sr-only">{tr("Ma trận nhóm quyền")}</caption>
              <thead>
                <tr className="border-b border-line bg-sunken text-left align-bottom">
                  <th scope="col" className="sticky left-0 z-10 w-[260px] bg-sunken px-4 py-2.5 text-[12px] font-semibold text-ink-2">
                    {tr("Quyền")}
                  </th>
                  {list.map((r) => (
                    <th key={r.id} scope="col" className="min-w-[140px] px-3 py-2.5 align-bottom">
                      {manage ? (
                        <button type="button" onClick={() => edit.open(r)} className="flex flex-col items-start text-left hover:text-brand">
                          <span className="text-[13px] font-semibold">{r.name}</span>
                          <span className="text-[11.5px] font-normal text-ink-2">{holders(r.id)} {tr("người · v")}{r.version}</span>
                        </button>
                      ) : (
                        <span className="flex flex-col">
                          <span className="text-[13px] font-semibold">{r.name}</span>
                          <span className="text-[11.5px] font-normal text-ink-2">{holders(r.id)} {tr("người")}</span>
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_GROUPS.map((g) => (
                  <PermissionRows key={g.label} label={g.label} keys={g.keys} roles={list} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>

      {target && manage && (
        <CommandDialog
          {...edit.props}
          open={!!roleId || edit.props.open}
          onOpenChange={open => !open && roleId ? router.push("/enterprise/roles") : edit.props.onOpenChange(open)}
          onDone={() => { if (roleId) router.push("/enterprise/roles"); }}
          title={role ? tr("Sửa nhóm “{p0}”", { p0: role.name }) : tr("Tạo nhóm quyền")}
          endpoint={role ? "POST /enterprise-workspace/roles/:id" : "POST /enterprise-workspace/roles"}
          description={role ? tr("Đang gán cho {p0} người — thay đổi có hiệu lực ngay với họ.", { p0: holders(role.id) }) : tr("Chọn mẫu theo năng lực của doanh nghiệp rồi chỉnh quyền. Mẫu chỉ là gợi ý; khi gán vẫn kiểm năng lực, phạm vi và quyền người cấp.")}
          schema={roleSchema}
          defaultValues={{ name: role?.name ?? "", permissions: permissionsSchema.parse(role?.permissions ?? []) }}
          version={role?.version}
          submitLabel={role ? tr("Lưu nhóm") : tr("Tạo nhóm")}
          invalidate={invalidate}
          wide
          success={(r) => {
            const n = (r as { affectedMembers?: number }).affectedMembers;
            return n ? tr("Đã lưu; áp dụng cho {p0} thành viên", { p0: n }) : tr("Đã lưu nhóm quyền");
          }}
          run={(v, cmd) => wapi.saveRole(role?.id ?? null, { name: v.name, permissions: v.permissions, version: role?.version }, cmd)}
        >
          {(f) => (
            <>
              <TextField control={f.control} name="name" label={tr("Tên nhóm")} max={100} />
              {!role && (templates.data?.length ?? 0) > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium">{tr("Bắt đầu từ mẫu")}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {templates.data!.map((tp) => (
                      <Button
                        key={tp.code}
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          f.setValue("permissions", permissionsSchema.parse(tp.permissions));
                          if (!f.getValues("name")) f.setValue("name", tp.name);
                        }}
                      >
                        {tp.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              <Controller
                control={f.control}
                name="permissions"
                render={({ field }) => {
                  const chosen = new Set<string>(field.value);
                  const effective = withDependencies(field.value);
                  return (
                    <div className="flex flex-col gap-3">
                      {PERMISSION_GROUPS.map((g) => (
                        <fieldset key={g.label} className="flex flex-col gap-1.5">
                          <legend className="label-caps mb-1">{g.label}</legend>
                          <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                            {g.keys.map((k) => {
                              const auto = !chosen.has(k) && effective.has(k);
                              const locked = !primary && !owned.has(k);
                              return (
                                <label key={k} className={cn("flex items-center gap-2 text-[13px]", locked && "text-ink-2")} title={locked ? tr("Vượt quyền bạn đang có") : k}>
                                  <Checkbox
                                    checked={chosen.has(k) || auto}
                                    disabled={locked || auto}
                                    onCheckedChange={(on) => field.onChange(on ? [...field.value, k] : field.value.filter((x) => x !== k))}
                                  />
                                  <span>{PERMISSION_LABEL[k]}</span>
                                  {auto && <span className="text-[11px] text-ink-2">{tr("(tự thêm)")}</span>}
                                </label>
                              );
                            })}
                          </div>
                        </fieldset>
                      ))}
                    </div>
                  );
                }}
              />
              {role && (
                <Button type="button" variant="ghost" size="sm" className="self-start text-danger" onClick={() => (edit.close(), del.open(role))}>
                  {tr("Xóa nhóm này…")}
                </Button>
              )}
            </>
          )}
        </CommandDialog>
      )}
      {del.target && (
        <CommandDialog
          {...del.props}
          title={tr("Xóa nhóm “{p0}”", { p0: del.target.name })}
          endpoint="POST /enterprise-workspace/roles/:id/delete"
          description={tr("Chỉ xóa được nhóm không còn ai giữ và không nằm trong lời mời đang chờ.")}
          schema={z.object({})}
          defaultValues={{}}
          version={del.target.version}
          tone="danger"
          submitLabel={tr("Xóa nhóm")}
          invalidate={invalidate}
          run={(_, cmd) => wapi.deleteRole(del.target!.id, { version: del.target!.version }, cmd)}
        >
          {() => null}
        </CommandDialog>
      )}
    </>
  );
}

function PermissionRows({ label, keys, roles }: { label: string; keys: readonly string[]; roles: EnterpriseRole[] }) {
  return (
    <>
      <tr className="border-b border-line/70 bg-row-alt">
        <th scope="rowgroup" colSpan={roles.length + 1} className="sticky left-0 px-4 py-1.5 text-left text-[11px] font-semibold tracking-[0.06em] text-ink-2 uppercase">
          {label}
        </th>
      </tr>
      {keys.map((k) => (
        <tr key={k} className="border-b border-line/50 last:border-0">
          <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-1.5 text-left font-normal">
            <span className="flex flex-col">
              <span>{PERMISSION_LABEL[k as keyof typeof PERMISSION_LABEL]}</span>
              <span className="font-mono text-[11px] text-ink-2">{k}</span>
            </span>
          </th>
          {roles.map((r) => {
            const on = r.permissions.includes(k);
            return (
              <td key={r.id} className="px-3 py-1.5">
                <span aria-label={on ? tr("có") : tr("không")} className={cn("text-[14px]", on ? "text-brand" : "text-line-strong")}>
                  {on ? "●" : "·"}
                </span>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
