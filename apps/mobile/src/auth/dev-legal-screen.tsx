import { router } from "expo-router";
import { Text } from "react-native";
import { Button, Card, Screen, Title, styles } from "../components/ui";
import { legalPreview, PREVIEW_CONSENT_VERSION } from "./legal-preview";
export default function DevLegalScreen() {
  return (
    <Screen>
      <Title>Bản giữ chỗ Điều khoản và Chính sách</Title>
      <Text style={styles.small}>Phiên bản: {PREVIEW_CONSENT_VERSION}</Text>
      {legalPreview.map((section) => (
        <Card key={section.title}>
          <Text style={styles.heading}>{section.title}</Text>
          <Text style={styles.body}>{section.body}</Text>
        </Card>
      ))}
      <Button label="Quay lại" secondary onPress={() => router.back()} />
    </Screen>
  );
}
