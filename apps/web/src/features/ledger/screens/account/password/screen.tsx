"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/lib/auth-store";
import { ledgerRequest } from "@/lib/ledger/request";
import { getLedgerError } from "@/lib/ledger/errors";
import { t } from "@/lib/ledger/i18n";
import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { useLocale } from "@/components/ledger/locale";
import { useLedgerConfirm } from "@/components/ledger/confirm-provider";
import { LedgerAppShell } from "@/components/ledger/shell/app-shell";
import { Button } from "@/components/ledger/ui/button";
import { TextField } from "@/components/ledger/kit/form-fields";
import { Callout, PageHeader, PageBody } from "@/components/ledger/kit/page";
const schema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(12).max(72),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, {
    path: ["confirm"],
    error: () => t("Mật khẩu nhập lại không khớp"),
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    error: () => t("Phải khác mật khẩu tạm"),
  });
export default function LedgerScreen(_props: LedgerScreenProps) {
  void _props;
  useLocale();
  const auth = useAuth(),
    router = useRouter(),
    confirm = useLedgerConfirm(),
    busy = useRef(false),
    [error, setError] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "", confirm: "" },
  });
  const content = (
    <form
      noValidate
      onSubmit={form.handleSubmit(async (values) => {
        if (busy.current) return;
        busy.current = true;
        setError(null);
        try {
          if (
            !(await confirm({
              title: t("Xác nhận đổi mật khẩu"),
              description: t(
                "Các phiên đăng nhập khác sẽ bị thu hồi và bạn cần đăng nhập lại bằng mật khẩu mới.",
              ),
              confirmLabel: t("Đổi mật khẩu"),
            }))
          )
            return;
          await ledgerRequest("/auth/change-password", {
            method: "POST",
            body: JSON.stringify({
              currentPassword: values.currentPassword,
              newPassword: values.newPassword,
            }),
          });
          await auth.logout();
          router.replace("/login");
        } catch (cause) {
          setError(
            getLedgerError(cause)?.message ??
              t("Chưa nhận được kết quả đổi mật khẩu."),
          );
        } finally {
          busy.current = false;
        }
      })}
      className="flex w-full max-w-[400px] flex-col gap-4 rounded-md border border-line bg-card p-6"
    >
      <div className="flex flex-col gap-1">
        {auth.user?.mustChangePassword && (
          <h1 className="text-[20px] font-semibold">{t("Đổi mật khẩu tạm")}</h1>
        )}
        <p className="text-[13px] text-ink-2">
          {t("Tài khoản")} <span className="font-mono">{auth.user?.email}</span>{" "}
          {t("Đổi mật khẩu sẽ thu hồi mọi phiên khác.")}
        </p>
      </div>
      <TextField
        control={form.control}
        name="currentPassword"
        label={
          auth.user?.mustChangePassword
            ? t("Mật khẩu tạm")
            : t("Mật khẩu hiện tại")
        }
        type="password"
        autoComplete="current-password"
      />
      <TextField
        control={form.control}
        name="newPassword"
        label={t("Mật khẩu mới")}
        type="password"
        autoComplete="new-password"
        hint={t("12–72 ký tự")}
      />
      <TextField
        control={form.control}
        name="confirm"
        label={t("Nhập lại mật khẩu mới")}
        type="password"
        autoComplete="new-password"
      />
      {error && (
        <div role="alert">
          <Callout tone="danger">{error}</Callout>
        </div>
      )}
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {t("Đổi mật khẩu")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={async () => {
          if (
            await confirm({
              title: t("Đăng xuất"),
              confirmLabel: t("Đăng xuất"),
            })
          ) {
            await auth.logout();
            router.replace("/login");
          }
        }}
      >
        {t("Đăng xuất")}
      </Button>
    </form>
  );
  if (auth.user?.mustChangePassword)
    return (
      <div
        data-testid="ledger-private-root"
        className="grid min-h-dvh place-items-center px-4"
      >
        {content}
      </div>
    );
  return (
    <LedgerAppShell>
      <PageHeader title={t("Đổi mật khẩu")} />
      <PageBody>{content}</PageBody>
    </LedgerAppShell>
  );
}
