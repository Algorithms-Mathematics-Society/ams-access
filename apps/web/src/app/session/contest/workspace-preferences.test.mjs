import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedPercent,parseQuestionMarks} from './workspace-preferences.ts';
import {isPublicSample,outputText} from './execution-output.ts';
test('corrupt/unknown local preferences fall back safely and sizes clamp',()=>{
 for(const v of [null,'', 'bad',{}, Infinity])assert.equal(boundedPercent(v,34,18,55),34);
 assert.equal(boundedPercent('100',34,18,55),55);assert.equal(boundedPercent(-1,34,18,55),18);
 assert.equal(boundedPercent('25',34,18,55),25);
});
test('personal marks validate storage, deduplicate and preserve problem labels',()=>{
 assert.deepEqual(parseQuestionMarks('{bad'),[]);assert.deepEqual(parseQuestionMarks('{}'),[]);
 assert.deepEqual(parseQuestionMarks('["A","B","A",4,null,""]'),['A','B']);
});
test('hidden signals override sample flags and modern non-sample kind stays private',()=>{
 for(const r of [{hidden:true,is_sample:true},{is_hidden:true,sample:true},{is_sample:false},{kind:'hidden',sample:true},{kind:'private'}])assert.equal(isPublicSample(r),false);
 assert.equal(isPublicSample({kind:'sample'}),true);assert.equal(isPublicSample({}),true);
});
test('output preserves exact whitespace and distinguishes absent and empty output',()=>{
 assert.equal(outputText('a  b\n\t\n'),'a  b\n\t\n');assert.equal(outputText(''),'(empty output)');assert.equal(outputText(null),'Not provided by the judge');
});
