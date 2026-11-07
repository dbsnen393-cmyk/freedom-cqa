import {preprocessConversation} from '../web/preprocess.js';
import {AIError,assessConversation,configuredAI} from './assessment.mjs';
const datasetCache=new Map(), audioCache=new Map(), audioPending=new Map();
const DATA_TTL=60_000, AUDIO_TTL=240_000, MAX_AUDIO_BYTES=28*1024*1024;
const ORGANIZER_HOST="ec88f21f1accecf38e20095a9fe175.a5.environment.api.powerplatform.com";
const AUDIO_HOST="freedomholdingcorporation.crm11.dynamics.com";
function jsonResponse(value,status=200){return new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});}
function groupFrom(url){const group=url.searchParams.get("group_id")||"DEV";if(!/^[A-Za-z0-9_-]{1,64}$/.test(group))throw new Error("Некорректный group_id.");return group;}
function safeUrl(value,host){const u=new URL(value);if(u.protocol!=="https:"||u.hostname!==host||u.username||u.password)throw new Error("Недопустимый адрес источника.");return u;}
async function limitedFetch(url,options={}){
 return fetch(url,{...options,redirect:"error",signal:AbortSignal.timeout(45_000)});
}
export async function fetchDataset(group,env,{refresh=false,fetcher=limitedFetch}={}){
 if(!env.ORGANIZER_API_URL)throw new Error("Подключение к API организаторов ещё не настроено.");
 const cached=datasetCache.get(group);if(!refresh&&cached&&Date.now()-cached.at<DATA_TTL)return cached.data;
 const url=safeUrl(env.ORGANIZER_API_URL,ORGANIZER_HOST);url.searchParams.set("group_id",group);
 const response=await fetcher(url.href,{headers:{Accept:"application/json"}});
 if(!response.ok)throw new Error("API организаторов недоступен (HTTP "+response.status+").");
 const data=await response.json();
 if(data.isSuccess!==true||!Array.isArray(data.data?.records))throw new Error("API не вернул набор диалогов. Проверьте group_id.");
 if(data.data.records.length>5000)throw new Error("Набор слишком большой для текущей версии.");
 datasetCache.set(group,{at:Date.now(),data:data.data});return data.data;
}
export function publicDataset(dataset,group){
 return {isSuccess:true,error:"",data:{dataset_group_id:String(dataset.dataset_group_id||group),total_records:dataset.records.length,records:dataset.records.map(r=>({conversation_id:r.conversation_id,channel:r.channel,language:r.language,transcript:r.transcript,audio_url:r.audio_url?"/api/audio?group_id="+encodeURIComponent(group)+"&conversation_id="+encodeURIComponent(r.conversation_id):null}))},synced_at:new Date().toISOString()};
}
function htmlDecode(value){return value.replaceAll("&amp;","&").replaceAll("&#38;","&").replaceAll("&quot;",'"').replaceAll("&#39;","'");}
export function extractMediaUrl(html){
 const match=html.match(/<(?:source|audio)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
 if(!match)throw new Error("На странице записи не найден аудиопоток.");
 return safeUrl(htmlDecode(match[1]),AUDIO_HOST).href;
}
async function readLimited(response){
 if(Number(response.headers.get("Content-Length"))>MAX_AUDIO_BYTES)throw new Error("Аудиозапись превышает поддерживаемый размер.");
 const reader=response.body.getReader(),chunks=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MAX_AUDIO_BYTES)throw new Error("Аудиозапись превышает поддерживаемый размер.");chunks.push(value);}}
 catch(e){await reader.cancel();throw e;}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
async function getAudio(group,conversationId,env){
 const key=group+":"+conversationId,cached=audioCache.get(key);
 if(cached&&Date.now()-cached.at<AUDIO_TTL)return cached;
 if(audioPending.has(key))return audioPending.get(key);
 const pending=(async()=>{
 const data=await fetchDataset(group,env),r=data.records.find(r=>r.conversation_id===conversationId);
 if(!r?.audio_url)throw new Error("У этого диалога нет аудиозаписи.");
 const pageUrl=safeUrl(r.audio_url,ORGANIZER_HOST),page=await limitedFetch(pageUrl.href);
 if(!page.ok)throw new Error("Страница записи недоступна (HTTP "+page.status+").");
 let response=page;
 if((page.headers.get("Content-Type")||"").includes("text/html"))response=await limitedFetch(extractMediaUrl(await page.text()));
 if(!response.ok)throw new Error("Аудиопоток недоступен (HTTP "+response.status+").");
 const type=response.headers.get("Content-Type")||"audio/mpeg";
 if(!/^audio\/|^application\/octet-stream/i.test(type))throw new Error("Источник вернул данные, которые не являются аудио.");
 const audio={bytes:await readLimited(response),type,at:Date.now()};
 // Keep at most one recording in memory; other files can be fetched on demand.
 audioCache.clear();audioCache.set(key,audio);return audio;
 })();audioPending.set(key,pending);try{return await pending;}finally{audioPending.delete(key);}
}
export function rangeResponse(bytes,type,range,method="GET"){
 const total=bytes.byteLength,headers={"Content-Type":type,"Content-Length":String(total),"Accept-Ranges":"bytes","Cache-Control":"private, max-age=120","X-Content-Type-Options":"nosniff"};
 if(!range)return new Response(method==="HEAD"?null:bytes,{headers});
 const m=/^bytes=(\d*)-(\d*)$/.exec(range);
 if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416,headers:{"Content-Range":"bytes */"+total}});
 let start=m[1]?Number(m[1]):Math.max(0,total-Number(m[2]));
 let end=m[1]?(m[2]?Math.min(Number(m[2]),total-1):total-1):total-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=total||end<start)return new Response(null,{status:416,headers:{"Content-Range":"bytes */"+total}});
 return new Response(method==="HEAD"?null:bytes.slice(start,end+1),{status:206,headers:{...headers,"Content-Length":String(end-start+1),"Content-Range":"bytes "+start+"-"+end+"/"+total}});
}
const MAX_DIALOGUE_BODY=600000;
function apiError(code,message,status){return jsonResponse({error:message,code},status);}
function safeAIError(error){return error instanceof AIError?apiError(error.code,error.message,error.status):apiError('AI_INTERNAL','Не удалось завершить оценку. Результат не сохранён.',500);}
async function dialogueBody(request){
 if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('Content-Type')||''))throw new AIError('JSON_REQUIRED','Ожидается JSON.',415);
 if(Number(request.headers.get('Content-Length'))>MAX_DIALOGUE_BODY)throw new AIError('BODY_TOO_LARGE','Пакет превышает 600 КБ.',413);
 const reader=request.body?.getReader();if(!reader)throw new AIError('BODY_REQUIRED','Нет данных диалога.',400);
 const chunks=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_DIALOGUE_BODY){await reader.cancel().catch(()=>{});throw new AIError('BODY_TOO_LARGE','Пакет превышает 600 КБ.',413);}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new AIError('INVALID_JSON','Не удалось прочитать JSON диалога.',400);}
 if(!body||Array.isArray(body)||typeof body!=='object'||!body.conversation||Array.isArray(body.conversation)||typeof body.conversation!=='object'||!Array.isArray(body.conversation.messages)||body.conversation.messages.length>5000||!Array.isArray(body.criteria)||body.criteria.length>100)throw new AIError('INVALID_DIALOGUE','Проверьте диалог и чек-лист. Максимум 5 000 реплик и 100 критериев.',400);
 return body;
}
export async function verifyAI(env={},options={}){
 const key=typeof env.OPENAI_API_KEY==='string'?env.OPENAI_API_KEY.trim():'';
 if(!key)throw new AIError('OPENAI_NOT_CONFIGURED','Добавьте API-ключ OpenAI в настройках подключения.',503);
 const config=configuredAI(env);if(!config.configured)throw new AIError('INVALID_MODEL','Проверьте название модели в настройках подключения.',400);
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
 try{
  const response=await (options.fetcher||fetch)('https://api.openai.com/v1/models/'+encodeURIComponent(config.model),{method:'GET',headers:{Authorization:'Bearer '+key,Accept:'application/json'},redirect:'error',signal:controller.signal});
  try{await response.body?.cancel();}catch{}
  if(!response.ok){
   if(response.status===401)throw new AIError('OPENAI_AUTH','OpenAI отклонил API-ключ. Проверьте ключ в настройках.',401);
   if(response.status===403)throw new AIError('OPENAI_ACCESS','У этого ключа нет доступа к выбранной модели или проекту OpenAI.',403);
   if(response.status===404)throw new AIError('OPENAI_MODEL_NOT_FOUND','Модель не найдена или недоступна этому ключу. Проверьте её название.',404);
   if(response.status===429)throw new AIError('OPENAI_LIMIT','OpenAI сообщил о лимите запросов. Проверьте лимиты и повторите позже.',429);
   throw new AIError('OPENAI_UNAVAILABLE','OpenAI временно недоступен. Повторите проверку позже.',502);
  }
  return {verified:true,provider:'openai',model:config.model};
 }catch(error){
  if(error instanceof AIError)throw error;
  if(controller.signal.aborted||error?.name==='AbortError'||error?.name==='TimeoutError')throw new AIError('OPENAI_TIMEOUT','Время ожидания OpenAI истекло. Повторите проверку позже.',504);
  throw new AIError('OPENAI_NETWORK','Не удалось связаться с OpenAI. Проверьте подключение и повторите проверку.',502);
 }finally{clearTimeout(timeout);}
}
export async function handleApi(request,env={},options={}){
 const url=new URL(request.url);
 if(!url.pathname.startsWith('/api/'))return null;
 const origin=request.headers.get('Origin');
 if(origin!==null&&origin!==url.origin)return apiError('ORIGIN_REJECTED','Недопустимый источник запроса.',403);
 if(url.pathname==='/api/ai/config'){
  if(!['GET','HEAD'].includes(request.method))return apiError('LOCAL_SETTINGS_REQUIRED','Изменить подключение можно в локальной версии сервиса.',405);
  return jsonResponse({localConfiguration:false,...configuredAI(env)});
 }
 if(url.pathname==='/api/ai/verify'){
  if(request.method!=='POST')return apiError('METHOD_NOT_ALLOWED','Используйте POST для проверки подключения.',405);
  try{return jsonResponse(await verifyAI(env,options));}catch(error){return safeAIError(error);}
 }
 if(url.pathname==='/api/preprocess'||url.pathname==='/api/assess'){
  if(request.method!=='POST')return apiError('METHOD_NOT_ALLOWED','Используйте POST для обработки диалога.',405);
  try{
   const body=await dialogueBody(request);
   if(url.pathname==='/api/assess')return jsonResponse(await assessConversation(body.conversation,body.criteria,body.checklistVersion,env,options));
   const result=await preprocessConversation(body.conversation,body.criteria,body.checklistVersion);return jsonResponse(result,result.packet?200:422);
  }catch(error){return error instanceof AIError?safeAIError(error):apiError('INVALID_DIALOGUE','Не удалось прочитать или подготовить данные диалога.',400);}
 }
 if(!['GET','HEAD'].includes(request.method))return apiError('METHOD_NOT_ALLOWED','Метод не поддерживается.',405);
 try{
  if(url.pathname==='/api/status')return jsonResponse({organizerConfigured:Boolean(env.ORGANIZER_API_URL),aiConfigured:configuredAI(env).configured});
  const group=groupFrom(url);
  if(url.pathname==='/api/datasets'){const data=await fetchDataset(group,env,{refresh:url.searchParams.get('refresh')==='1'});return jsonResponse(publicDataset(data,group));}
  if(url.pathname==='/api/audio'){const id=url.searchParams.get('conversation_id');if(!id||id.length>160)throw new Error('Не указан ID диалога.');const audio=await getAudio(group,id,env);return rangeResponse(audio.bytes,audio.type,request.headers.get('Range'),request.method);}
  return apiError('NOT_FOUND','Маршрут не найден.',404);
 }catch(error){
  const known=error.message&&/^(Подключение|API |Некорректный|Набор|Аудио|У этого|Страница|Источник|На странице|Не указан|Недопустимый)/.test(error.message);
  return jsonResponse({isSuccess:false,error:known?error.message:'Не удалось связаться с источником. Повторите попытку.',code:'SOURCE_UNAVAILABLE'},502);
 }
}
