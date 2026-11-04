import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import type { Schemas } from '../../../api/client';
import { useSession } from '../../../auth/session';
import { Card, Header, initialOf, ListItem, Pill, Screen, Section, T } from '../../../components/staff/ui';
import { useAccess } from '../../../lib/access';
import { readQueue } from '../../../lib/queue';
import { color, space } from '../../../theme/staff';

/** Account and every assigned feature (the same list as the tabs and Home). */
export default function More() {
  const { user, signOut } = useSession<Schemas['AuthUserDto']>();
  const { features, access } = useAccess();
  const [pending, setPending] = useState(0);
  useFocusEffect(
    useCallback(() => {
      if (user) void readQueue(user).then((q) => setPending(q.length));
    }, [user]),
  );
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <Header title="Thêm" />
      <Screen bottomInset={96}>
        <Card style={{ padding: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: color.greenTint, alignItems: 'center', justifyContent: 'center' }}>
            <T size={20} weight="heavy" c={color.greenDeep}>
              {initialOf(user?.fullName)}
            </T>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T size={16} weight="bold" numberOfLines={1}>
              {user?.fullName}
            </T>
            <T size={13} c={color.muted} numberOfLines={1}>
              {user?.email}
            </T>
          </View>
          <Pill label="Nhân viên" t="green" />
        </Card>
        <Section title="Công việc">
          {features.map((f, i) => (
            <ListItem key={f.key} first={i === 0} icon={f.icon} t="green" title={f.label} subtitle={f.hint} onPress={() => router.push(f.href as never)} />
          ))}
        </Section>
        <Section title="Thiết bị và tài khoản">
          <ListItem first icon="sync" t="blue" title="Lệnh chờ gửi" subtitle="Lệnh đã ghi khi mất mạng hoặc chưa rõ kết quả" value={pending ? String(pending) : undefined} onPress={() => router.push('/staff/sync')} />
          <ListItem icon="lock" t="gray" title="Đổi mật khẩu" onPress={() => router.push('/staff/password')} />
          <ListItem
            icon="logout"
            t="red"
            title="Đăng xuất"
            onPress={async () => {
              await signOut();
              router.replace('/staff/login');
            }}
          />
        </Section>
        <T size={12} c={color.faint} style={{ textAlign: 'center' }}>
          AgriTrace Nhân viên {Constants.expoConfig?.version ?? ''}
          {access && access.stage !== 'ACTIVE' ? ` · ${access.stage}` : ''}
        </T>
      </Screen>
    </View>
  );
}
