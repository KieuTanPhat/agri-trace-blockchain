import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useSession } from '../../../auth/session';
import { Button, Card, GreenHeader, Loading, Notice, Pill, Row, T } from '../../../components/ui';
import { dateTime, qty } from '../../../lib/format';
import { currentAttestations, transferStatus, type TransferDetail } from '../../../lib/transfers';
import { useLoad, useReloadOnFocus } from '../../../lib/useApi';
import { color } from '../../../theme/tokens';

export default function TransferScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { call } = useSession();
  const { data, error, loading, reload } = useLoad(
    () => call<{ record: TransferDetail }>(`/distribution/transfers/${encodeURIComponent(id)}`), [id],
  );
  useReloadOnFocus(reload);
  const transfer = data?.record;
  if (!transfer) return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <GreenHeader title="Chi tiết chuyến hàng" back />
      {loading ? <Loading /> : <View style={{ padding: 16, gap: 12 }}>
        <Notice kind="error" title={error ?? 'Không tìm thấy chuyến hàng'} body="Chuyến không tồn tại hoặc không thuộc phạm vi được giao." />
        <Button label="Thử tải lại" onPress={() => void reload()} />
      </View>}
    </View>
  );
  const status = transferStatus(transfer.status);
  const signatures = currentAttestations(transfer);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.bg }} contentContainerStyle={{ paddingBottom: 32 }}>
      <GreenHeader title="Chi tiết chuyến hàng" back />
      <View style={{ padding: 16, gap: 12 }}>
        <Card style={{ padding: 16, gap: 8 }}>
          <Pill label={status.label} t={status.t} />
          <Row label="Nơi gửi" value={transfer.origin} />
          <Row label="Nơi nhận" value={transfer.destination} />
          <Row label="Bên gửi" value={transfer.senderName ?? '—'} />
          <Row label="Vận chuyển" value={transfer.carrierName ?? '—'} />
          <Row label="Bên nhận" value={transfer.receiverName ?? '—'} />
          <Row label="Tạo lúc" value={dateTime(transfer.createdAt)} />
        </Card>
        <Notice kind="info" title="Ký bàn giao trên Web" body="Ứng dụng hiện dùng để xem chuyến hàng. Ký gửi, ký nhận và đối soát thực hiện trên AgriTrace Web bằng khóa ký của tổ chức." />
        <T size={18} weight="heavy">Các lô trong chuyến</T>
        {transfer.lines.length === 0 && <Notice kind="warn" title="Chuyến chưa có dòng hàng" />}
        {transfer.lines.map((line) => (
          <Card key={line.id} style={{ padding: 16, gap: 8 }}>
            <T size={16} weight="heavy">{line.productName ?? 'Sản phẩm'}</T>
            <T>{line.lotCode ?? 'Chưa có mã lô'} · {qty(line.quantity, line.unit)}</T>
            <Button label="Xem lô nguồn" kind="outline" onPress={() => router.push(`/staff/lot/${line.lotId}`)} />
          </Card>
        ))}
        <T size={18} weight="heavy">Chữ ký lượt hiện tại</T>
        <T size={13} c={color.muted}>Chữ ký đã ghi nhận trên API; không thay thế bằng chứng xác nhận trên blockchain.</T>
        {signatures.length === 0 && <Notice kind="info" title="Chưa có chữ ký ở lượt hiện tại" />}
        {signatures.map((signature) => (
          <Card key={signature.id} style={{ padding: 16, gap: 4 }}>
            <T weight="heavy">{signature.phaseLabel} · {signature.organizationName}</T>
            <T size={13} c={color.muted}>{dateTime(signature.createdAt)}</T>
          </Card>
        ))}
        <Button label="Tải lại chuyến hàng" kind="outline" loading={loading} onPress={() => void reload()} />
      </View>
    </ScrollView>
  );
}
