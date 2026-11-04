import {router,useLocalSearchParams} from 'expo-router';
import {useState} from 'react';
import {FlatList,Pressable,View} from 'react-native';
import {DirectoryHeader,DirectoryFilter} from '../../../components/DirectoryHeader';
import {DirectoryProductCard} from '../../../components/DirectoryCards';
import {Empty,Loading,Notice,T} from '../../../components/ui';
import {Icon} from '../../../components/Icon';
import {directoryColor as dc,loadDirectory,normalized,type DirectoryProduct} from '../../../lib/directory';
import {useLoad,useReloadOnFocus} from '../../../lib/useApi';

export default function Products(){
  const params=useLocalSearchParams<{q?:string}>();
  const query=params.q??'';
  const setQuery=(value:string)=>router.setParams({q:value});
  const [province,setProvince]=useState(''),[category,setCategory]=useState(''),[sort,setSort]=useState('default');
  const page=useLoad(()=>loadDirectory<DirectoryProduct>('products'),[],{key:'public:directory:products',staleTimeMs:60_000});
  useReloadOnFocus(page.reloadIfStale);
  const all=page.data??[];
  const provinces=[...new Set(all.map(p=>p.province).filter((s):s is string=>!!s))].sort();
  const categories=[...new Set(all.map(p=>p.category).filter((s):s is string=>!!s))].sort();
  const items=all.filter(p=>(!query||normalized(`${p.productName} ${p.variety??''}`).includes(normalized(query)))&&(!province||p.province===province)&&(!category||p.category===category));
  items.sort((a,b)=>sort==='newest'?Date.parse(b.createdAt)-Date.parse(a.createdAt):sort==='name'?a.productName.localeCompare(b.productName,'vi'):a.productName.localeCompare(b.productName,'vi'));
  return <View style={{flex:1,backgroundColor:dc.bg}}>
    <DirectoryHeader title="Sản phẩm" query={query} onQuery={setQuery}/>
    <View style={{backgroundColor:'#fff',flexDirection:'row',borderBottomWidth:1,borderColor:dc.line}}>
      {[{value:'default',label:'Tất cả'},{value:'newest',label:'Mới nhất'},{value:'name',label:'Tên A–Z'}].map(s=>{
        const selected=sort===s.value;
        return <Pressable key={s.value} accessibilityRole="tab" accessibilityState={{selected}} accessibilityLabel={s.label} onPress={()=>setSort(s.value)} style={{flex:1,height:44,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:4,borderBottomWidth:2,borderColor:selected?dc.blue:'transparent'}}><T size={13} c={selected?dc.blue:'#69757e'} weight={selected?'bold':'regular'}>{s.label}</T></Pressable>;
      })}
    </View>
    <View style={{backgroundColor:'#fff',flexDirection:'row',borderBottomWidth:1,borderColor:dc.line}}>
      <DirectoryFilter label="Vùng sản xuất" icon="location" value={province} onChange={setProvince} options={[{value:'',label:'Tất cả vùng sản xuất'},...provinces.map(p=>({value:p,label:p}))]}/>
      <DirectoryFilter label="Danh mục" icon="journal" value={category} onChange={setCategory} options={[{value:'',label:'Tất cả danh mục'},...categories.map(c=>({value:c,label:c}))]}/>
      {(!!province||!!category||!!query)&&<Pressable accessibilityRole="button" accessibilityLabel="Xóa bộ lọc" onPress={()=>{setProvince('');setCategory('');setQuery('');}} style={{width:40,alignItems:'center',justifyContent:'center'}}><Icon name="close" size={17} color={dc.muted}/></Pressable>}
    </View>
    {page.loading&&!page.data?<Loading/>:page.error?<View style={{padding:16}}><Notice kind="error" title={page.error}/><Pressable onPress={()=>void page.reload()}><T c={dc.blue}>Thử lại</T></Pressable></View>:<FlatList
      data={items} numColumns={2} keyExtractor={p=>p.id} columnWrapperStyle={{gap:10}} contentContainerStyle={{paddingHorizontal:12,paddingTop:12,paddingBottom:26,gap:10}}
      ListHeaderComponent={<T size={11.5} c="#8b98a2" style={{marginBottom:1}}>{items.length} sản phẩm{query?` cho “${query}”`:''}</T>}
      renderItem={({item,index})=><View style={{flex:1,maxWidth:'50%',marginRight:index===items.length-1&&items.length%2===1?'51%':0}}><DirectoryProductCard product={item}/></View>}
      ListEmptyComponent={<Empty title="Không tìm thấy sản phẩm" body="Thử tên khác hoặc xóa bộ lọc."/>}
      refreshing={page.loading} onRefresh={()=>void page.reload()}
    />}
  </View>;
}
