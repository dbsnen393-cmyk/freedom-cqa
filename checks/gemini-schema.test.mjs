import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessConversation,buildAssessmentRequest} from '../worker/assessment.mjs';
import {callGemini,createGeminiLimiter} from '../worker/gemini.mjs';
import {preprocessConversation} from '../web/preprocess.js';
import {initialCriteria} from '../web/domain.js';
import {installAssessment} from '../web/assessment-state.js';
import {qualityFixtures} from './fixtures/ai-quality.mjs';

const fixture=qualityFixtures[0],env={GEMINI_API_KEY:'schema-tests-never-live'};
const providerResponse=raw=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(raw)}]}}]});
const fields=['value','reason','evidence','evidenceKind'];

for(const {name,type,allowNA,expected} of [
 {name:'boolean without N/A',type:'boolean',allowNA:false,expected:{type:'boolean'}},
 {name:'boolean with N/A',type:'boolean',allowNA:true,expected:{type:'boolean'}},
 {name:'scale without N/A',type:'scale',allowNA:false,expected:{type:'number',enum:[0,5,10,15,20]}},
 {name:'scale with N/A',type:'scale',allowNA:true,expected:{type:'number',enum:[0,5,10,15,20]}}
])test('Gemini wire schema: '+name,async()=>{
 const rule={id:'custom',title:'Критерий',description:'Тестовый критерий.',weight:100,type,scale:type==='scale'?[0,5,10,15,20]:[],allowNA,naRule:allowNA?'Общий вопрос.':''};
 const values=type==='boolean'?[true,false]:[0,5,10,15,20];if(allowNA)values.push(null);
 for(const value of values){
  const raw={answers:{custom:{value,reason:'Синтетическое обоснование.',evidence:[1,2],evidenceKind:value===null?'not_applicable':'present'}}};
  const result=await assessConversation(fixture.conversation,[rule],1,env,{limiter:createGeminiLimiter(),fetcher:async(url,init)=>{
   const config=JSON.parse(init.body).generationConfig,schema=config.responseJsonSchema,answer=schema.properties.answers.properties.custom;
   assert.equal(config.responseMimeType,'application/json');assert.deepEqual(answer.anyOf[0].properties.value,expected);
   assert.equal(answer.anyOf.length,allowNA?2:1);
   assert.deepEqual(schema.required,['answers']);assert.equal(schema.additionalProperties,false);
   assert.deepEqual(schema.properties.answers.required,['custom']);assert.equal(schema.properties.answers.additionalProperties,false);
   for(const branch of answer.anyOf){assert.deepEqual(branch.required,fields);assert.deepEqual(Object.keys(branch.properties),fields);assert.equal(branch.additionalProperties,false);assert.equal(branch.properties.evidence.minItems,1);}
   assert.deepEqual(answer.anyOf[0].properties.evidenceKind.enum,['present','absence']);
   if(allowNA){assert.deepEqual(answer.anyOf[1].properties.value,{type:'null'});assert.deepEqual(answer.anyOf[1].properties.evidenceKind.enum,['not_applicable']);}
   return providerResponse(raw);
  }});
  assert.deepEqual(result.answers,raw.answers);assert.equal(result.answers.custom.value,value);
 }
});

test('Gemini sends all eight criteria and preserves shared schema and UI result contract',async()=>{
 const packet=(await preprocessConversation(fixture.conversation,initialCriteria,1)).packet;
 const request=buildAssessmentRequest(packet),original=structuredClone(request);
 let wire;
 await callGemini(env,request,{limiter:createGeminiLimiter(),fetcher:async(url,init)=>{wire=JSON.parse(init.body).generationConfig.responseJsonSchema;return providerResponse(fixture.gold);}});
 assert.equal(JSON.stringify(request),JSON.stringify(original)); // Preserve the shared request, including boolean enums.
 assert.deepEqual(wire.properties.answers.required,initialCriteria.map(c=>c.id));
 for(const rule of initialCriteria){
  const answer=wire.properties.answers.properties[rule.id],value=answer.anyOf[0].properties.value;
  assert.equal(answer.anyOf.length,rule.allowNA?2:1);
  for(const branch of answer.anyOf){
   assert.deepEqual(branch.required,fields);assert.deepEqual(Object.keys(branch.properties),fields);assert.equal(branch.additionalProperties,false);
   assert.equal(branch.properties.reason.type,'string');assert.match(branch.properties.reason.description,/Непустое/);
   assert.deepEqual(branch.properties.evidence,original.text.format.schema.properties.answers.properties[rule.id].properties.evidence);
  }
  assert.deepEqual(answer.anyOf[0].properties.evidenceKind.enum,['present','absence']);
  if(rule.allowNA){assert.deepEqual(answer.anyOf[1].properties.value,{type:'null'});assert.deepEqual(answer.anyOf[1].properties.evidenceKind.enum,['not_applicable']);}
  if(rule.type==='scale')assert.deepEqual(value,{type:'number',enum:rule.scale});
  else assert.deepEqual(value,{type:'boolean'});
 }
 // Walk schema nodes, not property names: criterion IDs are unrestricted data.
 const allowed=new Set(['type','properties','required','additionalProperties','description','enum','items','minItems','anyOf']);
 function check(node){
  for(const key of Object.keys(node))assert.ok(allowed.has(key),'Unsupported schema keyword: '+key);
  if(node.enum){assert.ok(!node.enum.includes(null));assert.ok(node.enum.every(v=>typeof v==='number'||typeof v==='string'));}
  if(node.properties)for(const child of Object.values(node.properties))check(child);
  if(node.items)check(node.items);if(node.anyOf)node.anyOf.forEach(check);
 }
 check(wire);
 const result=await assessConversation(fixture.conversation,initialCriteria,1,env,{limiter:createGeminiLimiter(),fetcher:async()=>providerResponse(fixture.gold)});
 assert.deepEqual(Object.keys(result).sort(),['conversationId','answers','criteria','version','sourceFingerprint','checklistFingerprint','finalScore','critical','assessment'].sort());
 assert.deepEqual(result.answers,fixture.gold.answers);assert.equal(result.finalScore,100);
 const conversation=structuredClone(fixture.conversation);installAssessment(conversation,result,[]);
 assert.deepEqual(conversation.answers,result.answers);assert.equal(conversation.assessment.provider,'gemini');
});

for(const [name,mutate] of [
 ['true with not_applicable',raw=>{raw.answers.need.value=true;raw.answers.need.evidenceKind='not_applicable';}],
 ['null with present',raw=>{raw.answers.need.value=null;raw.answers.need.evidenceKind='present';}],
 ['empty reason',raw=>{raw.answers.need.reason='   ';}],
 ['empty evidence',raw=>{raw.answers.need.evidence=[];}],
 ['string boolean',raw=>{raw.answers.contact.value='true';}],
 ['numeric boolean',raw=>{raw.answers.contact.value=1;}],
 ['out-of-scale number',raw=>{raw.answers.solution.value=17;}],
 ['forbidden N/A',raw=>{raw.answers.contact.value=null;raw.answers.contact.evidenceKind='not_applicable';}],
 ['unknown evidence ID',raw=>{raw.answers.contact.evidence=[999999];}],
 ['extra field',raw=>{raw.answers.contact.extra=true;}]
])test('Gemini schema regression: server rejects '+name,async()=>{
 const raw=structuredClone(fixture.gold);mutate(raw);
 await assert.rejects(assessConversation(fixture.conversation,initialCriteria,1,env,{limiter:createGeminiLimiter(),fetcher:async()=>providerResponse(raw)}),error=>error.code==='INVALID_ASSESSMENT'&&error.status===502);
});

// Minimal evaluator for the exact documented subset emitted here. This checks
// cross-field constraints on actual wire schemas, independently of server validation.
function matchesSchema(schema,value){
 if(schema.anyOf&&!schema.anyOf.some(branch=>matchesSchema(branch,value)))return false;
 if(schema.type){
  const valid={object:value!==null&&typeof value==='object'&&!Array.isArray(value),array:Array.isArray(value),boolean:typeof value==='boolean',number:typeof value==='number'&&Number.isFinite(value),integer:Number.isSafeInteger(value),string:typeof value==='string',null:value===null};
  if(!valid[schema.type])return false;
 }
 if(schema.enum&&!schema.enum.includes(value))return false;
 if(schema.type==='object'){
  if(schema.required?.some(key=>!Object.hasOwn(value,key)))return false;
  if(schema.additionalProperties===false&&Object.keys(value).some(key=>!Object.hasOwn(schema.properties,key)))return false;
  if(Object.entries(schema.properties||{}).some(([key,child])=>Object.hasOwn(value,key)&&!matchesSchema(child,value[key])))return false;
 }
 if(schema.type==='array'&&(value.length<(schema.minItems||0)||value.some(item=>!matchesSchema(schema.items,item))))return false;
 return true;
}

test('Gemini wire branches reject contradictory fields, wrong types and incomplete answers',async()=>{
 const packet=(await preprocessConversation(fixture.conversation,initialCriteria,1)).packet;
 let schema;await callGemini(env,buildAssessmentRequest(packet),{limiter:createGeminiLimiter(),fetcher:async(url,init)=>{schema=JSON.parse(init.body).generationConfig.responseJsonSchema;return providerResponse(fixture.gold);}});
 assert.equal(matchesSchema(schema,fixture.gold),true);
 for(const rule of initialCriteria){
  const answer=schema.properties.answers.properties[rule.id];
  const values=rule.type==='scale'?rule.scale:[true,false];
  for(const value of values)for(const kind of ['present','absence'])assert.equal(matchesSchema(answer,{value,reason:'Основание.',evidence:[1],evidenceKind:kind}),true);
  assert.equal(matchesSchema(answer,{value:null,reason:'Основание.',evidence:[1],evidenceKind:'not_applicable'}),rule.allowNA);
  const validValue=values[0];
  for(const invalid of [
   {value:validValue,reason:'Основание.',evidence:[1],evidenceKind:'not_applicable'},
   {value:null,reason:'Основание.',evidence:[1],evidenceKind:'present'},
   {value:null,reason:'Основание.',evidence:[1],evidenceKind:'absence'},
   {value:'true',reason:'Основание.',evidence:[1],evidenceKind:'present'},
   {value:validValue,reason:'Основание.',evidence:[],evidenceKind:'present'},
   {value:validValue,reason:'Основание.',evidence:['1'],evidenceKind:'present'},
   {value:validValue,evidence:[1],evidenceKind:'present'},
   {value:validValue,reason:'Основание.',evidence:[1],evidenceKind:'present',extra:1}
  ])assert.equal(matchesSchema(answer,invalid),false,rule.id+' should reject '+JSON.stringify(invalid));
  if(rule.type==='scale')assert.equal(matchesSchema(answer,{value:999,reason:'Основание.',evidence:[1],evidenceKind:'present'}),false);
 }
});

test('Dynamic Gemini checklist uses edited IDs, scales, applicability and weights with unchanged result contract',async()=>{
 const criteria=[
  {id:'management',title:'Следующий шаг',description:'0 — отсутствует; 2 — частично; 4 — полностью.',type:'scale',scale:[0,2,4],weight:30,allowNA:true,naRule:'Клиент не запрашивал продолжения.'},
  {id:'need',title:'Контроль',description:'Новый логический критерий.',type:'boolean',scale:[],weight:10,allowNA:false,naRule:''},
  {id:'custom-flag',title:'Особый флаг',description:'Наличие особого события.',type:'flag',scale:[],weight:0,allowNA:false,naRule:''}
 ];
 for(const [scaleValue,expectedScore] of [[2,62.5],[null,100]]){
  const raw={answers:{management:{value:scaleValue,reason:'Основание по новому правилу.',evidence:[2],evidenceKind:scaleValue===null?'not_applicable':'present'},need:{value:true,reason:'Новое условие выполнено.',evidence:[2],evidenceKind:'present'},'custom-flag':{value:true,reason:'Особое событие обнаружено.',evidence:[2],evidenceKind:'present'}}};
  const output=await assessConversation(fixture.conversation,criteria,17,env,{limiter:createGeminiLimiter(),fetcher:async(url,init)=>{
   const body=JSON.parse(init.body),schema=body.generationConfig.responseJsonSchema;
   assert.deepEqual(schema.properties.answers.required,criteria.map(c=>c.id));assert.equal(matchesSchema(schema,raw),true);
   assert.deepEqual(schema.properties.answers.properties.management.anyOf[0].properties.value,{type:'number',enum:[0,2,4]});
   assert.equal(schema.properties.answers.properties.need.anyOf.length,1);
   assert.doesNotMatch(body.systemInstruction.parts[0].text,/ступень 4 требует|Если уточнение необходимо/);
   assert.equal(JSON.parse(body.contents[0].parts[0].text).checklist.version,17);
   return providerResponse(raw);
  }});
  assert.deepEqual(output.answers,raw.answers);assert.equal(output.finalScore,expectedScore);assert.equal(output.critical,true);assert.equal(output.version,17);
 }
});
