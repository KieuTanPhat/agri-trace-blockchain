import {Image} from 'expo-image';
import {useState} from 'react';
import {router} from 'expo-router';
import {ActivityIndicator,Pressable,View} from 'react-native';
import {Icon} from './Icon';
import {T} from './ui';
import {directoryAsset,directoryColor as dc,money,type DirectoryProduct,type DirectoryEnterprise} from '../lib/directory';
import {ORG_TYPE} from '../lib/labels';

export function DirectoryPhoto({url,label,fit='contain'}:{url?:string|null;label:string;fit?:'contain'|'cover'}) {
  const uri=directoryAsset(url);
  return uri?<RemoteDirectoryPhoto key={uri} uri={uri} label={label} fit={fit}/>:<View style={{flex:1,alignItems:'center',justifyContent:'center',gap:8}}><Icon name="image" color="#b4c1c9" size={35}/><T size={12} c={dc.muted}>Chưa có ảnh công khai</T></View>;
}
function RemoteDirectoryPhoto({uri,label,fit}:{uri:string;label:string;fit:'contain'|'cover'}){
  const [attempt,setAttempt]=useState(0),[failed,setFailed]=useState(false),[loading,setLoading]=useState(true);
  const source=attempt?`${uri}${uri.includes('?')?'&':'?'}retry=${attempt}`:uri;
  if(failed)return <Pressable accessibilityRole="button" accessibilityLabel={`Tải lại ảnh ${label}`} onPress={event=>{event.stopPropagation();setFailed(false);setLoading(true);setAttempt(value=>value+1);}} style={{width:'100%',height:'100%',alignItems:'center',justifyContent:'center',gap:3,backgroundColor:'#f1f5f3'}}><Icon name="image" color="#7f9589" size={19}/><T size={11} c="#568067">Tải lại</T></Pressable>;
  return <View style={{width:'100%',height:'100%'}}>
    <Image key={source} source={{uri:source}} cachePolicy="none" recyclingKey={source} transition={0} accessibilityLabel={label} style={{width:'100%',height:'100%'}} contentFit={fit} onLoad={()=>setLoading(false)} onError={()=>{if(attempt===0)setAttempt(1);else{setLoading(false);setFailed(true);}}}/>
    {loading&&<View pointerEvents="none" style={{position:'absolute',inset:0,alignItems:'center',justifyContent:'center',backgroundColor:'#f5f8f6'}}><ActivityIndicator size="small" color="#6a9a7a" accessibilityLabel={`Đang tải ảnh ${label}`}/></View>}
  </View>;
}
export function DirectoryProductCard({product,compact=false}:{product:DirectoryProduct;compact?:boolean}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Xem ${product.productName}`} onPress={()=>router.push(`/consumer/product/${product.id}`)} style={{flex:1,backgroundColor:'#fff',borderRadius:15,overflow:'hidden',borderWidth:1,borderColor:'#edf2f5'}}>
    <View style={{aspectRatio:compact?1.2:1.04,maxHeight:245,padding:compact?8:11,backgroundColor:'#fff'}}><DirectoryPhoto url={product.imageUrl} label={product.productName}/></View>
    <View style={{paddingHorizontal:12,paddingTop:7,paddingBottom:14,gap:5}}>
      <T size={compact?14:16} c={dc.ink} numberOfLines={2} style={{minHeight:compact?39:44}}>{product.productName}</T>
      <T size={compact?14:16} weight="bold" c={dc.red}>{money(product.price)}{product.price&&<T size={12} c="#8c969d"> / {product.defaultUnit??'đơn vị'}</T>}</T>
      <T size={12} weight="bold" c={product.saleStatus==='SELLING'?'#38894c':'#8c969d'}>{product.saleStatus==='SELLING'?'Đang bán':'Chưa bán'}</T>
      {!compact&&<T size={11.5} c={dc.muted} numberOfLines={1}>{product.province??product.category??'Nông sản có truy xuất'}</T>}
    </View>
  </Pressable>;
}

export function DirectoryEnterpriseCard({enterprise}:{enterprise:DirectoryEnterprise}) {
  const kind=ORG_TYPE[enterprise.type];
  return <Pressable accessibilityRole="button" accessibilityLabel={`Xem ${enterprise.name}`} onPress={()=>router.push(`/consumer/enterprise/${enterprise.id}`)} style={{backgroundColor:'#fff',borderRadius:15,paddingVertical:16,paddingHorizontal:13,flexDirection:'row',alignItems:'center',gap:13,borderWidth:1,borderColor:'#edf2f5'}}>
    <View style={{width:64,height:64,borderRadius:9,overflow:'hidden',backgroundColor:'#fff'}}><DirectoryPhoto url={enterprise.logoUrl} label={`Logo ${enterprise.name}`}/></View>
    <View style={{flex:1,gap:7}}>
      <T size={15} c={dc.ink} numberOfLines={2}>{enterprise.name}</T>
      <View style={{flexDirection:'row',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        {enterprise.phone&&<View style={{flexDirection:'row',alignItems:'center',gap:5}}><Icon name="phone" size={14} color="#929ca4"/><T size={12.5} c="#68747e">{enterprise.phone}</T></View>}
        {enterprise.province&&<View style={{flexDirection:'row',alignItems:'center',gap:4,flexShrink:1}}><Icon name="location" size={15} color="#929ca4"/><T size={12.5} c="#68747e" numberOfLines={1}>{enterprise.province}</T></View>}
      </View>
      <T size={11.5} c="#59846a">{kind?.label??enterprise.type}</T>
    </View>
    <Icon name="chevron" size={18} color="#96a2ac"/>
  </Pressable>;
}
