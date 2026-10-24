"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { api } from "@/lib/ledger/platform-api";
import { useLedgerQuery } from "@/lib/ledger/data";
import { fmtDateTime } from "@/lib/ledger/format";
import { t } from "@/lib/ledger/i18n";
import { Button } from "@/components/ledger/ui/button";
import { CommandForm } from "@/components/ledger/kit/command-dialog";
import {
  SelectField,
  TextAreaField,
} from "@/components/ledger/kit/form-fields";
import { DataTable } from "@/components/ledger/kit/data-table";
import { FilterBar } from "@/components/ledger/kit/filters";
import {
  Callout,
  EmptyState,
  ErrorState,
  Field,
  Fields,
  LoadingRows,
  PageBody,
  PageHeader,
  Section,
} from "@/components/ledger/kit/page";
const reason = z.string().trim().min(1).max(1000),
  grantSchema = z.object({
    farmId: z.uuid(),
    reviewerUserId: z.uuid(),
    reason,
  }),
  revokeSchema = z.object({ reason });
export function AssignmentList() {
  const q = useLedgerQuery({
      queryKey: ["compliance-assignments"],
      queryFn: api.governance.assignments,
    }),
    users = useLedgerQuery({ queryKey: ["users"], queryFn: api.users.list });
  const [search, setSearch] = useState("");
  return (
    <>
      <PageHeader
        title={t("Phân công kiểm định")}
        description={t(
          "Phạm vi vùng trồng mà người kiểm định được quyền xem và đánh giá.",
        )}
        actions={
          <Button asChild size="sm">
            <Link href="/admin/compliance-assignments/new">
              {t("Phân công mới")}
            </Link>
          </Button>
        }
      />
      <PageBody>
        <FilterBar
          search={search}
          onSearch={setSearch}
          placeholder={t("Tìm vùng trồng hoặc người kiểm định")}
          active={!!search}
          onReset={() => setSearch("")}
        />
        <div className="overflow-hidden rounded-md border border-line bg-card">
          <DataTable
            rows={q.data?.filter((a) =>
              `${a.farm.name} ${users.data?.find((u) => u.id === a.reviewerUserId)?.fullName ?? ""}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )}
            loading={q.isLoading || users.isLoading}
            error={q.error ?? users.error}
            onRetry={() => {
              void q.refetch();
              void users.refetch();
            }}
            rowKey={(a) => a.id}
            href={(a) => `/admin/compliance-assignments/${a.id}`}
            columns={[
              {
                key: "farm",
                header: t("Vùng trồng"),
                sort: (a) => a.farm.name,
                cell: (a) => <span className="font-medium">{a.farm.name}</span>,
              },
              {
                key: "reviewer",
                header: t("Người kiểm định"),
                cell: (a) =>
                  users.data?.find((u) => u.id === a.reviewerUserId)
                    ?.fullName ?? a.reviewerUserId,
              },
              {
                key: "granted",
                header: t("Ngày phân công"),
                cell: (a) => fmtDateTime(a.grantedAt),
              },
              {
                key: "status",
                header: t("Trạng thái"),
                cell: (a) => (
                  <span className={a.revokedAt ? "text-ink-2" : "text-ok"}>
                    {a.revokedAt ? t("Đã thu hồi") : t("Đang hiệu lực")}
                  </span>
                ),
              },
            ]}
            empty={<EmptyState title={t("Chưa có phân công")} />}
          />
        </div>
      </PageBody>
    </>
  );
}
export function AssignmentCreate() {
  const router = useRouter(),
    catalog = useLedgerQuery({
      queryKey: ["catalog"],
      queryFn: api.governance.catalog,
    }),
    users = useLedgerQuery({ queryKey: ["users"], queryFn: api.users.list });
  if (catalog.error || users.error)
    return (
      <ErrorState
        error={catalog.error ?? users.error}
        onRetry={() => {
          void catalog.refetch();
          void users.refetch();
        }}
      />
    );
  if (!catalog.data || !users.data) return <LoadingRows />;
  return (
    <>
      <PageHeader
        title={t("Phân công kiểm định mới")}
        crumbs={[
          {
            href: "/admin/compliance-assignments",
            label: t("Phân công kiểm định"),
          },
          { label: t("Tạo mới") },
        ]}
      />
      <PageBody>
        <Section title={t("Phạm vi và người phụ trách")}>
          <div className="max-w-2xl p-5">
            <CommandForm
              title={t("Ghi phân công")}
              endpoint="POST /compliance/assignments"
              schema={grantSchema}
              defaultValues={{ farmId: "", reviewerUserId: "", reason: "" }}
              submitLabel={t("Ghi phân công")}
              invalidate={[["compliance-assignments"]]}
              run={(v, cmd) => api.governance.grantAssignment(v, cmd)}
              onDone={() => router.push("/admin/compliance-assignments")}
            >
              {(f) => (
                <>
                  <SelectField
                    control={f.control}
                    name="farmId"
                    label={t("Vùng trồng")}
                    options={catalog.data.farms
                      .filter((x) => x.status === "ACTIVE")
                      .map((x) => ({
                        value: x.id,
                        label: `${x.name} · ${x.organization.name}`,
                      }))}
                  />
                  <SelectField
                    control={f.control}
                    name="reviewerUserId"
                    label={t("Người kiểm định")}
                    options={users.data
                      .filter(
                        (u) =>
                          u.role.code === "COMPLIANCE_REVIEWER" &&
                          u.accountStatus === "ACTIVE" &&
                          u.organization?.type === "AUDITOR",
                      )
                      .map((u) => ({
                        value: u.id,
                        label: `${u.fullName} · ${u.organization?.name}`,
                      }))}
                  />
                  <TextAreaField
                    control={f.control}
                    name="reason"
                    label={t("Lý do phân công")}
                  />
                </>
              )}
            </CommandForm>
          </div>
        </Section>
      </PageBody>
    </>
  );
}
export function AssignmentDetail({ id }: { id: string }) {
  const q = useLedgerQuery({
      queryKey: ["compliance-assignments"],
      queryFn: api.governance.assignments,
    }),
    users = useLedgerQuery({ queryKey: ["users"], queryFn: api.users.list });
  if (q.error || users.error)
    return (
      <ErrorState
        error={q.error ?? users.error}
        onRetry={() => {
          void q.refetch();
          void users.refetch();
        }}
      />
    );
  if (!q.data || !users.data) return <LoadingRows />;
  const a = q.data.find((a) => a.id === id);
  if (!a) return <EmptyState title={t("Không tìm thấy phân công")} />;
  return (
    <>
      <PageHeader
        title={t("Chi tiết phân công kiểm định")}
        crumbs={[
          {
            href: "/admin/compliance-assignments",
            label: t("Phân công kiểm định"),
          },
          { label: a.farm.name },
        ]}
      />
      <PageBody>
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-5">
            <Section title={t("Phạm vi")}>
              <Fields>
                <Field label={t("Vùng trồng")}>{a.farm.name}</Field>
                <Field label={t("Người kiểm định")}>
                  {users.data.find((u) => u.id === a.reviewerUserId)
                    ?.fullName ?? a.reviewerUserId}
                </Field>
                <Field label={t("Ngày phân công")}>
                  {fmtDateTime(a.grantedAt)}
                </Field>
                <Field label={t("Ngày thu hồi")}>
                  {fmtDateTime(a.revokedAt)}
                </Field>
              </Fields>
            </Section>
            <Section title={t("Lịch sử phân công")}>
              <ul className="divide-y divide-line/70">
                {a.audits.map((e) => (
                  <li key={e.id} className="px-5 py-3 text-[13px]">
                    <div className="flex justify-between gap-3">
                      <span className="font-mono text-[12px]">{e.action}</span>
                      <span className="text-ink-2">
                        {fmtDateTime(e.recordedAt)}
                      </span>
                    </div>
                    <p>{e.reason}</p>
                    <p className="text-ink-2">
                      {users.data.find((u) => u.id === e.actorUserId)
                        ?.fullName ?? e.actorUserId}
                    </p>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
          <Section title={t("Quản lý phân công")}>
            <div className="p-5">
              {a.revokedAt ? (
                <Callout title={t("Đã thu hồi")}>
                  {fmtDateTime(a.revokedAt)}
                </Callout>
              ) : (
                <CommandForm
                  title={t("Thu hồi phân công")}
                  endpoint="POST /compliance/assignments/:id/revoke"
                  schema={revokeSchema}
                  defaultValues={{ reason: "" }}
                  submitLabel={t("Thu hồi phân công")}
                  tone="danger"
                  invalidate={[["compliance-assignments"]]}
                  run={(v, cmd) => api.governance.revokeAssignment(id, v, cmd)}
                >
                  {(f) => (
                    <TextAreaField
                      control={f.control}
                      name="reason"
                      label={t("Lý do thu hồi")}
                    />
                  )}
                </CommandForm>
              )}
            </div>
          </Section>
        </div>
      </PageBody>
    </>
  );
}
