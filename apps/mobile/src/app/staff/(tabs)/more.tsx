import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import type { Schemas } from '../../../api/client';
import { useSession } from '../../../auth/session';
import { Icon, type IconName } from '../../../components/Icon';
import { Card, GreenHeader, initialOf, Notice, T } from '../../../components/ui';
import { readQueue } from '../../../lib/queue';
import { color } from '../../../theme/tokens';

function Item({ icon, tint, label, onPress, right, danger }: { icon: IconName; tint: string; label: string; onPress: () => void; right?: ReactNode; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52, paddingHorizontal: 16, backgroundColor: pressed ? color.bg : 'transparent' })}>
      <Icon name={icon} size={26} color={tint} />
      <T size={16} weight={danger ? 'heavy' : 'regular'} c={danger ? color.redDeep : color.ink} style={{ flex: 1 }}>
        {label}
      </T>
      {right ?? <Icon name="chevron" size={20} color={color.faint} />}
    </Pressable>
  );
}

export default function More() {
  const { user, signOut } = useSession<Schemas['AuthUserDto']>();
  const [pending, setPending] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setPending(0);
      if(user)void readQueue(user).then((q) => setPending(q.length));
    }, [user]),
  );
  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.bg }} contentContainerStyle={{ paddingBottom: 72 }}>
      <GreenHeader title="Thêm" />
      <View style={{ backgroundColor: '#fff', padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: color.greenTint, alignItems: 'center', justifyContent: 'center' }}>
          <T size={24} weight="heavy" c={color.greenDeep}>
            {initialOf(user?.fullName)}
          </T>
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <T size={19} weight="heavy">
            {user?.fullName}
          </T>
          <View style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 3, borderRadius: 999, backgroundColor: color.green }}>
            <T size={13} weight="heavy" c="#fff">
              {user?.email}
            </T>
          </View>
        </View>
      </View>
      <View style={{ padding: 16, gap: 12 }}>
        {user?.mustChangePassword && <Notice kind="warn" title="Cần đổi mật khẩu" body="Đổi mật khẩu trên AgriTrace Web trước khi ghi nghiệp vụ." />}
        <Card style={{ paddingVertical: 6 }}>
          <T size={16.5} weight="heavy" style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
            Công việc
          </T>
          <Item icon="leaf" tint={color.green} label="Mùa vụ được giao" onPress={() => router.push('/staff/journal')} />
          <Item icon="scan" tint={color.blue} label="Quét mã lô" onPress={() => router.push('/staff/scan')} />
          <Item icon="truck" tint={color.blue} label="Chuyến hàng" onPress={() => router.push('/staff/transfers')} />
        </Card>
        <Card style={{ paddingVertical: 6 }}>
          <T size={16.5} weight="heavy" style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
            Cá nhân
          </T>
          <Item
            icon="sync"
            tint="#14a3b8"
            label="Lệnh chờ gửi"
            onPress={() => router.push('/staff/sync')}
            right={
              pending ? (
                <View style={{ minWidth: 24, height: 24, borderRadius: 12, backgroundColor: color.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
                  <T size={13} weight="heavy" c="#fff">
                    {pending}
                  </T>
                </View>
              ) : undefined
            }
          />
          <Item
            icon="logout"
            tint={color.red}
            label="Đăng xuất"
            danger
            right={<View />}
            onPress={async () => {
              await signOut();
              router.replace('/staff/login');
            }}
          />
        </Card>
      </View>
    </ScrollView>
  );
}
