import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSubmission,validateSubmission} from '../web/submission.js';
const internal=['contact','need','identity','solution','empathy','management','closing','critical'];
const official=['contact','discovery','identification','consultation','empathy','dialogue','closure','critical'];
function record(id='original-001'){return {conversation_id:id,language:'RU',channel:'agent chat',audio_url:'https://secret.invalid/?token=PRIVATE_AUDIO',transcript:['system','bot','client','operator','operator','client','system','operator'].map((speaker,index)=>({speaker,timestamp:'00:0'+index,text:'PRIVATE_SOURCE_TEXT_'+index}))};}
function assessment(id='original-001',values=[true,null,null,15,true,7,true,false]){return {conversationId:id,answers:Object.fromEntries(internal.map((key,index)=>[key,{value:values[index],reason:'Краткое основание '+index,evidence:index===7?[4,5,6,8]:[index===0?4:1],evidenceKind:values[index]===null?'not_applicable':'present'}])),criteria:internal.map(id=>({id,weight:999})),finalScore:-999,critical:true,assessment:{model:'actual-model-2026',requestedModel:'requested-model',responseId:'PRIVATE_RESPONSE_ID'},apiKey:'PRIVATE_KEY'};}
function build(records=[record()],assessments=new Map([[records[0].conversation_id,assessment(records[0].conversation_id)]]),extra={}){return buildSubmission({teamName:'Команда',modelName:'requested-model',records,assessments,...extra});}

test('Official appendix example maps eight IDs and recomputes 85.38 with N/A and weighted dialogue',()=>{
 const records=[record()],result=assessment(),before=structuredClone({records,result});const out=build(records,{[records[0].conversation_id]:result});
 assert.equal(out.schema_version,'1.0');assert.deepEqual(out.model,{mode:'external_api',name:'actual-model-2026'});
 assert.deepEqual(out.results[0].criteria.map(c=>c.criterion_id),official);assert.deepEqual(out.results[0].score,{final_score:85.38,critical_flag:false});
 assert.deepEqual(out.results[0].criteria[0].evidence_turns,[4],'includes preceding system, bot and client turns');assert.deepEqual(out.results[0].criteria[7].evidence_turns,[4,5,6,8]);
 assert.equal(validateSubmission(JSON.parse(JSON.stringify(out)),{records}),true);assert.deepEqual({records,result},before);
 const json=JSON.stringify(out);for(const secret of ['PRIVATE_SOURCE_TEXT','PRIVATE_AUDIO','PRIVATE_KEY','PRIVATE_RESPONSE_ID','audio_url','requestedModel','evidenceKind'])assert.ok(!json.includes(secret));
 out.results[0].criteria[0].evidence_turns.push(8);assert.deepEqual(result.answers.contact.evidence,[4]);
});

test('Critical flag does not zero score; management 7/10 contributes 10.5 of 15',()=>{
 const result=assessment('original-001',[true,true,true,20,true,7,true,true]);const out=build([record()],new Map([['original-001',result]]));
 assert.deepEqual(out.results[0].score,{final_score:95.5,critical_flag:true});
});

test('Failures and missing runs preserve every original ID without copying sensitive errors',()=>{
 const records=[record('a'),record('b'),record('c')],error=Object.assign(Error('PRIVATE_KEY raw transcript PRIVATE_SOURCE_TEXT'),{code:'OPENAI_TIMEOUT'});
 const out=build(records,new Map([['a',error],['b',{status:'error',error:'PRIVATE_KEY',code:'GEMINI_LIMIT'}]]));
 assert.deepEqual(out.results.map(r=>r.conversation_id),['a','b','c']);assert.equal(out.model.name,'requested-model');
 for(const row of out.results){assert.equal(row.status,'error');assert.deepEqual(row.criteria,[]);assert.equal(row.score,null);assert.ok(row.error.length<240);}
 assert.match(out.results[0].error,/время ожидания/);assert.match(out.results[1].error,/ограничения/);assert.match(out.results[2].error,/отсутствует/);assert.ok(!JSON.stringify(out).includes('PRIVATE'));
});

test('Actual model names are deduplicated and multiple successful models are all declared',()=>{
 const records=[record('a'),record('b'),record('c')],a=assessment('a'),b=assessment('b'),c=assessment('c');b.assessment.model='second-model';
 const out=build(records,{a,b,c});assert.equal(out.model.name,'actual-model-2026, second-model');
});

test('Source and result ID mismatches are rejected, without silently replacing or dropping dialogs',()=>{
 assert.throws(()=>build([record('a'),record('a')],{}),/duplicate/);
 assert.throws(()=>build([record('a')],{b:assessment('b')}),/unknown/);
 assert.throws(()=>build([record('a')],{a:assessment('b')}),/does not match/);
 assert.throws(()=>build([record('a')],{a:{status:'error',conversationId:'b'}}),/does not match/);
 assert.throws(()=>build([{...record(),transcript:[]}],{}),/transcript/);
 assert.throws(()=>build([{...record(),conversation_id:5}],{}),/conversation_id/);
});

test('PROD count includes errors and must be exactly ten when requested',()=>{
 const records=Array.from({length:10},(_,i)=>record('prod-'+i));const out=build(records,{}, {expectedCount:10});
 assert.equal(out.results.length,10);assert.equal(validateSubmission(out,{records,expectedCount:10}),true);
 assert.throws(()=>build(records.slice(1),{},{expectedCount:10}),/expectedCount/);
 assert.throws(()=>validateSubmission(out,{records,expectedCount:9}),/expectedCount/);
});

test('Illegal types, scales, N/A, missing criteria and invalid original evidence indices fail closed',()=>{
 const edits=[r=>r.answers.contact.value=null,r=>r.answers.need.value='true',r=>r.answers.solution.value=7,r=>r.answers.management.value=15,r=>r.answers.critical.value=null,r=>delete r.answers.closing,r=>r.answers.extra={value:true},r=>r.answers.contact.reason=' ',...[[0],[9],[2.5],['4'],[4,4],[]].map(evidence=>r=>r.answers.contact.evidence=evidence)];
 for(const edit of edits){const result=assessment();edit(result);assert.throws(()=>build([record()],{'original-001':result}),TypeError);}
});

test('Strict validation rejects missing/extra IDs, altered scores, duplicate criteria and extra exported data',()=>{
 const records=[record('a'),record('b')],original=build(records,{a:assessment('a'),b:assessment('b')});
 const edits=[s=>s.results.pop(),s=>s.results[1].conversation_id='a',s=>s.results[1].conversation_id='unknown',s=>s.results[0].criteria[1].criterion_id='contact',s=>s.results[0].criteria[0].evidence_turns=[0],s=>s.results[0].score.final_score=85.39,s=>s.results[0].score.critical_flag=true,s=>s.results[0].transcript=[],s=>s.apiKey='PRIVATE',s=>s.model.mode='invented',s=>s.results[0].criteria[0].value='true'];
 for(const edit of edits){const out=structuredClone(original);edit(out);assert.throws(()=>validateSubmission(out,{records}),TypeError);}
 const failed=build([record()],{});failed.results[0].score={final_score:0,critical_flag:false};assert.throws(()=>validateSubmission(failed,{records:[record()]}),/null score/);
});
