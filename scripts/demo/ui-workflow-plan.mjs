import { createHash } from 'node:crypto';

export const UI_WORKFLOW_NAMESPACE = 'agritrace:ui-workflow:100:v1';
export function workflowId(kind, index) {
  const hex = createHash('sha256').update(`${UI_WORKFLOW_NAMESPACE}:${kind}:${index}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
export function workflowPlan() {
  const groups = [['FARM',12,'HTX sản xuất'],['PROCESSOR',6,'Chế biến'],['TRANSPORTER',4,'Vận chuyển'],['DISTRIBUTOR',4,'Phân phối'],['RETAILER',4,'Bán lẻ']];
  const organizations = groups.flatMap(([type,count,name])=>Array.from({length:count},(_,i)=>({
    id:workflowId(type,i),key:`${type.toLowerCase()}${String(i+1).padStart(2,'0')}`,type,
    name:`[DEMO-100] ${name} ${String(i+1).padStart(2,'0')}`,
  })));
  const names = ['Rau cải','Xà lách','Cà chua','Dưa leo','Bí đỏ','Cà rốt','Khoai lang','Bắp','Lúa','Xoài','Chuối','Thanh long','Bưởi','Cà phê','Xoài sấy','Chuối sấy','Cà phê rang','Gạo đóng gói','Nước ép trái cây','Rau củ đông lạnh'];
  const farms=organizations.filter(o=>o.type==='FARM'),processors=organizations.filter(o=>o.type==='PROCESSOR');
  const products=names.flatMap((name,group)=>Array.from({length:5},(_,variant)=>{
    const index=group*5+variant,processed=group>=14;
    return {key:`product${String(index+1).padStart(3,'0')}`,name:`[DEMO-100] ${name} ${String(variant+1).padStart(2,'0')}`,
      owner:(processed?processors[(index-70)%6]:farms[index%12]).key,processed,
      sku:`DEMO100-${String(index+1).padStart(3,'0')}`,price:20000+group*5000,
      processType:group===16?'OTHER':group===17?'MILLING':group===18?'JUICE_EXTRACT':group===19?'FREEZING':'DRYING'};
  }));
  return {organizations,products};
}
export function assertWorkflowTarget(env) {
  let url,api;
  try {url=new URL(env.DATABASE_URL);api=new URL(env.AGRI_UI_WORKFLOW_API);} catch {throw Error('Invalid local workflow target');}
  const database=decodeURIComponent(url.pathname.slice(1));
  const local=['localhost','127.0.0.1'];
  const rehearsal=env.AGRI_UI_WORKFLOW_REHEARSAL==='1';
  if(env.NODE_ENV==='production'||!['postgres:','postgresql:'].includes(url.protocol)||
    !local.includes(url.hostname)||(url.port||'5432')!=='5432'||url.searchParams.has('host')||
    !local.includes(api.hostname)||api.protocol!=='http:'||api.pathname!=='/api'||api.username||api.password||api.search||api.hash||
    env.AGRI_UI_WORKFLOW_CONFIRM!==database||
    (rehearsal?!/^agritrace_ui_workflow_rehearsal_test_\d+$/.test(database):database!=='agri_trace_ui_test'))
    throw Error('Refusing unconfirmed, non-local or production workflow target');
  return {database,apiBase:api.href.replace(/\/$/,''),rehearsal};
}
