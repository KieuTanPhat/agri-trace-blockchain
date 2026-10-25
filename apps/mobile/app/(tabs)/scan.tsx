import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router, useFocusEffect } from "expo-router";
import { Camera, ScanLine } from "lucide-react-native";
import {
  Button,
  Card,
  Notice,
  Screen,
  Title,
  styles,
} from "../../src/components/ui";
import { colors, fonts, space } from "../../src/theme/tokens";
import { traceOrigin } from "../../src/config";
import { parseTraceToken } from "../../src/scan/parse-token";
import { ScanOverlay } from "../../src/components/ambient-motion";

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const [opened, setOpened] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [input, setInput] = useState("");
  const [message, setMessage] = useState("");
  const navigating = useRef(false);
  const screenFocused = useRef(false);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      screenFocused.current = true;
      navigating.current = false;
      return () => {
        screenFocused.current = false;
        setFocused(false);
        setOpened(false);
      };
    }, []),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setForeground(state === "active");
      if (state !== "active") setOpened(false);
    });
    return () => subscription.remove();
  }, []);

  function submit(value: string, fromCamera = false) {
    if (navigating.current) return;
    if (fromCamera) setOpened(false);
    const token = parseTraceToken(value, traceOrigin);
    if (!token) {
      setMessage(
        "Mã chưa hợp lệ. Hãy dùng mã truy xuất hoặc đường dẫn AgriTrace đúng cấu hình.",
      );
      return;
    }
    navigating.current = true;
    setMessage("");
    setOpened(false);
    router.push({ pathname: "/trace/[token]", params: { token } });
  }

  async function openCamera() {
    if (requesting) return;
    setRequesting(true);
    setMessage("");
    try {
      const next = permission?.granted ? permission : await requestPermission();
      if (!screenFocused.current || AppState.currentState !== "active") return;
      if (next.granted) setOpened(true);
      else
        setMessage(
          "Camera chưa được cấp quyền. Bạn vẫn có thể nhập mã bên dưới; hoặc mở Cài đặt của thiết bị để cấp quyền.",
        );
    } catch {
      setMessage(
        "Không mở được camera trên thiết bị này. Vui lòng nhập mã thủ công.",
      );
    } finally {
      setRequesting(false);
    }
  }

  const active = focused && foreground && opened && permission?.granted;
  return (
    <Screen>
      <Title subtitle="Đưa mã QR trên bao bì vào khung hoặc nhập mã bên dưới.">
        Quét mã truy xuất
      </Title>
      <View style={scan.preview}>
        {active ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => submit(data, true)}
            onMountError={() => {
              setOpened(false);
              setMessage(
                "Không khởi động được camera. Bạn có thể nhập mã thủ công.",
              );
            }}
          />
        ) : (
          <View style={scan.cameraEmpty}>
            <ScanLine size={66} color={colors.green} />
            <Text style={scan.previewTitle}>Nguồn gốc trong một lần quét</Text>
            <Text style={[styles.body, { textAlign: "center" }]}>
              Camera chỉ dùng khi bạn bật quét.{"\n"}Không lưu hoặc tải hình ảnh
              lên.
            </Text>
          </View>
        )}
        {active && <ScanOverlay />}
      </View>
      <Button
        label={active ? "Tắt camera" : "Bật camera để quét"}
        busy={requesting}
        icon={<Camera size={21} color={colors.paper} />}
        onPress={() => (active ? setOpened(false) : void openCamera())}
      />
      {message ? <Notice danger>{message}</Notice> : null}
      <Card>
        <Text accessibilityRole="header" style={styles.heading}>
          Nhập mã thủ công
        </Text>
        <Text style={styles.body}>
          Dán mã hoặc đường dẫn truy xuất AgriTrace. App sẽ lấy thông tin lô
          hàng trong hệ thống.
        </Text>
        <Text accessibilityRole="text" style={styles.value}>
          Mã hoặc đường dẫn truy xuất
        </Text>
        <TextInput
          accessibilityLabel="Mã hoặc đường dẫn truy xuất"
          placeholder="Dán mã QR tại đây"
          placeholderTextColor={colors.muted}
          value={input}
          onChangeText={setInput}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={2048}
          returnKeyType="search"
          style={styles.input}
          onSubmitEditing={() => submit(input)}
        />
        <Button
          label="Tra cứu thông tin"
          disabled={!input.trim()}
          onPress={() => submit(input)}
        />
      </Card>
    </Screen>
  );
}
const scan = StyleSheet.create({
  preview: {
    minHeight: 280,
    height: 300,
    backgroundColor: colors.pale,
    borderRadius: 24,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.line,
  },
  cameraEmpty: { gap: space.lg, alignItems: "center", padding: space.xl },
  previewTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    lineHeight: 26,
    textAlign: "center",
    color: colors.ink,
  },
});
