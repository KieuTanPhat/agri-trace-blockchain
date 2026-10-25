import type { ComponentType } from "react";
import { router } from "expo-router";
import { Button, Notice } from "../components/ui";
import { AuthScaffold } from "./auth-scaffold";
import { authDemoEnabled } from "./types";
import { realAuthEnabled, accountAvailable } from "./use-auth";
let Flow: ComponentType<{ mode: "register" | "reset" }> | undefined;
if (__DEV__ && realAuthEnabled && accountAvailable()) {
  Flow = (require("./real-auth-flow") as typeof import("./real-auth-flow"))
    .default;
} else if (
  __DEV__ &&
  accountAvailable() &&
  !realAuthEnabled &&
  authDemoEnabled(__DEV__, process.env.EXPO_PUBLIC_AUTH_DEMO)
) {
  Flow = (require("./demo-auth-flow") as typeof import("./demo-auth-flow"))
    .default;
}
export function AuthRoute({ mode }: { mode: "register" | "reset" }) {
  if (Flow) return <Flow mode={mode} />;
  return (
    <AuthScaffold
      title={
        mode === "register" ? "Bắt đầu cùng ACheck" : "Khôi phục tài khoản"
      }
      subtitle="Tính năng tài khoản sắp ra mắt. Phần tra cứu công khai vẫn luôn sẵn sàng."
    >
      <Notice>
        Tính năng sắp ra mắt. Đăng ký và khôi phục tài khoản thật chưa được mở.
      </Notice>
      <Button
        label="Tiếp tục tra cứu"
        onPress={() => router.replace("/scan")}
      />
    </AuthScaffold>
  );
}
