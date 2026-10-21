import { router } from "expo-router";
import { Button, Screen, Title } from "../src/components/ui";

export default function NotFoundScreen() {
  return (
    <Screen>
      <Title subtitle="Đường dẫn này không tồn tại trong ACheck.">
        Không tìm thấy trang
      </Title>
      <Button label="Về trang chủ" onPress={() => router.replace("/")} />
    </Screen>
  );
}
