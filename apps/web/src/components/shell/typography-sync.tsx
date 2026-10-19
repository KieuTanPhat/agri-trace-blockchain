"use client";

import { useEffect } from "react";
import { applyTypography, loadTypography, TYPOGRAPHY_EVENT, type Typography } from "@/lib/typography";

/** Applies the typography saved in Cài đặt, and follows later changes made in
 * this tab or another one. */
export function TypographySync() {
  useEffect(() => {
    applyTypography(loadTypography());
    const onChange = (event: Event) =>
      applyTypography((event as CustomEvent<Typography>).detail ?? loadTypography());
    const onStorage = (event: StorageEvent) => {
      if (event.key?.startsWith("agritrace:typography")) applyTypography(loadTypography());
    };
    window.addEventListener(TYPOGRAPHY_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(TYPOGRAPHY_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return null;
}
