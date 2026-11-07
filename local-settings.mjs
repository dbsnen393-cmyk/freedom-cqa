import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile,open,rename,unlink} from 'node:fs/promises';
import {resolve,dirname,basename,join} from 'node:path';

const LIMIT=8*1024;
const MODEL=/^[a-zA-Z0-9._:-]{1,100}$/;
const LOOPBACK=new Set(['localhost','127.0.0.1','[::1]','::1']);
class SetupError extends Error{constructor(status,message){super(message);this.status=status;}}
const response=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
function tokenMatches(actual,expected){
 if(typeof actual!=='string')return false;
 const left=Buffer.from(actual,'utf8'),right=Buffer.from(expected,'utf8');
 return left.length===right.length&&timingSafeEqual(left,right);
}
async function bodyJson(request){
 const declared=request.headers.get('Content-Length');
 if(declared!==null&&Number(declared)>LIMIT)throw new SetupError(413,'Слишком большой запрос настроек.');
 if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('Content-Type')||''))throw new SetupError(400,'Ожидается JSON с настройками.');
 if(!request.body)throw new SetupError(400,'Отсутствуют настройки.');
 const reader=request.body.getReader(),chunks=[];let size=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>LIMIT){await reader.cancel().catch(()=>{});throw new SetupError(413,'Слишком большой запрос настроек.');}chunks.push(value);}
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let payload;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new SetupError(400,'Не удалось прочитать JSON настроек.');}
 if(!payload||Array.isArray(payload)||typeof payload!=='object')throw new SetupError(400,'Ожидается объект настроек.');
 if(Object.keys(payload).some(key=>!['apiKey','model','removeKey'].includes(key)))throw new SetupError(400,'Неизвестное поле настроек.');
 if(typeof payload.model!=='string'||!MODEL.test(payload.model))throw new SetupError(400,'Укажите корректное имя модели.');
 if(payload.apiKey!==undefined&&typeof payload.apiKey!=='string')throw new SetupError(400,'Ключ должен быть строкой.');
 if(payload.removeKey!==undefined&&typeof payload.removeKey!=='boolean')throw new SetupError(400,'Параметр удаления ключа должен быть логическим.');
 const apiKey=payload.apiKey?.trim()||'';
 if(apiKey&&(apiKey.length<20||apiKey.length>512||!/^[\x21-\x7e]+$/.test(apiKey)||/\*|\.{3}|<|>|(?:redacted|masked|your[_-]?(?:openai[_-]?)?(?:api[_-]?)?key|placeholder)/i.test(apiKey)))throw new SetupError(400,'Ключ должен быть полным, без пробелов и скрытых символов.');
 if(payload.removeKey&&apiKey)throw new SetupError(400,'Удаление и сохранение нового ключа нельзя выполнить одновременно.');
 return {model:payload.model,apiKey,removeKey:payload.removeKey===true};
}
function replaceSettings(original,apiKey,model){
 const hadBOM=original.startsWith('\uFEFF'),text=hadBOM?original.slice(1):original;
 const newline=text.includes('\r\n')?'\r\n':'\n';
 const lines=text.split(/\r?\n/);if(lines.at(-1)==='')lines.pop();
 const kept=lines.filter(line=>!/^\s*(?:export\s+)?(?:OPENAI_API_KEY|OPENAI_MODEL)\s*=/.test(line));
 if(apiKey)kept.push('OPENAI_API_KEY='+apiKey);
 kept.push('OPENAI_MODEL='+model);
 return (hadBOM?'\uFEFF':'')+kept.join(newline)+newline;
}
async function atomicWrite(filePath,text){
 const tempPath=join(dirname(filePath),'.'+basename(filePath)+'.cqa-'+randomBytes(12).toString('hex')+'.tmp');
 let file=null,created=false;
 try{
  file=await open(tempPath,'wx',0o600);created=true;await file.writeFile(text,'utf8');await file.sync();await file.close();file=null;
  await rename(tempPath,filePath);created=false;
 }finally{
  if(file)await file.close().catch(()=>{});
  if(created)await unlink(tempPath).catch(()=>{});
 }
}
/** Local Node server only. Never include this helper in the hosted Worker bundle. */
export function createLocalSettings({env,envPath,token=randomBytes(32).toString('hex')}){
 if(!env||typeof env!=='object'||typeof envPath!=='string'||!envPath||typeof token!=='string'||!token)throw new TypeError('Некорректная конфигурация локальных настроек.');
 const filePath=resolve(envPath);let pending=Promise.resolve();
 const state=()=>({localConfiguration:true,configured:Boolean(env.OPENAI_API_KEY),model:env.OPENAI_MODEL||'gpt-5.4'});
 async function persist(settings){
  const apiKey=settings.removeKey?'':settings.apiKey||(env.OPENAI_API_KEY||'');
  if(!settings.removeKey&&!apiKey)throw new SetupError(400,'Введите API-ключ для подключения.');
  let current='';try{current=await readFile(filePath,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  await atomicWrite(filePath,replaceSettings(current,apiKey,settings.model));
  if(apiKey)env.OPENAI_API_KEY=apiKey;else delete env.OPENAI_API_KEY;
  env.OPENAI_MODEL=settings.model;
  return state();
 }
 return async function handle(request){
  const url=new URL(request.url);if(url.pathname!=='/api/ai/config')return null;
  try{
   if(!LOOPBACK.has(url.hostname))throw new SetupError(403,'Настройки доступны только на этом компьютере.');
   const origin=request.headers.get('Origin');
   if(origin!==null&&origin!==url.origin)throw new SetupError(403,'Недопустимый источник запроса.');
   if(request.method==='GET')return response({...state(),csrfToken:token});
   if(request.method!=='POST')return response({error:'Метод не поддерживается.'},405,{Allow:'GET, POST'});
   if(origin!==url.origin||!tokenMatches(request.headers.get('X-CQA-Setup-Token'),token))throw new SetupError(403,'Откройте настройки заново перед сохранением.');
   const settings=await bodyJson(request);
   const operation=pending.then(()=>persist(settings));pending=operation.catch(()=>{});
   return response(await operation);
  }catch(error){return response({error:error instanceof SetupError?error.message:'Не удалось сохранить настройки. Проверьте доступ к локальной папке проекта.'},error instanceof SetupError?error.status:500);}
 };
}
