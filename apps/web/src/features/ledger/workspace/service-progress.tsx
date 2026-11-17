"use client";

import Link from "next/link";
import { Check, CreditCard, FileCheck2, Mail } from "lucide-react";
import { cn } from "@/lib/ledger/utils";
import { t as tr } from "@/lib/ledger/i18n";

export function ServiceProgress({
  accepted,
  paid,
  mailSent,
  hasPreview,
  view,
}: {
  accepted: boolean;
  paid: boolean;
  mailSent: boolean;
  hasPreview: boolean;
  view: "quote" | "contract" | "payment";
}) {
  const current = mailSent ? -1 : paid ? 2 : accepted ? 1 : 0;
  const steps = [
    {
      title: "Chọn dịch vụ",
      detail: accepted
        ? "Đã xác nhận hợp đồng"
        : view === "contract"
          ? "Kiểm tra hợp đồng PDF"
          : "Chọn gói và kiểm tra hợp đồng",
      icon: FileCheck2,
      done: accepted,
      href:
        hasPreview || accepted
          ? "/enterprise/service/contract"
          : "/enterprise/service",
    },
    {
      title: "Thanh toán",
      detail: paid ? "Đã xác nhận giao dịch" : "Quét QR để kích hoạt dịch vụ",
      icon: CreditCard,
      done: paid,
      href: accepted ? "/enterprise/service/payment" : null,
    },
    {
      title: "Nhận hợp đồng",
      detail: mailSent
        ? "Đã gửi PDF qua email"
        : paid
          ? "Đang gửi email kèm PDF"
          : "Gửi email sau khi thanh toán",
      icon: Mail,
      done: mailSent,
      href: paid ? "/enterprise/service/contract" : null,
    },
  ];
  return (
    <nav
      aria-label={tr("Các bước đăng ký dịch vụ")}
      className="rounded-xl border border-line bg-surface p-4 sm:p-5"
    >
      <ol className="grid gap-5 sm:grid-cols-3 sm:gap-4">
        {steps.map((s, i) => {
          const active = i === current;
          const Icon = s.done ? Check : s.icon;
          const content = (
            <>
              <span
                aria-hidden
                className={cn(
                  "relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full border-2",
                  s.done
                    ? "border-brand bg-brand text-white"
                    : active
                      ? "border-brand bg-brand-weak text-brand"
                      : "border-line bg-canvas text-ink-2",
                )}
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 py-0.5">
                <span
                  className={cn(
                    "block text-sm font-semibold",
                    active || s.done ? "text-ink" : "text-ink-2",
                  )}
                >
                  {i + 1}. {tr(s.title)}
                </span>
                <span className="mt-1 block text-xs text-ink-2">
                  {tr(s.detail)}
                </span>
              </span>
            </>
          );
          return (
            <li
              key={s.title}
              aria-current={active ? "step" : undefined}
              className="relative"
            >
              {i < 2 && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-5 top-10 h-6 border-l-2 sm:left-10 sm:-right-4 sm:top-6 sm:h-0 sm:border-l-0 sm:border-t-2",
                    s.done ? "border-brand" : "border-line border-dashed",
                  )}
                />
              )}
              {s.href ? (
                <Link
                  href={s.href}
                  className="relative flex gap-3 rounded-lg p-1 no-underline transition-colors hover:bg-canvas hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:flex-col"
                >
                  {content}
                </Link>
              ) : (
                <div
                  className="relative flex gap-3 p-1 sm:flex-col"
                  aria-disabled="true"
                >
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
