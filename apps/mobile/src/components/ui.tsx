import type { PropsWithChildren, ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { ArrowRight, AlertCircle } from "lucide-react-native";
import { colors, fonts, space } from "../theme/tokens";
import { mobileLayout } from "../theme/layout";
import { GreenSurface } from "./green-surface";

export function Screen({ children }: PropsWithChildren) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: mobileLayout(width).horizontalPadding,
            paddingBottom: space.huge + insets.bottom,
          },
        ]}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
export function Title({
  children,
  subtitle,
}: PropsWithChildren<{ subtitle?: string }>) {
  return (
    <View style={{ gap: space.sm, paddingTop: space.sm }}>
      <Text accessibilityRole="header" style={styles.title}>
        {children}
      </Text>
      {subtitle && <Text style={styles.body}>{subtitle}</Text>}
    </View>
  );
}
export function Card({
  children,
  style,
  stableNativeChildren = false,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle>; stableNativeChildren?: boolean }>) {
  return (
    <View
      collapsable={stableNativeChildren ? false : undefined}
      collapsableChildren={stableNativeChildren ? false : undefined}
      style={[styles.card, style]}
    >
      {children}
    </View>
  );
}
export function SectionTitle({ children }: PropsWithChildren) {
  return (
    <Text accessibilityRole="header" style={styles.heading}>
      {children}
    </Text>
  );
}
export function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
  busy = false,
  icon,
  accent = false,
}: {
  label: string;
  onPress(): void;
  secondary?: boolean;
  disabled?: boolean;
  busy?: boolean;
  icon?: ReactNode;
  accent?: boolean;
}) {
  return (
    <Pressable
      collapsable={false}
      collapsableChildren={false}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        accent && { backgroundColor: colors.amber, borderColor: colors.amber },
        (disabled || busy) && { opacity: 0.5 },
        pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
      ]}
    >
      <View key="background" collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill}>
        {!secondary && !accent && (
          <GreenSurface
            style={[StyleSheet.absoluteFill, { borderRadius: 14 }]}
          />
        )}
      </View>
      <View key="leading" collapsable={false} style={styles.buttonSlot}>
        <ActivityIndicator
          animating={busy}
          color={secondary || accent ? colors.green : colors.paper}
          style={[StyleSheet.absoluteFill, { opacity: busy ? 1 : 0 }]}
        />
        <View collapsable={false} style={{ opacity: busy ? 0 : 1 }}>
          {icon}
        </View>
      </View>
      <Text
        key="label"
        style={[
          styles.buttonLabel,
          (secondary || accent) && { color: colors.forest },
        ]}
      >
        {label}
      </Text>
      <View key="trailing" collapsable={false} style={[
        styles.buttonSlot,
        { opacity: secondary || busy ? 0 : 1 },
      ]}>
          <ArrowRight size={18} color={accent ? colors.forest : colors.paper} />
      </View>
    </Pressable>
  );
}
export function Notice({
  children,
  danger = false,
}: PropsWithChildren<{ danger?: boolean }>) {
  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, danger && { backgroundColor: colors.dangerPale }]}
    >
      <AlertCircle size={19} color={danger ? colors.danger : colors.warning} />
      <Text
        style={[
          styles.body,
          { color: danger ? colors.danger : colors.warning, flex: 1 },
        ]}
      >
        {children}
      </Text>
    </View>
  );
}
export function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.keyValue}>
      <Text style={styles.small}>{label}</Text>
      <Text selectable style={styles.value}>
        {value}
      </Text>
    </View>
  );
}
export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: space.xl,
    paddingBottom: space.huge,
    gap: space.xl,
    maxWidth: 680,
    width: "100%",
    alignSelf: "center",
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 27,
    lineHeight: 38,
    color: colors.ink,
  },
  heading: {
    fontFamily: fonts.bold,
    fontSize: 18,
    lineHeight: 27,
    color: colors.ink,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 24,
    color: colors.muted,
  },
  small: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
  },
  card: {
    backgroundColor: colors.paper,
    borderRadius: 20,
    padding: space.xl,
    gap: space.lg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  button: {
    minHeight: 52,
    overflow: "hidden",
    borderRadius: 14,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    backgroundColor: colors.green,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: space.md,
  },
  buttonLabel: {
    fontFamily: fonts.bold,
    fontSize: 14,
    lineHeight: 22,
    color: colors.paper,
    flexShrink: 1,
    textAlign: "center",
  },
  buttonSlot: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  secondary: {
    backgroundColor: colors.pale,
    borderWidth: 1,
    borderColor: colors.line,
  },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.md,
    padding: space.lg,
    borderRadius: 14,
    backgroundColor: colors.warningPale,
  },
  keyValue: {
    gap: 3,
    borderBottomWidth: 1,
    borderColor: colors.line,
    paddingBottom: space.md,
  },
  value: {
    fontFamily: fonts.bold,
    fontSize: 14,
    lineHeight: 23,
    color: colors.ink,
  },
  input: {
    fontFamily: fonts.regular,
    color: colors.ink,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    minHeight: 54,
    padding: space.lg,
    fontSize: 16,
  },
});
