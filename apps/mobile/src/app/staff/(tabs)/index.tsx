import { Image } from 'expo-image';
import { BrandLogo } from '../../../components/BrandLogo';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Schemas } from '../../../api/client';
import { useSession } from '../../../auth/session';
import { DeviceKeyCard } from '../../../components/DeviceKeyCard';
import { DirectoryPhoto } from '../../../components/DirectoryCards';
import { Icon, type IconName } from '../../../components/staff/Icon';
import { Button, Card, Empty, IconButton, IconTile, initialOf, Notice, Pill, Screen, Section, T } from '../../../components/staff/ui';
import { useAccess, type FeatureKey } from '../../../lib/access';
import { readQueue } from '../../../lib/queue';
import { useLoad } from '../../../lib/useApi';
import { color, radius, space, type Tone } from '../../../theme/staff';

type User = Schemas['AuthUserDto'];
type Task = { transferId: string; action: string; origin: string; destination: string; createdAt: string };
const SHORT = { staleTimeMs: 20_000 };
const TONES: Tone[] = ['green', 'blue', 'orange', 'purple'];
const ACTION: Record<string, { label: string; t: Tone }> = {
  CONSENT: { label: 'Ký xác nhận', t: 'orange' },
  PICKUP: { label: 'Ký lấy hàng', t: 'blue' },
  DELIVERY: { label: 'Ký giao nhận', t: 'green' },
  ACTUAL_RECEIPT: { label: 'Ghi thực nhận', t: 'purple' },
};
const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function greeting() {
  const h = new Date().getHours();
  return h < 11 ? 'Chào buổi sáng,' : h < 14 ? 'Chào buổi trưa,' : h < 18 ? 'Chào buổi chiều,' : 'Chào buổi tối,';
}

/** Date chip of the "Việc sắp tới" list: weekday over day/month. */
function DateChip({ at }: { at: string }) {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return (
    <View style={{ width: 52, paddingVertical: 8, borderRadius: radius.md, backgroundColor: color.greenTint, alignItems: 'center' }}>
      <T size={11} weight="medium" c={color.greenDeep}>
        {today ? 'Hôm nay' : WEEKDAY[d.getDay()]}
      </T>
      <T size={13} weight="bold" c={color.greenDeep}>
        {`${d.getDate()}/${d.getMonth() + 1}`}
      </T>
    </View>
  );
}

/** Today's work for an employee: shortcuts, the main call to action and what is next. */
export default function StaffHome() {
  const insets = useSafeAreaInsets();
  const { user, call } = useSession<User>();
  const { features, active, data } = useAccess();
  const has = (key: FeatureKey) => features.some((f) => f.key === key);
  const [pending, setPending] = useState(0);
  useFocusEffect(
    useCallback(() => {
      if (user) void readQueue(user).then((q) => setPending(q.length));
    }, [user]),
  );
  const tasks = useLoad(() => (has('tasks') ? call<{ transfers: Task[] }>('/distribution/tasks') : Promise.resolve(null)), [has('tasks')], { key: 'home-tasks', ...SHORT });
  const cycles = useLoad(() => (has('journal') ? call<Schemas['CycleListDto'][]>('/production-cycles') : Promise.resolve(null)), [has('journal')], { key: 'home-cycles', ...SHORT });
  const messages = useLoad(() => call<{ counts: { unread: number } }>('/enterprise-messages'), [], { key: 'home-messages', ...SHORT });
  const name = (user?.fullName ?? '').replace(/\([^)]*\)/g, '').trim();
  const signable = (tasks.data?.transfers ?? []).filter((t) => ACTION[t.action]);
  const running = (cycles.data ?? []).filter((c) => ['PLANTED', 'GROWING'].includes(c.currentState));

  const shortcuts: { label: string; icon: IconName; href: string }[] = [
    { label: 'Quét QR', icon: 'scan', href: '/staff/scan' },
    ...features
      .filter((f) => !['messages', 'signing'].includes(f.key))
      .slice(0, 3)
      .map((f) => ({ label: f.label, icon: f.icon, href: f.href })),
  ];
  const banner = signable.length
    ? { tag: 'CẦN LÀM', title: `${signable.length} việc cần xác nhận`, body: 'Kiểm tra lô, số lượng rồi ký bằng khóa trên điện thoại.', action: 'Xem việc ký', href: '/staff/tasks', icon: 'tasks' as const }
    : running.length
      ? { tag: 'MÙA VỤ', title: `${running.length} mùa vụ đang làm`, body: 'Ghi tưới nước, chăm sóc cây và thu hoạch kèm ảnh tại vườn.', action: 'Mở mùa vụ', href: '/staff/journal', icon: 'leaf' as const }
      : null;

  const refresh = () => {
    void tasks.reload();
    void cycles.reload();
    void messages.reload();
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 174, overflow: 'hidden', backgroundColor: '#edf7ec' }}>
        <Image source={require('../../../../assets/images/hero-rice-terraces.jpg')} style={{ width: '100%', height: '100%', opacity: 0.16 }} contentFit="cover" accessibilityElementsHidden />
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(239,248,236,0.62)' }} />
      </View>
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: space.lg, paddingBottom: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <BrandLogo variant="staff" maxWidth={168} align="start" />
        <View style={{ flex: 1 }} />
        {pending > 0 && <IconButton name="sync" label="Lệnh chờ gửi" badge={pending} onPress={() => router.push('/staff/sync')} />}
        <IconButton name="bell" label="Thông báo nội bộ" badge={messages.data?.counts.unread} onPress={() => router.push('/staff/messages')} />
        <Pressable accessibilityRole="button" accessibilityLabel="Tài khoản" onPress={() => router.push('/staff/more')} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: color.greenTint, alignItems: 'center', justifyContent: 'center' }}>
          <T size={14} weight="bold" c={color.greenDeep}>
            {initialOf(user?.fullName)}
          </T>
        </Pressable>
      </View>
      <Screen refreshing={tasks.loading || cycles.loading} onRefresh={refresh} style={{ paddingTop: space.sm, gap: space.lg }}>
        <View style={{ gap: 2 }}>
          <T size={14} c={color.inkSoft}>
            {greeting()}
          </T>
          <T size={22} weight="heavy" numberOfLines={1}>
            {name}
          </T>
          <T size={12.5} c={color.muted}>
            Đây là công việc của bạn hôm nay.
          </T>
        </View>

        {data && !active && <Notice kind="warn" title="Doanh nghiệp chưa hoạt động" body="Bạn chỉ xem được thông tin. Liên hệ chủ doanh nghiệp khi cần làm việc." />}

        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {shortcuts.map((s, i) => (
            <Pressable key={s.href} accessibilityRole="button" accessibilityLabel={s.label} onPress={() => router.push(s.href as never)} style={({ pressed }) => ({ width: '23%', minHeight: 102, alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 9, borderRadius: radius.xl, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface, opacity: pressed ? 0.78 : 1 })}>
              <IconTile name={s.icon} t={TONES[i % TONES.length]} size={50} glyph={22} />
              <T size={11.5} weight="bold" numberOfLines={1} style={{ textAlign: 'center' }}>
                {s.label}
              </T>
            </Pressable>
          ))}
          {Array.from({ length: Math.max(0, 4 - shortcuts.length) }, (_, i) => (
            <View key={`gap-${i}`} style={{ width: '23%' }} />
          ))}
        </View>

        {banner && (
          <View style={{ borderRadius: radius.xl, padding: space.lg, backgroundColor: color.greenTint, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Pill label={banner.tag} t="green" />
              <T size={17} weight="heavy" c={color.greenDeep}>
                {banner.title}
              </T>
              <T size={12.5} c={color.inkSoft}>
                {banner.body}
              </T>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(banner.href as never)}
                style={({ pressed }) => ({ alignSelf: 'flex-start', marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.full, backgroundColor: color.greenDeep, opacity: pressed ? 0.85 : 1 })}
              >
                <T size={12.5} weight="bold" c="#fff">
                  {banner.action}
                </T>
                <Icon name="chevron" size={14} color="#fff" />
              </Pressable>
            </View>
            <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: '#d3ecdd', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={banner.icon} size={40} color={color.green} strokeWidth={1.6} />
            </View>
          </View>
        )}

        {pending > 0 && (
          <Pressable accessibilityRole="button" onPress={() => router.push('/staff/sync')}>
            <Notice kind="warn" title={`${pending} lệnh đang chờ gửi`} body="Máy gửi lại bằng đúng mã lệnh cũ khi có mạng. Bấm để xem." />
          </Pressable>
        )}
        {has('signing') && <DeviceKeyCard quiet />}

        {has('tasks') && (
          <Section title="Việc sắp tới" action={signable.length ? 'Xem tất cả ›' : undefined} onAction={() => router.push('/staff/tasks')}>
            {signable.length === 0 ? (
              <Empty title="Không có việc ký" icon="tasks" />
            ) : (
              signable.slice(0, 4).map((t, i) => (
                <Pressable
                  key={`${t.transferId}:${t.action}`}
                  accessibilityRole="button"
                  onPress={() => router.push(`/staff/transfer/${t.transferId}`)}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: color.line, backgroundColor: pressed ? '#f9fbfa' : undefined })}
                >
                  <DateChip at={t.createdAt} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <T size={13.5} weight="bold" numberOfLines={1}>
                      {t.destination}
                    </T>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Icon name="location" size={12} color={color.muted} />
                      <T size={11.5} c={color.muted} numberOfLines={1} style={{ flex: 1 }}>
                        Từ {t.origin}
                      </T>
                    </View>
                  </View>
                  <Pill label={ACTION[t.action].label} t={ACTION[t.action].t} />
                </Pressable>
              ))
            )}
          </Section>
        )}

        {!has('tasks') && has('journal') && (
          <Section title="Mùa vụ đang làm" action={running.length ? 'Xem tất cả ›' : undefined} onAction={() => router.push('/staff/journal')}>
            {running.length === 0 ? (
              <Empty title="Chưa có vụ đang làm" icon="leaf" />
            ) : (
              running.slice(0, 4).map((c, i) => (
                <Pressable key={c.id} accessibilityRole="button" onPress={() => router.push(`/staff/cycle/${c.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: color.line }}>
                  <View style={{ width: 50, height: 50, borderRadius: 14, overflow: 'hidden', backgroundColor: color.greenTint }}>
                    <DirectoryPhoto url={`/public/products/${c.product.id}/image`} label={c.product.productName} fit="cover" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <T size={13.5} weight="bold">
                      {c.product.productName}
                    </T>
                    <T size={11.5} c={color.muted} numberOfLines={1}>
                      {c.cycleCode} · {c.farm.name}
                    </T>
                  </View>
                  <Icon name="chevron" size={16} color={color.faint} />
                </Pressable>
              ))
            )}
          </Section>
        )}

        {data && features.length <= 1 && (
          <Card>
            <Empty title="Bạn chưa được giao việc" body="Chủ doanh nghiệp gán nhóm quyền cho bạn trên AgriTrace Web; kéo xuống để tải lại." icon="tasks" />
          </Card>
        )}
        {features.length > 4 && <Button label="Mọi chức năng của bạn" kind="outline" icon="more" onPress={() => router.push('/staff/more')} />}
      </Screen>
    </View>
  );
}
