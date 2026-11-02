import {router,useLocalSearchParams} from 'expo-router';
import {useState,type ReactNode} from 'react';
import {Pressable,ScrollView,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import {api,type Schemas} from '../../../api/client';
import {DirectoryPhoto,DirectoryEnterpriseCard,DirectoryProductCard} from '../../../components/DirectoryCards';
import {Icon} from '../../../components/Icon';
import {Empty,GreenHeader,Loading,Notice,T} from '../../../components/ui';
import {directoryColor as dc,money,loadDirectory,type DirectoryProduct} from '../../../lib/directory';
import {date} from '../../../lib/format';
import {useLoad,useReloadOnFocus} from '../../../lib/useApi';
import {LOT_STATE} from '../../../lib/labels';

function DetailSection({title,children}:{title:string;children:ReactNode}) {
  return <View style={{backgroundColor:'#fff',borderRadius:15,padding:17,gap:13}}><T size={17} weight="bold" c={dc.ink}>{title}</T><View style={{height:1,backgroundColor:dc.line}}/>{children}</View>;
}
const traceOrigin=(process.env.EXPO_PUBLIC_TRACE_ORIGIN??'http://localhost:3000').replace(/\/trace\/?$/,'');
export default function Product(){
  const {id}=useLocalSearchParams<{id:string}>();
  return <ProductDetail key={id} id={id}/>;
}
function ProductDetail({id}:{id:string}){
  const insets=useSafeAreaInsets();
  const [expanded,setExpanded]=useState(false),[moreLots,setMoreLots]=useState<Schemas['PublicTraceLinkDto'][]>([]),[loadingMore,setLoadingMore]=useState(false),[nextCursor,setNextCursor]=useState<string|null|undefined>(undefined);
  const {data,error,loading,reload}=useLoad(()=>api<Schemas['PublicProductDetailDto']>(`/public/products/${encodeURIComponent(id??'')}?limit=20`),[id]);
  useReloadOnFocus(reload);
  const related=useLoad(()=>loadDirectory<DirectoryProduct>('products'));
  if(!data||data.id!==id)return <View style={{flex:1,backgroundColor:dc.bg}}><GreenHeader title="Sản phẩm" back/>{loading?<Loading/>:<View style={{padding:16}}><Notice kind="error" title={error??'Không tìm thấy sản phẩm'}/></View>}</View>;
  const lots=[...data.lots.items,...moreLots],firstLot=data.lots.items[0],recommendations=(related.data??[]).filter(p=>p.id!==id&&p.category===data.category).slice(0,6);
  const cursor=nextCursor===undefined?data.lots.nextCursor:nextCursor;
  return <ScrollView key={id} style={{flex:1,backgroundColor:dc.bg}} contentContainerStyle={{paddingBottom:insets.bottom+28}}>
    <View style={{backgroundColor:'#fff',height:330+insets.top,paddingTop:insets.top+12,paddingBottom:15,paddingHorizontal:27}}>
      <DirectoryPhoto url={data.imageUrl} label={data.productName}/>
      <Pressable accessibilityRole="button" accessibilityLabel="Quay lại" onPress={()=>router.canGoBack()?router.back():router.replace('/consumer/products')} style={{position:'absolute',left:14,top:insets.top+17,width:39,height:39,borderRadius:22,alignItems:'center',justifyContent:'center',backgroundColor:'rgba(44,56,62,.4)'}}><Icon name="back" size={23} color="#fff"/></Pressable>
    </View>
    <View style={{backgroundColor:'#72a872',paddingHorizontal:15,paddingVertical:10,flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}><T size={13.5} c="#fff">Có mã truy xuất nguồn gốc</T><Icon name="scan" size={20} color="#fff"/></View>
    <View style={{backgroundColor:'#fff',padding:17,gap:11}}>
      <T size={21} weight="bold" c={dc.ink}>{data.productName}</T>
      <T size={14} weight="bold" c={data.saleStatus==='SELLING'?'#38894c':'#8c969d'}>{data.saleStatus==='SELLING'?'Đang bán':'Chưa bán'}</T>
      {data.category&&<T size={14} c="#66717a">Danh mục: <T size={14} c={dc.blue}>{data.category}</T></T>}
      <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'baseline',gap:10}}><T size={24} weight="bold" c={dc.red}>{money(data.price)}{data.price&&<T size={14} c="#8a959d"> / {data.defaultUnit??'đơn vị'}</T>}</T><T size={12.5} c="#7b858c">{data.traceCount} lô truy xuất</T></View>
      <T size={11.5} c="#8a959d">Giá tham khảo theo đơn vị sản phẩm</T>
      <View style={{flexDirection:'row',alignItems:'center',gap:6,paddingTop:7,borderTopWidth:1,borderColor:dc.line}}><Icon name="location" size={15} color={dc.blue}/><T size={13} c="#71808b">{data.province??'Nguồn gốc theo từng lô hàng'}</T></View>
    </View>
    {firstLot&&<View style={{flexDirection:'row',backgroundColor:'#fff',marginTop:1,padding:17,gap:16,alignItems:'center'}}>
      <Pressable accessibilityRole="button" accessibilityLabel="Xem mã QR và hành trình lô đầu tiên" onPress={()=>router.push(`/consumer/trace/${firstLot.traceToken}`)} style={{width:82,height:82,padding:6,borderWidth:1,borderColor:'#e9eef1',borderRadius:5,backgroundColor:'#fff'}}><QRCode value={`${traceOrigin}/trace/${firstLot.traceToken}`} size={68}/></Pressable>
      <View style={{flex:1,gap:4}}><T size={12.5} c="#7e8992">Số lượt quét QR</T><T size={21} weight="bold" c={dc.blue}>{data.scanCount}<T size={13} c="#94a2ad"> lượt</T></T><T size={11} c="#98a2aa">Mã QR của lô {firstLot.lotCode}</T></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Truy xuất lô hàng" onPress={()=>router.push(`/consumer/trace/${firstLot.traceToken}`)} style={{alignItems:'center',gap:4}}><Icon name="scan" size={25} color={dc.blue}/><T size={11} c={dc.blue}>Truy xuất</T></Pressable>
    </View>}
    <View style={{padding:13,gap:13}}>
      {!!recommendations.length&&<View style={{gap:12,paddingVertical:4}}><T size={16} weight="bold">Sản phẩm cùng danh mục</T><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:10}}>{recommendations.map(p=><View key={p.id} style={{width:145}}><DirectoryProductCard product={p} compact/></View>)}</ScrollView></View>}
      {!!data.enterprises.items.length&&<View style={{gap:10}}><T size={16} weight="bold">Doanh nghiệp trong hành trình</T>{data.enterprises.items.map(e=><DirectoryEnterpriseCard key={e.id} enterprise={e}/>)}</View>}
      <DetailSection title="Giới thiệu chi tiết">
        <View style={{gap:13}}>
          {data.description&&<T size={15} c="#626e76" numberOfLines={expanded?undefined:3}>{data.description}</T>}
          {!!data.variety&&<T size={14.5} c="#626e76"><T size={14.5} weight="bold">Giống: </T>{data.variety}</T>}
          {data.ingredients&&<T size={14.5} c="#626e76"><T size={14.5} weight="bold">Thành phần: </T>{data.ingredients}</T>}
          {expanded&&data.usageInstructions&&<T size={14.5} c="#626e76"><T size={14.5} weight="bold">Hướng dẫn sử dụng: </T>{data.usageInstructions}</T>}
          {expanded&&data.storageConditions&&<T size={14.5} c="#626e76"><T size={14.5} weight="bold">Bảo quản: </T>{data.storageConditions}</T>}
          {expanded&&data.gtin&&<T size={14.5} c="#626e76"><T size={14.5} weight="bold">GTIN: </T>{data.gtin}</T>}
        </View>
        <Pressable accessibilityRole="button" accessibilityState={{expanded}} onPress={()=>setExpanded(!expanded)} style={{paddingTop:12,borderTopWidth:1,borderColor:dc.line,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6}}><T size={13.5} c="#707e88">{expanded?'Thu gọn':'Xem thêm'}</T><Icon name="down" size={13} color="#8496a6"/></Pressable>
      </DetailSection>
      <DetailSection title="Truy xuất nguồn gốc">
        <T size={13} c="#7e8b95">Chọn lô trên tem hàng để xem vụ sản xuất, thu hoạch và hành trình giao nhận.</T>
        {!lots.length?<Empty title="Chưa có lô công khai"/>:lots.map(l=>{
          const warning=l.state==='RECALLED'||!!l.expiryDate&&l.expiryDate<new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'});
          return <Pressable key={l.id} accessibilityRole="button" accessibilityLabel={`Truy xuất lô ${l.lotCode}`} onPress={()=>router.push(`/consumer/trace/${l.traceToken}`)} style={{borderWidth:1,borderColor:warning?'#f2d2ca':'#e6eef0',borderRadius:11,padding:12,flexDirection:'row',gap:10,alignItems:'center',backgroundColor:warning?'#fff8f4':'#f8fbfa'}}><Icon name={warning?'alert':'scan'} size={24} color={warning?'#c56e42':'#4d9c72'}/><View style={{flex:1,gap:4}}><T size={13.5} weight="bold" numberOfLines={1}>{l.lotCode}</T><T size={12} c="#7e8a93">{LOT_STATE[l.state]?.label??l.state}{l.expiryDate?` · HSD ${date(l.expiryDate)}`:''}</T></View><Icon name="chevron" size={17} color="#8ea8a2"/></Pressable>;
        })}
        {cursor&&<Pressable accessibilityRole="button" disabled={loadingMore} onPress={async()=>{setLoadingMore(true);try{const next=await api<Schemas['PublicProductDetailDto']>(`/public/products/${id}?limit=20&lotCursor=${cursor}`);setMoreLots(old=>[...old,...next.lots.items]);setNextCursor(next.lots.nextCursor);}finally{setLoadingMore(false);}}}><T c={dc.blue}>{loadingMore?'Đang tải…':'Xem thêm lô'}</T></Pressable>}
      </DetailSection>
    </View>
  </ScrollView>;
}
