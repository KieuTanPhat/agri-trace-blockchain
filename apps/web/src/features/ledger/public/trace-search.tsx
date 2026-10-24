"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScanLine, Search } from "lucide-react";
import { getTracePath } from "@/lib/trace-input";
import { pt } from "@/lib/ledger/public-i18n";
import { cn } from "@/lib/ledger/utils";
import { Button } from "@/components/ledger/ui/button";

/** Ô tra cứu mã truy xuất; chỉ điều hướng tới `/trace/<token>` cùng origin qua getTracePath. */
export function TraceSearch({ className, onDark }: { className?: string; onDark?: boolean }) {
  const router = useRouter(),
    [code, setCode] = useState(""),
    [error, setError] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    const path = getTracePath(code);
    if (!path) {
      setError(pt("Nhập mã trên QR hoặc đường dẫn /trace/<token> hợp lệ."));
      return;
    }
    router.push(path);
  }
  return (
    <form aria-label={pt("Tra cứu nguồn gốc")} onSubmit={submit} className={cn("flex w-full flex-col gap-2", className)}>
      <label htmlFor="home-trace-input" className="sr-only">
        {pt("Mã truy xuất hoặc đường dẫn")}
      </label>
      <div className="flex flex-col gap-2 rounded-xl bg-card p-2 shadow-lg ring-1 ring-black/5 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
          <Search className="size-5 shrink-0 text-ink-2" aria-hidden />
          <input
            id="home-trace-input"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError("");
            }}
            autoComplete="off"
            placeholder={pt("Nhập mã truy xuất in trên bao bì…")}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? "home-trace-error" : undefined}
            className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-2/70"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="lg" className="flex-1 sm:flex-none">
            {pt("Tra cứu")}
          </Button>
          <Button asChild type="button" size="lg" variant="outline" className="flex-1 text-ink sm:flex-none">
            <Link href="/scan">
              <ScanLine />
              {pt("Quét QR")}
            </Link>
          </Button>
        </div>
      </div>
      {error && (
        <p id="home-trace-error" role="alert" className={cn("text-[13px] font-medium", onDark ? "text-(--pub-accent-weak)" : "text-danger")}>
          {error}
        </p>
      )}
    </form>
  );
}
