"use client";

import { useState } from "react";
import type { components } from "@/lib/generated/api";
import { api } from "@/lib/ledger/operations-api";
import { useLedgerQuery } from "@/lib/ledger/data";
import { fmtDateTime, fmtMoney } from "@/lib/ledger/format";
import { t as tr } from "@/lib/ledger/i18n";
import { Button } from "@/components/ledger/ui/button";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import {
  FilterBar,
  FilterSelect,
  useDebounced,
} from "@/components/ledger/kit/filters";
import { Callout, Section } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";

type Transfer = components["schemas"]["BankTransferView"];
const money = (v: string | null) => (v === null ? "—" : fmtMoney(Number(v)));
const reviewReasons: Record<string, string> = {
  RECIPIENT_OR_DIRECTION_MISMATCH: "Không khớp tài khoản nhận hoặc chiều giao dịch",
  INVOICE_CODE_NOT_MATCHED: "Chưa khớp mã hóa đơn",
  INVOICE_ALREADY_PROCESSED: "Hóa đơn đã thanh toán hoặc đã hủy",
  AMOUNT_OR_CURRENCY_MISMATCH: "Chuyển thiếu tiền hoặc sai đơn vị tiền tệ",
  TRANSFER_OUTSIDE_INVOICE_WINDOW: "Giao dịch ngoài thời hạn thanh toán",
  ENTERPRISE_REVIEW_NOT_READY: "Hồ sơ hoặc năng lực chưa sẵn sàng",
  SUBSCRIPTION_NOT_PAYABLE: "Gói dịch vụ không còn chờ thanh toán",
  CONTRACT_NOT_PAYABLE: "Hợp đồng chưa đủ điều kiện thanh toán",
};
export function BankTransfers() {
  const [search, setSearch] = useState(""),
    [mode, setMode] = useState("live"),
    [outcome, setOutcome] = useState("");
  const [offset, setOffset] = useState(0);
  const term = useDebounced(search);
  const q = useLedgerQuery({
    queryKey: ["bank-transfers", term, mode, outcome, offset],
    queryFn: () =>
      api.billing.bankTransfers({
        q: term || undefined,
        mode: mode || undefined,
        outcome: outcome || undefined,
        offset,
      }),
  });
  const columns: Column<Transfer>[] = [
    {
      key: "time",
      header: tr("Thời gian nhận"),
      cell: (r) => (
        <span className="whitespace-nowrap text-xs">
          {fmtDateTime(r.receivedAt)}
        </span>
      ),
    },
    {
      key: "reference",
      header: tr("Giao dịch / hóa đơn"),
      cell: (r) => (
        <div className="space-y-1">
          <p className="font-mono text-xs">
            {r.bankReference ?? r.transactionId}
          </p>
          <p className="text-xs text-ink-2">SePay #{r.transactionId}</p>
          <p className="text-xs text-ink-2">
            {r.invoiceNumber ?? tr("Chưa khớp hóa đơn")}
          </p>
          <p className="text-xs text-ink-2">{r.organizationName}</p>
          {r.mode === "test" && <Badge tone="warn">{tr("Thử nghiệm")}</Badge>}
        </div>
      ),
    },
    { key: "bank", header: tr("Ngân hàng"), cell: (r) => r.bank ?? "—" },
    {
      key: "received",
      header: tr("Thực nhận"),
      headClassName: "text-right",
      className: "text-right font-mono",
      cell: (r) => money(r.receivedAmount),
    },
    {
      key: "applied",
      header: tr("Thanh toán gói"),
      headClassName: "text-right",
      className: "text-right font-mono",
      cell: (r) => money(r.appliedAmount),
    },
    {
      key: "excess",
      header: tr("Tiền dư"),
      headClassName: "text-right",
      className: "text-right font-mono",
      cell: (r) => (
        <span
          className={
            r.excessAmount && Number(r.excessAmount) > 0
              ? "font-semibold text-warn"
              : ""
          }
        >
          {money(r.excessAmount)}
        </span>
      ),
    },
    {
      key: "status",
      header: tr("Kết quả đối soát"),
      cell: (r) => (
        <div className="space-y-1">
          <Badge
            tone={
              r.outcome === "MATCHED"
                ? "ok"
                : r.outcome === "IGNORED"
                  ? "neutral"
                  : "warn"
            }
          >
            {tr(
              r.outcome === "MATCHED"
                ? "Đã thanh toán"
                : r.outcome === "IGNORED"
                  ? "Bỏ qua"
                  : "Cần đối soát",
            )}
          </Badge>
          <p className="max-w-48 break-words text-xs text-ink-2">
            {r.reason === "INVOICE_SETTLED_WITH_EXCESS"
              ? tr("Đã kích hoạt, có tiền chuyển dư")
              : r.outcome !== "MATCHED"
                ? tr(reviewReasons[r.reason] ?? "Cần kiểm tra giao dịch và hóa đơn")
                : ""}
          </p>
        </div>
      ),
    },
  ];
  return (
    <Section title={tr("Lịch sử chuyển tiền")} bodyClassName="space-y-4 p-4">
      <p className="text-sm text-ink-2">
        {tr(
          "Đối chiếu mã giao dịch và số tiền dư khi tiếp nhận yêu cầu hoàn tiền. Việc hoàn tiền thực hiện qua ngân hàng.",
        )}
      </p>
      <FilterBar
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setOffset(0);
        }}
        placeholder={tr("Mã SePay hoặc số hóa đơn")}
      >
        <FilterSelect
          label={tr("Môi trường")}
          value={mode}
          onChange={(v) => {
            setMode(v);
            setOffset(0);
          }}
          options={[
            { value: "live", label: tr("Thực tế") },
            { value: "test", label: tr("Thử nghiệm") },
          ]}
        />
        <FilterSelect
          label={tr("Kết quả")}
          value={outcome}
          onChange={(v) => {
            setOutcome(v);
            setOffset(0);
          }}
          options={[
            { value: "MATCHED", label: tr("Đã thanh toán") },
            { value: "REVIEW_REQUIRED", label: tr("Cần đối soát") },
            { value: "IGNORED", label: tr("Bỏ qua") },
          ]}
        />
      </FilterBar>
      <Callout>
        {tr(
          "Dấu — là thông tin chưa được lưu ở giao dịch cũ; đối chiếu sao kê ngân hàng khi cần. Tiền dư chưa thể hiện trạng thái đã hoàn.",
        )}
      </Callout>
      <DataTable
        rows={q.data?.items}
        columns={columns}
        rowKey={(r) => r.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        pageSize={null}
        rowNumberOffset={offset}
        minWidth={1000}
      />
      <div className="flex items-center justify-end gap-3 text-sm">
        <Button
          variant="outline"
          size="sm"
          disabled={offset === 0 || q.isFetching}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          {tr("Trang trước")}
        </Button>
        <span>
          {tr("Trang")} {offset / 50 + 1}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={q.data?.nextOffset == null || q.isFetching}
          onClick={() => setOffset(q.data!.nextOffset!)}
        >
          {tr("Trang sau")}
        </Button>
      </div>
    </Section>
  );
}
