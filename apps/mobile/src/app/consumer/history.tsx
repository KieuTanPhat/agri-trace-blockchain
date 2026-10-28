import {DirectoryPhoto} from '../../components/DirectoryCards';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Icon } from '../../components/Icon';
import { Button, Card, Empty, GreenHeader, T } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { clearHistory, readHistory, type HistoryItem } from '../../lib/local';
import { color } from '../../theme/tokens';

/** Device-only scan history; opening an entry fetches the lot again. */
export default function History() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  useFocusEffect(
    useCallback(() => {
      void readHistory().then(setItems);
    }, []),
  );
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <GreenHeader title="Đã quét trên máy này" back />
      <FlatList
        data={items}
        keyExtractor={(i) => i.token}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
        ListEmptyComponent={<Empty title="Chưa quét mã nào" body="Lịch sử chỉ lưu trên máy này, tối đa 50 mục." icon="clock" />}
        ListFooterComponent={
          items.length ? (
            <Button
              label="Xóa lịch sử trên máy"
              kind="danger"
              style={{ marginTop: 12 }}
              onPress={async () => {
                await clearHistory();
                setItems([]);
              }}
            />
          ) : undefined
        }
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" onPress={() => router.push(`/consumer/trace/${item.token}`)}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
              <View style={{width:54,height:54,borderRadius:10,overflow:'hidden',backgroundColor:'#fff'}}><DirectoryPhoto url={item.imageUrl??`/public/trace/${item.token}/thumbnail`} label={item.productName}/></View>
              <View style={{ flex: 1 }}>
                <T size={16} weight="heavy">
                  {item.productName}
                </T>
                <T size={13.5} c={color.muted}>
                  {dateTime(item.viewedAt)}
                </T>
              </View>
              <Icon name="chevron" color={color.faint} />
            </Card>
          </Pressable>
        )}
      />
    </View>
  );
}
