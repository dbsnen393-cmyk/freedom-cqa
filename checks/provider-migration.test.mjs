import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configuredAI,assessConversation} from '../worker/assessment.mjs';
import {verifyAI,handleApi} from '../worker/api.mjs';
import {createGeminiLimiter} from '../worker/gemini.mjs';
import {createGroqLimiter} from '../worker/groq.mjs';

const keys={OPENAI_API_KEY:'fixture-openai-never-live',GEMINI_API_KEY:'fixture-gemini-never-live',GROQ_API_KEY:'fixture-groq-never-live'};
const criteria=[{id:'test',title:'Приветствие',description:'Оператор приветствует клиента.',weight:100,type:'boolean',scale:[],allowNA:false,naRule:''}];
const conversation={id:'provider-migration',language:'RU',channel:'agent chat',messages:[{id:1,role:'client',text:'Здравствуйте',time:'00:00'},{id:2,role:'operator',text:'Здравствуйте',time:'00:01'}]};
const raw={answers:{test:{value:true,reason:'Оператор поздоровался.',evidence:[2],evidenceKind:'present'}}};
const body={conversation,criteria,checklistVersion:1};
const post=path=>new Request('https://migration.invalid'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const providers=[
 [{OPENAI_API_KEY:keys.OPENAI_API_KEY},'openai'],[keys,'openai'],
 [{GEMINI_API_KEY:keys.GEMINI_API_KEY},'gemini'],[{GROQ_API_KEY:keys.GROQ_API_KEY},'groq'],
 [{...keys,AI_PROVIDER:'gemini'},'gemini'],[{...keys,AI_PROVIDER:'groq'},'groq'],[{...keys,AI_PROVIDER:'openai'},'openai']
];

test('Provider migration keeps legacy OpenAI and consistently selects configured or explicit providers',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('Unexpected external request');});
 for(const [env,provider] of providers){
  assert.equal(configuredAI(env).provider,provider);assert.equal(configuredAI(env).configured,true);
  let calls=0;const options={limiter:createGeminiLimiter(),groqLimiter:createGroqLimiter(),fetcher:async(url,init)=>{
   calls++;const host=new URL(url).hostname;assert.equal(host,{openai:'api.openai.com',gemini:'generativelanguage.googleapis.com',groq:'api.groq.com'}[provider]);
   if(init.method==='GET')return Response.json({});
   if(provider==='openai')return Response.json({status:'completed',model:'gpt-5.4',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(raw)}]}]});
   if(provider==='gemini')return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(raw)}]}}]});
   return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(raw)}}]});
  }};
  assert.equal((await verifyAI(env,options)).provider,provider);
  const result=await assessConversation(conversation,criteria,1,env,options);assert.equal(result.assessment.provider,provider);assert.equal(result.finalScore,100);assert.equal(calls,2);
 }
 assert.equal(configuredAI({}).provider,'gemini');assert.equal(configuredAI({}).configured,false);
});

test('Explicit provider never falls back to another stored key when its own key is missing',async()=>{
 let calls=0;const options={fetcher:async()=>{calls++;throw new Error('Unexpected provider request');}};
 const env={AI_PROVIDER:'openai',GEMINI_API_KEY:keys.GEMINI_API_KEY};
 assert.equal(configuredAI(env).configured,false);assert.equal(configuredAI(env).provider,'openai');
 await assert.rejects(verifyAI(env,options),error=>error.code==='OPENAI_NOT_CONFIGURED');
 await assert.rejects(assessConversation(conversation,criteria,1,env,options),error=>error.code==='OPENAI_NOT_CONFIGURED');assert.equal(calls,0);
});

test('Unknown explicit provider blocks config, verification and assessment before any network request',async()=>{
 const env={...keys,AI_PROVIDER:'unsupported-private-value'};let calls=0;const options={fetcher:async()=>{calls++;throw new Error('Unexpected provider request');}};
 assert.equal(configuredAI(env).configured,false);
 for(const request of [new Request('https://migration.invalid/api/ai/config'),post('/api/ai/verify'),post('/api/assess')]){
  const response=await handleApi(request,env,options);assert.equal(response.status,400);const data=await response.json();assert.equal(data.code,'INVALID_PROVIDER');assert.ok(!JSON.stringify(data).includes(env.AI_PROVIDER));
 }
 assert.equal(calls,0);
});
