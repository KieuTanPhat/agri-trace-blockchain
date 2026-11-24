"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getTracePath } from "@/lib/trace-input";
import { customerHref } from "@/lib/site-origins";
import { pt } from "@/lib/ledger/public-i18n";
import { CameraScanner } from "./camera-scanner";
import { Callout } from "./kit/page";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";

/**
 * Scan in place: the camera opens in a dialog and a decoded AgriTrace code
 * goes straight to the lot's trace page, without the separate scan page.
 */
export function ScanDialog({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const go = (path: string) => {
    setOpen(false);
    router.push(customerHref(path));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const path = getTracePath(code);
    if (!path) return setError(pt("Nhập mã trên QR hoặc đường dẫn /trace/<token> hợp lệ."));
    go(path);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); setCode(""); setError(""); }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{pt("Quét mã truy xuất")}</DialogTitle>
          <DialogDescription>{pt("Đưa mã QR trên bao bì vào khung hình; thông tin lô hiện ngay khi đọc được mã.")}</DialogDescription>
        </DialogHeader>
        {open && <CameraScanner onTrace={go} autoStart />}
        <form aria-label={pt("Tra cứu nông sản")} onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor="scan-dialog-input" className="text-sm">{pt("Hoặc nhập mã truy xuất")}</label>
          <div className="flex gap-2">
            <Input id="scan-dialog-input" value={code} autoComplete="off" onChange={(e) => { setCode(e.target.value); setError(""); }} />
            <Button type="submit">{pt("Tra cứu")}</Button>
          </div>
          {error && <div role="alert"><Callout tone="danger">{error}</Callout></div>}
        </form>
      </DialogContent>
    </Dialog>
  );
}
