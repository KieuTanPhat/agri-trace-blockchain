import { ScrollView, View } from 'react-native';
import { GreenHeader, Notice, T } from '../../components/ui';
import { color } from '../../theme/tokens';

/** Placeholder until the owner supplies the reviewed, versioned text. */
export default function Policy() {
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <GreenHeader title="Điều khoản và bảo mật" back />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <Notice kind="warn" title="Văn bản giữ chỗ" body="Bản chính thức do chủ dự án và người có chuyên môn pháp lý duyệt. Văn bản này chưa có giá trị pháp lý." />
        <T size={18} weight="heavy">
          ACheck thuộc AgriTrace
        </T>
        <T c={color.inkSoft}>
          ACheck giúp bạn xem nguồn gốc và hành trình nông sản qua mã QR trên tem. Quét mã, tìm sản phẩm và đọc tin không cần tài khoản.
        </T>
        <T c={color.inkSoft}>
          Khi đăng ký, ứng dụng lưu số điện thoại, họ tên, tỉnh/thành, phường/xã, email liên hệ và địa chỉ doanh nghiệp (nếu bạn nhập), cùng phiên bản văn bản bạn đã đồng ý. Lịch sử quét chỉ lưu trên điện thoại của bạn.
        </T>
      </ScrollView>
    </View>
  );
}
