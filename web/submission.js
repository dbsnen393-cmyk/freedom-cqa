// Official CQA submission format 1.0. These rules deliberately do not depend on
// the editable application checklist or a provider-supplied final score.
const RULES=Object.freeze([
 {internal:'contact',id:'contact',weight:10,values:[true,false]},
 {internal:'need',id:'discovery',weight:15,values:[true,false,null]},
 {internal:'identity',id:'identification',weight:20,values:[true,false,null]},
 {internal:'solution',id:'consultation',weight:20,values:[0,5,10,15,20,null],max:20},
 {internal:'empathy',id:'empathy',weight:15,values:[true,false]},
 {internal:'management',id:'dialogue',weight:15,values:[0,4,7,10],max:10},
 {internal:'closing',id:'closure',weight:5,values:[true,false,null]},
 {internal:'critical',id:'critical',weight:0,values:[true,false]}
].map(rule=>Object.freeze({...rule,values:Object.freeze(rule.values)})));
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw new TypeError('Submission: '+message);};
function nonempty(value,label){if(typeof value!=='string'||!value.trim())fail(label+' must be a nonempty string');return value.trim();}
function exactKeys(value,keys,label){if(!object(value)||Object.keys(value).length!==keys.length||keys.some(key=>!own(value,key)))fail(label+' has missing or extra fields');}
function sourceIndex(records,expectedCount){
 if(!Array.isArray(records)||!records.length)fail('records must contain the original source records');
 if(expectedCount!==undefined&&(!Number.isSafeInteger(expectedCount)||expectedCount<1||records.length!==expectedCount))fail('original record count does not match expectedCount');
 const index=new Map();
 for(const record of records){
  if(!object(record)||typeof record.conversation_id!=='string'||!record.conversation_id.trim())fail('every original record needs its exact conversation_id');
  const id=record.conversation_id;if(index.has(id))fail('duplicate original conversation_id: '+id);
  if(!Array.isArray(record.transcript)||!record.transcript.length)fail('original transcript is missing for '+id);
  index.set(id,record.transcript.length);
 }
 return index;
}
function checkCriterion(criterion,rule,turnCount,label){
 if(!rule.values.includes(criterion.value))fail(label+' has an invalid value');
 nonempty(criterion.rationale,label+' rationale');
 const evidence=criterion.evidence_turns;
 if(!Array.isArray(evidence)||!evidence.length||new Set(evidence).size!==evidence.length||evidence.some(turn=>!Number.isSafeInteger(turn)||turn<1||turn>turnCount))fail(label+' evidence_turns must be unique original 1-based transcript indices');
}
function officialScore(criteria){
 let earned=0,applicable=0;
 for(const rule of RULES){
  const value=criteria.find(criterion=>criterion.criterion_id===rule.id).value;
  if(!rule.weight||value===null)continue;
  applicable+=rule.weight;earned+=rule.weight*(rule.max?value/rule.max:value===true?1:0);
 }
 return {final_score:Math.round(earned/applicable*10000)/100,critical_flag:criteria.find(criterion=>criterion.criterion_id==='critical').value};
}
function errorText(failure){
 // Provider messages may contain request bodies, URLs or credentials. Export
 // only short controlled explanations; never copy Error.message or raw error.
 if(failure===undefined||failure===null)return 'Оценка отсутствует.';
 const code=typeof failure.code==='string'?failure.code:'';
 if(/TIMEOUT|ETIMEDOUT/.test(code))return 'Превышено время ожидания ответа модели.';
 if(/RATE|LIMIT|QUOTA/.test(code))return 'Ответ модели не получен из-за ограничения запросов.';
 if(/AUTH|KEY|CONFIG|ACCESS/.test(code))return 'Не удалось подключиться к модели.';
 if(/PREPROCESS|INVALID_DIALOGUE/.test(code))return 'Диалог не прошёл проверку входных данных.';
 return 'Не удалось получить ответ модели.';
}
function isFailure(value){return value===undefined||value===null||value instanceof Error||object(value)&&(value.status==='error'||own(value,'error')&&!own(value,'answers'));}

/**
 * Build official JSON from ORIGINAL API records and assessment results.
 * assessments: Map or plain object keyed by exact conversation_id. Successful
 * values are assessConversation() responses. Error instances, {status:'error',
 * error, code?}, API {error, code?}, and missing entries become explicit errors.
 * Malformed successes, unknown assessment keys and mismatched IDs throw.
 * Evidence IDs must already be original all-role 1-based indices (normalizeRecord
 * assigns these); they are validated and copied, never filtered or renumbered.
 * Actual response assessment.model names override modelName, which is the
 * fallback for runs with no successful model metadata. No input is mutated.
 */
export function buildSubmission({teamName,modelName,records,assessments,expectedCount}={}){
 const source=sourceIndex(records,expectedCount),team=nonempty(teamName,'teamName');
 if(!(assessments instanceof Map)&&(!object(assessments)||![Object.prototype,null].includes(Object.getPrototypeOf(assessments))))fail('assessments must be a Map or plain object');
 const byId=assessments instanceof Map?assessments:new Map(Object.entries(assessments));
 for(const id of byId.keys())if(!source.has(id))fail('assessment has an unknown conversation_id: '+String(id));
 const models=new Set(),results=[];
 for(const[id,turnCount]of source){
  const result=byId.get(id);
  if(object(result))for(const field of ['conversationId','conversation_id'])if(own(result,field)&&result[field]!==id)fail('assessment conversation ID does not match its source key: '+id);
  if(isFailure(result)){results.push({conversation_id:id,status:'error',criteria:[],score:null,error:errorText(result)});continue;}
  if(!object(result)||result.conversationId!==id||!object(result.answers))fail('invalid successful assessment for '+id);
  const keys=Object.keys(result.answers);if(keys.length!==RULES.length||RULES.some(rule=>!own(result.answers,rule.internal)))fail('successful assessment must contain exactly the eight internal criterion IDs: '+id);
  const criteria=RULES.map(rule=>{
   const answer=result.answers[rule.internal];if(!object(answer))fail('invalid criterion answer: '+id+'/'+rule.internal);
   const criterion={criterion_id:rule.id,value:answer.value,rationale:nonempty(answer.reason,id+'/'+rule.internal+' reason'),evidence_turns:Array.isArray(answer.evidence)?[...answer.evidence]:answer.evidence};
   checkCriterion(criterion,rule,turnCount,id+'/'+rule.id);return criterion;
  });
  if(result.assessment?.model!==undefined)models.add(nonempty(result.assessment.model,'actual model name'));
  else models.add(nonempty(modelName,'modelName (no actual response model available)'));
  results.push({conversation_id:id,status:'ok',criteria,score:officialScore(criteria)});
 }
 const submission={schema_version:'1.0',team_name:team,model:{mode:'external_api',name:models.size?[...models].join(', '):nonempty(modelName,'modelName')},results};
 validateSubmission(submission,{records,expectedCount});return submission;
}

/** Strict official-schema/score/ID/evidence validation against original records.
 * Pass expectedCount:10 for PROD. Throws TypeError on failure; returns true.
 */
export function validateSubmission(submission,{records,expectedCount}={}){
 const source=sourceIndex(records,expectedCount);
 exactKeys(submission,['schema_version','team_name','model','results'],'submission');
 if(submission.schema_version!=='1.0')fail('unsupported schema_version');nonempty(submission.team_name,'team_name');
 exactKeys(submission.model,['mode','name'],'model');
 if(!['local','external_api','hybrid'].includes(submission.model.mode))fail('invalid model mode');nonempty(submission.model.name,'model.name');
 if(!Array.isArray(submission.results)||submission.results.length!==source.size)fail('results count does not match the original records');
 const seen=new Set();
 for(const result of submission.results){
  if(!object(result)||!source.has(result.conversation_id)||seen.has(result.conversation_id))fail('results must contain each original conversation_id exactly once');
  const id=result.conversation_id;seen.add(id);
  if(result.status==='error'){
   exactKeys(result,['conversation_id','status','criteria','score','error'],'error result');
   if(!Array.isArray(result.criteria)||result.criteria.length||result.score!==null)fail('error result needs empty criteria and null score');
   if(nonempty(result.error,'error').length>240)fail('error must be short');continue;
  }
  if(result.status!=='ok')fail('status must be ok or error');
  exactKeys(result,['conversation_id','status','criteria','score'],'ok result');
  if(!Array.isArray(result.criteria)||result.criteria.length!==RULES.length)fail('ok result needs all eight criteria');
  const criterionIds=new Set();
  for(const criterion of result.criteria){
   exactKeys(criterion,['criterion_id','value','rationale','evidence_turns'],'criterion');
   const rule=RULES.find(item=>item.id===criterion.criterion_id);
   if(!rule||criterionIds.has(rule.id))fail('unknown or duplicate official criterion_id');criterionIds.add(rule.id);
   checkCriterion(criterion,rule,source.get(id),id+'/'+rule.id);
  }
  exactKeys(result.score,['final_score','critical_flag'],'score');const expected=officialScore(result.criteria);
  if(result.score.final_score!==expected.final_score||result.score.critical_flag!==expected.critical_flag)fail('score must match official weighted values and critical criterion');
 }
 return true;
}
