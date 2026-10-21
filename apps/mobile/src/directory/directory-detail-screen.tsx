import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  Button,
  Card,
  KeyValue,
  Notice,
  Screen,
  SectionTitle,
  Title,
  styles,
} from "../components/ui";
import {
  ENTERPRISE_LABELS,
  type DirectoryProduct,
  type DirectoryEnterprise,
} from "../api/directory";
import { colors, space } from "../theme/tokens";
import { formatDate } from "../trace/presentation";
import { useDirectoryDetail } from "./use-directory-detail";

function ProductLink({ item }: { item: DirectoryProduct }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Xem ${item.productName}`}
      onPress={() =>
        router.push({ pathname: "/products/[id]", params: { id: item.id } })
      }
    >
      <Card>
        <Text style={styles.value}>{item.productName}</Text>
        <Text style={styles.body}>{item.variety || "Chưa ghi nhận giống"}</Text>
        <Text style={styles.small}>Xem sản phẩm →</Text>
      </Card>
    </Pressable>
  );
}
function EnterpriseLink({ item }: { item: DirectoryEnterprise }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Xem ${item.name}`}
      onPress={() =>
        router.push({ pathname: "/enterprises/[id]", params: { id: item.id } })
      }
    >
      <Card>
        <Text style={styles.value}>{item.name}</Text>
        <Text style={styles.body}>{ENTERPRISE_LABELS[item.type]}</Text>
        <Text style={styles.small}>Xem đơn vị →</Text>
      </Card>
    </Pressable>
  );
}
export function DirectoryDetailScreen({
  kind,
}: {
  kind: "products" | "enterprises";
}) {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = typeof params.id === "string" ? params.id : "";
  const detail = useDirectoryDetail(kind, id);
  const { data } = detail;
  return (
    <Screen>
      {detail.loading && !data && (
        <ActivityIndicator
          color={colors.green}
          accessibilityLabel="Đang tải chi tiết"
        />
      )}
      {detail.error ? (
        <>
          <Notice danger>{detail.error}</Notice>
          <Button
            label="Thử tải lại"
            secondary
            busy={detail.loading}
            onPress={detail.retry}
          />
        </>
      ) : null}
      {data && "productName" in data && (
        <>
          <Title subtitle="Thông tin sản phẩm được công khai từ hệ thống.">
            {data.productName}
          </Title>
          <Card>
            <KeyValue label="Giống" value={data.variety || "Chưa ghi nhận"} />
            <KeyValue
              label="Đơn vị mặc định"
              value={data.defaultUnit || "Chưa ghi nhận"}
            />
            <KeyValue
              label="Mô tả"
              value={data.description || "Chưa có mô tả công khai"}
            />
          </Card>
          <SectionTitle>Đơn vị liên quan</SectionTitle>
          {!data.enterprises.items.length && (
            <Text style={styles.body}>Chưa có đơn vị công khai liên quan.</Text>
          )}
          {data.enterprises.items.map((item) => (
            <EnterpriseLink key={item.id} item={item} />
          ))}
          {data.enterprises.hasMore && (
            <Button
              label="Xem thêm đơn vị"
              secondary
              busy={detail.loading}
              onPress={() =>
                detail.more("enterprises", data.enterprises.nextCursor)
              }
            />
          )}
          <SectionTitle>Lô hàng có mã truy xuất</SectionTitle>
          <Notice>
            Danh sách này không xác nhận lô còn hạn hoặc đạt chất lượng. Mở truy
            xuất để xem cảnh báo mới nhất của từng lô.
          </Notice>
          {!data.lots.items.length && (
            <Text style={styles.body}>Chưa có lô công khai để hiển thị.</Text>
          )}
          {data.lots.items.map((lot) => (
            <Card key={lot.id}>
              <Text style={styles.value}>{lot.lotCode}</Text>
              <Button
                label={`Truy xuất ${lot.lotCode}`}
                onPress={() =>
                  router.push({
                    pathname: "/trace/[token]",
                    params: { token: lot.traceToken },
                  })
                }
              />
            </Card>
          ))}
          {data.lots.hasMore && (
            <Button
              label="Xem thêm lô"
              secondary
              busy={detail.loading}
              onPress={() => detail.more("lots", data.lots.nextCursor)}
            />
          )}
        </>
      )}
      {data && "name" in data && (
        <>
          <Title subtitle={ENTERPRISE_LABELS[data.type]}>{data.name}</Title>
          <Notice>
            Đơn vị có liên quan đến lô công khai. Thông tin này không thay thế
            việc kiểm tra chất lượng sản phẩm.
          </Notice>
          <SectionTitle>Sản phẩm liên quan</SectionTitle>
          {!data.products.items.length && (
            <Text style={styles.body}>
              Chưa có sản phẩm công khai liên quan.
            </Text>
          )}
          {data.products.items.map((item) => (
            <ProductLink key={item.id} item={item} />
          ))}
          {data.products.hasMore && (
            <Button
              label="Xem thêm sản phẩm"
              secondary
              busy={detail.loading}
              onPress={() => detail.more("products", data.products.nextCursor)}
            />
          )}
          <SectionTitle>Chứng nhận công khai của lô/vụ liên quan</SectionTitle>
          <Text style={styles.small}>
            Chỉ hiển thị hồ sơ đã duyệt, còn hiệu lực và chưa bị thay thế. Đơn
            vị cấp giấy được ghi riêng; đây không phải danh sách chứng nhận cấp
            cho chính doanh nghiệp đang xem.
          </Text>
          {!data.certificates.items.length && (
            <Card>
              <Text style={styles.body}>
                Chưa có chứng nhận công khai phù hợp.
              </Text>
            </Card>
          )}
          {data.certificates.items.map((certificate) => (
            <Card key={certificate.id}>
              <Text style={styles.heading}>{certificate.type}</Text>
              <KeyValue label="Đơn vị cấp" value={certificate.issuer} />
              <View style={{ gap: space.sm }}>
                <Text style={styles.body}>
                  Ngày cấp: {formatDate(certificate.issueDate)}
                </Text>
                <Text style={styles.body}>
                  Ngày hết hạn: {formatDate(certificate.expiryDate)}
                </Text>
              </View>
            </Card>
          ))}
          {data.certificates.hasMore && (
            <Button
              label="Xem thêm chứng nhận"
              secondary
              busy={detail.loading}
              onPress={() =>
                detail.more("certificates", data.certificates.nextCursor)
              }
            />
          )}
        </>
      )}
      {data && (
        <Button
          label="Làm mới thông tin"
          secondary
          disabled={detail.loading}
          onPress={detail.refresh}
        />
      )}
      <Button
        label="Về danh sách"
        secondary
        onPress={() =>
          router.replace(kind === "products" ? "/products" : "/enterprises")
        }
      />
    </Screen>
  );
}
