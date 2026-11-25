"use client";
import { Controller } from "react-hook-form";
import { useState } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  CommandDialog,
  useDialog,
} from "@/components/ledger/kit/command-dialog";
import { SelectField } from "@/components/ledger/kit/form-fields";
import { useEvidenceObjectUrl } from "@/components/ledger/workspace/image-gallery";
import { Checkbox } from "@/components/ledger/ui/checkbox";
import { wapi } from "@/lib/ledger/enterprise-coordination-api";
import type { Billing, RenewalTerm } from "@/lib/ledger/coordination-types";
import { fmtMoney, fmtDate } from "@/lib/ledger/format";
import { Button } from "@/components/ledger/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ledger/ui/dialog";
import { Section } from "@/components/ledger/kit/page";
import { t } from "@/lib/ledger/i18n";

const choiceSchema = z.object({ planCode: z.string().min(1) });
const acceptSchema = z.object({
  accepted: z
    .boolean()
    .refine(Boolean, { error: () => t("Cần xác nhận hợp đồng") }),
});
const previewSchema = z.object({
  record: z.object({
    kind: z.literal("RENEWAL_PREVIEW"),
    planCode: z.string(),
    planName: z.string(),
    contractDigest: z.string(),
    contractText: z.string(),
    contentBase64: z.string(),
    sha256: z.string(),
    fileName: z.string(),
    mediaType: z.literal("application/pdf"),
    limits: z.record(z.string(), z.number()),
    usage: z.record(z.string(), z.number()),
  }),
});
type Preview = z.infer<typeof previewSchema>["record"];

export function ScheduledRenewal({ term }: { term: RenewalTerm }) {
  const [open, setOpen] = useState(false);
  const verified = useEvidenceObjectUrl(open ? term : undefined);
  return (
    <Section title={t("Gói kỳ tiếp theo")}>
      <div className="space-y-3 p-4 text-sm">
        <p className="font-semibold">{term.planName}</p>
        <p>
          {term.status === "SCHEDULED"
            ? `${t("Đã thanh toán, chờ kích hoạt")} · ${fmtDate(term.startsAt)} → ${fmtDate(term.endsAt)}`
            : t(
                "Đã xác nhận hợp đồng, chờ thanh toán. Gói hiện tại vẫn giữ nguyên.",
              )}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setOpen(true)}
          >
            {t("Xem hợp đồng")}
          </Button>
          {term.status === "AWAITING_PAYMENT" && (
            <Button size="sm" asChild>
              <Link
                href={`/enterprise/service/payment?invoiceId=${encodeURIComponent(term.invoiceId)}`}
              >
                {t("Thanh toán QR")}
              </Link>
            </Button>
          )}
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>{t("Hợp đồng gia hạn")}</DialogTitle>
              <DialogDescription>{term.planName}</DialogDescription>
            </DialogHeader>
            <p className="whitespace-pre-line text-sm">{term.contractText}</p>
            {verified.error ? (
              <p role="alert">{verified.error.message}</p>
            ) : verified.url ? (
              <>
                <iframe
                  title={t("Hợp đồng gia hạn")}
                  src={verified.url}
                  className="h-[50vh] w-full"
                />
                <a
                  href={verified.url}
                  download={term.fileName}
                  className="text-brand-ink underline"
                >
                  {t("Tải hợp đồng PDF")}
                </a>
              </>
            ) : (
              <p role="status">{t("Đang tải…")}</p>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </Section>
  );
}

export function RenewalContract({
  open,
  onOpenChange,
  plans,
  initialPlanCode,
  invalidate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plans: Billing["plans"];
  initialPlanCode: string;
  invalidate: string[][];
}) {
  const contract = useDialog<Preview>();
  const verified = useEvidenceObjectUrl(contract.target ?? undefined);
  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title={t("Chọn gói cho kỳ tiếp theo")}
        endpoint="POST /enterprise-billing/renewals"
        schema={choiceSchema}
        defaultValues={{ planCode: initialPlanCode }}
        submitLabel={t("Xem hợp đồng gia hạn")}
        success={t("Đã chuẩn bị hợp đồng gia hạn")}
        invalidate={[]}
        description={t(
          "Có thể chọn gói cao hơn hoặc thấp hơn. Gói hiện tại giữ nguyên đến hết kỳ; gói mới chỉ có hiệu lực sau khi đã thanh toán và kỳ cũ kết thúc.",
        )}
        run={(v, cmd) => wapi.renew(v, cmd)}
        onDone={(result) => contract.open(previewSchema.parse(result).record)}
      >
        {(f) => (
          <SelectField
            control={f.control}
            name="planCode"
            label={t("Gói kỳ tiếp theo")}
            options={plans.map((p) => ({
              value: p.code,
              label: `${p.name} · ${fmtMoney(p.version.annualFee)} · ${p.version.termMonths} ${t("tháng")}`,
            }))}
          />
        )}
      </CommandDialog>
      {contract.target && (
        <CommandDialog
          {...contract.props}
          title={`${t("Hợp đồng gia hạn")} · ${contract.target.planName}`}
          endpoint="POST /enterprise-billing/renewals"
          schema={acceptSchema}
          defaultValues={{ accepted: false }}
          submitLabel={t("Xác nhận hợp đồng và tạo hóa đơn")}
          invalidate={invalidate}
          wide
          run={async (_, cmd) => {
            if (!verified.url || verified.error)
              throw new Error(
                t("Cần tải và kiểm tra hợp đồng trước khi xác nhận"),
              );
            return wapi.renew(
              {
                planCode: contract.target!.planCode,
                contractDigest: contract.target!.contractDigest,
                accepted: true,
              },
              cmd,
            );
          }}
        >
          {(f) => (
            <div className="space-y-4">
              <p className="whitespace-pre-line text-sm">
                {contract.target!.contractText}
              </p>
            {Object.entries(contract.target!.usage).some(([key, used]) => used > (contract.target!.limits[key] ?? 0)) && <p role="status" className="rounded border border-line bg-warn-soft p-3 text-sm">{t("Mức dùng hiện tại vượt hạn mức gói mới:")} {Object.entries(contract.target!.usage).filter(([key, used]) => used > (contract.target!.limits[key] ?? 0)).map(([key, used]) => `${({ products: t("Sản phẩm"), chains: t("Chuỗi"), partners: t("Đối tác"), members: t("Thành viên") } as Record<string, string>)[key] ?? key}: ${used}/${contract.target!.limits[key] ?? 0}`).join(" · ")}. {t("Dữ liệu được giữ nguyên; khi gói mới có hiệu lực, việc tạo thêm tài nguyên vượt hạn mức sẽ bị chặn.")}</p>}
              {Object.entries(contract.target!.usage)
                .filter(
                  ([key, used]) => used > (contract.target!.limits[key] ?? 0),
                )
                .map(([key, used]) => (
                  <p key={key} className="rounded bg-warn-bg p-3 text-sm">
                    {t("Mức dùng hiện tại vượt gói mới")}:{" "}
                    {(
                      {
                        products: t("Sản phẩm"),
                        chains: t("Chuỗi"),
                        partners: t("Đối tác"),
                        members: t("Thành viên"),
                      } as Record<string, string>
                    )[key] ?? key}{" "}
                    {used}/{contract.target!.limits[key]}.{" "}
                    {t(
                      "Dữ liệu vẫn được giữ; khi gói mới có hiệu lực, cần giảm mức dùng hoặc nâng gói để tạo thêm.",
                    )}
                  </p>
                ))}
              {verified.error ? (
                <p role="alert" className="text-danger">
                  {verified.error.message}
                </p>
              ) : verified.url ? (
                <iframe
                  title={t("Hợp đồng gia hạn")}
                  src={verified.url}
                  className="h-[50vh] w-full rounded border border-line"
                />
              ) : (
                <p role="status">{t("Đang tải…")}</p>
              )}
              {verified.url && (
                <a
                  href={verified.url}
                  download={contract.target!.fileName}
                  className="text-sm text-brand-ink underline"
                >
                  {t("Tải hợp đồng PDF")}
                </a>
              )}
              <Controller
                control={f.control}
                name="accepted"
                render={({ field, fieldState }) => (
                  <div>
                    <label className="flex items-start gap-2 text-sm">
                      <Checkbox
                        disabled={!verified.url || !!verified.error}
                        checked={field.value}
                        onCheckedChange={(value) =>
                          field.onChange(value === true)
                        }
                      />
                      <span>
                        {t(
                          "Tôi đã đọc và đồng ý với hợp đồng, thời điểm áp dụng và hạn mức gói mới. Nếu vượt hạn mức, dữ liệu được giữ và việc tạo mới bị hạn chế.",
                        )}
                      </span>
                    </label>
                    {fieldState.error && (
                      <p role="alert" className="text-danger">
                        {fieldState.error.message}
                      </p>
                    )}
                  </div>
                )}
              />
            </div>
          )}
        </CommandDialog>
      )}
    </>
  );
}
