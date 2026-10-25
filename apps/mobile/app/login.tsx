import type { ComponentType } from "react";
import { router } from "expo-router";
import { Button, Notice } from "../src/components/ui";
import { AuthScaffold } from "../src/auth/auth-scaffold";
import { authDemoEnabled } from "../src/auth/types";
import { realAuthEnabled, accountAvailable } from "../src/auth/use-auth";

let DemoLogin: ComponentType | undefined;
if (
  __DEV__ &&
  ((realAuthEnabled && accountAvailable()) ||
    (!realAuthEnabled &&
      accountAvailable() &&
      authDemoEnabled(__DEV__, process.env.EXPO_PUBLIC_AUTH_DEMO)))
) {
  DemoLogin = (
    require("../src/auth/dev-login-screen") as typeof import("../src/auth/dev-login-screen")
  ).default;
}
export default function LoginScreen() {
  if (DemoLogin) return <DemoLogin />;
  return (
    <AuthScaffold
      title="Chào mừng đến ACheck"
      subtitle="Khám phá nguồn gốc nông sản. Tính năng tài khoản đang được hoàn thiện."
    >
      <Notice>
        Tính năng tài khoản sắp ra mắt. Bạn vẫn có thể tra cứu, tìm sản phẩm và
        doanh nghiệp mà không đăng nhập.
      </Notice>
      <Button
        label="Tiếp tục tra cứu"
        onPress={() => router.replace("/scan")}
      />
    </AuthScaffold>
  );
}
