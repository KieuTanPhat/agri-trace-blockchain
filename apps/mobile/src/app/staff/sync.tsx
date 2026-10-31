import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, View } from "react-native";
import { type Schemas } from "../../api/client";
import { retryCommand } from "../../lib/staff-command";
import { useSession } from "../../auth/session";
import {
  Button,
  Card,
  Empty,
  GreenHeader,
  IconTile,
  Notice,
  Pill,
  T,
} from "../../components/ui";
import { dateTime } from "../../lib/format";
import {
  readQueue,
  removeQueued,
  type QueuedCommand,
} from "../../lib/queue";
import { color } from "../../theme/tokens";

/**
 * Commands kept on the device. Re-sending always uses the stored key, so a
 * command whose outcome was lost is answered from the server's journal
 * instead of being applied twice.
 */
export default function Sync() {
  const { call, user } = useSession<Schemas["AuthUserDto"]>();
  const [items, setItems] = useState<QueuedCommand[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    setItems([]);
    if (user) void readQueue(user).then(setItems);
  }, [user]);
  useFocusEffect(load);

  const retry = async (item: QueuedCommand) => {
    if (
      !user ||
      item.ownerId !== user.id ||
      item.organizationId !== (user.organizationId ?? null)
    )
      return;
    setBusy(item.key);
    try {
      await retryCommand(call, user, item);
    } finally {
      setBusy(null);
      load();
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <GreenHeader title="Lệnh chờ gửi" back />
      <FlatList
        data={items}
        keyExtractor={(i) => i.key}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
        ListHeaderComponent={
          items.length ? (
            <Notice
              kind="warn"
              title="Lệnh cần xử lý"
              body="Đối soát lệnh chưa rõ kết quả bằng đúng mã cũ. Lệnh đã bị từ chối hiển thị lý do riêng; chỉ khi đó mới được bỏ và tạo lại."
            />
          ) : undefined
        }
        ListEmptyComponent={
          <Empty
            title="Không còn lệnh nào chờ gửi"
            body="Không còn lệnh nào cần đối soát trên thiết bị."
            icon="check"
          />
        }
        renderItem={({ item }) => (
          <Card style={{ padding: 14, gap: 8 }}>
            <View
              style={{ flexDirection: "row", gap: 12, alignItems: "center" }}
            >
              <IconTile
                name={item.state === "failed" ? "alert" : "clock"}
                t={item.state === "failed" ? "red" : "orange"}
                size={46}
                glyph={24}
              />
              <View style={{ flex: 1 }}>
                <T size={16} weight="heavy">
                  {item.label}
                </T>
                <T size={13.5} c={color.muted}>
                  {item.detail} · lưu lúc {dateTime(item.createdAt)}
                </T>
              </View>
            </View>
            <Pill
              label={
                item.state === "failed"
                  ? "Bị từ chối"
                  : item.state === "unknown"
                    ? "Chưa rõ kết quả"
                    : "Chờ gửi"
              }
              t={item.state === "failed" ? "red" : "orange"}
            />
            {item.error && (
              <T size={14} c={color.redDeep}>
                {item.error}
              </T>
            )}
            <View style={{ flexDirection: "row", gap: 10 }}>
              {item.state !== "failed" && (
                <Button
                  label="Đối soát / gửi lại"
                  style={{ flex: 1, height: 46 }}
                  loading={busy === item.key}
                  onPress={() => void retry(item)}
                />
              )}
              {item.state === "failed" && (
                <Button
                  label="Bỏ lệnh này"
                  kind="danger"
                  style={{ flex: 1, height: 46 }}
                  onPress={async () => {
                    if (user) await removeQueued(user, item.key);
                    load();
                  }}
                />
              )}
            </View>
          </Card>
        )}
      />
    </View>
  );
}
