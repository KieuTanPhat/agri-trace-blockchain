"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { useForm } from "react-hook-form";
import type { components } from "@/lib/generated/api";
import { ledgerRequest } from "@/lib/ledger/request";
import { useLedgerQuery } from "@/lib/ledger/data";
import { getLedgerError } from "@/lib/ledger/errors";
import { fmtDateTime } from "@/lib/ledger/format";
import { t } from "@/lib/ledger/i18n";
import { useLedgerConfirm } from "@/components/ledger/confirm-provider";
import { Button } from "@/components/ledger/ui/button";
import { TextField } from "@/components/ledger/kit/form-fields";
import {
  Callout,
  ErrorState,
  Field,
  Fields,
  LoadingRows,
  PageBody,
  PageHeader,
  Section,
} from "@/components/ledger/kit/page";
type S = components["schemas"];
type Action = "enroll" | "verify" | "disable" | "recovery-codes";
export function MfaView() {
  const q = useLedgerQuery({
      queryKey: ["own-mfa"],
      queryFn: () => ledgerRequest<S["MfaStatusDto"]>("/auth/mfa"),
    }),
    confirm = useLedgerConfirm();
  const form = useForm({ defaultValues: { currentPassword: "", code: "" } }),
    [seed, setSeed] = useState<S["MfaEnrollmentDto"] | null>(null),
    [codes, setCodes] = useState<string[]>([]),
    [qr, setQr] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState<Action | null>(null),
    [notice, setNotice] = useState(""),
    busy = useRef(false);
  useEffect(() => {
    let active = true;
    if (seed)
      void QRCode.toDataURL(seed.otpauthUri, { margin: 1, width: 192 })
        .then((url) => {
          if (active) setQr(url);
        })
        .catch(() => {
          if (active) setQr("");
        });
    return () => {
      active = false;
    };
  }, [seed]);
  async function run(action: Action) {
    if (busy.current || uncertain) return;
    busy.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const v = form.getValues();
      const body =
        action === "enroll"
          ? { currentPassword: v.currentPassword }
          : { code: v.code.replace(/\s/g, "") };
      if (action === "enroll" && !v.currentPassword) {
        form.setError("currentPassword", {
          message: t("Nhập mật khẩu hiện tại"),
        });
        return;
      }
      if (action !== "enroll" && !v.code.trim()) {
        form.setError("code", {
          message: t("Nhập mã xác thực hoặc mã khôi phục"),
        });
        return;
      }
      if (
        action === "disable" &&
        !(await confirm({
          title: t("Tắt xác thực hai yếu tố"),
          description: t(
            "Tài khoản sẽ không còn lớp xác thực bổ sung. Bạn cần mã xác thực hợp lệ để tiếp tục.",
          ),
          confirmLabel: t("Tắt MFA"),
          danger: true,
        }))
      )
        return;
      if (
        action === "recovery-codes" &&
        !(await confirm({
          title: t("Tạo lại mã khôi phục"),
          description: t(
            "Các mã khôi phục cũ sẽ mất hiệu lực. Mã mới chỉ hiển thị một lần.",
          ),
          confirmLabel: t("Tạo mã mới"),
        }))
      )
        return;
      // These secret-bearing baseline endpoints do not implement command journaling.
      // Never persist a request or automatically replay an unknown result.
      const r = await ledgerRequest<
        S["MfaEnrollmentDto"] | S["MfaEnabledDto"] | S["MfaDisabledDto"]
      >(`/auth/mfa/${action}`, { method: "POST", body: JSON.stringify(body) });
      form.reset({ currentPassword: "", code: "" });
      if ("secret" in r) {
        setSeed(r);
        setCodes([]);
      } else {
        setSeed(null);
        setQr("");
        setCodes("recoveryCodes" in r ? r.recoveryCodes : []);
      }
      await q.refetch();
    } catch (cause) {
      const e = getLedgerError(cause);
      setError(e?.message ?? t("Không thực hiện được thao tác."));
      if (
        !e ||
        !e.status ||
        e.status === 408 ||
        e.status === 429 ||
        e.status >= 500
      )
        setUncertain(action);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function inspect() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const result = await q.refetch({ throwOnError: true });
      if (!result.data) return;
      setSeed(null);
      setQr("");
      setCodes([]);
      form.reset({ currentPassword: "", code: "" });
      setNotice(
        result.data.status === "ENABLED"
          ? t(
              "MFA đang bật. Nếu chưa nhận được mã khôi phục, hãy dùng mã xác thực mới để tạo lại bộ mã.",
            )
          : result.data.status === "PENDING"
            ? t(
                "Đăng ký MFA đang chờ. Nếu chưa nhận được khóa, bạn có thể bắt đầu lại bằng mật khẩu hiện tại; khóa cũ sẽ được thay thế.",
              )
            : t(
                "MFA hiện chưa bật. Hãy kiểm tra trạng thái trước khi bắt đầu đăng ký mới.",
              ),
      );
      setUncertain(null);
    } catch (cause) {
      setError(
        getLedgerError(cause)?.message ?? t("Chưa kiểm tra được trạng thái."),
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  if (q.error && !q.data)
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows />;
  const status = q.data,
    enabled = status.status === "ENABLED";
  return (
    <>
      <PageHeader
        title={t("Xác thực hai yếu tố")}
        description={t(
          "Bảo vệ tài khoản hiện tại bằng ứng dụng xác thực và mã khôi phục dùng một lần.",
        )}
      />
      <PageBody>
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-5">
            <Section title={t("Trạng thái tài khoản")}>
              <Fields>
                <Field label={t("Trạng thái")}>
                  {enabled
                    ? t("Đã bật MFA")
                    : status.status === "PENDING"
                      ? t("Chờ xác nhận")
                      : t("Chưa bật MFA")}
                </Field>
                <Field label={t("Chính sách")}>
                  {status.mode === "REQUIRED"
                    ? t("Bắt buộc")
                    : status.mode === "OFF"
                      ? t("Chưa khả dụng")
                      : t("Tùy chọn")}
                </Field>
                <Field label={t("Bật lúc")}>
                  {fmtDateTime(status.enabledAt)}
                </Field>
                <Field label={t("Mã khôi phục còn lại")}>
                  {status.recoveryCodesRemaining}
                </Field>
              </Fields>
            </Section>
            {seed && (
              <Section title={t("Ghép nối ứng dụng xác thực")}>
                <div className="flex flex-col gap-3 p-5">
                  <p className="text-[13px] text-ink-2">
                    {t(
                      "Quét mã bằng ứng dụng xác thực hoặc nhập khóa bên dưới. Không chia sẻ khóa này.",
                    )}
                  </p>
                  {qr && (
                    <Image
                      src={qr}
                      width={192}
                      height={192}
                      unoptimized
                      alt={t("Mã ghép nối MFA")}
                    />
                  )}
                  <p className="select-all rounded-md bg-sunken p-3 font-mono text-[13px] break-all">
                    {seed.secret}
                  </p>
                </div>
              </Section>
            )}
            {codes.length > 0 && (
              <Section title={t("Lưu mã khôi phục")}>
                <div className="flex flex-col gap-3 p-5">
                  <Callout tone="warn">
                    {t(
                      "Mỗi mã dùng một lần. Lưu ở nơi an toàn trước khi rời trang; hệ thống không hiển thị lại các mã này.",
                    )}
                  </Callout>
                  <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {codes.map((code) => (
                      <li
                        key={code}
                        className="select-all rounded-md bg-sunken px-3 py-2 font-mono text-[13px]"
                      >
                        {code}
                      </li>
                    ))}
                  </ul>
                  <Button variant="outline" onClick={() => setCodes([])}>
                    {t("Đã lưu mã")}
                  </Button>
                </div>
              </Section>
            )}
          </div>
          <Section title={enabled ? t("Quản lý MFA") : t("Thiết lập MFA")}>
            <div className="flex flex-col gap-4 p-5">
              {error && (
                <div role="alert">
                  <Callout tone="danger">{error}</Callout>
                </div>
              )}
              {notice && <Callout>{notice}</Callout>}
              {uncertain && (
                <Callout tone="warn">
                  <p>
                    {t(
                      "Kết quả chưa rõ. Kiểm tra trạng thái trước khi thực hiện thao tác tiếp theo.",
                    )}
                  </p>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => void inspect()}
                  >
                    {t("Kiểm tra trạng thái MFA")}
                  </Button>
                </Callout>
              )}
              <form
                onSubmit={form.handleSubmit(() =>
                  run(enabled ? "recovery-codes" : seed ? "verify" : "enroll"),
                )}
              >
                <fieldset
                  disabled={pending || !!uncertain || status.mode === "OFF"}
                  className="flex flex-col gap-4"
                >
                  {!enabled && !seed ? (
                    <>
                      <TextField
                        control={form.control}
                        name="currentPassword"
                        label={t("Mật khẩu hiện tại")}
                        type="password"
                        autoComplete="current-password"
                      />
                      {status.status === "PENDING" && (
                        <Callout>
                          {t(
                            "Bắt đầu lại sẽ thay thế khóa của lần đăng ký chưa hoàn tất.",
                          )}
                        </Callout>
                      )}
                      <Button type="submit">{t("Bắt đầu đăng ký MFA")}</Button>
                    </>
                  ) : (
                    <>
                      <TextField
                        control={form.control}
                        name="code"
                        label={t("Mã xác thực")}
                        autoComplete="one-time-code"
                        hint={
                          enabled
                            ? t(
                                "Mã từ ứng dụng hoặc một mã khôi phục chưa dùng",
                              )
                            : t("Mã 6 số từ ứng dụng đã ghép nối")
                        }
                      />
                      {!enabled ? (
                        <Button type="submit">{t("Xác nhận bật MFA")}</Button>
                      ) : (
                        <>
                          <Button type="submit">
                            {t("Tạo lại mã khôi phục")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={status.mode === "REQUIRED"}
                            onClick={() => void run("disable")}
                          >
                            {t("Tắt MFA")}
                          </Button>
                          {status.mode === "REQUIRED" && (
                            <p className="text-[12px] text-ink-2">
                              {t(
                                "Chính sách đang bắt buộc MFA; không thể tắt.",
                              )}
                            </p>
                          )}
                        </>
                      )}
                    </>
                  )}
                </fieldset>
              </form>
            </div>
          </Section>
        </div>
      </PageBody>
    </>
  );
}
