import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTranscript,stopPlayback,seekMessage} from '../web/playback.js';

// A small event/geometry harness exercises the real transcript component. Media
// loading is deterministic: its first request fails, and load() clears that error.
class ElementStub extends EventTarget{
 constructor(tag){super();this.tagName=tag;this.children=[];this.attributes={};this.style={};this.dataset={};this.className='';this.scrollTop=0;this.offsetHeight=30;this.rect={top:0,bottom:100,height:100,left:0,width:600};this.reveals=[];this.classList={contains:name=>this.className.split(' ').includes(name),add:name=>this.classList.toggle(name,true),remove:name=>this.classList.toggle(name,false),toggle:(name,value)=>{const set=new Set(this.className.split(' ').filter(Boolean));if(value??!set.has(name))set.add(name);else set.delete(name);this.className=[...set].join(' ');}};}
 setAttribute(name,value){this.attributes[name]=String(value);if(name==='class')this.className=String(value);if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=String(value);}
 getAttribute(name){return this.attributes[name]??null;}
 get textContent(){return this.children.map(child=>child instanceof ElementStub?child.textContent:String(child)).join('');}
 set textContent(value){this.children=[String(value)];}
 removeAttribute(name){delete this.attributes[name];}
 append(...children){for(const child of children){if(child instanceof ElementStub)child.parent=this;this.children.push(child);}}
 replaceChildren(...children){this.children=[];this.append(...children);}
 matches(selector){return selector.startsWith('.')?this.classList.contains(selector.slice(1)):selector===this.tagName;}
 closest(selector){return selector.split(',').some(s=>this.matches(s))?this:this.parent?.closest(selector)||null;}
 querySelector(selector){for(const child of this.children){if(!(child instanceof ElementStub))continue;if(child.matches(selector))return child;const found=child.querySelector(selector);if(found)return found;}return null;}
 getBoundingClientRect(){return this.rect;}
 scrollIntoView(options){this.reveals.push(options);}
 focus(){document.activeElement=this;}
 hasPointerCapture(){return false;}
}
class AudioStub extends ElementStub{
 constructor(){super('audio');this.currentTime=0;this.duration=NaN;this.error=null;this.playbackRate=1;this.loadCalls=0;this.playCalls=0;this.failNext=true;this.paused=true;}
 load(){this.loadCalls++;this.error=null;this.duration=NaN;this.currentTime=0;this.dispatchEvent(new Event('timeupdate'));}
 async play(){this.playCalls++;if(this.error)throw Error('Media stays failed until reloaded');if(this.failNext){this.failNext=false;this.error={code:4};this.dispatchEvent(new Event('error'));throw Error('First request failed');}this.paused=false;this.dispatchEvent(new Event('play'));this.duration=5;this.dispatchEvent(new Event('durationchange'));this.dispatchEvent(new Event('loadedmetadata'));if(this.paused)throw new DOMException('Interrupted by pause','AbortError');this.dispatchEvent(new Event('playing'));}
 pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
}
function harness(t,overrides={}){
 const old=Object.fromEntries(['document','window','Element'].map(key=>[key,globalThis[key]]));
 globalThis.Element=ElementStub;
 globalThis.document={activeElement:null,createElementNS:(_,tag)=>new ElementStub(tag),getSelection:()=>null};
 globalThis.window={innerHeight:600,matchMedia:()=>({matches:true}),addEventListener(){},removeEventListener(){}};
 t.after(()=>{stopPlayback();for(const[key,value]of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
 const all=[];
 const h=(tag,attrs={},...children)=>{const node=tag==='audio'?new AudioStub():new ElementStub(tag);all.push(node);for(const[key,value]of Object.entries(attrs)){if(value===undefined||value===null||value===false)continue;if(key.startsWith('on'))node.addEventListener(key.slice(2).toLowerCase(),value);else if(key==='class')node.className=value;else if(key==='style')Object.assign(node.style,value);else if(['checked','disabled','value'].includes(key))node[key]=value;else node.setAttribute(key,value);}node.append(...children.flat(Infinity).filter(c=>c!==undefined&&c!==null&&c!==false));return node;};
 const c={id:'playback-test-'+crypto.randomUUID(),channel:'voice call',audioUrl:'/synthetic.wav',syncOffset:1,participants:[{id:'P01',number:1,role:'operator',label:'Оператор'}],messages:[{id:1,role:'operator',participantId:'P01',text:'First',atSeconds:1},{id:2,role:'operator',participantId:'P01',text:'Second',atSeconds:3},{id:3,role:'operator',participantId:'P01',text:'Last',atSeconds:5}]};
 Object.assign(c,overrides);
 const section=createTranscript(c,{h,icon:()=>h('span'),save:()=>true,onMessageSelect(){}});
 return {section,all,audio:all.find(n=>n.tagName==='audio'),play:all.find(n=>n.className==='player-play'),rate:all.find(n=>n.getAttribute('aria-label')==='Скорость воспроизведения'),follow:all.find(n=>n.tagName==='input'&&n.getAttribute('type')==='checkbox'),rows:all.filter(n=>n.tagName==='article'),messages:all.find(n=>n.className==='messages'),status:all.find(n=>n.className==='playback-status')};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function click(node){node.dispatchEvent(new Event('click'));await settle();}

test('Manual audio retry clears a failed source and preserves the selected sync time and rate',async t=>{
 const ui=harness(t);await settle();
 seekMessage(2);
 ui.rate.value='1.5';ui.rate.dispatchEvent(new Event('change'));
 await click(ui.play);assert.equal(ui.audio.error.code,4);assert.equal(ui.audio.playCalls,1);assert.equal(ui.audio.loadCalls,0);
 await settle();assert.equal(ui.audio.playCalls,1,'a failure must not retry automatically');
 await click(ui.play);
 assert.equal(ui.audio.error,null);assert.equal(ui.audio.loadCalls,1);assert.equal(ui.audio.playCalls,2);
 assert.equal(ui.audio.currentTime,2,'metadata must restore timestamp 3 minus sync offset 1, despite load resetting time');
 assert.equal(ui.audio.playbackRate,1.5);assert.equal(ui.play.getAttribute('aria-pressed'),'true');
});

test('Explicit message selection reveals an offscreen transcript; ordinary playback never scrolls the page',async t=>{
 const ui=harness(t);await settle();
 ui.messages.rect={top:800,bottom:1100,height:300,left:0,width:600};
 for(const row of ui.rows)row.rect={top:820,bottom:880,height:60,left:0,width:500};
 await click(ui.rows[1]);
 assert.equal(ui.rows[1].reveals.length,1);assert.equal(ui.rows[1].reveals[0].behavior,'instant','reduced motion is respected');
 ui.audio.failNext=false;await click(ui.play);
 assert.equal(ui.rows[1].reveals.length,2,'manual start reveals the current row while follow is enabled');
 ui.audio.currentTime=4;ui.audio.dispatchEvent(new Event('timeupdate'));
 assert.equal(ui.rows[2].reveals.length,0,'automatic following is limited to the inner transcript');
 await click(ui.play);ui.follow.checked=false;ui.follow.dispatchEvent(new Event('change'));
 await click(ui.play);assert.equal(ui.rows[2].reveals.length,0,'manual start with follow disabled leaves the page alone');
});

test('Audio timestamp listens from the selected position; row and evidence selection never starts paused audio',async t=>{
 const ui=harness(t);await settle();ui.audio.failNext=false;
 await click(ui.rows[1]);assert.equal(ui.audio.playCalls,0);
 seekMessage(3);assert.equal(ui.audio.playCalls,0);
 const stamp=ui.rows[1].querySelector('.timestamp');
 assert.match(stamp.getAttribute('aria-label'),/^Слушать реплику 2 с 00:03/);
 await click(stamp);assert.equal(ui.audio.currentTime,2);assert.equal(ui.audio.paused,false);
 await click(ui.play);assert.equal(ui.audio.paused,true);
 await click(ui.rows[2].querySelector('.timestamp'));assert.equal(ui.audio.currentTime,4);assert.equal(ui.audio.paused,false);
});

const beyondMessages=[{id:1,role:'operator',participantId:'P01',text:'Start',atSeconds:0},{id:2,role:'operator',participantId:'P01',text:'Past recording end',atSeconds:9},{id:3,role:'operator',participantId:'P01',text:'At exact end',atSeconds:5}];
test('A selected target past the eventual duration pauses with a persistent warning instead of playing EOF',async t=>{
 const ui=harness(t,{syncOffset:0,messages:beyondMessages});await settle();ui.audio.failNext=false;
 await click(ui.rows[1]);await click(ui.play);
 assert.equal(ui.audio.paused,true);assert.ok(ui.audio.currentTime<5);assert.match(ui.status.textContent,/запись уже закончилась/);assert.match(ui.status.textContent,/00:05/);assert.ok(ui.rows[1].classList.contains('is-selected'));assert.equal(ui.rows[1].querySelector('.message-audio-notice').hidden,false);assert.match(ui.rows[1].querySelector('.message-audio-notice').textContent,/запись уже закончилась/);
 const attempts=ui.audio.playCalls;await click(ui.play);assert.equal(ui.audio.playCalls,attempts,'blocked target must not restart the recording');
 ui.audio.dispatchEvent(new Event('pause'));ui.audio.dispatchEvent(new Event('ended'));assert.match(ui.status.textContent,/запись уже закончилась/);
 await click(ui.rows[0].querySelector('.timestamp'));assert.equal(ui.audio.paused,false);assert.equal(ui.audio.currentTime,0);assert.equal(ui.status.textContent,'Воспроизведение');assert.equal(ui.rows[1].querySelector('.message-audio-notice').hidden,true);
});

test('Known exact-end and past-end targets both pause without moving or restarting audio',async t=>{
 const ui=harness(t,{syncOffset:0,messages:beyondMessages});await settle();ui.audio.failNext=false;await click(ui.play);
 for(const row of [ui.rows[2],ui.rows[1]]){
  ui.audio.currentTime=2;ui.audio.dispatchEvent(new Event('timeupdate'));
  await click(row.querySelector('.timestamp'));
  assert.equal(ui.audio.paused,true);assert.equal(ui.audio.currentTime,2);assert.match(ui.status.textContent,/запись уже закончилась/);
  const attempts=ui.audio.playCalls;await click(ui.play);assert.equal(ui.audio.playCalls,attempts);assert.equal(ui.audio.currentTime,2);
 }
});

test('Metadata validates the latest pending target and waits for the actual metadata duration',async t=>{
 const ui=harness(t,{syncOffset:0,messages:beyondMessages});await settle();let finish;
 ui.audio.play=()=>{ui.audio.playCalls++;ui.audio.paused=false;ui.audio.dispatchEvent(new Event('play'));return new Promise(resolve=>finish=resolve);};
 await click(ui.rows[1].querySelector('.timestamp'));
 await click(ui.rows[0]);
 ui.audio.duration=0;ui.audio.dispatchEvent(new Event('durationchange'));
 ui.audio.duration=5;ui.audio.dispatchEvent(new Event('loadedmetadata'));finish();await settle();
 assert.equal(ui.audio.currentTime,0);assert.equal(ui.audio.paused,false);assert.doesNotMatch(ui.status.textContent,/запись уже закончилась/);
});

test('A cancelled earlier play request cannot replace a newer valid playback state',async t=>{
 const ui=harness(t);await settle();let rejectFirst;
 ui.audio.play=()=>{ui.audio.playCalls++;ui.audio.paused=false;ui.audio.dispatchEvent(new Event('play'));if(ui.audio.playCalls===1)return new Promise((resolve,reject)=>rejectFirst=reject);ui.audio.dispatchEvent(new Event('playing'));return Promise.resolve();};
 await click(ui.play);await click(ui.play);await click(ui.play);
 rejectFirst(new DOMException('Interrupted by pause','AbortError'));await settle();
 assert.equal(ui.play.getAttribute('aria-pressed'),'true');assert.equal(ui.status.textContent,'Воспроизведение');
});

test('Error and buffering notices survive pause events',async t=>{
 const ui=harness(t);await settle();await click(ui.play);ui.audio.dispatchEvent(new Event('pause'));assert.match(ui.status.textContent,/недоступна|Не удалось/);
 await click(ui.play);ui.audio.dispatchEvent(new Event('waiting'));ui.audio.dispatchEvent(new Event('pause'));assert.equal(ui.status.textContent,'Загрузка записи…');
});

test('Chat controls describe silent scrolling rather than audio playback',async t=>{
 const ui=harness(t,{channel:'agent chat',audioUrl:undefined});await settle();
 assert.equal(ui.audio,undefined);assert.equal(ui.play.getAttribute('aria-label'),'Запустить автопрокрутку');assert.equal(ui.status.textContent,'Переписка без аудио');
 assert.doesNotMatch(ui.rows[0].querySelector('.timestamp').getAttribute('aria-label'),/Слушать/);
 await click(ui.play);assert.match(ui.status.textContent,/Автопрокрутка/);await click(ui.play);
});

test('System event timestamps navigate without offering speech playback',async t=>{
 const ui=harness(t,{syncOffset:0,messages:[{id:1,role:'system',text:'Recording started',atSeconds:0}]});await settle();
 const stamp=ui.rows[0].querySelector('.timestamp');
 assert.match(stamp.getAttribute('aria-label'),/^Перейти к реплике/);
 await click(stamp);assert.equal(ui.audio.playCalls,0);assert.equal(ui.audio.paused,true);
});
