import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRejectedCorrection as classify, executeSavedSignedAction, settlePartnerLink, retryLedgerRead, retryVerificationHttp } from './local-fabric-recovery.mjs';
const original={body:{version:1},lastStatus:422};
test('a definite validation rejection with no DB record can correct its first request',()=>assert.equal(classify(original,{version:2},[]),'REJECTED_BEFORE_EXECUTION'));
test('a proven rejected journal allows a separately recorded corrected command',()=>assert.equal(classify(original,{version:2},[{status:'FAILED',responseStatus:422,commandCommit:null}]),'REJECTED_JOURNAL'));
for(const status of ['PROCESSING','COMPLETED'])test(`${status} cannot be rekeyed`,()=>assert.equal(classify(original,{version:2},[{status,responseStatus:null,commandCommit:null}]),'PRESERVE_ORIGINAL'));
test('a positive commit always wins over a stale failed response',()=>assert.equal(classify(original,{version:2},[{status:'FAILED',responseStatus:422,commandCommit:{id:'committed'}}]),'PRESERVE_ORIGINAL'));
test('a lost response cannot be treated as rejection even when lookup is empty',()=>assert.equal(classify({body:{version:1},lastStatus:undefined},{version:2},[]),'PRESERVE_ORIGINAL'));
test('a server failure cannot silently change the original request',()=>assert.equal(classify({...original,lastStatus:500},{version:2},[]),'PRESERVE_ORIGINAL'));
test('unchanged rejected bodies do not automatically retry under a fresh key',()=>assert.equal(classify(original,{version:1},[{status:'FAILED',responseStatus:422}]),'UNCHANGED'));

test('a saved unknown signed submission replays its original signature after preparation expired',async()=>{
  const saved={key:'original-key',actorKey:'giver',route:'/signing-intents/original/submit',body:{signature:'original-signature'},lastOutcome:'NETWORK_UNKNOWN'};
  const result=await executeSavedSignedAction(saved,{replayOriginal:async record=>{assert.equal(record,saved);return{replayed:true};},
    createSubmission:async()=>{throw new Error('Signing intent expired; signing must not run during recovery');}});
  assert.deepEqual(result,{replayed:true});
});
test('a completed signed submission returns its stored response without preparing again',async()=>{
  assert.deepEqual(await executeSavedSignedAction({complete:true,result:{id:'original'}},{replayOriginal:()=>assert.fail('Must not send'),createSubmission:()=>assert.fail('Must not sign')}),{id:'original'});
});
test('a persisted invitation is accepted after interruption before the original acceptance',async()=>{
  const invitation={id:'persisted-invitation',status:'INVITED',version:0};
  const result=await settlePartnerLink(invitation,{invite:()=>assert.fail('Do not invite twice'),accept:async row=>{assert.equal(row,invitation);return{...row,status:'ACTIVE'};}});
  assert.equal(result.status,'ACTIVE');
});
test('a transient deadline can retry an idempotent ledger read',async()=>{
  let attempts=0;
  const proof=await retryLedgerRead(async()=>{if(++attempts===1)throw Object.assign(new Error('DEADLINE_EXCEEDED'),{code:4});return{validation:0};},{wait:async()=>{}});
  assert.deepEqual(proof,{validation:0});assert.equal(attempts,2);
});
test('an integrity assertion is never classified as a retryable transport failure',async()=>{
  let attempts=0;const error=Object.assign(new Error('Proof hash mismatch'),{code:'ERR_ASSERTION'});
  await assert.rejects(retryLedgerRead(async()=>{attempts++;throw error;},{wait:async()=>{}}),e=>e===error);assert.equal(attempts,1);
});
test('verification can retry a broken keepalive connection using the identical request',async()=>{
  let attempts=0;const body='original-request';
  const response=await retryVerificationHttp(async()=>{assert.equal(body,'original-request');if(++attempts===1)throw new TypeError('fetch failed',{cause:{code:'UND_ERR_SOCKET'}});return{status:201};},{wait:async()=>{}});
  assert.equal(response.status,201);assert.equal(attempts,2);
});
