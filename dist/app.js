import {initialCriteria,demoConversations,calculate,valueLabel,formatScore} from "./domain.js";
const STORE="freedom-cqa-prototype-v1";
const defaults={schema:1,conversations:demoConversations,criteria:initialCriteria,version:1,appeals:[]};
let data=structuredClone(defaults);
try{const saved=JSON.parse(localStorage.getItem(STORE));if(saved?.schema===1&&Array.isArray(saved.conversations)&&Array.isArray(saved.criteria)&&Array.isArray(saved.appeals))data=saved;}catch{}
let route=location.hash.slice(1)||"overview", search="", language="ALL", status="all", sort="recent", detailTab="assessment", menuOpen=false;
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
function save(){try{localStorage.setItem(STORE,JSON.stringify(data));}catch{notify("Не удалось сохранить данные в браузере. Экспортируйте результаты.");}}
function finalAnswers(c){if(!c.answers)return null;const a=structuredClone(c.answers);for(const p of data.appeals.filter(p=>p.conversationId===c.id&&p.status==="resolved"))if(a[p.criterionId]&&p.decision!==undefined)a[p.criterionId].value=p.decision;return a;}
const scoreFor=c=>calculate(c.criteria,finalAnswers(c));
function openDialog(c){detailTab="assessment";go("dialog/"+encodeURIComponent(c.id));}
function download(){const blob=new Blob([JSON.stringify({...data,prototype:true,conversations:data.conversations.map(c=>({...c,finalAnswers:finalAnswers(c),finalScore:scoreFor(c)}))},null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=h("a",{href:url,download:"freedom-cqa-export.json"});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify("Результаты экспортированы.");}
function render(){
 const focused=document.activeElement?.id;const caret=document.activeElement?.selectionStart;
 const active=route.startsWith("dialog/")?"dialogs":route;
 const c=route.startsWith("dialog/")?data.conversations.find(c=>c.id===decodeURIComponent(route.slice(7))):null;
 const openCount=data.appeals.filter(a=>a.status==="open").length;
 const sidebar=h("aside",{class:"sidebar"+(menuOpen?" is-open":""),inert:matchMedia("(max-width:1000px)").matches&&!menuOpen},
  h("a",{href:"#overview",class:"brand","aria-label":"Freedom CQA — главная"},h("img",{src:"./freedom-logo.svg",alt:"Freedom",width:142,height:34}),h("span",{},"CQA")),
  h("div",{class:"workspace"},h("div",{class:"workspace-icon"},icon("chats",21)),h("div",{},h("strong",{},"Контроль качества"),h("span",{},"Рабочее пространство"))),
  h("p",{class:"nav-label"},"АНАЛИТИКА ДИАЛОГОВ"),
  h("nav",{"aria-label":"Основная навигация"},nav.map(([id,label,ico])=>h("a",{href:"#"+id,class:"nav-item"+(active===id?" active":""),"aria-current":active===id?"page":null},icon(ico,20),h("span",{},label),id==="dialogs"?h("small",{},data.conversations.length):id==="appeals"&&openCount?h("small",{},openCount):null))),
  h("div",{class:"sidebar-bottom"},h("div",{class:"sidebar-note"},icon("shield",24),h("strong",{},"Прозрачная оценка"),h("p",{},"От каждого вывода —",h("br"),"к конкретной реплике.")),h("div",{class:"profile"},h("div",{class:"avatar"},"QA"),h("div",{},h("strong",{},"Команда качества"),h("span",{},"Демонстрационный доступ"))),h("div",{class:"sidebar-footer"},h("span",{},"FREEDOM CQA"),h("span",{},"v0.1"))));
 const title=c?c.title:({overview:"Качество диалогов",dialogs:"Все диалоги",checklists:"Чек-листы оценки",appeals:"Апелляции"}[active]||"Диалог не найден");
 const description=c?"Транскрипт, оценка и основания в одном месте.":({overview:"Понимайте каждый диалог. Улучшайте клиентский опыт.",dialogs:"Оценивайте общение и находите точки роста.",checklists:"Единые правила для понятной и воспроизводимой оценки.",appeals:"Каждая спорная оценка заслуживает внимания."}[active]||"");
 const header=h("header",{class:"topbar"},h("div",{class:"breadcrumb"},btn("","menu",()=>{menuOpen=!menuOpen;render();},"icon-button mobile-menu"),h("span",{},"Рабочее пространство"),icon("chevron",14),h("strong",{},c?"Диалог":nav.find(n=>n[0]===active)?.[1]||"CQA")),h("div",{class:"topbar-right"},h("span",{class:"demo-label"},h("span"),"Демо-режим"),h("span",{class:"topbar-divider"}),icon("globe",16),h("span",{},"RU"),h("div",{class:"avatar small"},"QA")));
 header.querySelector(".mobile-menu").setAttribute("aria-label","Открыть меню");
 const main=h("main",{id:"main-content",class:"main-content"},
  c&&h("a",{href:"#dialogs",class:"back-link"},icon("back",16),"Все диалоги"),
  h("div",{class:"page-heading"},h("div",{},h("div",{class:"eyebrow"},c?c.id:"CONVERSATION QUALITY ANALYTICS"),h("h1",{},title),h("p",{},description)),
   !c&&["overview","dialogs"].includes(active)?btn("Добавить диалоги","plus",uploadModal,"button primary"):active==="checklists"?btn("Добавить критерий","plus",()=>criterionModal(),"button primary"):null));
 if(active==="overview")main.append(overview());
 if(["overview","dialogs"].includes(active)&&!c)main.append(dialogTable());
 if(c)main.append(detail(c));
 if(active==="checklists")main.append(checklists());
 if(active==="appeals")main.append(appealsPage());
 if(route.startsWith("dialog/")&&!c)main.append(h("section",{class:"card empty-state"},h("h2",{},"Диалог не найден"),h("a",{href:"#dialogs",class:"button"},"Вернуться к списку")));
 main.append(h("footer",{class:"page-footer"},h("span",{},"Freedom CQA · Хакатон 2026"),h("span",{},"Прототип интерфейса · Оценки на примерах")));
 if(matchMedia("(max-width:1000px)").matches&&menuOpen)sidebar.prepend(btn("Закрыть меню","close",()=>{menuOpen=false;render();},"text-button mobile-close"));
 document.getElementById("app").replaceChildren(h("div",{class:"app-shell"},h("a",{href:"#main-content",class:"skip-link",onClick:e=>{e.preventDefault();main.setAttribute("tabindex","-1");main.focus();}},"Перейти к содержимому"),sidebar,h("div",{class:"main-shell"},header,main)));
 if(focused){const el=document.getElementById(focused);el?.focus();if(caret!==null&&el?.setSelectionRange)el.setSelectionRange(caret,caret);}
}
window.addEventListener("hashchange",()=>{route=location.hash.slice(1)||"overview";menuOpen=false;render();window.scrollTo(0,0);});
function overview(){
 const scores=data.conversations.map(scoreFor).filter(s=>s!==null);
 const assessed=data.conversations.filter(c=>c.answers).length;
 const count=data.conversations.length, mean=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:null;
 const open=data.appeals.filter(a=>a.status==="open").length;
 const stat=(label,ico,value,caption,bottom)=>h("div",{class:"stat-card"},h("div",{class:"stat-top"},h("span",{},label),icon(ico,19)),h("div",{class:"stat-value"},value,h("span",{class:"stat-caption"},caption)),h("div",{class:"stat-bottom"},bottom));
 const grid=h("section",{class:"stat-grid","aria-label":"Обзор показателей"},
  stat("Всего диалогов","chats",count,"в пространстве",h("span",{},h("span",{class:"tiny-dot green-dot"}),"RU · KZ · EN")),
  stat("Средняя оценка","spark",mean===null?"—":mean.toFixed(1).replace(".",","),"/ 100",h("span",{class:"subtle-green"},"По "+scores.length+" оценённым диалогам")),
  stat("Оценено диалогов","checks",assessed,"из "+count,h("div",{class:"progress-line"},h("div",{},h("span",{style:{width:(count?assessed/count*100:0)+"%"}})),h("span",{},(count?Math.round(assessed/count*100):0)+"%"))),
  stat("Открытые апелляции","scale",open,"на рассмотрении",open?"Требуется решение проверяющего":"Все обращения рассмотрены"));
 const spotlight=h("div",{class:"spotlight"},h("div",{class:"spotlight-copy"},h("div",{class:"spotlight-kicker"},icon("shield",15),"КАЧЕСТВО В ДЕТАЛЯХ"),h("h2",{},"За каждой оценкой —",h("br"),"конкретный диалог."),h("p",{},"Проверяйте выводы, находите доказательства",h("br",{class:"desktop-only"})," и принимайте обоснованные решения."),btn("Посмотреть разбор","up",()=>openDialog(data.conversations.find(c=>c.answers)||data.conversations[0]),"spotlight-link")),h("div",{class:"orbital-art","aria-hidden":"true"},h("div",{class:"orbit o1"}),h("div",{class:"orbit o2"}),h("div",{class:"orbit o3"}),h("div",{class:"orbit-center"},icon("checks",44)),h("span",{class:"orbit-tag"},h("span"),"Подтверждено репликой")));
 const distribution=h("div",{class:"distribution card"},h("div",{class:"section-title"},h("h2",{},"Распределение оценок"),h("span",{class:"subtle"},scores.length+" диалогов")),
  [["Отлично","90–100",x=>x>=90,"green"],["Хорошо","75–89",x=>x>=75&&x<90,"mint"],["Требует внимания","0–74",x=>x<75,"amber"]].map(([label,range,test,color])=>{const n=scores.filter(test).length;return h("div",{class:"distribution-row"},h("div",{},h("span",{},label,h("small",{},range)),h("strong",{},n)),h("div",{class:"bar-track"},h("span",{class:color,style:{width:(scores.length?n/scores.length*100:0)+"%"}})));}),
  h("div",{class:"distribution-foot"},icon("shield",15),data.conversations.some(c=>c.criteria.some(rule=>rule.type==="flag"&&finalAnswers(c)?.[rule.id]?.value===true))?"Есть отмеченные грубые ошибки":"Грубых ошибок не отмечено"));
 return h("div",{},grid,h("section",{class:"insight-grid"},spotlight,distribution));
}
function dialogTable(){
 const filtered=data.conversations.filter(c=>(language==="ALL"||c.language===language)&&(status==="all"||(status==="rated"&&c.answers)||(status==="pending"&&!c.answers))&&[c.title,c.id,c.operator].join(" ").toLowerCase().includes(search.toLowerCase()));
 if(sort==="score")filtered.sort((a,b)=>(scoreFor(b)??-1)-(scoreFor(a)??-1));
 const languageSelect=h("select",{id:"language-filter","aria-label":"Язык диалога",onChange:e=>{language=e.target.value;render();}},[["ALL","Все языки"],["RU","RU"],["KZ","KZ"],["EN","EN"]].map(([v,t])=>h("option",{value:v,selected:language===v},t)));
 const sorting=h("select",{id:"sort-filter","aria-label":"Сортировка диалогов",onChange:e=>{sort=e.target.value;render();}},h("option",{value:"recent",selected:sort==="recent"},"По порядку"),h("option",{value:"score",selected:sort==="score"},"По оценке"));
 const table=h("table",{class:"dialog-table"},h("thead",{},h("tr",{},["Диалог","Оператор","Язык","Оценка","Статус",""].map(t=>h("th",{},t||h("span",{class:"sr-only"},"Действия"))))),h("tbody",{},filtered.map(c=>{
 const score=scoreFor(c), hasAppeal=data.appeals.some(a=>a.conversationId===c.id&&a.status==="open");
 const rowButton=btn("","up",()=>openDialog(c),"icon-button");rowButton.setAttribute("aria-label","Открыть "+c.id);
 return h("tr",{},h("td",{},h("button",{class:"dialog-title-button",onClick:()=>openDialog(c)},h("span",{class:"channel-icon"},icon(c.channel==="voice call"?"headphones":"chats",18)),h("span",{},h("strong",{},c.title),h("small",{},c.id,h("span",{}," · "),c.date)))),
 h("td",{},h("div",{class:"operator-cell"},h("span",{class:"avatar mini avatar-"+c.language.toLowerCase()},initials(c.operator)),c.operator)),
 h("td",{},h("span",{class:"language-chip"},c.language)),
 h("td",{},h("div",{class:"score-cell "+tone(score)},h("strong",{},formatScore(score)),score!==null&&h("span",{},"/ 100"))),
 h("td",{},tag(hasAppeal?"Апелляция":c.answers?"Оценён":"Ожидает оценки",hasAppeal?"amber":c.answers?"green":"neutral",hasAppeal?"scale":c.answers?"check":"clock")),h("td",{},rowButton));})));
 return h("section",{class:"card table-card"},
  h("div",{class:"table-heading"},h("div",{class:"section-title"},h("h2",{},route==="overview"?"Последние диалоги":"Диалоги"),h("span",{class:"count"},data.conversations.length)),btn("Экспорт","download",download,"text-button")),
  h("div",{class:"table-toolbar"},h("div",{class:"segmented","aria-label":"Статус диалогов"},[["all","Все диалоги"],["rated","Оценены"],["pending","Ожидают оценки"]].map(([id,label])=>h("button",{class:status===id?"selected":"","aria-pressed":String(status===id),onClick:()=>{status=id;render();}},label))),
  h("div",{class:"filter-controls"},h("label",{class:"search-field"},icon("search",17),h("input",{id:"dialog-search","aria-label":"Поиск диалога",placeholder:"Поиск диалога...",value:search,onInput:e=>{search=e.target.value;render();}})),h("label",{class:"select-wrap"},icon("globe",16),languageSelect),h("label",{class:"select-wrap compact-sort"},icon("sliders",16),sorting))),
  h("div",{class:"table-scroll"},table),
  !filtered.length&&h("div",{class:"empty-state"},icon("search",28),h("h3",{},"Ничего не найдено"),h("p",{},"Попробуйте другой запрос или измените фильтры."),btn("Сбросить фильтры",null,()=>{search="";language="ALL";status="all";render();})),
  h("div",{class:"table-footer"},h("span",{},"Показано "+filtered.length+" из "+data.conversations.length),h("span",{},h("span",{class:"tiny-dot"}),"Демопримеры и загруженные диалоги")));
}
function showEvidence(ids){
 document.querySelectorAll(".message").forEach(el=>{el.classList.toggle("highlighted",ids.includes(Number(el.dataset.id)));});
 const first=document.getElementById("message-"+ids[0]);first?.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth",block:"center"});first?.focus({preventScroll:true});
}
function detail(c){
 const answers=finalAnswers(c);
 const meta=h("div",{class:"detail-meta"},h("span",{class:"operator-cell"},h("span",{class:"avatar mini"},initials(c.operator)),c.operator),h("span",{class:"language-chip"},c.language),h("span",{},icon("chats",15),c.channel==="voice call"?"Звонок":"Чат"),h("span",{},icon("clock",15),c.date),tag(c.demo?"Демонстрационный пример":"Загруженный диалог"));
 const transcript=h("section",{class:"card transcript"},h("div",{class:"panel-heading"},h("h2",{},"Транскрипт"),h("span",{class:"subtle"},c.messages.length+" реплик")),
 c.audioUrl&&h("div",{class:"audio-box"},icon("headphones"),h("a",{href:c.audioUrl,target:"_blank",rel:"noreferrer"},"Открыть запись звонка",icon("up",14))),
 h("div",{class:"messages"},c.messages.map(m=>h("article",{id:"message-"+m.id,"data-id":m.id,tabindex:"-1",class:"message "+m.role},h("div",{class:"message-label"},h("span",{},roleNames[m.role]),h("time",{},m.time),h("span",{class:"message-number"},"#"+m.id)),h("p",{},m.text),h("div",{class:"evidence-marker"},icon("check",12),"Основание оценки")))),
 h("div",{class:"transcript-foot"},icon("shield",15),"Реплики бота и системы учитываются как контекст"));
 const evaluation=h("section",{class:"card evaluation"},h("div",{class:"panel-heading"},h("h2",{},"Оценка диалога"),tag("Чек-лист v"+c.version)));
 if(answers){
 evaluation.append(h("div",{class:"evaluation-summary"},h("div",{},h("span",{},"Итоговая оценка"),h("div",{class:"big-score "+tone(scoreFor(c))},formatScore(scoreFor(c)),h("small",{},"/100"))),h("div",{class:"summary-note"},icon("shield",20),h("span",{},"По "+c.criteria.length+" критериям",h("br"),h("small",{},"С учётом применимости N/A")))));
 evaluation.append(h("div",{class:"detail-tabs"},...["assessment","history"].map((id,i)=>btn(i?"История решений":"По критериям",null,()=>{detailTab=id;render();},detailTab===id?"selected":""))));
 if(detailTab==="assessment"){
 const results=h("div",{class:"criteria-results"});
 for(const[cIndex,rule]of c.criteria.entries()){
 const a=answers[rule.id];if(!a)continue;
 const bad=rule.type==="flag"?a.value===true:a.value!==null&&(a.value===false||(typeof a.value==="number"&&a.value<Math.max(...rule.scale)));
 const revised=data.appeals.filter(p=>p.conversationId===c.id&&p.criterionId===rule.id&&p.status==="resolved").at(-1);
 results.append(h("details",{class:"criterion-result",open:cIndex===3},
 h("summary",{},h("span",{class:"criterion-index"},String(cIndex+1).padStart(2,"0")),h("span",{class:"criterion-result-title"},rule.title,h("small",{},(rule.type==="flag"?"Без баллов":"Вес "+rule.weight)+(revised?" · Пересмотрено":""))),tag(valueLabel(a.value)+(rule.type==="scale"?"/"+Math.max(...rule.scale):""),a.value===null?"neutral":bad?"amber":"green"),icon("down",15)),
 h("div",{class:"criterion-body"},h("p",{},a.reason),revised&&h("p",{class:"review-note"},"Решение проверяющего: "+revised.reason),
 h("div",{class:"criterion-actions"},btn("Реплики "+a.evidence.join(", "),"chats",()=>showEvidence(a.evidence),"evidence-button"),btn("Оспорить","scale",()=>appealModal(c,rule),"text-button")))));
 }
 results.append(h("p",{class:"method-note"},"Баллы рассчитываются пропорционально весам. Критерии N/A исключаются, итог нормируется до 100. Грубые ошибки отмечаются отдельно."));
 evaluation.append(results);
 }else{
 evaluation.append(h("div",{class:"history-list"},h("div",{class:"history-event"},h("span",{class:"timeline-dot"}),h("strong",{},"Исходная оценка"),h("p",{},formatScore(calculate(c.criteria,c.answers))+" / 100 · Чек-лист v"+c.version),h("small",{},"Демонстрационная разметка")),
 data.appeals.filter(a=>a.conversationId===c.id).map(a=>h("div",{class:"history-event"},h("span",{class:"timeline-dot"}),h("strong",{},c.criteria.find(r=>r.id===a.criterionId)?.title),h("p",{},a.comment),tag(a.status==="open"?"Ожидает проверки":valueLabel(a.original)+" → "+valueLabel(a.decision),a.status==="open"?"amber":"green"),a.reason&&h("p",{},"Решение: "+a.reason)))));
 }
 }else evaluation.append(h("div",{class:"empty-state pending-state"},h("div",{class:"empty-icon"},icon("spark",28)),h("h3",{},"Диалог готов к оценке"),h("p",{},"Транскрипт сохранён. Автоматическая оценка станет доступна после подключения модели."),tag("Ожидает анализа")));
 return h("div",{},meta,h("div",{class:"detail-grid"},transcript,evaluation));
}
function checklists(){
 return h("div",{},h("div",{class:"checklist-banner"},h("div",{class:"checklist-banner-icon"},icon("list",27)),h("div",{},h("h2",{},"Стандарт качества Freedom"),h("p",{},"Русский, казахский и английский · Чаты и транскрипты звонков")),h("div",{class:"banner-tags"},tag("Активный","green"),tag("Версия "+data.version))),
 h("div",{class:"checklist-toolbar"},h("span",{},data.criteria.length+" критериев",h("span",{class:"separator"},"/"),"Сумма весов: ",h("strong",{},data.criteria.reduce((s,c)=>s+c.weight,0))),h("span",{},icon("shield",15),"Изменения сохраняются новой версией")),
 h("section",{class:"card checklist-list"},data.criteria.map((c,i)=>{const edit=btn("","edit",()=>criterionModal(c),"icon-button");edit.setAttribute("aria-label","Редактировать "+c.title);return h("article",{class:"checklist-row"},h("span",{class:"criterion-index"},String(i+1).padStart(2,"0")),h("div",{class:"checklist-text"},h("h3",{},c.title),h("p",{},c.description),h("div",{class:"rule-tags"},tag(c.type==="scale"?"Шкала: "+c.scale.join(" / "):c.type==="flag"?"Флаг нарушения":"Да / Нет"),c.allowNA&&tag("N/A доступно")),c.allowNA&&h("p",{class:"na-rule"},"N/A: "+c.naRule)),h("div",{class:"weight"},h("strong",{},c.weight),h("span",{},c.type==="flag"?"без баллов":"вес")),edit);})),
 h("div",{class:"info-note"},icon("alert",17),h("span",{},"Ранее оценённые диалоги сохраняют свою версию чек-листа. Новые правила будут передаваться модели при запуске оценки.")));
}
function appealsPage(){
 const open=data.appeals.filter(a=>a.status==="open").length;
 return h("div",{},h("div",{class:"appeal-summary"},tag(open+" на рассмотрении","amber"),tag((data.appeals.length-open)+" рассмотрено","green")),
 !data.appeals.length?h("section",{class:"card empty-state spacious"},h("div",{class:"empty-icon"},icon("scale",30)),h("h2",{},"Всё прозрачно. Споров пока нет."),h("p",{},"Откройте оценённый диалог и выберите «Оспорить»",h("br"),"у критерия, который требует пересмотра."),h("a",{class:"button",href:"#dialogs"},"Перейти к диалогам",icon("arrow",16))):
 h("div",{class:"appeal-list"},data.appeals.slice().reverse().map(a=>{const c=data.conversations.find(c=>c.id===a.conversationId), rule=c?.criteria.find(r=>r.id===a.criterionId);return h("article",{class:"card appeal-card"},h("div",{class:"appeal-top"},tag(a.status==="open"?"На рассмотрении":"Рассмотрено",a.status==="open"?"amber":"green"),h("span",{class:"subtle"},a.created)),h("h2",{},rule?.title),h("a",{href:"#dialog/"+encodeURIComponent(a.conversationId)},c?.title,icon("up",14)),h("blockquote",{},a.comment),
 h("div",{class:"appeal-bottom"},h("span",{},"Исходная оценка: ",h("strong",{},valueLabel(a.original)),a.status==="resolved"?" → "+valueLabel(a.decision):""),a.status==="open"&&btn("Рассмотреть","arrow",()=>reviewModal(a,c,rule),"button primary")),
 a.reason&&h("div",{class:"review-note"},h("strong",{},"Решение проверяющего"),h("p",{},a.reason)));})));
}
function modal(title,content){
 const opener=document.activeElement;
 const close=()=>{dialog.close();dialog.remove();opener?.focus();};
 const dialog=h("dialog",{class:"modal","aria-labelledby":"modal-title",onCancel:e=>{e.preventDefault();close();},onClick:e=>{if(e.target===dialog)close();}},
 h("div",{class:"modal-head"},h("h2",{id:"modal-title"},title),h("button",{class:"icon-button","aria-label":"Закрыть",onClick:close},icon("close",20))));
 const error=h("p",{class:"form-error",role:"alert",hidden:true});
 const showError=message=>{error.textContent=message;error.hidden=false;};
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
 data.criteria=existing?data.criteria.map(c=>c.id===existing.id?next:c):[...data.criteria,next];data.version++;save();close();render();notify("Версия "+data.version+" сохранена. Прежние оценки сохраняют свои правила.");
 }},field("Название","title",existing?.title||"","text",{required:true,maxlength:120}),field("Правило оценки","description",existing?.description||"","textarea",{required:true}),h("div",{class:"form-grid"},h("div",{},h("label",{class:"form-label",for:"field-type"},"Тип ответа"),type),weightField),scaleField,h("label",{class:"checkbox-label"},na,"Разрешить N/A"),naField,error,actions("Сохранить версию "+(data.version+1),"check"));
 });
}
function appealModal(c,rule){
 modal("Оспорить оценку",({close,error,showError,actions})=>h("form",{class:"modal-content",onSubmit:e=>{
 e.preventDefault();const comment=String(new FormData(e.currentTarget).get("comment")).trim();
 if(!comment)return showError("Добавьте причину апелляции.");
 if(data.appeals.some(a=>a.conversationId===c.id&&a.criterionId===rule.id&&a.status==="open"))return showError("По этому критерию уже есть открытая апелляция.");
 data.appeals.push({id:"appeal-"+Date.now(),conversationId:c.id,criterionId:rule.id,comment,original:finalAnswers(c)[rule.id].value,status:"open",created:new Date().toLocaleDateString("ru-RU")});save();close();render();notify("Апелляция сохранена и ожидает проверки.");
 }},h("div",{class:"appeal-context"},h("strong",{},rule.title),tag(valueLabel(finalAnswers(c)[rule.id].value))),h("p",{class:"modal-description"},c.answers[rule.id].reason),field("Почему оценку нужно пересмотреть?","comment","","textarea",{required:true,rows:5,placeholder:"Опишите, с чем вы не согласны, и укажите реплики…"}),error,actions("Подать апелляцию","scale")));
}
function reviewModal(a,c,rule){
 const options=[...(rule.type==="scale"?rule.scale.map(n=>[String(n),String(n)]):[["true","Да"],["false","Нет"]]),...(rule.allowNA?[["na","N/A"]]:[])];
 const decode=v=>v==="na"?null:v==="true"?true:v==="false"?false:Number(v);
 modal("Рассмотрение апелляции",({close,error,showError,actions})=>h("form",{class:"modal-content",onSubmit:e=>{
 e.preventDefault();const fd=new FormData(e.currentTarget), reason=String(fd.get("reason")).trim();if(!reason)return showError("Укажите основание решения.");
 a.status="resolved";a.decision=decode(fd.get("decision"));a.reason=reason;save();close();render();notify("Решение сохранено. Итоговая оценка пересчитана.");
 }},h("div",{class:"appeal-context"},h("strong",{},rule.title),tag("Было: "+valueLabel(a.original))),h("blockquote",{class:"review-quote"},a.comment),
 h("div",{class:"review-evidence"},c.messages.filter(m=>c.answers[rule.id].evidence.includes(m.id)).map(m=>h("p",{},h("strong",{},"#"+m.id+" · "+roleNames[m.role]+": "),m.text))),
 h("label",{class:"form-label",for:"field-decision"},"Финальная оценка"),h("select",{id:"field-decision",name:"decision"},options.map(([v,t])=>h("option",{value:v,selected:v===(a.original===null?"na":String(a.original))},t))),field("Основание решения","reason","","textarea",{required:true}),error,actions("Сохранить решение","checks")));
}
function importRecords(text){
 const parsed=JSON.parse(text), records=Array.isArray(parsed)?parsed:parsed.data?.records??parsed.records;
 if(!Array.isArray(records)||!records.length)throw Error("Ожидается массив records с диалогами.");
 if(records.length>500)throw Error("Загрузите не более 500 диалогов за раз.");
 const incoming=records.map((r,i)=>{
 if(!Array.isArray(r.transcript)||!r.transcript.length)throw Error("В диалоге "+(i+1)+" отсутствует transcript.");
 if(!["RU","KZ","EN"].includes(r.language))throw Error("Язык диалога должен быть RU, KZ или EN.");
 const messages=r.transcript.map((m,j)=>{if(!["client","operator","bot","system"].includes(m.speaker)||typeof m.text!=="string"||typeof m.timestamp!=="string")throw Error("Проверьте speaker, text и timestamp в диалоге "+(i+1)+".");return {id:j+1,role:m.speaker,text:m.text,time:m.timestamp};});
 return {id:String(r.conversation_id??"import-"+Date.now()+"-"+i),title:String(r.title??"Загруженный диалог "+(i+1)),operator:"Оператор",language:r.language,channel:r.channel==="voice call"?"voice call":"agent chat",date:new Date().toLocaleDateString("ru-RU"),messages,answers:null,criteria:structuredClone(data.criteria),version:data.version,demo:false,audioUrl:typeof r.audio_url==="string"&&/^https?:\/\//i.test(r.audio_url)?r.audio_url:undefined};
 });
 const ids=new Set(data.conversations.map(c=>c.id));const unique=incoming.filter(c=>{if(ids.has(c.id))return false;ids.add(c.id);return true;});
 if(!unique.length)throw Error("Эти диалоги уже загружены.");
 data.conversations.unshift(...unique);save();return unique.length;
}
function uploadModal(){
 modal("Добавить диалоги",({close,error,showError,actions})=>{
 const accept=text=>{try{const n=importRecords(text);close();status="pending";search="";language="ALL";go("dialogs");render();notify("Добавлено диалогов: "+n+". Они ожидают подключения анализа.");}catch(e){showError(e.message);}};
 return h("div",{class:"modal-content"},h("p",{class:"modal-description"},"Загрузите JSON с транскриптами в формате набора организаторов."),
 h("label",{class:"upload-drop"},h("div",{class:"empty-icon"},icon("upload",28)),h("strong",{},"Выберите JSON-файл"),h("span",{},"Массив records или ответ API · до 5 МБ"),h("input",{type:"file",accept:".json,application/json",onChange:async e=>{const f=e.target.files[0];if(!f)return;if(f.size>5*1024*1024)return showError("Файл должен быть меньше 5 МБ.");try{accept(await f.text());}catch{showError("Не удалось прочитать файл.");}}})),
 h("div",{class:"or-divider"},h("span",{},"или вставьте JSON")),
 h("form",{onSubmit:e=>{e.preventDefault();accept(String(new FormData(e.currentTarget).get("json")));}},field("Данные диалогов","json","","textarea",{required:true,rows:7,placeholder:'{"records": [{"conversation_id": "chat-001", "language": "RU", "transcript": [{"timestamp": "00:00", "speaker": "client", "text": "Здравствуйте!"}]}]}'}),h("div",{class:"info-note"},icon("alert",16),h("span",{},"Новые диалоги сохраняются без оценки. Подключение AI-анализа — следующий этап.")),error,actions("Добавить","plus")));
 });
}
render();

matchMedia("(max-width:1000px)").addEventListener("change",()=>render());
