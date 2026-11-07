import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReference,createReferenceTemplate,exportReferenceBundle,importReferenceBundle,compareReferences,REFERENCE_SCHEMA,UNLABELED} from '../web/benchmark.js';
import {normalizeRecord} from '../web/timeline.js';
import {preprocessConversation} from '../web/preprocess.js';

const rules=()=>[
 {id:'greeting',title:'Приветствие',description:'Оператор поздоровался.',weight:60,type:'boolean',scale:[],allowNA:false,naRule:''},
 {id:'resolution',title:'Решение',description:'Полнота ответа.',weight:40,type:'scale',scale:[0,1,2],allowNA:true,naRule:'Запрос не сформулирован.'},
 {id:'critical',title:'Критическое нарушение',description:'Отдельный флаг.',weight:0,type:'flag',scale:[],allowNA:false,naRule:''}
];
const defaults=()=>({greeting:true,resolution:1,critical:false});
function conversation(extra={}){
 return Object.assign(normalizeRecord({conversation_id:'case-001',language:'RU',channel:'agent chat',transcript:[{speaker:'client',text:'Вопрос клиента, private transcript phrase.',timestamp:'00:00'},{speaker:'operator',text:'Здравствуйте! Полный ответ на вопрос.',timestamp:'00:10'}]},rules(),1,'WORK'),extra);
}
async function assessed(extra={},values=defaults()){
 const c=conversation(extra),{report}=await preprocessConversation(c,c.criteria,c.version);
 c.answers=Object.fromEntries(Object.entries(values).map(([id,value])=>[id,{value,reason:'PRIVATE_REASON',evidence:[2],evidenceKind:value===null?'not_applicable':'present'}]));
 c.sourceFingerprint=report.sourceFingerprint;c.checklistFingerprint=report.checklistFingerprint;
 c.assessment={id:'ai-run-1',provider:'openai',model:'test-model',createdAt:'2026-11-07T09:00:00.000Z',...extra.assessment};return c;
}
const reference=(c,values=defaults(),options={})=>createReference(c,c.criteria,c.version,values,options);
const bundle=records=>({schema:REFERENCE_SCHEMA,records});
const reason=report=>report.rows[0].reason;

test('Reference binds to canonical source/checklist hashes and exports only reference fields',async()=>{
 const c=await assessed({operator:'PRIVATE_OPERATOR',title:'PRIVATE_TITLE',audioUrl:'https://secret.invalid/audio'});
 const r=await reference(c,{greeting:false,resolution:null,critical:true},{kind:'ground_truth',label:'Проверено'});
 assert.equal(r.sourceFingerprint,c.sourceFingerprint);assert.equal(r.checklistFingerprint,c.checklistFingerprint);
 assert.deepEqual(r.answers,{greeting:false,resolution:null,critical:true});assert.equal(r.kind,'ground_truth');
 const exported=exportReferenceBundle([r]),serialized=JSON.stringify(exported);
 for(const secret of ['private transcript phrase','PRIVATE_OPERATOR','PRIVATE_TITLE','PRIVATE_REASON','secret.invalid','messages','evidence'])assert.ok(!serialized.includes(secret),secret);
 assert.deepEqual(await importReferenceBundle(serialized,[c]),[r]);
 exported.records[0].answers.greeting=true;assert.equal(r.answers.greeting,false);
});

test('Reference values require complete, strict primitive decisions; missing never becomes zero',async()=>{
 const c=conversation();
 for(const invalid of [
  {resolution:1,critical:false}, {...defaults(),extra:false}, {...defaults(),greeting:1}, {...defaults(),greeting:'true'},
  {...defaults(),greeting:null}, {...defaults(),resolution:true}, {...defaults(),resolution:'1'}, {...defaults(),resolution:3},
  {...defaults(),resolution:NaN}, {...defaults(),resolution:Infinity}, {...defaults(),critical:0}, {...defaults(),critical:null},
  {...defaults(),greeting:{value:true}}, {...defaults(),resolution:undefined}
 ])await assert.rejects(()=>reference(c,invalid));
 const r=await reference(c,{greeting:false,resolution:0,critical:false});assert.equal(r.answers.resolution,0);assert.equal(r.answers.greeting,false);
});

test('Template placeholders cannot accidentally pass as N/A or completed labels',async()=>{
 const c=conversation(),template=await createReferenceTemplate([c]);
 assert.equal(template.schema,REFERENCE_SCHEMA);assert.ok(Object.values(template.records[0].answers).every(value=>value===UNLABELED));
 await assert.rejects(()=>importReferenceBundle(template,[c]));
 template.records[0].answers={greeting:false,resolution:null,critical:false};
 assert.equal((await importReferenceBundle(template,[c]))[0].answers.resolution,null);
 await assert.rejects(()=>createReferenceTemplate([c,c]));
});

test('Bundle validation is atomic, detached, strict, and matches both source and conversation ID',async()=>{
 const c=conversation(),r=await reference(c),valid=bundle([r]),before=structuredClone(valid);
 const mutations=[
  b=>{b.schema='wrong';},b=>{b.transcript='secret';},b=>{b.records=[];},b=>{b.records.push(structuredClone(r));},
  b=>{b.records[0].conversationId='unknown';},b=>{b.records[0].source='OTHER';},b=>{b.records[0].sourceFingerprint='x';},
  b=>{b.records[0].answers.greeting=1;},b=>{b.records[0].transcript='secret';},b=>{delete b.records[0].label;},
  b=>{b.records[0].criteria[0].id='constructor';},b=>{b.records[0].criteria.push(structuredClone(b.records[0].criteria[0]));}
 ];
 for(const mutate of mutations){const invalid=structuredClone(valid);mutate(invalid);await assert.rejects(()=>importReferenceBundle(invalid,[c]));}
 const invalidSecond=structuredClone(r);invalidSecond.conversationId='case-002';
 await assert.rejects(()=>importReferenceBundle(bundle([r,invalidSecond]),[c]));
 assert.deepEqual(valid,before);assert.equal(c.answers,null);
 const imported=await importReferenceBundle(valid,[c]);imported[0].answers.greeting=false;assert.equal(r.answers.greeting,true);
 await assert.rejects(()=>importReferenceBundle('{',[c]));
});

test('Import rejects transcript edits and tampered checklist/version fingerprints',async()=>{
 const c=conversation(),r=await reference(c),changed=structuredClone(c);changed.messages[0].text+=' Updated';
 await assert.rejects(()=>importReferenceBundle(bundle([r]),[changed]),/устарел/);
 for(const mutate of [r=>{r.version=2;},r=>{r.criteria[0].weight=61;},r=>{r.checklistFingerprint='0'.repeat(64);},r=>{r.criteria[0].description+=' Changed';}]){
  const tampered=structuredClone(r);mutate(tampered);await assert.rejects(()=>importReferenceBundle(bundle([tampered]),[c]),/Отпечаток/);
 }
});

test('A future checklist reference imports independently but only compares with the same assessed checklist',async()=>{
 const c=conversation(),nextRules=rules();nextRules[0].weight=70;
 const r=await createReference(c,nextRules,2,defaults());
 assert.equal((await importReferenceBundle(bundle([r]),[c]))[0].version,2);
 assert.equal(reason(await compareReferences([c],[r])),'no_assessment');
 const candidate=await assessed();assert.equal(reason(await compareReferences([candidate],[r])),'checklist_mismatch');
});

test('Exact decisions, N/A applicability, critical flags and total MAE have independent denominators',async()=>{
 const c=await assessed(),r=await reference(c,{greeting:false,resolution:2,critical:true});
 const report=await compareReferences([c],[r]);
 assert.equal(report.coverage.compared,1);assert.equal(report.metrics.criteria.compared,2);assert.equal(report.metrics.criteria.matches,0);
 assert.equal(report.metrics.criteria.applicabilityCompared,1);assert.equal(report.metrics.criteria.applicabilityAccuracy,1);
 assert.equal(report.metrics.critical.compared,1);assert.equal(report.metrics.critical.falseNegative,1);assert.equal(report.metrics.critical.accuracy,0);
 assert.equal(report.metrics.critical.applicabilityCompared,0);assert.equal(report.metrics.critical.applicabilityAccuracy,null);
 assert.equal(report.rows[0].referenceScore,40);assert.equal(report.rows[0].candidateScore,80);assert.equal(report.metrics.totals.mae,40);
 assert.equal(report.criteria.length,2);assert.equal(report.flags.length,1);assert.equal(report.rows[0].criteria[0].applicabilityMatch,null);
 const na=await reference(c,{...defaults(),resolution:null});const naReport=await compareReferences([c],[na]);
 assert.equal(naReport.metrics.criteria.expectedNA,1);assert.equal(naReport.metrics.criteria.candidateNA,0);assert.equal(naReport.metrics.criteria.naMatches,0);
 assert.equal(naReport.metrics.criteria.applicabilityAccuracy,0);assert.equal(naReport.metrics.criteria.accuracy,.5);
});

test('Final comparison applies only active resolved appeals without mutating original candidate or reference',async()=>{
 const c=await assessed(),r=await reference(c,{...defaults(),greeting:false});
 const appeals=[
  {conversationId:c.id,criterionId:'greeting',assessmentId:c.assessment.id,status:'resolved',decision:false},
  {conversationId:c.id,criterionId:'greeting',assessmentId:'older-run',status:'resolved',decision:true},
  {conversationId:c.id,criterionId:'greeting',assessmentId:c.assessment.id,status:'resolved',archived:true,decision:true},
  {conversationId:c.id,criterionId:'resolution',assessmentId:c.assessment.id,status:'open',decision:0}
 ];
 const before=structuredClone({c,r,appeals}),original=await compareReferences([c],[r],appeals),final=await compareReferences([c],[r],appeals,{mode:'final'});
 assert.equal(original.metrics.criteria.accuracy,.5);assert.equal(final.metrics.criteria.accuracy,1);assert.equal(final.metrics.totals.mae,0);
 assert.match(final.label,/апелляций/);assert.deepEqual({c,r,appeals},before);
});

test('Missing, malformed or type-coerced candidate answers are excluded even when appeals could repair them',async()=>{
 const c=await assessed(),r=await reference(c);
 for(const mutate of [c=>{delete c.answers.greeting;},c=>{c.answers.greeting.value=1;},c=>{c.answers.resolution.value='1';},c=>{c.answers.critical.value=0;},c=>{c.answers.extra={value:false};}]){
  const bad=structuredClone(c);mutate(bad);
  const report=await compareReferences([bad],[r],[{conversationId:c.id,criterionId:'greeting',status:'resolved',decision:true}],{mode:'final'});
  assert.equal(reason(report),'invalid_assessment');assert.equal(report.metrics.criteria.compared,0);assert.equal(report.metrics.totals.mae,null);
 }
});

test('All-N/A and one-sided unavailable totals never become zero in MAE',async()=>{
 const criteria=rules();criteria[0].allowNA=true;criteria[0].naRule='Нет приветствия в доступной части.';
 const c=await assessed({criteria},{greeting:null,resolution:null,critical:false});const r=await reference(c,{greeting:null,resolution:null,critical:false});
 const report=await compareReferences([c],[r]);
 assert.equal(report.metrics.criteria.matches,2);assert.equal(report.metrics.criteria.naMatches,2);assert.equal(report.metrics.critical.matches,1);
 assert.equal(report.rows[0].candidateScore,null);assert.equal(report.rows[0].referenceScore,null);assert.equal(report.metrics.totals.compared,0);
 assert.equal(report.metrics.totals.excludedAllNA,1);assert.equal(report.metrics.totals.mae,null);
 const numeric=await reference(c,{greeting:true,resolution:2,critical:false}),oneSide=await compareReferences([c],[numeric]);
 assert.equal(oneSide.metrics.totals.compared,0);assert.equal(oneSide.metrics.totals.mae,null);assert.equal(oneSide.metrics.totals.excludedAllNA,1);
});

test('Stale source, stale candidate hash and mismatched checklist are reported without counting metrics',async()=>{
 const c=await assessed(),r=await reference(c),changed=structuredClone(c);changed.messages[0].text+=' edited';
 assert.equal(reason(await compareReferences([changed],[r])),'stale_reference');
 const currentReference=await reference(changed);assert.equal(reason(await compareReferences([changed],[currentReference])),'stale_assessment');
 const checklist=structuredClone(c);checklist.criteria[0].weight=70;
 assert.equal(reason(await compareReferences([checklist],[r])),'checklist_mismatch');
 const forged=structuredClone(r);forged.checklistFingerprint='0'.repeat(64);
 assert.equal(reason(await compareReferences([c],[forged])),'checklist_mismatch');
});

test('Production excludes every synthetic marker even if provider is spoofed; test scope is separately labelled',async()=>{
 for(const extra of [{source:'TEST'},{testMode:true},{demo:true},{source:'DEMO'},{assessment:{provider:'fixture'}}]){
  const c=await assessed(extra),r=await reference(c);assert.equal(r.kind,'test');
  const report=await compareReferences([c],[r]);assert.equal(reason(report),'excluded_scope');assert.equal(report.coverage.compared,0);
  const disguised=structuredClone(r);disguised.kind='ground_truth';await assert.rejects(()=>importReferenceBundle(bundle([disguised]),[c]),/Тестовые/);
 }
 const c=await assessed({source:'TEST',testMode:true,assessment:{id:'fixture-1',provider:'fixture',model:'deterministic-v1'}}),r=await reference(c);
 const report=await compareReferences([c],[r],[],{scope:'test'});assert.equal(report.coverage.compared,1);assert.equal(report.metrics.criteria.accuracy,1);
 assert.match(report.label,/не точность ИИ/);assert.equal(report.rows[0].provider,'fixture');assert.equal(report.rows[0].referenceKind,'test');
 const real=await assessed(),realReference=await reference(real);assert.equal(reason(await compareReferences([real],[realReference],[],{scope:'test'})),'excluded_scope');
 await assert.rejects(()=>reference(real,defaults(),{kind:'test'}));
});

test('Only genuine OpenAI provenance is eligible for production candidate statistics',async()=>{
 for(const provider of ['manual','legacy','other',undefined]){
  const c=await assessed({assessment:{provider}}),r=await reference(c),report=await compareReferences([c],[r]);
  assert.equal(reason(report),'unsupported_provenance');assert.equal(report.metrics.criteria.accuracy,null);
 }
});

test('Coverage distinguishes absent references, absent assessment, duplicate and orphan records',async()=>{
 const a=await assessed(),b=conversation({id:'case-002'}),c=await assessed({id:'case-003'}),rb=await reference(b),rc=await reference(c);
 const orphan=structuredClone(rc);orphan.conversationId='gone';
 const report=await compareReferences([a,b,c],[rb,rc,structuredClone(rc),orphan]);
 assert.equal(report.coverage.missingReference,1);assert.equal(report.coverage.withoutAssessment,1);
 assert.equal(report.coverage.reasons.duplicate_reference,1);assert.equal(report.coverage.reasons.missing_conversation,1);
 assert.equal(report.coverage.compared,0);assert.equal(report.coverage.skipped,4);assert.equal(report.metrics.totals.mae,null);
});

test('Async reference creation and comparison snapshot caller inputs before yielding',async()=>{
 const c=await assessed(),values=defaults(),criteria=structuredClone(c.criteria),options={label:'Before'};
 const pending=createReference(c,criteria,1,values,options);
 values.greeting=false;criteria[0].weight=70;options.label='After';c.messages[0].text='Edited during hash';c.id='changed-id';
 const r=await pending;assert.equal(r.conversationId,'case-001');assert.equal(r.answers.greeting,true);assert.equal(r.criteria[0].weight,60);assert.equal(r.label,'Before');
 const original=await assessed(),ref=await reference(original),comparison=compareReferences([original],[ref]);
 original.messages[0].text='Edited while comparing';original.answers.greeting.value=false;ref.answers.greeting=false;
 const report=await comparison;assert.equal(report.coverage.compared,1);assert.equal(report.metrics.criteria.accuracy,1);assert.equal(report.rows[0].criteria[0].reference,true);
});

test('Different versions of the same criterion remain separate in per-criterion statistics',async()=>{
 const first=await assessed(),second=await assessed({id:'case-002',version:2}),a=await reference(first),b=await reference(second);
 const report=await compareReferences([first,second],[a,b]);
 assert.equal(report.coverage.compared,2);assert.equal(report.criteria.length,4);assert.deepEqual([...new Set(report.criteria.map(c=>c.version))],[1,2]);
});

test('Production comparison accepts Groq and preserves Gemini/OpenAI eligibility',async()=>{
 for(const provider of ['groq','gemini','openai']){
  const c=await assessed({assessment:{provider}}),r=await reference(c),report=await compareReferences([c],[r]);
  assert.equal(report.coverage.compared,1);assert.equal(report.metrics.criteria.accuracy,1);assert.equal(report.rows[0].provider,provider);
 }
});
