import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preprocessConversation} from '../web/preprocess.js';
import {initialCriteria} from '../web/domain.js';
import {assessConversation,ASSESSMENT_PROMPT_VERSION} from '../worker/assessment.mjs';
import {handleApi} from '../worker/api.mjs';
import {createGeminiLimiter,GEMINI_INPUT_BYTE_BUDGET} from '../worker/gemini.mjs';
const rules=()=>structuredClone(initialCriteria),env={GEMINI_API_KEY:'stabilization-mock-only'};
const conversation=(texts)=>({id:'synthetic-stabilization',language:'RU',channel:'agent chat',messages:texts.map(([role,text],i)=>({id:i+1,role,text,time:'00:'+String(i*5).padStart(2,'0')}))});
for(const text of ['', '   ', '\t\r\n', '\u0000\u0001\u007f', '\u00a0\u2003'])test('Empty operator content is blocked after normalization: '+JSON.stringify(text),async()=>{
 const c=conversation([['client','Нужна помощь'],['operator',text]]),prepared=await preprocessConversation(c,rules(),1);
 assert.equal(prepared.packet,null);assert.ok(prepared.report.issues.some(i=>i.code==='no_operator_text'&&i.severity==='error'));
 let calls=0;await assert.rejects(assessConversation(c,rules(),1,env,{fetcher:async()=>{calls++;throw new Error('No provider call expected');}}),e=>e.code==='PREPROCESS_BLOCKED'&&e.status===422);assert.equal(calls,0);
});
test('Multiple empty operators and a nonempty bot cannot bypass the content check',async()=>{
 const c=conversation([['client','Вопрос'],['bot','Ответ бота'],['operator',' '],['operator','\t']]);assert.equal((await preprocessConversation(c,rules(),1)).packet,null);
});
test('Empty system/client/earlier operator messages do not block a later substantive operator',async()=>{
 const c=conversation([['client',''],['system',''],['operator',' '],['operator','Здравствуйте! Уточните, что вас интересует.']]);assert.ok((await preprocessConversation(c,rules(),1)).packet);
});
test('Missing operator retains original no_operator error',async()=>{
 const r=await preprocessConversation(conversation([['client','Вопрос'],['bot','Ответ']]),rules(),1);assert.equal(r.packet,null);assert.ok(r.report.issues.some(i=>i.code==='no_operator'));assert.ok(!r.report.issues.some(i=>i.code==='no_operator_text'));
});
test('Permanent byte-budget overflow is 413 and consumes no quota or active slot',()=>{
 const q=createGeminiLimiter();for(let i=0;i<3;i++)assert.throws(()=>q.acquire(GEMINI_INPUT_BYTE_BUDGET+1),e=>e.code==='GEMINI_INPUT_TOO_LARGE'&&e.status===413);
 q.acquire(GEMINI_INPUT_BYTE_BUDGET)();assert.throws(()=>q.acquire(1),e=>e.code==='GEMINI_LIMIT'&&e.status===429);
});
test('Temporary aggregate quota overflow recovers after one minute',()=>{
 let at=0;const q=createGeminiLimiter({now:()=>at});q.acquire(150000)();assert.throws(()=>q.acquire(150000),e=>e.status===429);at=60001;q.acquire(150000)();
});
test('API separates raw-body size from prepared request budget without sending or truncating data',async()=>{
 const c=conversation([['client','Вопрос'],['operator','я'.repeat(140000)]]),input=JSON.stringify({conversation:c,criteria:rules(),checklistVersion:1});assert.ok(new TextEncoder().encode(input).length<600000);
 assert.ok((await preprocessConversation(c,rules(),1)).packet);const original=structuredClone(c);let calls=0;
 const response=await handleApi(new Request('http://localhost/api/assess',{method:'POST',headers:{'Content-Type':'application/json'},body:input}),env,{limiter:createGeminiLimiter(),fetcher:async()=>{calls++;throw new Error('No network expected');}});
 assert.equal(response.status,413);const error=await response.json();assert.equal(error.code,'GEMINI_INPUT_TOO_LARGE');assert.match(error.error,/Ожидание не поможет/);assert.equal(calls,0);assert.deepEqual(c,original);
});
test('Actual upstream 429 remains a provider failure with one request, unlike local oversized input',async()=>{
 let calls=0;const c=conversation([['client','Вопрос'],['operator','Здравствуйте!']]);await assert.rejects(assessConversation(c,rules(),1,env,{limiter:createGeminiLimiter(),fetcher:async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'60'}});}}),e=>e.code==='GEMINI_LIMIT'&&e.status===429);assert.equal(calls,1);assert.equal(ASSESSMENT_PROMPT_VERSION,'cqa-assessment-1.4');
});
