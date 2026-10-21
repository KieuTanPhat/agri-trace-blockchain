import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { styles } from "../components/ui";
import { colors, space } from "../theme/tokens";
import {
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  Smartphone,
  UserRound,
  KeyRound,
} from "lucide-react-native";

export function AuthField({
  label,
  value,
  onChangeText,
  error,
  password = false,
  disabled = false,
  kind = "phone",
  newPassword = false,
}: {
  label: string;
  value: string;
  onChangeText(value: string): void;
  error?: string;
  password?: boolean;
  disabled?: boolean;
  kind?: "phone" | "text" | "email" | "otp";
  newPassword?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const Icon = password
    ? LockKeyhole
    : kind === "email"
      ? Mail
      : kind === "text"
        ? UserRound
        : kind === "otp"
          ? KeyRound
          : Smartphone;
  return (
    <View style={{ gap: space.sm }}>
      <Text style={styles.value}>{label}</Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingLeft: 14,
          backgroundColor: focused ? colors.paper : colors.pale,
          borderWidth: 1,
          borderRadius: 16,
          borderColor: error
            ? colors.danger
            : focused
              ? colors.green
              : colors.line,
          opacity: disabled ? 0.65 : 1,
        }}
      >
        <Icon size={19} color={error ? colors.danger : colors.green} />
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          editable={!disabled}
          secureTextEntry={password && !visible}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={
            password || kind === "text"
              ? "default"
              : kind === "email"
                ? "email-address"
                : kind === "phone"
                  ? "phone-pad"
                  : "number-pad"
          }
          autoComplete={
            password
              ? newPassword
                ? "new-password"
                : "current-password"
              : kind === "phone"
                ? "tel"
                : kind === "otp"
                  ? "sms-otp"
                  : "off"
          }
          textContentType={
            password
              ? newPassword
                ? "newPassword"
                : "password"
              : kind === "phone"
                ? "telephoneNumber"
                : kind === "otp"
                  ? "oneTimeCode"
                  : "none"
          }
          maxLength={
            password
              ? undefined
              : kind === "phone"
                ? 13
                : kind === "otp"
                  ? 6
                  : 255
          }
          style={[
            styles.input,
            {
              flex: 1,
              minWidth: 0,
              borderWidth: 0,
              backgroundColor: "transparent",
              paddingLeft: 0,
              paddingRight: password ? 0 : 14,
            },
            kind === "otp" && { letterSpacing: 6, fontSize: 22 },
          ]}
        />
        {password && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
            disabled={disabled}
            accessibilityState={{ disabled }}
            onPress={() => setVisible((previous) => !previous)}
            style={{
              minHeight: 48,
              minWidth: 46,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 10,
            }}
          >
            {visible ? (
              <EyeOff size={20} color={colors.muted} />
            ) : (
              <Eye size={20} color={colors.muted} />
            )}
          </Pressable>
        )}
      </View>
      {error && (
        <Text
          accessibilityRole="alert"
          style={[styles.small, { color: colors.danger }]}
        >
          {error}
        </Text>
      )}
    </View>
  );
}
