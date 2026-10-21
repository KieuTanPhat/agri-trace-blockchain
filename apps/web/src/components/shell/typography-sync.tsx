"use client";

import { useEffect } from "react";
import {
  applyTypography,
  loadTypography,
  TYPOGRAPHY_EVENT,
  type Typography,
} from "@/lib/typography";
import {
  applyAppearance,
  loadAppearance,
  APPEARANCE_EVENT,
  type Appearance,
} from "@/lib/appearance";

/** Applies the typography saved in Cài đặt, and follows later changes made in
 * this tab or another one. */
export function TypographySync() {
  useEffect(() => {
    applyTypography(loadTypography());
    applyAppearance(loadAppearance());
    const onAppearance = (event: Event) =>
      applyAppearance(
        (event as CustomEvent<Appearance>).detail ?? loadAppearance(),
      );
    const onChange = (event: Event) =>
      applyTypography(
        (event as CustomEvent<Typography>).detail ?? loadTypography(),
      );
    const onStorage = (event: StorageEvent) => {
      if (event.key?.startsWith("agritrace:typography"))
        applyTypography(loadTypography());
      if (event.key?.startsWith("agritrace:appearance") || event.key === null)
        applyAppearance(loadAppearance());
    };
    window.addEventListener(TYPOGRAPHY_EVENT, onChange);
    window.addEventListener(APPEARANCE_EVENT, onAppearance);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(TYPOGRAPHY_EVENT, onChange);
      window.removeEventListener(APPEARANCE_EVENT, onAppearance);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return null;
}
