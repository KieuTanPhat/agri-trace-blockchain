import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, noOutline } from '../theme/tokens';
import { Icon } from './Icon';
import { T } from './ui';

/** Gradient-free version of the reference list header: title + search. */
export function ListHeader({ title, query, onQuery }: { title: string; query: string; onQuery: (q: string) => void }) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(!!query);
  const [draft, setDraft] = useState(query);
  return (
    <View style={{ backgroundColor: color.green, paddingTop: insets.top + 12, paddingBottom: 14, paddingHorizontal: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <T size={26} weight="heavy" c="#fff">
          {title}
        </T>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={open ? 'Đóng tìm kiếm' : 'Tìm kiếm'}
          onPress={() => {
            if (open && query) onQuery('');
            setOpen(!open);
            setDraft('');
          }}
          style={{ width: 46, height: 46, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name={open ? 'close' : 'search'} size={22} color="#fff" />
        </Pressable>
      </View>
      {open && (
        <View style={{ height: 46, borderRadius: 12, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
          <Icon name="search" size={20} color={color.muted} />
          <TextInput
            autoFocus
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => onQuery(draft.trim().slice(0, 100))}
            returnKeyType="search"
            placeholder="Nhập tên rồi bấm tìm"
            placeholderTextColor={color.faint}
            accessibilityLabel={`Tìm ${title.toLowerCase()}`}
            style={[{ flex: 1, fontFamily: font.bold, fontSize: 16, color: color.ink }, noOutline]}
          />
        </View>
      )}
    </View>
  );
}
