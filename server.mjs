import {Readable} from 'node:stream';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {handleApi} from './worker/api.mjs';
import {createLocalSettings} from './local-settings.mjs';
const root=fileURLToPath(new URL('./web/',import.meta.url));
const env={...process.env};
try{for(const line of (await readFile(new URL('./.env',import.meta.url),'utf8')).split(/\r?\n/)){const m=/^([A-Z_]+)=(.*)$/.exec(line.trim());if(m&&!env[m[1]])env[m[1]]=m[2];}}catch{}
const localSettings=createLocalSettings({env,envPath:fileURLToPath(new URL('./.env',import.meta.url))});
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json'};
const port=Number(process.env.PORT||4173);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Некорректный порт локального сервиса.');
createServer(async(req,res)=>{
 try{
  const host=typeof req.headers.host==='string'?req.headers.host.toLowerCase():'';
  const match=/^(localhost|127\.0\.0\.1)(?::([0-9]{1,5}))?$/.exec(host);
  if(!match||Number(match[2]||80)!==port){res.writeHead(403,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Недопустимый адрес локального сервиса.',code:'HOST_REJECTED'}));return;}
  const origin=new URL('http://'+host).origin,url=new URL(req.url,origin);
  if(url.origin!==origin||url.username||url.password){res.writeHead(403,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Недопустимый адрес запроса.',code:'HOST_REJECTED'}));return;}
  const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
  const api=await localSettings(request)||await handleApi(request,env);
  if(api){res.writeHead(api.status,Object.fromEntries(api.headers));res.end(req.method==='HEAD'?undefined:Buffer.from(await api.arrayBuffer()));return;}
  const path=decodeURIComponent(url.pathname),target=resolve(root,'.'+(path==='/'?'/index.html':path));
  if(!target.startsWith(resolve(root)+sep)){res.writeHead(403);res.end('Forbidden');return;}
  const body=await readFile(target);
  res.writeHead(200,{'Content-Type':mime[extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);
 }catch{res.writeHead(500,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Не удалось обработать запрос.',code:'INTERNAL_ERROR'}));}
}).listen(port,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+port));
