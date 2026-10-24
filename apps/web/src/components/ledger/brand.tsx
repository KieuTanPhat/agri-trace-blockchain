import Image from "next/image";
import { cn } from "@/lib/ledger/utils";

/** Logo chính thức Agritrace (public/brand) — bản sáng/tối theo giao diện. */
export function AgritraceLogo({ height = 28, className, priority }: { height?: number; className?: string; priority?: boolean }) {
  const width = Math.round((height * 720) / 212);
  return (
    <span className={cn("inline-flex shrink-0", className)} style={{ height, width }}>
      <Image src="/brand/agritrace-logo.png" alt="Agritrace" width={width} height={height} priority={priority} style={{ width: "auto", height: "100%" }} className="h-full w-auto dark:hidden" />
      <Image src="/brand/agritrace-logo-on-dark.png" alt="Agritrace" width={width} height={height} priority={priority} style={{ width: "auto", height: "100%" }} className="hidden h-full w-auto dark:block" />
    </span>
  );
}

export function AgritraceMark({ size = 28, className }: { size?: number; className?: string }) {
  return <Image src="/brand/agritrace-mark.png" alt="Agritrace" width={Math.round((size * 256) / 211)} height={size} className={cn("shrink-0", className)} />;
}
