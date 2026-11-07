export const participantCatalog={operator:{id:"P01",number:1,label:"Оператор"},client:{id:"P02",number:2,label:"Клиент"},bot:{id:"P03",number:3,label:"Бот"}};
export function parseTimestamp(value){
 if(typeof value!=="string")return null;
 const mm=/^(\d+):([0-5]\d)(?:\.(\d+))?$/.exec(value);
 if(mm)return {kind:"relative",seconds:Number(mm[1])*60+Number(mm[2])+Number("0."+(mm[3]||"0"))};
 const hh=/^(\d+):([0-5]\d):([0-5]\d)(?:\.(\d+))?$/.exec(value);
 if(hh)return {kind:"relative",seconds:Number(hh[1])*3600+Number(hh[2])*60+Number(hh[3])+Number("0."+(hh[4]||"0"))};
 if(/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)){const ms=Date.parse(value);return Number.isFinite(ms)?{kind:"absolute",seconds:ms/1000}:null;}
 return null;
}
export function formatTime(seconds){
 if(!Number.isFinite(seconds)||seconds<0)return "—";
 const n=Math.floor(seconds),h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;
 return (h?String(h).padStart(2,"0")+":":"")+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
}
export function normalizeRecord(r,criteria,version,source="import"){
 if(!r||!Array.isArray(r.transcript)||!r.transcript.length)throw Error("В диалоге отсутствует transcript.");
 if(!["RU","KZ","EN"].includes(r.language))throw Error("Язык диалога должен быть RU, KZ или EN.");
 const parsed=r.transcript.map(m=>parseTimestamp(m.timestamp));
 const absolute=parsed.filter(t=>t?.kind==="absolute").map(t=>t.seconds);
 const origin=absolute.length?Math.min(...absolute):0;
 const id=String(r.conversation_id||"import-"+Date.now());
 const messages=r.transcript.map((m,i)=>{
 if(!["client","operator","bot","system"].includes(m.speaker)||typeof m.text!=="string"||typeof m.timestamp!=="string")throw Error("Проверьте speaker, text и timestamp в "+id+".");
 const t=parsed[i],at=t?(t.kind==="absolute"?t.seconds-origin:t.seconds):null;
 return {id:i+1,uid:id+":M"+String(i+1).padStart(4,"0"),participantId:participantCatalog[m.speaker]?.id||null,role:m.speaker,text:m.text,time:m.timestamp,sourceTimestamp:m.timestamp,atSeconds:at};
 });
 const participants=Object.entries(participantCatalog).filter(([role])=>messages.some(m=>m.role===role)).map(([role,p])=>({...p,role}));
 const firstClient=messages.find(m=>m.role==="client"&&m.text.trim().length>35&&!m.text.includes("скрыт"))||messages.find(m=>m.role==="client"&&m.text.trim().length>3);
 const title=String(r.title||firstClient?.text||"Диалог "+id).replace(/\s+/g," ").slice(0,84);
 const audio=r.audio_url;const audioUrl=typeof audio==="string"&&(/^https?:\/\//i.test(audio)||/^\/api\/audio\?/.test(audio))?audio:undefined;
 return {id,title,operator:"Оператор",language:r.language,channel:r.channel==="voice call"?"voice call":"agent chat",date:origin?new Date(origin*1000).toLocaleDateString("ru-RU",{timeZone:"Asia/Qyzylorda"}):"Дата не указана",messages,participants,originTimestamp:origin?new Date(origin*1000).toISOString():null,answers:null,criteria:structuredClone(criteria),version,demo:false,source,audioUrl,syncOffset:0,compressPauses:false,normalizedVersion:1};
}
export function upgradeConversation(c){
 if(c.normalizedVersion===1)return c;
 const n=normalizeRecord({conversation_id:c.id,title:c.title,language:c.language,channel:c.channel,audio_url:c.audioUrl,transcript:c.messages.map(m=>({timestamp:m.sourceTimestamp||m.time,speaker:m.role,text:m.text}))},c.criteria,c.version,c.demo?"DEMO":c.source||"import");
 return {...n,...c,messages:n.messages,participants:n.participants,originTimestamp:n.originTimestamp,normalizedVersion:1,source:c.demo?"DEMO":c.source||"import",syncOffset:c.syncOffset||0};
}
export function recordingPauses(messages){
 const sorted=messages.filter(m=>m.role==="system"&&Number.isFinite(m.atSeconds)).slice().sort((a,b)=>a.atSeconds-b.atSeconds);
 const result=[];let start=null;
 for(const m of sorted){
 if(/приостановлен|recording.*paused|жазу.*кідіртіл/i.test(m.text)&&start===null)start=m.atSeconds;
 else if(/возобновлен|recording.*resum|жазу.*жалғас/i.test(m.text)&&start!==null){result.push({start,end:m.atSeconds});start=null;}
 }
 return result;
}
export function audioTimeFor(message,conversation){
 if(!Number.isFinite(message.atSeconds))return null;
 let time=message.atSeconds;
 if(conversation.compressPauses){
 for(const p of recordingPauses(conversation.messages)){if(time>=p.start&&time<p.end)return null;}
 time-=recordingPauses(conversation.messages).reduce((sum,p)=>sum+(message.atSeconds>=p.end?p.end-p.start:0),0);
 }
 time-=Number(conversation.syncOffset||0);
 return time<0?null:Math.round(time*1000)/1000;
}
export function timelineEntries(conversation){
 return conversation.messages.map(m=>({message:m,at:conversation.channel==="voice call"?audioTimeFor(m,conversation):m.atSeconds})).filter(x=>Number.isFinite(x.at)&&x.at>=0).sort((a,b)=>a.at-b.at||a.message.id-b.message.id);
}
export function activeMessageAt(entries,time){
 if(!Number.isFinite(time)||!entries.length||time<entries[0].at)return null;
 let lo=0,hi=entries.length-1;
 while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(entries[mid].at<=time)lo=mid;else hi=mid-1;}
 return entries[lo].message;
}
export function mergeDataset(existing,incoming){
 const map=new Map(existing.map(c=>[c.id,c]));let added=0,updated=0;
 for(const c of incoming){
 const old=map.get(c.id);
 if(!old){map.set(c.id,c);added++;continue;}
 const identity=m=>[m.role,m.sourceTimestamp||m.time,m.text];
 const unchanged=JSON.stringify(old.messages.map(identity))===JSON.stringify(c.messages.map(identity));
 if(unchanged){map.set(c.id,{...old,source:c.source,title:c.title,date:c.date,audioUrl:c.audioUrl,participants:c.participants,messages:c.messages,normalizedVersion:1,originTimestamp:c.originTimestamp});}
 else{map.set(c.id,{...c,previousAssessment:old.answers?{answers:old.answers,criteria:old.criteria,version:old.version}:old.previousAssessment,syncOffset:old.syncOffset||0,compressPauses:old.compressPauses||false,transcriptChanged:true});updated++;}
 }
 return {conversations:[...map.values()],added,updated};
}
