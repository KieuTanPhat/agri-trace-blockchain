import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { Building2, Sprout } from "lucide-react-native";
import { Button, Card, Notice, Screen, Title, styles } from "../components/ui";
import { apiBaseUrl } from "../config";
import { colors, space } from "../theme/tokens";
import {
  createDirectoryClient,
  ENTERPRISE_LABELS,
  type DirectoryProduct,
  type DirectoryEnterprise,
  type EnterpriseType,
} from "../api/directory";
import { usePublicPage } from "./use-public-page";

type Kind = "products" | "enterprises";
type Item = DirectoryProduct | DirectoryEnterprise;
export function DirectoryListScreen({ kind }: { kind: Kind }) {
  const productMode = kind === "products";
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState<EnterpriseType | undefined>();
  const load = useCallback(
    (cursor: string | undefined, signal: AbortSignal) => {
      const client = createDirectoryClient(
        apiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL, __DEV__),
      );
      return productMode
        ? client.products({ q, cursor, limit: 20 }, signal)
        : client.enterprises({ q, type, cursor, limit: 20 }, signal);
    },
    [productMode, q, type],
  );
  const page = usePublicPage<Item>(load);
  function search() {
    const next = draft.trim();
    if (next === q) page.refresh();
    else setQ(next);
  }
  return (
    <Screen>
      <Title
        subtitle={
          productMode
            ? "Sản phẩm có lô hàng đã được cấp mã truy xuất công khai."
            : "Các đơn vị liên quan trực tiếp đến lô hàng có mã truy xuất công khai."
        }
      >
        {productMode ? "Sản phẩm" : "Doanh nghiệp"}
      </Title>
      <TextInput
        accessibilityLabel={productMode ? "Tìm sản phẩm" : "Tìm doanh nghiệp"}
        placeholder={
          productMode ? "Tên sản phẩm hoặc giống" : "Tên doanh nghiệp"
        }
        placeholderTextColor={colors.muted}
        value={draft}
        onChangeText={setDraft}
        maxLength={100}
        returnKeyType="search"
        onSubmitEditing={search}
        style={styles.input}
      />
      <Button label="Tìm kiếm" onPress={search} />
      {!productMode && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {(
            [undefined, "FARM", "TRANSPORTER", "RETAILER", "AUDITOR", "DISTRIBUTOR", "PROCESSOR"] as const
          ).map((value) => (
            <Pressable
              key={value ?? "all"}
              accessibilityRole="button"
              accessibilityState={{ selected: type === value }}
              accessibilityLabel={`Lọc ${value ? ENTERPRISE_LABELS[value] : "tất cả"}`}
              onPress={() => setType(value)}
              style={{
                padding: space.md,
                minHeight: 44,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: type === value ? colors.green : colors.line,
                backgroundColor: type === value ? colors.pale : colors.paper,
              }}
            >
              <Text style={styles.value}>
                {value ? ENTERPRISE_LABELS[value] : "Tất cả"}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {page.error ? (
        <>
          <Notice danger>{page.error}</Notice>
          <Button
            secondary
            label="Thử tải lại"
            busy={page.loading}
            onPress={page.retry}
          />
        </>
      ) : null}
      {page.loading && !page.items && (
        <ActivityIndicator
          accessibilityLabel="Đang tải danh mục"
          color={colors.green}
        />
      )}
      {page.items?.length === 0 && (
        <Card>
          <Text style={styles.heading}>Chưa có kết quả phù hợp</Text>
          <Text style={styles.body}>
            Thử từ khóa khác hoặc đổi bộ lọc. Dữ liệu nội bộ chưa có mã truy
            xuất không xuất hiện tại đây.
          </Text>
        </Card>
      )}
      {page.items?.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={`Xem ${"productName" in item ? item.productName : item.name}`}
          onPress={() =>
            router.push({
              pathname: productMode ? "/products/[id]" : "/enterprises/[id]",
              params: { id: item.id },
            })
          }
        >
          <Card>
            {"productName" in item ? (
              <>
                <Sprout color={colors.green} size={26} />
                <Text style={styles.heading}>{item.productName}</Text>
                <Text style={styles.body}>
                  {item.variety || "Chưa ghi nhận giống"}
                  {item.defaultUnit ? ` · ${item.defaultUnit}` : ""}
                </Text>
              </>
            ) : (
              <>
                <Building2 color={colors.green} size={26} />
                <Text style={styles.heading}>{item.name}</Text>
                <Text style={styles.body}>{ENTERPRISE_LABELS[item.type]}</Text>
              </>
            )}
            <Text style={styles.small}>Xem thông tin →</Text>
          </Card>
        </Pressable>
      ))}
      {page.hasMore && !page.error && (
        <Button
          secondary
          label="Xem thêm"
          busy={page.loading}
          onPress={page.loadMore}
        />
      )}
      {page.items && !page.error && (
        <Button
          secondary
          label="Làm mới danh sách"
          disabled={page.loading}
          onPress={page.refresh}
        />
      )}
      <Text style={styles.small}>
        Có tên trong danh mục không đồng nghĩa được chứng nhận chất lượng. Xem
        thông tin và cảnh báo của từng lô trước khi sử dụng.
      </Text>
    </Screen>
  );
}
