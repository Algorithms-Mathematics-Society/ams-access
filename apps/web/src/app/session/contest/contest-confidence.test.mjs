import test from 'node:test';
import assert from 'node:assert/strict';
import { draftStatus, sameSource, submissionComparison, requestFinish } from './contest-confidence.ts';
const current = {source:'answer',language:'cpp'};
test('saved is a content and language match, not absence of an error',()=>{
 assert.equal(draftStatus({current,saving:false,failed:false,ended:false}).confirmed,false);
 assert.equal(sameSource({...current,language:'python'},current),false);
 assert.equal(draftStatus({current,confirmed:current,saving:false,failed:false,ended:false}).confirmed,true);
 assert.equal(draftStatus({current,confirmed:{...current,source:'old'},saving:false,failed:false,ended:true}).label,'Latest draft not confirmed on server');
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
