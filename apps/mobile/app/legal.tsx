import type { ComponentType } from "react";
import { Notice, Screen, Title } from "../src/components/ui";
import { authDemoEnabled } from "../src/auth/types";
import { realAuthEnabled } from "../src/auth/use-auth";
import { Text } from "react-native";
let Preview: ComponentType | undefined;
if (__DEV__ && authDemoEnabled(__DEV__, process.env.EXPO_PUBLIC_AUTH_DEMO)) {
  Preview = (
    require("../src/auth/dev-legal-screen") as typeof import("../src/auth/dev-legal-screen")
  ).default;
}
export default function LegalScreen() {
  if (__DEV__ && realAuthEnabled) {
    const { devConsumerNotice } =
      require("../src/auth/dev-consumer-notice") as typeof import("../src/auth/dev-consumer-notice");
    return (
      <Screen>
        <Title>Thông báo thử nghiệm — chưa phải chính sách chính thức</Title>
        {devConsumerNotice.sections.map((section) => (
          <Notice key={section.title}>
            <Text>
              {section.title}
              {"\n"}
              {section.body}
            </Text>
          </Notice>
        ))}
      </Screen>
    );
  }
  if (Preview) return <Preview />;
  return (
    <Screen>
      <Title>Điều khoản và Chính sách</Title>
      <Notice>
        Văn bản chính thức đang chờ phê duyệt. Chức năng đăng ký tài khoản chưa
        được mở.
      </Notice>
    </Screen>
  );
}
