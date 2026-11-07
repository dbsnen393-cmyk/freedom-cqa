import {calculate,valueLabel} from './domain.js';
import {preprocessConversation} from './preprocess.js';

const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const TEST_SCENARIOS=Object.freeze([
 Object.freeze({id:'mixed',label:'Смешанные значения'}),
 Object.freeze({id:'positive',label:'Высокие баллы'}),
 Object.freeze({id:'negative',label:'Низкие баллы'}),
 Object.freeze({id:'not_applicable',label:'N/A там, где разрешено'})
]);

/** A fixture remains synthetic even if one of its other source labels changes. */
export function isTestConversation(conversation){
 return Boolean(conversation&&(conversation.source==='TEST'||conversation.testMode===true||conversation.assessment?.provider==='fixture'));
}

/** Copy only transcript context; credentials, audio links and previous results stay out. */
export function createTestConversation(original){
 if(!record(original)||typeof original.id!=='string'||!Array.isArray(original.messages)||!original.messages.length)throw new TypeError('Для учебной копии выберите диалог с репликами.');
 const id='test-'+crypto.randomUUID(),copy={};
 for(const key of ['operator','language','channel','date','messages','participants','originTimestamp','syncOffset','compressPauses','normalizedVersion','criteria','version']){
  if(own(original,key))copy[key]=structuredClone(original[key]);
 }
 // Message numbers stay stable for evidence, while UIDs belong to the isolated copy.
 copy.messages=copy.messages.map(message=>({...message,uid:id+':M'+String(message.id).padStart(4,'0')}));
 return {...copy,id,title:'Учебный · '+String(original.title||original.id).replace(/^Учебный · /u,''),source:'TEST',testMode:true,demo:false,originalConversationId:original.originalConversationId||original.id,originalSource:original.originalSource||original.source||(original.demo?'DEMO':'import'),testCreatedAt:new Date().toISOString(),answers:null,assessmentHistory:[],transcriptChanged:false};
}

function validateCriteria(criteria){
 if(!Array.isArray(criteria)||!criteria.length||criteria.length>100)throw new TypeError('Учебному сценарию нужен действующий чек-лист.');
 const ids=new Set();
 for(const rule of criteria){
  if(!record(rule)||typeof rule.id!=='string'||!rule.id||ids.has(rule.id)||!['boolean','scale','flag'].includes(rule.type)||typeof rule.allowNA!=='boolean')throw new TypeError('Некорректный критерий учебного сценария.');
  ids.add(rule.id);
  if(rule.type==='scale'&&(!Array.isArray(rule.scale)||rule.scale.length<2||rule.scale.length>100||rule.scale.some(value=>typeof value!=='number'||!Number.isFinite(value)||value<0)||new Set(rule.scale).size!==rule.scale.length||Math.max(...rule.scale)<=0))throw new TypeError('Некорректная шкала учебного сценария.');
 }
}

/** Values are mechanical fixtures; the transcript never determines a verdict. */
export function createTestValues(criteria,scenario='mixed'){
 validateCriteria(criteria);
 if(!TEST_SCENARIOS.some(item=>item.id===scenario))throw new TypeError('Неизвестный учебный сценарий.');
 let booleanIndex=0;
 return Object.fromEntries(criteria.map(rule=>{
  let value;
  if(scenario==='not_applicable'&&rule.allowNA)value=null;
  else if(rule.type==='scale'){
   const scale=[...rule.scale].sort((a,b)=>a-b);
   value=scale[scenario==='negative'?0:scenario==='mixed'?Math.floor((scale.length-1)/2):scale.length-1];
  }else if(rule.type==='flag')value=scenario==='negative';
  else value=scenario==='mixed'?booleanIndex++%2===1:scenario!=='negative';
  return [rule.id,value];
 }));
}

function validateValues(values,criteria){
 if(!record(values)||Object.keys(values).length!==criteria.length||criteria.some(rule=>!own(values,rule.id)))throw new TypeError('Задайте учебное значение для каждого критерия без лишних полей.');
 for(const rule of criteria){
  const value=values[rule.id];
  const valid=value===null?rule.allowNA===true:rule.type==='scale'?typeof value==='number'&&Number.isFinite(value)&&rule.scale.includes(value):typeof value==='boolean';
  if(!valid)throw new TypeError('Недопустимое учебное значение критерия «'+rule.title+'».');
 }
}

/** Produces a local, explicitly synthetic result accepted by installAssessment. */
export async function createTestAssessment(conversation,criteria=conversation?.criteria,version=conversation?.version,options={}){
 if(!isTestConversation(conversation))throw new TypeError('Учебную оценку можно запускать только на отдельной копии TEST.');
 if(!record(options))throw new TypeError('Некорректные настройки учебного сценария.');
 const {scenario='mixed',values,evidence}=options;
 if(!TEST_SCENARIOS.some(item=>item.id===scenario))throw new TypeError('Неизвестный учебный сценарий.');
 // Snapshot before awaiting the hashes so input edits cannot change this run midway.
 const source=structuredClone(conversation),rules=structuredClone(criteria);
 const customValues=values===undefined?undefined:structuredClone(values),customEvidence=evidence===undefined?{}:structuredClone(evidence);
 const {report,packet}=await preprocessConversation(source,rules,version);
 if(!packet)throw new TypeError('Учебная оценка остановлена: '+report.issues.filter(issue=>issue.severity==='error').map(issue=>issue.message).join(' '));
 const cleanCriteria=packet.checklist.criteria;
 const selectedValues=customValues===undefined?createTestValues(cleanCriteria,scenario):customValues;
 validateValues(selectedValues,cleanCriteria);
 const criterionIds=new Set(cleanCriteria.map(rule=>rule.id)),messageIds=new Set(source.messages.map(message=>message.id));
 if(!record(customEvidence)||Object.keys(customEvidence).some(id=>!criterionIds.has(id)))throw new TypeError('Учебные реплики привязаны к неизвестному критерию.');
 for(const ids of Object.values(customEvidence)){
  if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!Number.isSafeInteger(id)||!messageIds.has(id)))throw new TypeError('Выберите существующие реплики учебного диалога без повторов.');
 }
 const operatorIds=source.messages.filter(message=>message.role==='operator').map(message=>message.id);
 const answers=Object.fromEntries(cleanCriteria.map((rule,index)=>{
  const value=selectedValues[rule.id],ids=own(customEvidence,rule.id)?customEvidence[rule.id]:[operatorIds[index%operatorIds.length]];
  return [rule.id,{value,reason:'Учебный синтетический ответ: задано «'+valueLabel(value)+'». Реплики выбраны для проверки перехода к фрагментам; они не доказывают это значение. Смысл диалога не оценивался, ИИ не вызывался.',evidence:ids,evidenceKind:value===null?'not_applicable':value===false?'absence':'present'}];
 }));
 return {conversationId:source.id,testMode:true,answers,criteria:structuredClone(cleanCriteria),version:packet.checklist.version,sourceFingerprint:report.sourceFingerprint,checklistFingerprint:report.checklistFingerprint,finalScore:calculate(cleanCriteria,answers),critical:cleanCriteria.some(rule=>rule.type==='flag'&&answers[rule.id].value===true),assessment:{id:'fixture-'+crypto.randomUUID(),provider:'fixture',model:'offline-fixture',testMode:true,scenario:customValues===undefined?scenario:'custom',createdAt:new Date().toISOString()}};
}
