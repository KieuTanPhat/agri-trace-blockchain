import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Schemas } from '../../../api/client';
import { useSession } from '../../../auth/session';
import { Icon } from '../../../components/Icon';
import { Button, Card, GreenHeader, Loading, Notice, Pill, T } from '../../../components/ui';
import { dateTime, qty } from '../../../lib/format';
import { CYCLE_STATE } from '../../../lib/labels';
import { useLoad } from '../../../lib/useApi';
import { color } from '../../../theme/tokens';

type Cycle = Schemas['CycleDetailDto'];

export default function CycleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user, call } = useSession<Schemas['AuthUserDto']>();
  const { data: cycle, error, loading, reload } = useLoad(() => call<Cycle>(`/production-cycles/${id}`), [id]);
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );
  if (!cycle)
    return (
      <View style={{ flex: 1 }}>
        <GreenHeader title="Mùa vụ" back />
        {loading ? <Loading /> : <View style={{ padding: 16 }}><Notice kind="error" title={error ?? 'Không tìm thấy mùa vụ'} /></View>}
      </View>
    );
  const state = CYCLE_STATE[cycle.currentState] ?? { label: cycle.currentState, t: 'blue' as const };
  const harvested = cycle.harvestEvents.reduce((s, h) => s + Number(h.quantity), 0);
  const planned = Number(cycle.maxHarvestQuantity ?? cycle.plannedHarvest ?? 0);
  const pct = planned > 0 ? Math.min(100, Math.round((harvested / planned) * 100)) : null;
  const writable = cycle.canWriteProduction === true && ['PLANTED', 'GROWING'].includes(cycle.currentState);
  const assigned = (cycle.staffUserIds ?? []).length === 0 || (!!user && (cycle.staffUserIds ?? []).includes(user.id));
  const log = [
    ...cycle.harvestEvents.map((h) => ({ id: h.id, at: h.harvestTime, title: `Thu hoạch ${qty(h.quantity, h.unit)}`, who: h.representative, icon: 'basket' as const, bg: color.orangeTint, fg: color.orange })),
    ...cycle.careRecords.map((c) => ({ id: c.id, at: c.eventTime, title: [c.careType, c.name].filter(Boolean).join(': '), who: null, icon: 'journal' as const, bg: color.purpleTint, fg: color.purple })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <GreenHeader title="Mùa vụ" back extraBottom={34} />
        <Card style={{ marginTop: -30, marginHorizontal: 16, padding: 16, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Pill label={state.label} t={state.t} />
            {user && (cycle.staffUserIds ?? []).includes(user.id) && <Pill label="Bạn được giao" t="orange" />}
          </View>
          <T size={23} weight="heavy">
            {cycle.product.productName}
          </T>
          <T size={13.5} c={color.muted} style={{ fontFamily: 'monospace' }}>
            {cycle.cycleCode}
          </T>
        </Card>

        <View style={{ padding: 16, gap: 12 }}>
          <Card style={{ padding: 16, gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <T size={16} weight="heavy">
                Sản lượng đã thu
              </T>
              {planned > 0 && (
                <T size={14} weight="bold" c={color.muted}>
                  dự kiến {qty(planned, cycle.harvestUnit)}
                </T>
              )}
            </View>
            <T size={34} weight="heavy" c={color.green}>
              {qty(harvested, cycle.harvestUnit ?? cycle.harvestEvents[0]?.unit)}
            </T>
            {pct !== null && (
              <View style={{ height: 12, borderRadius: 6, backgroundColor: color.line, overflow: 'hidden' }} accessibilityLabel={`Đã thu ${pct}% sản lượng dự kiến`}>
                <View style={{ width: `${pct}%`, height: '100%', borderRadius: 6, backgroundColor: color.green }} />
              </View>
            )}
            <T size={14} c={color.inkSoft}>
              {cycle.harvestEvents.length} đợt thu hoạch{cycle.harvestUnit ? ` · đơn vị cố định theo kế hoạch: ${cycle.harvestUnit}` : ''}
            </T>
          </Card>

          <Card style={{ padding: 16, flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 }}>
            {[
              { icon: 'home' as const, v: cycle.farm.name, l: 'Vườn' },
              { icon: 'leaf' as const, v: cycle.plot?.name ?? '—', l: 'Lô đất' },
              { icon: 'clock' as const, v: dateTime(cycle.startDate).split(' · ')[0], l: 'Bắt đầu' },
              { icon: 'user' as const, v: `${(cycle.staffUserIds ?? []).length || 'Chưa'} người`, l: 'Được giao' },
            ].map((x) => (
              <View key={x.l} style={{ width: '50%', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: color.greenTint, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={x.icon} size={18} color={color.green} />
                </View>
                <View style={{ flex: 1 }}>
                  <T size={15} weight="heavy" numberOfLines={1}>
                    {x.v}
                  </T>
                  <T size={13} weight="bold" c={color.muted}>
                    {x.l}
                  </T>
                </View>
              </View>
            ))}
          </Card>

          {!assigned && <Notice kind="info" title="Bạn chưa được giao vụ này" body="Bạn xem được nhưng chỉ nhân viên được giao mới ghi nhật ký và thu hoạch." />}

          <Card>
            <T size={17} weight="heavy" style={{ padding: 16, paddingBottom: 8 }}>
              Nhật ký gần đây
            </T>
            {log.length === 0 && (
              <T c={color.muted} style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
                Chưa có nhật ký nào.
              </T>
            )}
            {log.slice(0, 12).map((e) => (
              <View key={e.id} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: color.line }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: e.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={e.icon} size={22} color={e.fg} />
                </View>
                <View style={{ flex: 1 }}>
                  <T size={15.5} weight="heavy">
                    {e.title}
                  </T>
                  <T size={13.5} c={color.muted}>
                    {dateTime(e.at)}
                    {e.who ? ` · ${e.who}` : ''}
                  </T>
                </View>
              </View>
            ))}
          </Card>
        </View>
      </ScrollView>
      {writable && assigned && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, paddingBottom: insets.bottom + 12, backgroundColor: '#fff', flexDirection: 'row', gap: 10, shadowColor: '#101828', shadowOpacity: 0.08, shadowRadius: 16, elevation: 12 }}>
          <Button label="Ghi nhật ký" kind="soft" style={{ flex: 1 }} onPress={() => router.push(`/staff/care/${cycle.id}`)} />
          <Button label="Ghi thu hoạch" style={{ flex: 1 }} onPress={() => router.push(`/staff/harvest/${cycle.id}`)} />
        </View>
      )}
    </View>
  );
}
