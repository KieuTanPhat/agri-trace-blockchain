type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const text = (value: unknown, max = 2000) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
export function publication(value: unknown) {
  return object(object(value).publicDirectory);
}

/** An explicit public snapshot; never fall back to the private legal/contact profile. */
export function publicContact(registrationData: unknown) {
  const snapshot = publication(registrationData);
  const published = snapshot.published === true;
  const get = (key: string, max?: number) => published ? text(snapshot[key], max) : null;
  const rawWebsite=get('website',255);
  let website: string | null=null;
  try {const url=new URL(rawWebsite??'');if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password)website=url.href;}catch{ /* unpublished/invalid website */ }
  const logo=get('logoEvidenceId',36);
  return { published,phone:get('phone',30),address:get('address',500),province:get('province',100),ward:get('ward',100),website,introduction:get('introduction'),
    logoEvidenceId:logo&&/^[0-9a-f-]{36}$/i.test(logo)?logo:null };
}

/** Catalog detail publication is independently opted in by the organization. */
export function publicProductDetails(product: Record<string,unknown>,registrationData: unknown) {
  const p=publication(registrationData);
  const enabled=p.published===true&&p.catalogDetailsPublished===true;
  const get=(key:string,max?:number)=>enabled?text(product[key],max):null;
  return {price:enabled&&product.price!=null?String(product.price):null,category:get('category',100),gtin:get('gtin',14),
    storageConditions:get('storageConditions'),ingredients:get('ingredients'),usageInstructions:get('usageInstructions'),
    province:publicContact(registrationData).province};
}
export interface DirectoryImage {id:string;supersedesId:string|null;public:boolean;kind:string;mediaType:string;withdrawal?:unknown}
export function visibleDirectoryImage<T extends DirectoryImage>(rows:T[]) {
  const superseded=new Set(rows.map(r=>r.supersedesId).filter(Boolean));
  return rows.find(r=>r.public&&!r.withdrawal&&r.kind==='LOT_IMAGE'&&['image/jpeg','image/png'].includes(r.mediaType)&&!superseded.has(r.id))??null;
}
