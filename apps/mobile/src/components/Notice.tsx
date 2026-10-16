import type { ReactNode } from "react";
import { View } from "react-native";

import type { Tone } from "../labels";
import { useTheme } from "../theme/ThemeProvider";
import { AppText } from "./AppText";
import { Icon } from "./Icon";
import { TONE_COLORS } from "./Tone";

/** In-page business warning: recall, expiry, missing sensor data, mismatches. */
export function Notice({ tone = "info", title, children }: { tone?: Tone; title: string; children?: ReactNode }) {
  const { colors, radius, space } = useTheme();
  const toneColors = TONE_COLORS[tone];
  return (
    <View
      accessibilityRole={tone === "danger" ? "alert" : "summary"}
      style={{ flexDirection: "row", gap: space.s3, padding: space.s4, borderRadius: radius.lg, backgroundColor: colors[toneColors.bg] }}
    >
      <Icon name={toneColors.icon} size={22} color={colors[toneColors.fg]} />
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="body-strong" style={{ color: colors[toneColors.fg] }}>
          {title}
        </AppText>
        {typeof children === "string" ? (
          <AppText variant="body-sm" color="ink-soft">
            {children}
          </AppText>
        ) : (
          children
        )}
      </View>
    </View>
  );
}
