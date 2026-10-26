import {NewsCover} from '../../../components/NewsCover';
import { useLocalSearchParams,useFocusEffect } from 'expo-router';
import {useCallback} from 'react';
import { ScrollView, View } from 'react-native';
import { api, type Schemas } from '../../../api/client';
import { GreenHeader, Loading, Notice, T } from '../../../components/ui';
import { date } from '../../../lib/format';
import { useLoad } from '../../../lib/useApi';
import { color } from '../../../theme/tokens';

export default function NewsDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading,reload } = useLoad(() => api<Schemas['PublicNewsDetailDto']>(`/public/news/${encodeURIComponent(id ?? '')}`), [id]);
  useFocusEffect(useCallback(()=>{void reload();},[reload]));
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <GreenHeader title="Bài viết" back />
      {!data || error ? (
        loading ? <Loading /> : <View style={{ padding: 16 }}><Notice kind="error" title={error ?? 'Không tìm thấy bài viết'} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}>
          <T size={13.5} weight="bold" c={color.muted}>
            {date(data.publishedAt)}
          </T>
          {data.hasCover&&<View style={{height:220,borderRadius:12,overflow:'hidden'}}><NewsCover article={data}/></View>}
          <T size={24} weight="heavy">
            {data.title}
          </T>
          <T size={16.5} weight="bold" c={color.inkSoft}>
            {data.summary}
          </T>
          <T size={16} style={{ lineHeight: 26 }}>
            {data.body}
          </T>
        </ScrollView>
      )}
    </View>
  );
}
