import { api, API_BASE_URL, type Schemas } from '../api/client';

export type DirectoryProduct = Schemas['PublicDirectoryProductDto'];
export type DirectoryEnterprise = Schemas['PublicDirectoryEnterpriseDto'];
export const directoryColor = { bg:'#f2f7fb', blue:'#4b8cc1', green:'#61b94d', red:'#c63732', ink:'#2c3439', muted:'#79858f', line:'#ecf0f3' };
// Changing the image renderer must also refresh sources already mounted in a
// long-lived preview. Evidence-specific `v` parameters come from the API.
export const directoryAsset = (path?:string|null) => path ? `${API_BASE_URL}${path}${path.includes('?')?'&':'?'}render=2` : null;
export const normalized = (text:string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
export const money = (value?:string|null) => value!=null ? `${Number(value).toLocaleString('vi-VN')} đ` : 'Liên hệ';
export async function loadDirectory<T extends {id:string}>(route:'products'|'enterprises') {
  const items:T[]=[], seen=new Set<string>();let cursor:string|null=null;
  do {
    const page: {items:T[];hasMore:boolean;nextCursor:string|null}=await api(`/public/${route}?limit=50${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`);
    for(const row of page.items)if(!seen.has(row.id)){items.push(row);seen.add(row.id);}
    if(!page.hasMore||!page.nextCursor||page.nextCursor===cursor)break;
    cursor=page.nextCursor;
  }while(items.length<1000);
  return items;
}
