import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {initialCriteria} from '../web/domain.js';
import {normalizeRecord} from '../web/timeline.js';
import {preprocessConversation} from '../web/preprocess.js';
import {validateAssessment,ASSESSMENT_PROMPT_VERSION} from '../worker/assessment.mjs';
import {buildSubmission,validateSubmission} from '../web/submission.js';

const args=process.argv.slice(2),get=name=>args[args.indexOf(name)+1];
const options=['--input','--primary-cache','--fallback-cache','--output','--team'];
if(options.some(name=>!args.includes(name)||!get(name)||get(name).startsWith('--')))throw Error('Required: --input --primary-cache --fallback-cache --output --team');
const read=async path=>JSON.parse(await readFile(resolve(path),'utf8'));
const source=await read(get('--input')),records=source.data?.records||source.records;
if((source.data?.dataset_group_id||source.dataset_group_id)!=='FBroker'||records?.length!==10)throw Error('Only the ten FBroker control records are accepted');
const assessments=new Map();let primaryCount=0,fallbackCount=0;
for(const record of records){
 const id=record.conversation_id,path=encodeURIComponent(id)+'.json';
 const prepared=await preprocessConversation(normalizeRecord(record,initialCriteria,1,'FBroker'),initialCriteria,1);
 if(!prepared.packet)throw Error('Invalid source');
 const matches=cache=>cache.cacheVersion===1&&cache.group==='FBroker'&&cache.conversationId===id&&cache.promptVersion===ASSESSMENT_PROMPT_VERSION&&cache.sourceFingerprint===prepared.packet.sourceFingerprint&&cache.checklistFingerprint===prepared.packet.checklistFingerprint;
 const primary=await read(join(get('--primary-cache'),path));
 if(!matches(primary))throw Error('Primary cache does not match source/checklist/prompt');
 let selected=primary;
 if(primary.status==='error'){
  selected=await read(join(get('--fallback-cache'),path));
  if(!matches(selected))throw Error('Fallback cache does not match source/checklist/prompt');
  fallbackCount++;
 }else primaryCount++;
 if(selected.status!=='success')throw Error('No completed assessment');
 const response=selected.response;
 if(response?.conversationId!==id||response.sourceFingerprint!==selected.sourceFingerprint||response.checklistFingerprint!==selected.checklistFingerprint||response.assessment?.promptVersion!==selected.promptVersion||response.assessment?.provider!==selected.provider||(response.assessment?.requestedModel||response.assessment?.model)!==selected.model)throw Error('Response does not match cache metadata');
 validateAssessment({answers:response.answers},prepared.packet);assessments.set(id,response);
}
const result=buildSubmission({teamName:get('--team'),records,assessments,expectedCount:10});
validateSubmission(result,{records,expectedCount:10});
const output=resolve(get('--output'));await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n','utf8');
console.log(JSON.stringify({count:result.results.length,primary:primaryCount,fallback:fallbackCount,models:result.model.name,valid:true}));
