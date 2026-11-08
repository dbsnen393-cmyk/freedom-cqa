import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildAssessmentRequest,ASSESSMENT_PROMPT_VERSION} from '../worker/assessment.mjs';
import {preprocessConversation} from '../web/preprocess.js';
import {initialCriteria} from '../web/domain.js';
import {qualityFixtures} from './fixtures/ai-quality.mjs';
const instructions=async criteria=>buildAssessmentRequest((await preprocessConversation(qualityFixtures[0].conversation,criteria,1)).packet).instructions;
const guidance=[
 ['critical','management','Critical не является автоматическим основанием для снижения management'],
 ['solution','management','Неполная консультация не равна неясному управлению диалогом'],
 ['identity','need','Ошибка идентификации не означает ошибку выявления потребности'],
 ['critical','empathy','Critical не означает автоматически отсутствие эмпатии']
];
test('Prompt v1.6 orders four decisions and prevents cross-criterion penalties without requesting chain of thought',async()=>{
 const text=await instructions(initialCriteria);assert.equal(ASSESSMENT_PROMPT_VERSION,'cqa-assessment-1.6');
 const steps=['1. Определить применимость','2. Выбрать значение','3. Подобрать доказательства','4. Сформировать краткое обоснование'];
 let previous=-1;for(const step of steps){const index=text.indexOf(step);assert.ok(index>previous);previous=index;}
 assert.match(text,/Не раскрывай внутреннюю цепочку рассуждений/);
 assert.match(text,/Одна реплика может подтверждать нарушения нескольких критериев, если каждое нарушение обосновано самостоятельно/);
 for(const [,,rule] of guidance)assert.ok(text.includes(rule));
});
for(const [left,right,rule]of guidance)for(const changedId of [left,right])test('Changed '+changedId+' disables stale guidance: '+rule,async()=>{
 const criteria=structuredClone(initialCriteria);criteria.find(c=>c.id===changedId).description='Новое определение, заданное пользователем.';
 const text=await instructions(criteria);assert.ok(!text.includes(rule));
});
test('Edited need semantics disable old N/A guidance, even with original ID and naRule',async()=>{
 const criteria=structuredClone(initialCriteria);criteria.find(c=>c.id==='need').description='Оператор повторил обращение дословно.';
 assert.doesNotMatch(await instructions(criteria),/Если уточнение требовалось|Запрос клиента был/);
});
for(const [field,value]of [['title','Другое название'],['allowNA',false],['naRule','Иное условие.'],['type','flag'],['scale',[0,1]]])test('Need guidance requires exact semantic field '+field,async()=>{
 const criteria=structuredClone(initialCriteria);const rule=criteria.find(c=>c.id==='need');rule[field]=value;
 // Boolean scales are canonicalized to [] by preprocessing, so test a scale type too.
 if(field==='scale')rule.type='scale';
 const text=await instructions(criteria);assert.doesNotMatch(text,/Если уточнение требовалось/);
});
test('Renamed IDs retain matching semantics; weight changes do not change semantic guidance',async()=>{
 const criteria=structuredClone(initialCriteria);criteria.forEach((c,i)=>{c.id='renamed-'+i;c.weight+=1;});
 const text=await instructions(criteria);for(const [,,rule]of guidance)assert.ok(text.includes(rule));
 assert.match(text,/Пояснение только для критериев \["renamed-1"\]/);assert.match(text,/Если уточнение требовалось/);
});

test('Need v1.4 stops at N/A, requires client evidence and checks reason/value consistency',async()=>{
 const text=await instructions(initialCriteria);
 const steps=['1. Определи, требовалось ли уточнение потребности','2. Если уточнение не требовалось — value=null','3. Если уточнение требовалось и было выполнено до ответа — value=true','4. Если уточнение требовалось, но было пропущено до ответа — value=false'];
 let last=-1;for(const step of steps){const index=text.indexOf(step);assert.ok(index>last);last=index;}
 assert.match(text,/после установления N\/A не выбирай true на основании того, что оператор правильно ответил/);
 assert.match(text,/Если reason утверждает, что исходные данные были достаточны и уточнения не требовались, значение должно быть null/);
 assert.match(text,/Для N\/A evidence должно включать исходную реплику клиента/);
 assert.match(text,/номера реплик локальны каждому примеру и не являются evidence текущего диалога/);
});

test('Need v1.4 includes all nine independent RU/KZ/EN examples without benchmark transcripts',async()=>{
 const text=await instructions(initialCriteria);
 const need=text.slice(text.indexOf('Применяй это дерево'),text.indexOf('\n\nПояснение',text.indexOf('Применяй это дерево')));
 for(const language of ['RU','KZ','EN'])for(const [label,value,kind]of [['N/A','null','not_applicable'],['уточнение выполнено','true','present'],['уточнение пропущено','false','absence']]){
  const line=need.split('\n').find(line=>line.startsWith(language+' — '+label+':'));
  assert.ok(line,language+' '+label);assert.ok(line.includes('value='+value+'; evidenceKind='+kind));
 }
 for(const fixture of qualityFixtures)for(const message of fixture.conversation.messages)assert.ok(!need.includes(message.text),'Benchmark message leaked into examples: '+fixture.name);
});

test('Need decision tree and all examples disappear together when semantic configuration changes',async()=>{
 for(const edit of [c=>{c.description='Новый смысл.';},c=>{c.allowNA=false;},c=>{c.naRule='Не было подключения оператора.';},c=>{c.type='scale';c.scale=[0,2,4];}]){
  const criteria=structuredClone(initialCriteria);edit(criteria.find(c=>c.id==='need'));
  const text=await instructions(criteria);assert.doesNotMatch(text,/Применяй это дерево|RU — N\/A|KZ — N\/A|EN — N\/A|после установления N\/A/);
 }
});
