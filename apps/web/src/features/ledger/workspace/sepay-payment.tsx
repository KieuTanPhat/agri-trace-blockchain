"use client";

import Image from "next/image";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import type { components } from "@/lib/generated/api";
import { useLedgerQuery, useLedgerQueryClient } from "@/lib/ledger/data";
import { ledgerRequest } from "@/lib/ledger/request";
import { PERMISSION_SYNC_EVENT } from "@/lib/permission-sync";
import { fmtDateTime, fmtMoney } from "@/lib/ledger/format";
import { t as tr } from "@/lib/ledger/i18n";
import { Button } from "@/components/ledger/ui/button";
import {
  Callout,
  ErrorState,
  Field,
  Fields,
  LoadingRows,
  Section,
} from "@/components/ledger/kit/page";

type Checkout = components["schemas"]["SepayCheckoutView"];

export function SepayPayment({
  invoiceId,
  onPaid,
  fallback,
}: {
  invoiceId?: string;
  onPaid?: () => void;
  fallback?: React.ReactNode;
}) {
  const client = useLedgerQueryClient();
  const notified = useRef<string | null>(null);
  const q = useLedgerQuery({
    queryKey: ["sepay-checkout", invoiceId ?? "initial"],
    queryFn: () =>
      ledgerRequest<Checkout>(
        invoiceId
          ? `/enterprise-billing/invoices/${encodeURIComponent(invoiceId)}/sepay`
          : "/enterprise-service/payment/sepay",
      ),
    refetchInterval: (query) =>
      !query.state.error &&
      query.state.data?.enabled &&
      query.state.data.status === "ISSUED"
        ? 3000
        : false,
    refetchIntervalInBackground: false,
  });
  useEffect(() => {
    const data = q.data;
    if (
      data?.status !== "PAID" ||
      !data.invoiceId ||
      notified.current === data.invoiceId
    )
      return;
    notified.current = data.invoiceId;
    for (const key of [
      "ws-service",
      "ws-enrollment",
      "ws-billing",
      "enterprise-access",
    ])
      void client.invalidateQueries({ queryKey: [key] });
    window.dispatchEvent(new Event(PERMISSION_SYNC_EVENT));
    onPaid?.();
  }, [q.data, client, onPaid]);

  if (q.error)
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={3} />;
  const data = q.data;
  if (!data.enabled)
    return (
      fallback ?? (
        <Callout>
          {tr(
            "Thanh toán QR SePay chưa được bật. Không chuyển khoản khi chưa có hướng dẫn thanh toán từ hệ thống.",
          )}
        </Callout>
      )
    );
  const paid = data.status === "PAID";
  const test = data.mode === "test";
  return (
    <Section
      title={tr(
        paid ? "Thanh toán thành công" : "Thanh toán chuyển khoản SePay",
      )}
      bodyClassName="space-y-4 p-4 sm:p-5"
    >
      {test && (
        <Callout tone="warn" title={tr("Chế độ thử nghiệm SePay")}>
          {tr(
            "Không chuyển tiền thật. Giao dịch thử nghiệm chỉ được xác nhận qua webhook test, không tính vào doanh thu thật.",
          )}
        </Callout>
      )}
      {data.reviewMessage && (
        <Callout tone="warn">{tr(data.reviewMessage)}</Callout>
      )}
      <Fields cols={3}>
        <Field label={tr("Hóa đơn")}>{data.invoiceNumber}</Field>
        <Field label={tr("Số tiền")}>
          {data.amount === null ? "—" : fmtMoney(data.amount)}
        </Field>
        <Field label={tr("Trạng thái")}>
          {tr(
            paid
              ? data.simulated
                ? "Đã thanh toán thử nghiệm"
                : "Đã xác nhận thanh toán"
              : data.status === "VOID"
                ? "Hóa đơn đã hủy"
                : "Chờ xác nhận thanh toán",
          )}
        </Field>
      </Fields>
      {paid ? (
        <>
          <Callout
            tone="info"
            title={tr(
              data.serviceActive
                ? "Dịch vụ đã được kích hoạt"
                : "Đã ghi nhận thanh toán",
            )}
          >
            {tr(
              data.serviceActive
                ? "Gói dịch vụ đã cập nhật theo giao dịch được máy chủ xác nhận. Kết nối blockchain có tiến độ riêng."
                : "Đang chờ hoàn tất điều kiện kích hoạt dịch vụ; liên hệ quản trị nếu trạng thái chưa cập nhật.",
            )}
          </Callout>
          {data.paidAt && (
            <p className="text-sm text-ink-2">
              {tr("Thời điểm xác nhận")}: {fmtDateTime(data.paidAt)}
            </p>
          )}
          <Link href="/enterprise" className="text-sm text-brand underline">
            {tr("Vào doanh nghiệp")}
          </Link>
        </>
      ) : (
        <>
          {data.status === "ISSUED" && (
            <div className="grid gap-5 sm:grid-cols-[240px_1fr]">
              <div className="flex min-h-48 items-center justify-center rounded-md border border-line bg-white p-3">
                {data.qrUrl && !data.reviewMessage ? (
                  <Image
                    src={data.qrUrl}
                    width={216}
                    height={280}
                    unoptimized
                    referrerPolicy="no-referrer"
                    alt={tr("Mã QR chuyển khoản cho hóa đơn {p0}", {
                      p0: data.invoiceNumber ?? "",
                    })}
                    className="h-auto max-w-full"
                  />
                ) : (
                  <p className="text-center text-sm text-ink-2">
                    {tr(
                      data.reviewMessage
                        ? "Tạm dừng hướng dẫn chuyển thêm tiền"
                        : "Hóa đơn đã quá hạn thanh toán; liên hệ quản trị",
                    )}
                  </p>
                )}
              </div>
              <div className="min-w-0 space-y-3 text-sm">
                <Fields cols={1}>
                  <Field label={tr("Ngân hàng")}>{data.bank}</Field>
                  <Field label={tr("Tài khoản nhận")}>
                    {data.accountNumber}
                  </Field>
                  <Field label={tr("Chủ tài khoản")}>
                    {data.accountHolder}
                  </Field>
                  <Field label={tr("Nội dung chuyển khoản")}>
                    <span className="break-all font-mono font-semibold">
                      {data.paymentCode}
                    </span>
                  </Field>
                  <Field label={tr("Hạn thanh toán")}>
                    {data.dueAt ? fmtDateTime(data.dueAt) : "—"}
                  </Field>
                </Fields>
                <p className="text-ink-2">
                  {tr(
                    "Giữ nguyên số tiền và nội dung chuyển khoản. Quét QR chưa xác nhận thanh toán; trang tự cập nhật khi máy chủ nhận được giao dịch hợp lệ.",
                  )}
                </p>
              </div>
            </div>
          )}
          <p
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 text-sm text-ink-2"
          >
            <Loader2 className="size-4 animate-spin" />
            {tr(
              q.isFetching
                ? "Đang kiểm tra giao dịch…"
                : "Đang chờ ngân hàng xác nhận thanh toán",
            )}
          </p>
          <Button
            variant="outline"
            onClick={() => void q.refetch()}
            disabled={q.isFetching}
          >
            {tr(q.isFetching ? "Đang kiểm tra…" : "Kiểm tra thanh toán")}
          </Button>
        </>
      )}
    </Section>
  );
}
