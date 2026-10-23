"use client";

import Link from "next/link";
import { useLedgerParams as useParams } from "@/components/ledger/route-screen";

import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { z } from "zod";
import { FileText } from "lucide-react";
import { api } from "@/lib/ledger/platform-api";
import { useLedgerSession as useSession } from "@/lib/ledger/platform-access";
import { fmtBytes, fmtDateTime, shortHash } from "@/lib/ledger/format";
import { CAPABILITY_LABEL } from "@/lib/ledger/labels";
import { decision, reason } from "@/lib/ledger/platform-schemas";
import { CommandForm } from "@/components/ledger/kit/command-dialog";
import {
  ChoiceField,
  TextAreaField,
} from "@/components/ledger/kit/form-fields";
import { Guard } from "@/components/ledger/kit/guard";
import {
  Callout,
  ErrorState,
  LoadingRows,
  PageBody,
  PageHeader,
  Section,
} from "@/components/ledger/kit/page";
import { Status } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
import { AmendmentEvidenceDownload } from "../../document-download";
const schema = z.object({ decision, reason: reason() });

const FIELDS: [key: string, label: string][] = [
  ["name", tr("Tên tổ chức")],
  ["legalForm", tr("Loại hình")],
  ["representative", tr("Người đại diện")],
  ["address", tr("Địa chỉ")],
  ["ward", tr("Phường/xã")],
  ["province", tr("Tỉnh/thành")],
  ["activities", tr("Hoạt động")],
  ["provinceCode", tr("Mã tỉnh/thành")],
  ["wardCode", tr("Mã phường/xã")],
  ["legalData", tr("Thông tin pháp lý và sản xuất")],
];

function PreviewScreen() {
  return (
    <Guard permission="amendment.read">
      <Detail />
    </Guard>
  );
}

function show(v: unknown) {
  if (Array.isArray(v))
    return v.map((x) => CAPABILITY_LABEL[x] ?? x).join(", ") || "—";
  return v === null || v === undefined || v === ""
    ? "—"
    : typeof v === "object"
      ? JSON.stringify(v, null, 2)
      : String(v);
}

function Detail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const q = useQuery({
    queryKey: ["amendment", id],
    queryFn: () => api.enterprises.amendment(id),
  });
  if (q.error)
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={10} className="p-8" />;
  const { amendment: a, profile, organization, evidence, stale } = q.data;
  const current: Record<string, unknown> = {
    ...(profile ?? {}),
    name: organization.name,
  };
  const changed = FIELDS.filter(
    ([k]) =>
      show(current[k]) !==
      show((a.target as unknown as Record<string, unknown>)[k]),
  );

  return (
    <>
      <PageHeader
        crumbs={[
          {
            href: "/admin/enterprises/amendments",
            label: tr("Điều chỉnh hồ sơ"),
          },
          { label: organization.name },
        ]}
        title={tr("Điều chỉnh hồ sơ · {p0}", { p0: organization.name })}
        meta={<Status group="request" value={a.status} />}
        description={
          <>
            {tr("Gửi")} {fmtDateTime(a.createdAt)} {tr("· dựa trên hồ sơ v")}
            {a.profileVersion}
            {tr(", tổ chức v")}
            {a.organizationVersion} · {changed.length} {tr("trường thay đổi")}
          </>
        }
      />
      <PageBody wide>
        {stale && (
          <Callout tone="warn" title={tr("Đề nghị đã cũ")}>
            {tr(
              "Hồ sơ tổ chức đã thay đổi sau khi đề nghị được tạo. Phê duyệt sẽ bị từ chối (409); doanh nghiệp cần gửi đề nghị mới. Vẫn có thể từ chối kèm lý do.",
            )}
          </Callout>
        )}
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex min-w-0 flex-[999_1_600px] flex-col gap-5">
            <Section title={tr("So sánh")} aside={tr("Hiện hành → Đề nghị")}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-sunken text-left text-[12px] text-ink-2">
                      <th className="h-9 w-[150px] px-4 font-semibold">
                        {tr("Trường")}
                      </th>
                      <th className="px-3 font-semibold">{tr("Hiện hành")}</th>
                      <th className="px-4 font-semibold">{tr("Đề nghị")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FIELDS.map(([k, label]) => {
                      const before = show(current[k]);
                      const after = show(
                        (a.target as unknown as Record<string, unknown>)[k],
                      );
                      const diff = before !== after;
                      return (
                        <tr
                          key={k}
                          className={cn(
                            "border-b border-line/70 last:border-0",
                            diff && "bg-warn-bg/40",
                          )}
                        >
                          <th
                            scope="row"
                            className="px-4 py-2.5 text-left align-top text-[12px] font-semibold text-ink-2"
                          >
                            {tr(label)}
                          </th>
                          <td
                            className={cn(
                              "px-3 py-2.5 align-top",
                              diff &&
                                "text-ink-2 line-through decoration-ink-2/50",
                            )}
                          >
                            {before}
                          </td>
                          <td
                            className={cn(
                              "px-4 py-2.5 align-top",
                              diff && "font-medium",
                            )}
                          >
                            {after}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
            <Section title={tr("Lý do của doanh nghiệp")}>
              <p className="px-4 py-3 text-[13px] sm:px-5">{a.reason}</p>
            </Section>
            <Section
              title={tr("Chứng cứ")}
              aside={tr("{p0} tệp", { p0: evidence.length })}
            >
              <ul className="divide-y divide-line/70">
                {evidence.map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[13px] sm:px-5"
                  >
                    <FileText className="size-3.5 text-ink-2" />
                    <span className="min-w-0 flex-1">
                      <AmendmentEvidenceDownload
                        amendmentId={id}
                        document={d}
                      />
                      <span className="text-ink-2">— {d.description}</span>
                    </span>
                    <span className="font-mono text-[12px] text-ink-2">
                      {fmtBytes(d.size)}
                    </span>
                    <span className="font-mono text-[12px] text-ink-2">
                      sha256 {shortHash(d.sha256)}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
          <aside className="flex min-w-0 flex-[1_1_340px] flex-col gap-4 lg:sticky lg:top-[68px] lg:max-w-[420px]">
            {a.status !== "PENDING" ? (
              <Callout
                tone={a.status === "APPROVED" ? "ok" : "neutral"}
                title={
                  a.status === "APPROVED" ? tr("Đã duyệt") : tr("Đã xử lý")
                }
              >
                {a.reviewNote}{" "}
                <span className="block text-ink-2">
                  {fmtDateTime(a.reviewedAt)}
                </span>
              </Callout>
            ) : can("amendment.review") ? (
              <div className="rounded-md border border-line-strong bg-card p-5">
                <CommandForm
                  title={tr("Quyết định")}
                  endpoint="POST /enterprise-profile-amendments/:id/review"
                  schema={schema}
                  defaultValues={{
                    decision: stale ? "REJECT" : "APPROVE",
                    reason: "",
                  }}
                  version={a.version}
                  submitLabel={tr("Ghi quyết định")}
                  invalidate={[
                    ["amendment", id],
                    ["amendments"],
                    ["inbox"],
                    ["organization", organization.id],
                    ["directory"],
                  ]}
                  run={(v, cmd) =>
                    api.enterprises.reviewAmendment(
                      id,
                      { ...v, version: a.version },
                      cmd,
                    )
                  }
                >
                  {(f) => (
                    <>
                      <ChoiceField
                        control={f.control}
                        name="decision"
                        label={tr("Kết quả")}
                        options={[
                          {
                            value: "APPROVE",
                            label: tr("Duyệt thay đổi"),
                            help: tr(
                              "Áp dụng bản đề nghị vào hồ sơ tổ chức (version tăng).",
                            ),
                          },
                          {
                            value: "REJECT",
                            label: tr("Từ chối"),
                            tone: "danger",
                          },
                        ]}
                      />
                      <TextAreaField
                        control={f.control}
                        name="reason"
                        label={tr("Lý do")}
                        hint={tr("10–1000 ký tự")}
                      />
                    </>
                  )}
                </CommandForm>
              </div>
            ) : (
              <Callout>{tr("Vai hiện tại chỉ được xem.")}</Callout>
            )}
            <Link
              className="text-[13px] text-brand hover:underline"
              href={`/admin/organizations?organizationId=${organization.id}`}
            >
              {tr("Xem hồ sơ tổ chức →")}
            </Link>
          </aside>
        </div>
      </PageBody>
    </>
  );
}

import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { useLocale as useLedgerLocale } from "@/components/ledger/locale";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLedgerLocale();
  return (
    <LedgerRouteScreen route={route} name="admin-enterprises-amendments-detail">
      <PreviewScreen />
    </LedgerRouteScreen>
  );
}
