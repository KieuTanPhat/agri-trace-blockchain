import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { api, type Schemas } from '../../../api/client';
import { useSession } from '../../../auth/session';
import { CycleCard } from '../../../components/CycleCard';
import { decorative, Icon } from '../../../components/Icon';
import { Card, Empty, GreenHeader, IconButton, IconTile, Loading, Notice, SegmentTabs, T } from '../../../components/ui';
import { qty } from '../../../lib/format';
import { readProvince } from '../../../lib/local';
import { readQueue } from '../../../lib/queue';
import { useLoad } from '../../../lib/useApi';
import { weatherText } from '../../../lib/weather';
import { color, shadow } from '../../../theme/tokens';

type User = Schemas['AuthUserDto'];

export default function StaffHome() {
  const { user, call } = useSession<User>();
  const [tab, setTab] = useState<'cycles' | 'lots'>('cycles');
  const [pending, setPending] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setPending(0);
      if(user)void readQueue(user).then((q) => setPending(q.length));
    }, [user]),
  );
  const cycles = useLoad(() => call<Schemas['CycleListDto'][]>('/production-cycles'));
  const lots = useLoad(() => call<Schemas['InternalLotDto'][]>('/lots'));
  const weather = useLoad(async () => api<Schemas['PublicWeatherDto']>(`/public/weather?province=${await readProvince()}`));
  const active = (cycles.data ?? []).filter((c) => !['COMPLETED', 'CANCELLED'].includes(c.currentState));
  const held = (lots.data ?? []).filter((l) => l.availableQuantity > 0);
  const firstName = (user?.fullName ?? '').replace(/\([^)]*\)/g, '').trim().split(/\s+/).at(-1) ?? '';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.bg }}
      contentContainerStyle={{ paddingBottom: 72 }}
      refreshControl={<RefreshControl refreshing={cycles.loading && !!cycles.data} onRefresh={() => { void cycles.reload(); void lots.reload(); }} />}
    >
      <GreenHeader extraBottom={64}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
            <T size={19} weight="heavy" c={color.green}>
              {firstName[0]?.toUpperCase()}
            </T>
          </View>
          <View style={{ flex: 1 }}>
            <T size={20} weight="heavy" c="#fff">
              Chào {firstName}
            </T>
            <T size={14} weight="bold" c="#fff" numberOfLines={1}>
              {user?.email}
            </T>
          </View>
          <IconButton name="bell" label="Lệnh chờ gửi" tint="#fff" onPress={() => router.push('/staff/sync')} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingHorizontal: 4 }}>
          <View>
            <T size={20} weight="heavy" c="#fff">
              {weather.data ? `${weatherText(weather.data.current.weatherCode)} ${weather.data.current.temperatureC !== null ? `${Math.round(weather.data.current.temperatureC)}°C` : ''}` : 'Hôm nay ở vườn'}
            </T>
            <T size={14} weight="bold" c="#fff">
              {weather.data ? weather.data.provinceName : 'Thời tiết tạm chưa có'}
            </T>
          </View>
          <Svg width={64} height={46} viewBox="0 0 78 56" {...decorative}>
            <Circle cx={46} cy={20} r={15} fill="#ffd25a" />
            <Path d="M18 50h40a13 13 0 0 0 0-26 18 18 0 0 0-34 4 11 11 0 0 0-6 22z" fill="#eaf6ff" />
          </Svg>
        </View>
      </GreenHeader>

      <Card style={[{ marginTop: -58, marginHorizontal: 16, paddingVertical: 16, flexDirection: 'row' }, shadow.raised]}>
        {(
          [
            { label: 'Ghi thu hoạch', icon: 'basket', t: 'orange', go: () => router.push('/staff/journal') },
            { label: 'Ghi nhật ký', icon: 'journal', t: 'purple', go: () => router.push('/staff/journal') },
            { label: 'Quét lô', icon: 'scan', t: 'blue', go: () => router.push('/staff/scan') },
          ] as const
        ).map((a) => (
          <Pressable key={a.label} accessibilityRole="button" onPress={a.go} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
            <IconTile name={a.icon} t={a.t} size={56} />
            <T size={14} weight="bold">
              {a.label}
            </T>
          </Pressable>
        ))}
      </Card>

      {pending > 0 && (
        <Pressable accessibilityRole="button" onPress={() => router.push('/staff/sync')} style={{ marginHorizontal: 16, marginTop: 12 }}>
          <Notice kind="warn" title={`${pending} lệnh đang chờ gửi`} body="Máy sẽ gửi lại bằng đúng mã lệnh cũ khi có mạng. Bấm để xem." />
        </Pressable>
      )}

      <Card style={{ marginHorizontal: 16, marginTop: 12, paddingVertical: 12, flexDirection: 'row' }}>
        {[
          { v: String(active.length), l: 'Vụ đang chạy', c: color.orangeDeep },
          { v: String(held.length), l: 'Lô đang giữ', c: color.blue },
          { v: qty(held.reduce((s, l) => s + l.availableQuantity, 0), held[0]?.unit), l: 'Tồn kho', c: color.green },
        ].map((s, i) => (
          <View key={s.l} style={{ flex: 1, alignItems: 'center', borderLeftWidth: i ? 1 : 0, borderLeftColor: color.line }}>
            <T size={22} weight="heavy" c={s.c} numberOfLines={1}>
              {s.v}
            </T>
            <T size={13.5} weight="bold" c={color.inkSoft}>
              {s.l}
            </T>
          </View>
        ))}
      </Card>

      <View style={{ marginTop: 12 }}>
        <SegmentTabs
          value={tab}
          onChange={setTab}
          items={[
            { key: 'cycles', label: 'Mùa vụ của tôi' },
            { key: 'lots', label: 'Lô đang giữ' },
          ]}
        />
      </View>
      <View style={{ padding: 16, gap: 10 }}>
        {tab === 'cycles' ? (
          cycles.loading && !cycles.data ? (
            <Loading />
          ) : cycles.error ? (
            <Notice kind="error" title={cycles.error} />
          ) : active.length === 0 ? (
            <Empty title="Chưa có mùa vụ nào được giao" body="Quản lý doanh nghiệp giao vụ cho bạn trên AgriTrace Web." icon="leaf" />
          ) : (
            active.map((c) => <CycleCard key={c.id} cycle={c} mine={!!user && (c.staffUserIds ?? []).includes(user.id)} />)
          )
        ) : lots.loading && !lots.data ? (
          <Loading />
        ) : lots.error ? (
          <Notice kind="error" title={lots.error} />
        ) : held.length === 0 ? (
          <Empty title="Không có lô nào đang giữ" icon="box" />
        ) : (
          held.map((l) => (
            <Pressable key={l.lotId} accessibilityRole="button" onPress={() => router.push(`/staff/lot/${l.lotId}`)}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
              <IconTile name="box" t="orange" size={48} glyph={26} />
              <View style={{ flex: 1 }}>
                <T size={16} weight="heavy" numberOfLines={1}>
                  {l.productName}
                </T>
                <T size={13} c={color.muted} style={{ fontFamily: 'monospace' }}>
                  {l.lotCode}
                </T>
              </View>
              <T size={15} weight="heavy" c={color.green}>
                {qty(l.availableQuantity, l.unit)}
              </T>
              <Icon name="chevron" color={color.faint} />
            </Card>
            </Pressable>
          ))
        )}
      </View>
    </ScrollView>
  );
}
