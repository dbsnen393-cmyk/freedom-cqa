import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTranscript,stopPlayback} from '../web/playback.js';

// A small event/geometry harness exercises the real transcript component. Media
// loading is deterministic: its first request fails, and load() clears that error.
class ElementStub extends EventTarget{
 constructor(tag){super();this.tagName=tag;this.children=[];this.attributes={};this.style={};this.dataset={};this.className='';this.scrollTop=0;this.offsetHeight=30;this.rect={top:0,bottom:100,height:100,left:0,width:600};this.reveals=[];this.classList={contains:name=>this.className.split(' ').includes(name),add:name=>this.classList.toggle(name,true),remove:name=>this.classList.toggle(name,false),toggle:(name,value)=>{const set=new Set(this.className.split(' ').filter(Boolean));if(value??!set.has(name))set.add(name);else set.delete(name);this.className=[...set].join(' ');}};}
 setAttribute(name,value){this.attributes[name]=String(value);if(name==='class')this.className=String(value);if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=String(value);}
 getAttribute(name){return this.attributes[name]??null;}
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
 constructor(){super('audio');this.currentTime=0;this.duration=NaN;this.error=null;this.playbackRate=1;this.loadCalls=0;this.playCalls=0;this.failNext=true;}
 load(){this.loadCalls++;this.error=null;this.duration=NaN;this.currentTime=0;this.dispatchEvent(new Event('timeupdate'));}
 async play(){this.playCalls++;if(this.error)throw Error('Media stays failed until reloaded');if(this.failNext){this.failNext=false;this.error={code:4};this.dispatchEvent(new Event('error'));throw Error('First request failed');}this.duration=5;this.dispatchEvent(new Event('loadedmetadata'));this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'));}
 pause(){this.dispatchEvent(new Event('pause'));}
}
function harness(t){
 const old=Object.fromEntries(['document','window','Element'].map(key=>[key,globalThis[key]]));
 globalThis.Element=ElementStub;
 globalThis.document={activeElement:null,createElementNS:(_,tag)=>new ElementStub(tag),getSelection:()=>null};
 globalThis.window={innerHeight:600,matchMedia:()=>({matches:true}),addEventListener(){},removeEventListener(){}};
 t.after(()=>{stopPlayback();for(const[key,value]of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
 const all=[];
 const h=(tag,attrs={},...children)=>{const node=tag==='audio'?new AudioStub():new ElementStub(tag);all.push(node);for(const[key,value]of Object.entries(attrs)){if(value===undefined||value===null||value===false)continue;if(key.startsWith('on'))node.addEventListener(key.slice(2).toLowerCase(),value);else if(key==='class')node.className=value;else if(key==='style')Object.assign(node.style,value);else if(['checked','disabled','value'].includes(key))node[key]=value;else node.setAttribute(key,value);}node.append(...children.flat(Infinity).filter(c=>c!==undefined&&c!==null&&c!==false));return node;};
 const c={id:'playback-test-'+crypto.randomUUID(),channel:'voice call',audioUrl:'/synthetic.wav',syncOffset:1,participants:[{id:'P01',number:1,role:'operator',label:'Оператор'}],messages:[{id:1,role:'operator',participantId:'P01',text:'First',atSeconds:1},{id:2,role:'operator',participantId:'P01',text:'Second',atSeconds:3},{id:3,role:'operator',participantId:'P01',text:'Last',atSeconds:5}]};
 const section=createTranscript(c,{h,icon:()=>h('span'),save:()=>true,onMessageSelect(){}});
 return {section,all,audio:all.find(n=>n.tagName==='audio'),play:all.find(n=>n.className==='player-play'),rate:all.find(n=>n.getAttribute('aria-label')==='Скорость воспроизведения'),follow:all.find(n=>n.tagName==='input'&&n.getAttribute('type')==='checkbox'),rows:all.filter(n=>n.tagName==='article'),messages:all.find(n=>n.className==='messages')};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function click(node){node.dispatchEvent(new Event('click'));await settle();}

test('Manual audio retry clears a failed source and preserves the selected sync time and rate',async t=>{
 const ui=harness(t);await settle();
 await click(ui.rows[1].querySelector('.timestamp'));
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
 await click(ui.rows[1].querySelector('.timestamp'));
 assert.equal(ui.rows[1].reveals.length,1);assert.equal(ui.rows[1].reveals[0].behavior,'instant','reduced motion is respected');
 ui.audio.failNext=false;await click(ui.play);
 assert.equal(ui.rows[1].reveals.length,2,'manual start reveals the current row while follow is enabled');
 ui.audio.currentTime=4;ui.audio.dispatchEvent(new Event('timeupdate'));
 assert.equal(ui.rows[2].reveals.length,0,'automatic following is limited to the inner transcript');
 await click(ui.play);ui.follow.checked=false;ui.follow.dispatchEvent(new Event('change'));
 await click(ui.play);assert.equal(ui.rows[2].reveals.length,0,'manual start with follow disabled leaves the page alone');
});
