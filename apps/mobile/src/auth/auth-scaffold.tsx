import type { PropsWithChildren } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ArrowLeft, Leaf, Check } from "lucide-react-native";
import { router } from "expo-router";
import { Card, Screen, styles } from "../components/ui";
import { GreenSurface } from "../components/green-surface";
import { colors, fonts, space } from "../theme/tokens";

export function AuthScaffold({
  children,
  title,
  subtitle,
  steps,
  current = 0,
  onBack,
}: PropsWithChildren<{
  title: string;
  subtitle: string;
  steps?: string[];
  current?: number;
  onBack?: () => void;
}>) {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <Screen>
        <View style={auth.brandRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quay lại màn trước"
            onPress={
              onBack ??
              (() =>
                router.canGoBack() ? router.back() : router.replace("/account"))
            }
            style={auth.back}
          >
            <ArrowLeft size={21} color={colors.forest} />
          </Pressable>
          <Image
            source={require("../../assets/brand/logo-agritrace.webp")}
            accessibilityLabel="AgriTrace — Truy xuất nguồn gốc nông sản Việt"
            resizeMode="contain"
            style={auth.logo}
          />
          <View style={auth.brandChip}>
            <Leaf size={20} color={colors.green} />
          </View>
        </View>
        <GreenSurface style={auth.hero}>
          <View pointerEvents="none" style={auth.decoration}>
            <Leaf size={120} color="rgba(255,255,255,0.07)" strokeWidth={1} />
          </View>
          <Text style={auth.eyebrow}>KẾT NỐI CÙNG NGUỒN GỐC</Text>
          <Text accessibilityRole="header" style={auth.title}>
            {title}
          </Text>
          <Text style={auth.subtitle}>{subtitle}</Text>
        </GreenSurface>
        {steps && (
          <View
            style={auth.progress}
            accessibilityLabel={`Bước ${current + 1} trên ${steps.length}: ${steps[current]}`}
          >
            {steps.map((label, index) => (
              <View key={label} style={auth.progressItem}>
                <View
                  style={[
                    auth.progressCircle,
                    index <= current && {
                      backgroundColor: colors.green,
                      borderColor: colors.green,
                    },
                  ]}
                >
                  {index < current ? (
                    <Check size={15} color={colors.paper} />
                  ) : (
                    <Text
                      style={[
                        auth.progressNumber,
                        index === current && { color: colors.paper },
                      ]}
                    >
                      {index + 1}
                    </Text>
                  )}
                </View>
                <Text
                  style={[
                    auth.progressLabel,
                    index === current && {
                      color: colors.forest,
                      fontFamily: fonts.bold,
                    },
                  ]}
                >
                  {label}
                </Text>
              </View>
            ))}
          </View>
        )}
        <Card stableNativeChildren style={auth.form}>{children}</Card>
        <Text style={[styles.small, { textAlign: "center" }]}>
          ACheck · Một lần quét, hiểu nguồn gốc.{"\n"}Tra cứu công khai luôn
          dùng được mà không cần tài khoản.
        </Text>
      </Screen>
    </KeyboardAvoidingView>
  );
}
const auth = StyleSheet.create({
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  logo: {
    width: 148,
    height: 66,
    borderRadius: 14,
    backgroundColor: colors.paper,
  },
  brandChip: {
    width: 44,
    height: 44,
    backgroundColor: colors.pale,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  back: {
    width: 44,
    height: 44,
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  hero: { borderRadius: 28, padding: space.xl, gap: space.md },
  decoration: {
    position: "absolute",
    right: -25,
    bottom: -22,
    transform: [{ rotate: "-15deg" }],
  },
  eyebrow: {
    fontFamily: fonts.bold,
    fontSize: 10,
    lineHeight: 18,
    letterSpacing: 1.2,
    color: "#c6ead5",
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 27,
    lineHeight: 38,
    color: colors.paper,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 23,
    color: "#dcf3e5",
  },
  form: { padding: space.lg, borderRadius: 26, gap: 20 },
  progress: { flexDirection: "row", paddingVertical: 4, gap: 8 },
  progressItem: { flex: 1, alignItems: "center", gap: 7 },
  progressCircle: {
    height: 29,
    width: 29,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
  },
  progressNumber: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted },
  progressLabel: {
    textAlign: "center",
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 18,
    color: colors.muted,
  },
});
