export function isoToLocal(iso:string){const d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
export function localToIso(local?:string){return local?new Date(local).toISOString():undefined;}
