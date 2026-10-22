"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { components } from "@/lib/generated/api";
import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { ledgerRequest } from "@/lib/ledger/request";
import { getLedgerError } from "@/lib/ledger/errors";
import { t } from "@/lib/ledger/i18n";
import { AgritraceLogo } from "@/components/ledger/brand";
import { LanguageSwitch, useLocale } from "@/components/ledger/locale";
import { Button } from "@/components/ledger/ui/button";
import { TextField } from "@/components/ledger/kit/form-fields";
import { Callout } from "@/components/ledger/kit/page";
const schema = z
  .object({ password: z.string().min(12).max(72), confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    error: () => t("Mật khẩu nhập lại không khớp"),
  });
const first = (input: string | string[] | undefined) =>
  typeof input === "string" ? input : (input?.[0] ?? "");
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLocale();
  const [invitation] = useState(() => ({
    invitationId: first(route.searchParams.id),
    token: first(route.searchParams.token),
  }));
  const [done, setDone] = useState(false),
    [error, setError] = useState<string | null>(null),
    [frozen, setFrozen] = useState(false);
  const busy = useRef(false),
    attempt = useRef<components["schemas"]["AcceptInvitationInput"] | null>(
      null,
    );
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  });
  useEffect(() => {
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname,
    );
  }, []);
  const valid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      invitation.invitationId,
    ) && /^[A-Za-z0-9_-]{43}$/.test(invitation.token);
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div className="flex w-full max-w-[420px] flex-col gap-5 rounded-md border border-line bg-card p-6">
        <div className="flex items-center justify-between">
          <AgritraceLogo height={36} priority />
          <LanguageSwitch />
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-[20px] font-semibold">
            {t("Nhận lời mời tham gia doanh nghiệp")}
          </h1>
          <p className="text-[13px] text-ink-2">
            {t(
              "Đặt mật khẩu để kích hoạt tài khoản thành viên. Quyền và phạm vi do người mời thiết lập.",
            )}
          </p>
        </div>
        {!valid ? (
          <div role="alert">
            <Callout tone="danger">
              {t("Liên kết mời không hợp lệ hoặc thiếu mã.")}
            </Callout>
          </div>
        ) : done ? (
          <Callout tone="ok" title={t("Tài khoản đã được kích hoạt")}>
            <Link className="underline" href="/login">
              {t("Đăng nhập")}
            </Link>{" "}
            {t("bằng email được mời và mật khẩu vừa đặt.")}
          </Callout>
        ) : (
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={form.handleSubmit(async (values) => {
              if (busy.current) return;
              busy.current = true;
              setError(null);
              attempt.current ??= {
                ...invitation,
                requestId: crypto.randomUUID(),
                password: values.password,
              };
              try {
                await ledgerRequest(
                  "/auth/member-invitations/accept",
                  { method: "POST", body: JSON.stringify(attempt.current) },
                  false,
                );
                attempt.current = null;
                setFrozen(false);
                setDone(true);
              } catch (cause) {
                const e = getLedgerError(cause);
                setError(e?.message ?? t("Chưa nhận được kết quả kích hoạt."));
                if (
                  !frozen &&
                  e?.status &&
                  e.status >= 400 &&
                  e.status < 500 &&
                  e.status !== 408 &&
                  e.status !== 429
                )
                  attempt.current = null;
                else setFrozen(true);
              } finally {
                busy.current = false;
              }
            })}
          >
            <fieldset
              disabled={frozen || form.formState.isSubmitting}
              className="flex flex-col gap-4"
            >
              <TextField
                control={form.control}
                name="password"
                label={t("Mật khẩu")}
                type="password"
                autoComplete="new-password"
                hint={t("12–72 ký tự")}
              />
              <TextField
                control={form.control}
                name="confirm"
                label={t("Nhập lại mật khẩu")}
                type="password"
                autoComplete="new-password"
              />
            </fieldset>
            {error && (
              <div role="alert">
                <Callout tone="danger">{error}</Callout>
              </div>
            )}
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {frozen ? t("Đối soát") : t("Kích hoạt tài khoản")}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
