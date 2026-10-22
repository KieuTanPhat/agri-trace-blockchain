"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
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
import {
  DEFAULT_APPEARANCE,
  THEMES,
  appearanceCss,
  loadAppearance,
  normalizeAppearance,
  saveAppearance,
  type Appearance,
} from "@/lib/appearance";

type Settings = { typography: Typography; appearance: Appearance };
const defaults: Settings = {
  typography: DEFAULT_TYPOGRAPHY,
  appearance: DEFAULT_APPEARANCE,
};
const tabs = [
  ["appearance", "Giao diện"],
  ["system", "Thông tin hệ thống"],
  ["account", "Tài khoản & hồ sơ"],
  ["data", "Quản lý dữ liệu"],
  ["advanced", "Nâng cao"],
] as const;
type Tab = (typeof tabs)[number][0];
const fontGroups = [...new Set(FONTS.map((font) => font.group))];

function Card({
  title,
  help,
  children,
}: {
  title: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-card">
      <header>
        <h2>{title}</h2>
        {help && <p>{help}</p>}
      </header>
      {children}
    </section>
  );
}
function FontSelect({
  value,
  onChange,
  label,
  inherit = "Hệ thống (gợi ý)",
}: {
  value?: string;
  onChange(value?: string): void;
  label: string;
  inherit?: string;
}) {
  return (
    <NativeSelect
      className="select"
      aria-label={label}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{inherit}</option>
      {fontGroups.map((group) => (
        <optgroup key={group} label={group}>
          {FONTS.filter((font) => font.group === group).map((font) => (
            <option key={font.id} value={font.id}>
              {font.label}
            </option>
          ))}
        </optgroup>
      ))}
    </NativeSelect>
  );
}
function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange(value: T): void;
}) {
  return (
    <div className="settings-choices" role="group" aria-label={label}>
      {options.map(([id, text]) => (
        <Button
          type="button"
          key={id}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          {text}
        </Button>
      ))}
    </div>
  );
}
function Sample() {
  return (
    <div
      className="typo-preview settings-preview"
      id="settings-preview"
      aria-label="Xem trước giao diện"
    >
      <div className="ts-layout">
        <div className="ts-side">
          <span className="ts-nav ts-nav-title">MENU</span>
          <span className="ts-nav ts-nav-active">Trang chủ</span>
          <span className="ts-nav">Quản lý sản phẩm</span>
          <span className="ts-nav">Quản lý vụ trồng</span>
          <span className="ts-nav">Báo cáo</span>
        </div>
        <div className="ts-main">
          <h3 className="ts-h1">Tiêu đề trang</h3>
          <Table className="settings-sample-table">
            <TableHeader>
              <TableRow>
                <TableHead className="ts-th">Tên sản phẩm</TableHead>
                <TableHead className="ts-th">Loại</TableHead>
                <TableHead className="ts-th">Số lượng</TableHead>
                <TableHead className="ts-th">Trạng thái</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ["Cà chua", "1.200", "Hoạt động"],
                ["Rau xà lách", "800", "Hoạt động"],
                ["Ớt chuông", "450", "Tạm dừng"],
              ].map(([name, quantity, status], index) => (
                <TableRow key={name}>
                  <TableCell className="ts-td">{name}</TableCell>
                  <TableCell className="ts-td">Rau quả</TableCell>
                  <TableCell className="ts-td">{quantity}</TableCell>
                  <TableCell className="ts-td">
                    <span
                      className={`ts-badge settings-sample-badge${index === 2 ? " is-paused" : ""}`}
                    >
                      {status}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      <p className="settings-preview-caption ts-muted">
        Dữ liệu minh họa · thay đổi được xem trước tại đây.
      </p>
    </div>
  );
}

export function SettingsWorkspace() {
  const [tab, setTab] = useState<Tab>("appearance");
  const [saved, setSaved] = useState<Settings>(defaults);
  const [draft, setDraft] = useState<Settings>(defaults);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const value = {
      typography: loadTypography(),
      appearance: loadAppearance(),
    };
    setSaved(value);
    setDraft(value);
    setReady(true);
  }, []);
  useEffect(() => {
    loadFonts(draft.typography);
  }, [draft.typography]);
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const apply = useCallback(() => {
    const value: Settings = {
      typography: {
        font: draft.typography.font,
        roles: Object.fromEntries(
          Object.entries(draft.typography.roles).filter(
            ([, style]) => style.font || style.size || style.weight,
          ),
        ),
      },
      appearance: normalizeAppearance(draft.appearance),
    };
    const typographyStored = saveTypography(value.typography);
    const appearanceStored = saveAppearance(value.appearance);
    setSaved(value);
    setDraft(value);
    setMessage(
      typographyStored && appearanceStored
        ? "Đã lưu cài đặt trên trình duyệt này."
        : "Đã áp dụng cho tab này. Trình duyệt đang chặn lưu cài đặt; thay đổi sẽ mất khi tải lại.",
    );
  }, [draft]);
  useEffect(() => {
    if (!ready || !draft.appearance.autoSave || !changed) return;
    const timer = window.setTimeout(apply, 500);
    return () => window.clearTimeout(timer);
  }, [ready, draft.appearance.autoSave, changed, apply]);
  const setAppearance = (patch: Partial<Appearance>) => {
    setDraft((current) => ({
      ...current,
      appearance: { ...current.appearance, ...patch },
    }));
    setMessage("");
  };
  const setTypography = (value: Typography) => {
    setDraft((current) => ({ ...current, typography: value }));
    setMessage("");
  };
  const setRole = (id: string, patch: RoleStyle) => {
    setDraft((current) => ({
      ...current,
      typography: {
        ...current.typography,
        roles: {
          ...current.typography.roles,
          [id]: { ...current.typography.roles[id], ...patch },
        },
      },
    }));
    setMessage("");
  };
  const setCommon = (patch: RoleStyle) => {
    setDraft((current) => ({
      ...current,
      typography: {
        ...current.typography,
        roles: {
          ...current.typography.roles,
          ...Object.fromEntries(
            [
              "body",
              "label",
              "input",
              "tableCell",
              "button",
              "link",
              "nav",
              "topbar",
            ].map((id) => [id, { ...current.typography.roles[id], ...patch }]),
          ),
        },
      },
    }));
    setMessage("");
  };
  const reset = () => {
    setDraft(defaults);
    setMessage("Đã chọn cài đặt gốc. Bấm Lưu thay đổi để áp dụng.");
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ version: 1, ...saved }, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "agritrace-giao-dien.json";
    link.click();
    URL.revokeObjectURL(url);
  };
  const previewCss = `${typographyCss(draft.typography, "#settings-preview")}\n${appearanceCss(draft.appearance, "#settings-preview")}`;
  return (
    <div className="manage-console settings-workspace">
      <style>{previewCss}</style>
      <header className="settings-heading">
        <h1>Cài đặt</h1>
        <div className="settings-heading-actions">
          <Button
            className="button secondary"
            type="button"
            disabled={!ready || !changed}
            onClick={() => {
              setDraft(saved);
              setMessage("");
            }}
          >
            Hủy thay đổi
          </Button>
          <Button
            className="button"
            type="button"
            disabled={!ready || !changed}
            onClick={apply}
          >
            Lưu thay đổi
          </Button>
        </div>
      </header>
      <div className="settings-tabs" role="tablist" aria-label="Nhóm cài đặt">
        {tabs.map(([id, label], index) => (
          <Button
            key={id}
            type="button"
            id={`settings-tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls="settings-panel"
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft")
                next = (index + tabs.length - 1) % tabs.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else return;
              event.preventDefault();
              setTab(tabs[next][0]);
              event.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>("[role=tab]")
                [next]?.focus();
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      {message && (
        <p className="settings-feedback" role="status">
          {message}
        </p>
      )}
      <div
        id="settings-panel"
        role="tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
      >
        {tab === "appearance" && (
          <div className="settings-columns">
            <div className="settings-column">
              <Card
                title="Kiểu chủ đề hiển thị"
                help="Lựa chọn giao diện phù hợp với thương hiệu doanh nghiệp."
              >
                <Choices
                  label="Kiểu chủ đề"
                  value={draft.appearance.theme}
                  options={[
                    ...THEMES.map((theme) => [theme.id, theme.label] as const),
                    ["custom", "Tùy chỉnh"],
                  ]}
                  onChange={(theme) => {
                    const preset = THEMES.find((item) => item.id === theme);
                    setAppearance(
                      preset
                        ? {
                            theme: preset.id,
                            primary: preset.primary,
                            secondary: preset.secondary,
                            accent: preset.accent,
                            background: preset.background,
                          }
                        : { theme },
                    );
                  }}
                />
              </Card>
              <Card
                title="Thiết lập hiển thị"
                help="Điều chỉnh kiểu chữ và cách bố trí để dễ thao tác hơn."
              >
                <div className="settings-fields settings-fields-three">
                  <label>
                    <span>Font chữ</span>
                    <FontSelect
                      label="Font chữ toàn hệ thống"
                      value={draft.typography.font}
                      onChange={(font) =>
                        setTypography({ ...draft.typography, font })
                      }
                    />
                  </label>
                  <label>
                    <span>Cỡ chữ (px)</span>
                    <NativeSelect
                      className="select"
                      value={draft.typography.roles.body?.size ?? ""}
                      onChange={(e) =>
                        setCommon({
                          size: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        })
                      }
                    >
                      <option value="">Theo thiết kế</option>
                      {[12, 13, 14, 15, 16, 18].map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                      {draft.typography.roles.body?.size &&
                        ![12, 13, 14, 15, 16, 18].includes(
                          draft.typography.roles.body.size,
                        ) && (
                          <option value={draft.typography.roles.body.size}>
                            {draft.typography.roles.body.size}
                          </option>
                        )}
                    </NativeSelect>
                  </label>
                  <label>
                    <span>Độ đậm</span>
                    <NativeSelect
                      className="select"
                      value={draft.typography.roles.body?.weight ?? ""}
                      onChange={(e) =>
                        setCommon({
                          weight: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        })
                      }
                    >
                      <option value="">Theo thiết kế</option>
                      {WEIGHTS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                </div>
                <div className="settings-fields settings-fields-two">
                  <div>
                    <span className="settings-field-name">Mật độ bảng</span>
                    <Choices
                      label="Mật độ bảng"
                      value={draft.appearance.density}
                      options={[
                        ["comfortable", "Thoải mái"],
                        ["standard", "Chuẩn"],
                        ["compact", "Gọn"],
                        ["dense", "Rất gọn"],
                      ]}
                      onChange={(density) => setAppearance({ density })}
                    />
                  </div>
                  <div>
                    <span className="settings-field-name">
                      Chiều rộng nội dung
                    </span>
                    <Choices
                      label="Chiều rộng nội dung"
                      value={draft.appearance.width}
                      options={[
                        ["narrow", "Thu hẹp"],
                        ["default", "Mặc định"],
                        ["wide", "Mở rộng"],
                      ]}
                      onChange={(width) => setAppearance({ width })}
                    />
                  </div>
                </div>
              </Card>
              <Card
                title="Màu sắc thương hiệu"
                help="Tùy chỉnh màu chủ đạo của không gian làm việc."
              >
                <div className="settings-colors">
                  {(
                    [
                      ["primary", "Màu chủ đạo"],
                      ["secondary", "Màu phụ"],
                      ["accent", "Màu nhấn"],
                      ["background", "Màu nền"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      <span>{label}</span>
                      <span className="settings-color-control">
                        <Input
                          type="color"
                          aria-label={label}
                          value={draft.appearance[key]}
                          onChange={(e) =>
                            setAppearance({
                              [key]: e.target.value,
                              theme: "custom",
                            })
                          }
                        />
                        <code>{draft.appearance[key].toUpperCase()}</code>
                      </span>
                    </label>
                  ))}
                </div>
              </Card>
              <Card
                title="Hiển thị bảng dữ liệu"
                help="Tùy chỉnh chữ trong tiêu đề cột và các dòng dữ liệu."
              >
                <div className="settings-fields settings-fields-three">
                  <label>
                    <span>Cỡ chữ tiêu đề</span>
                    <Input
                      className="input"
                      type="number"
                      min={10}
                      max={48}
                      placeholder="12"
                      value={draft.typography.roles.tableHead?.size ?? ""}
                      onChange={(e) =>
                        setRole("tableHead", {
                          size: e.target.value
                            ? Math.min(48, Math.max(10, Number(e.target.value)))
                            : undefined,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Cỡ chữ dữ liệu</span>
                    <Input
                      className="input"
                      type="number"
                      min={10}
                      max={48}
                      placeholder="13"
                      value={draft.typography.roles.tableCell?.size ?? ""}
                      onChange={(e) =>
                        setRole("tableCell", {
                          size: e.target.value
                            ? Math.min(48, Math.max(10, Number(e.target.value)))
                            : undefined,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Độ đậm dữ liệu</span>
                    <NativeSelect
                      className="select"
                      value={draft.typography.roles.tableCell?.weight ?? ""}
                      onChange={(e) =>
                        setRole("tableCell", {
                          weight: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        })
                      }
                    >
                      <option value="">Theo thiết kế</option>
                      {WEIGHTS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                </div>
              </Card>
            </div>
            <div className="settings-column">
              <Card
                title="Xem trước"
                help="Giao diện hiển thị sau khi áp dụng cài đặt."
              >
                <Sample />
              </Card>
              <Card title="Khác">
                <dl className="settings-facts">
                  <div>
                    <dt>Ngôn ngữ</dt>
                    <dd>Tiếng Việt</dd>
                  </div>
                  <div>
                    <dt>Múi giờ</dt>
                    <dd>(GMT+07:00) Hà Nội</dd>
                  </div>
                </dl>
                <label className="settings-check">
                  <Input
                    type="checkbox"
                    checked={draft.appearance.autoSave}
                    onChange={(e) =>
                      setAppearance({ autoSave: e.target.checked })
                    }
                  />
                  <span>
                    Tự động lưu thay đổi
                    <small>
                      Lưu tùy chỉnh giao diện sau khi thay đổi trên trình duyệt
                      này.
                    </small>
                  </span>
                </label>
              </Card>
              <Card
                title="Khôi phục cài đặt gốc"
                help="Đưa giao diện và kiểu chữ về thiết kế ban đầu."
              >
                <Button
                  type="button"
                  className="button secondary small"
                  onClick={reset}
                >
                  Khôi phục cài đặt gốc
                </Button>
              </Card>
            </div>
          </div>
        )}
        {tab === "system" && (
          <Card title="Thông tin hệ thống">
            <dl className="settings-facts">
              <div>
                <dt>Ứng dụng</dt>
                <dd>AgriTrace</dd>
              </div>
              <div>
                <dt>Không gian</dt>
                <dd>Doanh nghiệp</dd>
              </div>
              <div>
                <dt>Ngôn ngữ hiển thị</dt>
                <dd>Tiếng Việt</dd>
              </div>
              <div>
                <dt>Múi giờ nghiệp vụ</dt>
                <dd>Asia/Ho_Chi_Minh (GMT+07:00)</dd>
              </div>
              <div>
                <dt>Phạm vi cài đặt giao diện</dt>
                <dd>Trình duyệt hiện tại</dd>
              </div>
            </dl>
            <p className="settings-note">
              Màu sắc và kiểu chữ áp dụng cho không gian làm việc trên trình
              duyệt này. Thay đổi không đồng bộ sang thiết bị khác.
            </p>
          </Card>
        )}
        {tab === "account" && (
          <Card title="Tài khoản & hồ sơ">
            <div className="settings-link-list">
              <Link href="/account/password">
                Đổi mật khẩu<span>Quản lý mật khẩu đăng nhập của bạn.</span>
              </Link>
              <Link href="/account/privacy">
                Quyền dữ liệu cá nhân
                <span>Xem và gửi yêu cầu về dữ liệu cá nhân.</span>
              </Link>
              <Link href="/enterprise/profile">
                Hồ sơ doanh nghiệp<span>Xem thông tin và hồ sơ tổ chức.</span>
              </Link>
            </div>
          </Card>
        )}
        {tab === "data" && (
          <Card
            title="Dữ liệu cài đặt giao diện"
            help="Tải bản sao các tùy chỉnh đã lưu trên trình duyệt hiện tại."
          >
            <p className="settings-note">
              Tệp gồm màu sắc, kiểu chữ, mật độ bảng và chiều rộng nội dung.
            </p>
            <Button
              type="button"
              className="button secondary"
              onClick={download}
            >
              Tải bản sao cài đặt giao diện
            </Button>
            <Link className="text-link" href="/account/privacy">
              Quản lý quyền dữ liệu cá nhân
            </Link>
          </Card>
        )}
        {tab === "advanced" && (
          <Card
            title="Kiểu chữ theo từng loại nội dung"
            help="Tùy chỉnh riêng cho tiêu đề, menu, nút bấm và bảng. Để trống để dùng theo thiết kế."
          >
            <div
              className="typo-presets"
              role="group"
              aria-label="Mẫu kiểu chữ"
            >
              {PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  className="button secondary small"
                  type="button"
                  onClick={() => setTypography(preset.value)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <div className="manage-table-scroll">
              <Table className="manage-table typo-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Loại nội dung</TableHead>
                    <TableHead>Font</TableHead>
                    <TableHead>Cỡ chữ (px)</TableHead>
                    <TableHead>Độ đậm</TableHead>
                    <TableHead>Xem nhanh</TableHead>
                    <TableHead aria-label="Đặt lại" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {TEXT_ROLES.map((role) => {
                    const style = draft.typography.roles[role.id] ?? {};
                    return (
                      <TableRow key={role.id}>
                        <TableCell data-label="Loại nội dung">
                          <strong>{role.label}</strong>
                          <small>{role.hint}</small>
                        </TableCell>
                        <TableCell data-label="Font">
                          <FontSelect
                            label={`Font cho ${role.label}`}
                            value={style.font}
                            inherit="Theo font toàn hệ thống"
                            onChange={(font) => setRole(role.id, { font })}
                          />
                        </TableCell>
                        <TableCell data-label="Cỡ chữ (px)">
                          <Input
                            className="input typo-size"
                            type="number"
                            min={10}
                            max={48}
                            aria-label={`Cỡ chữ cho ${role.label}`}
                            placeholder={String(role.baseSize)}
                            value={style.size ?? ""}
                            onChange={(e) =>
                              setRole(role.id, {
                                size: e.target.value
                                  ? Math.min(
                                      48,
                                      Math.max(10, Number(e.target.value)),
                                    )
                                  : undefined,
                              })
                            }
                          />
                        </TableCell>
                        <TableCell data-label="Độ đậm">
                          <NativeSelect
                            className="select"
                            aria-label={`Độ đậm cho ${role.label}`}
                            value={style.weight ?? ""}
                            onChange={(e) =>
                              setRole(role.id, {
                                weight: e.target.value
                                  ? Number(e.target.value)
                                  : undefined,
                              })
                            }
                          >
                            <option value="">Theo thiết kế</option>
                            {WEIGHTS.map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </NativeSelect>
                        </TableCell>
                        <TableCell data-label="Xem nhanh">
                          <span
                            className="typo-swatch"
                            style={{
                              fontFamily: fontById(
                                style.font ?? draft.typography.font,
                              )?.family,
                              fontSize: style.size,
                              fontWeight: style.weight,
                            }}
                          >
                            Aa Ắ ệ 123
                          </span>
                        </TableCell>
                        <TableCell>
                          {(style.font || style.size || style.weight) && (
                            <Button
                              className="text-link"
                              type="button"
                              aria-label={`Đặt lại ${role.label}`}
                              onClick={() => {
                                const roles = { ...draft.typography.roles };
                                delete roles[role.id];
                                setTypography({ ...draft.typography, roles });
                              }}
                            >
                              Đặt lại
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
