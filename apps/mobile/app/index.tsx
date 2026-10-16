import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";

import { AppText } from "@/components/AppText";
import { Button } from "@/components/Button";
import { useTheme, type ThemeMode } from "@/theme/ThemeProvider";
import { parseTraceToken } from "@/trace/trace-input";

const MODES: { mode: ThemeMode; label: string }[] = [
  { mode: "system", label: "Theo máy" },
  { mode: "light", label: "Sáng" },
  { mode: "dark", label: "Tối" },
  { mode: "outdoor", label: "Ngoài trời" },
];

export default function LookupScreen() {
  const { colors, radius, space, type, mode, setMode } = useTheme();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function open() {
    const token = parseTraceToken(value);
    if (!token) {
      setError("Mã này không thuộc AgriTrace. Kiểm tra lại mã trên tem hoặc đường dẫn QR.");
      return;
    }
    setError(null);
    router.push({ pathname: "/trace/[token]", params: { token } });
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.s4, gap: space.s5 }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: space.s2 }}>
          <AppText variant="title-1">Kiểm tra nguồn gốc</AppText>
          <AppText color="muted">
            Nhập mã in trên tem hoặc dán đường dẫn từ mã QR để xem lô hàng đi qua những đâu và dữ liệu có khớp bằng chứng hay không.
          </AppText>
        </View>

        <View style={{ gap: 6 }}>
          <AppText variant="label" color="ink-soft" nativeID="trace-input-label">
            Mã lô hoặc đường dẫn QR
          </AppText>
          <TextInput
            accessibilityLabel="Mã lô hoặc đường dẫn QR"
            accessibilityLabelledBy="trace-input-label"
            value={value}
            onChangeText={(text) => {
              setValue(text);
              if (error) setError(null);
            }}
            onSubmitEditing={open}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            placeholder="Ví dụ: https://agritrace.dev/trace/…"
            placeholderTextColor={colors.muted}
            style={[
              type.body,
              {
                minHeight: space.touchField,
                paddingHorizontal: space.s4,
                borderRadius: radius.md,
                borderWidth: 1.5,
                borderColor: error ? colors.danger : colors["control-border"],
                backgroundColor: colors.surface,
                color: colors.ink,
              },
            ]}
          />
          {error ? (
            <AppText variant="body-sm" color="danger" accessibilityLiveRegion="polite">
              {error}
            </AppText>
          ) : null}
        </View>

        <Button size="lg" icon="shield" onPress={open} disabled={!value.trim()}>
          Xem hành trình
        </Button>

        <View style={{ gap: space.s2 }}>
          <AppText variant="label" color="muted">
            Giao diện
          </AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
            {MODES.map((option) => {
              const selected = option.mode === mode;
              return (
                <Pressable
                  key={option.mode}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setMode(option.mode)}
                  style={{
                    minHeight: 40,
                    justifyContent: "center",
                    paddingHorizontal: space.s4,
                    borderRadius: radius.full,
                    borderWidth: 1.5,
                    borderColor: selected ? colors.primary : colors["control-border"],
                    backgroundColor: selected ? colors["primary-soft"] : colors.surface,
                  }}
                >
                  <AppText variant="label" color={selected ? "primary" : "ink-soft"}>
                    {option.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          <AppText variant="caption" color="muted">
            Ngoài trời: tương phản cao, dùng khi đứng dưới nắng.
          </AppText>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
