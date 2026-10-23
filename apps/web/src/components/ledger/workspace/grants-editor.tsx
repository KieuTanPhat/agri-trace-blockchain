"use client";

import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import type { components } from "@/lib/generated/api";
type EnterpriseRole = components["schemas"]["EnterpriseRoleRecordDto"];
type RoleGrant = components["schemas"]["MemberRoleInput"];
type Site = Pick<components["schemas"]["EnterpriseSiteRecordDto"],"id"|"name"|"status"|"kind">;
type SupplyChain = {id:string;name:string};

import { Button } from "@/components/ledger/ui/button";
import { Checkbox } from "@/components/ledger/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ledger/ui/select";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
/**
 * Gán nhóm quyền kèm phạm vi chuỗi và cơ sở (EnterpriseMemberInput.roles).
 * Backend từ chối nếu phạm vi hay quyền vượt quyền của người cấp.
 */
export function GrantsField<T extends FieldValues>({ control, name, roles, chains, sites, label = tr("Nhóm quyền và phạm vi") }: { control: Control<T>; name: FieldPath<T>; roles: EnterpriseRole[]; chains: SupplyChain[]; sites: Site[]; label?: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const value = (field.value ?? []) as RoleGrant[];
        const set = (i: number, patch: Partial<RoleGrant>) => field.onChange(value.map((g, j) => (j === i ? { ...g, ...patch } : g)));
        const toggle = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
        return (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-[13px] font-medium">{label}</legend>
            {value.map((g, i) => (
              <div key={i} className="flex flex-col gap-2.5 rounded-md border border-line bg-row-alt/60 p-3">
                <div className="flex items-center gap-2">
                  <Select value={g.roleId} onValueChange={(v) => set(i, { roleId: v })}>
                    <SelectTrigger aria-label={tr("Nhóm quyền {p0}", { p0: i + 1 })} className="w-full bg-card">
                      <SelectValue placeholder={tr("Chọn nhóm quyền")} />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name} <span className="text-ink-2">· {r.permissions.length} {tr("quyền")}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={tr("Bỏ dòng này")} onClick={() => field.onChange(value.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-[12px] text-ink-2">{tr("Chuỗi")}</span>
                    {chains.length ? (
                      chains.map((c) => (
                        <label key={c.id} className="flex items-center gap-2 text-[13px]">
                          <Checkbox checked={g.chainIds.includes(c.id)} onCheckedChange={() => set(i, { chainIds: toggle(g.chainIds, c.id) })} />
                          {c.name}
                        </label>
                      ))
                    ) : (
                      <span className="text-[12px] text-ink-2">{tr("Doanh nghiệp chưa tham gia chuỗi nào.")}</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[12px] text-ink-2">{tr("Cơ sở")}</span>
                    {sites
                      .filter((s) => s.status === "ACTIVE")
                      .map((s) => (
                        <label key={s.id} className="flex items-center gap-2 text-[13px]">
                          <Checkbox checked={g.siteIds.includes(s.id)} onCheckedChange={() => set(i, { siteIds: toggle(g.siteIds, s.id) })} />
                          {s.name} <span className="text-[11.5px] text-ink-2">{s.kind}</span>
                        </label>
                      ))}
                  </div>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => field.onChange([...value, { roleId: "", chainIds: [], siteIds: [] }])}>
              <Plus /> {tr("Thêm nhóm quyền")}
            </Button>
            {fieldState.error && <span className={cn("text-[12px] text-danger")}>{fieldState.error.message ?? (fieldState.error as unknown as { root?: { message?: string } }).root?.message}</span>}
          </fieldset>
        );
      }}
    />
  );
}
