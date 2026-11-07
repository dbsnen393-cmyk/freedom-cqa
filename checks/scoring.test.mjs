import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculate,criterionContribution,scoreBreakdown,initialCriteria,demoConversations} from '../web/domain.js';
import {effectiveAnswers} from '../web/assessment-state.js';
const full=Object.fromEntries(initialCriteria.map(c=>[c.id,{value:c.type==='scale'?Math.max(...c.scale):c.type==='flag'?false:true}]));
test('Full applicable checklist gives 100',()=>assert.equal(calculate(initialCriteria,full),100));
test('Criterion 6 score 7/10 contributes 10.5 of its 15 weight',()=>{const a=structuredClone(full);a.management.value=7;assert.equal(calculate(initialCriteria,a),95.5);});
test('N/A weights are excluded and remaining criteria normalized',()=>{const a=structuredClone(full);a.identity.value=null;a.need.value=null;a.solution.value=15;a.closing.value=false;assert.equal(calculate(initialCriteria,a),84.62);});
test('Critical violation does not zero the score',()=>{const a=structuredClone(full);a.critical.value=true;assert.equal(calculate(initialCriteria,a),100);});
test('No applicable weighted criteria gives null',()=>{const a=Object.fromEntries(initialCriteria.map(c=>[c.id,{value:null}]));assert.equal(calculate(initialCriteria,a),null);});
test('Demo evidence references existing messages; scales and N/A are valid',()=>{for(const c of demoConversations){if(!c.answers)continue;for(const rule of c.criteria){const a=c.answers[rule.id];assert.ok(a);assert.ok(a.evidence.every(id=>c.messages.some(m=>m.id===id)));if(a.value===null)assert.ok(rule.allowNA);else if(rule.type==='scale')assert.ok(rule.scale.includes(a.value));else assert.equal(typeof a.value,'boolean');}}});

test('Raw scale values are converted into weighted criterion points, without changing the rubric',()=>{
 const management=initialCriteria.find(c=>c.id==='management'),before=structuredClone(management);
 assert.equal(criterionContribution(management,{value:10}),15);
 assert.equal(criterionContribution(management,{value:7}),10.5);
 assert.equal(criterionContribution(management,{value:0}),0);
 assert.deepEqual(management,before);
});

test('Boolean decisions earn all or none of the weight; N/A, missing answers and flags earn no numeric points',()=>{
 const contact=initialCriteria.find(c=>c.id==='contact'),critical={...initialCriteria.find(c=>c.id==='critical'),weight:50};
 assert.equal(criterionContribution(contact,{value:true}),10);
 assert.equal(criterionContribution(contact,{value:false}),0);
 assert.equal(criterionContribution(contact,{value:null}),null);
 assert.equal(criterionContribution(contact,undefined),null);
 assert.equal(criterionContribution(critical,{value:true}),null);
 assert.equal(criterionContribution(critical,{value:false}),null);
});

test('Breakdown exposes 55 earned of 65 applicable points, excludes 35 N/A weight and normalizes to 84.62',()=>{
 const answers=structuredClone(full);answers.identity.value=null;answers.need.value=null;answers.solution.value=15;answers.closing.value=false;
 const before=structuredClone(answers),breakdown=scoreBreakdown(initialCriteria,answers);
 assert.deepEqual(breakdown,{earned:55,applicable:65,excludedWeight:35,score:84.62});
 assert.equal(breakdown.score,calculate(initialCriteria,answers));assert.deepEqual(answers,before);
});

test('Only the final normalized score is rounded; individual contributions and their sum retain precision',()=>{
 const criteria=[{id:'a',type:'scale',scale:[0,1,3],weight:1},{id:'b',type:'scale',scale:[0,1,3],weight:1}];
 const answers={a:{value:1},b:{value:1}};
 assert.equal(criterionContribution(criteria[0],answers.a),1/3);
 assert.deepEqual(scoreBreakdown(criteria,answers),{earned:2/3,applicable:2,excludedWeight:0,score:33.33});
});

test('No applicable weight keeps the overall score absent, including all-N/A and flag-only results',()=>{
 assert.deepEqual(scoreBreakdown(initialCriteria,null),{earned:0,applicable:0,excludedWeight:0,score:null});
 const answers=Object.fromEntries(initialCriteria.map(c=>[c.id,{value:null}]));
 assert.deepEqual(scoreBreakdown(initialCriteria,answers),{earned:0,applicable:0,excludedWeight:100,score:null});
 const critical={...initialCriteria.find(c=>c.id==='critical'),weight:50};
 assert.deepEqual(scoreBreakdown([critical],{critical:{value:true}}),{earned:0,applicable:0,excludedWeight:0,score:null});
});

test('An effective appeal updates both criterion points and the N/A denominator while preserving the original assessment',()=>{
 const answers=structuredClone(full);answers.identity.value=null;answers.need.value=null;answers.solution.value=15;answers.closing.value=false;
 const conversation={id:'weighted-appeal',criteria:structuredClone(initialCriteria),answers,version:1,assessment:{id:'current-assessment'}};
 const before=structuredClone(conversation),appeals=[{conversationId:conversation.id,criterionId:'need',status:'resolved',assessmentId:'current-assessment',decision:true},{conversationId:conversation.id,criterionId:'closing',status:'resolved',assessmentId:'older-assessment',decision:true}];
 const effective=effectiveAnswers(conversation,appeals);
 assert.equal(criterionContribution(initialCriteria.find(c=>c.id==='need'),effective.need),15);
 assert.deepEqual(scoreBreakdown(initialCriteria,effective),{earned:70,applicable:80,excludedWeight:20,score:87.5});
 assert.deepEqual(scoreBreakdown(initialCriteria,conversation.answers),{earned:55,applicable:65,excludedWeight:35,score:84.62});
 assert.deepEqual(conversation,before);
});
