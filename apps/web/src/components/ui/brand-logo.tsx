import Image from "next/image";

/** The AgriTrace logo (A-star mark, wordmark and tagline). */
export function BrandLogo({ height = 44, priority = false }: { height?: number; priority?: boolean }) {
  return (
    <Image
      src="/agritrace/brand/agritrace-logo.png"
      alt="AgriTrace — Truy xuất nguồn gốc nông sản Việt"
      width={Math.round((height * 720) / 212)}
      height={height}
      priority={priority}
    />
  );
}
