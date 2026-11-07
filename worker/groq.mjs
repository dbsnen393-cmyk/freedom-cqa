/** Groq Chat Completions transport. Assessment semantics stay in assessment.mjs. */
export const DEFAULT_GROQ_MODEL='openai/gpt-oss-120b';
export class GroqError extends Error{constructor(code,message,status=502){super(message);this.name='GroqError';this.code=code;this.status=status;}}
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function groqConfig(env={}){
 const model=typeof env.GROQ_MODEL==='string'&&env.GROQ_MODEL.trim()?env.GROQ_MODEL.trim():DEFAULT_GROQ_MODEL;
 return {configured:Boolean(typeof env.GROQ_API_KEY==='string'&&env.GROQ_API_KEY.trim())&&/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(model),provider:'groq',model};
}
export function buildGroqRequest(request,env={}){
 const schema=structuredClone(request.text.format.schema);
 for(const [id,criterion]of Object.entries(schema.properties.answers.properties)){
  const source=criterion.properties.value,types=Array.isArray(source.type)?source.type:[source.type];
  const value=types.includes('number')?{type:'number',enum:source.enum.filter(v=>typeof v==='number')}:{type:'boolean'};
  const branch=(value,kinds)=>({type:'object',additionalProperties:false,required:[...criterion.required],properties:{
   value,reason:{...criterion.properties.reason},
   // Keep the conservative documented strict subset. Nonempty evidence/reasons
   // and valid transcript IDs remain mandatory in validateAssessment().
   evidence:{type:'array',items:{type:'integer'},description:criterion.properties.evidence.description},
   evidenceKind:{type:'string',enum:kinds}
  }});
  const anyOf=[branch(value,['present','absence'])];if(types.includes('null'))anyOf.push(branch({type:'null'},['not_applicable']));
  schema.properties.answers.properties[id]={anyOf};
 }
 return {model:groqConfig(env).model,messages:[{role:'system',content:request.instructions},{role:'user',content:request.input[0].content[0].text}],stream:false,max_completion_tokens:8192,reasoning_effort:'medium',response_format:{type:'json_schema',json_schema:{name:'cqa_assessment',strict:true,schema}}};
}
/** Independent of Gemini quotas: no guesses about Groq account-specific RPM/TPM. */
export function createGroqLimiter({now=Date.now}={}){
 let active=0,blockedUntil=0;
 return {acquire(){if(active>=2||now()<blockedUntil)throw new GroqError('GROQ_LIMIT','Локальное ограничение Groq. Повторите позже.',429);active++;let released=false;return ()=>{if(!released){active--;released=true;}};},
 cooldown(value){const seconds=Number(value),date=Date.parse(value),until=Number.isFinite(seconds)&&seconds>0?now()+seconds*1000:date;blockedUntil=Math.max(blockedUntil,Number.isFinite(until)&&until>now()?until:now()+60000);}};
}
const limiter=createGroqLimiter();
async function readJSON(response){
 const limit=2*1024*1024;
 if(Number(response.headers.get('Content-Length'))>limit){try{await response.body?.cancel();}catch{}throw new GroqError('RESPONSE_TOO_LARGE','Ответ Groq превышает допустимый размер.');}
 if(!response.body)throw new GroqError('INVALID_PROVIDER_RESPONSE','Groq вернул пустой ответ.');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw new GroqError('RESPONSE_TOO_LARGE','Ответ Groq превышает допустимый размер.');chunks.push(value);}}
 catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new GroqError('INVALID_PROVIDER_RESPONSE','Groq вернул некорректный JSON. Оценка не сохранена.');}
}
export async function callGroq(env={},request,options={},verification=false){
 const config=groqConfig(env),key=typeof env.GROQ_API_KEY==='string'?env.GROQ_API_KEY.trim():'';
 if(!key)throw new GroqError('GROQ_NOT_CONFIGURED','Добавьте серверный GROQ_API_KEY.',503);
 if(!config.configured)throw new GroqError('INVALID_MODEL','Проверьте имя модели Groq.',400);
 const body=verification?undefined:JSON.stringify(buildGroqRequest(request,env));
 const quota=options.groqLimiter||limiter,release=quota.acquire();
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),verification?20000:120000);
 try{
  const response=await (options.fetcher||fetch)('https://api.groq.com/openai/v1/'+(verification?'models/'+encodeURIComponent(config.model):'chat/completions'),{method:verification?'GET':'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body,signal:controller.signal,redirect:'manual'});
  if(!response.ok){
   if(response.status===429)quota.cooldown(response.headers.get('Retry-After'));
   try{await response.body?.cancel();}catch{}
   const code=response.status===429?'GROQ_LIMIT':response.status===503?'GROQ_UNAVAILABLE':response.status===401||response.status===403?'GROQ_AUTH':response.status===404?'GROQ_MODEL_NOT_FOUND':response.status===400||response.status===422?'GROQ_REQUEST':'GROQ_UNAVAILABLE';
   throw new GroqError(code,'Groq отклонил запрос (HTTP '+response.status+'). Оценка не сохранена; автоматического повтора нет.',[401,403,429,503].includes(response.status)?response.status:502);
  }
  if(verification){try{await response.body?.cancel();}catch{}return {verified:true,provider:'groq',model:config.model};}
  const data=await readJSON(response);
  if(!record(data)||!Array.isArray(data.choices)||data.choices.length!==1||!record(data.choices[0]))throw new GroqError('INVALID_PROVIDER_RESPONSE','Groq вернул ответ в неизвестном формате.');
  const choice=data.choices[0];
  if(choice.message?.refusal||choice.finish_reason==='content_filter')throw new GroqError('MODEL_REFUSAL','Groq отказался оценивать этот диалог.',422);
  if(choice.finish_reason!=='stop')throw new GroqError('MODEL_INCOMPLETE','Groq не завершил оценку. Результат не сохранён.');
  if(!record(choice.message)||choice.message.role!=='assistant'||typeof choice.message.content!=='string'||!choice.message.content.trim()||choice.message.tool_calls?.length)throw new GroqError('INVALID_PROVIDER_RESPONSE','Groq не вернул текст оценки.');
  let raw;try{raw=JSON.parse(choice.message.content);}catch{throw new GroqError('INVALID_ASSESSMENT','Groq вернул некорректный JSON оценки.');}
  const usage=record(data.usage)?data.usage:{};
  return {raw,model:typeof data.model==='string'&&/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(data.model)?data.model:config.model,requestedModel:config.model,responseId:typeof data.id==='string'&&/^[A-Za-z0-9_-]{1,180}$/.test(data.id)?data.id:null,usage:{input_tokens:usage.prompt_tokens,output_tokens:usage.completion_tokens,total_tokens:usage.total_tokens}};
 }catch(e){if(e instanceof GroqError)throw e;if(controller.signal.aborted||e?.name==='AbortError'||e?.name==='TimeoutError')throw new GroqError('GROQ_TIMEOUT','Время ожидания Groq истекло. Оценка не сохранена.',504);throw new GroqError('GROQ_NETWORK','Не удалось связаться с Groq. Оценка не сохранена.');}
 finally{clearTimeout(timeout);release();}
}
