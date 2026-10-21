import { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { ArrowUpRight, History, Trash2 } from "lucide-react-native";
import {
  Button,
  Card,
  Notice,
  Screen,
  Title,
  styles,
} from "../src/components/ui";
import { localHistory } from "../src/scan/local-history";
import type { HistoryEntry } from "../src/scan/history";
import { formatDate } from "../src/trace/presentation";
import { colors, space } from "../src/theme/tokens";

export default function HistoryScreen() {
  const [items, setItems] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [revision, setRevision] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let current = true;
      setError("");
      setItems(null);
      localHistory
        .list()
        .then((value) => {
          if (current) setItems(value);
        })
        .catch((cause: unknown) => {
          if (current)
            setError(
              cause instanceof Error
                ? cause.message
                : "Không đọc được lịch sử trên thiết bị.",
            );
        });
      return () => {
        current = false;
      };
    }, [revision]),
  );

  async function clear() {
    setClearing(true);
    try {
      await localHistory.clear();
      setItems([]);
      setError("");
      setConfirming(false);
    } catch {
      setError("Chưa xóa được lịch sử trên thiết bị. Vui lòng thử lại.");
    } finally {
      setClearing(false);
    }
  }
  return (
    <Screen>
      <Title subtitle="Chỉ nằm trên thiết bị này, tối đa 50 mục. Mỗi lần mở sẽ lấy lại dữ liệu mới.">
        Những mã đã xem
      </Title>
      {error ? (
        <>
          <Notice danger>{error}</Notice>
          <Button
            label="Thử đọc lại"
            secondary
            onPress={() => setRevision((value) => value + 1)}
          />
        </>
      ) : null}
      {!items && !error ? (
        <ActivityIndicator
          color={colors.green}
          accessibilityLabel="Đang đọc lịch sử"
        />
      ) : null}
      {items?.length === 0 ? (
        <Card>
          <History size={38} color={colors.green} />
          <Text style={styles.heading}>Chưa có lịch sử tra cứu</Text>
          <Text style={styles.body}>
            Quét một mã QR để bắt đầu tìm hiểu hành trình sản phẩm.
          </Text>
          <Button label="Quét mã QR" onPress={() => router.navigate("/scan")} />
        </Card>
      ) : null}
      {items?.map((item) => (
        <Pressable
          key={item.token}
          accessibilityRole="button"
          accessibilityLabel={`Xem lại ${item.productName}`}
          onPress={() =>
            router.push({
              pathname: "/trace/[token]",
              params: { token: item.token },
            })
          }
        >
          <Card>
            <View
              style={{
                flexDirection: "row",
                gap: space.lg,
                alignItems: "center",
              }}
            >
              <View style={{ flex: 1, gap: space.sm }}>
                <Text style={styles.value}>{item.productName}</Text>
                <Text style={styles.small}>
                  Đã xem {formatDate(item.viewedAt)}
                </Text>
              </View>
              <ArrowUpRight size={21} color={colors.green} />
            </View>
          </Card>
        </Pressable>
      ))}
      {Boolean(items?.length || error) && (
        <Card>
          {confirming ? (
            <>
              <Text style={styles.body}>
                Xóa toàn bộ lịch sử tra cứu trên thiết bị này?
              </Text>
              <Button
                label="Xác nhận xóa lịch sử"
                busy={clearing}
                onPress={() => void clear()}
              />
              <Button
                label="Giữ lại"
                secondary
                disabled={clearing}
                onPress={() => setConfirming(false)}
              />
            </>
          ) : (
            <Button
              label="Xóa lịch sử trên thiết bị"
              secondary
              icon={<Trash2 size={19} color={colors.green} />}
              onPress={() => setConfirming(true)}
            />
          )}
        </Card>
      )}
    </Screen>
  );
}
