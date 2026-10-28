"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { customerHref } from "@/lib/site-origins";
import { useAuth } from "@/lib/auth-store";
import { getLedgerError } from "@/lib/ledger/errors";
import { ledgerLoginDestination } from "@/lib/ledger/session-navigation";
import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { pt as t } from "@/lib/ledger/public-i18n";
import { LanguageSwitch, useLocale } from "@/components/ledger/locale";
import { PublicLogo, useForceLight } from "@/components/ledger/shell/public-shell";
import teaHills from "../../../../../public/images/site/tea-hills.jpg";
import { Button } from "@/components/ledger/ui/button";
import { TextField } from "@/components/ledger/kit/form-fields";
import { Callout } from "@/components/ledger/kit/page";
const schema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  mfaCode: z.string(),
});
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLocale();
  useForceLight();
  const auth = useAuth(),
    router = useRouter(),
    busy = useRef(false);
  const [needMfa, setNeedMfa] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "", mfaCode: "" },
  });
  const next = route.searchParams.next,
    requested = typeof next === "string" ? next : next?.[0];
  useEffect(() => {
    if (!auth.isLoading && auth.user)
      router.replace(ledgerLoginDestination(auth.user, requested));
  }, [auth.isLoading, auth.user, requested, router]);
  return (
    <div className="pub-site grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <div className="relative isolate hidden flex-col justify-between gap-10 overflow-hidden bg-(--pub-deep) px-12 py-10 text-white lg:flex">
        <Image src={teaHills} alt="" fill priority placeholder="blur" sizes="50vw" className="-z-20 object-cover" />
        <div className="pub-photo-shade absolute inset-0 -z-10" aria-hidden />
        <Link href={customerHref("/")} className="w-fit" aria-label="AgriTrace">
          <PublicLogo height={48} onDark priority />
        </Link>
        <div className="relative flex max-w-lg flex-col gap-5">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight">
            {t("Hành trình nông sản, thông tin có thể đối chiếu.")}
          </h2>
          <ul className="flex flex-col gap-3 text-[14px] text-white/85">
            {[
              "Ghi nhận vụ sản xuất, thu hoạch, chế biến và giao nhận",
              "Dấu dữ liệu được đối chiếu trên Hyperledger Fabric",
              "Mã QR cho từng lô để người tiêu dùng tự tra cứu",
            ].map((item) => (
              <li key={item} className="border-l-2 border-[#9be7b4] pl-3">
                {t(item)}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3 rounded-xl bg-black/25 p-5 ring-1 ring-white/15 backdrop-blur-sm">
          <h2 className="text-[13px] font-semibold tracking-wide uppercase">{t("Dành cho doanh nghiệp")}</h2>
          <p className="text-[14px] text-white/85">
            {t(
              "Đăng ký hồ sơ doanh nghiệp để tham gia truy xuất nguồn gốc. Hồ sơ và năng lực được xét duyệt trước khi sử dụng dịch vụ.",
            )}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild className="bg-(--pub-accent) text-white hover:bg-(--pub-accent-hover)">
              <Link href="/register">{t("Đăng ký doanh nghiệp")}</Link>
            </Button>
            <Button asChild variant="ghost" className="text-white hover:bg-white/10 hover:text-white">
              <Link href={customerHref("/")}>{t("Tìm hiểu AgriTrace")}</Link>
            </Button>
          </div>
        </div>
      </div>
      <div className="flex flex-col justify-between gap-10 bg-card px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between gap-3">
          <Link href={customerHref("/")} aria-label="AgriTrace" className="lg:invisible">
            <PublicLogo height={40} />
          </Link>
          <LanguageSwitch />
        </div>
        <form
          noValidate
          className="mx-auto flex w-full max-w-[380px] flex-col gap-4"
          onSubmit={form.handleSubmit(async (values) => {
            if (!hydrated || auth.isLoading || busy.current) return;
            busy.current = true;
            setError(null);
            try {
              await auth.login(
                values.email,
                values.password,
                needMfa ? values.mfaCode.trim() : undefined,
              );
            } catch (cause) {
              const message =
                getLedgerError(cause)?.message ?? t("Không thể đăng nhập.");
              if (message === "Cần mã xác thực hai yếu tố") setNeedMfa(true);
              else setError(message);
            } finally {
              busy.current = false;
            }
          })}
        >
          <div className="flex flex-col gap-1">
            <h1 className="text-[26px] font-semibold tracking-[-0.01em]">
              {t("Đăng nhập Agritrace")}
            </h1>
            <p className="text-[13px] text-ink-2">
              {t(
                "Một cửa đăng nhập: vai nền tảng vào khu quản trị, thành viên doanh nghiệp vào không gian làm việc của doanh nghiệp.",
              )}
            </p>
          </div>
          <fieldset
            disabled={
              !hydrated || auth.isLoading || form.formState.isSubmitting
            }
            className="flex min-w-0 flex-col gap-4"
          >
            <TextField
              control={form.control}
              name="email"
              label="Email"
              type="email"
              autoComplete="username"
            />
            <TextField
              control={form.control}
              name="password"
              label={t("Mật khẩu")}
              type="password"
              autoComplete="current-password"
            />
            {needMfa && (
              <TextField
                control={form.control}
                name="mfaCode"
                label={t("Mã xác thực hai yếu tố")}
                inputMode="numeric"
                autoComplete="one-time-code"
                hint={t(
                  "Tài khoản đã bật MFA — nhập mã 6 số hoặc mã khôi phục.",
                )}
              />
            )}
          </fieldset>
          {error && (
            <div role="alert">
              <Callout tone="danger">{error}</Callout>
            </div>
          )}
          <Button
            type="submit"
            size="lg"
            disabled={
              !hydrated || auth.isLoading || form.formState.isSubmitting
            }
          >
            {form.formState.isSubmitting && (
              <Loader2 className="animate-spin" />
            )}
            {needMfa ? t("Xác minh và đăng nhập") : t("Đăng nhập")}
          </Button>
          <p className="text-[12px] text-ink-2">
            {t(
              "Sau nhiều lần sai mật khẩu, tài khoản nền tảng bị khóa tạm. Email lạ, sai mật khẩu và đang bị khóa trả cùng một thông báo.",
            )}
          </p>
        </form>
        <div className="mx-auto flex w-full max-w-[380px] flex-col gap-3 text-[13px]">
          <p className="text-ink-2 lg:hidden">
            {t("Chưa có tài khoản?")}{" "}
            <Link href="/register" className="font-medium text-brand hover:underline">
              {t("Đăng ký doanh nghiệp")}
            </Link>
          </p>
          <Link href={customerHref("/scan")} className="w-fit text-brand hover:underline">
            {t("Tra cứu nguồn gốc bằng QR")}
          </Link>
        </div>
      </div>
    </div>
  );
}
