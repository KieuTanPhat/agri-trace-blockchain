import {router,useLocalSearchParams} from 'expo-router';
import {useEffect,useState} from 'react';
import {FlatList,Pressable,View} from 'react-native';
import {DirectoryHeader,DirectoryFilter} from '../../../components/DirectoryHeader';
import {DirectoryEnterpriseCard} from '../../../components/DirectoryCards';
import {Empty,Loading,Notice,T} from '../../../components/ui';
import {loadDirectory,normalized,directoryColor as dc,type DirectoryEnterprise} from '../../../lib/directory';
import {useLoad,useReloadOnFocus} from '../../../lib/useApi';
import {ORG_TYPE} from '../../../lib/labels';

export default function Enterprises(){
  const params=useLocalSearchParams<{q?:string}>();
  const [query,setQuery]=useState(params.q??''),[type,setType]=useState(''),[province,setProvince]=useState('');
  useEffect(()=>{setQuery(params.q??'');},[params.q]);
  const changeQuery=(value:string)=>{setQuery(value);router.setParams({q:value});};
  const clearFilters=()=>{changeQuery('');setType('');setProvince('');};
  const page=useLoad(()=>loadDirectory<DirectoryEnterprise>('enterprises'));
  useReloadOnFocus(page.reload);
  const all=page.data??[],provinces=[...new Set(all.map(e=>e.province).filter((s):s is string=>!!s))].sort(),types=[...new Set(all.map(e=>e.type))];
  const items=all.filter(e=>(!query||normalized(e.name).includes(normalized(query)))&&(!type||e.type===type)&&(!province||e.province===province)).sort((a,b)=>a.name.localeCompare(b.name,'vi'));
  return <View style={{flex:1,backgroundColor:dc.bg}}>
    <DirectoryHeader title="Doanh nghiệp" query={query} onQuery={changeQuery}/>
    <View style={{backgroundColor:'#fff',flexDirection:'row',borderBottomWidth:1,borderColor:dc.line}}>
      <DirectoryFilter label="Tỉnh / thành" icon="location" value={province} onChange={setProvince} options={[{value:'',label:'Tất cả tỉnh / thành'},...provinces.map(p=>({value:p,label:p}))]}/>
      <DirectoryFilter label="Loại hình" icon="building" value={type} onChange={setType} options={[{value:'',label:'Tất cả loại hình'},...types.map(t=>({value:t,label:ORG_TYPE[t]?.label??t}))]}/>
    </View>
    {page.loading&&!page.data?<Loading/>:page.error?<View style={{padding:16}}><Notice kind="error" title={page.error}/><Pressable onPress={()=>void page.reload()}><T c={dc.blue}>Thử lại</T></Pressable></View>:<FlatList
      data={items} keyExtractor={e=>e.id} contentContainerStyle={{padding:12,gap:10,paddingBottom:28}} refreshing={page.loading} onRefresh={()=>void page.reload()}
      ListHeaderComponent={<View style={{gap:8}}><T size={11.5} c="#8b98a2">{items.length} doanh nghiệp trong chuỗi truy xuất{query?` cho “${query}”`:''}</T>{(query||type||province)?<Pressable accessibilityRole="button" accessibilityLabel="Xóa bộ lọc" onPress={clearFilters} style={{alignSelf:'flex-start',paddingVertical:7,paddingHorizontal:10,borderRadius:8,backgroundColor:'#e7f1eb'}}><T size={13} c="#367c50">Xóa bộ lọc · Xem tất cả</T></Pressable>:null}</View>}
      renderItem={({item})=><DirectoryEnterpriseCard enterprise={item}/>}
      ListEmptyComponent={<Empty title="Không tìm thấy doanh nghiệp" body="Thử tên khác hoặc đổi bộ lọc." icon="building"/>}
    />}
  </View>;
}
