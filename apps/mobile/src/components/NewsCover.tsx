import { useEffect, useState } from "react";
import { Image } from "expo-image";
import { View } from "react-native";
import { api, type Schemas } from "../api/client";
import { Icon } from "./Icon";
export function NewsCover({
  article,
}: {
  article: Pick<
    Schemas["PublicNewsDto"],
    "id" | "title" | "hasCover" | "coverUrl"
  >;
}) {
  return <CoverImage key={`${article.id}:${article.hasCover}:${article.coverUrl ?? ''}`} article={article}/>;
}
function CoverImage({article}:{article: Pick<Schemas['PublicNewsDto'], 'id' | 'title' | 'hasCover' | 'coverUrl'>}) {
  const [uri, setUri] = useState<string | null>(null);
  const { id, hasCover, coverUrl } = article;
  useEffect(() => {
    let active = true;
    if (hasCover || coverUrl)
      void api<Schemas["PublicNewsImageDto"]>(
        `/public/news/${id}/cover`,
      )
        .then((v) => {
          if (active) setUri(`data:${v.mimeType};base64,${v.dataBase64}`);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [id, hasCover, coverUrl]);
  return uri ? (
    <Image
      source={{ uri }}
      accessibilityLabel={article.title}
      contentFit="cover"
      style={{ width: "100%", height: "100%" }}
    />
  ) : (
    <View
      style={{
        flex: 1,
        backgroundColor: "#e9f3ec",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name="journal" size={30} color="#74a67d" />
    </View>
  );
}
