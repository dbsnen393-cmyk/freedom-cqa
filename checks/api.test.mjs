import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicDataset,extractMediaUrl,rangeResponse,fetchDataset,handleApi} from '../worker/api.mjs';
test('Public payload never exposes upstream signed audio URLs',()=>{const result=publicDataset({records:[{conversation_id:'id 1',channel:'voice call',language:'RU',transcript:[],audio_url:'https://private.invalid/?sig=secret'}]},'DEV');assert.equal(result.data.records[0].audio_url,'/api/audio?group_id=DEV&conversation_id=id%201');assert.ok(!JSON.stringify(result).includes('secret'));});
test('Player URL extraction decodes entities and rejects unknown destinations',()=>{assert.equal(extractMediaUrl('<audio><source src="https://freedomholdingcorporation.crm11.dynamics.com/a?x=1&amp;y=2"></audio>'),'https://freedomholdingcorporation.crm11.dynamics.com/a?x=1&y=2');assert.throws(()=>extractMediaUrl('<audio src="https://attacker.invalid/file">'));assert.throws(()=>extractMediaUrl('<html>no audio</html>'));});
test('Range proxy supports normal, suffix, invalid and HEAD requests',async()=>{const bytes=new Uint8Array([0,1,2,3,4,5]);let r=rangeResponse(bytes,'audio/mpeg','bytes=2-4');assert.equal(r.status,206);assert.equal(r.headers.get('Content-Range'),'bytes 2-4/6');assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[2,3,4]);r=rangeResponse(bytes,'audio/mpeg','bytes=-2');assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[4,5]);assert.equal(rangeResponse(bytes,'audio/mpeg','bytes=8-9').status,416);assert.equal(rangeResponse(bytes,'audio/mpeg','bytes=-0').status,416);assert.equal(rangeResponse(bytes,'audio/mpeg','bytes=1-2','HEAD').body,null);});
test('Source group is sent upstream and forced refresh really fetches new data',async()=>{let calls=0;const fetcher=async url=>{calls++;assert.equal(new URL(url).searchParams.get('group_id'),'NEW');return Response.json({isSuccess:true,data:{records:[{conversation_id:'new-'+calls}]}});};const env={ORGANIZER_API_URL:'https://ec88f21f1accecf38e20095a9fe175.a5.environment.api.powerplatform.com/?sig=fixture'};const a=await fetchDataset('NEW',env,{refresh:true,fetcher});const b=await fetchDataset('NEW',env,{refresh:true,fetcher});assert.notEqual(a.records[0].conversation_id,b.records[0].conversation_id);assert.equal(calls,2);});
test('Missing configuration and unsupported methods return clear errors without secrets',async()=>{const missing=await handleApi(new Request('https://local/api/datasets'),{});assert.equal(missing.status,502);assert.match((await missing.json()).error,/не настроено/);const method=await handleApi(new Request('https://local/api/datasets',{method:'POST'}),{});assert.equal(method.status,405);});

test('Preparation endpoint runs the shared engine without credentials or model calls',async()=>{
 const conversation={id:'api-1',channel:'agent chat',language:'RU',messages:[{id:1,role:'client',time:'00:00',text:'Почта client@example.com'},{id:2,role:'operator',time:'00:10',text:'Здравствуйте!'}]};
 const criteria=[{id:'test',title:'Контакт',description:'Проверить приветствие.',weight:10,type:'boolean',scale:[],allowNA:false,naRule:''}];
 const r=await handleApi(new Request('https://local/api/preprocess',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversation,criteria,checklistVersion:1})}),{});assert.equal(r.status,200);const result=await r.json();assert.equal(result.packet.transcript.length,2);assert.ok(!JSON.stringify(result).includes('client@example.com'));assert.equal(result.report.status,'prepared');
});
test('Preparation endpoint rejects malformed, oversize and semantically invalid requests',async()=>{
 const req=body=>new Request('https://local/api/preprocess',{method:'POST',headers:{'Content-Type':'application/json'},body});
 assert.equal((await handleApi(req('{bad'),{})).status,400);
 assert.equal((await handleApi(req('x'.repeat(600001)),{})).status,413);
 assert.equal((await handleApi(req(JSON.stringify({conversation:{id:'x',messages:[]},criteria:[],checklistVersion:1})),{})).status,422);
 assert.equal((await handleApi(new Request('https://local/api/preprocess'),{})).status,405);
});
