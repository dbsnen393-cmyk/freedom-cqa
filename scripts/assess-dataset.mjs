#!/usr/bin/env node
import {readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';
import {resolve,dirname,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {assessConversation,configuredAI,validateAssessment,ASSESSMENT_PROMPT_VERSION} from '../worker/assessment.mjs';
import {normalizeRecord} from '../web/timeline.js';
import {initialCriteria} from '../web/domain.js';
import {preprocessConversation} from '../web/preprocess.js';
import {buildSubmission,validateSubmission} from '../web/submission.js';

const PROJECT_ROOT=fileURLToPath(new URL('../',import.meta.url));
const VERSION=1,START_INTERVAL_MS=13000,RETRY_COOLDOWN_MS=65000;
const TRANSIENT=new Set(['GEMINI_LIMIT','GEMINI_NETWORK','GEMINI_TIMEOUT','GROQ_LIMIT','GROQ_NETWORK','GROQ_TIMEOUT','OPENAI_LIMIT','OPENAI_RATE_LIMIT','OPENAI_NETWORK','OPENAI_TIMEOUT']);
const FATAL=new Set(['GEMINI_AUTH','GROQ_AUTH','OPENAI_AUTH','OPENAI_ACCESS','GEMINI_MODEL_NOT_FOUND','GROQ_MODEL_NOT_FOUND','INVALID_MODEL','INVALID_PROVIDER','GEMINI_NOT_CONFIGURED','GROQ_NOT_CONFIGURED','OPENAI_NOT_CONFIGURED','OPENAI_MODEL_NOT_FOUND','OPENAI_QUOTA']);
class BatchError extends Error{constructor(code){super(code);this.code=code;}}
const codeOf=error=>typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)?error.code:'ASSESSMENT_FAILED';
const log=value=>process.stdout.write(JSON.stringify(value)+'\n');
const errorResult=code=>({status:'error',code,error:'Оценка не получена.'});

export function parseArgs(argv){
 const args={dryRun:false,retryErrors:false};
 const names={'--input':'input','--group':'group','--team':'team','--output':'output','--cache-dir':'cacheDir'};
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];if(arg==='--dry-run'){args.dryRun=true;continue;}if(arg==='--retry-errors'){args.retryErrors=true;continue;}
  const key=names[arg];if(!key||!argv[i+1]||argv[i+1].startsWith('--')||args[key]!==undefined)throw new BatchError('INVALID_ARGUMENTS');args[key]=argv[++i];
 }
 if(['input','group','team','output','cacheDir'].some(key=>typeof args[key]!=='string'||!args[key].trim()))throw new BatchError('MISSING_ARGUMENTS');
 if(args.group.toLowerCase()==='swap')throw new BatchError('SWAP_ASSESSMENT_FORBIDDEN');
 if(!['FBroker','DEV'].includes(args.group))throw new BatchError('UNSUPPORTED_GROUP');
 args.input=resolve(args.input);args.output=resolve(args.output);args.cacheDir=resolve(args.cacheDir);
 if(args.input===args.output)throw new BatchError('INPUT_OUTPUT_COLLISION');
 // Raw model answers must not accidentally enter the source repository or submission commit.
 const cacheRelative=relative(PROJECT_ROOT,args.cacheDir);
 if(!cacheRelative||(!cacheRelative.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&!isAbsolute(cacheRelative)))throw new BatchError('CACHE_MUST_BE_OUTSIDE_PROJECT');
 return args;
}
async function atomicJSON(path,value){
 await mkdir(dirname(path),{recursive:true});
 const temporary=path+'.tmp-'+process.pid+'-'+randomUUID();
 try{await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{encoding:'utf8',mode:0o600});await rename(temporary,path);}
 finally{await unlink(temporary).catch(()=>{});}
}
async function cachedJSON(path){try{return JSON.parse(await readFile(path,'utf8'));}catch{return null;}}
function sameIdentity(cache,identity){return cache?.cacheVersion===1&&Object.keys(identity).every(key=>cache[key]===identity[key]);}
function usableSuccess(cache,identity,packet){
 if(!sameIdentity(cache,identity)||cache.status!=='success')return false;
 const result=cache.response,assessment=result?.assessment;
 if(result?.conversationId!==identity.conversationId||result.sourceFingerprint!==identity.sourceFingerprint||result.checklistFingerprint!==identity.checklistFingerprint||assessment?.provider!==identity.provider||(assessment?.requestedModel||assessment?.model)!==identity.model||assessment?.promptVersion!==identity.promptVersion)return false;
 try{validateAssessment({answers:result.answers},packet);return true;}catch{return false;}
}

export async function runBatch(args){
 for(const file of ['.env','judge-config.env']){try{process.loadEnvFile(join(PROJECT_ROOT,file));}catch(error){if(error.code!=='ENOENT')throw new BatchError('ENV_LOAD_FAILED');}}
 const config=configuredAI(process.env);if(!config.configured)throw new BatchError(config.code||'PROVIDER_NOT_CONFIGURED');
 let input;try{input=JSON.parse(await readFile(args.input,'utf8'));}catch{throw new BatchError('INPUT_READ_FAILED');}
 const records=Array.isArray(input)?input:input.data?.records||input.records;
 if(!Array.isArray(records)||!records.length)throw new BatchError('INVALID_DATASET');
 const sourceGroup=input?.data?.dataset_group_id??input?.dataset_group_id;
 if(typeof sourceGroup==='string'&&sourceGroup.toLowerCase()==='swap')throw new BatchError('SWAP_ASSESSMENT_FORBIDDEN');
 if(typeof sourceGroup==='string'&&sourceGroup!==args.group)throw new BatchError('DATASET_GROUP_MISMATCH');
 const expectedCount=args.group==='FBroker'?10:records.length;
 if(records.length!==expectedCount)throw new BatchError('DATASET_COUNT_MISMATCH');
 const seen=new Set();for(const record of records){if(typeof record?.conversation_id!=='string'||!record.conversation_id||seen.has(record.conversation_id))throw new BatchError('INVALID_DATASET_IDS');seen.add(record.conversation_id);}
 const criteria=structuredClone(initialCriteria),assessments=new Map(),items=[];
 let success=0,errors=0,done=0,lastStart=0,stopCode=null;
 const progress=(id,status,result)=>log({...(id?{id}:{}),status,count:{done,total:records.length,success,error:errors},...(Number.isFinite(result?.finalScore)?{score:result.finalScore}:{}),...(result?.assessment?.usage?{usage:result.assessment.usage}:{})});
 // Preflight all records before spending any provider quota.
 for(const record of records){
  const id=record.conversation_id;let conversation,prepared;
  try{conversation=normalizeRecord(record,criteria,VERSION,args.group);prepared=await preprocessConversation(conversation,criteria,VERSION);}catch{}
  if(!prepared?.packet){items.push({id,error:'PREPROCESS_BLOCKED'});continue;}
  const identity={group:args.group,conversationId:id,sourceFingerprint:prepared.report.sourceFingerprint,checklistFingerprint:prepared.report.checklistFingerprint,provider:config.provider,model:config.model,promptVersion:ASSESSMENT_PROMPT_VERSION};
  const cachePath=join(args.cacheDir,encodeURIComponent(id)+'.json'),cache=await cachedJSON(cachePath);
  items.push({id,conversation,packet:prepared.packet,identity,cachePath,cache});
 }
 if(args.dryRun){
  for(const item of items){done++;if(item.error){errors++;progress(item.id,'error:'+item.error);}else if(usableSuccess(item.cache,item.identity,item.packet)){success++;progress(item.id,'cached',item.cache.response);}else progress(item.id,'prepared');}
  progress(null,'dry-run-complete');return errors?1:0;
 }
 await mkdir(args.cacheDir,{recursive:true});
 for(const item of items){
  const {id,identity,cachePath}=item;
  if(item.error){assessments.set(id,errorResult(item.error));errors++;done++;progress(id,'error:'+item.error);continue;}
  if(usableSuccess(item.cache,identity,item.packet)){assessments.set(id,item.cache.response);success++;done++;progress(id,'cached',item.cache.response);continue;}
  if(stopCode){assessments.set(id,errorResult('NOT_RUN_AFTER_FATAL'));errors++;done++;progress(id,'error:NOT_RUN_AFTER_FATAL');continue;}
  if(sameIdentity(item.cache,identity)&&item.cache.status==='error'&&!args.retryErrors){
   const code=codeOf(item.cache);assessments.set(id,errorResult(code));errors++;done++;progress(id,'cached-error:'+code);if(FATAL.has(code))stopCode=code;continue;
  }
  let result=null,failure=null;
  for(let attempt=0;attempt<2;attempt++){
   const delay=Math.max(0,lastStart+START_INTERVAL_MS-Date.now());if(delay)await sleep(delay);
   lastStart=Date.now();progress(id,attempt?'retrying':'assessing');
   try{result=await assessConversation(item.conversation,criteria,VERSION,process.env);break;}
   catch(error){failure=codeOf(error);if(attempt===0&&TRANSIENT.has(failure)){progress(id,'cooldown:'+failure);await sleep(RETRY_COOLDOWN_MS);continue;}break;}
  }
  if(result){
   assessments.set(id,result);success++;done++;
   try{await atomicJSON(cachePath,{cacheVersion:1,...identity,status:'success',response:result});}
   catch{stopCode='CACHE_WRITE_FAILED';progress(id,'cache-write-error',result);}
   progress(id,'success',result);
  }else{
   const code=failure||'ASSESSMENT_FAILED';assessments.set(id,errorResult(code));errors++;done++;
   try{await atomicJSON(cachePath,{cacheVersion:1,...identity,status:'error',code});}catch{stopCode='CACHE_WRITE_FAILED';}
   if(FATAL.has(code))stopCode=code;progress(id,'error:'+code);
  }
 }
 let submission;
 try{submission=buildSubmission({teamName:args.team,modelName:config.model,records,assessments,expectedCount});validateSubmission(submission,{records,expectedCount});}
 catch{throw new BatchError('SUBMISSION_VALIDATION_FAILED');}
 try{await atomicJSON(args.output,submission);}catch{throw new BatchError('OUTPUT_WRITE_FAILED');}
 progress(null,errors||stopCode?'complete-with-errors':'complete');return errors||stopCode?1:0;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.exitCode=await runBatch(parseArgs(process.argv.slice(2)));}
 catch(error){log({status:'fatal:'+codeOf(error),count:0});process.exitCode=1;}
}
