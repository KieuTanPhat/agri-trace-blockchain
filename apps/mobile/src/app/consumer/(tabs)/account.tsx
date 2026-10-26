import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import type { Schemas } from '../../../api/client';
import { useSession } from '../../../auth/session';
import { Icon, type IconName } from '../../../components/Icon';
import { Button, Card, GreenHeader, initialOf, Loading, T } from '../../../components/ui';
import { color } from '../../../theme/tokens';

type Profile = Schemas['ConsumerProfileDto'];

function MenuItem({ icon, bg, label, onPress, danger, right }: { icon: IconName; bg: string; label: string; onPress: () => void; danger?: boolean; right?: ReactNode }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 54, paddingHorizontal: 16, backgroundColor: pressed ? color.bg : 'transparent' })}>
      <Icon name={icon} size={26} color={bg} />
      <T size={16} weight={danger ? 'heavy' : 'regular'} c={danger ? color.redDeep : color.ink} style={{ flex: 1 }}>
        {label}
      </T>
      {right ?? <Icon name="chevron" size={20} color={color.faint} />}
    </Pressable>
  );
}

export default function Account() {
  const { status, user, signOut } = useSession<Profile>();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.bg }} contentContainerStyle={{ paddingBottom: 72 }}>
      <GreenHeader title="Tài khoản" />
      <View style={{ backgroundColor: '#fff', padding: 16 }}>
        {status === 'loading' ? (
          <Loading />
        ) : user ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: color.orangeTint, alignItems: 'center', justifyContent: 'center' }}>
              <T size={24} weight="heavy" c={color.orangeDeep}>
                {initialOf(user.fullName)}
              </T>
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <T size={19} weight="heavy">
                {user.fullName}
              </T>
              <View style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 3, borderRadius: 999, backgroundColor: color.green }}>
                <T size={13} weight="heavy" c="#fff">
                  {user.phone.replace(/^\+84(\d{3})\d{3}(\d{3})$/, '0$1 *** $2')}
                </T>
              </View>
            </View>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <T size={18} weight="heavy">
              Bạn chưa đăng nhập
            </T>
            <T c={color.muted}>Quét mã, tìm sản phẩm và đọc tin không cần tài khoản.</T>
            <Button label="Đăng nhập" onPress={() => router.push('/consumer/login')} />
          </View>
        )}
      </View>

      <View style={{ padding: 16, gap: 12 }}>
        {user && (
          <Card style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
            {[
              ['ĐỊA CHỈ', `${user.ward}, ${user.province}`],
              ['EMAIL LIÊN HỆ', user.contactEmail ?? 'Chưa nhập'],
              ['ĐỊA CHỈ DOANH NGHIỆP', user.businessAddress ?? 'Chưa nhập'],
            ].map(([label, value], i) => (
              <View key={label} style={{ paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: color.line, gap: 2 }}>
                <T size={13} weight="heavy" c={color.muted}>
                  {label}
                </T>
                <T size={15.5}>{value}</T>
              </View>
            ))}
          </Card>
        )}
        <Card style={{ paddingVertical: 6 }}>
          <T size={16.5} weight="heavy" style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
            Tiện ích
          </T>
          <MenuItem icon="clock" bg={color.purple} label="Lịch sử quét trên máy này" onPress={() => router.push('/consumer/history')} />
          <MenuItem icon="bell" bg={color.blue} label="Thông báo" onPress={() => router.push('/consumer/news')} />
        </Card>
        <Card style={{ paddingVertical: 6 }}>
          <T size={16.5} weight="heavy" style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
            Hỗ trợ
          </T>
          <MenuItem icon="journal" bg={color.green} label="Điều khoản và Chính sách bảo mật" onPress={() => router.push('/consumer/policy')} />
          <MenuItem icon="info" bg="#14a3b8" label="Giới thiệu ACheck · thuộc AgriTrace" onPress={() => router.push('/consumer/policy')} />
          {user && <MenuItem icon="logout" bg={color.red} label="Đăng xuất" danger right={<View />} onPress={() => void signOut()} />}
        </Card>
      </View>
    </ScrollView>
  );
}
