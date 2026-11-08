import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fetchDataset} from '../worker/api.mjs';

const args=process.argv.slice(2);
function option(name){const i=args.indexOf(name);return i>=0?args[i+1]:undefined;}
const group=option('--group'),output=option('--output');
if(!['DEV','FBroker','Swap'].includes(group)||!output){
 console.error('Usage: node scripts/fetch-datasets.mjs --group DEV|FBroker|Swap --output ../data/dataset.json');
 process.exit(1);
}
try{
 for(const file of ['.env','judge-config.env']){try{process.loadEnvFile(fileURLToPath(new URL('../'+file,import.meta.url)));}catch(error){if(error.code!=='ENOENT')throw error;}}
 const dataset=await fetchDataset(group,process.env,{refresh:true});
 const ids=dataset.records.map(record=>record.conversation_id);
 if(ids.some(id=>typeof id!=='string'||!id.trim())||new Set(ids).size!==ids.length)throw Error('Invalid source IDs');
 if(dataset.dataset_group_id&&dataset.dataset_group_id!==group)throw Error('Unexpected dataset');
 if(group==='FBroker'&&ids.length!==10)throw Error('FBroker must have exactly 10 records');
 const path=resolve(output);await mkdir(dirname(path),{recursive:true});
 await writeFile(path,JSON.stringify({isSuccess:true,data:dataset,synced_at:new Date().toISOString()},null,2)+'\n','utf8');
 console.log(JSON.stringify({group,count:ids.length,saved:true,assessed:false}));
}catch{
 console.error('Dataset download failed. Check ORGANIZER_API_URL, group and connectivity. No credentials are printed.');
 process.exitCode=1;
}
