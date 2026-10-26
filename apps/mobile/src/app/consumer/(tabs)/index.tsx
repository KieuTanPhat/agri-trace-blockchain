import {NewsCover} from '../../../components/NewsCover';
import {DirectoryPhoto} from '../../../components/DirectoryCards';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { api, type Schemas } from '../../../api/client';
import { decorative, Icon } from '../../../components/Icon';
import { Card, GreenHeader, IconButton, IconTile, SectionTitle, T } from '../../../components/ui';
import { date } from '../../../lib/format';
import { readHistory, readProvince, type HistoryItem } from '../../../lib/local';
import { useLoad } from '../../../lib/useApi';
import { weatherText } from '../../../lib/weather';
import { color, font, shadow, noOutline } from '../../../theme/tokens';

const SLIDES = [
  {
    image: require('../../../../assets/images/hero-rice-terraces.jpg'),
    title: 'Biết rõ nông sản bạn mua',
    body: 'Quét tem để xem nơi trồng và hành trình lô hàng',
    cta: 'Quét ngay',
    href: '/consumer/scan',
  },
  {
    image: require('../../../../assets/images/tea-hills.jpg'),
    title: 'Doanh nghiệp minh bạch',
    body: 'Xem sản phẩm và chứng chỉ công khai của từng đơn vị',
    cta: 'Xem danh sách',
    href: '/consumer/enterprises',
  },
] as const;

export default function Home() {
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [slide, setSlide] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  useFocusEffect(
    useCallback(() => {
      void readHistory().then(setHistory);
    }, []),
  );
  const weather = useLoad(async () => api<Schemas['PublicWeatherDto']>(`/public/weather?province=${await readProvince()}`));
  const news = useLoad(() => api<Schemas['PublicNewsPageDto']>('/public/news?limit=5'));
  useFocusEffect(useCallback(()=>{void news.reload();},[news.reload]));
  const slideWidth = width - 52;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.bg }} contentContainerStyle={{ paddingBottom: 72 }}>
      <GreenHeader extraBottom={62}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <IconButton name="user" label="Tài khoản" tint={color.green} bg="#fff" onPress={() => router.push('/consumer/account')} />
          <View style={{ flex: 1, height: 46, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.22)', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
            <Icon name="search" size={20} color="#fff" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => router.push({ pathname: '/consumer/products', params: { q: query.trim() } })}
              returnKeyType="search"
              placeholder="Tìm sản phẩm, doanh nghiệp"
              placeholderTextColor="rgba(255,255,255,0.85)"
              accessibilityLabel="Tìm kiếm"
              style={[{ flex: 1, color: '#fff', fontFamily: font.bold, fontSize: 15 }, noOutline]}
            />
          </View>
          <IconButton name="bell" label="Thông báo" tint="#fff" onPress={() => router.push('/consumer/news')} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingHorizontal: 4 }}>
          <View style={{ flex: 1 }}>
            {weather.data ? (
              <>
                <T size={22} weight="heavy" c="#fff">
                  {weatherText(weather.data.current.weatherCode)} {weather.data.current.temperatureC !== null ? `${Math.round(weather.data.current.temperatureC)}°C` : ''}
                </T>
                <T size={15} weight="bold" c="#fff">
                  {weather.data.provinceName}
                  {weather.data.current.humidityPercent !== null ? ` · Độ ẩm ${weather.data.current.humidityPercent}%` : ''}
                </T>
              </>
            ) : (
              <>
                <T size={22} weight="heavy" c="#fff">
                  Xin chào!
                </T>
                <T size={15} weight="bold" c="#fff">
                  {weather.loading ? 'Đang lấy thời tiết…' : 'Thời tiết tạm chưa có'}
                </T>
              </>
            )}
          </View>
          <Svg width={78} height={56} viewBox="0 0 78 56" {...decorative}>
            <Circle cx={50} cy={18} r={13} fill="#ffd25a" />
            <Path d="M18 50h40a13 13 0 0 0 0-26 18 18 0 0 0-34 4 11 11 0 0 0-6 22z" fill="#eaf6ff" />
            <Path d="M24 50h34a13 13 0 0 0 4-25.4A18 18 0 0 1 28 50z" fill="#cfe7f7" />
          </Svg>
        </View>
      </GreenHeader>

      <Card style={[{ marginTop: -56, marginHorizontal: 16, paddingVertical: 16, flexDirection: 'row' }, shadow.raised]}>
        {(
          [
            { label: 'Sản phẩm', icon: 'box', t: 'orange', href: '/consumer/products' },
            { label: 'Doanh nghiệp', icon: 'building', t: 'blue', href: '/consumer/enterprises' },
            { label: 'Bảng tin', icon: 'journal', t: 'green', href: '/consumer/news' },
            { label: 'Đã quét', icon: 'clock', t: 'purple', href: '/consumer/history' },
          ] as const
        ).map((item) => (
          <Pressable key={item.label} accessibilityRole="button" onPress={() => router.push(item.href)} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
            <IconTile name={item.icon} t={item.t} />
            <T size={13.5} weight="bold" style={{ textAlign: 'center' }}>
              {item.label}
            </T>
          </Pressable>
        ))}
      </Card>

      <ScrollView
        horizontal
        snapToInterval={slideWidth + 10}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 10, marginTop: 18 }}
        onScroll={(e) => setSlide(Math.round(e.nativeEvent.contentOffset.x / (slideWidth + 10)))}
        scrollEventThrottle={32}
      >
        {SLIDES.map((s) => (
          <Pressable key={s.title} accessibilityRole="button" accessibilityLabel={s.title} onPress={() => router.push(s.href)} style={{ width: slideWidth, height: 150, borderRadius: 18, overflow: 'hidden' }}>
            <Image source={s.image} style={{ position: 'absolute', width: '100%', height: '100%' }} contentFit="cover" />
            <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '75%', backgroundColor: 'rgba(10,60,25,0.72)' }} />
            <View style={{ padding: 18, width: '72%', gap: 6 }}>
              <T size={20} weight="heavy" c="#fff">
                {s.title}
              </T>
              <T size={14} weight="bold" c="#fff">
                {s.body}
              </T>
              <View style={{ alignSelf: 'flex-start', marginTop: 2, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 999, backgroundColor: color.orange }}>
                <T size={14} weight="heavy">
                  {s.cta}
                </T>
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 }} {...decorative}>
        {SLIDES.map((s, i) => (
          <View key={s.title} style={{ width: i === slide ? 22 : 7, height: 7, borderRadius: 4, backgroundColor: i === slide ? color.green : '#c9d3dc' }} />
        ))}
      </View>

      {history.length > 0 && (
        <View style={{ paddingHorizontal: 16, marginTop: 18, gap: 10 }}>
          <SectionTitle title="Vừa xem trên máy này" action="Tất cả" onAction={() => router.push('/consumer/history')} />
          {history.slice(0, 2).map((item) => (
            <Pressable key={item.token} accessibilityRole="button" onPress={() => router.push(`/consumer/trace/${item.token}`)}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
                <View style={{width:54,height:54,borderRadius:10,overflow:'hidden',backgroundColor:'#fff'}}><DirectoryPhoto url={item.imageUrl??`/public/trace/${item.token}/thumbnail`} label={item.productName}/></View>
                <View style={{ flex: 1 }}>
                  <T size={16} weight="heavy" numberOfLines={1}>
                    {item.productName}
                  </T>
                  <T size={13.5} c={color.muted}>
                    Xem lúc {date(item.viewedAt)}
                  </T>
                </View>
                <Icon name="chevron" color={color.faint} />
              </Card>
            </Pressable>
          ))}
        </View>
      )}

      <View style={{ paddingHorizontal: 16, marginTop: 18, gap: 10 }}>
        <SectionTitle title="Tin tức" action="Xem tất cả" onAction={() => router.push('/consumer/news')} />
        {news.data && news.data.items.length === 0 && (
          <Card style={{ padding: 16 }}>
            <T c={color.muted}>Chưa có bài viết nào.</T>
          </Card>
        )}
        {news.error && (
          <Card style={{ padding: 16 }}>
            <T c={color.muted}>{news.error}</T>
          </Card>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
          {news.data?.items.map((item) => (
            <Pressable key={item.id} accessibilityRole="button" onPress={() => router.push(`/consumer/news/${item.id}`)} style={{ width: 220 }}>
              <Card style={{ overflow: 'hidden' }}>
                <View style={{height:120}}><NewsCover article={item}/></View>
                <View style={{ padding: 12, gap: 4 }}>
                  <T size={12.5} weight="bold" c={color.muted}>
                    {date(item.publishedAt)}
                  </T>
                  <T size={15} weight="heavy" numberOfLines={2}>
                    {item.title}
                  </T>
                  <T size={13.5} c={color.inkSoft} numberOfLines={2}>
                    {item.summary}
                  </T>
                </View>
              </Card>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </ScrollView>
  );
}
