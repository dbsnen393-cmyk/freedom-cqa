import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculate,demoConversations,initialCriteria} from '../web/domain.js';
import {preprocessConversation} from '../web/preprocess.js';
import {assessmentIdentity,effectiveAnswers,installAssessment} from '../web/assessment-state.js';
import {TEST_SCENARIOS,createTestAssessment,createTestConversation,createTestValues,isTestConversation} from '../web/offline-assessment.js';

function realConversation(){
 return {...structuredClone(demoConversations[0]),id:'real-case-001',source:'DATASET',demo:false,audioUrl:'https://recordings.invalid/audio?signature=do-not-copy',sourceFingerprint:'a'.repeat(64),checklistFingerprint:'b'.repeat(64),assessment:{id:'real-run',provider:'openai',model:'real-model',createdAt:'2026-11-07T09:00:00Z'},assessmentHistory:[{assessmentId:'old-real-run'}],previousAssessment:{assessmentId:'old-real-run'},finalAnswers:{stale:true},finalScore:100,apiKey:'not-a-real-key'};
}
const rules=()=>structuredClone(initialCriteria);

test('Dedicated test copies are isolated, marked synthetic and clear every prior result',()=>{
 const original=realConversation(),before=structuredClone(original),copy=createTestConversation(original),another=createTestConversation(original);
 assert.deepEqual(original,before);assert.notEqual(copy.id,original.id);assert.notEqual(copy.id,another.id);assert.match(copy.id,/^test-[a-f0-9-]+$/);
 assert.equal(copy.source,'TEST');assert.equal(copy.testMode,true);assert.equal(copy.demo,false);assert.equal(copy.originalConversationId,original.id);assert.equal(copy.originalSource,'DATASET');assert.match(copy.title,/^Учебный · /);
 assert.equal(copy.answers,null);assert.deepEqual(copy.assessmentHistory,[]);
 for(const field of ['audioUrl','apiKey','assessment','sourceFingerprint','checklistFingerprint','previousAssessment','finalAnswers','finalScore'])assert.equal(Object.hasOwn(copy,field),false,field+' must not carry into the copy');
 assert.equal(copy.messages[1].text,original.messages[1].text);assert.equal(copy.messages[1].id,original.messages[1].id);assert.equal(copy.messages[1].uid,copy.id+':M0002');
 copy.messages[1].text='Changed only in practice';copy.criteria[0].weight=99;assert.deepEqual(original,before);
 const nested=createTestConversation(copy);assert.equal(nested.originalConversationId,original.id);assert.equal(nested.originalSource,'DATASET');assert.equal(nested.title,copy.title);
});

test('Test classification survives any remaining explicit fixture label and excludes ordinary data',()=>{
 for(const c of [null,undefined,{},realConversation(),{source:'DATASET',testMode:'true'},{source:'DEMO',demo:true}])assert.equal(isTestConversation(c),false);
 for(const c of [{source:'TEST'},{source:'DATASET',testMode:true},{source:'DATASET',testMode:false,assessment:{provider:'fixture'}}])assert.equal(isTestConversation(c),true);
 const real=realConversation(),copy=createTestConversation(real);assert.deepEqual([real,copy].filter(c=>!isTestConversation(c)),[real]);
 assert.throws(()=>createTestConversation(null));assert.throws(()=>createTestConversation({id:'empty',messages:[]}));
});

test('Presets stay inside each rule and use actual scale values, with a changeable first boolean',()=>{
 const criteria=rules();criteria.find(c=>c.id==='solution').scale=[20,0,5,10];
 const before=structuredClone(criteria),mixed=createTestValues(criteria);
 assert.equal(mixed.contact,false);assert.equal(mixed.need,true);assert.equal(mixed.solution,5);assert.equal(mixed.critical,false);assert.ok(Object.values(mixed).every(value=>value!==null));
 assert.equal(createTestValues(criteria,'positive').solution,20);assert.equal(createTestValues(criteria,'positive').critical,false);
 assert.equal(createTestValues(criteria,'negative').solution,0);assert.equal(createTestValues(criteria,'negative').critical,true);
 const na=createTestValues(criteria,'not_applicable');for(const c of criteria)assert.equal(na[c.id]===null,c.allowNA);
 assert.deepEqual(criteria,before);assert.equal(TEST_SCENARIOS.length,4);assert.equal(Object.isFrozen(TEST_SCENARIOS),true);
 for(const invalid of [[],null,[{id:'bad',type:'scale',scale:[0,0],allowNA:false}],[{id:'bad',type:'scale',scale:[0,Infinity],allowNA:false}]])assert.throws(()=>createTestValues(invalid));
 assert.throws(()=>createTestValues(criteria,'unrecognized'));
});

test('A local assessment binds real hashes and evidence IDs without input changes or network calls',async()=>{
 const conversation=createTestConversation(realConversation()),criteria=rules(),before=structuredClone({conversation,criteria});
 const previousFetch=globalThis.fetch;let requests=0;globalThis.fetch=()=>{requests++;throw new Error('Network is forbidden in a fixture run');};
 try{
  const result=await createTestAssessment(conversation,criteria,2),prepared=await preprocessConversation(conversation,criteria,2);
  assert.deepEqual({conversation,criteria},before);assert.equal(requests,0);
  assert.equal(result.conversationId,conversation.id);assert.equal(result.sourceFingerprint,prepared.report.sourceFingerprint);assert.equal(result.checklistFingerprint,prepared.report.checklistFingerprint);assert.equal(result.version,2);
  assert.equal(result.assessment.provider,'fixture');assert.equal(result.assessment.model,'offline-fixture');assert.equal(result.assessment.testMode,true);assert.equal(result.testMode,true);assert.equal(result.assessment.scenario,'mixed');assert.equal(result.assessment.usage,undefined);
  assert.equal(result.finalScore,calculate(criteria,result.answers));assert.equal(result.critical,false);
  for(const a of Object.values(result.answers)){assert.match(a.reason,/Учебный синтетический/);assert.match(a.reason,/Смысл диалога не оценивался/);assert.match(a.reason,/ИИ не вызывался/);assert.ok(a.evidence.every(id=>conversation.messages.some(m=>m.id===id)));}
  installAssessment(conversation,result,[]);assert.equal(conversation.assessment.id,result.assessment.id);assert.equal(conversation.assessment.reviewed,false);assert.deepEqual(conversation.assessmentHistory,[]);
 }finally{globalThis.fetch=previousFetch;}
});

test('All presets and customized decisions install through the same validated workflow',async()=>{
 const c=createTestConversation(realConversation()),criteria=rules();
 for(const scenario of TEST_SCENARIOS){const result=await createTestAssessment(c,criteria,1,{scenario:scenario.id});installAssessment(c,result,[]);assert.equal(c.assessment.provider,'fixture');}
 const values=createTestValues(criteria),evidence={contact:[1,2]};values.contact=true;values.solution=15;values.identity=null;
 const before=structuredClone({values,evidence});const result=await createTestAssessment(c,criteria,1,{values,evidence});
 assert.equal(result.answers.contact.value,true);assert.equal(result.answers.solution.value,15);assert.equal(result.answers.identity.value,null);assert.equal(result.answers.identity.evidenceKind,'not_applicable');assert.deepEqual(result.answers.contact.evidence,[1,2]);assert.equal(result.assessment.scenario,'custom');
 result.answers.contact.evidence.push(3);assert.deepEqual({values,evidence},before);
});

test('Real conversations, invalid rules, custom values and evidence are rejected without mutation',async()=>{
 const real=realConversation(),original=structuredClone(real);await assert.rejects(createTestAssessment(real,rules(),1),/копии TEST/);assert.deepEqual(real,original);
 const c=createTestConversation(real),before=structuredClone(c),criteria=rules();
 for(const mutate of [values=>delete values.contact,values=>values.extra=true,values=>values.contact=null,values=>values.contact='false',values=>values.solution='10',values=>values.solution=11,values=>values.critical=0]){
  const values=createTestValues(criteria);mutate(values);await assert.rejects(createTestAssessment(c,criteria,1,{values}));assert.deepEqual(c,before);
 }
 for(const evidence of [{unknown:[1]},{contact:[]},{contact:[999]},{contact:[1,1]},{contact:['2']},{contact:null},null])await assert.rejects(createTestAssessment(c,criteria,1,{evidence}));
 await assert.rejects(createTestAssessment(c,criteria,0));await assert.rejects(createTestAssessment(c,[],1));await assert.rejects(createTestAssessment(c,criteria,1,{scenario:'invented'}));
 const invalid=rules();invalid[1].naRule='';await assert.rejects(createTestAssessment(c,invalid,1));
 await assert.rejects(createTestAssessment({...c,messages:c.messages.filter(m=>m.role!=='operator')},criteria,1));
 assert.deepEqual(c,before);
});

test('Full offline flow: evidence, appeal, changed score, rerun history and real-source isolation',async()=>{
 const real=realConversation(),realBefore=structuredClone(real),c=createTestConversation(real),criteria=rules();
 const realAppeal={id:'real-appeal',conversationId:real.id,assessmentId:real.assessment.id,criterionId:'contact',status:'resolved',decision:false};
 const appeals=[structuredClone(realAppeal)];const first=await createTestAssessment(c,criteria,1);installAssessment(c,first,appeals);
 const evidence=first.answers.contact.evidence.map(id=>c.messages.find(message=>message.id===id));assert.ok(evidence.length&&evidence.every(Boolean));
 const originalScore=calculate(c.criteria,c.answers),runId=assessmentIdentity(c);
 appeals.push({id:'test-appeal',conversationId:c.id,assessmentId:runId,criterionId:'contact',status:'resolved',decision:true,reason:'Проверка учебного пересмотра.'});
 assert.equal(c.answers.contact.value,false);assert.equal(effectiveAnswers(c,appeals).contact.value,true);assert.ok(calculate(c.criteria,effectiveAnswers(c,appeals))>originalScore);
 const second=await createTestAssessment(c,criteria,2,{scenario:'positive'});assert.notEqual(first.assessment.id,second.assessment.id);installAssessment(c,second,appeals);
 assert.equal(appeals[1].status,'archived');assert.equal(appeals[1].assessmentId,runId);assert.deepEqual(appeals[0],realAppeal);
 const history=c.assessmentHistory[0];assert.equal(history.assessmentId,runId);assert.equal(history.assessment.provider,'fixture');assert.equal(history.answers.contact.value,false);assert.equal(history.finalAnswers.contact.value,true);assert.deepEqual(history.conversation.messages,c.messages);assert.equal(history.version,1);assert.equal(c.version,2);
 assert.equal(calculate(c.criteria,effectiveAnswers(c,appeals)),100);assert.deepEqual(real,realBefore);
});

test('Async source and option snapshots cannot be changed while fingerprints are calculated',async()=>{
 const c=createTestConversation(realConversation()),criteria=rules(),values=createTestValues(criteria),evidence={contact:[2]},before=structuredClone({c,criteria});
 const pending=createTestAssessment(c,criteria,1,{values,evidence});c.messages[1].text='Edited during the run';criteria[0].weight=1000;values.contact=true;evidence.contact[0]=999;
 const result=await pending,expected=await preprocessConversation(before.c,before.criteria,1);
 assert.equal(result.sourceFingerprint,expected.report.sourceFingerprint);assert.equal(result.checklistFingerprint,expected.report.checklistFingerprint);assert.equal(result.criteria[0].weight,before.criteria[0].weight);assert.equal(result.answers.contact.value,false);assert.deepEqual(result.answers.contact.evidence,[2]);
});

test('Installation rejects synthetic results on a real conversation even with its exact ID',async()=>{
 const real=realConversation(),practice=createTestConversation(real),fixture=await createTestAssessment(practice,rules(),1);
 for(const mutate of [
  result=>{},
  result=>{delete result.testMode;delete result.assessment.testMode;},
  result=>{result.assessment.provider='openai';delete result.testMode;},
  result=>{result.assessment.provider='openai';delete result.assessment.testMode;}
 ]){
  const result=structuredClone(fixture);result.conversationId=real.id;mutate(result);
  const appeals=[{conversationId:real.id,assessmentId:real.assessment.id,criterionId:'contact',status:'resolved',decision:false}],before=structuredClone({real,appeals});
  assert.throws(()=>installAssessment(real,result,appeals),/не соответствует/);assert.deepEqual({real,appeals},before);
 }
});

test('Installation rejects OpenAI results on all explicit TEST target forms',async()=>{
 const practice=createTestConversation(realConversation()),fixture=await createTestAssessment(practice,rules(),1);
 const providerResult=structuredClone(fixture);providerResult.assessment.provider='openai';delete providerResult.assessment.testMode;delete providerResult.testMode;
 for(const mutate of [
  target=>{},
  target=>{target.source='DATASET';},
  target=>{target.source='DATASET';target.testMode=false;target.assessment={provider:'fixture'};}
 ]){
  const target=structuredClone(practice);mutate(target);const before=structuredClone(target);
  assert.throws(()=>installAssessment(target,providerResult,[]),/не соответствует/);assert.deepEqual(target,before);
 }
 const disguised=structuredClone(fixture);disguised.assessment.provider='openai';
 assert.throws(()=>installAssessment(practice,disguised,[]),/не соответствует/);
});
