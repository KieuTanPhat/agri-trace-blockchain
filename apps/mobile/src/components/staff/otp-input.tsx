import { useRef, useState, type ComponentRef } from "react";
import { TextInput, View } from "react-native";
import { color, font, radius } from "../../theme/staff";
import { T } from "./ui";

/** Six inputs with paste/autofill distribution and predictable keyboard focus. */
export function OtpInput({
  digits,
  onChange,
  disabled = false,
}: {
  digits: string[];
  onChange: (digits: string[]) => void;
  disabled?: boolean;
}) {
  const inputs = useRef<(ComponentRef<typeof TextInput> | null)[]>([]);
  const [focused, setFocused] = useState<number | null>(null);
  function change(index: number, text: string) {
    const numbers = text.replace(/\D/g, "").slice(0, 6);
    const next = [...digits];
    if (!numbers) {
      next[index] = "";
    } else {
      const start = numbers.length === 6 ? 0 : index;
      for (
        let offset = 0;
        offset < numbers.length && start + offset < 6;
        offset++
      )
        next[start + offset] = numbers[offset];
      inputs.current[Math.min(5, start + numbers.length)]?.focus();
    }
    onChange(next);
  }
  return (
    <View style={{ gap: 10 }}>
      <T>Mã xác minh 6 số</T>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {digits.map((digit, index) => (
          <TextInput
            key={index}
            ref={(input) => {
              inputs.current[index] = input;
            }}
            accessibilityLabel={`Chữ số ${index + 1}`}
            value={digit}
            onChangeText={(text) => change(index, text)}
            onKeyPress={({ nativeEvent }) => {
              if (nativeEvent.key === "Backspace" && !digit && index > 0) {
                const next = [...digits];
                next[index - 1] = "";
                onChange(next);
                inputs.current[index - 1]?.focus();
              }
            }}
            onFocus={() => setFocused(index)}
            onBlur={() => setFocused(null)}
            keyboardType="number-pad"
            textContentType={index === 0 ? "oneTimeCode" : "none"}
            autoComplete={index === 0 ? "one-time-code" : "off"}
            autoCapitalize="none"
            maxLength={6}
            selectTextOnFocus
            editable={!disabled}
            style={{
              flex: 1,
              minWidth: 0,
              height: 56,
              padding: 0,
              borderWidth: 1,
              borderRadius: radius.md,
              borderColor: focused === index ? color.green : color.field,
              backgroundColor: color.surface,
              color: color.ink,
              fontFamily: font.bold,
              fontSize: 24,
              textAlign: "center",
            }}
          />
        ))}
      </View>
    </View>
  );
}
