import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
const root=new URL('./',import.meta.url);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const assets={};
for(const name of await readdir(new URL('web/',root))){const ext=name.slice(name.lastIndexOf('.'));if(!types[ext])continue;assets['/'+name]={body:await readFile(new URL('web/'+name,root),'utf8'),type:types[ext]};}
const api=(await readFile(new URL('worker/api.mjs',root),'utf8')).replace(/^export /gm,'');
const handler='\nexport default {async fetch(request,env){const api=await handleApi(request,env);if(api)return api;const url=new URL(request.url);const asset=ASSETS[url.pathname==="/"?"/index.html":url.pathname];if(!asset)return new Response("Not found",{status:404});return new Response(request.method==="HEAD"?null:asset.body,{headers:{"Content-Type":asset.type,"Cache-Control":"no-cache","X-Content-Type-Options":"nosniff"}});}};\n';
await mkdir(new URL('dist/server/',root),{recursive:true});
await writeFile(new URL('dist/server/index.js',root),api+'\nconst ASSETS='+JSON.stringify(assets)+';\n'+handler);
const manifest=JSON.parse(await readFile(new URL('.openai/hosting.json',root),'utf8'));
delete manifest.static;
await writeFile(new URL('.openai/hosting.json',root),JSON.stringify(manifest,null,2)+'\n');
await mkdir(new URL('dist/.openai/',root),{recursive:true});
await writeFile(new URL('dist/.openai/hosting.json',root),JSON.stringify(manifest,null,2)+'\n');
console.log('Worker bundle built with '+Object.keys(assets).length+' assets; secrets stay in environment.');
