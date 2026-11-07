import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessConversation} from '../worker/assessment.mjs';
import {verifyAI,handleApi} from '../worker/api.mjs';
import {createGeminiLimiter} from '../worker/gemini.mjs';
import {initialCriteria} from '../web/domain.js';
import {qualityFixtures} from './fixtures/ai-quality.mjs';
const env={GEMINI_API_KEY:'synthetic-key-no-live-use'};
const result=raw=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(raw)}]}}]});
for(const f of qualityFixtures)test('Gemini synthetic gold '+f.name,async()=>{
 const answer=await assessConversation(f.conversation,initialCriteria,1,env,{limiter:createGeminiLimiter(),fetcher:async(url,init)=>{
  assert.match(url,/generativelanguage.googleapis.com/);assert.ok(!url.includes(env.GEMINI_API_KEY));assert.equal(init.headers['x-goog-api-key'],env.GEMINI_API_KEY);
  const body=JSON.parse(init.body);assert.equal(body.generationConfig.responseMimeType,'application/json');assert.equal(JSON.parse(body.contents[0].parts[0].text).checklist.version,1);assert.match(body.systemInstruction.parts[0].text,/казахские/);return result(f.gold);
 }});assert.equal(answer.finalScore,f.score);assert.equal(answer.critical,f.critical);assert.deepEqual(answer.answers,f.gold.answers);assert.equal(answer.assessment.provider,'gemini');
});
test('Gemini rejects invalid evidence, invalid JSON, blocked and truncated responses',async()=>{
 const f=qualityFixtures[0],bad=structuredClone(f.gold);bad.answers.contact.evidence=[999];
 for(const response of [()=>result(bad),()=>Response.json({candidates:[{finishReason:'MAX_TOKENS'}]}),()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'{invalid'}]}}]})])await assert.rejects(assessConversation(f.conversation,initialCriteria,1,env,{limiter:createGeminiLimiter(),fetcher:async()=>response()}),e=>e.status===502);
});
test('Gemini API failures never retry and do not leak secrets',async()=>{
 for(const status of [400,401,403,404,429,500]){let calls=0;await assert.rejects(verifyAI(env,{limiter:createGeminiLimiter(),fetcher:async()=>{calls++;return new Response(env.GEMINI_API_KEY,{status});}}),e=>!e.message.includes(env.GEMINI_API_KEY));assert.equal(calls,1);}
 await assert.rejects(verifyAI(env,{limiter:createGeminiLimiter(),fetcher:async()=>{throw new DOMException('secret','AbortError');}}),e=>e.code==='GEMINI_TIMEOUT');
});
test('Limiter enforces concurrency, RPM, daily and token limits and Retry-After',()=>{
 let at=0;const fresh=()=>createGeminiLimiter({now:()=>at});let q=fresh(),a=q.acquire(1),b=q.acquire(1);assert.throws(()=>q.acquire(1));a();a();b();
 q=fresh();for(let i=0;i<15;i++)q.acquire(1)();assert.throws(()=>q.acquire(1));at+=60001;q.acquire(1)();
 q=fresh();q.acquire(250000)();assert.throws(()=>q.acquire(1));
 q=fresh();q.cooldown('120');assert.throws(()=>q.acquire(1));at+=120001;q.acquire(1)();
 q=fresh();for(let i=0;i<500;i++){q.acquire(1)();at+=60001;}assert.throws(()=>q.acquire(1));at+=86400001;q.acquire(1)();
});
test('429 cooldown prevents another network request; verify sends no conversation',async()=>{
 const limiter=createGeminiLimiter();let calls=0;const options={limiter,fetcher:async(url,init)=>{calls++;assert.equal(init.method,'GET');assert.equal(init.body,undefined);return new Response('',{status:429,headers:{'Retry-After':'60'}});}};
 await assert.rejects(verifyAI(env,options));await assert.rejects(verifyAI(env,options));assert.equal(calls,1);
});
test('API Gemini returns unchanged assessment contract and never returns invalid evidence',async()=>{
 const f=qualityFixtures[0],raw=structuredClone(f.gold);raw.answers.contact.evidence=[999];
 const request=new Request('http://localhost/api/assess',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversation:f.conversation,criteria:initialCriteria,checklistVersion:1})});
 const response=await handleApi(request,env,{limiter:createGeminiLimiter(),fetcher:async()=>result(raw)});assert.equal(response.status,502);assert.equal((await response.json()).code,'INVALID_ASSESSMENT');
});
test('Gemini schema follows edited checklist and current version; forged packets are ignored',async()=>{
 const f=qualityFixtures[0],criteria=structuredClone(initialCriteria);criteria[0].description='Новое определение контакта';
 await assessConversation(f.conversation,criteria,9,env,{limiter:createGeminiLimiter(),fetcher:async(url,init)=>{const packet=JSON.parse(JSON.parse(init.body).contents[0].parts[0].text);assert.equal(packet.checklist.version,9);assert.equal(packet.checklist.criteria[0].description,'Новое определение контакта');return result(f.gold);}});
});
test('Gemini rejects unsupported N/A and extra model score',async()=>{
 for(const mutate of [raw=>{raw.answers.contact.value=null;raw.answers.contact.evidenceKind='not_applicable';},raw=>{raw.finalScore=100;}]){
 const raw=structuredClone(qualityFixtures[0].gold);mutate(raw);await assert.rejects(assessConversation(qualityFixtures[0].conversation,initialCriteria,1,env,{limiter:createGeminiLimiter(),fetcher:async()=>result(raw)}),e=>e.code==='INVALID_ASSESSMENT');}
});
