import {NewsCover} from '../../../components/NewsCover';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { api, type Schemas } from '../../../api/client';
import { Empty, GreenHeader, Loading, Notice, T } from '../../../components/ui';
import { date } from '../../../lib/format';
import { useLoad } from '../../../lib/useApi';
import { color } from '../../../theme/tokens';

/** News list (photo-left rows from the reference) and system notices. */
export default function News() {
  const [tab, setTab] = useState<'news' | 'notices'>('news');
  const news = useLoad(() => api<Schemas['PublicNewsPageDto']>('/public/news?limit=20'));
  const notices = useLoad(() => api<Schemas['PublicAnnouncementsPageDto']>('/public/announcements?limit=20'));
  const reloadNews = news.reload, reloadNotices = notices.reload;
  useFocusEffect(useCallback(()=>{void reloadNews();void reloadNotices();},[reloadNews,reloadNotices]));
  const current = tab === 'news' ? news : notices;
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <GreenHeader title="Bảng tin" back />
      <View style={{ flexDirection: 'row', gap: 10, padding: 16 }}>
        {(
          [
            ['news', 'Tất cả'],
            ['notices', 'Thông báo'],
          ] as const
        ).map(([key, label]) => (
          <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={{ flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: tab === key ? color.green : color.line }}>
            <T size={15.5} weight="heavy" c={tab === key ? '#fff' : color.inkSoft}>
              {label}
            </T>
          </Pressable>
        ))}
      </View>
      {current.loading && !current.data ? (
        <Loading />
      ) : current.error ? (
        <View style={{ paddingHorizontal: 16 }}>
          <Notice kind="error" title={current.error} />
        </View>
      ) : tab === 'news' ? (
        <FlatList
          data={news.data?.items ?? []}
          refreshing={news.loading} onRefresh={()=>void news.reload()}
          keyExtractor={(i) => i.id}
          ListEmptyComponent={<Empty title="Chưa có bài viết" icon="journal" />}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" onPress={() => router.push(`/consumer/news/${item.id}`)} style={{ flexDirection: 'row', gap: 14, padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: color.line }}>
              <View style={{ width: 96, height: 96, borderRadius: 12, backgroundColor: color.greenTint, overflow:'hidden', alignItems: 'center', justifyContent: 'center' }}>
                <NewsCover article={item}/>
              </View>
              <View style={{ flex: 1, justifyContent: 'space-between' }}>
                <T size={16} weight="bold" numberOfLines={3}>
                  {item.title}
                </T>
                <T size={14} c={color.muted}>
                  {date(item.publishedAt)}
                </T>
              </View>
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          data={notices.data?.items ?? []}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingBottom: 32 }}
          ListEmptyComponent={<Empty title="Không có thông báo nào" icon="bell" />}
          renderItem={({ item }) => <Notice kind={item.severity === 'CRITICAL' ? 'error' : item.severity === 'WARNING' ? 'warn' : 'info'} title={item.title} body={item.body} />}
        />
      )}
    </View>
  );
}
