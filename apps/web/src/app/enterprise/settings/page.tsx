"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, Section } from "@/components/manage";
import {
  DEFAULT_TYPOGRAPHY,
  FONTS,
  PRESETS,
  TEXT_ROLES,
  WEIGHTS,
  fontById,
  loadFonts,
  loadTypography,
  saveTypography,
  typographyCss,
  type RoleStyle,
  type Typography,
} from "@/lib/typography";

const groups = [...new Set(FONTS.map((font) => font.group))];

function FontSelect({
  value,
  onChange,
  inheritLabel,
  label,
}: {
  value?: string;
  onChange(value?: string): void;
  inheritLabel: string;
  label: string;
}) {
  return (
    <select
      className="select"
      aria-label={label}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value || undefined)}
    >
      <option value="">{inheritLabel}</option>
      {groups.map((group) => (
        <optgroup key={group} label={group}>
          {FONTS.filter((font) => font.group === group).map((font) => (
            <option key={font.id} value={font.id}>
              {font.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Same miniature page in both previews; `.ts-*` classes receive the styles. */
function Sample({ id }: { id: string }) {
  return (
    <div className="typo-preview" id={id}>
      <div className="ts-topbar-row">
        <span className="ts-topbar">Không gian doanh nghiệp / Quản trị / Thành viên</span>
      </div>
      <div className="ts-layout">
        <div className="ts-side">
          <span className="ts-nav ts-nav-title">QUẢN TRỊ</span>
          <span className="ts-nav ts-nav-active">Quản lý thành viên</span>
          <span className="ts-nav">Quản lý phân quyền</span>
          <span className="ts-nav">Cơ sở</span>
        </div>
        <div className="ts-main">
          <h1 className="ts-h1">Thành viên doanh nghiệp</h1>
          <p className="ts-muted">Cấp 1 quản trị doanh nghiệp. Cấp 2 quản lý theo ủy quyền.</p>
          <div className="ts-metrics">
            <div className="manage-metric">
              <span>Thành viên</span>
              <strong className="ts-metric">3</strong>
            </div>
            <div className="manage-metric">
              <span>Cơ sở</span>
              <strong className="ts-metric">12</strong>
            </div>
          </div>
          <h2 className="ts-h2">Thông tin liên hệ</h2>
          <p className="ts-body">
            Lô rau cải ngọt BM-0425 thu hoạch ngày 18/10, đã chuyển tới kho lạnh Bình Minh.
          </p>
          <label className="ts-label">
            Số điện thoại liên hệ
            <input className="input ts-input" value="0901 234 567" readOnly tabIndex={-1} />
          </label>
          <table className="manage-table">
            <thead>
              <tr>
                <th className="ts-th">Thành viên</th>
                <th className="ts-th">Cấp</th>
                <th className="ts-th">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="ts-td">Nguyễn Văn An</td>
                <td className="ts-td">
                  <span className="workspace-badge ts-badge">Cấp 2</span>
                </td>
                <td className="ts-td">
                  <span className="text-link ts-link">Quyền &amp; trạng thái</span>
                </td>
              </tr>
            </tbody>
          </table>
          <span className="button ts-button">Lưu thay đổi</span>
        </div>
      </div>
    </div>
  );
}

function sameStyle(a?: RoleStyle, b?: RoleStyle) {
  return (a?.font ?? "") === (b?.font ?? "") && (a?.size ?? 0) === (b?.size ?? 0) && (a?.weight ?? 0) === (b?.weight ?? 0);
}

function clean(value: Typography): Typography {
  const roles = Object.fromEntries(
    Object.entries(value.roles).filter(([, style]) => style.font || style.size || style.weight),
  );
  return { font: value.font, roles };
}

export default function SettingsPage() {
  const [saved, setSaved] = useState<Typography>(DEFAULT_TYPOGRAPHY);
  const [draft, setDraft] = useState<Typography>(DEFAULT_TYPOGRAPHY);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const value = loadTypography();
    setSaved(value);
    setDraft(value);
  }, []);
  useEffect(() => {
    loadFonts(draft);
    loadFonts(saved);
  }, [draft, saved]);

  const changed = useMemo(() => {
    const names: string[] = [];
    if ((draft.font ?? "") !== (saved.font ?? "")) names.push("Font toàn hệ thống");
    for (const role of TEXT_ROLES)
      if (!sameStyle(draft.roles[role.id], saved.roles[role.id])) names.push(role.label);
    return names;
  }, [draft, saved]);

  const setRole = (id: string, patch: RoleStyle) =>
    setDraft((current) => ({
      ...current,
      roles: { ...current.roles, [id]: { ...current.roles[id], ...patch } },
    }));

  const apply = () => {
    const value = clean(draft);
    saveTypography(value);
    setSaved(value);
    setDraft(value);
    setMessage("Đã áp dụng kiểu chữ cho toàn bộ không gian làm việc trên trình duyệt này.");
  };

  const previewCss = `${typographyCss(saved, "#typo-current")}\n${typographyCss(draft, "#typo-draft")}`;

  return (
    <div className="manage-console typo-settings">
      <PageHeader
        title="Cài đặt"
        description="Tùy chỉnh font, cỡ chữ và độ đậm cho từng loại nội dung. Xem trước bên dưới trước khi áp dụng."
      />
      <style>{previewCss}</style>

      <Section
        title="Kiểu chữ hiển thị"
        help="Để trống một ô là giữ theo thiết kế gốc. Thiết lập được lưu trên trình duyệt này; font Google chỉ tải khi bạn chọn."
      >
        <div className="typo-presets" role="group" aria-label="Mẫu nhanh">
          <span>Mẫu nhanh:</span>
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="button secondary small"
              onClick={() => {
                setDraft(preset.value);
                setMessage("");
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <label className="typo-global">
          <span>Font toàn hệ thống</span>
          <FontSelect
            label="Font toàn hệ thống"
            value={draft.font}
            inheritLabel="Inter (thiết kế gốc)"
            onChange={(font) => setDraft((current) => ({ ...current, font }))}
          />
          <small style={{ fontFamily: fontById(draft.font)?.family }}>
            Nông sản Việt — Truy xuất nguồn gốc rõ ràng 0123456789
          </small>
        </label>
        <div className="manage-table-scroll">
          <table className="manage-table typo-table">
            <thead>
              <tr>
                <th>Loại nội dung</th>
                <th>Font</th>
                <th>Cỡ chữ (px)</th>
                <th>Độ đậm</th>
                <th>Xem nhanh</th>
                <th aria-label="Đặt lại" />
              </tr>
            </thead>
            <tbody>
              {TEXT_ROLES.map((role) => {
                const style = draft.roles[role.id] ?? {};
                const font = fontById(style.font) ?? fontById(draft.font);
                return (
                  <tr key={role.id} data-changed={!sameStyle(style, saved.roles[role.id]) || undefined}>
                    <td data-label="Loại nội dung">
                      <strong>{role.label}</strong>
                      <small>{role.hint}</small>
                    </td>
                    <td data-label="Font">
                      <FontSelect
                        label={`Font cho ${role.label}`}
                        value={style.font}
                        inheritLabel="Theo font toàn hệ thống"
                        onChange={(value) => setRole(role.id, { font: value })}
                      />
                    </td>
                    <td data-label="Cỡ chữ (px)">
                      <input
                        className="input typo-size"
                        type="number"
                        min={10}
                        max={48}
                        step={1}
                        aria-label={`Cỡ chữ cho ${role.label}`}
                        placeholder={`${role.baseSize}`}
                        value={style.size ?? ""}
                        onChange={(event) =>
                          setRole(role.id, {
                            size: event.target.value ? Math.min(48, Math.max(10, Number(event.target.value))) : undefined,
                          })
                        }
                      />
                    </td>
                    <td data-label="Độ đậm">
                      <select
                        className="select"
                        aria-label={`Độ đậm cho ${role.label}`}
                        value={style.weight ?? ""}
                        onChange={(event) =>
                          setRole(role.id, { weight: event.target.value ? Number(event.target.value) : undefined })
                        }
                      >
                        <option value="">Theo thiết kế</option>
                        {WEIGHTS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Xem nhanh">
                      <span
                        className="typo-swatch"
                        style={{
                          fontFamily: font?.family,
                          fontSize: style.size ? `${style.size}px` : undefined,
                          fontWeight: style.weight,
                        }}
                      >
                        Aa Ắ ệ 123
                      </span>
                    </td>
                    <td>
                      {(style.font || style.size || style.weight) && (
                        <button
                          type="button"
                          className="text-link"
                          onClick={() =>
                            setDraft((current) => {
                              const roles = { ...current.roles };
                              delete roles[role.id];
                              return { ...current, roles };
                            })
                          }
                        >
                          Đặt lại
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Xem trước"
        help={
          changed.length
            ? `Đã đổi: ${changed.join(", ")}.`
            : "Chưa có thay đổi so với thiết lập đang dùng."
        }
      >
        <div className="typo-compare">
          <figure>
            <figcaption>Hiện tại</figcaption>
            <Sample id="typo-current" />
          </figure>
          <figure data-changed={changed.length > 0 || undefined}>
            <figcaption>Sau khi đổi</figcaption>
            <Sample id="typo-draft" />
          </figure>
        </div>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <div className="typo-actions">
          <button type="button" className="button" disabled={!changed.length} onClick={apply}>
            Áp dụng
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={!changed.length}
            onClick={() => {
              setDraft(saved);
              setMessage("");
            }}
          >
            Hủy thay đổi
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setDraft(DEFAULT_TYPOGRAPHY);
              setMessage("Đã chọn thiết kế gốc. Bấm Áp dụng để dùng lại.");
            }}
          >
            Khôi phục thiết kế gốc
          </button>
        </div>
      </Section>

      <Section title="Tài khoản và hồ sơ">
        <ul className="typo-links">
          <li><Link className="text-link" href="/account/password">Đổi mật khẩu</Link></li>
          <li><Link className="text-link" href="/account/privacy">Quyền dữ liệu cá nhân</Link></li>
          <li><Link className="text-link" href="/enterprise/profile">Hồ sơ doanh nghiệp</Link></li>
        </ul>
      </Section>
    </div>
  );
}
