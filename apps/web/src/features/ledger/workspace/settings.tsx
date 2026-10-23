"use client";
import Link from "next/link";
import { useAuth } from "@/lib/auth-store";
import { LanguageSwitch } from "@/components/ledger/locale";
import { LedgerThemeToggle } from "@/components/ledger/shell/app-shell";
import { PageHeader, PageBody, Section, Field, Fields } from "@/components/ledger/kit/page";
import { t } from "@/lib/ledger/i18n";
export default function Settings() {
  const { user } = useAuth();
  return <><PageHeader title={t("Tùy chọn tài khoản")} description={t("Tùy chọn được lưu trên thiết bị này")}/><PageBody><Section title={t("Hiển thị")}><div className="flex flex-wrap items-center gap-4 p-5"><LanguageSwitch/><LedgerThemeToggle/></div></Section><Section title={t("Tài khoản")}><Fields><Field label={t("Họ tên")}>{user?.fullName}</Field><Field label="Email">{user?.email}</Field></Fields><div className="flex flex-wrap gap-4 p-5 text-brand"><Link href="/account/password">{t("Đổi mật khẩu")}</Link><Link href="/account/privacy">{t("Quyền dữ liệu cá nhân")}</Link></div></Section></PageBody></>;
}
