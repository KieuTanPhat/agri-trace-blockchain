"use client";

import { useRef, useState } from "react";
import { request } from "@/lib/api-client";
import { errorMessage } from "@/lib/workspace";

const CATEGORIES: [string, string][] = [
  ["COUNTERFEIT", "Nghi hàng giả / tem giả"],
  ["WRONG_INFORMATION", "Thông tin trên trang không đúng"],
  ["QUALITY", "Chất lượng sản phẩm"],
  ["SAFETY", "An toàn thực phẩm"],
  ["EXPIRED", "Sản phẩm hết hạn"],
  ["OTHER", "Khác"],
];

/** Public report from a product page. The request id is kept across retries
 * so a resend never files the same report twice. Contact data is optional and
 * only sent with explicit consent; the producer does not see it. */
export function ConsumerReportForm({ traceToken }: { traceToken: string }) {
  const requestId = useRef<string>(crypto.randomUUID());
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category: "QUALITY", description: "", contactEmail: "", contactPhone: "", consent: false, truthful: false });
  const [state, setState] = useState<{ sending: boolean; error: string; done: boolean }>({ sending: false, error: "", done: false });
  if (state.done)
    return <p className="notice" role="status">Cảm ơn bạn. AgriTrace đã nhận phản ánh và sẽ chuyển doanh nghiệp liên quan xác minh khi cần.</p>;
  if (!open)
    return (
      <button type="button" className="button secondary" onClick={() => setOpen(true)}>
        Báo cáo vi phạm / phản ánh sản phẩm
      </button>
    );
  const contact = !!(form.contactEmail.trim() || form.contactPhone.trim());
  return (
    <form
      className="panel consumer-report"
      onSubmit={async (e) => {
        e.preventDefault();
        setState({ sending: true, error: "", done: false });
        try {
          await request(
            `/public/trace/${encodeURIComponent(traceToken)}/reports`,
            {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": requestId.current },
              body: JSON.stringify({
                requestId: requestId.current,
                category: form.category,
                description: form.description.trim(),
                contactEmail: form.consent && form.contactEmail.trim() ? form.contactEmail.trim() : undefined,
                contactPhone: form.consent && form.contactPhone.trim() ? form.contactPhone.replace(/[ .()-]/g, "") : undefined,
                consent: form.consent,
                truthful: true,
              }),
            },
            false,
          );
          setState({ sending: false, error: "", done: true });
        } catch (cause) {
          setState({ sending: false, error: errorMessage(cause), done: false });
        }
      }}
    >
      <h2>Phản ánh về sản phẩm</h2>
      <label className="field">Vấn đề
        <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {CATEGORIES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
      </label>
      <label className="field">Mô tả (nơi mua, thời điểm, hiện tượng)
        <textarea className="input" required minLength={10} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      <p className="muted">Thông tin liên hệ không bắt buộc. Chỉ AgriTrace dùng để hỏi thêm; doanh nghiệp không nhận được.</p>
      <label className="field">Email<input className="input" type="email" maxLength={255} value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></label>
      <label className="field">Số điện thoại<input className="input" maxLength={20} value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></label>
      {contact && (
        <label className="reg-check"><input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} /> <span>Tôi đồng ý để AgriTrace xử lý thông tin liên hệ cho mục đích xác minh phản ánh này.</span></label>
      )}
      <label className="reg-check"><input type="checkbox" required checked={form.truthful} onChange={(e) => setForm({ ...form, truthful: e.target.checked })} /> <span>Tôi xác nhận nội dung phản ánh là trung thực.</span></label>
      {state.error && <p className="notice error" role="alert">{state.error}</p>}
      <div className="actions">
        <button className="button" disabled={state.sending || (contact && !form.consent)}>{state.sending ? "Đang gửi…" : "Gửi phản ánh"}</button>
        <button type="button" className="button secondary" onClick={() => setOpen(false)}>Đóng</button>
      </div>
    </form>
  );
}
