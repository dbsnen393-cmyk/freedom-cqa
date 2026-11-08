import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessConversation,ASSESSMENT_PROMPT_VERSION} from '../worker/assessment.mjs';
import {initialCriteria} from '../web/domain.js';
import {createGeminiLimiter} from '../worker/gemini.mjs';
import {qualityFixtures} from './fixtures/ai-quality.mjs';

const ru1=qualityFixtures.find(f=>f.name==='RU-1');
const cases=[
 {name:'sufficient initial request yields N/A despite identification',conversation:ru1.conversation,value:null,kind:'not_applicable',evidence:[1,2,3,4],reason:'Просьба посмотреть остаток полностью определяет потребность. Проверка личности не уточняет запрос.'},
 {name:'necessary clarification completed before answer yields true',conversation:{id:'need-clarified',language:'RU',channel:'agent chat',messages:[
  {id:1,role:'client',time:'00:00',text:'Где это найти?'},
  {id:2,role:'operator',time:'00:05',text:'Здравствуйте! Меня зовут Алия. Что именно вы хотите найти?'},
  {id:3,role:'client',time:'00:10',text:'Остаток на счёте.'},
  {id:4,role:'operator',time:'00:15',text:'Пройдите проверку личности в приложении.'},
  {id:5,role:'system',time:'00:20',text:'Проверка личности успешно завершена.'},
  {id:6,role:'operator',time:'00:25',text:'Откройте «Счёт → Остаток».'},
  {id:7,role:'client',time:'00:30',text:'Нашёл, спасибо.'},
  {id:8,role:'operator',time:'00:35',text:'Остаток найден. До свидания!'}]},value:true,kind:'present',evidence:[1,2,3,6],reason:'Сначала не было понятно, что клиент ищет. Оператор уточнил объект запроса до инструкции.'},
 {name:'necessary clarification omitted before answer yields false',conversation:{id:'need-missed',language:'RU',channel:'agent chat',messages:[
  {id:1,role:'client',time:'00:00',text:'Где это найти?'},
  {id:2,role:'operator',time:'00:05',text:'Здравствуйте! Меня зовут Алия. Откройте меню.'},
  {id:3,role:'client',time:'00:10',text:'Что именно открыть? Я ещё не сказал, что ищу.'},
  {id:4,role:'operator',time:'00:15',text:'Всего доброго!'}]},value:false,kind:'absence',evidence:[1,2,3],reason:'Клиент не назвал объект поиска. Оператор дал ответ без необходимого уточнения.'}
];

for(const c of cases)test('Need applicability regression: '+c.name,async()=>{
 // Responses are explicit gold mocks, not a simulation of model reasoning.
 const raw=structuredClone(ru1.gold);
 // Other criteria are valid neutral test values here, not semantic gold for the new dialogues.
 for(const answer of Object.values(raw.answers))answer.evidence=[2];
 raw.answers.need={value:c.value,reason:c.reason,evidence:c.evidence,evidenceKind:c.kind};
 let calls=0;
 const result=await assessConversation(c.conversation,initialCriteria,1,{GEMINI_API_KEY:'need-tests-mock-only'},{limiter:createGeminiLimiter(),fetcher:async(url,init)=>{
  calls++;const body=JSON.parse(init.body),instructions=body.systemInstruction.parts[0].text,packet=JSON.parse(body.contents[0].parts[0].text);
  assert.match(instructions,/Если уточнение не требовалось — value=null/);
  assert.match(instructions,/Если уточнение требовалось и было выполнено до ответа — value=true/);
  assert.match(instructions,/Если уточнение требовалось, но было пропущено до ответа — value=false/);
  assert.match(instructions,/Просьба пройти идентификацию сама по себе не является уточнением потребности/);
  assert.match(instructions,/Отсутствие сведений и неоднозначный запрос не являются основанием для N\/A/);
  assert.match(instructions,/если определение или naRule критерия изменены, руководствуйся текущей конфигурацией/);
  assert.deepEqual(packet.checklist.criteria,initialCriteria);
  assert.deepEqual(packet.transcript.map(m=>[m.id,m.role,m.text]),c.conversation.messages.map(m=>[m.id,m.role,m.text]));
  assert.deepEqual(body.generationConfig.responseJsonSchema.properties.answers.properties.need.anyOf[1].properties.value,{type:'null'});
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(raw)}]}}]});
 }});
 assert.equal(calls,1);assert.deepEqual(result.answers.need,raw.answers.need);
 assert.equal(result.answers.need.value===null,result.answers.need.evidenceKind==='not_applicable');
 if(c.value===null)assert.ok(result.answers.need.evidence.includes(c.conversation.messages.find(m=>m.role==='client').id));
 for(const rule of initialCriteria.filter(rule=>rule.id!=='need'))assert.deepEqual(result.answers[rule.id],raw.answers[rule.id]);
 assert.equal(result.assessment.promptVersion,ASSESSMENT_PROMPT_VERSION);assert.equal(ASSESSMENT_PROMPT_VERSION,'cqa-assessment-1.6');
});

test('Need v1.4 never silently substitutes a model value based on the wording of reason',async()=>{
 const raw=structuredClone(ru1.gold);
 raw.answers.need={value:true,reason:'Данные были достаточны, уточнение не требовалось.',evidence:[1,2],evidenceKind:'present'};
 const result=await assessConversation(ru1.conversation,initialCriteria,1,{GEMINI_API_KEY:'mock-only'},{limiter:createGeminiLimiter(),fetcher:async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(raw)}]}}]})});
 // Semantic contradiction is for model/expert review; the server must not infer
 // or replace an expert decision from free-text reason.
 assert.deepEqual(result.answers,raw.answers);assert.equal(result.answers.need.value,true);
});
