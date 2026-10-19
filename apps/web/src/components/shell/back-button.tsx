"use client";

import { useRouter } from "next/navigation";

/** Back link shown on every management page except the home route. Pages whose
 * header already has a back link hide this one through CSS (`:has(.manage-back)`). */
export function BackButton({ pathname, home }: { pathname: string; home: string }) {
  const router = useRouter();
  if (pathname === home) return null;
  const parent = pathname.split("/").slice(0, -1).join("/") || home;
  return (
    <button
      type="button"
      className="manage-back shell-back"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(parent);
      }}
    >
      ← Quay lại
    </button>
  );
}
