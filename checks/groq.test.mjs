import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessConversation,configuredAI,buildAssessmentRequest,ASSESSMENT_PROMPT_VERSION} from '../worker/assessment.mjs';
import {callGroq,buildGroqRequest,groqConfig,createGroqLimiter,GroqError} from '../worker/groq.mjs';
import {preprocessConversation} from '../web/preprocess.js';
import {initialCriteria} from '../web/domain.js';
import {installAssessment} from '../web/assessment-state.js';
import {handleApi,verifyAI} from '../worker/api.mjs';
import {qualityFixtures} from './fixtures/ai-quality.mjs';
const KEY='gsk_fixture_not_a_real_key_1234567890',env={AI_PROVIDER:'groq',GROQ_API_KEY:KEY},fixture=qualityFixtures.find(f=>f.name==='RU-2');
const options=fetcher=>({groqLimiter:createGroqLimiter(),fetcher});
const response=(raw=fixture.gold,extra={})=>Response.json({id:'chatcmpl_fixture',model:'openai/gpt-oss-120b',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(raw)}}],usage:{prompt_tokens:4000,completion_tokens:700,total_tokens:4700},...extra});
const assess=(fetcher,overrides={})=>assessConversation(fixture.conversation,initialCriteria,1,{...env,...overrides},options(fetcher));
const post=body=>new Request('http://localhost/api/assess',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

test('Groq uses strict schema, same v1.4 prompt, masked packet, one fixed endpoint and UI-compatible result',async()=>{
 let calls=0;const packet=(await preprocessConversation(fixture.conversation,initialCriteria,1)).packet,request=buildAssessmentRequest(packet),original=JSON.stringify(request);
 const out=await assess(async(url,init)=>{
  calls++;assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');assert.equal(init.headers.Authorization,'Bearer '+KEY);assert.equal(init.redirect,'manual');assert.equal(init.method,'POST');assert.ok(init.signal instanceof AbortSignal);
  const body=JSON.parse(init.body);assert.equal(body.model,'openai/gpt-oss-120b');assert.equal(body.stream,false);assert.equal(body.max_completion_tokens,8192);assert.equal(body.reasoning_effort,'medium');
  assert.equal(body.messages[0].content,request.instructions);assert.equal(body.messages[1].content,request.input[0].content[0].text);assert.ok(!body.tools);assert.ok(!body.input);assert.ok(!JSON.stringify(body).includes(KEY));
  assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.strict,true);
  const schema=body.response_format.json_schema.schema;assert.equal(schema.type,'object');assert.equal(schema.additionalProperties,false);assert.deepEqual(schema.properties.answers.required,initialCriteria.map(c=>c.id));
  for(const c of initialCriteria){const branches=schema.properties.answers.properties[c.id].anyOf;assert.equal(branches.length,c.allowNA?2:1);for(const b of branches){assert.equal(b.additionalProperties,false);assert.deepEqual(b.required,['value','reason','evidence','evidenceKind']);assert.deepEqual(b.properties.evidence.items,{type:'integer'});}
   assert.deepEqual(branches[0].properties.value,c.type==='scale'?{type:'number',enum:c.scale}:{type:'boolean'});assert.deepEqual(branches[0].properties.evidenceKind.enum,['present','absence']);if(c.allowNA){assert.deepEqual(branches[1].properties.value,{type:'null'});assert.deepEqual(branches[1].properties.evidenceKind.enum,['not_applicable']);}}
  return response();
 });
 assert.equal(calls,1);assert.equal(out.finalScore,58.82);assert.equal(out.critical,false);assert.deepEqual(out.answers,fixture.gold.answers);assert.equal(out.assessment.provider,'groq');assert.equal(out.assessment.promptVersion,ASSESSMENT_PROMPT_VERSION);assert.equal(out.assessment.model,'openai/gpt-oss-120b');assert.equal(out.assessment.responseId,'chatcmpl_fixture');assert.deepEqual(out.assessment.usage,{input_tokens:4000,output_tokens:700,total_tokens:4700});
 const conversation=structuredClone(fixture.conversation);installAssessment(conversation,out,[]);assert.deepEqual(conversation.answers,out.answers);assert.equal(conversation.assessment.provider,'groq');
 assert.equal(JSON.stringify(request),original);buildGroqRequest(request,env);assert.equal(JSON.stringify(request),original);
});

test('Groq preprocessing masks sensitive data and excludes old verdicts and forged packet',async()=>{
 const conversation=structuredClone(fixture.conversation);conversation.messages[0].text+=' Email: synthetic@example.com';conversation.answers={old:'OLD_VERDICT'};
 let calls=0;const res=await handleApi(post({conversation,criteria:initialCriteria,checklistVersion:1,packet:{instructions:'FORGED_PACKET'}}),env,options(async(url,init)=>{calls++;assert.ok(!init.body.includes('synthetic@example.com'));assert.ok(!init.body.includes('OLD_VERDICT'));assert.ok(!init.body.includes('FORGED_PACKET'));return response();}));assert.equal(res.status,200);assert.equal(calls,1);
});

test('Provider routing stays explicit and isolated; configuration does not disclose keys',()=>{
 assert.equal(configuredAI(env).provider,'groq');assert.equal(configuredAI({GEMINI_API_KEY:'gemini-fixture'}).provider,'gemini');assert.equal(configuredAI({AI_PROVIDER:'gemini',GROQ_API_KEY:KEY}).configured,false);assert.equal(groqConfig({}).model,'openai/gpt-oss-120b');assert.equal(groqConfig({GROQ_API_KEY:KEY,GROQ_MODEL:'https://evil.invalid'}).configured,false);assert.ok(!JSON.stringify(configuredAI(env)).includes(KEY));
});

test('Missing Groq key, invalid model and invalid packet never call another provider',async()=>{
 let calls=0;const fetcher=async()=>{calls++;throw new Error('No network expected');};
 await assert.rejects(assess(fetcher,{GROQ_API_KEY:'',GEMINI_API_KEY:'available-but-not-fallback'}),e=>e.code==='GROQ_NOT_CONFIGURED');
 await assert.rejects(assess(fetcher,{GROQ_MODEL:'bad model'}),e=>e.code==='INVALID_MODEL');
 const bad=structuredClone(fixture.conversation);bad.messages[0].role='unknown';await assert.rejects(assessConversation(bad,initialCriteria,1,env,options(fetcher)),e=>e.code==='PREPROCESS_BLOCKED');assert.equal(calls,0);
});

for(const [status,code,expectedStatus]of [[400,'GROQ_REQUEST',502],[401,'GROQ_AUTH',401],[403,'GROQ_AUTH',403],[404,'GROQ_MODEL_NOT_FOUND',502],[422,'GROQ_REQUEST',502],[429,'GROQ_LIMIT',429],[503,'GROQ_UNAVAILABLE',503],[500,'GROQ_UNAVAILABLE',502],[302,'GROQ_UNAVAILABLE',502]])test('Groq HTTP '+status+' fails safely without retry/fallback',async()=>{
 let calls=0;await assert.rejects(assess(async()=>{calls++;return new Response(KEY+' PRIVATE_DETAILS',{status});}),e=>e.code===code&&e.status===expectedStatus&&!e.message.includes(KEY)&&!e.message.includes('PRIVATE_DETAILS'));assert.equal(calls,1);
});
for(const kind of ['AbortError','TimeoutError','Error'])test('Groq transport failure '+kind+' hides details',async()=>{
 await assert.rejects(assess(async()=>{throw kind==='Error'?new Error(KEY):new DOMException(KEY,kind);}),e=>e.code===(kind==='Error'?'GROQ_NETWORK':'GROQ_TIMEOUT')&&!e.message.includes(KEY));
});

for(const [name,body,expected]of [
 ['null',null,'INVALID_PROVIDER_RESPONSE'],['array',[],'INVALID_PROVIDER_RESPONSE'],['missing choices',{},'INVALID_PROVIDER_RESPONSE'],
 ['empty choices',{choices:[]},'INVALID_PROVIDER_RESPONSE'],['truncated',{choices:[{finish_reason:'length'}]},'MODEL_INCOMPLETE'],
 ['refusal',{choices:[{finish_reason:'stop',message:{refusal:'refused'}}]},'MODEL_REFUSAL'],
 ['tool call',{choices:[{finish_reason:'tool_calls'}]},'MODEL_INCOMPLETE'],
 ['wrong content',{choices:[{finish_reason:'stop',message:{role:'assistant',content:[]}}]},'INVALID_PROVIDER_RESPONSE'],
 ['bad JSON',{choices:[{finish_reason:'stop',message:{role:'assistant',content:'{bad'}}]},'INVALID_ASSESSMENT']
])test('Groq rejects provider response '+name,async()=>{await assert.rejects(assess(async()=>Response.json(body)),e=>e.code===expected);});

for(const [name,mutate]of [
 ['unknown evidence',r=>{r.answers.contact.evidence=[999];}],['empty evidence',r=>{r.answers.contact.evidence=[];}],['empty reason',r=>{r.answers.contact.reason=' ';}],
 ['extra score',r=>{r.finalScore=100;}],['wrong scale',r=>{r.answers.management.value=9;}],['true + N/A',r=>{r.answers.need.value=true;}],['null + present',r=>{r.answers.need.evidenceKind='present';}]
])test('Groq server validation rejects '+name,async()=>{const raw=structuredClone(fixture.gold);mutate(raw);await assert.rejects(assess(async()=>response(raw)),e=>e.code==='INVALID_ASSESSMENT');});

test('Groq bounds provider response streams and declared lengths',async()=>{
 for(const fake of [()=>new Response('oversized',{headers:{'Content-Length':String(2*1024*1024+1)}}),()=>new Response(new Uint8Array(2*1024*1024+1))])await assert.rejects(assess(async()=>fake()),e=>e.code==='RESPONSE_TOO_LARGE');
 await assert.rejects(assess(async()=>new Response('not json')),e=>e.code==='INVALID_PROVIDER_RESPONSE');
});

test('Groq 429 cooldown and concurrency are independent, slots release on errors',async()=>{
 let at=0;const limiter=createGroqLimiter({now:()=>at}),one=limiter.acquire(),two=limiter.acquire();assert.throws(()=>limiter.acquire(),GroqError);one();one();two();limiter.acquire()();
 limiter.cooldown('120');assert.throws(()=>limiter.acquire());at=120001;limiter.acquire()();limiter.cooldown(new Date(at+120000).toUTCString());assert.throws(()=>limiter.acquire());at+=120001;limiter.acquire()();
 const quota=createGroqLimiter(),opts={groqLimiter:quota,fetcher:async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'60'}});}};let calls=0;
 await assert.rejects(verifyAI(env,opts));await assert.rejects(verifyAI(env,opts));assert.equal(calls,1);
 const released=createGroqLimiter();for(let i=0;i<3;i++)await assert.rejects(verifyAI(env,{groqLimiter:released,fetcher:async()=>{throw new Error('mock');}}),e=>e.code==='GROQ_NETWORK');
});

test('Groq verify sends no transcript and uses only server-side credentials',async()=>{
 const out=await verifyAI(env,options(async(url,init)=>{assert.equal(url,'https://api.groq.com/openai/v1/models/openai%2Fgpt-oss-120b');assert.equal(init.method,'GET');assert.equal(init.body,undefined);assert.equal(init.headers.Authorization,'Bearer '+KEY);return Response.json({id:'openai/gpt-oss-120b'});}));assert.deepEqual(out,{verified:true,provider:'groq',model:'openai/gpt-oss-120b'});
 const config=await handleApi(new Request('http://localhost/api/ai/config'),env);const body=await config.json();assert.equal(body.provider,'groq');assert.equal(body.model,'openai/gpt-oss-120b');assert.ok(!JSON.stringify(body).includes(KEY));
});

test('Groq dynamic checklist controls scales, renamed IDs, N/A, score and critical',async()=>{
 const criteria=[{...initialCriteria[3],id:'custom-scale',scale:[0,2,4],weight:30},{...initialCriteria[1],id:'custom-na',weight:10},{...initialCriteria[7],id:'custom-critical'}];
 const raw={answers:{'custom-scale':{value:2,reason:'Частичное выполнение.',evidence:[2],evidenceKind:'present'},'custom-na':{value:null,reason:'Исходных данных достаточно.',evidence:[1],evidenceKind:'not_applicable'},'custom-critical':{value:true,reason:'Синтетический флаг.',evidence:[2],evidenceKind:'present'}}};
 const result=await assessConversation(fixture.conversation,criteria,12,env,options(async(url,init)=>{const body=JSON.parse(init.body);assert.deepEqual(body.response_format.json_schema.schema.properties.answers.properties['custom-scale'].anyOf[0].properties.value,{type:'number',enum:[0,2,4]});return response(raw);}));assert.equal(result.finalScore,50);assert.equal(result.critical,true);assert.equal(result.version,12);assert.deepEqual(result.answers,raw.answers);
});

test('Groq API route returns safe typed failure without an assessment',async()=>{
 const res=await handleApi(post({conversation:fixture.conversation,criteria:initialCriteria,checklistVersion:1}),env,options(async()=>new Response(KEY,{status:503})));assert.equal(res.status,503);const body=await res.json();assert.deepEqual(Object.keys(body).sort(),['code','error']);assert.equal(body.code,'GROQ_UNAVAILABLE');assert.ok(!JSON.stringify(body).includes(KEY));
});
