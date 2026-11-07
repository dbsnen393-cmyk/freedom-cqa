import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configuredAI,buildAssessmentRequest,validateAssessment,assessConversation,AIError,DEFAULT_OPENAI_MODEL} from '../worker/assessment.mjs';
import {preprocessConversation} from '../web/preprocess.js';
import {initialCriteria} from '../web/domain.js';
const env={OPENAI_API_KEY:'test-key-never-live',OPENAI_MODEL:'gpt-5.4'};
const rules=()=>structuredClone(initialCriteria);
const conversation=()=>({id:'test-ai-001',language:'RU',channel:'agent chat',criteria:rules(),version:1,messages:[{id:1,role:'client',time:'00:00',text:'Где посмотреть тариф? Моя почта private.person@example.com.'},{id:2,role:'operator',time:'00:10',text:'Здравствуйте! Меня зовут Алия. Откройте раздел тарифов.'},{id:3,role:'client',time:'00:20',text:'Нашла, спасибо.'},{id:4,role:'operator',time:'00:30',text:'Всего доброго!'}]});
async function packet(criteria=rules()){return (await preprocessConversation(conversation(),criteria,1)).packet;}
function fullAnswers(criteria=rules()){return {answers:Object.fromEntries(criteria.map(c=>[c.id,{value:c.type==='scale'?Math.max(...c.scale):c.type==='flag'?false:true,reason:'Реплика оператора подтверждает выбранное значение в контексте.',evidence:[2],evidenceKind:'present'}]))};}
function responseFor(raw=fullAnswers(),overrides={}){return Response.json({id:'resp_mock_test',status:'completed',model:'gpt-5.4-2026-03-05',output:[{type:'reasoning',summary:[]},{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(raw)}]}],usage:{input_tokens:100,output_tokens:200,total_tokens:300},...overrides});}
function safeError(code,status){return error=>{assert.ok(error instanceof AIError);assert.equal(error.code,code);assert.equal(error.status,status);assert.ok(!error.message.includes(env.OPENAI_API_KEY));return true;};}

test('AI status exposes configuration and selected model without the API key',()=>{
 assert.equal(configuredAI({}).configured,false);assert.equal(configuredAI({}).model,DEFAULT_OPENAI_MODEL);
 const result=configuredAI(env);assert.equal(result.configured,true);assert.equal(result.provider,'openai');assert.ok(!JSON.stringify(result).includes(env.OPENAI_API_KEY));
 assert.equal(configuredAI({...env,OPENAI_MODEL:'https://attacker.invalid'}).configured,false);
});
test('Responses request uses strict dynamic current-criterion schema and no storage or tools',async()=>{
 const current=rules();current[0].id='new-contact';current[0].description='Уточнить формат обращения.';const p=await packet(current),request=buildAssessmentRequest(p,env),format=request.text.format;
 assert.equal(request.store,false);assert.equal(request.model,env.OPENAI_MODEL);assert.equal(format.type,'json_schema');assert.equal(format.strict,true);assert.equal(format.schema.additionalProperties,false);
 assert.deepEqual(format.schema.properties.answers.required,current.map(c=>c.id));assert.equal(format.schema.properties.answers.additionalProperties,false);
 assert.deepEqual(format.schema.properties.answers.properties.solution.properties.value.enum,[0,5,10,15,20,null]);assert.deepEqual(format.schema.properties.answers.properties.contact,undefined);assert.deepEqual(format.schema.properties.answers.properties['new-contact'].properties.value.enum,[true,false]);
 assert.ok(!('tools' in request));assert.ok(!('temperature' in request));assert.ok(!JSON.stringify(request).includes(env.OPENAI_API_KEY));assert.equal(JSON.parse(request.input[0].content[0].text).checklist.criteria[0].description,current[0].description);
 assert.match(request.instructions,/не присваивай оператору/i);assert.match(request.instructions,/3 минуты/);assert.match(request.instructions,/отсутствие совпадения не доказывает/i);
});
test('Strict semantic validation accepts permitted N/A and requires cited reviewed scope',async()=>{
 const p=await packet(),raw=fullAnswers();raw.answers.identity={value:null,reason:'Общий вопрос о тарифах не требовал защищённого действия.',evidence:[1,2],evidenceKind:'not_applicable'};
 const answers=validateAssessment(raw,p);assert.equal(answers.identity.value,null);assert.deepEqual(answers.identity.evidence,[1,2]);assert.notEqual(answers,raw.answers);
});
test('Validation rejects unknown/missing criteria, additional output and coercible values',async()=>{
 const p=await packet(),variants=[];
 let x=fullAnswers();delete x.answers.contact;variants.push(x);
 x=fullAnswers();x.answers.extra=x.answers.contact;variants.push(x);
 x=fullAnswers();x.finalScore=100;variants.push(x);
 x=fullAnswers();x.answers.contact.value='true';variants.push(x);
 x=fullAnswers();x.answers.solution.value='20';variants.push(x);
 x=fullAnswers();x.answers.solution.value=19;variants.push(x);
 x=fullAnswers();x.answers.contact.value=1;variants.push(x);
 x=fullAnswers();x.answers.contact.extra='ignore';variants.push(x);
 for(const raw of variants)assert.throws(()=>validateAssessment(raw,p),safeError('INVALID_ASSESSMENT',502));
});
test('Validation rejects illegal N/A, missing reasons, invented or duplicate evidence',async()=>{
 const p=await packet(),variants=[];
 for(const patch of [{value:null,evidenceKind:'not_applicable'},{reason:''},{reason:' '.repeat(10)},{evidence:[]},{evidence:[999]},{evidence:['2']},{evidence:[2,2]},{evidence:[2.1]},{evidenceKind:'not_applicable'},{evidenceKind:'guess'}]){const x=fullAnswers();Object.assign(x.answers.contact,patch);variants.push(x);}
 const wrongNA=fullAnswers();wrongNA.answers.identity.value=null;variants.push(wrongNA);
 for(const raw of variants)assert.throws(()=>validateAssessment(raw,p),safeError('INVALID_ASSESSMENT',502));
});
test('Assessment reprocesses raw conversation and computes score on server, preserving current snapshot',async()=>{
 const c=conversation(),current=rules();c.answers={contact:{value:false,reason:'OLD_VERDICT'}};c.audioUrl='https://private.invalid/?sig=SECRET_URL';c.packet={transcript:[{text:'FORGED_PACKET'}]};
 const raw=fullAnswers();raw.answers.management.value=7;raw.answers.critical.value=true;let calls=0;
 const result=await assessConversation(c,current,3,env,{fetcher:async(url,options)=>{
  calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+env.OPENAI_API_KEY);assert.ok(options.signal instanceof AbortSignal);
  const request=JSON.parse(options.body),input=request.input[0].content[0].text;assert.ok(!input.includes('private.person@example.com'));assert.ok(!input.includes('OLD_VERDICT'));assert.ok(!input.includes('SECRET_URL'));assert.ok(!input.includes('FORGED_PACKET'));assert.equal(JSON.parse(input).checklist.version,3);
  return responseFor(raw);
 }});
 assert.equal(calls,1);assert.equal(result.finalScore,95.5);assert.equal(result.critical,true);assert.equal(result.version,3);assert.equal(result.criteria.length,current.length);assert.notEqual(result.criteria,current);assert.match(result.sourceFingerprint,/^[0-9a-f]{64}$/);assert.match(result.checklistFingerprint,/^[0-9a-f]{64}$/);assert.equal(result.assessment.model,'gpt-5.4-2026-03-05');assert.equal(result.assessment.requestedModel,env.OPENAI_MODEL);assert.deepEqual(result.assessment.usage,{input_tokens:100,output_tokens:200,total_tokens:300});assert.ok(result.assessment.id.startsWith('ai-'));assert.ok(!JSON.stringify(result).includes(env.OPENAI_API_KEY));assert.equal(c.answers.contact.reason,'OLD_VERDICT');
});
test('A customized checklist controls output schema and final score without hardcoded eight-criterion assumptions',async()=>{
 const criteria=[{id:'followup',title:'Следующий шаг',description:'Есть понятный следующий шаг.',type:'scale',scale:[0,2,4],weight:30,allowNA:false,naRule:''},{id:'extra',title:'Применимость',description:'Дополнительная проверка.',type:'boolean',scale:[],weight:10,allowNA:true,naRule:'Вопрос не относится к этому процессу.'}];
 const raw={answers:{followup:{value:2,reason:'Дан частичный следующий шаг.',evidence:[2],evidenceKind:'present'},extra:{value:null,reason:'Запрос не относится к этому процессу.',evidence:[1],evidenceKind:'not_applicable'}}};
 const result=await assessConversation(conversation(),criteria,7,env,{fetcher:async()=>responseFor(raw)});assert.equal(result.finalScore,50);assert.equal(result.version,7);assert.equal(result.critical,false);assert.deepEqual(Object.keys(result.answers),['followup','extra']);
});
test('Missing key, invalid model and invalid transcript fail before any provider call',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return responseFor();};
 await assert.rejects(assessConversation(conversation(),rules(),1,{}, {fetcher}),safeError('OPENAI_NOT_CONFIGURED',503));
 await assert.rejects(assessConversation(conversation(),rules(),1,{...env,OPENAI_MODEL:'bad model'}, {fetcher}),safeError('INVALID_MODEL',400));
 const bad=conversation();bad.messages[1].role='assistant';await assert.rejects(assessConversation(bad,rules(),1,env,{fetcher}),safeError('PREPROCESS_BLOCKED',422));assert.equal(calls,0);
});
test('Authentication, access, quota and provider failures are safe and never silently retried',async()=>{
 for(const[status,code,expectedStatus]of [[401,'OPENAI_AUTH',401],[403,'OPENAI_ACCESS',403],[429,'OPENAI_LIMIT',429],[400,'OPENAI_REQUEST',502],[404,'OPENAI_REQUEST',502],[500,'OPENAI_UNAVAILABLE',502]]){
  let calls=0;await assert.rejects(assessConversation(conversation(),rules(),1,env,{fetcher:async()=>{calls++;return new Response('Secret raw provider details '+env.OPENAI_API_KEY,{status});}}),safeError(code,expectedStatus));assert.equal(calls,1);
 }
});
test('Network and timeout errors hide raw provider and transport details',async()=>{
 await assert.rejects(assessConversation(conversation(),rules(),1,env,{fetcher:async()=>{throw Error('Network failed for Bearer '+env.OPENAI_API_KEY);}}),safeError('OPENAI_NETWORK',502));
 await assert.rejects(assessConversation(conversation(),rules(),1,env,{fetcher:async()=>{const error=Error('Raw timeout '+env.OPENAI_API_KEY);error.name='AbortError';throw error;}}),safeError('OPENAI_TIMEOUT',504));
});
test('Refusal, incomplete responses and invalid JSON never become an assessment',async()=>{
 const cases=[
  ['MODEL_REFUSAL',422,()=>responseFor(undefined,{output:[{type:'message',content:[{type:'refusal',refusal:'Cannot assess '+env.OPENAI_API_KEY}]}]})],
  ['MODEL_INCOMPLETE',502,()=>responseFor(undefined,{status:'incomplete'})],
  ['INVALID_ASSESSMENT',502,()=>responseFor(undefined,{output:[{type:'message',content:[{type:'output_text',text:'{broken'}]}]})],
  ['INVALID_PROVIDER_RESPONSE',502,()=>new Response('not json')],
  ['EMPTY_ASSESSMENT',502,()=>responseFor(undefined,{output:[]})],
  ['INVALID_PROVIDER_RESPONSE',502,()=>responseFor(undefined,{status:'failed'})]
 ];
 for(const[code,status,make]of cases)await assert.rejects(assessConversation(conversation(),rules(),1,env,{fetcher:async()=>make()}),safeError(code,status));
});
test('Fabricated evidence and oversized provider output are rejected without saving partial results',async()=>{
 const invalid=fullAnswers();invalid.answers.contact.evidence=[999];await assert.rejects(assessConversation(conversation(),rules(),1,env,{fetcher:async()=>responseFor(invalid)}),safeError('INVALID_ASSESSMENT',502));
 await assert.rejects(assessConversation(conversation(),rules(),1,env,{fetcher:async()=>new Response('x',{headers:{'Content-Length':String(3*1024*1024)}})}),safeError('RESPONSE_TOO_LARGE',502));
});
