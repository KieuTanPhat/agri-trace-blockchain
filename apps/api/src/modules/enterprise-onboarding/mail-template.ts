const escape = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
/** Table layout and inline CSS work without remote fonts, images or tracking. */
export function enterpriseMailHtml(input: {
  subject: string;
  text: string;
  otp?: string;
  /** Temporary sign-in password; shown once, never logged. */
  password?: string;
  action?: { label: string; url: string };
}) {
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(input.subject)}</title></head><body style="margin:0;background:#f5f6f7;color:#25312b;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#fff;border:1px solid #e5e9e6;border-radius:8px"><tr><td style="padding:30px 28px 16px"><img src="cid:agritrace-logo" width="190" height="56" alt="AgriTrace — Truy xuất nguồn gốc" style="display:block;border:0;max-width:100%"></td></tr><tr><td style="padding:8px 28px 30px"><h1 style="font-size:21px;font-weight:600;line-height:1.5;margin:8px 0 20px;color:#183d2c">${escape(input.subject.replace(/^AgriTrace — /, ''))}</h1><p style="font-size:14px;line-height:1.8;margin:0 0 20px">Xin chào,</p>${input.text
    .split('\n')
    .map(
      (p) =>
        `<p style="font-size:14px;line-height:1.8;margin:0 0 14px;overflow-wrap:anywhere">${escape(p)}</p>`,
    )
    .join(
      '',
    )}${input.otp ? `<div style="padding:22px 12px;margin:24px 0;border:1px solid #dce9df;background:#f5faf6;text-align:center"><span style="font-size:30px;line-height:1.5;font-weight:700;letter-spacing:8px;color:#183d2c">${escape(input.otp)}</span><p style="font-size:12px;color:#53645b;margin:12px 0 0">Có hiệu lực 10 phút · Tối đa 5 lần nhập sai</p></div><p style="font-size:13px;line-height:1.8;color:#53645b">Nhập mã ở trang đăng ký đang mở. AgriTrace không yêu cầu bạn gửi mật khẩu hoặc mã OTP cho nhân viên hỗ trợ. Nếu không thực hiện đăng ký, bạn có thể bỏ qua thư này.</p>` : ''}${input.password ? `<div style="padding:18px 12px;margin:24px 0;border:1px solid #dce9df;background:#f5faf6;text-align:center"><p style="font-size:12px;color:#53645b;margin:0 0 8px">Mật khẩu tạm</p><span style="font-size:22px;line-height:1.5;font-weight:700;letter-spacing:2px;color:#183d2c;font-family:Consolas,Menlo,monospace">${escape(input.password)}</span></div><p style="font-size:13px;line-height:1.8;color:#53645b">Đổi mật khẩu ngay ở lần đăng nhập đầu tiên. AgriTrace không yêu cầu bạn gửi mật khẩu cho nhân viên hỗ trợ.</p>` : ''}${input.action && /^https?:\/\//.test(input.action.url) ? `<p style="margin:24px 0"><a href="${escape(input.action.url)}" style="display:inline-block;padding:12px 18px;border-radius:5px;background:#183d2c;color:#fff;text-decoration:none;font-size:14px;font-weight:600">${escape(input.action.label)}</a></p>` : ''}<p style="font-size:13px;line-height:1.8;margin:26px 0 0">Trân trọng,<br><strong>Đội ngũ AgriTrace</strong></p></td></tr><tr><td style="padding:18px 28px;border-top:1px solid #edf0ee;font-size:11px;color:#6b7770;line-height:1.7">AgriTrace · Thông báo giao dịch theo yêu cầu của bạn.<br>Truy xuất nguồn gốc nông sản Việt Nam.</td></tr></table></td></tr></table></body></html>`;
}
export function contractAttachment(text: string) {
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Hợp đồng AgriTrace — bản mô phỏng</title><body><pre style="white-space:pre-wrap;font:16px/1.7 sans-serif">${escape(text)}</pre></body></html>`;
}
