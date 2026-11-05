"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { Check, CheckCircle2 } from "lucide-react";
import type { components } from "@/lib/generated/api";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { wapi } from "@/lib/ledger/enterprise-coordination-api";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { fmtMoney } from "@/lib/ledger/format";
import { t as tr } from "@/lib/ledger/i18n";
import { useLedgerServiceDraft } from "@/components/ledger/workspace/service-draft";
import { CommandForm } from "@/components/ledger/kit/command-dialog";
import { TextField } from "@/components/ledger/kit/form-fields";
import {
  PageHeader,
  PageBody,
  Section,
  Fields,
  Field,
  Callout,
  ErrorState,
  LoadingRows,
} from "@/components/ledger/kit/page";
import { Checkbox } from "@/components/ledger/ui/checkbox";
import { Button } from "@/components/ledger/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ledger/ui/dialog";
import { ParticipationPanel } from "./participation";
import { SepayPayment } from "./sepay-payment";
import { ContractPdf, ContractHistory } from "./service-contract";

const quoteSchema = z.object({
  planCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/),
  billingName: z.string().trim().min(2).max(255),
  billingEmail: z
    .email()
    .max(255)
    .transform((v) => v.trim().toLowerCase()),
  billingAddress: z.string().trim().min(5).max(500),
});
const acceptSchema = z.object({
  accepted: z
    .boolean()
    .refine((v) => v, { error: () => tr("Cần xác nhận hợp đồng") }),
});
type Catalog = components["schemas"]["ServiceCatalogView"];
function PlanSelection({
  form,
  catalog,
}: {
  form: UseFormReturn<z.infer<typeof quoteSchema>>;
  catalog: Catalog;
}) {
  return (
    <Controller
      control={form.control}
      name="planCode"
      render={({ field }) => {
        const selected = catalog.plans.find((p) => p.code === field.value);
        return (
          <div className="space-y-4">
            <fieldset>
              <legend className="mb-3 text-sm font-semibold">
                {tr("Chọn gói dịch vụ")}
              </legend>
              <div className="grid gap-3 lg:grid-cols-3">
                {catalog.plans.map((p) => (
                  <label
                    key={p.code}
                    className={`relative flex cursor-pointer flex-col gap-2 rounded-lg border p-4 transition-colors focus-within:ring-2 focus-within:ring-brand ${field.value === p.code ? "border-brand bg-brand-weak" : "border-line bg-surface hover:border-brand"}`}
                  >
                    <input
                      type="radio"
                      name={field.name}
                      value={p.code}
                      checked={field.value === p.code}
                      onChange={() => field.onChange(p.code)}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      className="sr-only"
                    />
                    <span className="flex items-center justify-between gap-3 font-semibold">
                      {p.name}
                      {field.value === p.code && (
                        <Check className="size-5 text-brand" />
                      )}
                    </span>
                    <span className="text-xl font-semibold">
                      {fmtMoney(p.version.setupFee + p.version.annualFee)}
                    </span>
                    <span className="text-xs text-ink-2">
                      {p.version.termMonths} {tr("tháng")} ·{" "}
                      {tr("gồm phí khởi tạo và duy trì")}
                    </span>
                    <span className="mt-2 text-sm">
                      {p.version.limits.products} {tr("sản phẩm")} ·{" "}
                      {p.version.limits.chains} {tr("chuỗi")} ·{" "}
                      {p.version.limits.members} {tr("thành viên")}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {selected && (
              <div className="rounded-md border border-line bg-canvas p-4">
                <Fields cols={3}>
                  <Field label={tr("Khởi tạo")}>
                    {fmtMoney(selected.version.setupFee)}
                  </Field>
                  <Field label={tr("Duy trì")}>
                    {fmtMoney(selected.version.annualFee)}
                  </Field>
                  <Field label={tr("Tổng giá gói")}>
                    <strong className="text-lg text-brand">
                      {fmtMoney(
                        selected.version.setupFee + selected.version.annualFee,
                      )}
                    </strong>
                  </Field>
                </Fields>
                <p className="mt-2 text-xs text-ink-2">
                  {tr(
                    "Giá và hạn mức của gói đang chọn sẽ được điền vào hợp đồng PDF. Thuế theo điều kiện trong hợp đồng.",
                  )}
                </p>
              </div>
            )}
          </div>
        );
      }}
    />
  );
}
export default function ServicePage({
  view = "quote",
  invoiceId,
}: {
  view?: "quote" | "contract" | "payment";
  invoiceId?: string;
}) {
  const router = useRouter(),
    { owner } = useWorkspaceAccess(),
    { draft, setDraft } = useLedgerServiceDraft();
  const [paymentOpen, setPaymentOpen] = useState(view === "payment"),
    [pdfReady, setPdfReady] = useState(false);
  const q = useQuery({
    queryKey: ["ws-service"],
    queryFn: wapi.service,
    refetchInterval: (query) =>
      query.state.data?.order?.status !== "AWAITING_PAYMENT" &&
      query.state.data?.emails.some(
        (e) => e.kind === "CONTRACT" && e.status === "PENDING",
      )
        ? 5000
        : false,
  });
  const enrollment = useQuery({
    queryKey: ["ws-enrollment"],
    queryFn: wapi.enrollment,
  });
  const { refetch: refreshService } = q;
  const onPaid = useCallback(() => {
    void refreshService();
  }, [refreshService]);
  if (q.error)
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows />;
  const data = q.data,
    order = data.order,
    preview = order ? null : (draft?.preview ?? data.latestPreview),
    input = draft?.input ?? data.latestPreview?.input;
  const paid = order && order.status !== "AWAITING_PAYMENT";
  const contractMail = data.emails?.find((e) => e.kind === "CONTRACT");
  if (
    data.stage === "TEMPORARY_ACCESS" ||
    data.stage === "AWAITING_TEMPORARY_ACTIVATION"
  )
    return (
      <>
        <PageHeader
          title={tr("Dịch vụ doanh nghiệp")}
          description={tr(
            "Thanh toán đang tạm hoãn trong giai đoạn sử dụng tạm.",
          )}
        />
        <PageBody>
          <ParticipationPanel />
          <Section
            title={tr(
              data.stage === "TEMPORARY_ACCESS"
                ? "Đã kích hoạt sử dụng tạm"
                : "Chờ quản trị kích hoạt",
            )}
            bodyClassName="p-4"
          >
            <Callout>
              {tr(
                data.stage === "TEMPORARY_ACCESS"
                  ? "Doanh nghiệp được sử dụng các chức năng theo năng lực và quyền đã duyệt. Không cần mua gói hoặc xác nhận thanh toán."
                  : "Hồ sơ đã được duyệt. Quản trị cần hoàn tất xét duyệt năng lực và kích hoạt sử dụng tạm; bạn không cần mua gói.",
              )}
            </Callout>
            <div className="mt-4 flex flex-wrap gap-4 text-sm text-brand">
              <Link href="/enterprise/onboarding">{tr("Theo dõi hồ sơ")}</Link>
              {data.stage === "TEMPORARY_ACCESS" && (
                <>
                  <Link href="/enterprise">{tr("Vào doanh nghiệp")}</Link>
                  <Link href="/supply-chains">{tr("Trạng thái chuỗi")}</Link>
                </>
              )}
            </div>
            {order && (
              <p className="mt-4 text-sm text-ink-2">
                {tr(
                  "Đơn dịch vụ trước đây được giữ nguyên để đối chiếu; sử dụng tạm không xác nhận đơn đã thanh toán.",
                )}
              </p>
            )}
          </Section>
        </PageBody>
      </>
    );
  return (
    <>
      <PageHeader
        title={tr(view === "quote" ? "Chọn dịch vụ" : "Hợp đồng dịch vụ")}
        description={tr(
          "Chọn gói → Kiểm tra hợp đồng PDF → Thanh toán và kích hoạt",
        )}
      />
      <PageBody className="min-w-0 space-y-5">
        <nav
          aria-label={tr("Các bước đăng ký dịch vụ")}
          className="flex flex-wrap gap-4 border-b border-line pb-4 text-sm"
        >
          {[
            ["/enterprise/service", "1. Chọn dịch vụ"],
            ["/enterprise/service/contract", "2. Hợp đồng"],
            ["/enterprise/service/payment", "3. Thanh toán"],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="text-brand underline-offset-4 hover:underline"
            >
              {tr(label)}
            </Link>
          ))}
        </nav>
        {view === "quote" && !order && (
          <>
            <ParticipationPanel />
            {enrollment.error ? (
              <ErrorState
                error={enrollment.error}
                onRetry={() => enrollment.refetch()}
              />
            ) : !enrollment.data ? (
              <LoadingRows />
            ) : enrollment.data.status !== "APPROVED" ? (
              <Callout>
                {tr(
                  "Hồ sơ cần được quản trị phê duyệt trước khi chọn dịch vụ.",
                )}
              </Callout>
            ) : enrollment.data.participationStatus !== "CHAIN_OWNER" ? (
              <Callout>
                {tr("Thành viên tham gia miễn phí, không cần mua gói.")}
              </Callout>
            ) : owner ? (
              <Section
                title={tr("Gói dịch vụ và thông tin thanh toán")}
                bodyClassName="p-4 sm:p-5"
              >
                <CommandForm
                  title={tr("Lập hợp đồng PDF")}
                  endpoint="POST /enterprise-service/preview"
                  schema={quoteSchema}
                  defaultValues={{
                    planCode:
                      input?.planCode ?? data.catalog.plans[0]?.code ?? "",
                    billingName:
                      input?.billingName ?? enrollment.data.organizationName,
                    billingEmail:
                      input?.billingEmail ??
                      enrollment.data.representativeEmail,
                    billingAddress:
                      input?.billingAddress ??
                      (typeof enrollment.data.details?.address === "string"
                        ? enrollment.data.details.address
                        : ""),
                  }}
                  submitLabel={tr("Tiếp tục · Kiểm tra hợp đồng")}
                  invalidate={[["ws-service"]]}
                  run={async (v, cmd) => {
                    const values = {
                      ...v,
                      catalogVersion: data.catalog.version,
                    };
                    const result = await wapi.previewService(values, cmd);
                    setDraft({ input: values, preview: result });
                    return result;
                  }}
                  onDone={() => router.push("/enterprise/service/contract")}
                >
                  {(form) => (
                    <div className="space-y-6">
                      <PlanSelection form={form} catalog={data.catalog} />
                      <div className="grid gap-4 sm:grid-cols-2">
                        <TextField
                          control={form.control}
                          name="billingName"
                          label={tr("Tên thanh toán")}
                        />
                        <TextField
                          control={form.control}
                          name="billingEmail"
                          label={tr("Email nhận hợp đồng")}
                          type="email"
                        />
                        <div className="sm:col-span-2">
                          <TextField
                            control={form.control}
                            name="billingAddress"
                            label={tr("Địa chỉ thanh toán")}
                          />
                        </div>
                      </div>
                      <Callout>{data.catalog.disclaimer}</Callout>
                    </div>
                  )}
                </CommandForm>
              </Section>
            ) : (
              <Callout>{tr("Chủ hồ sơ đăng ký được chọn dịch vụ.")}</Callout>
            )}
          </>
        )}
        {view === "quote" && order && (
          <Section
            title={tr("Gói dịch vụ đã xác nhận")}
            bodyClassName="space-y-3 p-4"
          >
            <Fields cols={3}>
              <Field label={tr("Gói")}>
                {String(order.quotation.name ?? order.planCode)}
              </Field>
              <Field label={tr("Tổng giá gói")}>{fmtMoney(order.amount)}</Field>
              <Field label={tr("Trạng thái")}>
                {tr(paid ? "Đã thanh toán" : "Chờ thanh toán")}
              </Field>
            </Fields>
            <Link
              href="/enterprise/service/contract"
              className="text-brand underline"
            >
              {tr("Xem hợp đồng và thanh toán")}
            </Link>
          </Section>
        )}
        {view !== "quote" && (order || preview) ? (
          <>
            {paid && (
              <Callout tone="info" title={tr("Thanh toán thành công")}>
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="size-5" />
                  {tr(
                    order.status === "PAID_SIMULATED"
                      ? "Giao dịch thử nghiệm đã hoàn tất."
                      : "Máy chủ đã xác nhận giao dịch.",
                  )}
                </span>
                <p className="mt-2">
                  {tr(
                    data.stage === "ACTIVE"
                      ? "Dịch vụ đã được kích hoạt."
                      : "Đã ghi nhận thanh toán; kiểm tra trạng thái kích hoạt tại trang doanh nghiệp.",
                  )}
                </p>
                <p className="mt-2">
                  {tr(
                    contractMail?.status === "SENT"
                      ? "Email xác nhận và hợp đồng đã được gửi đến {p0}."
                      : "Email xác nhận kèm hợp đồng đang chờ gửi đến {p0}.",
                    { p0: order.billingEmail },
                  )}
                </p>
                <Link
                  href="/enterprise"
                  className="mt-3 inline-block text-brand underline"
                >
                  {tr("Vào doanh nghiệp")}
                </Link>
              </Callout>
            )}
            <Section
              title={tr(
                order
                  ? "Hợp đồng đã xác nhận"
                  : "Kiểm tra hợp đồng trước khi xác nhận",
              )}
              bodyClassName="space-y-5 p-4 sm:p-5"
            >
              {order?.hasPdf || preview ? (
                <ContractPdf
                  key={order?.id ?? preview!.previewId}
                  kind={order ? "order" : "preview"}
                  id={order?.id ?? preview!.previewId}
                  expectedSha256={order?.pdfSha256 ?? preview!.pdfSha256}
                  onReady={setPdfReady}
                />
              ) : (
                <>
                  <Callout>
                    {tr(
                      "Hợp đồng cũ chưa có tệp PDF; nội dung đã xác nhận được giữ nguyên để đối chiếu.",
                    )}
                  </Callout>
                  <pre className="whitespace-pre-wrap break-words text-sm">
                    {order?.contractText}
                  </pre>
                </>
              )}
              {preview && input && owner && (
                <>
                  <p className="text-sm text-ink-2">
                    {tr(
                      "Bạn đang xem mẫu hợp đồng thử nghiệm. Kiểm tra doanh nghiệp, thông tin thanh toán và gói dịch vụ trong PDF.",
                    )}
                  </p>
                  <CommandForm
                    key={preview.previewId}
                    title={tr("Xác nhận hợp đồng")}
                    endpoint="POST /enterprise-service/orders"
                    schema={acceptSchema}
                    defaultValues={{ accepted: false }}
                    submitLabel={tr("Xác nhận và thanh toán")}
                    invalidate={[["ws-service"], ["ws-enrollment"]]}
                    run={(_, cmd) => {
                      if (!pdfReady)
                        throw {
                          status: 409,
                          message: tr(
                            "Vui lòng mở bản PDF trước khi xác nhận.",
                          ),
                        };
                      return wapi.orderService(
                        {
                          ...input,
                          contractDigest: preview.contractDigest,
                          accepted: true,
                        },
                        cmd,
                      );
                    }}
                    onDone={() => {
                      void q.refetch().then(() => {
                        setDraft(null);
                        setPaymentOpen(true);
                      });
                    }}
                  >
                    {(f) => (
                      <Controller
                        control={f.control}
                        name="accepted"
                        render={({ field }) => (
                          <label className="flex items-start gap-2 text-sm">
                            <Checkbox
                              disabled={!pdfReady}
                              checked={field.value}
                              onCheckedChange={(v) =>
                                field.onChange(v === true)
                              }
                            />
                            {tr(
                              "Tôi đã kiểm tra và đồng ý với bản hợp đồng PDF này",
                            )}
                          </label>
                        )}
                      />
                    )}
                  </CommandForm>
                </>
              )}
              {order && !paid && owner && (
                <Button onClick={() => setPaymentOpen(true)}>
                  {tr("Thanh toán gói dịch vụ")}
                </Button>
              )}
            </Section>
          </>
        ) : (
          view !== "quote" && (
            <Callout>
              {tr("Chọn gói dịch vụ để tạo hợp đồng PDF.")}{" "}
              <Link className="underline" href="/enterprise/service">
                {tr("Chọn dịch vụ")}
              </Link>
            </Callout>
          )
        )}
        <ContractHistory history={data.history ?? []} />
        <Dialog
          open={paymentOpen && owner && !!(order || invoiceId)}
          onOpenChange={setPaymentOpen}
        >
          <DialogContent
            overlayClassName="backdrop-blur-sm"
            className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"
          >
            <DialogHeader>
              <DialogTitle>
                {tr(paid ? "Thanh toán thành công" : "Thanh toán dịch vụ")}
              </DialogTitle>
              <DialogDescription>
                {tr(
                  "Hợp đồng được giữ nguyên. Trạng thái tự cập nhật khi hệ thống xác nhận giao dịch.",
                )}
              </DialogDescription>
            </DialogHeader>
            <SepayPayment
              invoiceId={invoiceId}
              onPaid={onPaid}
              fallback={
                data.catalog.simulationEnabled && order ? (
                  paid ? (
                    <Callout tone="info" title={tr("Thanh toán thành công")}>
                      {tr("Giao dịch thử nghiệm đã hoàn tất.")}
                    </Callout>
                  ) : (
                    <>
                      <Callout tone="warn">
                        {tr(
                          "Thanh toán mô phỏng chỉ dùng kiểm thử local, không chuyển tiền thật.",
                        )}
                      </Callout>
                      <CommandForm
                        title={tr("Thanh toán mô phỏng")}
                        endpoint="POST /enterprise-service/payment-simulation"
                        schema={z.object({})}
                        defaultValues={{}}
                        version={order.version}
                        submitLabel={tr("Thanh toán mô phỏng")}
                        invalidate={[
                          ["ws-service"],
                          ["ws-enrollment"],
                          ["enterprise-access"],
                        ]}
                        run={(_, cmd) =>
                          wapi.payService(
                            {
                              version: order.version,
                              contractDigest: order.contractDigest,
                              method: "LOCAL_DEMO",
                            },
                            cmd,
                          )
                        }
                        onDone={onPaid}
                      >
                        {() => null}
                      </CommandForm>
                    </>
                  )
                ) : undefined
              }
            />
          </DialogContent>
        </Dialog>
      </PageBody>
    </>
  );
}
