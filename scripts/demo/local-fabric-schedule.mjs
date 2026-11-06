import assert from 'node:assert/strict';

/** Allocate complete lifecycles to older periods and unharvested work to the
 * newest periods. Actual receipt/ledger timestamps always remain real time. */
export function createCycleSchedule(anchor, allocations) {
  const plans=allocations.flatMap(a=>Object.entries(a.states).flatMap(([state,count])=>
    Array.from({length:count},()=>({chain:a.key,owner:a.owner,state}))));
  const indexes=new Map();
  for(const plan of plans){const n=indexes.get(plan.chain)??0;plan.index=n;indexes.set(plan.chain,n+1);}
  const slots=Array.from({length:12},(_,month)=>Array(month<8?8:9).fill(month)).flat();
  assert.equal(slots.length,100);assert.equal(plans.length,100);
  const boundary=offset=>{
    const month=anchor.getUTCMonth()-12+offset;
    const last=new Date(Date.UTC(anchor.getUTCFullYear(),month+1,0)).getUTCDate();
    return new Date(Date.UTC(anchor.getUTCFullYear(),month,Math.min(anchor.getUTCDate(),last),anchor.getUTCHours(),0,0));
  };
  let cursor=0;const result={};
  for(const state of ['COMPLETED','GROWING','CANCELLED','PLANTED','CREATED']) {
    const groups=['O01','O08','O16'].map(owner=>plans.filter(p=>p.owner===owner&&p.state===state));
    while(groups.some(g=>g.length))for(const group of groups)if(group.length) {
      const plan=group.shift(),month=slots[cursor++],start=boundary(month),end=boundary(month+1);
      const plantedAt=new Date(start.getTime()+(end.getTime()-start.getTime())*(0.25+(plan.index%5)*0.09));
      result[`${plan.chain}:${plan.index}`]={businessMonth:month,plantedAt:plantedAt.toISOString(),state};
    }
  }
  assert.equal(Object.keys(result).length,100);
  return result;
}
