import { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { Keyboard, Pressable, Text, View } from "react-native";
import { Button, Notice, Screen, Title, styles } from "../components/ui";
import { AuthField } from "./auth-field";
import { demoSession, useAuth, realAuthEnabled } from "./use-auth";
import { normalizePhone, validateLogin } from "./validation";
import { AuthScaffold } from "./auth-scaffold";
import { colors, space } from "../theme/tokens";

export default function LoginScreen() {
  const auth = useAuth();
  const waiting =
    auth.status === "authenticating" ||
    auth.status === "restoring" ||
    auth.status === "logoutPending";
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const errors = validateLogin(phone, password);
  useFocusEffect(
    useCallback(
      () => () => {
        setPassword("");
        demoSession.cancelLogin();
      },
      [],
    ),
  );
  async function submit() {
    setSubmitted(true);
    if (errors.phone || errors.password) return;
    Keyboard.dismiss();
    const success = await demoSession.login(normalizePhone(phone)!, password);
    if (success) {
      setPassword("");
      router.replace("/account");
    }
  }
  if (!auth.available)
    return (
      <Screen>
        <Title>Đăng nhập</Title>
        <Notice>
          Tính năng tài khoản sắp ra mắt. Bạn vẫn có thể tra cứu, tìm sản phẩm
          và doanh nghiệp mà không đăng nhập.
        </Notice>
        <Button
          label="Tiếp tục tra cứu"
          onPress={() => router.replace("/scan")}
        />
      </Screen>
    );
  return (
    <AuthScaffold
      title="Chào mừng bạn trở lại"
      subtitle="Tiếp tục khám phá hành trình nông sản cùng ACheck."
    >
      <Text accessibilityRole="header" style={styles.heading}>
        Đăng nhập
      </Text>
      <AuthField
        label="Số điện thoại"
        value={phone}
        onChangeText={setPhone}
        error={submitted ? errors.phone : undefined}
        disabled={waiting}
      />
      <AuthField
        label="Mật khẩu"
        value={password}
        onChangeText={setPassword}
        password
        error={submitted ? errors.password : undefined}
        disabled={waiting}
      />
      {auth.error ? <Notice danger>{auth.error}</Notice> : null}
      <Button
        label={realAuthEnabled ? "Đăng nhập" : "Đăng nhập bản thử"}
        disabled={waiting}
        busy={auth.status === "authenticating" || auth.status === "restoring"}
        onPress={() => void submit()}
      />
      <Button
        label={
          realAuthEnabled ? "Đăng ký thử nghiệm SMS thật" : "Đăng ký bản thử"
        }
        secondary
        disabled={waiting}
        onPress={() => router.push("/register")}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Quên mật khẩu"
        disabled={waiting}
        onPress={() => router.push("/forgot-password")}
        style={{
          minHeight: 44,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Text
          style={[
            styles.value,
            { color: colors.green, textDecorationLine: "underline" },
          ]}
        >
          Quên mật khẩu?
        </Text>
      </Pressable>
      {!realAuthEnabled && (
        <View
          style={{
            gap: space.sm,
            borderTopWidth: 1,
            borderColor: colors.line,
            paddingTop: space.lg,
          }}
        >
          <Text style={styles.small}>
            Tài khoản demo: 0900000000 · Mật khẩu: Demo-only-1234
          </Text>
          <Notice>
            BẢN THỬ DEV — không tạo tài khoản thật, không gửi SMS. Chỉ nhập dữ
            liệu giả. Phiên demo chỉ nằm trong bộ nhớ, đóng app sẽ mất.
          </Notice>
        </View>
      )}
      {realAuthEnabled && (
        <Notice>
          Bản dev kết nối API và Firebase thật. Không dùng tài khoản doanh
          nghiệp. Nếu nhận lỗi sau khi gửi đăng ký, hãy thử đăng nhập thay vì
          gửi lại nhiều lần.
        </Notice>
      )}
      <Text style={styles.small}>
        Không sử dụng tài khoản doanh nghiệp trên màn này.
      </Text>
    </AuthScaffold>
  );
}
