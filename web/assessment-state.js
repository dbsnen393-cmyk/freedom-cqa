import {isTestConversation} from './offline-assessment.js';
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>structuredClone(value);
const FINGERPRINT=/^[a-f0-9]{64}$/;
const ARCHIVE_REASON='Получена новая оценка диалога.';
const HISTORY_LIMIT=20;
function validDecision(rule,value){
 if(value===null)return rule.allowNA===true;
 return rule.type==='scale'?typeof value==='number'&&Number.isFinite(value)&&rule.scale.includes(value):typeof value==='boolean';
}
/** Identifies the active run; old demonstration/legacy answers receive a stable identity. */
export function assessmentIdentity(conversation){
 if(typeof conversation?.assessment?.id==='string'&&conversation.assessment.id)return conversation.assessment.id;
 if(!record(conversation?.answers))return null;
 return (conversation.demo?'demo:':'legacy:')+String(conversation.id)+':v'+String(conversation.version??0);
}
/** Returns a detached answer copy. Appeal decisions never mutate the original AI output. */
export function effectiveAnswers(conversation,appeals=[]){
 if(!record(conversation?.answers))return null;
 const answers=clone(conversation.answers),identity=assessmentIdentity(conversation);
 const criteria=Array.isArray(conversation.criteria)?conversation.criteria:[];
 for(const appeal of Array.isArray(appeals)?appeals:[]){
  if(!record(appeal)||appeal.conversationId!==conversation.id||appeal.status!=='resolved'||appeal.archived===true||appeal.archivedAt||appeal.archiveReason||appeal.archivedReason)continue;
  if(own(appeal,'assessmentId')&&appeal.assessmentId!==identity)continue;
  if(typeof appeal.criterionId!=='string'||!own(answers,appeal.criterionId)||!record(answers[appeal.criterionId])||!own(appeal,'decision'))continue;
  const rule=criteria.find(item=>item.id===appeal.criterionId);if(!rule||!validDecision(rule,appeal.decision))continue;
  answers[appeal.criterionId].value=appeal.decision;
 }
 return answers;
}
function validateResult(conversation,result,appeals){
 const fail=()=>{throw new TypeError('Результат оценки не соответствует диалогу или чек-листу. Изменения не сохранены.');};
 if(!record(conversation)||typeof conversation.id!=='string'||!Array.isArray(conversation.messages)||!Array.isArray(appeals)||!record(result)||result.conversationId!==conversation.id)fail();
 if(!record(result.answers)||!Array.isArray(result.criteria)||!result.criteria.length||result.criteria.length>100||!Number.isSafeInteger(result.version)||result.version<1)fail();
 if(typeof result.sourceFingerprint!=='string'||!FINGERPRINT.test(result.sourceFingerprint)||typeof result.checklistFingerprint!=='string'||!FINGERPRINT.test(result.checklistFingerprint))fail();
 const metadata=result.assessment;
 if(!record(metadata)||typeof metadata.id!=='string'||!/^[A-Za-z0-9_.:-]{1,160}$/.test(metadata.id)||typeof metadata.createdAt!=='string'||!Number.isFinite(Date.parse(metadata.createdAt))||typeof metadata.provider!=='string'||!metadata.provider||typeof metadata.model!=='string'||!metadata.model)fail();
 const targetTest=isTestConversation(conversation),resultTest=metadata.provider==='fixture'||metadata.testMode===true||result.testMode===true;
 if(targetTest!==resultTest||(targetTest&&metadata.provider!=='fixture'))fail();
 const messageIds=new Set(conversation.messages.map(message=>message.id)),criterionIds=new Set();
 for(const rule of result.criteria){
  if(!record(rule)||typeof rule.id!=='string'||!rule.id||criterionIds.has(rule.id)||!['boolean','scale','flag'].includes(rule.type)||typeof rule.allowNA!=='boolean'||!Number.isFinite(rule.weight)||rule.weight<0||typeof rule.title!=='string'||!rule.title.trim()||typeof rule.description!=='string'||!rule.description.trim())fail();
  criterionIds.add(rule.id);
  if(rule.type==='scale'&&(!Array.isArray(rule.scale)||rule.scale.length<2||rule.scale.some(value=>!Number.isFinite(value)||value<0)||new Set(rule.scale).size!==rule.scale.length||Math.max(...rule.scale)<=0))fail();
  if(!own(result.answers,rule.id))fail();const answer=result.answers[rule.id];
  if(!record(answer)||!own(answer,'value')||!validDecision(rule,answer.value)||typeof answer.reason!=='string'||!answer.reason.trim()||!Array.isArray(answer.evidence)||!answer.evidence.length||new Set(answer.evidence).size!==answer.evidence.length||answer.evidence.some(id=>!Number.isSafeInteger(id)||!messageIds.has(id))||!['present','absence','not_applicable'].includes(answer.evidenceKind))fail();
  if((answer.value===null)!==(answer.evidenceKind==='not_applicable'))fail();
 }
 if(Object.keys(result.answers).length!==criterionIds.size||Object.keys(result.answers).some(id=>!criterionIds.has(id)))fail();
 return clone({answers:result.answers,criteria:result.criteria,version:result.version,sourceFingerprint:result.sourceFingerprint,checklistFingerprint:result.checklistFingerprint,assessment:{...metadata,reviewed:false}});
}
/**
 * Installs one validated run. Mutates conversation and its open/resolved appeal objects,
 * then returns the same conversation. Validation/cloning finish before any mutation.
 * History retains at most 20 old runs, with original and final answers at replacement time.
 */
export function installAssessment(conversation,result,appeals=[],activeChecklist){
 const next=validateResult(conversation,result,appeals);
 if(activeChecklist!==undefined){
  // Compare semantic/scoring fields in a stable order: UI objects and prepared
  // snapshots may serialize properties in different orders. Old history stays valid.
  const signature=criteria=>JSON.stringify(criteria.map(c=>[c.id,c.title,c.description,c.type,c.weight,c.type==='scale'?c.scale:[],c.allowNA,c.naRule||'']));
  if(!record(activeChecklist)||!Array.isArray(activeChecklist.criteria)||activeChecklist.version!==next.version||signature(activeChecklist.criteria)!==signature(next.criteria))throw new TypeError('Активный чек-лист изменился во время запроса. Оценка не сохранена; запустите оценку по текущей версии.');
 }
 if(conversation.assessment?.id===next.assessment.id){
  const current=[conversation.answers,conversation.criteria,conversation.version,conversation.sourceFingerprint,conversation.checklistFingerprint];
  const incoming=[next.answers,next.criteria,next.version,next.sourceFingerprint,next.checklistFingerprint];
  if(JSON.stringify(current)!==JSON.stringify(incoming))throw new TypeError('Один ID оценки не может содержать разные результаты. Изменения не сохранены.');
  return conversation;
 }
 const previousId=assessmentIdentity(conversation),archivedAt=next.assessment.createdAt;
 const history=Array.isArray(conversation.assessmentHistory)?clone(conversation.assessmentHistory):[];
 if(record(conversation.answers))history.push({assessmentId:previousId,conversation:clone({id:conversation.id,language:conversation.language,channel:conversation.channel,messages:conversation.messages}),assessment:conversation.assessment?clone(conversation.assessment):{id:previousId,provider:conversation.demo?'demo':'legacy',model:null,createdAt:null},answers:clone(conversation.answers),finalAnswers:effectiveAnswers(conversation,appeals),criteria:clone(conversation.criteria||[]),version:conversation.version,sourceFingerprint:conversation.sourceFingerprint??null,checklistFingerprint:conversation.checklistFingerprint??null,createdAt:conversation.assessment?.createdAt??null,archivedAt,archiveReason:ARCHIVE_REASON});
 const archives=appeals.filter(appeal=>record(appeal)&&appeal.conversationId===conversation.id&&['open','resolved'].includes(appeal.status)).map(appeal=>({appeal,fields:{assessmentId:typeof appeal.assessmentId==='string'&&appeal.assessmentId?appeal.assessmentId:previousId,previousStatus:appeal.status,status:'archived',archiveReason:ARCHIVE_REASON,archivedAt}}));
 Object.assign(conversation,next,{assessmentHistory:history.slice(-HISTORY_LIMIT),transcriptChanged:false});
 for(const {appeal,fields} of archives)Object.assign(appeal,fields);
 return conversation;
}
