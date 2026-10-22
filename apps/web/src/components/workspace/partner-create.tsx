"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { labels, useWorkspaceCommand } from "@/lib/workspace";
import { CommandState, InfoDialog, PageHeader } from "@/components/manage";
import {
  EvidenceInputs,
  checkEvidenceInputs,
  createdId,
  uploadEvidenceFiles,
} from "./evidence-panel";
import { PartnerMatches, usePartnerSearch, type PartnerMatch } from "./partner-lookup";

const KINDS = ["FARM", "TRANSPORTER", "DISTRIBUTOR", "RETAILER"];
const PHONE = /^(?:0[35789]\d{8}|02\d{9}|\+84(?:[35789]\d{8}|2\d{9}))$/;
const TAX = /^(?:\d{10}(?:-?\d{3})?|\d{12})$/;

/** Link a partner: invite an AgriTrace enterprise, or record one outside it. */
export function PartnerCreate() {
  const router = useRouter();
  const command = useWorkspaceCommand();
  const form = useRef<HTMLFormElement>(null);
  const [query, setQuery] = useState("");
  const search = usePartnerSearch(query);
  const params = useSearchParams();
  const [mode, setMode] = useState<"search" | "invite" | "external">(
    params.get("mode") === "external" ? "external" : "search",
  );
  const [picked, setPicked] = useState<PartnerMatch | null>(null);
  const [note, setNote] = useState("");
  const [ext, setExt] = useState({
    name: "",
    kind: "FARM",
    taxCode: "",
    address: "",
    phone: "",
    email: "",
    representative: "",
    note: "",
  });
  const taxMatches = usePartnerSearch(mode === "external" ? ext.taxCode : "");
  const nameMatches = usePartnerSearch(mode === "external" ? ext.name : "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState<{
    path: string;
    payload: Record<string, unknown>;
    rows: [string, string][];
  } | null>(null);
  const [done, setDone] = useState<{ rows: [string, string][]; note: string } | null>(null);

  const error = (name: string) =>
    errors[name] ? (
      <span className="field-error" role="alert" id={`partner-${name}-error`}>
        {errors[name]}
      </span>
    ) : null;
  const input = (
    name: keyof typeof ext,
    label: string,
    type = "text",
    extra?: React.ReactNode,
  ) => (
    <label>
      {label} <span aria-hidden="true">*</span>
      <Input
        className="input"
        type={type}
        value={ext[name]}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `partner-${name}-error` : undefined}
        onChange={(e) => {
          setExt({ ...ext, [name]: e.target.value });
          setErrors({ ...errors, [name]: "" });
        }}
      />
      {error(name)}
      {extra}
    </label>
  );

  function pick(item: PartnerMatch) {
    setPicked(item);
    setMode("invite");
  }
  function submitInvite(e: FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setReview({
      path: "/enterprise-workspace/partners",
      payload: {
        businessId: picked.agriTraceCode ?? picked.businessId,
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      rows: [
        ["Doanh nghiệp", picked.name],
        ["Mã số thuế", picked.taxCode ?? "—"],
        ["Mã AgriTrace", picked.agriTraceCode ?? "—"],
        ["Loại hình", labels[picked.kind] ?? picked.kind],
        ["Lời nhắn", note.trim() || "—"],
      ],
    });
  }
  function submitExternal(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (ext.name.trim().length < 2) next.name = "Nhập tên doanh nghiệp.";
    if (!TAX.test(ext.taxCode.trim())) next.taxCode = "Mã số thuế cần 10, 12 hoặc 13 số.";
    if (ext.address.trim().length < 5) next.address = "Nhập địa chỉ từ 5 ký tự.";
    if (!PHONE.test(ext.phone.replace(/[ .()-]/g, "")))
      next.phone = "Nhập số điện thoại Việt Nam hợp lệ.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ext.email.trim()))
      next.email = "Nhập email hợp lệ.";
    if (ext.representative.trim().length < 2)
      next.representative = "Nhập người đại diện.";
    if (ext.note.trim().length < 5) next.note = "Ghi chú hợp tác cần từ 5 ký tự.";
    if (taxMatches.items.some((m) => m.taxCode === ext.taxCode.trim()))
      next.taxCode = "Mã số thuế đã có trong danh sách bên dưới; chọn doanh nghiệp đó thay vì tạo mới.";
    const files = form.current ? checkEvidenceInputs(form.current) : "";
    if (files) next.evidence = files;
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    setReview({
      path: "/enterprise-workspace/partners/external",
      payload: {
        businessId: ext.taxCode.trim().replace(/-/g, ""),
        name: ext.name.trim(),
        kind: ext.kind,
        address: ext.address.trim(),
        phone: ext.phone.replace(/[ .()-]/g, ""),
        email: ext.email.trim(),
        taxCode: ext.taxCode.trim(),
        representative: ext.representative.trim(),
        note: ext.note.trim(),
      },
      rows: [
        ["Doanh nghiệp", ext.name.trim()],
        ["Loại hình", labels[ext.kind] ?? ext.kind],
        ["Mã số thuế", ext.taxCode.trim()],
        ["Người đại diện", ext.representative.trim()],
        ["Số điện thoại", ext.phone.trim()],
        ["Email", ext.email.trim()],
        ["Địa chỉ", ext.address.trim()],
        ["Ghi chú hợp tác", ext.note.trim()],
      ],
    });
  }
  async function confirm() {
    if (!review) return;
    const sent = review;
    const result = await command.run(sent.path, sent.payload, "POST", {
      confirmed: true,
    });
    setReview(null);
    if (!result) return;
    let uploadNote = "";
    const id = createdId(result);
    if (sent.path.endsWith("/external") && id && form.current) {
      const failed = await uploadEvidenceFiles(form.current, "EXTERNAL_PARTNER", id);
      if (failed.length)
        uploadNote = `Chưa tải được: ${failed.join(", ")}. Bổ sung trong trang hồ sơ đối tác.`;
    }
    setDone({ rows: sent.rows, note: uploadNote });
  }

  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        title="Thêm doanh nghiệp liên kết"
        description="Tìm doanh nghiệp theo mã số thuế, tên hoặc mã AgriTrace. Doanh nghiệp trên AgriTrace nhận lời mời; doanh nghiệp ngoài hệ thống được ghi nhận để tham chiếu."
        back="/enterprise/partners"
        backLabel="Quay lại danh sách"
      />
      <CommandState command={command} />
      {mode === "search" && (
        <section className="panel partner-search">
          <label>
            Tìm doanh nghiệp
            <Input
              className="input"
              autoFocus
              placeholder="Nhập MST, tên doanh nghiệp hoặc mã AGT-…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <PartnerMatches {...search} onPick={pick} pickLabel="Mời liên kết" />
          <div className="partner-search-foot">
            <span className="muted">Không tìm thấy doanh nghiệp cần liên kết?</span>
            <Button
              type="button"
              className="button secondary"
              onClick={() => {
                const digits = query.trim().replace(/-/g, "");
                setExt({
                  ...ext,
                  taxCode: /^\d+$/.test(digits) ? query.trim() : ext.taxCode,
                  name: /^\d+$/.test(digits) ? ext.name : query.trim(),
                });
                setMode("external");
              }}
            >
              Ghi nhận doanh nghiệp ngoài hệ thống
            </Button>
          </div>
        </section>
      )}
      {mode === "invite" && picked && (
        <form className="panel workspace-form" onSubmit={submitInvite}>
          <div className="partner-picked">
            <div>
              <strong>{picked.name}</strong>
              <small>
                MST {picked.taxCode ?? "—"} · {picked.agriTraceCode} ·{" "}
                {labels[picked.kind] ?? picked.kind}
              </small>
            </div>
            <Button type="button" className="text-link" onClick={() => setMode("search")}>
              Chọn doanh nghiệp khác
            </Button>
          </div>
          <label>
            Lời nhắn (không bắt buộc)
            <Textarea
              className="input"
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <p className="notice">
            Doanh nghiệp được mời cần chấp nhận lời mời. Liên kết không tự cấp quyền vào chuỗi.
          </p>
          <div className="form-actions">
            <Button className="button" disabled={command.pending}>
              Gửi lời mời
            </Button>
          </div>
        </form>
      )}
      {mode === "external" && (
        <form
          ref={form}
          className="panel workspace-form partner-external"
          onSubmit={submitExternal}
          noValidate
        >
          <div className="partner-picked">
            <strong>Doanh nghiệp ngoài hệ thống</strong>
            <Button type="button" className="text-link" onClick={() => setMode("search")}>
              Quay lại tìm kiếm
            </Button>
          </div>
          <fieldset className="enterprise-fields" disabled={command.pending}>
            {input(
              "name",
              "Tên doanh nghiệp",
              "text",
              <PartnerMatches {...nameMatches} onPick={pick} pickLabel="Mời doanh nghiệp này" />,
            )}
            <label>
              Loại hình
              <NativeSelect
                className="input"
                value={ext.kind}
                onChange={(e) => setExt({ ...ext, kind: e.target.value })}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {labels[k] ?? k}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {input(
              "taxCode",
              "Mã số thuế",
              "text",
              <PartnerMatches {...taxMatches} onPick={pick} pickLabel="Mời doanh nghiệp này" />,
            )}
            {input("representative", "Người đại diện")}
            {input("phone", "Số điện thoại", "tel")}
            {input("email", "Email", "email")}
            {input("address", "Địa chỉ doanh nghiệp")}
            {input("note", "Ghi chú hợp tác")}
          </fieldset>
          <EvidenceInputs
            entityType="EXTERNAL_PARTNER"
            title="Hình ảnh bằng chứng hợp tác và giấy tờ"
            disabled={command.pending}
          />
          {error("evidence")}
          <p className="notice">
            Hồ sơ ngoài hệ thống chỉ để tham chiếu; không có quyền nhận hàng, ký hoặc xem dữ liệu chuỗi.
          </p>
          <div className="form-actions">
            <Button className="button" disabled={command.pending}>
              Lưu doanh nghiệp liên kết
            </Button>
          </div>
        </form>
      )}
      <InfoDialog
        open={!!review}
        title={
          review?.path.endsWith("/external")
            ? "Xác nhận ghi nhận doanh nghiệp liên kết"
            : "Xác nhận gửi lời mời liên kết"
        }
        rows={review?.rows ?? []}
        onClose={() => setReview(null)}
        actions={
          <>
            <Button
              type="button"
              className="button secondary"
              disabled={command.pending}
              onClick={() => setReview(null)}
            >
              Quay lại sửa
            </Button>
            <Button
              type="button"
              className="button"
              disabled={command.pending}
              onClick={() => void confirm()}
            >
              {command.pending ? "Đang lưu…" : "Xác nhận"}
            </Button>
          </>
        }
      />
      <InfoDialog
        open={!!done}
        title="Đã lưu doanh nghiệp liên kết"
        description={done?.note || undefined}
        rows={done?.rows ?? []}
        onClose={() => router.push("/enterprise/partners")}
        actions={
          <Button
            type="button"
            className="button"
            onClick={() => router.push("/enterprise/partners")}
          >
            Về danh sách đối tác
          </Button>
        }
      />
    </div>
  );
}
