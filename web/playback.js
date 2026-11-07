import {formatTime,timelineEntries,activeMessageAt,recordingPauses} from './timeline.js';
import {layoutTrackEntries} from './track-layout.js';
let live=null;const positions=new Map();
export function stopPlayback(){live?.destroy();live=null;}
export function seekMessage(id){live?.seekMessage(id);}
export function createTranscript(c,{h,icon,save,onMessageSelect}){
 const voice=c.channel==='voice call',initial=positions.get(c.id)||{time:0,playing:false,rate:voice?1:8};
 let entries=timelineEntries(c),time=initial.time,playing=false,duration=0,durationKnown=false,rate=initial.rate,follow=true,lastId=null,timer=null,alive=true,ready=!voice,focusedId=initial.focusedId??null;
 const rows=new Map(),chips=new Map(),lanes=new Map(),markers=new Map();
 let selectedId=c.messages.some(m=>m.id===initial.selectedId)?initial.selectedId:null;
 let drag=null,observer=null,resizeFrame=null,lastWidth=0;
 const participantKey=m=>m.role==='system'?'system':m.participantId||m.role;
 const participantName=m=>c.participants.find(p=>p.id===m.participantId)?.label||({system:'Система',bot:'Бот',operator:'Оператор',client:'Клиент'}[m.role])||m.role;
 const endTime=()=>voice&&durationKnown?duration:(entries.at(-1)?.at||0);
 const axisSpan=()=>endTime()>0?endTime():1;
 const audio=voice&&c.audioUrl?h('audio',{src:c.audioUrl,preload:'none'}):null;
 const status=h('span',{class:'playback-status',role:'status'},voice?(audio?'Запись загружается при воспроизведении':'Аудиозапись не предоставлена'):'Навигация по переписке');
 const current=h('strong',{class:'current-speaker'},'Начало диалога');
 const elapsed=h('span',{class:'player-time'});
 const toggle=h('button',{type:'button',class:'player-play','aria-label':voice?'Воспроизвести запись':'Запустить таймлайн','aria-pressed':'false',disabled:voice&&!audio,onClick:()=>playing?pause():play(true)});
 const rateSelect=h('select',{'aria-label':'Скорость воспроизведения',onChange:e=>{rate=Number(e.target.value);if(audio)audio.playbackRate=rate;}},(voice?[0.75,1,1.25,1.5,2]:[1,4,8,16]).map(v=>h('option',{value:v,selected:v===rate},v+'×')));
 const ruler=h('div',{class:'track-ruler',role:'slider',tabindex:'0','aria-label':voice?'Позиция записи':'Позиция переписки','aria-orientation':'horizontal','aria-valuemin':'0','aria-describedby':'conversation-track-help',onKeyDown:event=>{
  if(endTime()<=0)return;
  const step=event.shiftKey?10:1,changes={ArrowRight:time+step,ArrowUp:time+step,ArrowLeft:time-step,ArrowDown:time-step,PageUp:time+10,PageDown:time-10,Home:0,End:endTime()};
  if(!(event.key in changes))return;event.preventDefault();focusedId=null;seek(changes[event.key],true);
 }});
 const playhead=h('div',{class:'track-playhead','aria-hidden':'true'});
 const rulerHead=h('span',{class:'track-ruler-playhead','aria-hidden':'true'});
 const hover=h('span',{class:'track-hover',hidden:true,'aria-hidden':'true'});
 const plot=h('div',{class:'track-plot',onPointerDown:event=>{
  if(event.button!==0||event.target.closest('button')||!entries.length&&!durationKnown)return;
  event.preventDefault();ruler.focus({preventScroll:true});
  drag={id:event.pointerId,resume:playing};if(playing)pause();plot.setPointerCapture(event.pointerId);plot.classList.add('is-scrubbing');focusedId=null;seekPointer(event);
 },onPointerMove:event=>{showHover(event);if(drag?.id===event.pointerId)seekPointer(event);},onPointerUp:event=>{if(drag?.id===event.pointerId)finishScrub();},onPointerCancel:()=>finishScrub(),onLostPointerCapture:()=>finishScrub(),onPointerLeave:()=>{if(!drag)hover.hidden=true;}},ruler);
 const labelColumn=h('div',{class:'track-labels','aria-label':'Участники'},h('span',{class:'track-label-heading'},'Участники'));
 const laneParticipants=new Map(c.participants.map(p=>[p.id,p]));
 for(const m of c.messages){const key=participantKey(m);if(!laneParticipants.has(key))laneParticipants.set(key,{id:key,label:participantName(m),role:m.role,number:null});}
 for(const [key,p]of laneParticipants){
  const chip=h('div',{class:'track-participant '+p.role,title:p.label},h('div',{class:'track-participant-label'},h('b',{},p.number?String(p.number).padStart(2,'0'):'—'),h('span',{},p.label)));
  chips.set(key,chip);labelColumn.append(chip);
  const lane=h('div',{class:'track-lane '+p.role,'aria-label':'Начало реплик: '+p.label});lanes.set(key,lane);plot.append(lane);
 }
 plot.append(playhead);
 const trackGrid=h('div',{class:'track-grid',role:'region','aria-label':'Дорожки участников. Прокрутите вниз, чтобы увидеть все метки.'},labelColumn,h('div',{class:'track-plot-wrap'},plot));
 const trackNote=h('p',{class:'track-note'});
 const track=h('div',{class:'conversation-track'},trackGrid,trackNote);
 function setPlayIcon(value){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('width','20');svg.setAttribute('height','20');svg.setAttribute('aria-hidden','true');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('fill','currentColor');path.setAttribute('d',value?'M5 4h3v12H5zm7 0h3v12h-3z':'M6 3.5v13l10-6.5z');svg.append(path);toggle.replaceChildren(svg);
 }
 function scrollToRow(id,reveal=false){
  const row=rows.get(id);if(!row)return;
  const box=messages.getBoundingClientRect(),r=row.getBoundingClientRect();
  if(r.top<box.top||r.bottom>box.bottom)messages.scrollTop+=r.top-box.top-(box.height-r.height)/2;
  // Explicit navigation may reveal the list itself. Routine following only moves
  // its inner scrollbar, so playback never pulls the page away from the reader.
  const visible=row.getBoundingClientRect();
  if(reveal&&(visible.top<12||visible.bottom>window.innerHeight-12))row.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 }
 function revealMarker(button){
  if(!button)return;
  const box=trackGrid.getBoundingClientRect(),r=button.getBoundingClientRect(),top=box.top+ruler.offsetHeight+4,bottom=box.bottom-4;
  if(r.top<top)trackGrid.scrollTop-=top-r.top;
  else if(r.bottom>bottom)trackGrid.scrollTop+=r.bottom-bottom;
 }
 function scrollToMarker(id){for(const[button,entry]of markers)if(entry.message.id===id){revealMarker(button);break;}}
 function repaint(forceScroll=false){
  const end=endTime();
  // A restored audio position can be later than the last transcript start. Keep it
  // until metadata supplies the recording's actual duration.
  if(!audio||durationKnown)time=Math.max(0,Math.min(time,end));
  const shownTime=Math.min(time,end);elapsed.textContent=formatTime(time)+' / '+((audio&&!durationKnown)||end<=0?'—':formatTime(end));
  ruler.setAttribute('aria-valuemax',String(end));ruler.setAttribute('aria-valuenow',String(shownTime));ruler.setAttribute('aria-valuetext',formatTime(shownTime)+' из '+formatTime(end));
  ruler.setAttribute('aria-disabled',String(end<=0));
  playhead.style.left=(shownTime/axisSpan()*100)+'%';
  rulerHead.style.left=playhead.style.left;
  let m=activeMessageAt(entries,time);
  const focused=entries.find(entry=>entry.message.id===focusedId);
  // An explicit choice distinguishes messages sharing the same start until the next start.
  if(focused&&focused.at===(entries.find(entry=>entry.message.id===m?.id)?.at))m=focused.message;else focusedId=null;
  const id=m?.id||null;
  if(id!==lastId){
   for(const[key,row]of rows){row.classList.toggle('is-playing',key===id);if(key===id)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');}
   for(const[key,chip]of chips){const active=key===(m?participantKey(m):null);chip.classList.toggle('is-speaking',active);lanes.get(key)?.classList.toggle('is-current',active);}
   current.textContent=m?participantName(m)+' · реплика #'+m.id:'Начало диалога';
   lastId=id;if(forceScroll||follow&&playing){scrollToRow(id);scrollToMarker(id);}
  }else if(forceScroll){scrollToRow(id);scrollToMarker(id);}
  updateMarkers();
 }
 function updateMarkers(){
  for(const [button,entry]of markers){const active=entry.message.id===lastId,selected=entry.message.id===selectedId;button.classList.toggle('is-active',active);button.classList.toggle('is-selected',selected);button.setAttribute('aria-pressed',String(selected));if(active)button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');}
 }
 function renderTrack(){
  if(!alive)return;
  const focusedMarker=document.activeElement?.closest('.track-marker')?.dataset.messageId;
  markers.clear();const end=endTime(),width=plot.getBoundingClientRect().width||320,rowHeight=window.matchMedia('(pointer:coarse)').matches?48:44;lastWidth=width;
  const ticks=end>0?[0,.25,.5,.75,1]:[entries.length?0:.5];
  ruler.replaceChildren(...ticks.map(fraction=>h('span',{class:'track-tick',style:{left:fraction*100+'%'},'aria-hidden':'true'},end<=0&&!entries.length?'Нет таймкодов':formatTime(end*fraction))),rulerHead,hover);
  playhead.hidden=rulerHead.hidden=end<=0&&!entries.length;
  for(const[key,lane]of lanes){
   const laneEntries=entries.filter(entry=>participantKey(entry.message)===key);
   const layout=layoutTrackEntries(laneEntries,end,width);
   lane.style.height=chips.get(key).style.height=(layout.rows*rowHeight)+'px';
   lane.replaceChildren(...layout.markers.map(({entry,row})=>{
    const label='Реплика #'+entry.message.id+'. '+participantName(entry.message)+'. '+formatTime(entry.at);
    const button=h('button',{type:'button',class:'track-marker',style:{left:entry.at/axisSpan()*100+'%',top:(row*rowHeight)+'px'},'aria-label':label,title:label,'data-message-id':entry.message.id,onFocus:()=>{if(button.matches(':focus-visible'))revealMarker(button);},onClick:event=>{event.stopPropagation();selectMessage(entry.message);}},h('span',{class:'track-marker-number','aria-hidden':'true'},'#'+entry.message.id),h('span',{class:'track-marker-start','aria-hidden':'true'}));
    markers.set(button,entry);return button;
   }));
  }
  const visible=entries.filter(entry=>entry.at<=end).length,omitted=c.messages.length-visible;
  trackNote.textContent='Метки — начало реплик; время окончания не задано.'+(omitted?' Вне шкалы: '+omitted+' — доступны в транскрипте.':'')+(voice&&!durationKnown&&entries.length?' Шкала по транскрипту.':'');
  toggle.disabled=voice?!audio:end<=0;repaint();
  if(focusedMarker)for(const[button,entry]of markers)if(String(entry.message.id)===focusedMarker){button.focus({preventScroll:true});break;}
 }
 function setPlaying(value){playing=value;setPlayIcon(value);toggle.setAttribute('aria-label',value?'Приостановить':voice?'Воспроизвести запись':'Запустить таймлайн');toggle.setAttribute('aria-pressed',String(value));}
 function pause(){if(audio)audio.pause();clearInterval(timer);setPlaying(false);if(!audio)status.textContent='На паузе';}
 async function play(manual=false){
  if(voice&&!audio){status.textContent='Для этого диалога запись не предоставлена.';return;}
  if(audio){
   // A failed media element stays failed until load() resets it. Reload only on
   // a deliberate retry; loadedmetadata will restore the requested time and rate.
   if(manual&&audio.error){ready=false;durationKnown=false;audio.load();}
   if(ready&&durationKnown&&time>=duration){focusedId=null;seek(0,follow);}
   if(manual&&follow){repaint(true);scrollToRow(lastId,true);}
   status.textContent=ready?'Воспроизведение':'Загрузка записи…';
   try{await audio.play();}catch{if(alive){status.textContent='Не удалось запустить запись. Попробуйте ещё раз.';setPlaying(false);}}
  }
  else{if(time>=endTime()){time=0;focusedId=null;}setPlaying(true);status.textContent='Воспроизведение переписки';repaint(follow);if(manual&&follow)scrollToRow(lastId,true);clearInterval(timer);let previous=performance.now();timer=setInterval(()=>{const now=performance.now();time=Math.min(endTime(),time+(now-previous)/1000*rate);previous=now;repaint();if(time>=endTime()){pause();status.textContent='Конец переписки';}},100);}
 }
 function seek(target,scroll=false){if(!Number.isFinite(target))return;time=Math.max(0,Math.min(target,endTime()));if(audio&&ready)audio.currentTime=time;repaint(scroll);}
 function seekPointer(event){const rect=plot.getBoundingClientRect();seek(Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width)))*endTime(),true);showHover(event);}
 function showHover(event){
  if(endTime()<=0&&!entries.length){hover.hidden=true;return;}
  const rect=plot.getBoundingClientRect(),entry=!drag?markers.get(event.target.closest('.track-marker')):null;
  const fraction=entry?entry.at/axisSpan():Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width)));
  hover.textContent=formatTime(entry?entry.at:fraction*endTime())+(entry?' · #'+entry.message.id:'');hover.style.left='clamp(32px, '+fraction*100+'%, calc(100% - 32px))';hover.hidden=false;
 }
 function finishScrub(){if(!drag)return;const{resume,id}=drag;drag=null;if(plot.hasPointerCapture(id))plot.releasePointerCapture(id);plot.classList.remove('is-scrubbing');hover.hidden=true;if(resume&&alive)play();}
 function selectMessage(message,{seekToTime=true,notify=true}={}){
  selectedId=message.id;
  for(const[id,row]of rows){const selected=id===selectedId;row.classList.toggle('is-selected',selected);const badge=row.querySelector('.message-selection-label');if(badge)badge.hidden=!selected;}
  if(seekToTime)seekToMessage(message.id);else updateMarkers();
  if(notify&&typeof onMessageSelect==='function')onMessageSelect(message,{conversationId:c.id,hasTimestamp:entries.some(entry=>entry.message.id===message.id)});
 }
 function seekToMessage(id){
  const entry=entries.find(x=>x.message.id===id);
  if(!entry){status.textContent='У реплики нет позиции на шкале. Она доступна в транскрипте.';scrollToRow(id,true);updateMarkers();return;}
  if(voice&&durationKnown&&entry.at>duration){status.textContent='Реплика за пределами записи. Проверьте синхронизацию.';scrollToRow(id,true);updateMarkers();return;}
  focusedId=id;seek(entry.at,true);scrollToRow(id,true);
 }
 if(audio){
  audio.addEventListener('loadedmetadata',()=>{if(!alive)return;ready=true;durationKnown=Number.isFinite(audio.duration)&&audio.duration>=0;duration=durationKnown?audio.duration:0;audio.playbackRate=rate;time=Math.min(time,endTime());audio.currentTime=time;status.textContent=playing?'Воспроизведение':'Запись готова'+(durationKnown?' · '+formatTime(duration):'');renderTrack();});
  audio.addEventListener('durationchange',()=>{if(alive&&Number.isFinite(audio.duration)&&audio.duration>=0){durationKnown=true;duration=audio.duration;time=Math.min(time,duration);renderTrack();}});
  audio.addEventListener('timeupdate',()=>{if(alive&&ready&&!drag){time=audio.currentTime;repaint();}});
  audio.addEventListener('play',()=>{if(alive){setPlaying(true);status.textContent='Воспроизведение';}});
  audio.addEventListener('pause',()=>{if(alive){setPlaying(false);status.textContent='На паузе';}});
  audio.addEventListener('ended',()=>{if(alive){setPlaying(false);status.textContent='Конец записи';}});
  audio.addEventListener('waiting',()=>{if(alive)status.textContent='Загрузка записи…';});
  audio.addEventListener('playing',()=>{if(alive)status.textContent='Воспроизведение';});
  audio.addEventListener('error',()=>{if(alive){status.textContent='Запись недоступна. Проверьте подключение и обновите набор.';setPlaying(false);}});
 }
 const controls=h('div',{class:'playback-box'},h('div',{class:'player-heading'},icon(voice?'headphones':'chats',18),h('strong',{},voice?'Запись разговора':'Таймлайн переписки'),status),h('div',{class:'player-controls'},toggle,h('div',{class:'player-position'},elapsed,current),rateSelect),track,h('div',{class:'track-options'},h('label',{class:'follow-control'},h('input',{type:'checkbox',checked:true,onChange:e=>follow=e.target.checked}),'Следовать за репликами')),audio);
 if(voice){
  const updateSync=()=>{save();entries=timelineEntries(c);focusedId=null;lastId=null;renderTrack();};
  const offset=h('input',{type:'number',value:c.syncOffset||0,step:0.1,min:-3600,max:3600,'aria-label':'Сдвиг записи в секундах',onChange:e=>{const value=Number(e.target.value);if(!Number.isFinite(value)||Math.abs(value)>3600)return;c.syncOffset=value;updateSync();}});
  controls.append(h('details',{class:'sync-settings'},h('summary',{},icon('sliders',14),'Синхронизация с записью'),h('p',{},'Если запись начинается позже транскрипта, укажите положительный сдвиг.'),h('label',{class:'offset-control'},'Сдвиг записи, сек.',offset),recordingPauses(c.messages).length?h('label',{class:'follow-control'},h('input',{type:'checkbox',checked:c.compressPauses,onChange:e=>{c.compressPauses=e.target.checked;updateSync();}}),'Убрать паузы записи из таймлайна'):null,h('small',{},'Удаляйте паузы, только если их нет в аудиофайле.')));
 }
 const interactiveTarget=target=>target instanceof Element&&!!target.closest('button,a,input,select,textarea,summary,[role="button"]');
 const hasTextSelection=()=>{const selection=document.getSelection();return !!selection&&!selection.isCollapsed&&selection.toString().length>0;};
 const messages=h('div',{class:'messages',tabindex:'0','aria-label':'Реплики диалога'},c.messages.map(m=>{
  const p=c.participants.find(p=>p.id===m.participantId),roleName=participantName(m),validTime=Number.isFinite(m.atSeconds)&&m.atSeconds>=0;
  const stamp=h('button',{type:'button',class:'timestamp',disabled:!validTime,title:m.sourceTimestamp,'aria-label':'Выбрать реплику '+m.id+(validTime?' на '+formatTime(m.atSeconds):' без таймкода'),onClick:event=>{event.stopPropagation();selectMessage(m);}},formatTime(m.atSeconds));
  let pointerStart=null,dragged=false;
  const row=h('article',{
   id:'message-'+m.id,'data-id':m.id,'data-uid':m.uid,tabindex:'0',class:'message message-interactive '+m.role+(selectedId===m.id?' is-selected':''),
   'aria-label':'Реплика #'+m.id+'. '+roleName,'aria-describedby':'message-selection-help',
   onPointerDown:event=>{if(event.button!==0||interactiveTarget(event.target))return;pointerStart={x:event.clientX,y:event.clientY};dragged=false;},
   onPointerMove:event=>{if(pointerStart&&Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>6)dragged=true;},
   onPointerUp:()=>{pointerStart=null;},onPointerCancel:()=>{pointerStart=null;dragged=true;},
   onClick:event=>{if(interactiveTarget(event.target))return;if(dragged||hasTextSelection()){dragged=false;return;}selectMessage(m);},
   onKeyDown:event=>{if(event.target!==event.currentTarget||!['Enter',' ','Spacebar'].includes(event.key))return;event.preventDefault();selectMessage(m);}
  },h('div',{class:'message-label'},h('span',{},p?h('b',{class:'speaker-number'},String(p.number).padStart(2,'0')):null,roleName),stamp,h('span',{class:'message-number',title:m.uid},'#'+String(m.id).padStart(3,'0'))),h('p',{},m.text),h('span',{class:'message-selection-label',hidden:selectedId!==m.id},'Выбрана'),h('div',{class:'evidence-marker'},icon('check',12),'Основание оценки'));
  rows.set(m.id,row);return row;
 }));
 const section=h('section',{class:'card transcript'},h('div',{class:'panel-heading'},h('h2',{},'Транскрипт'),h('span',{class:'subtle'},c.messages.length+' реплик')),controls,h('p',{id:'conversation-track-help',class:'track-keyboard-help'},'Шкала: нажмите или перетащите указатель. Клавиши ← и → — одна секунда, Home и End — начало и конец.'),h('p',{id:'message-selection-help',class:'message-interaction-hint'},'Нажмите метку на дорожке или реплику для перехода. С клавиатуры — Enter или пробел.'),messages,h('div',{class:'transcript-foot'},icon('shield',15),'Номера участников закреплены за ролями · система отдельно'));
 window.addEventListener('blur',finishScrub);
 live={seekMessage:seekToMessage,destroy(){positions.set(c.id,{time,playing:playing||!!drag?.resume,rate,selectedId,focusedId});alive=false;clearInterval(timer);if(resizeFrame)cancelAnimationFrame(resizeFrame);observer?.disconnect();window.removeEventListener('blur',finishScrub);finishScrub();audio?.pause();if(audio){audio.removeAttribute('src');audio.load();}}};
 setPlayIcon(false);
 queueMicrotask(()=>{if(!alive)return;renderTrack();if(typeof ResizeObserver==='function'){observer=new ResizeObserver(()=>{const width=plot.getBoundingClientRect().width;if(Math.abs(width-lastWidth)<1)return;if(resizeFrame)cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{resizeFrame=null;renderTrack();});});observer.observe(plot);}if(initial.playing)play();});
 return section;
}
