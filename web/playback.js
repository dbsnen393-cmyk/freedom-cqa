import {formatTime,timelineEntries,activeMessageAt,recordingPauses} from './timeline.js';
let live=null;const positions=new Map();
export function stopPlayback(){live?.destroy();live=null;}
export function seekMessage(id){live?.seekMessage(id);}
export function createTranscript(c,{h,icon,save}){
 const voice=c.channel==='voice call', entries=()=>timelineEntries(c), initial=positions.get(c.id)||{time:0,playing:false,rate:voice?1:8};
 let time=initial.time,playing=false,duration=voice?0:Math.max(1,...entries().map(x=>x.at)),rate=initial.rate,follow=true,lastId=null,timer=null,alive=true,ready=!voice;
 const rows=new Map(), chips=new Map();
 const status=h('span',{class:'playback-status',role:'status'},voice?'Нажмите ▶, чтобы загрузить запись':'Таймлайн переписки');
 const current=h('strong',{class:'current-speaker'},'Начало диалога');
 const elapsed=h('span',{class:'player-time'},formatTime(time)+' / '+(voice?'—':formatTime(duration)));
 const progress=h('input',{type:'range',min:0,max:duration||Math.max(1,...entries().map(x=>x.at)),step:0.05,value:time,'aria-label':voice?'Позиция аудиозаписи':'Позиция таймлайна',onInput:e=>seek(Number(e.target.value),true)});
 const toggle=h('button',{type:'button',class:'player-play','aria-label':voice?'Воспроизвести запись':'Запустить таймлайн',onClick:()=>playing?pause():play()},'▶');
 const audio=voice&&c.audioUrl?h('audio',{src:c.audioUrl,preload:'none'}):null;
 const rateSelect=h('select',{'aria-label':'Скорость воспроизведения',onChange:e=>{rate=Number(e.target.value);if(audio)audio.playbackRate=rate;}},(voice?[0.75,1,1.25,1.5,2]:[1,4,8,16]).map(v=>h('option',{value:v,selected:v===rate},v+'×')));
 function scrollToRow(id){const row=rows.get(id);if(!row)return;const box=messages.getBoundingClientRect(),r=row.getBoundingClientRect();if(r.top<box.top||r.bottom>box.bottom)messages.scrollTop+=r.top-box.top-(box.height-r.height)/2;}
 function repaint(forceScroll=false){
  elapsed.textContent=formatTime(time)+' / '+(duration?formatTime(duration):'—');progress.value=String(time);progress.max=String(duration||Math.max(1,...entries().map(x=>x.at)));
  const m=activeMessageAt(entries(),time),id=m?.id||null;
  if(id!==lastId){
   for(const[key,row]of rows){row.classList.toggle('is-playing',key===id);if(key===id)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');}
   for(const[key,chip]of chips)chip.classList.toggle('is-speaking',key===m?.participantId);
   current.textContent=m?(m.role==='system'?'Системное событие':((c.participants.find(p=>p.id===m.participantId)?.label)||m.role))+' · реплика #'+m.id:'Начало диалога';
   lastId=id;if(follow&&(playing||forceScroll))scrollToRow(id);
  }else if(forceScroll)scrollToRow(id);
 }
 function setPlaying(value){playing=value;toggle.textContent=value?'Ⅱ':'▶';toggle.setAttribute('aria-label',value?'Приостановить':voice?'Воспроизвести запись':'Запустить таймлайн');toggle.setAttribute('aria-pressed',String(value));}
 function pause(){if(audio)audio.pause();clearInterval(timer);setPlaying(false);}
 async function play(){
  if(voice&&!audio){status.textContent='Для этого диалога запись не предоставлена.';return;}
  if(audio){status.textContent=ready?'Воспроизведение':'Загрузка записи…';try{await audio.play();}catch{if(alive){status.textContent='Не удалось запустить запись. Попробуйте ещё раз.';setPlaying(false);}}}
  else{if(time>=duration)time=0;setPlaying(true);clearInterval(timer);let previous=performance.now();timer=setInterval(()=>{const now=performance.now();time=Math.min(duration,time+(now-previous)/1000*rate);previous=now;repaint();if(time>=duration){pause();status.textContent='Конец переписки';}},100);}
 }
 function seek(target,scroll=false){time=Math.max(0,duration?Math.min(target,duration):target);if(audio&&ready)audio.currentTime=time;repaint(scroll);}
 function seekToMessage(id){const entry=entries().find(x=>x.message.id===id);if(!entry){status.textContent='Эта реплика не имеет позиции в текущем таймлайне.';return;}seek(entry.at,true);if(voice&&duration&&entry.at>duration)status.textContent='Реплика за пределами записи. Уточните сдвиг.';}
 if(audio){
  audio.addEventListener('loadedmetadata',()=>{if(!alive)return;ready=true;duration=Number.isFinite(audio.duration)?audio.duration:0;audio.playbackRate=rate;audio.currentTime=Math.min(time,duration||time);status.textContent='Запись готова · '+formatTime(duration);repaint();});
  audio.addEventListener('durationchange',()=>{if(alive&&Number.isFinite(audio.duration)){duration=audio.duration;repaint();}});
  audio.addEventListener('timeupdate',()=>{if(alive){time=audio.currentTime;repaint();}});
  audio.addEventListener('play',()=>{if(alive){setPlaying(true);status.textContent='Воспроизведение';}});
  audio.addEventListener('pause',()=>{if(alive){setPlaying(false);status.textContent='На паузе';}});
  audio.addEventListener('ended',()=>{if(alive){setPlaying(false);status.textContent='Конец записи';}});
  audio.addEventListener('waiting',()=>{if(alive)status.textContent='Загрузка записи…';});
  audio.addEventListener('playing',()=>{if(alive)status.textContent='Воспроизведение';});
  audio.addEventListener('error',()=>{if(alive){status.textContent='Запись недоступна. Проверьте подключение и обновите набор.';setPlaying(false);}});
 }
 const participantBar=h('div',{class:'participant-bar'},c.participants.map(p=>{const chip=h('span',{class:'participant '+p.role},h('b',{},String(p.number).padStart(2,'0')),p.label);chips.set(p.id,chip);return chip;}));
 const controls=h('div',{class:'playback-box'},h('div',{class:'player-heading'},icon(voice?'headphones':'chats',19),h('strong',{},voice?'Запись разговора':'Таймлайн переписки'),status),h('div',{class:'player-controls'},toggle,h('div',{class:'player-progress'},progress,h('div',{class:'player-meta'},elapsed,current)),rateSelect),h('label',{class:'follow-control'},h('input',{type:'checkbox',checked:true,onChange:e=>follow=e.target.checked}),'Следовать за репликами'),audio);
 if(voice){
  const offset=h('input',{type:'number',value:c.syncOffset||0,step:0.1,min:-3600,max:3600,'aria-label':'Сдвиг записи в секундах',onChange:e=>{const value=Number(e.target.value);if(!Number.isFinite(value)||Math.abs(value)>3600)return;c.syncOffset=value;save();lastId=null;repaint();}});
  controls.append(h('details',{class:'sync-settings'},h('summary',{},icon('sliders',14),'Настройка синхронизации'),h('p',{},'Подсветка использует начало реплик из транскрипта. Если запись начинается позже, укажите положительный сдвиг.'),h('label',{class:'offset-control'},'Сдвиг записи, сек.',offset),recordingPauses(c.messages).length?h('label',{class:'follow-control'},h('input',{type:'checkbox',checked:c.compressPauses,onChange:e=>{c.compressPauses=e.target.checked;save();lastId=null;repaint();}}),'Убрать паузы записи из таймлайна'):null,h('small',{},'Включайте удаление пауз, только если их нет в аудиофайле. Границы окончания реплик не предоставлены.')));
 }
 const messages=h('div',{class:'messages',tabindex:'0','aria-label':'Реплики диалога'},c.messages.map(m=>{
  const p=c.participants.find(p=>p.id===m.participantId), stamp=h('button',{type:'button',class:'timestamp',disabled:!Number.isFinite(m.atSeconds),title:m.sourceTimestamp,'aria-label':'Перейти к реплике '+m.id+' на '+formatTime(m.atSeconds),onClick:()=>seekToMessage(m.id)},formatTime(m.atSeconds));
  const row=h('article',{id:'message-'+m.id,'data-id':m.id,'data-uid':m.uid,tabindex:'-1',class:'message '+m.role},h('div',{class:'message-label'},h('span',{},p?h('b',{class:'speaker-number'},String(p.number).padStart(2,'0')):null,p?.label||'Система'),stamp,h('span',{class:'message-number',title:m.uid},'#'+String(m.id).padStart(3,'0'))),h('p',{},m.text),h('div',{class:'evidence-marker'},icon('check',12),'Основание оценки'));rows.set(m.id,row);return row;
 }));
 const section=h('section',{class:'card transcript'},h('div',{class:'panel-heading'},h('h2',{},'Транскрипт'),h('span',{class:'subtle'},c.messages.length+' реплик')),participantBar,controls,messages,h('div',{class:'transcript-foot'},icon('shield',15),'Номера участников закреплены за ролями · система отдельно'));
 live={seekMessage:seekToMessage,destroy(){positions.set(c.id,{time,playing,rate});alive=false;clearInterval(timer);audio?.pause();if(audio){audio.removeAttribute('src');audio.load();}}};
 queueMicrotask(()=>{if(!alive)return;repaint();if(initial.playing)play();});
 return section;
}
