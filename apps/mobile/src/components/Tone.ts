import type { Tone } from "../labels";
import type { ColorName } from "../theme/tokens";
import type { IconName } from "./Icon";

export const TONE_COLORS: Record<Tone, { fg: ColorName; bg: ColorName; icon: IconName }> = {
  success: { fg: "success", bg: "success-bg", icon: "check" },
  warning: { fg: "warning", bg: "warning-bg", icon: "clock" },
  danger: { fg: "danger", bg: "danger-bg", icon: "alert" },
  info: { fg: "info", bg: "info-bg", icon: "bell" },
  neutral: { fg: "neutral", bg: "neutral-bg", icon: "box" },
};
