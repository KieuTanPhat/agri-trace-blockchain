import { useCallback, useState } from "react";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Text } from "react-native";
import { Button, Notice, Screen, Title, styles } from "../../src/components/ui";
import { createContentClient, type NewsDetail } from "../../src/api/content";
import { apiBaseUrl } from "../../src/config";
import { formatDate } from "../../src/trace/presentation";
import { NewsCover } from "../../src/content/news-cover";
export default function ArticleScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = typeof params.id === "string" ? params.id : "";
  const [data, setData] = useState<NewsDetail | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [revision, setRevision] = useState(0);
  useFocusEffect(
    useCallback(() => {
      const abort = new AbortController();
      let active = true;
      setData(null);
      setError("");
      setLoading(true);
      void (async () => {
        try {
          const result = await createContentClient(
            apiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL, __DEV__),
          ).article(id, abort.signal);
          if (active) setData(result);
        } catch (cause) {
          if (active)
            setError(
              cause instanceof Error
                ? cause.message
                : "Chưa lấy được bài viết.",
            );
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => {
        active = false;
        abort.abort();
      };
    }, [id, revision]),
  );
  return (
    <Screen>
      {loading && <ActivityIndicator accessibilityLabel="Đang tải bài viết" />}
      {error ? (
        <>
          <Notice danger>{error}</Notice>
          <Button
            label="Thử tải lại bài"
            busy={loading}
            onPress={() => setRevision((value) => value + 1)}
          />
        </>
      ) : null}
      {data && (
        <>
          <Title subtitle={formatDate(data.publishedAt)}>{data.title}</Title>
          <NewsCover
            key={data.id}
            id={data.id}
            coverUrl={data.coverUrl}
            title={data.title}
            autoLoad
          />
          <Text style={styles.value}>{data.summary}</Text>
          <Text selectable style={styles.body}>
            {data.body}
          </Text>
        </>
      )}
      <Button
        label="Về bảng tin"
        secondary
        onPress={() => router.replace("/news")}
      />
    </Screen>
  );
}
