import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {handleApi} from './worker/api.mjs';
const root=fileURLToPath(new URL('./web/',import.meta.url));
const env={...process.env};
try{for(const line of (await readFile(new URL('./.env',import.meta.url),'utf8')).split(/\r?\n/)){const m=/^([A-Z_]+)=(.*)$/.exec(line.trim());if(m&&!env[m[1]])env[m[1]]=m[2];}}catch{}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json'};
const port=Number(process.env.PORT||4173);
createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:'+port);
  const api=await handleApi(new Request(url,{method:req.method,headers:req.headers}),env);
  if(api){res.writeHead(api.status,Object.fromEntries(api.headers));res.end(Buffer.from(await api.arrayBuffer()));return;}
  const path=decodeURIComponent(url.pathname),target=resolve(root,'.'+(path==='/'?'/index.html':path));
  if(!target.startsWith(resolve(root)+sep)){res.writeHead(403);res.end('Forbidden');return;}
  const body=await readFile(target);
  res.writeHead(200,{'Content-Type':mime[extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);
 }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Не удалось обработать запрос.'}));}
}).listen(port,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+port));
