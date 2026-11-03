"use client";
import { useMemo } from "react";
import Image, { type StaticImageData } from "next/image";
import { createQrMatrix, createQrSvgPath } from "@/lib/qr-code";
import { pt } from "@/lib/ledger/public-i18n";
import { cn } from "@/lib/ledger/utils";
// Ảnh 3D: Microsoft Fluent Emoji (giấy phép MIT, xem public/images/site/3d/LICENSE.txt).
import farm from "../../../../public/images/site/3d/farm.png";
import harvest from "../../../../public/images/site/3d/harvest.png";
import processing from "../../../../public/images/site/3d/processing.png";
import transport from "../../../../public/images/site/3d/transport.png";
import retail from "../../../../public/images/site/3d/retail.png";
import consumer from "../../../../public/images/site/3d/consumer.png";
import ledger from "../../../../public/images/site/3d/ledger.png";
import inspection from "../../../../public/images/site/3d/inspection.png";

/** Các mắt xích theo chiều kim đồng hồ quanh quỹ đạo, bắt đầu từ bên trái. */
const STAGES: { image: StaticImageData; label: string; left: string; top: string }[] = [
  { image: farm, label: "Nông trại", left: "7%", top: "30%" },
  { image: harvest, label: "Thu hoạch", left: "23%", top: "4%" },
  { image: processing, label: "Chế biến", left: "77%", top: "4%" },
  { image: transport, label: "Vận chuyển", left: "93%", top: "30%" },
  { image: retail, label: "Bán lẻ", left: "86%", top: "60%" },
  { image: consumer, label: "Người mua quét mã", left: "64%", top: "70%" },
  { image: ledger, label: "Lưu trên blockchain", left: "36%", top: "70%" },
  { image: inspection, label: "Kiểm định", left: "14%", top: "60%" },
];

/** Quỹ đạo elip trong khung 1100×430; chấm sáng chạy theo đường này. */
const ORBIT = "M 40 215 a 510 165 0 1 0 1020 0 a 510 165 0 1 0 -1020 0";

function StageTile({ image, label, size }: { image: StaticImageData; label: string; size: "sm" | "lg" }) {
  return (
    <div className="group flex flex-col items-center gap-2 text-center">
      <span className={cn("relative grid place-items-center rounded-2xl border border-white/20 bg-white/10 shadow-[0_18px_40px_-18px_rgb(74_222_128/0.7)] backdrop-blur-sm transition-transform duration-300 group-hover:scale-110", size === "lg" ? "size-[88px]" : "size-16")}>
        <Image src={image} alt="" width={size === "lg" ? 60 : 44} height={size === "lg" ? 60 : 44} className="drop-shadow-[0_8px_14px_rgb(0_0_0/0.35)]" />
      </span>
      <span className={cn("leading-tight font-semibold text-white/90", size === "lg" ? "max-w-[150px] text-[13px]" : "text-[12px]")}>{pt(label)}</span>
    </div>
  );
}

/** Khối kính xanh ở giữa mang mã QR của trang quét. */
function QrCube({ size }: { size: number }) {
  const { path, n } = useMemo(() => {
    const matrix = createQrMatrix("https://agritrace.dev/scan");
    return { path: createQrSvgPath(matrix), n: matrix.length };
  }, []);
  const tile = Math.round(size * 0.62);
  return (
    <div
      className="relative grid place-items-center rounded-[30%] border border-white/30 bg-gradient-to-br from-[#5eea8f] via-[#1aa64c] to-[#0b5d2a] shadow-[0_30px_80px_-12px_rgb(34_197_94/0.75),inset_0_2px_0_rgb(255_255_255/0.45),inset_0_-10px_24px_rgb(0_0_0/0.25)]"
      style={{ width: size, height: size }}
    >
      <span aria-hidden className="pointer-events-none absolute inset-x-[12%] top-[6%] h-[22%] rounded-full bg-white/25 blur-md" />
      <svg role="img" aria-label={pt("Mã QR truy xuất")} viewBox={`0 0 ${n + 4} ${n + 4}`} className="relative rounded-xl bg-white p-1 shadow-lg" style={{ width: tile, height: tile }}>
        <path d={path} transform="translate(2 2)" fill="#0a2e18" />
      </svg>
    </div>
  );
}

/** Cảnh quỹ đạo của ảnh bìa: khối QR ở giữa, các mắt xích chuỗi lơ lửng quanh. */
export function HeroScene() {
  return (
    <>
      {/* Máy tính: quỹ đạo đầy đủ. */}
      <div className="relative mx-auto mb-10 hidden h-[460px] w-full max-w-[1100px] lg:block">
        <svg aria-hidden viewBox="0 0 1100 430" preserveAspectRatio="none" className="absolute inset-0 size-full">
          <ellipse cx="550" cy="215" rx="510" ry="165" fill="none" stroke="rgb(74 222 128 / 0.35)" strokeDasharray="2 6" />
          <ellipse cx="550" cy="215" rx="360" ry="112" fill="none" stroke="rgb(74 222 128 / 0.22)" strokeDasharray="2 6" />
          {[0, 3, 6].map((begin) => (
            <circle key={begin} className="pub-orbit-dot" r="3.5" fill="#86efac">
              <animateMotion dur="9s" begin={`${begin}s`} repeatCount="indefinite" path={ORBIT} />
            </circle>
          ))}
        </svg>
        <div aria-hidden className="pub-glow absolute bottom-[34px] left-1/2 h-20 w-[360px] -ml-[180px] rounded-[50%] bg-[radial-gradient(ellipse,rgb(74_222_128/0.75),transparent_70%)] blur-md" />
        <div aria-hidden className="absolute bottom-[52px] left-1/2 h-10 w-[260px] -ml-[130px] rounded-[50%] border border-[#4ade80]/40 bg-[#4ade80]/10" />
        <div className="absolute top-[62px] left-1/2 -ml-[100px]">
          <div className="pub-float-lg">
            <QrCube size={200} />
          </div>
        </div>
        {STAGES.map((s, i) => (
          <div key={s.label} className="absolute -translate-x-1/2" style={{ left: s.left, top: s.top }}>
            <div className="pub-float" style={{ "--pub-delay": `${i * 300}ms` } as React.CSSProperties}>
              <StageTile image={s.image} label={s.label} size="lg" />
            </div>
          </div>
        ))}
      </div>

      {/* Điện thoại, máy tính bảng: khối QR và lưới mắt xích. */}
      <div className="flex flex-col items-center gap-8 pb-12 lg:hidden">
        <div className="pub-float-lg">
          <QrCube size={140} />
        </div>
        <ul className="grid w-full max-w-md grid-cols-4 gap-x-2 gap-y-5 px-4">
          {STAGES.map((s) => (
            <li key={s.label}>
              <StageTile image={s.image} label={s.label} size="sm" />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
