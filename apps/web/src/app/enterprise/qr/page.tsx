"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import Link from "next/link";
import Image from "next/image";
import QRCode from "qrcode";
import { useEffect, useState, type FormEvent } from "react";
import {
  useWorkspaceData,
  useWorkspaceCommand,
  textValue,
  type Row,
} from "@/lib/workspace";
import {
  CommandState,
  EmptyState,
  LoadState,
  PageHeader,
} from "@/components/manage";

type Label = {
  id: string;
  template: "COMPACT" | "STANDARD";
  copies: number;
  reprint: boolean;
  sequence: number;
  printedAt: string;
  lotCode: string;
  productName: string;
  producerName: string;
  harvestTime: string;
  expiryDate: string | null;
  traceToken: string;
};
const day = (value: unknown) =>
  value
    ? new Date(String(value)).toLocaleDateString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
      })
    : "—";

function useQr(token: string, width: number) {
  const [png, setPng] = useState("");
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(`${window.location.origin}/trace/${token}`, {
      width,
      margin: 1,
      errorCorrectionLevel: "M",
    }).then((data) => {
      if (active) setPng(data);
    });
    return () => {
      active = false;
    };
  }, [token, width]);
  return png;
}

function QrCard({ lot, onPrint }: { lot: Row; onPrint(): void }) {
  const png = useQr(String(lot.traceToken), 360);
  const path = `/trace/${lot.traceToken}`;
  return (
    <article className="workspace-qr-card">
      <h2>{textValue(lot.productName)}</h2>
      <span className="workspace-badge">{textValue(lot.lotCode)}</span>
      {png && (
        <Image
          unoptimized
          src={png}
          alt={`Mã QR truy xuất ${lot.lotCode}`}
          width={180}
          height={180}
        />
      )}
      <p className="muted">
        {textValue(lot.initialQuantity)} {textValue(lot.unit)} · lô nguồn · HSD{" "}
        {day(lot.expiryDate)}
      </p>
      {lot.blocked ? (
        <p className="notice error">
          Lô đang bị chặn (thu hồi, hết hạn hoặc cách ly); không phát hành tem
          mới.
        </p>
      ) : null}
      <div className="workspace-actions">
        <Button
          type="button"
          className="button secondary"
          disabled={!!lot.blocked}
          onClick={onPrint}
        >
          In tem
        </Button>
        <a className="text-link" download={`QR-${lot.lotCode}.png`} href={png}>
          Tải PNG
        </a>
        <Link className="text-link" href={path}>
          Mở truy xuất
        </Link>
      </div>
    </article>
  );
}

/** Printed label: identifies the source lot only. It is not an anti-counterfeit serial. */
function PrintSheet({ label }: { label: Label }) {
  const png = useQr(label.traceToken, label.template === "COMPACT" ? 240 : 360);
  return (
    <div className="qr-print-sheet" aria-hidden="true">
      {Array.from({ length: label.copies }, (_, i) => (
        <PrintedLabel key={i} label={label} png={png} />
      ))}
    </div>
  );
}
function PrintedLabel({ label, png }: { label: Label; png: string }) {
  const compact = label.template === "COMPACT";
  return (
    <div className={`qr-label qr-label--${compact ? "compact" : "standard"}`}>
      {png && (
        <Image
          unoptimized
          src={png}
          alt=""
          width={compact ? 96 : 140}
          height={compact ? 96 : 140}
        />
      )}
      <div>
        <strong>{label.productName}</strong>
        <span>Lô nguồn: {label.lotCode}</span>
        {!compact && <span>Đơn vị sản xuất: {label.producerName}</span>}
        <span>Thu hoạch: {day(label.harvestTime)}</span>
        {label.expiryDate && <span>Hạn dùng: {day(label.expiryDate)}</span>}
        <small>Tem truy xuất theo lô · quét để xem hành trình</small>
      </div>
    </div>
  );
}

export default function QrPage() {
  const state = useWorkspaceData<{ lots: Row[] }>("/distribution/qr");
  const cmd = useWorkspaceCommand();
  const [selected, setSelected] = useState<Row | null>(null);
  const [labels, setLabels] = useState<Label | null>(null);
  const history = useWorkspaceData<{ items: Row[] }>(
    selected ? `/distribution/qr/prints/${selected.lotId}` : null,
  );
  const reprint = !!history.data?.items.length;
  useEffect(() => {
    if (!labels) return;
    // Wait for QR images to render before opening the print dialog.
    const timer = window.setTimeout(() => window.print(), 600);
    return () => window.clearTimeout(timer);
  }, [labels]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const form = new FormData(e.currentTarget);
    const reason = String(form.get("reason") ?? "").trim();
    const result = await cmd.run<{ record: Label }>("/distribution/qr/prints", {
      lotId: selected.lotId,
      template: String(form.get("template")),
      copies: Number(form.get("copies")),
      ...(reason ? { reason } : {}),
    });
    if (result) {
      setLabels(result.record);
      history.reload();
    }
  }
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        back="/enterprise"
        backLabel="Doanh nghiệp"
        title="Tem truy xuất QR"
        description="Mỗi mã mở hành trình của đúng một lô nguồn. Mã không thay đổi khi lô được phân phối từng phần; số tem in không chứng minh số lượng hàng."
      />
      <LoadState {...state} />
      {selected && (
        <form className="panel workspace-form qr-print-form" onSubmit={submit}>
          <h2>In tem · {textValue(selected.lotCode)}</h2>
          <CommandState command={cmd} />
          <fieldset
            disabled={cmd.pending || cmd.frozen}
            className="enterprise-fields"
          >
            <label>
              Mẫu tem
              <NativeSelect className="input" name="template" defaultValue="STANDARD">
                <option value="STANDARD">
                  Tiêu chuẩn (có đơn vị sản xuất)
                </option>
                <option value="COMPACT">Nhỏ gọn</option>
              </NativeSelect>
            </label>
            <label>
              Số tem
              <Input
                className="input"
                name="copies"
                type="number"
                min={1}
                max={500}
                defaultValue={1}
                required
              />
            </label>
            {reprint && (
              <label>
                Lý do in lại (lô đã được in {history.data?.items.length} lần)
                <Textarea
                  className="input"
                  name="reason"
                  required
                  minLength={10}
                  maxLength={1000}
                />
              </label>
            )}
          </fieldset>
          <div className="workspace-actions">
            <Button
              className="button"
              disabled={cmd.pending || history.loading}
            >
              {"Ghi lịch sử và in"}
            </Button>
            <Button
              type="button"
              className="text-link"
              disabled={cmd.frozen}
              onClick={() => {
                setSelected(null);
                setLabels(null);
              }}
            >
              Đóng
            </Button>
          </div>
          {!!history.data?.items.length && (
            <details>
              <summary>Lịch sử in của tổ chức</summary>
              <ul>
                {history.data.items.map((h) => (
                  <li key={String(h.id)}>
                    {new Date(String(h.createdAt)).toLocaleString("vi-VN")} ·{" "}
                    {textValue(h.actorName)} · {textValue(h.copies)} tem ·{" "}
                    {h.template === "COMPACT" ? "nhỏ gọn" : "tiêu chuẩn"}
                    {h.reason ? ` · ${textValue(h.reason)}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {labels && (
            <p className="notice" role="status">
              Đã ghi lần in thứ {labels.sequence}. Nếu hộp thoại in không mở,{" "}
              <Button
                type="button"
                className="text-link"
                onClick={() => window.print()}
              >
                mở lại hộp thoại in
              </Button>
              .
            </p>
          )}
        </form>
      )}
      <div className="workspace-qr-grid">
        {state.data?.lots
          .filter((l) => l.traceToken)
          .map((l) => (
            <QrCard
              key={String(l.lotId)}
              lot={l}
              onPrint={() => {
                setLabels(null);
                setSelected(l);
              }}
            />
          ))}
      </div>
      {state.data && !state.data.lots.length && (
        <EmptyState
          title="Chưa có lô để phát hành tem"
          description="Mã truy xuất được cấp sau khi ghi nhận thu hoạch thành công."
        />
      )}
      {labels && <PrintSheet label={labels} />}
    </div>
  );
}
