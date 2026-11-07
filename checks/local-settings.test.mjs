import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep,basename} from 'node:path';
import {createLocalSettings} from '../local-settings.mjs';

const BASE='http://localhost:4173',TOKEN='fixture-csrf-token-0123456789';
const KEY_A='sk-proj-fixture-'+ 'A'.repeat(32),KEY_B='sk-proj-fixture-'+ 'B'.repeat(32);
async function fixture(t,{text='',env={}}={}){
 const dir=await mkdtemp(join(tmpdir(),'cqa-local-settings-'));
 t.after(async()=>{const full=resolve(dir),parent=resolve(tmpdir());assert.ok(full.startsWith(parent+sep)&&basename(full).startsWith('cqa-local-settings-'));await rm(full,{recursive:true,force:true});});
 const envPath=join(dir,'.env');await writeFile(envPath,text,'utf8');
 return {dir,envPath,env,handle:createLocalSettings({env,envPath,token:TOKEN})};
}
function post(payload,{origin=BASE,token=TOKEN,url=BASE+'/api/ai/config',headers={}}={}){
 const requestHeaders={'Content-Type':'application/json',...headers};if(origin!==null)requestHeaders.Origin=origin;if(token!==null)requestHeaders['X-CQA-Setup-Token']=token;
 return new Request(url,{method:'POST',headers:requestHeaders,body:JSON.stringify(payload)});
}

test('GET reports local state and process CSRF token without exposing the API key',async t=>{
 const f=await fixture(t,{env:{AI_PROVIDER:'openai',OPENAI_API_KEY:KEY_A,OPENAI_MODEL:'gpt-5.4'}});
 const r=await f.handle(new Request(BASE+'/api/ai/config'));const body=await r.json();
 assert.deepEqual(body,{localConfiguration:true,provider:'openai',configured:true,model:'gpt-5.4',csrfToken:TOKEN});assert.ok(!JSON.stringify(body).includes(KEY_A));assert.equal(r.headers.get('Cache-Control'),'no-store');
 const empty=await fixture(t);assert.equal((await (await empty.handle(new Request(BASE+'/api/ai/config'))).json()).model,'gemini-3.5-flash-lite');
 assert.equal(await f.handle(new Request(BASE+'/api/elsewhere')),null);
});

test('Only loopback requests and exact same-origin setup are permitted',async t=>{
 const f=await fixture(t,{env:{AI_PROVIDER:'openai',OPENAI_API_KEY:KEY_A}});
 for(const request of [new Request('https://hosted.example/api/ai/config'),new Request(BASE+'/api/ai/config',{headers:{Origin:'https://evil.example'}}),post({model:'gpt-5.4'},{origin:'http://127.0.0.1:4173'}),post({model:'gpt-5.4'},{origin:null}),post({model:'gpt-5.4'},{origin:BASE+'/'})])assert.equal((await f.handle(request)).status,403);
 for(const origin of ['http://127.0.0.1:4173','http://[::1]:4173'])assert.equal((await f.handle(new Request(origin+'/api/ai/config',{headers:{Origin:origin}}))).status,200);
 assert.equal(await readFile(f.envPath,'utf8'),'');
});

test('POST rejects missing, wrong-length and same-length wrong CSRF tokens',async t=>{
 const f=await fixture(t,{env:{AI_PROVIDER:'openai',OPENAI_API_KEY:KEY_A}});
 for(const token of [null,'short','x'.repeat(TOKEN.length)])assert.equal((await f.handle(post({model:'gpt-5.4'},{token}))).status,403);
 assert.equal(f.env.OPENAI_MODEL,undefined);assert.equal(await readFile(f.envPath,'utf8'),'');
});

test('Valid save preserves unrelated settings and BOM, replaces duplicate AI entries, and never echoes secret',async t=>{
 const f=await fixture(t,{text:'\uFEFF# local settings\r\nORGANIZER_API_URL=https://fixture.invalid/?sig=organizer-fixture\r\nOTHER=keep-this\r\nOPENAI_API_KEY='+KEY_A+'\r\nOPENAI_MODEL=old-model\r\nOPENAI_API_KEY=duplicate-fixture\r\n',env:{AI_PROVIDER:'openai',OPENAI_API_KEY:KEY_A,OPENAI_MODEL:'old-model',OTHER:'keep-this'}});
 const r=await f.handle(post({apiKey:'  '+KEY_B+'  ',model:'gpt-5.4'}));assert.equal(r.status,200);
 const body=await r.json();assert.deepEqual(body,{localConfiguration:true,provider:'openai',configured:true,model:'gpt-5.4'});assert.ok(!JSON.stringify(body).includes(KEY_B));
 const stored=await readFile(f.envPath,'utf8');assert.ok(stored.startsWith('\uFEFF'));assert.ok(stored.includes('ORGANIZER_API_URL=https://fixture.invalid/?sig=organizer-fixture\r\n'));assert.ok(stored.includes('OTHER=keep-this\r\n'));assert.equal((stored.match(/^OPENAI_API_KEY=/gm)||[]).length,1);assert.ok(stored.includes('OPENAI_API_KEY='+KEY_B+'\r\n'));assert.ok(!stored.includes(KEY_A));
 assert.equal(f.env.OPENAI_API_KEY,KEY_B);assert.equal(f.env.OPENAI_MODEL,'gpt-5.4');assert.equal(f.env.OTHER,'keep-this');assert.deepEqual(await readdir(f.dir),['.env']);
});

test('Empty API key preserves current key while explicit removal disconnects and removes file entries',async t=>{
 const f=await fixture(t,{text:'ORGANIZER_API_URL=keep\nOPENAI_API_KEY='+KEY_A+'\n',env:{AI_PROVIDER:'openai',OPENAI_API_KEY:KEY_A}});
 assert.equal((await f.handle(post({apiKey:'',model:'gpt-5.4-mini'}))).status,200);assert.equal(f.env.OPENAI_API_KEY,KEY_A);
 const removed=await f.handle(post({removeKey:true,model:'gpt-5.4'}));assert.equal(removed.status,200);assert.equal((await removed.json()).configured,false);assert.equal(f.env.OPENAI_API_KEY,undefined);
 const text=await readFile(f.envPath,'utf8');assert.ok(!text.includes('OPENAI_API_KEY'));assert.ok(text.includes('ORGANIZER_API_URL=keep'));assert.ok(!text.includes(KEY_A));
 const noKey=await f.handle(post({model:'gpt-5.4'}));assert.equal(noKey.status,400);
});

test('Invalid key and model forms cannot change disk or shared state',async t=>{
 const f=await fixture(t,{text:'ORGANIZER_API_URL=keep\n',env:{AI_PROVIDER:'openai',OPENAI_API_KEY:KEY_A}});
 const invalid=[{apiKey:'too-short',model:'gpt-5.4'},{apiKey:'x'.repeat(513),model:'gpt-5.4'},{apiKey:'x'.repeat(22)+' secret',model:'gpt-5.4'},{apiKey:'x'.repeat(22)+'\nINJECTED=1',model:'gpt-5.4'},{apiKey:'sk-********************',model:'gpt-5.4'},{apiKey:'sk-proj-...masked-fixture',model:'gpt-5.4'},{apiKey:'sk-proj-'+ 'я'.repeat(24),model:'gpt-5.4'},{apiKey:KEY_B,model:'bad model'},{apiKey:KEY_B,model:'x'.repeat(101)},{apiKey:KEY_B,model:'gpt\nEXTRA=1'},{apiKey:KEY_B,model:'gpt-5.4',removeKey:true},{apiKey:123,model:'gpt-5.4'},{model:'gpt-5.4',removeKey:'true'},{model:'gpt-5.4',extra:'unsupported'},null,[]];
 for(const payload of invalid){const r=await f.handle(post(payload));assert.equal(r.status,400);const body=JSON.stringify(await r.json());assert.ok(!body.includes(KEY_A));assert.ok(!body.includes(KEY_B));}
 assert.equal(await readFile(f.envPath,'utf8'),'ORGANIZER_API_URL=keep\n');assert.equal(f.env.OPENAI_API_KEY,KEY_A);assert.equal(f.env.OPENAI_MODEL,undefined);
});

test('JSON/content-type and method validation return safe errors',async t=>{
 const f=await fixture(t);const headers={Origin:BASE,'X-CQA-Setup-Token':TOKEN,'Content-Type':'application/json'};
 assert.equal((await f.handle(new Request(BASE+'/api/ai/config',{method:'POST',headers,body:'not-json'}))).status,400);
 assert.equal((await f.handle(post({model:'gpt-5.4'},{headers:{'Content-Type':'text/plain'}}))).status,400);
 const unsupported=await f.handle(new Request(BASE+'/api/ai/config',{method:'DELETE'}));assert.equal(unsupported.status,405);assert.equal(unsupported.headers.get('Allow'),'GET, POST');
});

test('8KB limit is enforced on declared and streamed body size, even with lying Content-Length',async t=>{
 const f=await fixture(t);const headers={Origin:BASE,'X-CQA-Setup-Token':TOKEN,'Content-Type':'application/json','Content-Length':'9000'};
 assert.equal((await f.handle(new Request(BASE+'/api/ai/config',{method:'POST',headers,body:'{}'}))).status,413);
 let cancelled=false;
 const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(4096));controller.enqueue(new Uint8Array(4096));controller.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}});
 const r=await f.handle(new Request(BASE+'/api/ai/config',{method:'POST',headers:{...headers,'Content-Length':'2'},body:stream,duplex:'half'}));
 assert.equal(r.status,413);assert.equal(cancelled,true);assert.equal(await readFile(f.envPath,'utf8'),'');assert.equal(f.env.OPENAI_API_KEY,undefined);
});

test('Failed atomic persistence does not update shared environment or expose paths/secrets',async t=>{
 const f=await fixture(t,{env:{AI_PROVIDER:'openai',OPENAI_API_KEY:KEY_A,OPENAI_MODEL:'existing'}});
 const impossible=join(f.dir,'missing-parent','.env');const handle=createLocalSettings({env:f.env,envPath:impossible,token:TOKEN});
 const r=await handle(post({apiKey:KEY_B,model:'gpt-5.4'}));assert.equal(r.status,500);const body=JSON.stringify(await r.json());
 assert.ok(!body.includes(KEY_B));assert.ok(!body.includes(impossible));assert.equal(f.env.OPENAI_API_KEY,KEY_A);assert.equal(f.env.OPENAI_MODEL,'existing');assert.deepEqual(await readdir(f.dir),['.env']);
});

test('Sequentialized concurrent saves retain the most recent key and unrelated file values',async t=>{
 const f=await fixture(t,{text:'ORGANIZER_API_URL=keep\n',env:{AI_PROVIDER:'openai',OPENAI_MODEL:'gpt-5.4',OPENAI_API_KEY:KEY_A}});
 const first=f.handle(post({apiKey:KEY_A,model:'gpt-5.4'}));const second=f.handle(post({apiKey:KEY_B,model:'gpt-5.4-mini'}));
 const responses=await Promise.all([first,second]);assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.equal(f.env.OPENAI_API_KEY,KEY_B);assert.equal(f.env.OPENAI_MODEL,'gpt-5.4-mini');
 const text=await readFile(f.envPath,'utf8');assert.ok(text.includes('ORGANIZER_API_URL=keep'));assert.ok(text.includes(KEY_B));assert.ok(!text.includes(KEY_A));assert.deepEqual(await readdir(f.dir),['.env']);
});

test('Local model settings reject names that the assessment API cannot use',async t=>{
 const f=await fixture(t,{env:{AI_PROVIDER:'openai',OPENAI_API_KEY:KEY_A,OPENAI_MODEL:'gpt-5.4'}});
 for(const model of ['.model','-model','_model',':model']){
  const r=await f.handle(post({model}));assert.equal(r.status,400);assert.equal(f.env.OPENAI_MODEL,'gpt-5.4');
 }
 assert.equal(await readFile(f.envPath,'utf8'),'');
});

test('Explicit Gemini settings store and remove only Gemini credentials, preserving legacy configuration',async t=>{
 const f=await fixture(t,{text:'OPENAI_API_KEY=legacy-preserve\nOTHER=keep\n',env:{AI_PROVIDER:'gemini',OPENAI_API_KEY:KEY_A}});
 const config=await (await f.handle(new Request(BASE+'/api/ai/config'))).json();assert.equal(config.provider,'gemini');assert.equal(config.configured,false);
 const model='gemini-3.5-flash-lite';assert.equal((await f.handle(post({apiKey:KEY_B,model}))).status,200);assert.equal(f.env.GEMINI_API_KEY,KEY_B);assert.equal(f.env.OPENAI_API_KEY,KEY_A);
 let text=await readFile(f.envPath,'utf8');assert.ok(text.includes('GEMINI_API_KEY='+KEY_B));assert.ok(text.includes('OPENAI_API_KEY=legacy-preserve'));
 assert.equal((await f.handle(post({removeKey:true,model}))).status,200);text=await readFile(f.envPath,'utf8');assert.ok(!text.includes('GEMINI_API_KEY='));assert.ok(text.includes('OTHER=keep'));
});

test('Groq settings preserve Gemini credentials, accept slash model ID and never echo key',async t=>{
 const groqKey='gsk_fixture_'+'G'.repeat(32),f=await fixture(t,{env:{AI_PROVIDER:'groq',GROQ_API_KEY:groqKey,GEMINI_API_KEY:KEY_A},text:'GEMINI_API_KEY='+KEY_A+'\nGEMINI_MODEL=gemini-3.5-flash-lite\n'});
 const config=await (await f.handle(new Request(BASE+'/api/ai/config'))).json();assert.equal(config.provider,'groq');assert.equal(config.model,'openai/gpt-oss-120b');assert.equal(config.configured,true);assert.ok(!JSON.stringify(config).includes(groqKey));
 const saved=await f.handle(post({model:'openai/gpt-oss-120b'}));assert.equal(saved.status,200);assert.ok(!JSON.stringify(await saved.json()).includes(groqKey));
 let text=await readFile(f.envPath,'utf8');assert.ok(text.includes('GROQ_API_KEY='+groqKey));assert.ok(text.includes('GEMINI_API_KEY='+KEY_A));assert.equal(f.env.GEMINI_API_KEY,KEY_A);
 assert.equal((await f.handle(post({model:'groq:invalid'}))).status,400);assert.equal(f.env.GROQ_MODEL,'openai/gpt-oss-120b');
 assert.equal((await f.handle(post({model:'openai/gpt-oss-120b',removeKey:true}))).status,200);text=await readFile(f.envPath,'utf8');assert.ok(!text.includes('GROQ_API_KEY='));assert.ok(text.includes('GEMINI_API_KEY='+KEY_A));
});

test('Legacy OpenAI local settings stay on the existing provider without AI_PROVIDER',async t=>{
 const f=await fixture(t,{text:'OTHER=keep\n',env:{OPENAI_API_KEY:KEY_A,OPENAI_MODEL:'gpt-5.4'}});
 const initial=await (await f.handle(new Request(BASE+'/api/ai/config'))).json();assert.equal(initial.provider,'openai');assert.equal(initial.configured,true);
 const saved=await f.handle(post({apiKey:KEY_B,model:'gpt-5.4'}));assert.equal(saved.status,200);assert.equal((await saved.json()).provider,'openai');assert.equal(f.env.OPENAI_API_KEY,KEY_B);assert.equal(f.env.GEMINI_API_KEY,undefined);
});

test('Gemini local model validation matches its adapter before saving settings',async t=>{
 const f=await fixture(t,{text:'OTHER=keep\n',env:{AI_PROVIDER:'gemini',GEMINI_API_KEY:KEY_A,GEMINI_MODEL:'gemini:invalid'}});
 const initial=await (await f.handle(new Request(BASE+'/api/ai/config'))).json();assert.equal(initial.configured,false);
 for(const model of ['gemini:invalid','g'.repeat(121),''])assert.equal((await f.handle(post({model}))).status,400);
 assert.equal(await readFile(f.envPath,'utf8'),'OTHER=keep\n');assert.equal(f.env.GEMINI_MODEL,'gemini:invalid');
 assert.equal((await f.handle(post({model:'g'.repeat(120)}))).status,200);assert.equal(f.env.GEMINI_MODEL,'g'.repeat(120));
});

test('Unknown provider rejects local configuration reads and saves without mutating disk',async t=>{
 const f=await fixture(t,{text:'OTHER=keep\n',env:{AI_PROVIDER:'unsupported-private-value',OPENAI_API_KEY:KEY_A}});
 for(const request of [new Request(BASE+'/api/ai/config'),post({model:'gpt-5.4',apiKey:KEY_B})]){
  const response=await f.handle(request);assert.equal(response.status,400);const body=await response.json();assert.equal(body.code,'INVALID_PROVIDER');assert.ok(!JSON.stringify(body).includes(f.env.AI_PROVIDER));
 }
 assert.equal(await readFile(f.envPath,'utf8'),'OTHER=keep\n');assert.equal(f.env.OPENAI_API_KEY,KEY_A);
});
