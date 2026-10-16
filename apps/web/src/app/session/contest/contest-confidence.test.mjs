import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionDraftAssurance, draftStatus, sameSource, submissionComparison, requestFinish } from './contest-confidence.ts';
const current = {source:'answer',language:'cpp'};

test('connection reassurance confirms only a successful local save, without promising upload', () => {
  const message = connectionDraftAssurance(true);
  assert.match(message, /draft is saved on this device/i);
  assert.match(message, /trying to reconnect/i);
  assert.match(message, /submit your solution.*before the contest ends/i);
  assert.doesNotMatch(message, /automatically.*(sync|upload)|synced|saved.*server/i);
});

test('connection reassurance warns when any local draft write failed', () => {
  const message = connectionDraftAssurance(false);
  assert.match(message, /could not be saved on this device/i);
  assert.match(message, /keep this app open/i);
  assert.doesNotMatch(message, /draft is saved|will be synced|will be uploaded/i);
});
// Drafts no longer go to the server, so there is no in-flight or failed state
// to describe: the write is a synchronous localStorage put on every change.
// What the label must not do is imply a server copy exists.
test('the draft label describes the device, never a server copy',()=>{
 const status = draftStatus();
 assert.equal(status.confirmed,true);
 assert.match(status.label,/device/i);
 assert.doesNotMatch(status.label,/server/i);
});
test('source comparison still distinguishes a language change',()=>{
 assert.equal(sameSource({...current,language:'python'},current),false);
 assert.equal(sameSource(current,current),true);
});
test('historical submissions with no source do not claim draft equivalence',()=>{
 assert.equal(submissionComparison(current), '');
 assert.equal(submissionComparison(current,current),'Current code matches');
 assert.match(submissionComparison({...current,source:'edit'},current),/changed/);
 assert.match(submissionComparison({...current,language:'python'},current),/changed/);
});
test('finish acknowledgement never covers a failed draft save',async()=>{
 assert.deepEqual(await requestFinish({save:async()=>false,finish:async()=>({ok:true,json:async()=>({})}),wait:async()=>{}}),{confirmed:true,draftSaved:false});
});
test('already submitted acknowledgement is distinct from contest deadline',async()=>{
 for(const code of ['SESSION_ALREADY_SUBMITTED','CONTEST_ENDED']){
  const result=await requestFinish({save:async()=>false,finish:async()=>({ok:false,json:async()=>({code})}),wait:async()=>{}});
  assert.equal(result.confirmed,code==='SESSION_ALREADY_SUBMITTED');
 }
});
test('network failures stop after four attempts; no background retry promise',async()=>{
 let saves=0,finishes=0,waits=0;
 const result=await requestFinish({save:async()=>{saves++;throw Error('offline')},finish:async()=>{finishes++;throw Error('offline')},wait:async()=>{waits++}});
 assert.deepEqual(result,{confirmed:false,draftSaved:false});
 assert.deepEqual([saves,finishes,waits],[4,4,3]);
});
test('retry can recover both draft and finish acknowledgement',async()=>{
 let n=0;
 assert.deepEqual(await requestFinish({save:async()=>n>0,finish:async()=>({ok:++n===2,json:async()=>({})}),wait:async()=>{}}),{confirmed:true,draftSaved:true});
});

test('a lost finish response cannot erase an already confirmed final draft save',async()=>{
 let n=0;
 const result=await requestFinish({save:async()=>n===0,finish:async()=>{if(n++===0)throw Error('lost response');return {ok:false,json:async()=>({code:'SESSION_ALREADY_SUBMITTED'})}},wait:async()=>{}});
 assert.deepEqual(result,{confirmed:true,draftSaved:true});
});
