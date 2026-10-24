"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getTracePath } from "@/lib/trace-input";
import { pt } from "@/lib/ledger/public-i18n";
import { CameraScanner } from "@/components/ledger/camera-scanner";
import { Callout } from "@/components/ledger/kit/page";
import { Input } from "@/components/ledger/ui/input";
import { Button } from "@/components/ledger/ui/button";
import { Container, PhotoHero, Reveal } from "./blocks";
import { PHOTOS } from "./content";

export default function Scan() {
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
  const tips = [
    { title: "Camera", copy: "Đưa mã QR vào giữa khung hình, giữ máy ổn định và đủ sáng." },
    { title: "Ảnh chụp", copy: "Chọn ảnh đã chụp tem QR nếu không muốn bật camera." },
    { title: "Nhập mã", copy: "Gõ mã truy xuất in bên dưới tem hoặc dán đường dẫn trong mã QR." },
  ];
  return (
    <>
      <PhotoHero image={PHOTOS.teaHills} title={pt("Quét mã truy xuất")} description={pt("Dùng camera, ảnh mã QR hoặc nhập mã truy xuất trên bao bì.")} />
      <section className="py-12 sm:py-16">
        <Container className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <Reveal className="rounded-2xl border border-line bg-card p-2 shadow-sm [&>section]:border-0">
            <CameraScanner onTrace={(path) => router.push(path)} />
          </Reveal>
          <div className="flex flex-col gap-6">
            <Reveal delay={90} as="section" className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-6 shadow-sm">
              <h2 className="text-base font-semibold">{pt("Nhập mã thủ công")}</h2>
              <form aria-label="Tra cứu nông sản" onSubmit={submit} className="flex flex-col gap-3">
                <label htmlFor="public-trace-input" className="text-sm">
                  {pt("Mã truy xuất hoặc đường dẫn")}
                </label>
                <Input
                  id="public-trace-input"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setError("");
                  }}
                  autoComplete="off"
                  className="h-11"
                />
                {error && (
                  <div role="alert">
                    <Callout tone="danger">{error}</Callout>
                  </div>
                )}
                <Button type="submit" size="lg">
                  {pt("Tra cứu")}
                </Button>
              </form>
            </Reveal>
            <Reveal delay={180} as="section" className="flex flex-col gap-4 rounded-2xl bg-brand-weak/70 p-6">
              <h2 className="text-base font-semibold">{pt("Mẹo tra cứu")}</h2>
              <ol className="flex flex-col gap-4">
                {tips.map((tip, i) => (
                  <li key={tip.title} className="flex gap-3">
                    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-card text-[13px] font-semibold text-brand">{i + 1}</span>
                    <div>
                      <p className="text-[14px] font-medium">{pt(tip.title)}</p>
                      <p className="text-[14px] leading-relaxed text-ink-2">{pt(tip.copy)}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="border-t border-brand/15 pt-4 text-[13px] text-ink-2">
                {pt("Chỉ mở trang truy xuất của AgriTrace. Đường dẫn lạ hoặc trang quản trị bị từ chối.")}
              </p>
            </Reveal>
          </div>
        </Container>
      </section>
    </>
  );
}
