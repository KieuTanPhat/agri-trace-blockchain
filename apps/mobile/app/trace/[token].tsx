import { useCallback, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { CalendarDays, Leaf, MapPin } from "lucide-react-native";
import {
  Button,
  Card,
  KeyValue,
  Notice,
  Screen,
  SectionTitle,
  Title,
  styles,
} from "../../src/components/ui";
import {
  createTraceClient,
  TraceApiError,
  type PublicLot,
} from "../../src/api/trace";
import { apiBaseUrl } from "../../src/config";
import { TOKEN_PATTERN } from "../../src/scan/parse-token";
import { localHistory } from "../../src/scan/local-history";
import {
  formatDate,
  stateLabel,
  traceWarningItems,
} from "../../src/trace/presentation";
import { colors, space } from "../../src/theme/tokens";

export default function TraceScreen() {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = typeof params.token === "string" ? params.token : "";
  const [lot, setLot] = useState<PublicLot | null>(null);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState<string>();
  const [storageWarning, setStorageWarning] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [visibleEvents, setVisibleEvents] = useState(20);
  useFocusEffect(
    useCallback(() => {
      let current = true;
      const abort = new AbortController();
      setLot(null);
      setError("");
      setRequestId(undefined);
      setStorageWarning("");
      setLoading(true);
      setVisibleEvents(20);
      async function load() {
        try {
          if (!TOKEN_PATTERN.test(token))
            throw new TraceApiError("Mã truy xuất không hợp lệ.");
          const base = apiBaseUrl(
            process.env.EXPO_PUBLIC_API_BASE_URL,
            __DEV__,
          );
          const result = await createTraceClient(base)(token, abort.signal);
          if (!current) return;
          setLot(result);
          try {
            await localHistory.add({
              token,
              productName: result.productName,
              viewedAt: new Date().toISOString(),
            });
          } catch {
            if (current)
              setStorageWarning(
                "Đã lấy được thông tin nhưng chưa lưu được lịch sử trên thiết bị.",
              );
          }
        } catch (cause) {
          if (!current) return;
          setError(
            cause instanceof Error
              ? cause.message
              : "Chưa lấy được thông tin truy xuất.",
          );
          setRequestId(
            cause instanceof TraceApiError ? cause.requestId : undefined,
          );
        } finally {
          if (current) setLoading(false);
        }
      }
      void load();
      return () => {
        current = false;
        abort.abort();
      };
    }, [token, revision]),
  );

  return (
    <Screen>
      {loading && (
        <Card>
          <ActivityIndicator color={colors.green} />
          <Text style={styles.body}>Đang lấy thông tin mới nhất…</Text>
        </Card>
      )}
      {error ? (
        <>
          <Title subtitle="Bạn có thể thử lại hoặc kiểm tra mã trên bao bì.">
            Chưa thể tra cứu
          </Title>
          <Notice danger>{error}</Notice>
          {requestId && (
            <Text selectable style={styles.small}>
              Mã hỗ trợ: {requestId}
            </Text>
          )}
          <Button
            label="Thử lại"
            onPress={() => setRevision((value) => value + 1)}
          />
          <Button
            label="Nhập mã khác"
            secondary
            onPress={() => router.replace("/scan")}
          />
        </>
      ) : null}
      {lot && (
        <>
          {traceWarningItems(lot).map((warning) => (
            <Notice key={warning.key} danger={warning.danger}>
              {warning.message}
            </Notice>
          ))}
          <Title subtitle={`Mã lô ${lot.lotCode}`}>{lot.productName}</Title>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            <Leaf color={colors.green} size={20} />
            <Text style={styles.value}>{stateLabel(lot.currentState)}</Text>
          </View>
          <Card>
            <SectionTitle>Thông tin lô hàng</SectionTitle>
            <KeyValue label="Đơn vị nông trại" value={lot.farmOrg.name} />
            <KeyValue label="Vụ trồng" value={lot.productionCycle.cycleCode} />
            <KeyValue
              label="Ngày thu hoạch"
              value={formatDate(lot.harvestTime)}
            />
            <KeyValue
              label="Sản lượng ban đầu"
              value={`${lot.initialQuantity.toLocaleString("vi-VN")} ${lot.unit}`}
            />
            <KeyValue label="Hạn sử dụng" value={formatDate(lot.expiryDate)} />
          </Card>
          {lot.shipment && (
            <Card>
              <MapPin size={23} color={colors.green} />
              <SectionTitle>Hành trình giao nhận</SectionTitle>
              <KeyValue label="Điểm gửi" value={lot.shipment.origin} />
              <KeyValue label="Điểm đến" value={lot.shipment.destination} />
              <KeyValue
                label="Ngày giao nhận"
                value={formatDate(lot.shipment.receivedTime)}
              />
            </Card>
          )}
          <Card>
            <SectionTitle>Dữ liệu cảm biến của lần thu hoạch</SectionTitle>
            <Text style={styles.body}>
              {lot.sensorEvidence.status === "FINALIZED"
                ? `${lot.sensorEvidence.readingCount} bản đo được ghi nhận cho cửa sổ thu hoạch này.`
                : lot.sensorEvidence.status === "NO_DATA"
                  ? "Chưa có bản đo cho lần thu hoạch này."
                  : "Dữ liệu đang cần được đối soát."}
            </Text>
            <KeyValue
              label="Khoảng thời gian"
              value={`${formatDate(lot.sensorEvidence.periodStart)} – ${formatDate(lot.sensorEvidence.periodEnd)}`}
            />
          </Card>
          <Card>
            <SectionTitle>Chứng nhận công khai</SectionTitle>
            {lot.certificates.length ? (
              lot.certificates.map((cert, index) => (
                <View key={`${cert.type}-${index}`} style={{ gap: space.sm }}>
                  <Text style={styles.value}>{cert.type}</Text>
                  <Text style={styles.body}>{cert.issuer}</Text>
                  <Text style={styles.small}>
                    Ngày cấp {formatDate(cert.issueDate)} · Hạn{" "}
                    {formatDate(cert.expiryDate)}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.body}>
                Chưa có chứng nhận công khai cho lô này.
              </Text>
            )}
          </Card>
          <Card>
            <CalendarDays color={colors.green} size={23} />
            <SectionTitle>Nhật ký hành trình</SectionTitle>
            {!lot.timeline.length && (
              <Text style={styles.body}>Chưa có nhật ký được công khai.</Text>
            )}
            {lot.timeline.slice(0, visibleEvents).map((event) => (
              <View
                key={event.eventId}
                style={{
                  paddingLeft: space.lg,
                  borderLeftWidth: 2,
                  borderColor: colors.line,
                  gap: space.xs,
                  paddingBottom: space.md,
                }}
              >
                <Text style={styles.small}>{formatDate(event.eventTime)}</Text>
                <Text style={styles.value}>{event.summary}</Text>
                <Text style={styles.body}>{event.actor.organizationName}</Text>
              </View>
            ))}
            {lot.timeline.length > visibleEvents && (
              <Button
                secondary
                label={`Xem thêm (${lot.timeline.length - visibleEvents} sự kiện)`}
                onPress={() => setVisibleEvents((value) => value + 20)}
              />
            )}
          </Card>
          {storageWarning ? <Notice>{storageWarning}</Notice> : null}
          <Text style={styles.small}>
            Thông tin do các đơn vị trong chuỗi ghi nhận. Tra cứu không thay thế
            kết luận kiểm định chất lượng hoặc an toàn thực phẩm.
          </Text>
          <Button
            label="Tra cứu mã khác"
            onPress={() => router.replace("/scan")}
          />
        </>
      )}
    </Screen>
  );
}
