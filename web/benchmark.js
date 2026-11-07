import {calculate} from './domain.js';
import {preprocessConversation} from './preprocess.js';
import {effectiveAnswers} from './assessment-state.js';
import {isTestConversation} from './offline-assessment.js';

export const REFERENCE_SCHEMA='freedom-cqa-reference-v1';
export const UNLABELED='__UNLABELED__';
const FINGERPRINT=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9_.:-]{1,160}$/;
const FORBIDDEN_IDS=new Set(['__proto__','constructor','prototype']);
const RECORD_KEYS=['conversationId','source','sourceFingerprint','checklistFingerprint','version','criteria','answers','kind','label'];
const CRITERION_KEYS=['id','title','description','type','weight','scale','allowNA','naRule'];
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const copy=value=>structuredClone(value);
const synthetic=conversation=>isTestConversation(conversation)||conversation?.demo===true||conversation?.source==='DEMO';
const sourceOf=conversation=>conversation?.source||(conversation?.demo?'DEMO':'import');
const keyOf=value=>JSON.stringify([value?.source??sourceOf(value),value?.conversationId??value?.id]);
const exactKeys=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>own(value,key));
const fail=message=>{throw new TypeError(message);};
const validId=value=>typeof value==='string'&&ID.test(value)&&!FORBIDDEN_IDS.has(value);
const validSource=value=>typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f\u007f]/.test(value);
function validateCriteria(criteria){
 if(!Array.isArray(criteria)||!criteria.length||criteria.length>100)fail('Чек-лист должен содержать от 1 до 100 критериев.');
 const ids=new Set();
 for(const c of criteria){
  if(!exactKeys(c,CRITERION_KEYS)||!validId(c.id)||ids.has(c.id)||typeof c.title!=='string'||!c.title.trim()||typeof c.description!=='string'||!c.description.trim()||!['boolean','scale','flag'].includes(c.type)||!Number.isFinite(c.weight)||c.weight<0||typeof c.allowNA!=='boolean'||typeof c.naRule!=='string'||(c.allowNA&&!c.naRule.trim())||!Array.isArray(c.scale))fail('Некорректный или повторяющийся критерий эталона.');
  ids.add(c.id);
  if(c.type==='scale'?(c.scale.length<2||c.scale.length>100||c.scale.some(value=>!Number.isFinite(value)||value<0)||new Set(c.scale).size!==c.scale.length||Math.max(...c.scale)<=0):c.scale.length!==0)fail('Некорректная шкала критерия '+c.id+'.');
 }
 if(!Number.isFinite(criteria.filter(c=>c.type!=='flag').reduce((sum,c)=>sum+c.weight,0)))fail('Сумма весов чек-листа слишком велика.');
}
function validValue(rule,value){
 if(value===null)return rule.allowNA===true;
 return rule.type==='scale'?typeof value==='number'&&Number.isFinite(value)&&rule.scale.includes(value):typeof value==='boolean';
}
function validateValues(criteria,values){
 if(!exactKeys(values,criteria.map(c=>c.id)))fail('Эталон должен содержать ровно один ответ по каждому критерию.');
 for(const c of criteria)if(!validValue(c,values[c.id]))fail('Недопустимый ответ для «'+c.title+'»: укажите boolean, число из шкалы или разрешённое N/A (null).');
}
function validateRecord(reference){
 if(!exactKeys(reference,RECORD_KEYS)||!validId(reference.conversationId)||!validSource(reference.source)||!FINGERPRINT.test(reference.sourceFingerprint)||!FINGERPRINT.test(reference.checklistFingerprint)||!Number.isSafeInteger(reference.version)||reference.version<1||!['manual','ground_truth','test'].includes(reference.kind)||typeof reference.label!=='string'||reference.label.length>160)fail('Некорректная запись эталона. Проверьте источник, ID, версию и отпечатки.');
 validateCriteria(reference.criteria);validateValues(reference.criteria,reference.answers);
}
function validateKind(reference,conversation){
 if(synthetic(conversation)?reference.kind!=='test':reference.kind==='test')fail('Тестовые эталоны должны иметь kind: test и относятся только к тестовым диалогам.');
}
async function prepared(conversation,criteria,version){
 const result=await preprocessConversation(conversation,criteria,version);
 if(!result.packet)fail('Диалог или чек-лист не прошёл подготовку: '+result.report.issues.filter(issue=>issue.severity==='error').map(issue=>issue.message).join(' '));
 return result;
}
function envelope(conversation,result,answers,{label='',kind='manual'}={}){
 if(!['manual','ground_truth','test'].includes(kind))fail('Неизвестный тип эталона.');
 const value={conversationId:conversation.id,source:sourceOf(conversation),sourceFingerprint:result.report.sourceFingerprint,checklistFingerprint:result.report.checklistFingerprint,version:result.packet.checklist.version,criteria:copy(result.packet.checklist.criteria),answers:copy(answers),kind:synthetic(conversation)?'test':kind,label};
 if(!synthetic(conversation)&&kind==='test')fail('Тестовый эталон нельзя сохранить для рабочего диалога.');
 return value;
}
/** Creates an independent reference; values must be explicitly set, including N/A. */
export async function createReference(conversation,criteria,version,values,options={}){
 conversation=copy(conversation);criteria=copy(criteria);values=copy(values);options=copy(options);
 const result=await prepared(conversation,criteria,version);
 const reference=envelope(conversation,result,values,options);validateRecord(reference);return reference;
}
/** Templates carry no transcript. UNLABELED cannot accidentally become an N/A answer. */
export async function createReferenceTemplate(conversations,criteria,version){
 if(!Array.isArray(conversations)||!conversations.length||conversations.length>1000)fail('Выберите от 1 до 1000 диалогов.');
 conversations=copy(conversations);criteria=copy(criteria);
 const seen=new Set();
 const records=await Promise.all(conversations.map(async conversation=>{
  const key=keyOf(conversation);if(seen.has(key))fail('В шаблоне повторяются источник и ID диалога.');seen.add(key);
  const result=await prepared(conversation,criteria??conversation.criteria,version??conversation.version);
  return envelope(conversation,result,Object.fromEntries(result.packet.checklist.criteria.map(c=>[c.id,UNLABELED])),{kind:'ground_truth'});
 }));
 return {schema:REFERENCE_SCHEMA,records};
}
/** Whitelist export: no transcript, operator names, evidence, or provider responses. */
export function exportReferenceBundle(references){
 if(!Array.isArray(references))fail('Ожидался список эталонов.');
 return {schema:REFERENCE_SCHEMA,records:references.map(reference=>{
  validateRecord(reference);
  return Object.fromEntries(RECORD_KEYS.map(key=>[key,key==='criteria'?reference.criteria.map(c=>Object.fromEntries(CRITERION_KEYS.map(field=>[field,copy(c[field])]))):copy(reference[key])]));
 })};
}
/** All records finish validation before any value is returned; callers replace state once. */
export async function importReferenceBundle(input,conversations){
 let bundle=input;
 if(typeof input==='string'){if(input.length>10000000)fail('Файл эталонов превышает 10 МБ.');try{bundle=JSON.parse(input);}catch{fail('Не удалось прочитать JSON эталонов.');}}
 if(!exactKeys(bundle,['schema','records'])||bundle.schema!==REFERENCE_SCHEMA||!Array.isArray(bundle.records)||!bundle.records.length||bundle.records.length>1000)fail('Нужен пакет freedom-cqa-reference-v1 с 1–1000 записями records.');
 if(!Array.isArray(conversations))fail('Не загружены исходные диалоги.');
 conversations=copy(conversations);
 const matches=new Map(),seen=new Set();
 for(const conversation of conversations){const key=keyOf(conversation);if(matches.has(key))fail('Повторяются источник и ID исходного диалога.');matches.set(key,conversation);}
 const records=copy(bundle.records);
 for(const reference of records){validateRecord(reference);const key=keyOf(reference);if(seen.has(key))fail('В файле повторяются источник и ID эталона.');seen.add(key);if(!matches.has(key))fail('Для эталона '+reference.conversationId+' не найден диалог с таким источником и ID.');validateKind(reference,matches.get(key));}
 await Promise.all(records.map(async reference=>{
  const conversation=matches.get(keyOf(reference));
  const referenceContext=await prepared(conversation,reference.criteria,reference.version);
  if(reference.sourceFingerprint!==referenceContext.report.sourceFingerprint)fail('Эталон '+reference.conversationId+' устарел: исходный диалог изменился.');
  if(reference.checklistFingerprint!==referenceContext.report.checklistFingerprint)fail('Отпечаток чек-листа эталона '+reference.conversationId+' не соответствует его содержимому или версии.');
 }));
 return records;
}
export const validateReferenceBundle=importReferenceBundle;

const metric=()=>({compared:0,matches:0,accuracy:null,applicabilityCompared:0,applicabilityMatches:0,applicabilityAccuracy:null,expectedNA:0,candidateNA:0,naMatches:0});
const flagMetric=()=>({...metric(),truePositive:0,falsePositive:0,falseNegative:0,trueNegative:0});
function countMetric(stats,expected,actual,allowNA){
 stats.compared++;stats.matches+=Number(expected===actual);
 if(allowNA){stats.applicabilityCompared++;stats.applicabilityMatches+=Number((expected===null)===(actual===null));stats.expectedNA+=Number(expected===null);stats.candidateNA+=Number(actual===null);stats.naMatches+=Number(expected===null&&actual===null);}
 if(own(stats,'truePositive')&&expected!==null&&actual!==null){const key=expected?(actual?'truePositive':'falseNegative'):(actual?'falsePositive':'trueNegative');stats[key]++;}
}
function finishMetric(stats){stats.accuracy=stats.compared?stats.matches/stats.compared:null;stats.applicabilityAccuracy=stats.applicabilityCompared?stats.applicabilityMatches/stats.applicabilityCompared:null;return stats;}
const candidateValues=(criteria,answers)=>{
 if(!exactKeys(answers,criteria.map(c=>c.id)))return null;
 const values={};for(const c of criteria){if(!object(answers[c.id])||!own(answers[c.id],'value')||!validValue(c,answers[c.id].value))return null;values[c.id]=answers[c.id].value;}
 return values;
};
const score=(criteria,values)=>calculate(criteria,Object.fromEntries(criteria.map(c=>[c.id,{value:values[c.id]}])));

/** Recomputes canonical hashes on each run, including edits made after a reference was saved. */
export async function compareReferences(conversations,references,appeals=[],{mode='original',scope='production'}={}){
 if(!Array.isArray(conversations)||!Array.isArray(references)||!Array.isArray(appeals))fail('Для сравнения нужны списки диалогов, эталонов и апелляций.');
 conversations=copy(conversations);references=copy(references);appeals=copy(appeals);
 if(!['original','final'].includes(mode)||!['production','test'].includes(scope))fail('Неизвестный режим или область сравнения.');
 const coverage={conversations:conversations.length,references:references.length,eligible:0,compared:0,skipped:0,missingReference:0,withoutAssessment:0,stale:0,checklistMismatch:0,excluded:0,reasons:{}};
 const report={schema:'freedom-cqa-comparison-v1',mode,scope,label:scope==='test'?'Тестовая проверка механики — не точность ИИ':mode==='original'?'Совпадение исходной оценки ИИ с эталоном':'Совпадение итоговой оценки после апелляций с эталоном',coverage,metrics:{criteria:metric(),critical:flagMetric(),totals:{compared:0,mae:null,excludedAllNA:0}},criteria:[],flags:[],rows:[]};
 const byKey=new Map(),conversationKeys=new Set(conversations.map(keyOf)),criterionStats=new Map(),flagStats=new Map();
 for(const reference of references){const key=keyOf(reference);const group=byKey.get(key)||[];group.push(reference);byKey.set(key,group);}
 function skip(row,reason){row.reason=reason;coverage.skipped++;coverage.reasons[reason]=(coverage.reasons[reason]||0)+1;if(reason==='missing_reference')coverage.missingReference++;if(reason==='no_assessment')coverage.withoutAssessment++;if(reason.startsWith('stale_'))coverage.stale++;if(reason==='checklist_mismatch')coverage.checklistMismatch++;if(reason==='excluded_scope'||reason==='unsupported_provenance')coverage.excluded++;report.rows.push(row);}
 let errorSum=0;
 for(const conversation of conversations){
  const candidates=byKey.get(keyOf(conversation))||[],reference=candidates[0];
  const provider=conversation.assessment?.provider??(conversation.demo?'demo':conversation.answers?'legacy':null);
  const row={conversationId:conversation.id,source:sourceOf(conversation),referenceKind:reference?.kind??null,provider,model:conversation.assessment?.model??null,status:'skipped',reason:null,referenceScore:null,candidateScore:null,absoluteError:null,criteria:[]};
  if((scope==='test')!==synthetic(conversation)){skip(row,'excluded_scope');continue;}coverage.eligible++;
  if(!reference){skip(row,'missing_reference');continue;}if(candidates.length!==1){skip(row,'duplicate_reference');continue;}
  try{validateRecord(reference);validateKind(reference,conversation);}catch{skip(row,'invalid_reference');continue;}
  let referenceContext,currentContext;
  try{referenceContext=await prepared(conversation,reference.criteria,reference.version);}catch{skip(row,'invalid_reference');continue;}
  if(reference.sourceFingerprint!==referenceContext.report.sourceFingerprint){skip(row,'stale_reference');continue;}
  if(reference.checklistFingerprint!==referenceContext.report.checklistFingerprint){skip(row,'checklist_mismatch');continue;}
  if(!conversation.answers){skip(row,'no_assessment');continue;}
  if(scope==='production'?!['openai','gemini','groq'].includes(provider):provider!=='fixture'){skip(row,'unsupported_provenance');continue;}
  try{currentContext=await prepared(conversation,conversation.criteria,conversation.version);}catch{skip(row,'invalid_assessment');continue;}
  if(reference.version!==conversation.version||reference.checklistFingerprint!==currentContext.report.checklistFingerprint){skip(row,'checklist_mismatch');continue;}
  if(conversation.sourceFingerprint!==currentContext.report.sourceFingerprint){skip(row,'stale_assessment');continue;}
  if(conversation.checklistFingerprint!==currentContext.report.checklistFingerprint){skip(row,'checklist_mismatch');continue;}
  // An invalid original cannot be repaired into a benchmark candidate by an appeal.
  if(!candidateValues(reference.criteria,conversation.answers)){skip(row,'invalid_assessment');continue;}
  const answers=mode==='final'?effectiveAnswers(conversation,appeals):conversation.answers;
  const values=candidateValues(reference.criteria,answers);if(!values){skip(row,'invalid_assessment');continue;}
  for(const c of reference.criteria){
   const expected=reference.answers[c.id],actual=values[c.id],isFlag=c.type==='flag',collection=isFlag?flagStats:criterionStats;
   // Separate revisions of a criterion instead of mixing different definitions under one ID.
   const key=JSON.stringify([reference.checklistFingerprint,c.id]);
   if(!collection.has(key))collection.set(key,{id:c.id,title:c.title,type:c.type,version:reference.version,checklistFingerprint:reference.checklistFingerprint,...(isFlag?flagMetric():metric())});
   countMetric(collection.get(key),expected,actual,c.allowNA);countMetric(isFlag?report.metrics.critical:report.metrics.criteria,expected,actual,c.allowNA);
   row.criteria.push({id:c.id,title:c.title,type:c.type,reference:expected,candidate:actual,match:expected===actual,applicabilityMatch:c.allowNA?(expected===null)===(actual===null):null});
  }
  row.referenceScore=score(reference.criteria,reference.answers);row.candidateScore=score(reference.criteria,values);
  if(Number.isFinite(row.referenceScore)&&Number.isFinite(row.candidateScore)){row.absoluteError=Math.abs(row.referenceScore-row.candidateScore);errorSum+=row.absoluteError;report.metrics.totals.compared++;}else report.metrics.totals.excludedAllNA++;
  row.status='compared';coverage.compared++;report.rows.push(row);
 }
 for(const [key,group]of byKey)if(!conversationKeys.has(key)){const reference=group[0];skip({conversationId:reference?.conversationId??null,source:reference?.source??null,referenceKind:reference?.kind??null,provider:null,model:null,status:'skipped',reason:null,referenceScore:null,candidateScore:null,absoluteError:null,criteria:[]},'missing_conversation');}
 report.criteria=[...criterionStats.values()].map(finishMetric);report.flags=[...flagStats.values()].map(finishMetric);finishMetric(report.metrics.criteria);finishMetric(report.metrics.critical);
 report.metrics.totals.mae=report.metrics.totals.compared?errorSum/report.metrics.totals.compared:null;
 return report;
}
