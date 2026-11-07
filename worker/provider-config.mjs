export const INVALID_PROVIDER_MESSAGE='Неизвестный провайдер ИИ. Укажите AI_PROVIDER: openai, gemini или groq.';
/** Explicit selection wins; existing OpenAI installations keep their connection. */
export function resolveAIProvider(env={}){
 const explicit=typeof env.AI_PROVIDER==='string'?env.AI_PROVIDER.trim():env.AI_PROVIDER;
 if(explicit!==undefined&&explicit!==null&&explicit!=='')return ['openai','gemini','groq'].includes(explicit)?explicit:null;
 for(const [provider,key] of [['openai','OPENAI_API_KEY'],['gemini','GEMINI_API_KEY'],['groq','GROQ_API_KEY']])if(typeof env[key]==='string'&&env[key].trim())return provider;
 return 'gemini';
}
