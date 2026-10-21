import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { ImageOff } from "lucide-react-native";
import { Button, styles } from "../components/ui";
import { createNewsImageClient, newsImageSource } from "../api/news-image";
import { apiBaseUrl } from "../config";
import { colors, space } from "../theme/tokens";

function Raster({
  uri,
  label,
  retry,
}: {
  uri: string;
  label: string;
  retry(): void;
}) {
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const terminal = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => {
      if (mounted.current && !terminal.current) {
        terminal.current = true;
        setPhase("error");
      }
    }, 10000);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
    };
  }, []);
  if (phase === "error")
    return (
      <ImageFallback
        text="Không hiển thị được ảnh bìa. Nội dung bài viết vẫn xem được."
        retry={retry}
      />
    );
  return (
    <View style={local.frame}>
      <Image
        source={{ uri }}
        accessibilityLabel={label}
        accessibilityRole="image"
        resizeMode="contain"
        style={local.image}
        onLoad={() => {
          if (mounted.current && !terminal.current) {
            terminal.current = true;
            setPhase("ready");
          }
        }}
        onError={() => {
          if (mounted.current && !terminal.current) {
            terminal.current = true;
            setPhase("error");
          }
        }}
      />
      {phase === "loading" && (
        <ActivityIndicator
          style={local.spinner}
          color={colors.green}
          accessibilityLabel="Đang hiển thị ảnh bìa"
        />
      )}
    </View>
  );
}
function ImageFallback({ text, retry }: { text: string; retry?: () => void }) {
  return (
    <View style={{ gap: space.sm }}>
      <View style={local.message}>
        <ImageOff size={20} color={colors.muted} />
        <Text style={[styles.small, { flex: 1 }]}>{text}</Text>
      </View>
      {retry && (
        <Button label="Thử tải lại ảnh bìa" secondary onPress={retry} />
      )}
    </View>
  );
}
/** Detail loads on focus. List cards require a tap to avoid downloading every
 * image/page eagerly. Remote URLs are never handed to the native Image loader.
 */
export function NewsCover({
  id,
  coverUrl,
  title,
  autoLoad = false,
}: {
  id: string;
  coverUrl: string | null;
  title: string;
  autoLoad?: boolean;
}) {
  const [enabled, setEnabled] = useState(autoLoad);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ version: string; uri: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const version = `${id}:${coverUrl ?? ""}:${revision}`;
  useFocusEffect(
    useCallback(() => {
      if (!enabled || !coverUrl) return;
      const abort = new AbortController();
      let active = true;
      setResult(null);
      setError("");
      setLoading(true);
      void (async () => {
        try {
          const image = await createNewsImageClient(
            apiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL, __DEV__),
          ).cover(id, abort.signal);
          if (active) setResult({ version, uri: newsImageSource(image) });
        } catch {
          if (active)
            setError("Chưa tải được ảnh bìa. Bạn vẫn có thể đọc bài viết.");
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => {
        active = false;
        abort.abort();
      };
    }, [enabled, coverUrl, id, version]),
  );
  if (!coverUrl) return <ImageFallback text="Chưa có ảnh bìa công khai." />;
  if (!enabled)
    return (
      <Button
        label={`Tải ảnh bìa ${title}`}
        secondary
        onPress={() => setEnabled(true)}
      />
    );
  const retry = () => setRevision((value) => value + 1);
  if (error) return <ImageFallback text={error} retry={retry} />;
  if (loading || result?.version !== version)
    return (
      <View style={local.frame}>
        <ActivityIndicator
          color={colors.green}
          accessibilityLabel="Đang tải ảnh bìa"
        />
      </View>
    );
  return (
    <Raster
      key={version}
      uri={result.uri}
      label={`Ảnh bìa ${title}`}
      retry={retry}
    />
  );
}
const local = StyleSheet.create({
  frame: {
    width: "100%",
    aspectRatio: 16 / 9,
    maxHeight: 300,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: colors.pale,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.line,
  },
  image: { width: "100%", height: "100%" },
  spinner: { position: "absolute" },
  message: { flexDirection: "row", gap: space.sm, alignItems: "center" },
});
