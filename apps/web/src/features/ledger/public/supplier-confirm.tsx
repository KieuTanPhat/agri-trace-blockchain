"use client";
import { useEffect, useState } from "react";
import type { components } from "@/lib/generated/api";
import { request } from "@/lib/api-client";
import { newLedgerCommandKey } from "@/lib/ledger/command-context";
import { fmtDateTime, fmtNumber } from "@/lib/ledger/format";
import { t } from "@/lib/ledger/i18n";
import { Callout, Field, Fields, PageBody, PageHeader, Section } from "@/components/ledger/kit/page";
import { Button } from "@/components/ledger/ui/button";
import { Input } from "@/components/ledger/ui/input";
import { Label } from "@/components/ledger/ui/label";

type View = components["schemas"]["PublicSupplierConfirmationView"];
const STATUS: Record<string, string> = { PENDING: "Chờ xác nhận", CONFIRMED: "Đã xác nhận", DECLINED: "Đã báo không đúng" };

/** Account-free page behind the QR on a weighing slip or purchase list: the
 * supplier confirms or declines the buyer's receipt once (ADR-005). */
export default function SupplierConfirm({ token }: { token: string }) {
  const path = `/public/supplier-confirmations/${encodeURIComponent(token)}`;
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => newLedgerCommandKey());
  useEffect(() => {
    request<View>(path, undefined, false).then(setView, () => setError(t("Mã xác nhận không hợp lệ hoặc đã hết hạn.")));
  }, [path]);
  async function respond(decision: "CONFIRMED" | "DECLINED") {
    if (name.trim().length < 2) return setError(t("Nhập họ tên người xác nhận."));
    setBusy(true);
    setError(null);
    try {
      setView(await request<View>(path, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ decision, responderName: name.trim() }) }, false));
    } catch {
      setError(t("Không ghi được câu trả lời; thử lại."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader title={t("Xác nhận giao nguyên liệu")} description={t("Bên mua đề nghị bạn xác nhận phiếu nhập dưới đây. Không cần tài khoản.")} />
      <PageBody>
        {error && <Callout tone="warn">{error}</Callout>}
        {view && (
          <Section title={t("Phiếu nhập")} bodyClassName="flex flex-col gap-4 p-4">
            <Fields cols={2}>
              <Field label={t("Bên mua")}>{view.buyerName}</Field>
              <Field label={t("Nhà cung cấp")}>{view.supplierName}</Field>
              <Field label={t("Nguyên liệu")}>{view.materialName}</Field>
              <Field label={t("Số lượng")}>{fmtNumber(view.quantity)} {view.unit}</Field>
              <Field label={t("Ngày nhận")}>{fmtDateTime(view.receivedAt)}</Field>
              <Field label={t("Số chứng từ")}>{view.documentNo ?? "—"}</Field>
              <Field label={t("Trạng thái")}>{t(STATUS[view.status] ?? view.status)}</Field>
            </Fields>
            {view.status === "PENDING" && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="responder">{t("Họ tên người xác nhận")}</Label>
                  <Input id="responder" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={() => respond("CONFIRMED")}>{t("Đúng, tôi đã giao")}</Button>
                  <Button disabled={busy} variant="outline" onClick={() => respond("DECLINED")}>{t("Không đúng")}</Button>
                </div>
              </div>
            )}
          </Section>
        )}
      </PageBody>
    </>
  );
}
