import {test} from 'node:test';
import assert from 'node:assert/strict';
import {redactMessages} from '../web/privacy.js';
import {preprocessConversation} from '../web/preprocess.js';
import {initialCriteria} from '../web/domain.js';

const message=(role,text,id)=>({id,role,text,time:'00:00'});
const conversation=messages=>({id:'backend-audit',language:'RU',channel:'agent chat',messages});
const rules=()=>structuredClone(initialCriteria);

test('Context-labelled Kazakhstan phones without a plus sign are masked, ordinary identifiers are retained',()=>{
 const result=redactMessages([message('client','Телефон: 77011234567',1),message('client','Заявка 77011234567',2),message('operator','Ваш phone number?',3),message('client','77011234568',4)]);
 assert.equal(result.messages[0].text,'Телефон: [PHONE_001]');
 assert.equal(result.messages[1].text,'Заявка 77011234567');
 assert.equal(result.messages[3].text,'[PHONE_002]');
});

test('Bot requests and intervening system events retain sensitive reply context in the actual AI packet',async()=>{
 const c=conversation([message('bot','Введите смс-код',1),message('client','654321',2),message('operator','Назовите ИИН',3),message('system','Соединение восстановлено',4),message('client','900101123456',5)]);
 const result=await preprocessConversation(c,rules(),1);
 assert.ok(result.packet);
 assert.equal(result.packet.transcript[1].text,'[OTP_001]');
 assert.equal(result.packet.transcript[4].text,'[IIN_001]');
 assert.equal(c.messages[1].text,'654321');
 const serialized=JSON.stringify(result);
 assert.ok(!serialized.includes('654321'));
 assert.ok(!serialized.includes('900101123456'));
});

test('Sensitive reply context stops at the next conversational response',()=>{
 const result=redactMessages([message('operator','Назовите ИИН',1),message('client','Не буду сообщать',2),message('system','Сервисное сообщение',3),message('client','900101123456',4)]);
 assert.equal(result.messages[3].text,'900101123456');
});

test('A checklist whose total scoring weight overflows is rejected before assessment',async()=>{
 const criteria=rules();criteria.forEach(c=>c.weight=Number.MAX_VALUE);
 const result=await preprocessConversation(conversation([message('operator','Здравствуйте!',1)]),criteria,1);
 assert.equal(result.packet,null);
 assert.ok(result.report.issues.some(issue=>issue.code==='criterion_weight'&&issue.severity==='error'));
});

test('Large finite scoring weights still work, while irrelevant flag weights do not enter the sum',async()=>{
 const criteria=rules();criteria.forEach(c=>c.weight=0);criteria[0].weight=Number.MAX_VALUE;criteria.at(-1).weight=Number.MAX_VALUE;
 const result=await preprocessConversation(conversation([message('operator','Здравствуйте!',1)]),criteria,1);
 assert.ok(result.packet);
});

test('Oversized scale is blocked explicitly without stack overflow or a partial AI packet',async()=>{
 const criteria=[{...initialCriteria[3],scale:Array.from({length:150000},(_,i)=>i)}];
 const result=await preprocessConversation(conversation([message('operator','Здравствуйте!',1)]),criteria,1);
 assert.equal(result.packet,null);
 assert.ok(result.report.issues.some(issue=>issue.code==='criterion_scale'&&issue.severity==='error'));
});
import {handleApi} from '../worker/api.mjs';

const apiEnv={AI_PROVIDER:'openai',OPENAI_API_KEY:'backend-audit-fixture-never-live',OPENAI_MODEL:'gpt-5.4'};
const apiRequest=path=>new Request('https://audit.invalid'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversation:conversation([message('operator','Здравствуйте!',1)]),criteria:rules(),checklistVersion:1})});

test('Assessment and verification distinguish exhausted API credits from request rate limits without disclosing provider details',async()=>{
 for(const path of ['/api/assess','/api/ai/verify'])for(const [detail,expected] of [[{code:'credit_balance_exhausted',type:'insufficient_quota'},'OPENAI_QUOTA'],[{code:'insufficient_quota'},'OPENAI_QUOTA'],[{code:'credit_balance_exhausted'},'OPENAI_QUOTA'],[{code:'rate_limit_exceeded'},'OPENAI_RATE_LIMIT'],[{type:'rate_limit_exceeded'},'OPENAI_RATE_LIMIT'],[{code:'unknown'},'OPENAI_LIMIT']]){
  let calls=0;
  const result=await handleApi(apiRequest(path),apiEnv,{fetcher:async()=>{calls++;return Response.json({error:{...detail,message:'PROVIDER_PRIVATE_DETAIL'}},{status:429});}});
  assert.equal(result.status,429);
  const body=await result.json();assert.equal(body.code,expected,path);assert.ok(!JSON.stringify(body).includes('PROVIDER_PRIVATE_DETAIL'));assert.ok(!JSON.stringify(body).includes(apiEnv.OPENAI_API_KEY));assert.equal(calls,1);
  if(expected==='OPENAI_QUOTA')assert.match(body.error,/API/);
 }
});

test('Malformed and oversized provider error bodies retain the generic safe 429 error and are bounded',async()=>{
 for(const path of ['/api/assess','/api/ai/verify']){
  let cancelled=false;
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(16385));},cancel(){cancelled=true;}});
  const oversized=await handleApi(apiRequest(path),apiEnv,{fetcher:async()=>new Response(stream,{status:429,headers:{'Content-Length':'1'}})});
  assert.equal(oversized.status,429);assert.equal((await oversized.json()).code,'OPENAI_LIMIT');assert.equal(cancelled,true);
  const malformed=await handleApi(apiRequest(path),apiEnv,{fetcher:async()=>new Response('PROVIDER_PRIVATE_DETAIL',{status:429})});
  const body=await malformed.json();assert.equal(body.code,'OPENAI_LIMIT');assert.ok(!body.error.includes('PROVIDER_PRIVATE_DETAIL'));
 }
});
const organizerEnv={ORGANIZER_API_URL:'https://ec88f21f1accecf38e20095a9fe175.a5.environment.api.powerplatform.com/?sig=SYNTHETIC_SOURCE_SECRET'};
const sourceRequest=()=>new Request('https://audit.invalid/api/datasets?group_id=BACKEND_AUDIT&refresh=1');
test('Organizer network, timeout and non-JSON failures have distinct safe messages at the API boundary',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('Unexpected external fetch');});
 const cases=[['SOURCE_NETWORK',502,async()=>{throw new TypeError('SYNTHETIC_SOURCE_SECRET '+organizerEnv.ORGANIZER_API_URL);} ],['SOURCE_TIMEOUT',504,async()=>{throw new DOMException('SYNTHETIC_SOURCE_SECRET','TimeoutError');}],['SOURCE_INVALID_JSON',502,async()=>new Response('<html>SYNTHETIC_SOURCE_SECRET</html>')],['SOURCE_TIMEOUT',504,async()=>new Response(new ReadableStream({start(controller){controller.error(new DOMException('SYNTHETIC_SOURCE_SECRET','AbortError'));}}))]];
 for(const [code,status,fetcher] of cases){
  let calls=0;const result=await handleApi(sourceRequest(),organizerEnv,{fetcher:async(...args)=>{calls++;return fetcher(...args);}});
  const body=await result.json();assert.equal(result.status,status);assert.equal(body.code,code);assert.equal(body.isSuccess,false);assert.ok(body.error.length<300);assert.ok(!JSON.stringify(body).includes('SYNTHETIC_SOURCE_SECRET'));assert.ok(!JSON.stringify(body).includes('powerplatform.com'));assert.equal(calls,1);
 }
});

test('Hosted runtime accepting only follow or manual can verify, assess and load organizer data',async t=>{
 const env={...organizerEnv,...apiEnv};let calls=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  calls++;
  if(!['follow','manual'].includes(init.redirect))throw new TypeError('Invalid redirect value; runtime only supports follow or manual');
  assert.equal(init.redirect,'manual');
  if(url.includes('/v1/models/'))return Response.json({id:'gpt-5.4'});
  if(url.includes('/v1/responses'))return Response.json({status:'completed',model:'gpt-5.4',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answers:Object.fromEntries(rules().map(c=>[c.id,{value:c.type==='scale'?Math.max(...c.scale):c.type!=='flag',reason:'Подтверждается репликой оператора.',evidence:[1],evidenceKind:'present'}]))})}]}]});
  return Response.json({isSuccess:true,data:{records:[]}});
 });
 for(const request of [apiRequest('/api/ai/verify'),apiRequest('/api/assess'),sourceRequest()])assert.equal((await handleApi(request,env)).status,200);
 assert.equal(calls,3);
});

test('All external request paths reject redirect responses, cancel their bodies and never follow Location',async t=>{
 const env={...organizerEnv,...apiEnv};let calls=[],cancelled=0,status=302;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  calls.push({url,init});assert.equal(init.redirect,'manual');assert.ok(!url.includes('attacker.invalid'));
  return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1]));},cancel(){cancelled++;}}),{status,headers:{Location:'https://attacker.invalid/collect'}});
 });
 for(status of [301,302,303,307,308])for(const request of [apiRequest('/api/ai/verify'),apiRequest('/api/assess'),sourceRequest()]){
  calls=[];cancelled=0;const result=await handleApi(request,env);
  assert.equal(result.status,502);assert.equal(calls.length,1);assert.equal(cancelled,1);
  assert.ok(!JSON.stringify(await result.json()).includes('attacker.invalid'));
 }
});
