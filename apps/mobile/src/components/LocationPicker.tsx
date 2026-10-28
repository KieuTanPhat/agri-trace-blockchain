import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import locations from '../locations/vietnam.json';
import { color, font, noOutline } from '../theme/tokens';
import { Icon } from './Icon';
import { IconButton, T } from './ui';

type Unit = { code: string; label: string };
export const PROVINCES = locations.provinces as (Unit & { wards: Unit[] })[];

/** Searchable list sheet for province, then ward (two-level units). */
export function LocationPicker({
  label,
  value,
  options,
  onPick,
  disabled,
  error,
}: {
  label: string;
  value?: Unit;
  options: Unit[];
  onPick: (unit: Unit) => void;
  disabled?: boolean;
  error?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase('vi');
    return needle ? options.filter((o) => o.label.toLocaleLowerCase('vi').includes(needle)) : options;
  }, [options, q]);
  return (
    <View style={{ flex: 1, gap: 7 }}>
      <T size={15.5} weight="heavy">
        {label}
        <T c={color.red}> *</T>
      </T>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value?.label ?? 'chưa chọn'}`}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={{ height: 56, borderRadius: 14, borderWidth: 1.5, borderColor: error ? color.red : color.field, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: disabled ? color.bg : '#fff' }}
      >
        <T numberOfLines={1} c={value ? color.ink : color.faint} style={{ flex: 1 }}>
          {value?.label.replace(/^(Tỉnh|Thành phố|Phường|Xã|Đặc khu) /, '') ?? 'Chọn'}
        </T>
        <Icon name="down" size={16} color={color.muted} />
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 8, gap: 4 }}>
            <IconButton name="close" label="Đóng" onPress={() => setOpen(false)} />
            <T size={19} weight="heavy">
              {label}
            </T>
          </View>
          <View style={{ marginHorizontal: 16, height: 48, borderRadius: 12, backgroundColor: color.bg, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
            <Icon name="search" size={20} color={color.muted} />
            <TextInput value={q} onChangeText={setQ} placeholder="Tìm theo tên" placeholderTextColor={color.faint} accessibilityLabel={`Tìm ${label}`} style={[{ flex: 1, fontFamily: font.bold, fontSize: 16, color: color.ink }, noOutline]} />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(u) => u.code}
            initialNumToRender={30}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onPick(item);
                  setOpen(false);
                  setQ('');
                }}
                style={{ paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: color.line, flexDirection: 'row', alignItems: 'center' }}
              >
                <T size={16} style={{ flex: 1 }}>
                  {item.label}
                </T>
                {value?.code === item.code && <Icon name="check" size={20} color={color.green} />}
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}
