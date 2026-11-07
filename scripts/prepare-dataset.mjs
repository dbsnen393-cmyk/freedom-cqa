import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {normalizeRecord} from '../web/timeline.js';
import {preprocessConversation,PREPROCESS_VERSION} from '../web/preprocess.js';
import {initialCriteria} from '../web/domain.js';
const inputIndex=process.argv.indexOf('--input'),outputIndex=process.argv.indexOf('--output');
if(inputIndex<0||outputIndex<0||!process.argv[inputIndex+1]||!process.argv[outputIndex+1])throw Error('Использование: node scripts/prepare-dataset.mjs --input ../data/dev-dataset.json --output ../data/DEV.prepared.json');
const input=JSON.parse(await readFile(resolve(process.argv[inputIndex+1]),'utf8'));
const records=Array.isArray(input)?input:input.data?.records||input.records;
if(!Array.isArray(records))throw Error('Не найден массив records.');
const seen=new Set(),items=[];
for(const record of records){const c=normalizeRecord(record,initialCriteria,1,'batch');if(seen.has(c.id))throw Error('Повторяется ID диалога.');seen.add(c.id);const result=await preprocessConversation(c,initialCriteria,1);items.push(result);}
const summary={processorVersion:PREPROCESS_VERSION,conversations:items.length,prepared:items.filter(x=>x.packet).length,blocked:items.filter(x=>!x.packet).length,review:items.filter(x=>x.report.status==='review').length,messages:items.reduce((n,x)=>n+x.report.facts.messageCount,0),newMasks:items.reduce((n,x)=>n+x.report.privacy.counts.total,0),existingMasks:items.reduce((n,x)=>n+x.report.privacy.counts.alreadyRedactedMarkers,0)};
const destination=resolve(process.argv[outputIndex+1]);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,JSON.stringify({summary,items},null,2));console.log(JSON.stringify(summary));
