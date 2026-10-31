import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { api, type Schemas } from "../../../api/client";
import { DirectoryHeader } from "../../../components/DirectoryHeader";
import {
  DirectoryPhoto,
  DirectoryProductCard,
} from "../../../components/DirectoryCards";
import { Icon } from "../../../components/Icon";
import { Empty, Loading, Notice, T } from "../../../components/ui";
import { directoryColor as dc } from "../../../lib/directory";
import { date } from "../../../lib/format";
import { ORG_TYPE } from "../../../lib/labels";
import { useLoad, useReloadOnFocus } from "../../../lib/useApi";

export default function Enterprise() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EnterpriseDetail key={id} id={id} />;
}
function EnterpriseDetail({ id }: { id: string }) {
  const [tab, setTab] = useState("products");
  const [extra, setExtra] = useState<Schemas["PublicDirectoryProductDto"][]>(
      [],
    ),
    [cursor, setCursor] = useState<string | null | undefined>(),
    [loadingMore, setLoadingMore] = useState(false);
  const { data, error, loading, reload } = useLoad(
    () =>
      api<Schemas["PublicEnterpriseDetailDto"]>(
        `/public/enterprises/${id}?limit=50`,
      ),
    [id],
  );
  useReloadOnFocus(reload);
  if (!data || data.id !== id)
    return (
      <View style={{ flex: 1, backgroundColor: dc.bg }}>
        <DirectoryHeader title="Doanh nghiệp" query="" onQuery={() => {}} />
        {loading ? (
          <Loading />
        ) : (
          <View style={{ padding: 16 }}>
            <Notice
              kind="error"
              title={error ?? "Không tìm thấy doanh nghiệp"}
            />
          </View>
        )}
      </View>
    );
  const products = [...data.products.items, ...extra],
    next = cursor === undefined ? data.products.nextCursor : cursor;
  return (
    <ScrollView
      key={id}
      style={{ flex: 1, backgroundColor: dc.bg }}
      contentContainerStyle={{ paddingBottom: 30 }}
    >
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 18,
          paddingBottom: 24,
          backgroundColor: "#fff",
          gap: 18,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Quay lại"
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace("/consumer/enterprises")
          }
        >
          <Icon name="back" size={24} color="#6e8190" />
        </Pressable>
        <View style={{ alignItems: "center", gap: 12 }}>
          <View style={{ width: 155, height: 100 }}>
            <DirectoryPhoto url={data.logoUrl} label={`Logo ${data.name}`} />
          </View>
          <T size={21} weight="bold" style={{ textAlign: "center" }}>
            {data.name}
          </T>
          <T size={13} c="#679278">
            {ORG_TYPE[data.type]?.label ?? data.type}
          </T>
        </View>
        <View
          style={{
            gap: 12,
            borderTopWidth: 1,
            borderColor: dc.line,
            paddingTop: 16,
          }}
        >
          {data.phone && (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Gọi ${data.phone}`}
              onPress={() => void Linking.openURL(`tel:${data.phone}`)}
              style={{ flexDirection: "row", gap: 10, alignItems: "center" }}
            >
              <Icon name="phone" size={18} color={dc.blue} />
              <T size={14.5} c={dc.blue}>
                {data.phone}
              </T>
            </Pressable>
          )}
          {data.address && (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Icon name="location" size={19} color="#91a0aa" />
              <T size={14} c="#6b7882" style={{ flex: 1 }}>
                {data.address}
              </T>
            </View>
          )}
          {data.website && (
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(data.website!)}
            >
              <T size={14} c={dc.blue}>
                {data.website}
              </T>
            </Pressable>
          )}
        </View>
      </View>
      <View
        style={{ flexDirection: "row", backgroundColor: "#fff", marginTop: 8 }}
      >
        {[
          { key: "products", label: "Sản phẩm" },
          { key: "about", label: "Giới thiệu" },
          { key: "certs", label: "Chứng nhận công khai" },
        ].map((t) => (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
            onPress={() => setTab(t.key)}
            style={{
              flex: 1,
              paddingVertical: 14,
              alignItems: "center",
              borderBottomWidth: 2,
              borderColor: tab === t.key ? dc.blue : "transparent",
            }}
          >
            <T size={12.5} c={tab === t.key ? dc.blue : "#7a8892"}>
              {t.label}
            </T>
          </Pressable>
        ))}
      </View>
      <View style={{ padding: 12, gap: 12 }}>
        {tab === "products" && (
          <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {products.map((p) => (
                <View key={p.id} style={{ width: "48.5%" }}>
                  <DirectoryProductCard product={p} />
                </View>
              ))}
            </View>
            {!products.length && <Empty title="Chưa có sản phẩm công khai" />}
            {next && (
              <Pressable
                disabled={loadingMore}
                accessibilityRole="button"
                onPress={async () => {
                  setLoadingMore(true);
                  try {
                    const n = await api<Schemas["PublicEnterpriseDetailDto"]>(
                      `/public/enterprises/${id}?limit=50&productCursor=${next}`,
                    );
                    setExtra((v) => [...v, ...n.products.items]);
                    setCursor(n.products.nextCursor);
                  } finally {
                    setLoadingMore(false);
                  }
                }}
              >
                <T c={dc.blue}>
                  {loadingMore ? "Đang tải…" : "Xem thêm sản phẩm"}
                </T>
              </Pressable>
            )}
          </>
        )}
        {tab === "about" && (
          <View
            style={{
              backgroundColor: "#fff",
              padding: 17,
              borderRadius: 14,
              gap: 13,
            }}
          >
            <T size={18} weight="bold">
              Về doanh nghiệp
            </T>
            <T size={15} c="#667580">
              {data.introduction ??
                "Doanh nghiệp tham gia ghi nhận và đối chiếu nguồn gốc các lô hàng trên AgriTrace."}
            </T>
            {data.province && (
              <T size={14} c="#7b8994">
                Khu vực hoạt động: {data.province}
              </T>
            )}
          </View>
        )}
        {tab === "certs" &&
          (data.certificates.items.length ? (
            data.certificates.items.map((c) => (
              <View
                key={c.id}
                style={{
                  padding: 17,
                  backgroundColor: "#fff",
                  borderRadius: 14,
                  gap: 6,
                }}
              >
                <T size={16} weight="bold">
                  {c.type}
                </T>
                <T size={14} c="#71808b">
                  Đơn vị cấp: {c.issuer}
                </T>
                <T size={13} c="#71808b">
                  Ngày cấp: {date(c.issueDate)}
                  {c.expiryDate ? ` · Hết hạn: ${date(c.expiryDate)}` : ""}
                </T>
              </View>
            ))
          ) : (
            <Empty
              title="Chưa có chứng nhận công khai"
              body="Chỉ hiển thị chứng nhận được duyệt, còn hiệu lực và đã cho phép công khai."
              icon="journal"
            />
          ))}
      </View>
    </ScrollView>
  );
}
