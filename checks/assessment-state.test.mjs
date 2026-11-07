import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessmentIdentity,effectiveAnswers,installAssessment} from '../web/assessment-state.js';
import {calculate} from '../web/domain.js';
const criterion={id:'contact',title:'Контакт',description:'Оператор поздоровался.',type:'boolean',scale:[],weight:10,allowNA:false,naRule:''};
const answer=value=>({value,reason:'Основание в реплике оператора.',evidence:[2],evidenceKind:value?'present':'absence'});
const fingerprint=n=>n.toString(16).padStart(64,'0');
function conversation(extra={}){return {id:'case-001',language:'RU',channel:'agent chat',messages:[{id:1,role:'client',text:'Здравствуйте.'},{id:2,role:'operator',text:'Здравствуйте.'}],answers:{contact:answer(true)},criteria:[structuredClone(criterion)],version:1,demo:true,...extra};}
function result(index=1,value=true){return {conversationId:'case-001',answers:{contact:answer(value)},criteria:[structuredClone(criterion)],version:index+1,sourceFingerprint:fingerprint(1),checklistFingerprint:fingerprint(index+1),finalScore:value?100:0,critical:false,assessment:{id:'ai-run-'+index,provider:'openai',model:'gpt-5.4',requestedModel:'gpt-5.4',promptVersion:'cqa-assessment-1.0',createdAt:new Date(Date.UTC(2026,0,1)+index*1000).toISOString(),responseId:'resp_fixture_'+index,usage:{input_tokens:10,output_tokens:20,total_tokens:30}}};}

test('Run identity uses current assessment ID or stable demo/legacy identity',()=>{
 const c=conversation();assert.equal(assessmentIdentity(c),assessmentIdentity(structuredClone(c)));assert.match(assessmentIdentity(c),/^demo:/);
 c.demo=false;assert.match(assessmentIdentity(c),/^legacy:/);c.assessment={id:'ai-exact-id'};assert.equal(assessmentIdentity(c),'ai-exact-id');
 assert.equal(assessmentIdentity(conversation({answers:null})),null);
});

test('Resolved appeals apply only to the current conversation and assessment, leaving original answers untouched',()=>{
 const c=conversation({assessment:{id:'ai-current'}}),before=structuredClone(c);
 const appeals=[{conversationId:c.id,assessmentId:'ai-stale',criterionId:'contact',status:'resolved',decision:false},{conversationId:'another',assessmentId:'ai-current',criterionId:'contact',status:'resolved',decision:false}];
 assert.equal(effectiveAnswers(c,appeals).contact.value,true);
 appeals.push({conversationId:c.id,assessmentId:'ai-current',criterionId:'contact',status:'resolved',decision:false});
 const effective=effectiveAnswers(c,appeals);assert.equal(effective.contact.value,false);assert.deepEqual(c,before);effective.contact.reason='Changed outside';assert.notEqual(c.answers.contact.reason,effective.contact.reason);
});

test('Unarchived legacy decisions remain supported while archived and invalid decisions are ignored',()=>{
 const c=conversation();const legacy={conversationId:c.id,criterionId:'contact',status:'resolved',decision:false};
 assert.equal(effectiveAnswers(c,[legacy]).contact.value,false);
 for(const appeal of [{...legacy,status:'archived'},{...legacy,archivedAt:'2026-01-01T00:00:00Z'},{...legacy,archivedReason:'Old input'},{...legacy,decision:null},{...legacy,decision:999},{...legacy,assessmentId:null}])assert.equal(effectiveAnswers(c,[appeal]).contact.value,true);
 assert.equal(effectiveAnswers(conversation({answers:null}),[legacy]),null);
});

test('Installing a new run archives old appeals and preserves both original and final old answers',()=>{
 const c=conversation({sourceFingerprint:fingerprint(1),checklistFingerprint:fingerprint(1),transcriptChanged:true});const oldId=assessmentIdentity(c);
 const appeals=[{id:'resolved',conversationId:c.id,criterionId:'contact',status:'resolved',decision:false,reason:'Ручной пересмотр.'},{id:'open',conversationId:c.id,criterionId:'contact',status:'open',comment:'Проверить.'},{id:'other',conversationId:'another',status:'open'}];
 const incoming=result();const installed=installAssessment(c,incoming,appeals);assert.equal(installed,c);
 assert.equal(c.answers.contact.value,true);assert.equal(c.assessment.id,incoming.assessment.id);assert.equal(c.assessment.reviewed,false);assert.equal(c.transcriptChanged,false);assert.equal(c.version,incoming.version);
 assert.equal(c.sourceFingerprint,incoming.sourceFingerprint);assert.equal(c.checklistFingerprint,incoming.checklistFingerprint);
 assert.equal(c.assessmentHistory.length,1);const previous=c.assessmentHistory[0];assert.equal(previous.assessmentId,oldId);assert.equal(previous.answers.contact.value,true);assert.equal(previous.finalAnswers.contact.value,false);assert.equal(previous.criteria[0].title,'Контакт');assert.equal(previous.version,1);assert.equal(previous.archivedAt,incoming.assessment.createdAt);
 assert.equal(appeals[0].status,'archived');assert.equal(appeals[0].previousStatus,'resolved');assert.equal(appeals[0].assessmentId,oldId);assert.ok(appeals[0].archiveReason);assert.equal(appeals[1].previousStatus,'open');assert.equal(appeals[2].status,'open');
 assert.equal(calculate(c.criteria,effectiveAnswers(c,appeals)),100);
 incoming.answers.contact.value=false;incoming.criteria[0].title='Mutated response';incoming.assessment.usage.total_tokens=999;assert.equal(c.answers.contact.value,true);assert.equal(c.criteria[0].title,'Контакт');assert.equal(c.assessment.usage.total_tokens,30);
});

test('History preserves metadata, rubric, fingerprints and a reviewed state from the old AI run',()=>{
 const c=conversation({answers:null});const first=result(1,false);installAssessment(c,first,[]);c.assessment.reviewed=true;
 installAssessment(c,result(2,true),[]);const previous=c.assessmentHistory[0];assert.equal(previous.assessment.id,first.assessment.id);assert.equal(previous.assessment.provider,'openai');assert.equal(previous.assessment.model,'gpt-5.4');assert.equal(previous.assessment.reviewed,true);assert.equal(previous.createdAt,first.assessment.createdAt);assert.equal(previous.sourceFingerprint,first.sourceFingerprint);assert.equal(previous.checklistFingerprint,first.checklistFingerprint);assert.equal(previous.answers.contact.value,false);assert.equal(c.assessment.reviewed,false);
});

test('Invalid or mismatched responses never mutate conversation, history or appeals',()=>{
 const edits=[r=>r.conversationId='wrong',r=>r.answers.contact.value=999,r=>r.answers.contact.evidence=[999],r=>r.criteria=[],r=>r.criteria.push(structuredClone(r.criteria[0])),r=>r.sourceFingerprint='invalid',r=>r.version=0,r=>r.assessment.id='',r=>r.assessment.createdAt='not-a-date',r=>r.answers.extra=answer(true),r=>r.answers.contact.evidenceKind='not_applicable'];
 for(const edit of edits){const c=conversation(),appeals=[{conversationId:c.id,criterionId:'contact',status:'resolved',decision:false}];const before=structuredClone({c,appeals}),incoming=result();edit(incoming);assert.throws(()=>installAssessment(c,incoming,appeals));assert.deepEqual({c,appeals},before);}
});

test('Duplicate delivery is idempotent and does not archive appeals created for that run',()=>{
 const c=conversation({answers:null}),incoming=result();const appeals=[];installAssessment(c,incoming,appeals);appeals.push({conversationId:c.id,assessmentId:incoming.assessment.id,criterionId:'contact',status:'resolved',decision:false});
 const before=structuredClone({c,appeals});installAssessment(c,structuredClone(incoming),appeals);assert.deepEqual({c,appeals},before);
 const conflicting=structuredClone(incoming);conflicting.answers.contact.value=false;conflicting.answers.contact.evidenceKind='absence';assert.throws(()=>installAssessment(c,conflicting,appeals));assert.deepEqual({c,appeals},before);
});

test('History retention is bounded to 20 snapshots while latest originals remain distinct',()=>{
 const c=conversation({answers:null});for(let n=1;n<=25;n++)installAssessment(c,result(n,n%2===0),[]);
 assert.equal(c.assessmentHistory.length,20);assert.equal(c.assessmentHistory[0].assessment.id,'ai-run-5');assert.equal(c.assessmentHistory.at(-1).assessment.id,'ai-run-24');assert.equal(c.assessment.id,'ai-run-25');
 c.answers.contact.value=true;assert.equal(c.assessmentHistory.at(-1).answers.contact.value,true);c.assessmentHistory.at(-1).criteria[0].title='Old title';assert.equal(c.criteria[0].title,'Контакт');
});
