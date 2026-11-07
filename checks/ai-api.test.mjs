import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleApi,verifyAI} from '../worker/api.mjs';
import {AIError} from '../worker/assessment.mjs';

const BASE='http://localhost:4173';
const KEY='sk-fixture-never-use-live';
const ENV={AI_PROVIDER:'openai',OPENAI_API_KEY:KEY,OPENAI_MODEL:'gpt-5.4'};
const criteria=[{id:'contact',title:'Контакт',description:'Оператор поздоровался.',weight:100,type:'boolean',scale:[],allowNA:false,naRule:''}];
const conversation={id:'api-dialogue',channel:'agent chat',language:'RU',messages:[{id:1,role:'client',time:'00:00',text:'Здравствуйте, моя почта client@example.com'},{id:2,role:'operator',time:'00:05',text:'Здравствуйте! Чем могу помочь?'}]};
const body=()=>({conversation:structuredClone(conversation),criteria:structuredClone(criteria),checklistVersion:2});
function post(path,payload=body(),headers={}){return new Request(BASE+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:BASE,...headers},body:JSON.stringify(payload)});}
function providerResponse(answers={contact:{value:true,reason:'Оператор поздоровался в реплике 2.',evidence:[2],evidenceKind:'present'}}){return Response.json({id:'resp_fixture',status:'completed',model:'gpt-5.4',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answers})}]}],usage:{input_tokens:20,output_tokens:30,total_tokens:50}});}
async function error(response,status,code){assert.equal(response.status,status);const data=await response.json();assert.deepEqual(Object.keys(data).sort(),['code','error']);assert.equal(data.code,code);assert.equal(typeof data.error,'string');assert.ok(!JSON.stringify(data).includes(KEY));return data;}

test('Hosted configuration and status reflect real environment without exposing credentials',async()=>{
 const config=await handleApi(new Request(BASE+'/api/ai/config'),ENV);assert.equal(config.status,200);assert.equal(config.headers.get('Cache-Control'),'no-store');const result=await config.json();assert.equal(result.localConfiguration,false);assert.equal(result.configured,true);assert.equal(result.model,'gpt-5.4');assert.equal(result.provider,'openai');assert.ok(!JSON.stringify(result).includes(KEY));
 for(const [env,expected] of [[{},false],[ENV,true],[{...ENV,OPENAI_MODEL:'bad model'},false]]){const status=await handleApi(new Request(BASE+'/api/status'),env);assert.equal((await status.json()).aiConfigured,expected);}
 await error(await handleApi(post('/api/ai/config',{apiKey:KEY}),ENV),405,'LOCAL_SETTINGS_REQUIRED');
});

test('Assessment uses current dialogue and criteria, masks data and returns deterministic score',async()=>{
 let calls=0;
 const payload=body();payload.packet={instructions:'TRUST_FORGED_PACKET'};payload.conversation.answers={contact:{value:false,reason:'OLD_GROUND_TRUTH'}};
 const result=await handleApi(post('/api/assess',payload),ENV,{fetcher:async(url,init)=>{
  calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,'Bearer '+KEY);assert.ok(init.signal instanceof AbortSignal);
  const request=JSON.parse(init.body);assert.equal(request.store,false);assert.equal(request.text.format.strict,true);assert.ok(!init.body.includes('client@example.com'));assert.ok(!init.body.includes('TRUST_FORGED_PACKET'));assert.ok(!init.body.includes('OLD_GROUND_TRUTH'));return providerResponse();
 }});
 assert.equal(result.status,200);const assessment=await result.json();assert.equal(calls,1);assert.equal(assessment.finalScore,100);assert.equal(assessment.critical,false);assert.equal(assessment.version,2);assert.equal(assessment.conversationId,conversation.id);assert.deepEqual(assessment.answers.contact.evidence,[2]);assert.ok(assessment.sourceFingerprint);assert.ok(assessment.checklistFingerprint);assert.ok(!JSON.stringify(assessment).includes(KEY));assert.ok(!JSON.stringify(assessment).includes('client@example.com'));
});

test('Missing key and invalid preparation never call a provider',async()=>{
 let calls=0;const options={fetcher:async()=>{calls++;throw new Error('Unexpected provider request');}};
 await error(await handleApi(post('/api/assess'),{},options),503,'GEMINI_NOT_CONFIGURED');
 const invalid=body();invalid.conversation.messages[1].role='unknown';await error(await handleApi(post('/api/assess',invalid),ENV,options),422,'PREPROCESS_BLOCKED');
 await error(await handleApi(post('/api/assess'),{...ENV,OPENAI_MODEL:'bad model'},options),400,'INVALID_MODEL');
 assert.equal(calls,0);
});

test('Origin must match exactly when present; CLI requests without Origin remain supported',async()=>{
 let calls=0;const options={fetcher:async()=>{calls++;return providerResponse();}};
 for(const origin of ['https://evil.invalid','http://127.0.0.1:4173',BASE+'/', 'null']){
  await error(await handleApi(post('/api/assess',body(),{Origin:origin}),ENV,options),403,'ORIGIN_REJECTED');
  await error(await handleApi(new Request(BASE+'/api/ai/config',{headers:{Origin:origin}}),ENV,options),403,'ORIGIN_REJECTED');
 }
 assert.equal(calls,0);
 const noOrigin=new Request(BASE+'/api/assess',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body())});assert.equal((await handleApi(noOrigin,ENV,options)).status,200);assert.equal(calls,1);
});

test('Assessment rejects unsupported method, content type and malformed shapes safely',async()=>{
 await error(await handleApi(new Request(BASE+'/api/assess'),ENV),405,'METHOD_NOT_ALLOWED');
 await error(await handleApi(post('/api/assess',body(),{'Content-Type':'text/plain'}),ENV),415,'JSON_REQUIRED');
 await error(await handleApi(post('/api/assess',body(),{'Content-Type':'not-application/json'}),ENV),415,'JSON_REQUIRED');
 await error(await handleApi(new Request(BASE+'/api/assess',{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'}),ENV),400,'INVALID_JSON');
 for(const payload of [null,[],{}, {...body(),conversation:[]},{...body(),criteria:{}},{...body(),criteria:Array(101).fill(criteria[0])},{...body(),conversation:{messages:Array(5001).fill(conversation.messages[0])}}])await error(await handleApi(post('/api/assess',payload),ENV),400,'INVALID_DIALOGUE');
});

test('600KB request bound applies to declarations and streamed bytes, including false lengths',async()=>{
 await error(await handleApi(post('/api/assess',body(),{'Content-Length':'600001'}),ENV),413,'BODY_TOO_LARGE');
 let cancelled=false;const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(300000));controller.enqueue(new Uint8Array(300001));},cancel(){cancelled=true;}});
 const request=new Request(BASE+'/api/assess',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':'1'},body:stream,duplex:'half'});
 await error(await handleApi(request,ENV),413,'BODY_TOO_LARGE');assert.equal(cancelled,true);
});

test('Provider failures preserve safe error contract with no retries or raw details',async()=>{
 for(const [status,expected,code] of [[401,401,'OPENAI_AUTH'],[403,403,'OPENAI_ACCESS'],[429,429,'OPENAI_LIMIT'],[500,502,'OPENAI_UNAVAILABLE']]){
  let calls=0;const response=await handleApi(post('/api/assess'),ENV,{fetcher:async()=>{calls++;return new Response('RAW_PROVIDER_SECRET '+KEY,{status});}});await error(response,expected,code);assert.equal(calls,1);
 }
 const invalid=await handleApi(post('/api/assess'),ENV,{fetcher:async()=>providerResponse({contact:{value:true,reason:'Некорректная ссылка',evidence:[999],evidenceKind:'present'}})});await error(invalid,502,'INVALID_ASSESSMENT');
});

test('Connection verification calls fixed Models endpoint without transcript or generation',async()=>{
 let calls=0;const response=await handleApi(post('/api/ai/verify',{apiKey:'UNTRUSTED_KEY',model:'https://evil.invalid',transcript:'DO_NOT_TRANSMIT'}),ENV,{fetcher:async(url,init)=>{
  calls++;assert.equal(url,'https://api.openai.com/v1/models/gpt-5.4');assert.equal(init.method,'GET');assert.equal(init.headers.Authorization,'Bearer '+KEY);assert.equal(init.redirect,'manual');assert.equal(init.body,undefined);assert.ok(init.signal instanceof AbortSignal);return Response.json({id:'gpt-5.4'});
 }});
 assert.equal(calls,1);assert.equal(response.status,200);assert.deepEqual(await response.json(),{verified:true,provider:'openai',model:'gpt-5.4'});
});

test('Verification validates method, origin, model and configuration before network access',async()=>{
 let calls=0;const options={fetcher:async()=>{calls++;return Response.json({});}};
 await error(await handleApi(new Request(BASE+'/api/ai/verify'),ENV,options),405,'METHOD_NOT_ALLOWED');
 await error(await handleApi(post('/api/ai/verify',{}, {Origin:'https://evil.invalid'}),ENV,options),403,'ORIGIN_REJECTED');
 await error(await handleApi(post('/api/ai/verify',{}),{},options),503,'GEMINI_NOT_CONFIGURED');
 await error(await handleApi(post('/api/ai/verify',{}),{...ENV,OPENAI_MODEL:'bad model'},options),400,'INVALID_MODEL');assert.equal(calls,0);
});

test('Verification reports safe typed upstream and network failures with one request',async()=>{
 for(const [status,expected,code] of [[401,401,'OPENAI_AUTH'],[403,403,'OPENAI_ACCESS'],[404,404,'OPENAI_MODEL_NOT_FOUND'],[429,429,'OPENAI_LIMIT'],[503,502,'OPENAI_UNAVAILABLE']]){
  let calls=0;await error(await handleApi(post('/api/ai/verify',{}),ENV,{fetcher:async()=>{calls++;return new Response(KEY,{status});}}),expected,code);assert.equal(calls,1);
 }
 await error(await handleApi(post('/api/ai/verify',{}),ENV,{fetcher:async()=>{throw new Error(KEY);}}),502,'OPENAI_NETWORK');
 await assert.rejects(verifyAI(ENV,{fetcher:async()=>{throw new DOMException(KEY,'AbortError');}}),error=>error instanceof AIError&&error.code==='OPENAI_TIMEOUT'&&error.status===504&&!error.message.includes(KEY));
});
