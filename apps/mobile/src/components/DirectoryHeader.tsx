import { useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { Icon, type IconName } from './Icon';
import { T } from './ui';
import { directoryColor as dc } from '../lib/directory';
import { font, noOutline } from '../theme/tokens';

export function DirectoryHeader({title,query,onQuery}:{title:string;query:string;onQuery:(value:string)=>void}) {
  const insets=useSafeAreaInsets(),[search,setSearch]=useState(false);
  const searchVisible=search||!!query;
  return <View style={{paddingTop:insets.top+16,paddingBottom:16,paddingHorizontal:18,gap:14,backgroundColor:dc.green}}>
    <Svg style={{position:'absolute',inset:0}} width="100%" height="100%"><Defs><LinearGradient id="directory-header" x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor="#69bd46"/><Stop offset="0.54" stopColor="#5ca58b"/><Stop offset="1" stopColor="#4b88ba"/></LinearGradient></Defs><Rect width="100%" height="100%" fill="url(#directory-header)"/></Svg>
    <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',minHeight:36}}>
      <T size={23} weight="bold" c="#fff">{title}</T>
      <View style={{flexDirection:'row',gap:10,alignItems:'center'}}>
        <Pressable accessibilityRole="button" accessibilityLabel={searchVisible?'Đóng tìm kiếm':'Tìm kiếm'} onPress={()=>{if(searchVisible){setSearch(false);onQuery('');}else setSearch(true);}} hitSlop={10} style={{width:36,height:36,alignItems:'center',justifyContent:'center',backgroundColor:'rgba(255,255,255,.14)',borderRadius:9}}><Icon name={searchVisible?'close':'search'} size={21} color="#fff"/></Pressable>
      </View>
    </View>
    {searchVisible&&<View style={{height:44,paddingHorizontal:12,flexDirection:'row',alignItems:'center',gap:9,backgroundColor:'#fff',borderRadius:10}}><Icon name="search" size={18} color={dc.muted}/><TextInput autoFocus accessibilityLabel={`Tìm ${title.toLowerCase()}`} value={query} onChangeText={onQuery} placeholder="Nhập tên để tìm kiếm" placeholderTextColor={dc.muted} style={[{flex:1,fontFamily:font.regular,fontSize:15,color:dc.ink},noOutline]}/>{!!query&&<Pressable accessibilityRole="button" accessibilityLabel="Xóa tìm kiếm" onPress={()=>onQuery('')}><Icon name="close" size={18} color={dc.muted}/></Pressable>}</View>}
  </View>;
}

export function DirectoryFilter({label,icon,value,onChange,options}:{label:string;icon:IconName;value:string;onChange:(value:string)=>void;options:{value:string;label:string}[]}) {
  const [open,setOpen]=useState(false),selected=options.find(o=>o.value===value);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${selected?.label??'Tất cả'}`} onPress={()=>setOpen(true)} style={{flex:1,minHeight:43,paddingHorizontal:10,flexDirection:'row',alignItems:'center',gap:6,borderRightWidth:1,borderColor:dc.line}}>
      <Icon name={icon} size={16} color={value?dc.blue:'#8494a6'}/><T size={13} c={value?dc.blue:'#59636d'} numberOfLines={1} style={{flex:1}}>{value?selected?.label:label}</T><Icon name="down" size={13} color="#8d99a5"/>
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={()=>setOpen(false)}>
      <View style={{flex:1,justifyContent:'flex-end',backgroundColor:'rgba(12,28,39,.35)'}}>
        <Pressable accessibilityRole="button" accessibilityLabel="Đóng bộ lọc" style={{position:'absolute',inset:0}} onPress={()=>setOpen(false)}/>
        <View style={{backgroundColor:'#fff',borderTopLeftRadius:22,borderTopRightRadius:22,paddingTop:20,paddingBottom:28,maxHeight:'75%',width:'100%',maxWidth:720,alignSelf:'center'}}>
          <View style={{paddingHorizontal:22,paddingBottom:16,flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}><T size={20} weight="bold">{label}</T><Pressable accessibilityRole="button" accessibilityLabel="Đóng bộ lọc" onPress={()=>setOpen(false)}><Icon name="close" size={23} color={dc.muted}/></Pressable></View>
          <ScrollView>{options.map(o=><Pressable key={o.value} accessibilityRole="radio" accessibilityState={{checked:o.value===value}} onPress={()=>{onChange(o.value);setOpen(false);}} style={{minHeight:50,paddingVertical:12,paddingHorizontal:22,borderTopWidth:1,borderColor:dc.line,flexDirection:'row',justifyContent:'space-between',backgroundColor:o.value===value?'#f1f8f3':'#fff'}}><T size={16} c={o.value===value?'#2d8854':dc.ink}>{o.label}</T>{o.value===value&&<Icon name="check" size={20} color="#2d8854"/>}</Pressable>)}</ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}
