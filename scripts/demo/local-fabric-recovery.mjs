import { canonicalize } from 'json-canonicalize';
import {setTimeout as delay} from 'node:timers/promises';

export async function retryLedgerRead(read,{wait=delay}={}) {
  for(let attempt=0;attempt<4;attempt++){
    try{return await read();}catch(error){
      if(![4,8,14,'DEADLINE_EXCEEDED','RESOURCE_EXHAUSTED','UNAVAILABLE'].includes(error.code)||attempt===3)throw error;
      await wait(500*2**attempt);
    }
  }
}

export async function retryVerificationHttp(request,{wait=delay}={}) {
  for(let attempt=0;attempt<5;attempt++){
    try{return await request();}catch(error){
      if(!(error instanceof TypeError&&error.message==='fetch failed')||attempt===4)throw error;
      await wait(500*2**attempt);
    }
  }
}

export async function executeSavedSignedAction(record,{replayOriginal,createSubmission}) {
  if(record?.complete)return record.result;
  if(record)return replayOriginal(record);
  return createSubmission();
}

export async function settlePartnerLink(existing,{invite,accept}) {
  const partner=existing??await invite();
  if(partner.status==='ACTIVE')return partner;
  if(partner.status!=='INVITED')throw new Error('Partner link requires reconciliation before acceptance');
  return accept(partner);
}

/** Classification only: the caller reads the real immutable journal and keeps
 * its original records. An unknown/processing/committed outcome is never rekeyed. */
export function classifyRejectedCorrection(record, candidate, journals) {
  if(canonicalize(record.body)===canonicalize(candidate))return 'UNCHANGED';
  if(![400,409,422].includes(record.lastStatus))return 'PRESERVE_ORIGINAL';
  if(journals.some(row=>row.commandCommit||row.status!=='FAILED'))return 'PRESERVE_ORIGINAL';
  if(journals.length===0)return 'REJECTED_BEFORE_EXECUTION';
  if(journals.length===1&&journals[0].responseStatus>=400&&journals[0].responseStatus<500)return 'REJECTED_JOURNAL';
  return 'PRESERVE_ORIGINAL';
}
