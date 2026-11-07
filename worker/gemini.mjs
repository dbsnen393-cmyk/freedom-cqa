/** Gemini transport only; assessment rules and scoring stay provider independent. */
export const DEFAULT_GEMINI_MODEL='gemini-3.5-flash-lite';
export const GEMINI_INPUT_BYTE_BUDGET=250000;
export class GeminiError extends Error{constructor(code,message,status=502){super(message);this.code=code;this.status=status;}}
export function geminiConfig(env={}){
 const model=env.GEMINI_MODEL?.trim()||DEFAULT_GEMINI_MODEL;
 return {configured:Boolean(env.GEMINI_API_KEY?.trim())&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(model),provider:'gemini',model};
}
/** Conservative byte upper bound for tokens. Local to one server/isolate, shared across keys. */
export function createGeminiLimiter({now=Date.now}={}){
 let active=0,minute=[],day=[],blockedUntil=0;
 return {
  acquire(tokens){
   // One oversized request will never fit, even after waiting or a restart.
   // This is a conservative local byte budget, not a provider token count/429.
   if(tokens>GEMINI_INPUT_BYTE_BUDGET)throw new GeminiError('GEMINI_INPUT_TOO_LARGE','Подготовленный пакет превышает локальный безопасный бюджет одного запроса (250 000 байт). Ожидание не поможет: уменьшите объём данных без потери контекста или используйте отдельный режим обработки.',413);
   const at=now();minute=minute.filter(x=>at-x.at<60000);day=day.filter(x=>at-x<86400000);
   if(active>=2||at<blockedUntil||minute.length>=15||day.length>=500||minute.reduce((n,x)=>n+x.tokens,0)+tokens>GEMINI_INPUT_BYTE_BUDGET)throw new GeminiError('GEMINI_LIMIT','Локальный лимит Gemini достигнут. Повторите позже.',429);
   minute.push({at,tokens});day.push(at);active++;let released=false;return ()=>{if(!released){active--;released=true;}};
  },
  cooldown(value){const seconds=Number(value);const until=Number.isFinite(seconds)&&seconds>0?now()+seconds*1000:Date.parse(value);blockedUntil=Math.max(blockedUntil,Number.isFinite(until)?until:now()+60000);}
 };
}
const limiter=createGeminiLimiter();
/** Couple applicability fields using Gemini's documented JSON Schema subset. */
function geminiAssessmentSchema(schema){
 const adapted=structuredClone(schema);
 for(const [id,criterion] of Object.entries(adapted.properties.answers.properties)){
  const value=criterion.properties.value,types=Array.isArray(value.type)?value.type:[value.type];
  const applicableValue=types.includes('number')?{type:'number',enum:value.enum.filter(item=>typeof item==='number')}:{type:'boolean'};
  const branch=(branchValue,kinds)=>({type:'object',additionalProperties:false,required:[...criterion.required],properties:{
   value:branchValue,
   // minLength is not in responseJsonSchema's documented subset; validateAssessment
   // enforces non-whitespace reasons. Do not rely on a silently ignored keyword.
   reason:{...criterion.properties.reason,description:'Непустое конкретное обоснование на русском языке, подтверждающее выбранную применимость и значение.'},
   evidence:{...criterion.properties.evidence,minItems:1},
   evidenceKind:{type:'string',enum:kinds}
  }});
  const branches=[branch(applicableValue,['present','absence'])];
  if(types.includes('null'))branches.push(branch({type:'null'},['not_applicable']));
  adapted.properties.answers.properties[id]={anyOf:branches};
 }
 return adapted;
}
async function boundedJSON(response){
 if(!response.body)throw new GeminiError('INVALID_PROVIDER_RESPONSE','Gemini вернул пустой ответ.');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024)throw new GeminiError('RESPONSE_TOO_LARGE','Ответ Gemini слишком большой.');chunks.push(value);}}
 catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new GeminiError('INVALID_PROVIDER_RESPONSE','Gemini вернул некорректный JSON.');}
}
export async function callGemini(env,request,options={},verification=false){
 const config=geminiConfig(env);
 if(!env.GEMINI_API_KEY?.trim())throw new GeminiError('GEMINI_NOT_CONFIGURED','Добавьте серверный GEMINI_API_KEY.',503);
 if(!config.configured)throw new GeminiError('INVALID_MODEL','Проверьте имя модели Gemini.',400);
 const body=verification?undefined:JSON.stringify({systemInstruction:{parts:[{text:request.instructions}]},contents:[{role:'user',parts:[{text:request.input[0].content[0].text}]}],generationConfig:{temperature:0,maxOutputTokens:8192,responseMimeType:'application/json',responseJsonSchema:geminiAssessmentSchema(request.text.format.schema)}});
 const quota=options.limiter||limiter,release=quota.acquire(body?new TextEncoder().encode(body).length:0);
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),verification?20000:120000);
 try{
  const response=await (options.fetcher||fetch)('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(config.model)+(verification?'':':generateContent'),{method:verification?'GET':'POST',headers:{'x-goog-api-key':env.GEMINI_API_KEY.trim(),'Content-Type':'application/json'},body,signal:controller.signal,redirect:'manual'});
  if(!response.ok){
   if(response.status===429)quota.cooldown(response.headers.get('Retry-After'));
   try{await response.body?.cancel();}catch{}
   const status=[401,403,429].includes(response.status)?response.status:502;
   throw new GeminiError(response.status===429?'GEMINI_LIMIT':response.status===404?'GEMINI_MODEL_NOT_FOUND':response.status===401||response.status===403?'GEMINI_AUTH':'GEMINI_UNAVAILABLE','Gemini отклонил запрос (HTTP '+response.status+'). Оценка не сохранена; автоматического повтора нет.',status);
  }
  if(verification){try{await response.body?.cancel();}catch{}return {verified:true,provider:'gemini',model:config.model};}
  const data=await boundedJSON(response),candidate=data.candidates?.[0];
  if(data.promptFeedback?.blockReason||candidate?.finishReason!=='STOP'||data.candidates.length!==1)throw new GeminiError('MODEL_INCOMPLETE','Gemini не завершил оценку. Результат не сохранён.');
  const text=candidate.content?.parts?.filter(p=>!p.thought&&typeof p.text==='string').map(p=>p.text).join('');
  let raw;try{raw=JSON.parse(text);}catch{throw new GeminiError('INVALID_ASSESSMENT','Gemini вернул некорректную оценку.');}
  const usage=data.usageMetadata||{};
  return {raw,model:config.model,responseId:null,usage:{input_tokens:usage.promptTokenCount,output_tokens:usage.candidatesTokenCount,total_tokens:usage.totalTokenCount}};
 }catch(e){if(e instanceof GeminiError)throw e;throw new GeminiError(controller.signal.aborted||e?.name==='AbortError'?'GEMINI_TIMEOUT':'GEMINI_NETWORK','Не удалось завершить запрос Gemini. Оценка не сохранена.',controller.signal.aborted||e?.name==='AbortError'?504:502);}
 finally{clearTimeout(timeout);release();}
}
