/** Deterministic, conservative masking. It does not certify complete anonymization. */
export const PRIVACY_VERSION = 'privacy-1.1';
const METADATA = ['id','uid','participantId','role','speaker','time','timestamp','sourceTimestamp','atSeconds'];
const WARNINGS = [
  'Имена, адреса и свободно описанные персональные сведения могут остаться: требуется проверка перед внешней отправкой.',
  'Маскирование основано на форматах и явном контексте; ошибки распознавания речи и необычные форматы могут быть пропущены.'
];
const CONTEXT = {
 iin: /(?:ИИН|ЖСН|\bIIN\b|individual identification number|жеке сәйкестендіру нөмір)/iu,
 card: /(?:карт[аыуың]|карточк|\bcard\b|\bPAN\b)/iu,
 order: /(?:поручени|номер заказа|order\s*(?:id|number|no)|ticket\s*(?:id|number)|өтінім)/iu,
 phone: /(?:телефон|нөміріңіз|ұялы|\bphone\b|\bmobile\b|\btel\b)/iu,
 otp: /(?:\bOTP\b|one[ -]time (?:code|password)|verification code|confirmation code|код(?:а|ы)?\s+(?:из\s+смс|подтверждения|проверки)|(?:смс|sms)[ -]*(?:код|code)|растау коды)/iu
};
const LABELS = {email:'EMAIL',url_secret:'SECRET_URL',phone:'PHONE',iin:'IIN',card:'CARD',account:'ACCOUNT',otp:'OTP',password:'PASSWORD',cvv:'CVV',api_secret:'SECRET'};
function digits(value){return value.replace(/\D/g,'');}
function luhn(value){const ds=digits(value);if(ds.length<13||ds.length>19||/^(\d)\1+$/.test(ds))return false;let sum=0;for(let i=ds.length-1,k=0;i>=0;i--,k++){let n=Number(ds[i]);if(k%2){n*=2;if(n>9)n-=9;}sum+=n;}return sum%10===0;}
function normalizedValue(type,value){if(['phone','iin','card','otp','cvv'].includes(type)){let n=digits(value);if(type==='phone'&&n[0]==='8')n='7'+n.slice(1);return n;}return type==='email'?value.toLowerCase():value;}
// Only whole, known placeholders are trusted. Arbitrary bracketed text must still be scanned.
const KNOWN_MASK = /^(?:(?:EMAIL|SECRET_URL|PHONE|IIN|CARD|ACCOUNT|OTP|PASSWORD|CVV|SECRET)_\d+|(?:(?:персональные данные|личные данные|имя|фамилия|фио|номер телефона|номер сч[её]та|номер карты|адрес|данные идентификации|информация)\s+)?(?:скрыт(?:о|а|ы)?|удал[её]н(?:о|а|ы)?)|(?:(?:аты|аты-жөні|жеке деректер|деректер|сәйкестендіру деректері|телефон нөмірі|жсн|жеке мәліметтер)\s+)?(?:жасырылған|жасырылды)|(?:(?:name|personal data|personal information|identification data|phone(?: number)?|email(?: address)?|account(?: number)?|card(?: number)?|address)\s+)?(?:REDACTED|MASKED)|(?:REDACTED|MASKED)\s+(?:name|personal data|personal information|identification data|phone(?: number)?|email(?: address)?|account(?: number)?|card(?: number)?|address))$/iu;
function existingRanges(text){return [...text.matchAll(/\[([^\]\n]{1,100})\]/gu)].filter(m=>KNOWN_MASK.test(m[1].trim())).map(m=>({start:m.index,end:m.index+m[0].length}));}
function candidatesFor(text,previousPrompt){
 const candidates=[],protectedRanges=existingRanges(text);
 const add=(start,value,type,priority=50)=>{if(!value)return;const end=start+value.length;if(protectedRanges.some(r=>start<r.end&&end>r.start))return;candidates.push({start,end,value,type,priority});};
 const each=(regex,callback)=>{for(const m of text.matchAll(regex))callback(m);};
 const capture=(regex,type,priority=70)=>each(regex,m=>{const value=m[m.length-1];if(type==='account'&&!/\d/.test(value))return;if(type==='password'&&/^(?:forgotten|reset|unknown|укажите|забыл|забыла|восстановить|белгісіз)[.!]?$/iu.test(value))return;add(m.index+m[0].lastIndexOf(value),value,type,priority);});
 const context=(start,length=65)=>text.slice(Math.max(0,start-length),start);
 const promptOnly=previousPrompt && /^[\s\d+().-]+$/.test(text.trim()) ? previousPrompt : '';
 each(/https?:\/\/[^\s<>"']+/giu,m=>{let value=m[0].replace(/[),.;!?]+$/,'');try{const u=new URL(value);const secretKey=[...u.searchParams.keys()].some(k=>/^(?:sig|signature|token|access[_-]?token|refresh[_-]?token|api[_-]?key|key|secret|client[_-]?secret|x-amz-signature|x-amz-credential|x-goog-signature|password|passwd|pwd|auth|authorization|credential|code)$/i.test(k));if(u.username||u.password||secretKey||/(?:^|[&#])(?:token|access_token|api_key|secret)=/i.test(u.hash))add(m.index,value,'url_secret',100);}catch{}});
 each(/(?<![\p{L}\p{N}._%+-])[A-Z0-9._%+-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,63}(?![\p{L}\p{N}])/giu,m=>add(m.index,m[0],'email',90));
 each(/(?<![\p{L}\p{N}])(?:\+?7|8)[\s(.-]*[67]\d{2}[\s).-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}(?!\d)/gu,m=>{const value=m[0];if(digits(value).length!==11)return;const ctx=context(m.index);if(value.startsWith('+7')||/[\s().-]/.test(value)||CONTEXT.phone.test(ctx+' '+promptOnly))add(m.index,value,'phone',85);});
 each(/(?<!\d)\d{12}(?!\d)/gu,m=>{if(CONTEXT.iin.test(context(m.index)+' '+promptOnly))add(m.index,m[0],'iin',80);});
 each(/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/gu,m=>{const ctx=context(m.index),n=digits(m[0]),cardContext=CONTEXT.card.test(ctx+' '+promptOnly);const familiarFormat=/^(?:\d{4}[ -]){3}\d{4}$/.test(m[0])||/^[3456]\d{14,15}$/.test(m[0]);if((cardContext||(!CONTEXT.order.test(ctx)&&familiarFormat&&luhn(n)))&&n.length>=13&&n.length<=19)add(m.index,m[0],'card',75);});
 capture(/(?:\bIBAN\b|банковск(?:ий|ого)\s+сч[её]т(?:а)?|номер\s+(?:брокерского\s+)?сч[её]т(?:а)?|(?:broker(?:age)?\s+)?account\s*(?:number|no\.?|id)|шот\s+нөмір[іің]*)\s*(?:[:=№#—-]|is|это)?\s*([A-Z]{2}\d{2}[A-Z0-9]{10,30}|[A-Z0-9][A-Z0-9-]{5,29})(?![\p{L}\p{N}])/giu,'account');
 capture(/(?:\bOTP\b|one[ -]time (?:code|password)|verification code|confirmation code|код(?:а|ы)?\s+(?:из\s+смс|подтверждения|проверки)|(?:смс|sms)[ -]*(?:код|code)|растау коды)\s*(?:[:=—-]|is|это)?\s*["']?(\d{4,8})(?!\d)/giu,'otp',85);
 if(promptOnly&&CONTEXT.otp.test(promptOnly))each(/(?<!\d)\d{4,8}(?!\d)/gu,m=>add(m.index,m[0],'otp',85));
 capture(/(?:пароль|password|құпиясөз)\s*(?::|=|—|\bis\b|это)\s*["']?([^\s,;"'<>]{4,128})/giu,'password',90);
 capture(/(?:\bCVV\b|\bCVC\b|security code|код безопасности карты)\s*(?:[:=—-]|is|это)?\s*(\d{3,4})(?!\d)/giu,'cvv',85);
 capture(/(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|secret key|ключ\s+API|токен\s+доступа)\s*(?::|=|\bis\b|это)\s*["']?([A-Za-z0-9_./+~-]{8,256}=*)/giu,'api_secret',95);
 if(previousPrompt&&/^(?:\s*[A-Z0-9-]{6,30}\s*)$/iu.test(text)&&/\d/.test(text)&&/(?:номер\s+(?:брокерского\s+)?сч[её]та|account\s*(?:number|id)|шот\s+нөмір)/iu.test(previousPrompt)){const value=text.trim();add(text.indexOf(value),value,'account',70);}
 if(promptOnly&&/(?:\bCVV\b|\bCVC\b|код безопасности карты)/iu.test(promptOnly))each(/(?<!\d)\d{3,4}(?!\d)/gu,m=>add(m.index,m[0],'cvv',85));
 capture(/(?:authorization\s*:\s*bearer)\s+([A-Za-z0-9_./+~-]{8,512}=*)/giu,'api_secret',95);
 each(/(?<![A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{20,256}(?![A-Za-z0-9_-])/gu,m=>add(m.index,m[0],'api_secret',95));
 const picked=[];
 for(const candidate of candidates.sort((a,b)=>b.priority-a.priority||(b.end-b.start)-(a.end-a.start)||a.start-b.start)){if(!picked.some(x=>candidate.start<x.end&&candidate.end>x.start))picked.push(candidate);}
 return {candidates:picked.sort((a,b)=>a.start-b.start),existingCount:protectedRanges.length};
}
/**
 * Input: normalized transcript messages. Output intentionally contains no reverse map or matched values.
 * Only transcript metadata is copied; arbitrary source extensions cannot bypass text masking.
 */
export function redactMessages(messages){
 if(!Array.isArray(messages))throw new TypeError('Ожидается массив реплик.');
 const registry=new Map(),serials={},findings=[],byType={};let affected=0,existingCount=0;
 const typeByLabel=Object.fromEntries(Object.entries(LABELS).map(([type,label])=>[label,type]));
 for(const message of messages){if(typeof message?.text!=='string')continue;for(const match of message.text.matchAll(/\[(EMAIL|SECRET_URL|PHONE|IIN|CARD|ACCOUNT|OTP|PASSWORD|CVV|SECRET)_(\d+)\]/g)){const type=typeByLabel[match[1]];serials[type]=Math.max(serials[type]||0,Number(match[2]));}}
 let previousDialogue=null;
 const masked=messages.map((message,index)=>{
  if(!message||typeof message.text!=='string')throw new TypeError('У каждой реплики должен быть текст.');
  const previous=previousDialogue;const priorRole=previous?.role||previous?.speaker,currentRole=message.role||message.speaker;
  const previousPrompt=currentRole==='client'&&['operator','bot'].includes(priorRole)?previous.text:'';
  // Transport events do not answer a question; the next conversational reply does.
  if(currentRole!=='system')previousDialogue=message;
  const {candidates,existingCount:priorCount}=candidatesFor(message.text,previousPrompt);existingCount+=priorCount;if(candidates.length)affected++;
  let cursor=0,text='';
  for(const c of candidates){
   const key=c.type+'\u0000'+normalizedValue(c.type,c.value);let placeholder=registry.get(key);
   if(!placeholder){serials[c.type]=(serials[c.type]||0)+1;placeholder='['+LABELS[c.type]+'_'+String(serials[c.type]).padStart(3,'0')+']';registry.set(key,placeholder);}
   text+=message.text.slice(cursor,c.start)+placeholder;cursor=c.end;byType[c.type]=(byType[c.type]||0)+1;
   findings.push({type:c.type,messageId:message.id??index+1,messageUid:message.uid??null,placeholder});
  }
  text+=message.text.slice(cursor);const copy={};for(const key of METADATA)if(Object.hasOwn(message,key))copy[key]=message[key];copy.text=text;return copy;
 });
 return {version:PRIVACY_VERSION,messages:masked,findings,counts:{total:findings.length,uniqueValues:registry.size,messagesAffected:affected,byType,alreadyRedactedMarkers:existingCount},coverageWarnings:[...WARNINGS]};
}


