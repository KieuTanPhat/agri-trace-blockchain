import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { useTheme } from "../theme/ThemeProvider";
import type { ColorName } from "../theme/tokens";
import { AppText } from "./AppText";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "secondary" | "ghost" | "danger";

type Props = {
  children: string;
  onPress?: () => void;
  variant?: Variant;
  /** `lg` (56px) is for field flows: harvest, handover, receiving. */
  size?: "md" | "lg";
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
};

const COLORS: Record<Variant, { bg: ColorName | "transparent"; pressed: ColorName; fg: ColorName; border?: ColorName }> = {
  primary: { bg: "primary", pressed: "primary-strong", fg: "on-primary" },
  secondary: { bg: "surface", pressed: "surface-sunken", fg: "primary", border: "control-border" },
  ghost: { bg: "transparent", pressed: "primary-soft", fg: "primary" },
  danger: { bg: "danger-bg", pressed: "danger-bg", fg: "danger", border: "danger" },
};

/** One primary button per screen. While `loading`, the button stays locked so a command is never sent twice. */
export function Button({ children, onPress, variant = "primary", size = "md", icon, loading, disabled, accessibilityHint }: Props) {
  const { colors, radius, space } = useTheme();
  const palette = COLORS[variant];
  const inactive = disabled || loading;
  const fg = inactive ? colors.muted : colors[palette.fg];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: size === "lg" ? space.touchField : space.touchMin,
          borderRadius: size === "lg" ? radius.lg : radius.md,
          paddingHorizontal: space.s5,
          backgroundColor: inactive
            ? colors["surface-sunken"]
            : pressed
              ? colors[palette.pressed]
              : palette.bg === "transparent"
                ? "transparent"
                : colors[palette.bg],
          borderColor: !inactive && palette.border ? colors[palette.border] : "transparent",
          transform: [{ scale: pressed && !inactive ? 0.98 : 1 }],
        },
      ]}
    >
      <View style={styles.row}>
        {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={20} color={fg} /> : null}
        <AppText variant="body-strong" style={{ color: fg }}>
          {children}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
});
