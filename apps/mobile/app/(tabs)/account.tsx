import { History, UserRound } from "lucide-react-native";
import { router } from "expo-router";
import { Text, View } from "react-native";
import { Button, Card, Screen, Title, styles } from "../../src/components/ui";
import { colors, space } from "../../src/theme/tokens";
import {
  demoSession,
  useAuth,
  realAuthEnabled,
  restoreNativeSession,
} from "../../src/auth/use-auth";
import { KeyValue, Notice } from "../../src/components/ui";

export default function AccountScreen() {
  const auth = useAuth();
  return (
    <Screen>
      <Title subtitle="ACheck — ứng dụng người tiêu dùng của AgriTrace.">
        Tài khoản
      </Title>
      {auth.status === "authenticated" && auth.profile ? (
        <Card key={`profile-${auth.profile.id}`} stableNativeChildren>
          {!realAuthEnabled && (
            <Notice>
              Hồ sơ giả chỉ để kiểm thử giao diện, không phải phiên đăng nhập
              API. Đóng app sẽ mất.
            </Notice>
          )}
          <KeyValue label="Họ tên" value={auth.profile.fullName} />
          <KeyValue label="Số điện thoại" value={auth.profile.phone} />
          {auth.profile.contactEmail && (
            <KeyValue
              label="Email liên hệ (chưa xác minh)"
              value={auth.profile.contactEmail}
            />
          )}
          {auth.profile.province && (
            <KeyValue label="Tỉnh/thành" value={auth.profile.province} />
          )}
          {auth.profile.ward && (
            <KeyValue label="Phường/xã" value={auth.profile.ward} />
          )}
          {auth.profile.businessAddress && (
            <KeyValue
              label="Địa chỉ doanh nghiệp"
              value={auth.profile.businessAddress}
            />
          )}
          <Button
            label={realAuthEnabled ? "Đăng xuất" : "Đăng xuất bản thử"}
            secondary
            onPress={() => void demoSession.logout()}
          />
          <Button
            label={realAuthEnabled ? "Đổi tài khoản" : "Đổi tài khoản bản thử"}
            secondary
            onPress={() => {
              void demoSession.logout();
              router.push("/login");
            }}
          />
        </Card>
      ) : (
        <Card key="guest" stableNativeChildren>
          <View
            style={{
              width: 68,
              height: 68,
              backgroundColor: colors.pale,
              borderRadius: 24,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <UserRound color={colors.green} size={32} />
          </View>
          <Text style={styles.heading}>Bạn đang dùng chế độ khách</Text>
          <Text style={styles.body}>
            Quét QR, xem sản phẩm và đọc thông báo ngay mà không cần đăng nhập.
            Tính năng tài khoản đang được hoàn thiện.
          </Text>
          {auth.available && (
            <Button
              label={realAuthEnabled ? "Đăng nhập" : "Mở đăng nhập thử nghiệm"}
              disabled={
                auth.status === "restoring" ||
                auth.status === "authenticating" ||
                auth.status === "logoutPending"
              }
              onPress={() => router.push("/login")}
            />
          )}
        </Card>
      )}
      {auth.error ? <Notice danger>{auth.error}</Notice> : null}
      {realAuthEnabled && auth.status === "logoutPending" && (
        <Button
          label="Thử thu hồi phiên lại"
          secondary
          onPress={() => void demoSession.logout()}
        />
      )}
      {realAuthEnabled && auth.status === "temporarilyUnavailable" && (
        <Button
          label="Thử xác nhận phiên lại"
          secondary
          onPress={restoreNativeSession}
        />
      )}
      <Card>
        <View
          style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}
        >
          <History size={23} color={colors.green} />
          <Text style={[styles.heading, { flex: 1 }]}>
            Lịch sử trên thiết bị
          </Text>
        </View>
        <Text style={styles.body}>
          Chỉ lưu mã, tên sản phẩm và thời điểm xem, tối đa 50 mục. Bạn có thể
          xóa bất cứ lúc nào.
        </Text>
        <Button
          label="Xem lịch sử"
          secondary
          icon={<History color={colors.green} size={19} />}
          onPress={() => router.push("/history")}
        />
      </Card>
      {auth.available && (
        <Button
          label="Đọc Điều khoản và Chính sách bản thử"
          secondary
          onPress={() => router.push("/legal")}
        />
      )}
    </Screen>
  );
}
