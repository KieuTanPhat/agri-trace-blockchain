import { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { ActivityIndicator, Text, TextInput } from "react-native";
import { Button, Card, Notice, Screen, Title, styles } from "../components/ui";
import { apiBaseUrl } from "../config";
import {
  createContentClient,
  type Announcement,
  type NewsItem,
} from "../api/content";
import { usePublicPage } from "../directory/use-public-page";
import { formatDate } from "../trace/presentation";
import { announcementReadState } from "./local-read-state";
import { NewsCover } from "./news-cover";
export function ContentListScreen({
  mode,
}: {
  mode: "news" | "announcements";
}) {
  const [query, setQuery] = useState(""),
    [draft, setDraft] = useState("");
  const [read, setRead] = useState<string[]>([]),
    [storageError, setStorageError] = useState(""),
    [reset, setReset] = useState(false);
  const load = useCallback(
    (cursor: string | undefined, signal: AbortSignal) => {
      const client = createContentClient(
        apiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL, __DEV__),
      );
      return mode === "news"
        ? client.news({ q: query, cursor, limit: 20 }, signal)
        : client.announcements({ cursor, limit: 20 }, signal);
    },
    [mode, query],
  );
  const page = usePublicPage<NewsItem | Announcement>(load);
  useFocusEffect(
    useCallback(() => {
      if (mode !== "announcements") return;
      let active = true;
      void announcementReadState.load().then(
        (ids) => {
          if (active) {
            setRead(ids);
            setStorageError("");
          }
        },
        () => {
          if (active)
            setStorageError(
              "Không đọc được trạng thái đã đọc trên thiết bị. Nội dung vẫn xem được.",
            );
        },
      );
      return () => {
        active = false;
      };
    }, [mode]),
  );
  async function mark(id: string) {
    try {
      setRead(await announcementReadState.mark(id));
      setStorageError("");
    } catch {
      setStorageError("Chưa lưu được trạng thái đã đọc. Vui lòng thử lại.");
    }
  }
  async function clear() {
    try {
      setRead(await announcementReadState.clear());
      setStorageError("");
      setReset(false);
    } catch {
      setStorageError("Chưa đặt lại được trạng thái đã đọc.");
    }
  }
  return (
    <Screen>
      <Title subtitle="Nội dung công khai từ hệ thống, không cần đăng nhập.">
        {mode === "news" ? "Bảng tin" : "Thông báo hệ thống"}
      </Title>
      {mode === "news" && (
        <>
          <TextInput
            accessibilityLabel="Tìm bài viết"
            placeholder="Tìm tiêu đề hoặc tóm tắt"
            value={draft}
            onChangeText={setDraft}
            maxLength={100}
            style={styles.input}
          />
          <Button
            label="Tìm bài viết"
            onPress={() => {
              if (query === draft.trim()) page.refresh();
              else setQuery(draft.trim());
            }}
          />
        </>
      )}
      {storageError ? <Notice danger>{storageError}</Notice> : null}
      {page.error ? (
        <>
          <Notice danger>{page.error}</Notice>
          <Button
            label="Thử tải lại"
            secondary
            busy={page.loading}
            onPress={page.retry}
          />
        </>
      ) : null}
      {page.loading && !page.items && (
        <ActivityIndicator accessibilityLabel="Đang tải nội dung" />
      )}
      {page.items?.length === 0 && (
        <Card>
          <Text style={styles.heading}>Chưa có nội dung phù hợp</Text>
          <Text style={styles.body}>
            Bảng tin và thông báo sẽ xuất hiện khi được hệ thống công bố.
          </Text>
        </Card>
      )}
      {page.items?.map((item) => (
        <Card key={item.id}>
          <Text accessibilityRole="header" style={styles.heading}>
            {item.title}
          </Text>
          {"summary" in item ? (
            <>
              <Text style={styles.small}>{formatDate(item.publishedAt)}</Text>
              <NewsCover
                id={item.id}
                coverUrl={item.coverUrl}
                title={item.title}
              />
              <Text style={styles.body}>{item.summary}</Text>
              <Button
                label={`Đọc bài ${item.title}`}
                secondary
                onPress={() =>
                  router.push({
                    pathname: "/news/[id]",
                    params: { id: item.id },
                  })
                }
              />
            </>
          ) : (
            <>
              <Text style={styles.small}>
                {item.severity === "CRITICAL"
                  ? "Quan trọng"
                  : item.severity === "WARNING"
                    ? "Lưu ý"
                    : "Thông tin"}{" "}
                · {formatDate(item.startsAt)}
              </Text>
              <Text selectable style={styles.body}>
                {item.body}
              </Text>
              <Button
                label={
                  read.includes(item.id)
                    ? "Đã đọc trên thiết bị này"
                    : `Đánh dấu đã đọc ${item.title}`
                }
                secondary
                disabled={read.includes(item.id)}
                onPress={() => void mark(item.id)}
              />
            </>
          )}
        </Card>
      ))}
      {page.hasMore && (
        <Button label="Xem thêm" busy={page.loading} onPress={page.loadMore} />
      )}
      <Button
        label="Làm mới nội dung"
        secondary
        busy={page.loading}
        onPress={page.refresh}
      />
      {mode === "announcements" && (
        <>
          <Text style={styles.small}>
            Trạng thái đã đọc chỉ lưu mã thông báo trên thiết bị, tối đa 500 mã;
            không gửi về máy chủ.
          </Text>
          <Button
            label="Đặt lại trạng thái đã đọc"
            secondary
            onPress={() => setReset(true)}
          />
          {reset && (
            <>
              <Notice>
                Đánh dấu tất cả thông báo thành chưa đọc trên thiết bị này?
              </Notice>
              <Button label="Xác nhận đặt lại" onPress={() => void clear()} />
              <Button
                label="Hủy đặt lại"
                secondary
                onPress={() => setReset(false)}
              />
            </>
          )}
        </>
      )}
    </Screen>
  );
}
