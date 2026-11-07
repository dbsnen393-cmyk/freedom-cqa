import {initialCriteria,demoConversations,calculate,criterionContribution,scoreBreakdown,valueLabel,formatScore} from "./domain.js";
import {normalizeRecord,upgradeConversation,mergeDataset} from './timeline.js';
import {createTranscript,stopPlayback,seekMessage} from './playback.js';
import {preparedConversation,prepareConversation,preparationPanel} from './preparation-ui.js';
import {createAIControls} from './ai-ui.js';
import {assessmentIdentity,effectiveAnswers,installAssessment} from './assessment-state.js';
import {preprocessingKey} from './preprocess.js';
import {isTestConversation,createTestAssessment} from './offline-assessment.js';
import {createValidationUI} from './validation-ui.js';
const STORE="freedom-cqa-prototype-v1";
const defaults={schema:1,conversations:demoConversations,criteria:initialCriteria,version:1,appeals:[]};
let data=structuredClone(defaults);
try{const saved=JSON.parse(localStorage.getItem(STORE));if(saved?.schema===1&&Array.isArray(saved.conversations)&&Array.isArray(saved.criteria)&&Array.isArray(saved.appeals))data=saved;}catch{}
let route=location.hash.slice(1)||"overview", search="", language="ALL", status="all", sort="recent", detailTab="assessment", menuOpen=false;
data.conversations=data.conversations.map(upgradeConversation);
data.activeDataset ||= 'DEMO';data.syncHistory ||= {};
data.references = Array.isArray(data.references)?data.references:[];
if(Array.isArray(data.archivedAppeals)){for(const a of data.archivedAppeals)if(!data.appeals.some(p=>p.id===a.id))data.appeals.push({...a,previousStatus:a.status,status:'archived',archiveReason:a.archivedReason||'Изменился исходный транскрипт'});delete data.archivedAppeals;}
let channel='all',page=1,syncing=false,syncError='';
let preparingId=null,batchPreparing=false,batchProgress=0;
const aiBusy=new Set(),aiErrors=new Map();
const selectedMessages=new Map();
const sourceConversations=source=>data.conversations.filter(c=>source==='TEST'?isTestConversation(c):c.source===source&&!isTestConversation(c));
const visibleConversations=()=>sourceConversations(data.activeDataset);
const sourceLabel=()=>data.activeDataset==='TEST'?'Учебные копии':data.activeDataset==='DEMO'?'Демопримеры':data.activeDataset==='import'?'Импорт JSON':'Набор '+data.activeDataset;
const paths={
 grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
 chats:'M21 11a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z M7 7h10 M7 11h7',
 list:'M9 5h11 M9 12h11 M9 19h11 M3 5h1 M3 12h1 M3 19h1',
 scale:'M12 3v17 M6 21h12 M3 7h18 M6 7l-4 8h8L6 7 M18 7l-4 8h8l-4-8',
 check:'m5 12 4 4L19 6',
 checks:'m2 12 5 5L17 7 M12 17l10-10',
 clock:'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
 globe:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M2 12h20 M12 2c6 5 6 15 0 20-6-5-6-15 0-20',
 arrow:'M5 12h14 m-5-5 5 5-5 5',
 up:'M7 17 17 7 M7 7h10v10',
 back:'M19 12H5 m5-5-5 5 5 5',
 plus:'M12 5v14 M5 12h14',
 chevron:'m9 5 7 7-7 7',
 down:'m6 9 6 6 6-6',
 search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
 download:'M12 3v12 m-5-5 5 5 5-5 M5 16v5h14v-5',
 shield:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4 m-4 10 3 3 5-6',
 spark:'m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3z',
 edit:'m15 4 5 5 M4 20l5-1L21 7l-5-5L4 14z',
 close:'M6 6l12 12 M6 18 18 6',
 upload:'M12 16V3 m-5 5 5-5 5 5 M4 15v6h16v-6',
 alert:'M12 8v5 M12 17h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
 sliders:'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
 menu:'M4 6h16 M4 12h16 M4 18h16',
 headphones:'M3 14v-3a9 9 0 0 1 18 0v3 M3 12h4v8H3z M17 12h4v8h-4z',
 file:'M14 2H5v20h14V7z M14 2v6h5 M8 12h8 M8 16h8'
};
function icon(name,size=18){const s=document.createElementNS("http://www.w3.org/2000/svg","svg");for(const[k,v]of Object.entries({width:size,height:size,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":1.7,"stroke-linecap":"round","stroke-linejoin":"round","aria-hidden":"true"}))s.setAttribute(k,v);const p=document.createElementNS(s.namespaceURI,"path");p.setAttribute("d",paths[name]||paths.file);s.append(p);return s;}
function h(tag,attrs={},...children){const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(v===null||v===undefined||v===false)continue;if(k.startsWith("on"))e.addEventListener(k.slice(2).toLowerCase(),v);else if(k==="class")e.className=v;else if(k==="style")Object.assign(e.style,v);else if(k==="value"||k==="checked"||k==="disabled")e[k]=v;else e.setAttribute(k,v===true?"":String(v));}for(const c of children.flat(Infinity))if(c!==null&&c!==undefined&&c!==false)e.append(c instanceof Node?c:document.createTextNode(String(c)));return e;}
const btn=(text,ico,fn,cls="button")=>h("button",{class:cls,type:"button","aria-label":text||({close:"Закрыть",menu:"Открыть меню"}[ico])||"Открыть",onClick:fn},ico&&icon(ico),text);
const tag=(text,tone="neutral",ico)=>h("span",{class:"tag "+tone},ico&&icon(ico,12),text);
const initials=name=>name.split(" ").slice(0,2).map(x=>x[0]).join("");
const tone=score=>score===null?"neutral":score>=90?"green":score>=75?"amber":"red";
const nav=[["overview","Обзор","grid"],["dialogs","Диалоги","chats"],["checklists","Чек-листы","list"],["appeals","Апелляции","scale"]];
const roleNames={client:"Клиент",operator:"Оператор",system:"Система",bot:"Бот"};
const go=url=>{location.hash=url;};
function notify(text){const box=document.getElementById("toast");box.replaceChildren(icon("checks",20),h("span",{},text),btn("","close",()=>box.classList.remove("visible"),"toast-close"));box.classList.add("visible");clearTimeout(notify.timer);notify.timer=setTimeout(()=>box.classList.remove("visible"),5500);}
let lastSaveSucceeded=true;
function save(){try{localStorage.setItem(STORE,JSON.stringify(data));lastSaveSucceeded=true;return true;}catch{lastSaveSucceeded=false;notify("Не удалось сохранить данные в браузере. Экспортируйте результаты до закрытия страницы.");return false;}}
function savedNotice(text){if(lastSaveSucceeded)notify(text);}
function toggleMenu(open=!menuOpen){menuOpen=open;render();document.querySelector(open?'.mobile-close':'#navigation-toggle')?.focus();}
function finalAnswers(c){return effectiveAnswers(c,data.appeals);}
function currentAppeals(c){return data.appeals.filter(a=>a.conversationId===c.id&&a.status!=='archived'&&!a.archivedAt&&!a.archivedReason&&(a.assessmentId===undefined||a.assessmentId===assessmentIdentity(c)));}
const scoreFor=c=>calculate(c.criteria,finalAnswers(c));
function openDialog(c){if(!c)return;const source=isTestConversation(c)?'TEST':c.source;if(source&&data.activeDataset!==source){data.activeDataset=source;resetFilters();save();}detailTab=c.answers?"assessment":"preparation";go("dialog/"+encodeURIComponent(c.id));}
function downloadJSON(value,filename){const blob=new Blob([JSON.stringify(value,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=h("a",{href:url,download:filename});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function download(){
 const scope=data.activeDataset==='TEST'?'test':data.activeDataset==='DEMO'?'demo':'production';
 const included=data.conversations.filter(c=>scope==='test'?isTestConversation(c):scope==='demo'?c.demo&&!isTestConversation(c):!c.demo&&!isTestConversation(c));
 const ids=new Set(included.map(c=>c.id));
 downloadJSON({schema:1,prototype:true,scope,synthetic:scope!=='production',exportedAt:new Date().toISOString(),criteria:data.criteria,version:data.version,activeDataset:data.activeDataset,conversations:included.map(c=>({...c,finalAnswers:finalAnswers(c),finalScore:scoreFor(c)})),appeals:data.appeals.filter(a=>ids.has(a.conversationId)),references:data.references.filter(r=>ids.has(r.conversationId))},'freedom-cqa-'+scope+'-export.json');
 notify(scope==='test'?'Учебные результаты экспортированы отдельно.':scope==='demo'?'Демонстрационные примеры экспортированы отдельно.':'Рабочие результаты экспортированы без учебных и демонстрационных данных.');
}
const scopedAppeals=()=>{const ids=new Set(visibleConversations().map(c=>c.id));return data.appeals.filter(a=>ids.has(a.conversationId)&&(data.activeDataset==='TEST'||a.testMode!==true));};
const validation=createValidationUI({h,icon,btn,tag,modal,notify,getData:()=>data,save,render,openDialog,downloadJSON,runTestAssessment});
const ai=createAIControls({h,icon,btn,tag,modal,notify,onConfigChange:()=>{const previous=document.querySelector('.ai-status-button');if(previous)previous.replaceWith(ai.statusButton());}});
function render(){
 stopPlayback();
 const focused=document.activeElement?.id;const caret=document.activeElement?.selectionStart;
 const active=route.startsWith("dialog/")?"dialogs":route;
 const c=route.startsWith("dialog/")?data.conversations.find(c=>encodeURIComponent(c.id)===route.slice(7)):null;
 const openCount=scopedAppeals().filter(a=>a.status==="open").length;
 const sidebar=h("aside",{id:"main-navigation",class:"sidebar"+(menuOpen?" is-open":""),inert:matchMedia("(max-width:1000px)").matches&&!menuOpen},
  h("a",{href:"#overview",class:"brand","aria-label":"Freedom CQA — главная"},h("img",{src:"./freedom-logo.svg",alt:"Freedom",width:142,height:34}),h("span",{},"CQA")),
  h("div",{class:"workspace"},h("strong",{},"Контроль качества")),
  h("p",{class:"nav-label"},"РАЗДЕЛЫ"),
  h("nav",{"aria-label":"Основная навигация"},nav.map(([id,label,ico])=>h("a",{href:"#"+id,class:"nav-item"+(active===id?" active":""),"aria-current":active===id?"page":null},icon(ico,20),h("span",{},label),id==="dialogs"?h("small",{},visibleConversations().length):id==="appeals"&&openCount?h("small",{},openCount):null))),
  h("div",{class:"sidebar-bottom"},h("div",{class:"storage-note"},icon("file",17),h("div",{},h("strong",{},"Данные этого браузера"),h("span",{},"Экспорт доступен в списке диалогов"))),h("div",{class:"sidebar-footer"},h("span",{},"FREEDOM CQA"),h("span",{},"v0.5"))));
 const title=c?c.title:({overview:"Качество диалогов",dialogs:"Все диалоги",checklists:"Чек-листы оценки",appeals:"Апелляции",settings:"Настройки",validation:"Проверка точности"}[active]||"Диалог не найден");
 const description=c?"Реплики, результаты проверки и история решений.":({overview:"Сводка по выбранному набору диалогов.",dialogs:"Поиск, фильтрация и оценка диалогов.",checklists:"Критерии, веса и условия применения.",appeals:"Заявки на пересмотр оценок и принятые решения.",settings:"Подключения, источники данных и проверка модели.",validation:"Сравнение оценок с эталонной разметкой."}[active]||"");
 const header=h("header",{class:"topbar"},h("div",{class:"breadcrumb"},btn("","menu",()=>toggleMenu(),"icon-button mobile-menu"),active==="validation"?h("a",{href:"#settings"},"Настройки"):h("span",{},"Рабочее пространство"),icon("chevron",14),h("strong",{},c?"Диалог":active==="validation"?"Проверка точности":active==="settings"?"Настройки":nav.find(n=>n[0]===active)?.[1]||"CQA")),h("div",{class:"topbar-right"},ai.statusButton(),h("button",{class:"source-switch",onClick:sourceModal},h("span",{class:"tiny-dot green-dot"}),h("span",{class:"source-switch-label",title:sourceLabel()},sourceLabel()),icon("down",14))));
 const menuButton=header.querySelector(".mobile-menu");menuButton.id='navigation-toggle';menuButton.setAttribute('aria-label',menuOpen?'Закрыть меню':'Открыть меню');menuButton.setAttribute('aria-expanded',String(menuOpen));menuButton.setAttribute('aria-controls','main-navigation');
 sidebar.addEventListener('keydown',e=>{if(e.key==='Escape'&&menuOpen){e.preventDefault();menuOpen=false;render();document.getElementById('navigation-toggle')?.focus();}});
 const main=h("main",{id:"main-content",class:"main-content"+(c?" conversation-page":"")},
  c&&h("a",{href:"#dialogs",class:"back-link"},icon("back",16),"Все диалоги"),
  active==="validation"&&h("a",{href:"#settings",class:"back-link"},icon("back",16),"Настройки"),
  h("div",{class:"page-heading"},h("div",{},c&&h("div",{class:"eyebrow"},c.id),h("h1",{},title),!c&&h("p",{},description)),
   !c&&["overview","dialogs"].includes(active)?btn("Добавить диалоги","plus",uploadModal,"button primary"):active==="checklists"?btn("Добавить критерий","plus",()=>criterionModal(),"button primary"):null));
 if(!['validation','settings'].includes(active)&&(data.activeDataset==='TEST'||isTestConversation(c)))main.append(h('div',{class:'validation-notice test-notice',role:'note'},icon('alert',20),h('div',{},h('strong',{},'Учебный режим · без ИИ'),h('p',{},'Значения задаются для проверки интерфейса. Это не оценка качества диалога и не результат работы модели.'))));
 if(["overview","dialogs"].includes(active)&&!c)main.append(h("div",{class:"dataset-toolbar"},sourceBar(),preparationBar()));
 if(!lastSaveSucceeded)main.append(h('section',{class:'source-bar',role:'alert'},h('div',{},h('strong',{},'Изменения пока только в памяти'),h('p',{},'Браузер не сохранил данные. Экспортируйте результаты до закрытия или обновления страницы.')),btn('Экспортировать результаты','download',download)));
 if(active==="overview")main.append(overview());
 if(["overview","dialogs"].includes(active)&&!c)main.append(dialogTable());
 if(c)main.append(detail(c));
 if(active==="checklists")main.append(checklists());
 if(active==="appeals")main.append(appealsPage());
 if(active==="settings")main.append(settingsPage());
 if(active==="validation")main.append(validation.page());
 if(route.startsWith("dialog/")&&!c)main.append(h("section",{class:"card empty-state"},h("h2",{},"Диалог не найден"),h("a",{href:"#dialogs",class:"button"},"Вернуться к списку")));
 main.append(h("footer",{class:"page-footer"},h("span",{},"Freedom CQA"),h("span",{},"Активный чек-лист v"+data.version)));
 if(matchMedia("(max-width:1000px)").matches&&menuOpen)sidebar.prepend(btn("Закрыть меню","close",()=>toggleMenu(false),"text-button mobile-close"));
 document.getElementById("app").replaceChildren(h("div",{class:"app-shell"},h("a",{href:"#main-content",class:"skip-link",onClick:e=>{e.preventDefault();main.setAttribute("tabindex","-1");main.focus();}},"Перейти к содержимому"),sidebar,h("div",{class:"main-shell"},header,main)));
 if(focused){const el=document.getElementById(focused);el?.focus();if(caret!==null&&el?.setSelectionRange)el.setSelectionRange(caret,caret);}
}
window.addEventListener("hashchange",()=>{route=location.hash.slice(1)||"overview";menuOpen=false;render();window.scrollTo(0,0);});
function settingsPage(){
 const setting=(title,description,ico,action)=>h('section',{class:'card workspace-setting'},h('div',{class:'setting-symbol'},icon(ico,21)),h('div',{class:'setting-copy'},h('h2',{},title),h('p',{},description)),action);
 return h('div',{class:'workspace-settings'},
  setting('Оценка ИИ','Подключение к модели и параметры оценки.','spark',btn('Настроить ИИ','sliders',()=>ai.settings())),
  setting('Источники диалогов','Выбран источник: '+sourceLabel()+'. Диалогов: '+visibleConversations().length+'.','chats',btn('Управление наборами','sliders',sourceModal)),
  setting('Проверка модели','Сравнение с эталонной разметкой, расхождения и учебные сценарии.','checks',h('a',{class:'button',href:'#validation'},'Проверка точности',icon('arrow',16))));
}
function overview(){
 const scores=visibleConversations().map(scoreFor).filter(s=>s!==null);
 const assessed=visibleConversations().filter(c=>c.answers).length;
 const count=visibleConversations().length, mean=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:null;
 const open=scopedAppeals().filter(a=>a.status==="open").length;
 const stat=(label,ico,value,caption,bottom)=>h("div",{class:"stat-card"},h("div",{class:"stat-top"},h("span",{},label),icon(ico,19)),h("div",{class:"stat-value"},value,h("span",{class:"stat-caption"},caption)),h("div",{class:"stat-bottom"},bottom));
 const grid=h("section",{class:"stat-grid","aria-label":"Обзор показателей"},
  stat("Всего диалогов","chats",count,"в наборе",h("span",{},[...new Set(visibleConversations().map(c=>c.language))].join(" · ")||"Нет данных")),
  stat("Средняя оценка","spark",mean===null?"—":mean.toFixed(1).replace(".",","),"/ 100",h("span",{class:"subtle-green"},"По "+scores.length+" оценённым диалогам")),
  stat("Оценено диалогов","checks",assessed,"из "+count,h("div",{class:"progress-line"},h("div",{},h("span",{style:{width:(count?assessed/count*100:0)+"%"}})),h("span",{},(count?Math.round(assessed/count*100):0)+"%"))),
  stat("Апелляции","scale",open,"на рассмотрении",open?"Ожидают решения":"Нет открытых заявок"));
 const distribution=h("section",{class:"distribution card","aria-label":"Распределение оценок"},h("div",{class:"section-title"},h("h2",{},"Распределение оценок"),h("span",{class:"subtle"},scores.length+" диалогов")),
  h("div",{class:"distribution-bands"},[["90–100 баллов","Высокая оценка",x=>x>=90,"green"],["75–89 баллов","Средняя оценка",x=>x>=75&&x<90,"mint"],["0–74 балла","Низкая оценка",x=>x<75,"amber"]].map(([label,range,test,color])=>{const n=scores.filter(test).length;return h("div",{class:"distribution-row"},h("div",{},h("span",{},label,h("small",{},range)),h("strong",{},n)),h("div",{class:"bar-track"},h("span",{class:color,style:{width:(scores.length?n/scores.length*100:0)+"%"}})));})),
  h("div",{class:"distribution-foot"},icon("shield",15),visibleConversations().some(c=>c.criteria.some(rule=>rule.type==="flag"&&finalAnswers(c)?.[rule.id]?.value===true))?"Есть отмеченные грубые ошибки":(scores.length?"Грубых ошибок не отмечено":"Диалоги ещё не оценены")));
 return h("div",{class:"overview-summary"},grid,distribution);
}
function dialogTable(){
 const filtered=visibleConversations().filter(c=>(channel==="all"||c.channel===channel)&&(language==="ALL"||c.language===language)&&(status==="all"||(status==="rated"&&c.answers)||(status==="pending"&&!c.answers))&&[c.title,c.id,c.operator].join(" ").toLowerCase().includes(search.toLowerCase()));
 page=Math.max(1,Math.min(page,Math.ceil(filtered.length/12)));
 if(sort==="score")filtered.sort((a,b)=>(scoreFor(b)??-1)-(scoreFor(a)??-1));
 const languageSelect=h("select",{id:"language-filter","aria-label":"Язык диалога",onChange:e=>{language=e.target.value;page=1;render();}},[["ALL","Все языки"],["RU","RU"],["KZ","KZ"],["EN","EN"]].map(([v,t])=>h("option",{value:v,selected:language===v},t)));
 const sorting=h("select",{id:"sort-filter","aria-label":"Сортировка диалогов",onChange:e=>{sort=e.target.value;page=1;render();}},h("option",{value:"recent",selected:sort==="recent"},"По порядку"),h("option",{value:"score",selected:sort==="score"},"По оценке"));
 const table=h("table",{class:"dialog-table"},h("thead",{},h("tr",{},["Диалог","Оператор","Язык","Оценка","Статус",""].map(t=>h("th",{},t||h("span",{class:"sr-only"},"Действия"))))),h("tbody",{},filtered.slice((page-1)*12,page*12).map(c=>{
 const prep=preparedConversation(c,data.criteria,data.version);const score=scoreFor(c), hasAppeal=data.appeals.some(a=>a.conversationId===c.id&&a.status==="open");
 const rowButton=btn("","up",()=>openDialog(c),"icon-button");rowButton.setAttribute("aria-label","Открыть "+c.id);
 return h("tr",{},h("td",{},h("button",{class:"dialog-title-button",onClick:()=>openDialog(c)},h("span",{class:"channel-icon"},icon(c.channel==="voice call"?"headphones":"chats",18)),h("span",{},h("strong",{},c.title),h("small",{},c.id,h("span",{}," · "),c.date)))),
 h("td",{},h("div",{class:"operator-cell"},h("span",{class:"avatar mini avatar-"+c.language.toLowerCase()},initials(c.operator)),c.operator)),
 h("td",{},h("span",{class:"language-chip"},c.language)),
 h("td",{},h("div",{class:"score-cell "+tone(score)},h("strong",{},formatScore(score)),score!==null&&h("span",{},"/ 100"))),
 h("td",{},tag(hasAppeal?"Апелляция":c.answers?"Оценён":prep?.report.status==="blocked"?"Ошибка данных":prep?"Подготовлен":"Ожидает оценки",hasAppeal?"amber":c.answers?"green":prep?.report.status==="blocked"?"red":"neutral",hasAppeal?"scale":c.answers?"check":prep?"file":"clock")),h("td",{},rowButton));})));
 return h("section",{class:"card table-card"},
  h("div",{class:"table-heading"},h("div",{class:"section-title"},h("h2",{},"Диалоги"),h("span",{class:"count"},visibleConversations().length)),btn("Экспорт","download",download,"text-button")),
  h("div",{class:"table-toolbar"},h("div",{class:"segmented","aria-label":"Статус диалогов"},[["all","Все диалоги"],["rated","Оценены"],["pending","Ожидают оценки"]].map(([id,label])=>h("button",{class:status===id?"selected":"","aria-pressed":String(status===id),onClick:()=>{status=id;page=1;render();}},label))),
  h("div",{class:"filter-controls"},h("label",{class:"search-field"},icon("search",17),h("input",{id:"dialog-search","aria-label":"Поиск диалога",placeholder:"Поиск диалога...",value:search,onInput:e=>{search=e.target.value;page=1;render();}})),h("label",{class:"select-wrap"},icon("globe",16),languageSelect),h("label",{class:"select-wrap"},h("select",{id:"channel-filter","aria-label":"Канал диалога",onChange:e=>{channel=e.target.value;page=1;render();}},[["all","Все каналы"],["agent chat","Чаты"],["voice call","Звонки"]].map(([v,t])=>h("option",{value:v,selected:channel===v},t)))),h("label",{class:"select-wrap compact-sort"},icon("sliders",16),sorting))),
  h("div",{class:"table-scroll"},table),
  !filtered.length&&h("div",{class:"empty-state"},icon("search",28),h("h3",{},"Ничего не найдено"),h("p",{},"Попробуйте другой запрос или измените фильтры."),btn("Сбросить фильтры",null,()=>{search="";language="ALL";status="all";channel="all";page=1;render();})),
  h("div",{class:"table-footer"},h("span",{},"Найдено "+filtered.length+" из "+visibleConversations().length),h("div",{class:"pagination"},h("button",{class:"text-button",type:"button",disabled:page<=1,onClick:()=>{page--;render();}},"Назад"),h("span",{},page+" / "+Math.max(1,Math.ceil(filtered.length/12))),h("button",{class:"text-button",type:"button",disabled:page*12>=filtered.length,onClick:()=>{page++;render();}},"Вперёд"))));
}
function showEvidence(ids,label="Основание оценки"){
 if(ids.length)seekMessage(ids[0]);
 document.querySelectorAll(".message").forEach(el=>{el.classList.toggle("highlighted",ids.includes(Number(el.dataset.id)));if(ids.includes(Number(el.dataset.id)))el.querySelector(".evidence-marker")?.replaceChildren(icon("check",12),label);});
 const first=document.getElementById("message-"+ids[0]);first?.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth",block:"center"});first?.focus({preventScroll:true});
}
function detail(c){
 const answers=finalAnswers(c);
 const meta=h("div",{class:"detail-meta"},h("span",{class:"operator-cell"},h("span",{class:"avatar mini"},initials(c.operator)),c.operator),h("span",{class:"language-chip"},c.language),h("span",{},icon("chats",15),c.channel==="voice call"?"Звонок":"Чат"),h("span",{},icon("clock",15),c.date),tag(isTestConversation(c)?"Учебная копия · без ИИ":c.demo?"Демонстрационный пример":c.source==="import"?"Загруженный диалог":"Набор "+c.source));
 const transcript=createTranscript(c,{h,icon,save,onMessageSelect:m=>{selectedMessages.set(c.id,m.id);updateMessageContext(c,m);}});
 const selected=c.messages.find(m=>m.id===selectedMessages.get(c.id));
 transcript.append(messageContext(c,selected));
 const isPreparation=detailTab==='preparation'||(!answers&&detailTab==='assessment');
 const evaluation=h("section",{class:"card evaluation"},h("div",{class:"panel-heading"},h("h2",{},"Анализ диалога"),tag("Чек-лист v"+(isPreparation||!answers?data.version:c.version))));
 evaluation.append(h('div',{class:'analysis-tabs'},btn('Проверка данных','sliders',()=>{detailTab='preparation';render();},isPreparation?'selected':''),btn('Оценка','spark',()=>{detailTab='evaluation';render();},!isPreparation?'selected':'')));
 evaluation.querySelectorAll('.analysis-tabs button').forEach(button=>button.setAttribute('aria-pressed',String(button.classList.contains('selected'))));
 if(isTestConversation(c))evaluation.append(validation.testPanel(c));
 else {const aiPanel=ai.actionPanel(c,{busy:aiBusy.has(c.id),error:aiErrors.get(c.id)||'',onAssess:()=>runAssessment(c)});evaluation.append(answers?h('details',{class:'ai-reassessment',open:aiBusy.has(c.id)||aiErrors.has(c.id)},h('summary',{},icon('spark',16),'Повторная оценка ИИ',icon('down',15)),aiPanel):aiPanel);}
 evaluation.append(h('div',{class:'validation-detail-actions'},(!isTestConversation(c)&&!c.demo&&c.source!=='DEMO')&&btn('Эталон вручную','edit',()=>validation.referenceModal(c),'text-button'),!isTestConversation(c)&&btn('Учебная копия','file',()=>validation.testModal(c),'text-button')));
 if(!answers&&c.assessmentHistory?.length)evaluation.append(h('details',{class:'preparation-details'},h('summary',{},'История предыдущих оценок · '+c.assessmentHistory.length,icon('down',15)),h('div',{class:'history-list'},c.assessmentHistory.map(historyEvent))));
 if(isPreparation){evaluation.append(preparationPanel(c,data.criteria,data.version,{h,icon,btn,tag,showEvidence:ids=>showEvidence(ids,"Кандидат для проверки"),onPrepare:()=>prepareOne(c),busy:preparingId===c.id}));return h('div',{},meta,h('div',{class:'detail-grid'},transcript,evaluation));}
 if(answers&&detailTab==='evaluation')detailTab='assessment';
 if(answers){
 const totals=scoreBreakdown(c.criteria,answers);
 evaluation.append(h("div",{class:"evaluation-summary"},h("div",{},h("span",{},isTestConversation(c)?"Учебный результат":"Итоговая оценка"),h("div",{class:"big-score "+tone(totals.score)},formatScore(totals.score),h("small",{},"/100"))),h("div",{class:"summary-note"},icon("shield",20),h("span",{},"По "+c.criteria.length+" критериям",h("br"),h("small",{},"С учётом применимости N/A")))));
 evaluation.append(h('div',{class:'score-breakdown'},totals.applicable?h('p',{class:'score-equation'},h('strong',{},formatScore(totals.earned)+' / '+formatScore(totals.applicable)),h('span',{},'баллов'),h('span',{'aria-hidden':'true'},'→'),h('strong',{},formatScore(totals.score)+' / 100')):h('p',{class:'score-equation'},'Нет применимых критериев с баллами'),h('p',{class:'score-explanation'},totals.excludedWeight?'N/A: '+formatScore(totals.excludedWeight)+' баллов исключено из максимума.':'Все критерии с баллами участвуют в расчёте.',currentAppeals(c).some(a=>a.status==='resolved')?' Учтены решения по апелляциям.':'')));
 evaluation.append(h("div",{class:"detail-tabs"},...["assessment","history"].map((id,i)=>btn(i?"История решений":"По критериям",null,()=>{detailTab=id;render();},detailTab===id?"selected":""))));
 if(detailTab==="assessment"){
 const results=h("div",{class:"criteria-results"});
 for(const[cIndex,rule]of c.criteria.entries()){
 const a=answers[rule.id];if(!a)continue;
 const bad=rule.type==="flag"?a.value===true:a.value!==null&&(a.value===false||(typeof a.value==="number"&&a.value<Math.max(...rule.scale)));
 const revised=currentAppeals(c).filter(p=>p.criterionId===rule.id&&p.status==="resolved").at(-1);
 const contribution=criterionContribution(rule,a),rawValue=valueLabel(a.value)+(a.value!==null&&rule.type==='scale'?' / '+Math.max(...rule.scale):'');
 const metric=(label,value)=>h('span',{class:'criterion-metric'},h('span',{class:'criterion-metric-label'},label),h('span',{class:'criterion-metric-value'},value));
 const points=rule.type==='flag'?'Без баллов':a.value===null?'Исключён':formatScore(contribution)+' / '+formatScore(rule.weight);
 results.append(h("details",{class:"criterion-result",open:cIndex===3},
 h("summary",{class:'criterion-result-summary'},h("span",{class:"criterion-index"},String(cIndex+1).padStart(2,"0")),h('span',{class:'criterion-result-main'},h("span",{class:"criterion-result-title"},rule.title,revised&&h("small",{},"Пересмотрено")),h('span',{class:'criterion-metrics'},metric('Значение',tag(rawValue,a.value===null?"neutral":bad?"amber":"green")),metric('Вес',formatScore(rule.weight)),metric('Баллы',h('strong',{},points)))),icon("down",15)),
 h("div",{class:"criterion-body"},(a.value===null||rule.type==='flag'||rule.type==='scale')&&h('p',{class:'criterion-calculation'},rule.type==='flag'?'Отдельный флаг нарушения. На сумму баллов не влияет.':a.value===null?'Критерий не применим: его вес исключён из итогового расчёта.':formatScore(rule.weight)+' × '+formatScore(a.value)+' / '+formatScore(Math.max(...rule.scale))+' = '+formatScore(contribution)),h("p",{},a.reason),revised&&h("p",{class:"review-note"},"Решение проверяющего: "+revised.reason),
 h("div",{class:"criterion-actions"},btn("Реплики "+a.evidence.join(", "),"chats",()=>showEvidence(a.evidence),"evidence-button"),btn("Оспорить","scale",()=>appealModal(c,rule),"text-button")))));
 }
 results.append(h("p",{class:"method-note"},"Баллы рассчитываются пропорционально весам. Критерии N/A исключаются, итог нормируется до 100. Грубые ошибки отмечаются отдельно."));
 evaluation.append(results);
 }else{
 evaluation.append(h("div",{class:"history-list"},h("div",{class:"history-event"},h("span",{class:"timeline-dot"}),h("strong",{},"Исходная оценка"),h("p",{},formatScore(calculate(c.criteria,c.answers))+" / 100 · Чек-лист v"+c.version),h("small",{},c.assessment?(isTestConversation(c)?"Учебный ответ · ":"ИИ · ")+c.assessment.model+" · "+new Date(c.assessment.createdAt).toLocaleString("ru-RU"):"Демонстрационная разметка")),
 (c.assessmentHistory||[]).map(historyEvent),
 data.appeals.filter(a=>a.conversationId===c.id).map(a=>h("div",{class:"history-event"},h("span",{class:"timeline-dot"}),h("strong",{},c.criteria.find(r=>r.id===a.criterionId)?.title),h("p",{},a.comment),tag(a.status==="archived"?"Архив · предыдущая оценка":a.status==="open"?"Ожидает проверки":valueLabel(a.original)+" → "+valueLabel(a.decision),a.status==="open"?"amber":"green"),a.reason&&h("p",{},"Решение: "+a.reason)))));
 }
 }else evaluation.append(h("div",{class:"empty-state pending-state"},h("div",{class:"empty-icon"},icon("spark",28)),h("h3",{},"Диалог готов к оценке"),h("p",{},isTestConversation(c)?"Задайте учебный ответ кнопкой выше, затем проверьте переходы по репликам, апелляцию и пересчёт.":"Запустите оценку кнопкой выше. ИИ проверит диалог по активному чек-листу и укажет реплики-основания."),tag("Ожидает анализа")));
 return h("div",{},meta,h("div",{class:"detail-grid"},transcript,evaluation));
}
function checklists(){
 return h("div",{},h("div",{class:"checklist-banner"},h("div",{class:"checklist-banner-icon"},icon("list",27)),h("div",{},h("h2",{},"Активный чек-лист"),h("p",{},"Русский, казахский и английский · Чаты и транскрипты звонков")),h("div",{class:"banner-tags"},tag("Активный","green"),tag("Версия "+data.version))),
 h("div",{class:"checklist-toolbar"},h("span",{},data.criteria.length+" критериев",h("span",{class:"separator"},"/"),"Сумма весов: ",h("strong",{},data.criteria.reduce((s,c)=>s+c.weight,0))),h("span",{},icon("shield",15),"Изменения сохраняются новой версией")),
 h("section",{class:"card checklist-list"},data.criteria.map((c,i)=>{const edit=btn("","edit",()=>criterionModal(c),"icon-button");edit.setAttribute("aria-label","Редактировать "+c.title);return h("article",{class:"checklist-row"},h("span",{class:"criterion-index"},String(i+1).padStart(2,"0")),h("div",{class:"checklist-text"},h("h3",{},c.title),h("p",{},c.description),h("div",{class:"rule-tags"},tag(c.type==="scale"?"Шкала: "+c.scale.join(" / "):c.type==="flag"?"Флаг нарушения":"Да / Нет"),c.allowNA&&tag("N/A доступно")),c.allowNA&&h("p",{class:"na-rule"},"N/A: "+c.naRule)),h("div",{class:"weight"},h("strong",{},c.weight),h("span",{},c.type==="flag"?"без баллов":"вес")),edit);})),
 h("div",{class:"info-note"},icon("alert",17),h("span",{},"Ранее оценённые диалоги сохраняют свою версию чек-листа. Новые правила будут передаваться модели при запуске оценки.")));
}
function appealsPage(){
 const open=scopedAppeals().filter(a=>a.status==="open").length;
 return h("div",{},h("div",{class:"appeal-summary"},tag(sourceLabel()),tag(open+" на рассмотрении","amber"),tag(scopedAppeals().filter(a=>a.status==="resolved").length+" рассмотрено","green"),tag(scopedAppeals().filter(a=>a.status==="archived").length+" в архиве")),
 !scopedAppeals().length?h("section",{class:"card empty-state spacious"},h("div",{class:"empty-icon"},icon("scale",30)),h("h2",{},"Апелляций нет"),h("p",{},"Откройте оценённый диалог и выберите «Оспорить»",h("br"),"у критерия, который требует пересмотра."),h("a",{class:"button",href:"#dialogs"},"Перейти к диалогам",icon("arrow",16))):
 h("div",{class:"appeal-list"},scopedAppeals().slice().reverse().map(a=>{const c=data.conversations.find(c=>c.id===a.conversationId), rule=c?.criteria.find(r=>r.id===a.criterionId);return h("article",{class:"card appeal-card"},h("div",{class:"appeal-top"},isTestConversation(c)&&tag("Учебная апелляция","amber"),tag(a.status==="archived"?"Архив":a.status==="open"?"На рассмотрении":"Рассмотрено",a.status==="archived"?"neutral":a.status==="open"?"amber":"green"),h("span",{class:"subtle"},a.created)),h("h2",{},a.criterionTitle||rule?.title||"Критерий предыдущей версии"),h("a",{href:"#dialog/"+encodeURIComponent(a.conversationId)},c?.title,icon("up",14)),h("blockquote",{},a.comment),(a.evidenceIds||[]).length>0&&h("p",{class:"appeal-attached"},"Приложены реплики: "+a.evidenceIds.map(id=>"#"+id).join(", ")),
 h("div",{class:"appeal-bottom"},h("span",{},"Исходная оценка: ",h("strong",{},valueLabel(a.original)),a.status==="resolved"?" → "+valueLabel(a.decision):""),a.status==="open"&&btn("Рассмотреть","arrow",()=>reviewModal(a,c,rule),"button primary")),
 a.reason&&h("div",{class:"review-note"},h("strong",{},"Решение проверяющего"),h("p",{},a.reason)));})));
}
function modal(title,content){
 const opener=document.activeElement;
 const close=()=>{dialog.close();dialog.remove();opener?.focus();};
 const dialog=h("dialog",{class:"modal","aria-labelledby":"modal-title",onCancel:e=>{e.preventDefault();close();},onClick:e=>{if(e.target===dialog)close();}},
 h("div",{class:"modal-head"},h("h2",{id:"modal-title"},title),h("button",{class:"icon-button","aria-label":"Закрыть",onClick:close},icon("close",20))));
 const error=h("p",{class:"form-error",role:"alert",hidden:true});
 const showError=message=>{error.textContent=message;error.hidden=false;error.tabIndex=-1;error.focus();error.scrollIntoView({block:"nearest"});};
 const actions=(label,ico)=>h("div",{class:"modal-actions"},btn("Отмена",null,close),h("button",{class:"button primary",type:"submit"},icon(ico,17),label));
 dialog.append(content({close,error,showError,actions}));document.body.append(dialog);dialog.showModal();
}
const field=(label,name,value="",type="text",extra={})=>h("div",{},h("label",{class:"form-label",for:"field-"+name},label),h(type==="textarea"?"textarea":"input",{id:"field-"+name,name,...(type==="textarea"?{rows:3}:{type}),value,...extra},type==="textarea"?value:null));
function criterionModal(existing){
 modal(existing?"Редактировать критерий":"Новый критерий",({close,error,showError,actions})=>{
 const type=h("select",{id:"field-type",name:"type"},[["boolean","Да / Нет"],["scale","Числовая шкала"],["flag","Флаг без баллов"]].map(([v,t])=>h("option",{value:v,selected:v===(existing?.type||"boolean")},t)));
 const scaleField=field("Ступени числовой шкалы","scale",existing?.scale.join(", ")||"0, 5, 10");
 const weightField=field("Вес","weight",existing?.weight??10,"number",{min:0,max:100,step:0.5,required:true});
 const naField=field("Условие неприменимости","naRule",existing?.naRule||"","textarea");
 const na=h("input",{type:"checkbox",name:"allowNA",checked:existing?.allowNA});
 const update=()=>{scaleField.hidden=type.value!=="scale";weightField.querySelector("input").disabled=type.value==="flag";naField.hidden=!na.checked;};
 type.addEventListener("change",update);na.addEventListener("change",update);update();
 return h("form",{class:"modal-content",onSubmit:e=>{
 e.preventDefault();const fd=new FormData(e.currentTarget), t=fd.get("type"), allowNA=fd.get("allowNA")==="on", naRule=String(fd.get("naRule")||"").trim();
 const scale=t==="scale"?[...new Set(String(fd.get("scale")).split(/[,;\s]+/).filter(Boolean).map(Number))].sort((a,b)=>a-b):[], weight=t==="flag"?0:Number(fd.get("weight"));
 if(!Number.isFinite(weight)||weight<0||weight>100)return showError("Вес должен быть от 0 до 100.");
 if(t==="scale"&&(scale.length<2||scale.some(n=>!Number.isFinite(n)||n<0)||scale[0]!==0||Math.max(...scale)<=0))return showError("Укажите минимум две ступени, начиная с 0. Например: 0, 5, 10.");
 if(allowNA&&!naRule)return showError("Укажите условие, при котором разрешено N/A.");
 const next={id:existing?.id||"custom-"+Date.now(),title:String(fd.get("title")).trim(),description:String(fd.get("description")).trim(),type:t,scale,weight,allowNA,naRule};
 if(!next.title||!next.description)return showError("Заполните название и правило оценки.");
 data.criteria=existing?data.criteria.map(c=>c.id===existing.id?next:c):[...data.criteria,next];data.version++;save();close();render();savedNotice("Версия "+data.version+" сохранена. Прежние оценки сохраняют свои правила.");
 }},field("Название","title",existing?.title||"","text",{required:true,maxlength:120}),field("Правило оценки","description",existing?.description||"","textarea",{required:true}),h("div",{class:"form-grid"},h("div",{},h("label",{class:"form-label",for:"field-type"},"Тип ответа"),type),weightField),scaleField,h("label",{class:"checkbox-label"},na,"Разрешить N/A"),naField,error,actions("Сохранить версию "+(data.version+1),"check"));
 });
}
function appealModal(c,rule){
 if(!c.answers){notify('Сначала выполните оценку диалога.');return;}
 const identity=assessmentIdentity(c);
 modal('Апелляция по критерию',({close,error,showError,actions})=>{
 const rules=c.criteria.filter(r=>c.answers[r.id]);
 const select=h('select',{id:'appeal-criterion',name:'criterion'},rules.map(r=>h('option',{value:r.id,selected:r.id===(rule?.id||rules[0]?.id)},r.title)));
 const context=h('div',{class:'appeal-context'}),explanation=h('p',{class:'modal-description'});
 const update=()=>{const selected=rules.find(r=>r.id===select.value);context.replaceChildren(h('strong',{},selected.title),tag(valueLabel(finalAnswers(c)[selected.id].value)));explanation.textContent=c.answers[selected.id].reason;};select.addEventListener('change',update);update();
 return h('form',{class:'modal-content',onSubmit:e=>{
 e.preventDefault();const comment=String(new FormData(e.currentTarget).get('comment')).trim(),selected=rules.find(r=>r.id===select.value);
 const current=data.conversations.find(item=>item.id===c.id);
 if(!current?.answers||assessmentIdentity(current)!==identity)return showError('Оценка обновилась. Откройте апелляцию заново.');
 if(!comment)return showError('Добавьте причину апелляции.');
 if(currentAppeals(current).some(a=>a.criterionId===selected.id&&a.status==='open'))return showError('По этому критерию уже есть открытая апелляция.');
 data.appeals.push({id:'appeal-'+crypto.randomUUID(),conversationId:c.id,criterionId:selected.id,criterionTitle:selected.title,assessmentId:identity,evidenceIds:[],comment,testMode:isTestConversation(current),original:finalAnswers(current)[selected.id].value,status:'open',created:new Date().toLocaleDateString('ru-RU')});save();close();render();savedNotice('Апелляция сохранена и ожидает проверки.');
 }},h('p',{class:'modal-description'},'Укажите причину пересмотра оценки критерия. Основания исходной оценки доступны проверяющему.'),h('label',{class:'form-label',for:'appeal-criterion'},'Какой критерий нужно пересмотреть?'),select,context,explanation,field('Почему оценку нужно пересмотреть?','comment','','textarea',{required:true,rows:4,maxlength:4000,placeholder:isTestConversation(c)?'Комментарий для проверки учебной апелляции…':'Объясните, что модель не учла…'}),error,actions('Подать апелляцию','scale'));
 });
}
function reviewModal(a,c,rule){
 if(!c||!rule||a.status!=="open"||!currentAppeals(c).includes(a)){notify("Эта апелляция относится к прежней оценке.");return;}
 const options=[...(rule.type==="scale"?rule.scale.map(n=>[String(n),String(n)]):[["true","Да"],["false","Нет"]]),...(rule.allowNA?[["na","N/A"]]:[])];
 const decode=v=>v==="na"?null:v==="true"?true:v==="false"?false:Number(v);
 modal("Рассмотрение апелляции",({close,error,showError,actions})=>h("form",{class:"modal-content",onSubmit:e=>{
 e.preventDefault();const fd=new FormData(e.currentTarget), reason=String(fd.get("reason")).trim();if(!reason)return showError("Укажите основание решения.");
 const current=data.conversations.find(item=>item.id===c.id);
 if(!current?.answers||!currentAppeals(current).includes(a)||a.status!=="open")return showError("Оценка обновилась. Откройте актуальную апелляцию.");
 if(current.assessment)current.assessment.reviewed=true;
 a.status="resolved";a.decision=decode(fd.get("decision"));a.reason=reason;save();close();render();savedNotice("Решение сохранено. Итоговая оценка пересчитана.");
 }},h("div",{class:"appeal-context"},h("strong",{},rule.title),tag("Было: "+valueLabel(a.original))),h("blockquote",{class:"review-quote"},a.comment),
 h("div",{class:"review-evidence"},c.messages.filter(m=>[...c.answers[rule.id].evidence,...(a.evidenceIds||[])].includes(m.id)).map(m=>h("p",{},h("strong",{},"#"+m.id+" · "+roleNames[m.role]+": "),m.text))),
 h("label",{class:"form-label",for:"field-decision"},"Финальная оценка"),h("select",{id:"field-decision",name:"decision"},options.map(([v,t])=>h("option",{value:v,selected:v===(a.original===null?"na":String(a.original))},t))),field("Основание решения","reason","","textarea",{required:true}),error,actions("Сохранить решение","checks")));
}
function importRecords(text){
 const parsed=JSON.parse(text),records=Array.isArray(parsed)?parsed:parsed.data?.records??parsed.records;
 if(!Array.isArray(records)||!records.length)throw Error('Ожидается массив records с диалогами.');
 if(records.length>500)throw Error('Загрузите не более 500 диалогов за раз.');
 const incoming=records.map((r,i)=>normalizeRecord({...r,conversation_id:r.conversation_id||'import-'+Date.now()+'-'+i},data.criteria,data.version,'import'));
 const merged=mergeDataset(data.conversations.map(c=>({...c,finalAnswers:finalAnswers(c)})),incoming);data.conversations=merged.conversations;data.activeDataset='import';archiveChangedAppeals(incoming);save();return merged.added+merged.updated;
}
function uploadModal(){
 modal("Добавить диалоги",({close,error,showError,actions})=>{
 const accept=text=>{try{const n=importRecords(text);close();status="pending";search="";language="ALL";channel="all";page=1;go("dialogs");render();savedNotice("Добавлено диалогов: "+n+". Можно запускать подготовку и оценку ИИ.");}catch(e){showError(e.message);}};
 return h("div",{class:"modal-content"},h("p",{class:"modal-description"},"Загрузите JSON-файл с транскриптами диалогов."),
 h("label",{class:"upload-drop"},h("div",{class:"empty-icon"},icon("upload",28)),h("strong",{},"Выберите JSON-файл"),h("span",{},"Массив records или ответ API · до 5 МБ"),h("input",{type:"file",accept:".json,application/json",onChange:async e=>{const f=e.target.files[0];if(!f)return;if(f.size>5*1024*1024)return showError("Файл должен быть меньше 5 МБ.");try{accept(await f.text());}catch{showError("Не удалось прочитать файл.");}}})),
 h("div",{class:"or-divider"},h("span",{},"или вставьте JSON")),
 h("form",{onSubmit:e=>{e.preventDefault();accept(String(new FormData(e.currentTarget).get("json")));}},field("Данные диалогов","json","","textarea",{required:true,rows:7,placeholder:'{"records": [{"conversation_id": "chat-001", "language": "RU", "transcript": [{"timestamp": "00:00", "speaker": "client", "text": "Здравствуйте!"}]}]}'}),h("div",{class:"info-note"},icon("alert",16),h("span",{},"Новые диалоги сохраняются без оценки. Запустите подготовку и оценку ИИ в карточке диалога.")),error,actions("Добавить","plus")));
 });
}
function archiveChangedAppeals(incoming){
 const changed=new Set(incoming.filter(c=>data.conversations.find(x=>x.id===c.id)?.transcriptChanged).map(c=>c.id));
 for(const a of data.appeals.filter(a=>changed.has(a.conversationId)&&a.status!=='archived'))Object.assign(a,{previousStatus:a.status,status:'archived',archiveReason:'Изменился исходный транскрипт',archivedAt:new Date().toISOString()});
}
function resetFilters(){search='';language='ALL';status='all';channel='all';page=1;}
async function syncDataset(group){
 group=String(group||'DEV').trim();if(syncing)return;
 if(!/^[A-Za-z0-9_-]{1,64}$/.test(group)){notify('Укажите корректный ID набора.');return;}
 syncing=true;syncError='';render();
 try{
  const response=await fetch('/api/datasets?group_id='+encodeURIComponent(group)+'&refresh=1',{signal:AbortSignal.timeout(60_000)});
  const payload=await response.json();if(!response.ok||payload.isSuccess!==true)throw Error(payload.error||'Не удалось загрузить набор.');
  const incoming=payload.data.records.map(r=>normalizeRecord(r,data.criteria,data.version,group));
  const ids=new Set();for(const c of incoming){if(ids.has(c.id))throw Error('В наборе повторяются ID диалогов.');ids.add(c.id);}
  const merged=mergeDataset(data.conversations.map(c=>({...c,finalAnswers:finalAnswers(c)})),incoming);data.conversations=merged.conversations;archiveChangedAppeals(incoming);
  data.activeDataset=group;data.syncHistory[group]={at:payload.synced_at,count:incoming.length};resetFilters();save();
  savedNotice('Набор '+group+': '+incoming.length+' диалогов. Добавлено '+merged.added+', обновлено '+merged.updated+'.');
 }catch(e){syncError=e.name==='TimeoutError'?'Источник отвечает слишком долго. Повторите загрузку.':e.message||'Не удалось подключиться к источнику.';}
 finally{syncing=false;render();}
}
function sourceBar(){
 const list=visibleConversations(),history=data.syncHistory[data.activeDataset],isApi=!['DEMO','import','TEST'].includes(data.activeDataset);
 const hasDev=Boolean(data.syncHistory.DEV)||sourceConversations('DEV').length>0;
 const connect=btn(syncing?'Загрузка…':isApi?'Обновить набор':hasDev?'Открыть DEV':'Загрузить DEV',isApi||!hasDev?'download':'arrow',()=>{
  if(!isApi&&hasDev){data.activeDataset='DEV';resetFilters();syncError='';save();render();return;}
  syncDataset(isApi?data.activeDataset:'DEV');
 },'button source-connect');connect.disabled=syncing;
 return h('section',{class:'source-bar','aria-label':'Источник диалогов'},h('div',{class:'source-info'},h('span',{class:'source-icon'},icon('globe',21)),h('div',{},h('strong',{},sourceLabel()),h('p',{},isApi?list.filter(c=>c.channel==='agent chat').length+' чатов · '+list.filter(c=>c.channel==='voice call').length+' звонков'+(history?' · Обновлено '+new Date(history.at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):''):data.activeDataset==='TEST'?'Изолированные копии для проверки оценки и апелляций':data.activeDataset==='DEMO'?'Примеры с демонстрационными оценками':'Диалоги из загруженных файлов'))),h('div',{class:'source-actions'},btn('Сменить','sliders',sourceModal,'text-button'),connect),syncError&&h('p',{class:'source-error',role:'alert'},syncError));
}
function sourceModal(){
 modal('Источник диалогов',({close,error,showError})=>{
  const sources=[...new Set(['DEMO',...Object.keys(data.syncHistory),...data.conversations.map(c=>isTestConversation(c)?'TEST':c.source)])];
  return h('div',{class:'modal-content'},h('p',{class:'modal-description'},'Данные API и демонстрационные примеры показываются отдельно.'),h('div',{class:'source-options'},sources.map(source=>btn((source==='TEST'?'Учебные копии':source==='DEMO'?'Демопримеры':source==='import'?'Импорт JSON':source)+' · '+sourceConversations(source).length,'chats',()=>{data.activeDataset=source;resetFilters();save();close();go('dialogs');render();},'button'+(data.activeDataset===source?' selected-source':'')))),h('form',{onSubmit:e=>{e.preventDefault();const group=String(new FormData(e.currentTarget).get('group')).trim();if(!/^[A-Za-z0-9_-]{1,64}$/.test(group))return showError('ID может содержать латинские буквы, цифры, дефис и подчёркивание.');close();go('dialogs');syncDataset(group);}},field('ID набора','group','DEV','text',{required:true,maxlength:64}),h('p',{class:'modal-description'},'Укажите ID набора, доступного в подключённом API.'),error,h('div',{class:'modal-actions'},btn('Импорт JSON','upload',()=>{close();uploadModal();}),h('button',{class:'button primary',type:'submit',disabled:syncing},'Загрузить из API'))));
 });
}

async function prepareOne(c){
 if(preparingId||batchPreparing)return;preparingId=c.id;render();
 try{await prepareConversation(c,data.criteria,data.version);notify('Предварительный разбор готов. Данные в ИИ не отправлялись.');}
 catch{notify('Не удалось подготовить диалог. Проверьте данные и повторите попытку.');}
 finally{preparingId=null;render();}
}
async function prepareDataset(){
 if(batchPreparing||preparingId)return;batchPreparing=true;batchProgress=0;render();let failures=0;
 const selected=visibleConversations().slice(),rules=structuredClone(data.criteria),version=data.version;
 try{for(const c of selected){try{await prepareConversation(c,rules,version);}catch{failures++;}batchProgress++;if(batchProgress%8===0)render();}}
 finally{batchPreparing=false;render();notify('Подготовлено '+(selected.length-failures)+' диалогов'+(failures?', ошибок: '+failures:'')+'. Отправки в ИИ не было.');}
}
function preparationBar(){
 const list=visibleConversations(),prepared=list.filter(c=>preparedConversation(c,data.criteria,data.version)),blocked=prepared.filter(c=>preparedConversation(c,data.criteria,data.version).report.status==='blocked').length;
 const action=btn(batchPreparing?'Обработано '+batchProgress+' / '+list.length:'Подготовить набор','sliders',prepareDataset,'button');action.disabled=batchPreparing||!!preparingId||!list.length;
 return h('section',{class:'preparation-bar','aria-label':'Проверка данных набора'},h('div',{},h('strong',{},'Проверка данных'),h('p',{role:'status','aria-live':'polite'},'Подготовлено '+prepared.length+' из '+list.length+' · Чек-лист v'+data.version+(blocked?' · Требуют исправления: '+blocked:''))),action);
}
function historyEvent(run){return h('div',{class:'history-event'},h('span',{class:'timeline-dot'}),h('strong',{},'Предыдущая оценка'),h('p',{},formatScore(calculate(run.criteria,run.finalAnswers||run.answers))+' / 100 · Чек-лист v'+run.version),h('small',{},(run.assessment?.provider==='fixture'?'Учебный ответ · без ИИ':run.assessment?.model||'Демонстрационная разметка')+(run.finalAnswers?' · с учётом ручных решений':'')),run.archiveReason&&h('p',{},run.archiveReason));}
function messageContext(c,message){
 const box=h('div',{class:'message-context',id:'message-context','aria-live':'polite'});
 if(!message){box.append(h('p',{},'Выберите реплику, чтобы увидеть связанные критерии.'));return box;}
 const related=(c.criteria||[]).filter(r=>c.answers?.[r.id]?.evidence?.includes(message.id));
 box.append(h('strong',{},'Выбрана реплика #'+message.id),h('p',{},!c.answers?'После оценки здесь появятся связанные критерии.':related.length?'Использована в оценке: '+related.map(r=>r.title).join(' · '):'Эта реплика не указана в основаниях оценки.'));
 return box;
}
function updateMessageContext(c,message){document.getElementById('message-context')?.replaceWith(messageContext(c,message));}
async function runTestAssessment(c,options){
 if(!isTestConversation(c))throw Error('Учебную оценку можно сохранить только в отдельной копии.');
 if(aiBusy.has(c.id))throw Error('Дождитесь завершения текущего запуска.');
 const rules=structuredClone(data.criteria),version=data.version,identity=assessmentIdentity(c),key=preprocessingKey(c,rules,version);
 aiBusy.add(c.id);
 try{
  const result=await createTestAssessment(c,rules,version,options);
  const current=data.conversations.find(item=>item.id===c.id);
  if(!current||!isTestConversation(current)||assessmentIdentity(current)!==identity||preprocessingKey(current,rules,version)!==key)throw Error('Учебный диалог изменился. Откройте актуальную копию.');
  installAssessment(current,result,data.appeals,{criteria:data.criteria,version:data.version});
  data.activeDataset='TEST';detailTab='assessment';const saved=save();
  if(route!=='dialog/'+encodeURIComponent(c.id))openDialog(current);else render();
  if(saved)notify('Учебный результат сохранён. ИИ не вызывался. Можно проверить апелляцию.');
  return saved;
 }finally{aiBusy.delete(c.id);}
}
async function runAssessment(c){
 if(isTestConversation(c)){notify('Учебные копии используют только заданные тестовые ответы.');return;}
 if(aiBusy.has(c.id))return;
 if(!ai.config.configured){ai.settings();return;}
 const rules=structuredClone(data.criteria),version=data.version,identity=assessmentIdentity(c);
 const conversation={id:c.id,language:c.language,channel:c.channel,messages:structuredClone(c.messages)};
 const sourceKey=preprocessingKey(c,rules,version);
 aiBusy.add(c.id);aiErrors.delete(c.id);render();
 try{
  const prepared=await prepareConversation(conversation,rules,version);
  if(!prepared.packet)throw Error('В данных есть ошибки. Откройте подготовку к ИИ и исправьте их.');
  const response=await fetch('/api/assess',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversation,criteria:rules,checklistVersion:version}),signal:AbortSignal.timeout(135000)});
  const result=await response.json().catch(()=>{throw Error('Сервер вернул неизвестный ответ. Оценка не сохранена.');});
  if(!response.ok)throw Error(result.error||'Не удалось получить оценку. Повторите позже.');
  const current=data.conversations.find(item=>item.id===c.id);
  if(!current||preprocessingKey(current,rules,version)!==sourceKey||assessmentIdentity(current)!==identity)throw Error('Диалог или его оценка изменились во время запроса. Новый результат не применён.');
  if(result.sourceFingerprint!==prepared.report.sourceFingerprint||result.checklistFingerprint!==prepared.report.checklistFingerprint)throw Error('Ответ не соответствует отправленному диалогу и чек-листу. Оценка не сохранена.');
  installAssessment(current,result,data.appeals,{criteria:data.criteria,version:data.version});save();
  if(route==='dialog/'+encodeURIComponent(c.id))detailTab='assessment';
  savedNotice('Оценка ИИ по чек-листу v'+version+' сохранена. Проверьте основания по каждому критерию.');
 }catch(error){aiErrors.set(c.id,error.name==='TimeoutError'?'Ожидание завершилось. Автоматический повтор не запускался.':error.message||'Не удалось получить оценку.');}
 finally{aiBusy.delete(c.id);render();}
}
render();
ai.loadConfig();


matchMedia("(max-width:1000px)").addEventListener("change",()=>render());
