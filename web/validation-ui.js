import {valueLabel,formatScore} from './domain.js';
import {createReference,importReferenceBundle,exportReferenceBundle,createReferenceTemplate,compareReferences} from './benchmark.js';
import {createTestConversation,createTestValues,TEST_SCENARIOS,isTestConversation} from './offline-assessment.js';

const UNSET='__UNLABELED__';
const reasonLabels={
 excluded_scope:'Другой контур данных',missing_reference:'Нет эталона',no_assessment:'Нет оценки',
 unsupported_provenance:'Нет подтверждённой оценки GPT',stale_reference:'Эталон относится к прежнему транскрипту',
 stale_assessment:'Оценка относится к прежнему транскрипту',checklist_mismatch:'Версии чек-листа не совпадают',
 invalid_reference:'Некорректный эталон',invalid_assessment:'Неполная или некорректная оценка',
 duplicate_reference:'Несколько эталонов для одного диалога',missing_conversation:'Диалог не найден'
};
const percent=value=>value===null||value===undefined?'—':(value*100).toLocaleString('ru-RU',{maximumFractionDigits:1})+'%';
const synthetic=c=>isTestConversation(c)||c?.demo===true||c?.source==='DEMO';
const referenceKey=r=>JSON.stringify([r.source,r.conversationId]);

/** Rendering only: all comparisons and synthetic assessments live in their pure modules. */
export function createValidationUI({h,icon,btn,tag,modal,notify,getData,save,render,openDialog,downloadJSON,runTestAssessment}){
 let scope='production',mode='original',reportRequest=0,storageWarning='';
 const references=()=>getData().references||[];
 const realConversations=()=>getData().conversations.filter(c=>!synthetic(c));
 const testConversations=()=>getData().conversations.filter(isTestConversation);
 const candidates=()=>scope==='test'?testConversations():realConversations();
 const scopedReferences=()=>references().filter(r=>scope==='test'?r.kind==='test':r.kind!=='test');
 const describe=c=>`${c.title||c.id} · ${c.language||'—'} · ${c.id}`;
 const sourceName=c=>isTestConversation(c)?'TEST':c.source||'—';
 const saveChanges=()=>{
  const saved=save();
  storageWarning=saved===false?'Изменения доступны в этой вкладке, но браузер не смог их сохранить. Экспортируйте данные до закрытия страницы.':'';
  return saved!==false;
 };
 const commitReferences=records=>{
  const keys=new Set(records.map(referenceKey));
  getData().references=[...references().filter(r=>!keys.has(referenceKey(r))),...records];
  return saveChanges();
 };
 const warning=()=>storageWarning?h('p',{class:'validation-storage-warning',role:'alert'},icon('alert'),storageWarning):null;
 const field=(label,id,node,help)=>h('div',{class:'validation-field'},h('label',{class:'form-label',for:id},label),node,help&&h('p',{class:'validation-help',id:id+'-help'},help));
 const plainLabel=value=>value===undefined?'Нет значения':valueLabel(value);
 const reasonLabel=reason=>reason==='unsupported_provenance'&&scope==='test'?'Нет учебной оценки без GPT':reasonLabels[reason]||reason;
 const download=(value,name)=>{
  if(typeof downloadJSON==='function')return downloadJSON(value,name);
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const link=h('a',{href:url,download:name});link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 function setScope(next){scope=next;}

 function valueFields(criteria,values={},prefix='reference'){
  const selects=new Map();
  const node=h('div',{class:'validation-value-fields'},criteria.map((criterion,index)=>{
   const id=`${prefix}-value-${index}`;
   const options=[h('option',{value:UNSET},'Не размечено — выберите значение')];
   if(criterion.type==='scale')for(const step of criterion.scale)options.push(h('option',{value:JSON.stringify(step)},String(step)));
   else options.push(h('option',{value:'true'},'Да'),h('option',{value:'false'},'Нет'));
   if(criterion.allowNA)options.push(h('option',{value:'null'},'N/A — неприменимо'));
   const select=h('select',{id,name:criterion.id,'aria-describedby':id+'-help'},options);
   select.value=Object.hasOwn(values,criterion.id)?JSON.stringify(values[criterion.id]):UNSET;
   if(select.selectedIndex<0)select.value=UNSET;
   selects.set(criterion.id,select);
   return h('div',{class:'validation-value-row'},h('div',{},h('label',{for:id},h('span',{class:'validation-criterion-number'},String(index+1).padStart(2,'0')),criterion.title),
    h('p',{class:'validation-help',id:id+'-help'},criterion.type==='flag'?'Отдельный критический флаг, без баллов.':`Вес: ${criterion.weight}. `,criterion.allowNA?`N/A: ${criterion.naRule}`:'N/A не разрешено.'),
    h('details',{class:'validation-rule'},h('summary',{},'Правило оценки'),h('p',{},criterion.description))),select);
  }));
  return {node,read(){const values={};for(const criterion of criteria){const select=selects.get(criterion.id);if(select.value===UNSET){select.setAttribute('aria-invalid','true');throw new Error(`Укажите значение критерия «${criterion.title}». «Не размечено» не равно N/A.`);}select.removeAttribute('aria-invalid');values[criterion.id]=JSON.parse(select.value);}return values;},set(values){for(const[id,select]of selects){select.value=Object.hasOwn(values,id)?JSON.stringify(values[id]):UNSET;select.removeAttribute('aria-invalid');}},disable(disabled){for(const select of selects.values())select.disabled=disabled;}};
 }

 function referenceModal(conversation){
  const choices=conversation?[conversation]:candidates();
  modal(conversation?'Эталонная разметка':'Добавить эталон',({close,error,showError})=>{
   if(!choices.length)return h('div',{class:'modal-content validation-modal'},h('p',{class:'modal-description'},scope==='test'?'Сначала создайте учебную копию диалога.':'Сначала загрузите реальные диалоги из API или JSON. Демопримеры не входят в проверку качества GPT.'),h('div',{class:'modal-actions'},btn('Закрыть',null,close)));
   let current=choices[0],criteria=[],version,values,busy=false;
   const select=h('select',{id:'reference-conversation'},choices.map((c,index)=>h('option',{value:index},`${sourceName(c)} · ${describe(c)}`)));
   const label=h('input',{id:'reference-label',type:'text',maxlength:160,value:'',placeholder:'Например: разметка проверяющего'});
   const fieldContainer=h('div',{}),context=h('p',{class:'validation-context'});
   const submit=h('button',{class:'button primary',type:'submit'},icon('check'),'Сохранить эталон');
   const updateFields=()=>{
    current=choices[Number(select.value)]||choices[0];
    const assessed=!!current.answers&&Array.isArray(current.criteria)&&current.criteria.length;
    criteria=assessed?current.criteria:getData().criteria;version=assessed?current.version:getData().version;
    const existing=references().find(r=>r.conversationId===current.id&&r.source===current.source);
    label.value=existing?.label||'';
    values=valueFields(criteria,existing?.answers||{},'reference');fieldContainer.replaceChildren(values.node);
    context.textContent=`${synthetic(current)?'Учебный эталон · не проверка качества GPT':'Ручной эталон для реального диалога'} · чек-лист v${version}.`;
   };
   select.addEventListener('change',updateFields);updateFields();
   return h('form',{class:'modal-content validation-modal',onSubmit:async event=>{
    event.preventDefault();if(busy)return;
    let answers;try{answers=values.read();}catch(failure){return showError(failure.message);}
    busy=true;submit.disabled=true;select.disabled=true;label.disabled=true;values.disable(true);submit.textContent='Сохранение…';
    try{
     const record=await createReference(current,criteria,version,answers,{label:label.value.trim(),kind:synthetic(current)?'test':'manual'});
     const saved=commitReferences([record]);render();if(!saved){showError(storageWarning);return;}close();notify('Эталон сохранён. Исходная оценка диалога не изменена.');
    }catch(failure){showError(failure.message||'Не удалось сохранить эталон.');}
    finally{busy=false;submit.disabled=false;select.disabled=false;label.disabled=false;values.disable(false);submit.replaceChildren(icon('check'),'Сохранить эталон');}
   }},h('p',{class:'modal-description'},'Разметьте каждый критерий независимо от оценки. N/A означает явное решение о неприменимости; пустые значения сохранять нельзя.'),
    field('Диалог','reference-conversation',select),context,field('Название разметки (необязательно)','reference-label',label),fieldContainer,error,
    h('div',{class:'modal-actions'},btn('Отмена',null,close),submit));
  });
 }

 function importModal(){
  modal('Импорт эталонов JSON',({close,error,showError})=>{
   let busy=false;
   const text=h('textarea',{id:'reference-json',name:'reference-json',rows:9,spellcheck:'false','aria-describedby':'reference-json-help'});
   const submit=h('button',{class:'button primary',type:'submit'},icon('upload'),'Импортировать JSON');
   const file=h('input',{id:'reference-file',type:'file',accept:'.json,application/json'});
   const status=h('p',{class:'validation-help',role:'status','aria-live':'polite'});
   async function accept(raw){
    if(busy)return;if(!raw.trim())return showError('Вставьте JSON с эталонной разметкой или выберите файл.');
    busy=true;submit.disabled=true;file.disabled=true;text.disabled=true;status.textContent='Проверяем все записи…';
    try{
     const records=await importReferenceBundle(raw,getData().conversations);
     const saved=commitReferences(records);render();if(!saved){status.textContent='Эталоны добавлены в текущую вкладку.';showError(storageWarning);return;}close();notify(`Импортировано эталонов: ${records.length}.`);
    }catch(failure){status.textContent='Импорт не выполнен. Данные не изменены.';showError(failure.message||'Не удалось прочитать эталоны.');}
    finally{busy=false;submit.disabled=false;file.disabled=false;text.disabled=false;}
   }
   file.addEventListener('change',async()=>{const selected=file.files[0];if(!selected)return;if(selected.size>5*1024*1024)return showError('Файл должен быть не больше 5 МБ.');try{await accept(await selected.text());}catch{showError('Не удалось прочитать файл.');}finally{file.value='';}});
   return h('form',{class:'modal-content validation-modal',onSubmit:event=>{event.preventDefault();accept(text.value);}},
    h('p',{class:'modal-description'},'Сначала скачайте шаблон, заполните все значения и загрузите его сюда. Для совпадающих диалогов эталоны будут заменены. Весь файл проверяется до изменения данных.'),
    field('Загрузить JSON-файл','reference-file',file,'До 5 МБ. Формат: freedom-cqa-reference-v1.'),
    h('div',{class:'or-divider'},h('span',{},'или вставьте содержимое')),
    field('JSON с эталонной разметкой','reference-json',text,'Значение null — N/A. Метка __UNLABELED__ означает незавершённую разметку и не импортируется.'),status,error,
    h('div',{class:'modal-actions'},btn('Отмена',null,close),submit));
  });
 }

 function copyModal(){
  const choices=getData().conversations.filter(c=>!isTestConversation(c));
  modal('Создать учебную копию',({close,error,showError})=>{
   if(!choices.length)return h('div',{class:'modal-content validation-modal'},h('p',{class:'modal-description'},'Сначала добавьте хотя бы один диалог.'),h('div',{class:'modal-actions'},btn('Закрыть',null,close)));
   const select=h('select',{id:'test-source-conversation'},choices.map((c,index)=>h('option',{value:index},`${sourceName(c)} · ${describe(c)}`)));
   return h('form',{class:'modal-content validation-modal',onSubmit:event=>{
    event.preventDefault();try{
     const original=choices[Number(select.value)];if(!original)throw new Error('Выберите исходный диалог.');
     const copy=createTestConversation(original);getData().conversations.push(copy);getData().activeDataset='TEST';
     const saved=saveChanges();close();openDialog(copy);render();if(saved)notify('Учебная копия создана в TEST. Задайте значения критериев.');
    }catch(failure){showError(failure.message||'Не удалось создать копию.');}
   }},testBanner(),h('p',{class:'modal-description'},'Копия получит отдельный ID и источник TEST. Оценка, доказательства и апелляции доступны в копии. Исходный диалог не изменяется.'),field('Исходный диалог','test-source-conversation',select),error,h('div',{class:'modal-actions'},btn('Отмена',null,close),h('button',{class:'button primary',type:'submit'},icon('plus'),'Создать копию')));
  });
 }

 function testBanner(){return h('div',{class:'validation-test-banner'},icon('shield',20),h('div',{},h('strong',{},'Учебный режим · без GPT · не оценка модели'),h('p',{},'Заданные вами значения проверяют работу интерфейса. Они не включаются в производственные метрики.')));}

 function testModal(conversation){
  if(!conversation)return copyModal();
  modal(isTestConversation(conversation)?'Учебная оценка без GPT':'Учебная копия и оценка',({close,error,showError})=>{
   const criteria=structuredClone(getData().criteria),version=getData().version;
   let current=isTestConversation(conversation)?conversation:null,busy=false;
   const scenario=h('select',{id:'test-scenario'},TEST_SCENARIOS.map(s=>h('option',{value:s.id},s.label)));
   const values=valueFields(criteria,createTestValues(criteria,scenario.value),'test');
   scenario.addEventListener('change',()=>values.set(createTestValues(criteria,scenario.value)));
   const submit=h('button',{class:'button primary',type:'submit'},icon('check'),'Применить учебную оценку');
   const status=h('p',{class:'validation-help',role:'status','aria-live':'polite'});
   return h('form',{class:'modal-content validation-modal',onSubmit:async event=>{
    event.preventDefault();if(busy)return;
    let answers;try{answers=values.read();}catch(failure){return showError(failure.message);}
    if(getData().version!==version||JSON.stringify(getData().criteria)!==JSON.stringify(criteria))return showError('Чек-лист изменился. Закройте окно и заново откройте учебную оценку.');
    busy=true;submit.disabled=true;scenario.disabled=true;values.disable(true);submit.textContent='Применяем значения…';status.textContent='Выполняется локально, без запроса к GPT.';
    try{
     if(!current){current=createTestConversation(conversation);getData().conversations.push(current);getData().activeDataset='TEST';saveChanges();}
     const result=await runTestAssessment(current,{scenario:scenario.value,values:answers});
     storageWarning=result===false||result?.saved===false?'Учебный результат доступен в этой вкладке, но не сохранён в браузере. Экспортируйте данные до закрытия страницы.':'';
     close();openDialog(current);render();
    }catch(failure){status.textContent=current?'Учебная копия доступна в TEST; можно повторить попытку.':'';showError(failure.message||'Не удалось применить учебную оценку.');}
    finally{busy=false;submit.disabled=false;scenario.disabled=false;values.disable(false);submit.replaceChildren(icon('check'),'Применить учебную оценку');}
   }},testBanner(),h('p',{class:'modal-description'},isTestConversation(conversation)?'Измените значения для проверки нужного сценария. Повторный запуск сохранит прежний результат в истории.':'Будет создана отдельная копия диалога с источником TEST. Исходный диалог сохраняется без изменений.'),
    h('p',{class:'validation-context'},`${conversation.title||conversation.id} · активный чек-лист v${version}`),
    field('Начальный сценарий','test-scenario',scenario,'Выбор сценария заполнит поля ниже; каждое значение можно изменить.'),values.node,status,error,
    h('div',{class:'modal-actions'},btn('Отмена',null,close),submit));
  });
 }

 function testPanel(conversation){
  if(!isTestConversation(conversation))return null;
  return h('section',{class:'card validation-test-panel'},testBanner(),warning(),h('div',{class:'validation-test-actions'},
   btn(conversation.answers?'Изменить учебные значения':'Задать учебную оценку','sliders',()=>testModal(conversation),'button primary'),
   btn('Эталон для учебной копии','edit',()=>referenceModal(conversation)),
   h('a',{class:'text-button',href:'#validation',onClick:()=>setScope('test')},'Сравнить учебные результаты',icon('arrow',16))));
 }

 function metric(title,value,caption,ico){return h('article',{class:'stat-card validation-metric'},h('div',{class:'stat-top'},h('span',{},title),icon(ico,18)),h('div',{class:'stat-value'},value),h('p',{class:'stat-bottom'},caption));}
 function criterionTable(rows){
  return h('div',{class:'validation-table-wrap'},h('table',{class:'validation-table'},h('caption',{class:'sr-only'},'Точные совпадения и применимость по критериям'),
   h('thead',{},h('tr',{},h('th',{scope:'col'},'Критерий'),h('th',{scope:'col'},'Точное совпадение'),h('th',{scope:'col'},'Применимость N/A'))),
   h('tbody',{},rows.map(row=>h('tr',{},h('th',{scope:'row'},row.title,h('span',{class:'validation-table-note'},`Чек-лист v${row.version}${row.type==='flag'?' · критический флаг без баллов':''}`)),
    h('td',{},h('strong',{},percent(row.accuracy)),h('span',{class:'validation-table-note'},`${row.matches} / ${row.compared}`)),
    h('td',{},h('strong',{},percent(row.applicabilityAccuracy)),h('span',{class:'validation-table-note'},`${row.applicabilityMatches} / ${row.applicabilityCompared}`)))))));
 }
 function comparisonRow(row){
  const conversation=getData().conversations.find(c=>c.id===row.conversationId&&c.source===row.source);
  const compared=row.status==='compared',mismatches=(row.criteria||[]).filter(item=>!item.match).length;
  const label=compared?(mismatches?`Расхождений: ${mismatches}`:'Все критерии совпали'):(reasonLabel(row.reason)||'Не сравнивается');
  return h('details',{class:'validation-record'},h('summary',{},h('span',{class:'validation-record-title'},h('strong',{},conversation?.title||row.conversationId),h('small',{},`${row.source||'—'} · ${row.conversationId}`)),tag(label,compared?(mismatches?'amber':'green'):'neutral'),icon('down',16)),
   h('div',{class:'validation-record-body'},
    compared?h('div',{class:'validation-score-pair'},h('span',{},'Эталон: ',h('strong',{},formatScore(row.referenceScore))),h('span',{},mode==='original'?'Исходная оценка: ':'Итоговая оценка: ',h('strong',{},formatScore(row.candidateScore))),h('span',{},'Абсолютная ошибка: ',h('strong',{},formatScore(row.absoluteError)))):h('p',{class:'validation-help'},reasonLabel(row.reason)||'Для этого диалога нет сопоставимых данных.'),
    compared&&h('div',{class:'validation-table-wrap'},h('table',{class:'validation-table validation-diff-table'},h('caption',{class:'sr-only'},'Значения эталона и выбранной оценки'),h('thead',{},h('tr',{},h('th',{scope:'col'},'Критерий'),h('th',{scope:'col'},'Эталон'),h('th',{scope:'col'},'Оценка'),h('th',{scope:'col'},'Результат'))),h('tbody',{},row.criteria.map(item=>h('tr',{class:item.match?'':'validation-mismatch'},h('th',{scope:'row'},item.title),h('td',{},plainLabel(item.reference)),h('td',{},plainLabel(item.candidate)),h('td',{},item.match?'Совпало':'Расхождение',item.applicabilityMatch===false&&h('span',{class:'validation-table-note'},'Различается N/A'))))))),
    h('div',{class:'validation-record-actions'},conversation&&btn('Открыть диалог','arrow',()=>openDialog(conversation),'text-button'),conversation&&btn('Изменить эталон','edit',()=>referenceModal(conversation),'text-button'))));
 }

 function renderReport(report){
  const {metrics,coverage}=report,criteria=metrics.criteria;
  const denominator=coverage.eligible||0,coverageRate=denominator?coverage.compared/denominator:null;
  const flags=metrics.critical;
  const rows=report.rows.filter(row=>row.reason!=='excluded_scope');
  const reasons=Object.entries(coverage.reasons||{}).filter(([reason,count])=>reason!=='excluded_scope'&&count>0);
  let rowPage=0;
  const pageSize=10,records=h('div',{class:'validation-records'}),range=h('span',{class:'validation-page-range','aria-live':'polite'});
  const previous=btn('Назад','back',()=>{rowPage--;updateRows();},'text-button');
  const next=btn('Далее','arrow',()=>{rowPage++;updateRows();},'text-button');
  function updateRows(){
   const start=rowPage*pageSize;
   records.replaceChildren(...(rows.length?rows.slice(start,start+pageSize).map(comparisonRow):[h('div',{class:'validation-empty'},h('p',{},'В выбранном контуре пока нет диалогов.'))]));
   range.textContent=rows.length?`${start+1}–${Math.min(start+pageSize,rows.length)} из ${rows.length}`:'Нет диалогов';
   previous.disabled=rowPage===0;next.disabled=start+pageSize>=rows.length;
  }
  updateRows();
  const display=h('div',{class:'validation-report-content'},
   h('div',{class:'stat-grid validation-stats'},
    metric('Точность по критериям',percent(criteria.accuracy),`${criteria.matches} / ${criteria.compared} точных совпадений`,'checks'),
    metric('Совпадение применимости N/A',percent(criteria.applicabilityAccuracy),`${criteria.applicabilityMatches} / ${criteria.applicabilityCompared} решений о применимости`,'shield'),
    metric('Ошибка балла · MAE',formatScore(metrics.totals.mae),`По ${metrics.totals.compared} итоговым баллам · шкала 0–100`,'scale'),
    metric('Покрытие сравнения',percent(coverageRate),`${coverage.compared} / ${denominator} диалогов выбранного контура`,'chats')),
   h('section',{class:'card validation-report-card'},h('div',{class:'validation-section-heading'},h('div',{},h('h2',{},'Совпадения по критериям'),h('p',{},'Точное значение и применимость считаются отдельно. N/A совпадает только с явным N/A.')),
    tag(scope==='test'?'Учебные результаты':'Реальные оценки GPT',scope==='test'?'amber':'green')),
    report.criteria.length||report.flags.length?criterionTable([...report.criteria,...report.flags]):h('div',{class:'validation-empty'},icon('scale',30),h('h3',{},'Пока нет сопоставимых оценок'),h('p',{},scope==='test'?'Создайте учебную копию, задайте оценку и добавьте её эталон.':'Добавьте эталон для реального диалога с сохранённой оценкой GPT.')),
    h('div',{class:'validation-critical-summary'},h('strong',{},'Явные значения N/A'),h('span',{},`В эталоне: ${criteria.expectedNA} · в оценке: ${criteria.candidateNA} · совпало: ${criteria.naMatches}`)),
    h('div',{class:'validation-critical-summary'},h('strong',{},'Критический флаг'),h('span',{},`${flags.matches} / ${flags.compared} совпадений · ${percent(flags.accuracy)}`),h('span',{},`Ложных срабатываний: ${flags.falsePositive} · пропусков: ${flags.falseNegative}`)),
    h('p',{class:'validation-method'},'Точность критериев не включает критические флаги — они показаны отдельно. MAE — средняя абсолютная разница итоговых баллов. ',metrics.totals.excludedAllNA?`Диалогов без применимых баллов: ${metrics.totals.excludedAllNA}; они не входят в MAE.`:'При отсутствии применимых баллов ошибка не вычисляется.')),
   h('section',{class:'card validation-report-card'},h('div',{class:'validation-section-heading'},h('div',{},h('h2',{},'Диалоги и расхождения'),h('p',{},'Раскройте строку, чтобы увидеть значения и причину исключения.')),h('span',{class:'count'},rows.length)),
    reasons.length>0&&h('div',{class:'validation-reason-list'},reasons.map(([reason,count])=>h('span',{},`${reasonLabel(reason)}: ${count}`))),
    records,rows.length>pageSize&&h('div',{class:'validation-pagination'},range,h('div',{},previous,next)),
    h('div',{class:'validation-report-footer'},h('p',{},`Сравнено: ${coverage.compared} · без эталона: ${coverage.missingReference} · без оценки: ${coverage.withoutAssessment}.`),
     btn('Скачать отчёт','download',()=>download(report,`freedom-cqa-comparison-${report.scope}-${report.mode}.json`),'text-button'))));
  return display;
 }

 function offlineSection(){
  const copies=testConversations();
  return h('section',{class:'card validation-offline'},h('div',{class:'validation-section-heading'},h('div',{},h('div',{class:'eyebrow'},'ПРОВЕРКА ПРОЦЕССА'),h('h2',{},'Учебный стенд без GPT'),h('p',{},'Проверка оценки, доказательств, истории и апелляции на отдельной копии TEST.')),btn('Создать учебную копию','plus',copyModal)),
   testBanner(),h('ol',{class:'validation-steps'},h('li',{},h('strong',{},'Создайте копию'),h('span',{},'Отдельный диалог с источником TEST.')),h('li',{},h('strong',{},'Задайте значения'),h('span',{},'Выберите сценарий и значения критериев.')),h('li',{},h('strong',{},'Проверьте результат'),h('span',{},'Откройте доказательства и подайте апелляцию.'))),
   copies.length?h('div',{class:'validation-test-list'},copies.slice(-6).reverse().map(c=>h('div',{class:'validation-test-item'},h('div',{},h('strong',{},c.title||c.id),h('small',{},`${c.answers?'Учебная оценка готова':'Ожидает учебной оценки'} · ${c.id}`)),btn('Открыть','arrow',()=>openDialog(c),'text-button'))),copies.length>6&&h('p',{class:'validation-help'},`Показаны последние 6 из ${copies.length} копий. Все копии доступны в источнике TEST.`)):h('p',{class:'validation-offline-empty'},'Учебных копий пока нет. Для создания можно использовать любой загруженный диалог.'));
 }

 function page(){
  const report=h('div',{class:'validation-report','aria-busy':'true'}),reportStatus=h('p',{class:'validation-load-status',role:'status','aria-live':'polite'},'Сопоставляем эталоны и оценки…');
  const pageError=h('p',{class:'form-error',role:'alert',hidden:true,tabindex:-1});
  const scopeSelect=h('select',{id:'validation-scope'},h('option',{value:'production'},'Реальные оценки GPT'),h('option',{value:'test'},'Учебные копии TEST'));
  const modeSelect=h('select',{id:'validation-mode'},h('option',{value:'original'},'Исходная оценка'),h('option',{value:'final'},'Итоговая с решениями апелляций'));
  scopeSelect.value=scope;modeSelect.value=mode;
  const referenceCount=h('span',{class:'validation-reference-count'});
  const scopeHelp=h('p',{class:'validation-scope-note'}),manual=btn('Добавить эталон','plus',()=>referenceModal(),'button primary');
  const showPageError=message=>{pageError.textContent=message;pageError.hidden=false;pageError.focus();};
  async function refresh(){
   const request=++reportRequest;
   report.setAttribute('aria-busy','true');reportStatus.textContent='Сопоставляем эталоны и оценки…';
   referenceCount.textContent=`Эталонов в контуре: ${scopedReferences().length}`;exportButton.disabled=!scopedReferences().length;
   scopeHelp.textContent=scope==='test'?'Учебный отчёт: только копии TEST. Заданные значения не измеряют качество GPT и не входят в производственные метрики.':'Производственный отчёт: реальные диалоги с оценкой GPT. TEST, DEMO и другие неподтверждённые оценки исключаются.';
   try{
    const data=getData(),list=scope==='test'?testConversations():data.conversations,result=await compareReferences(list,scopedReferences(),data.appeals||[],{mode,scope});
    if(request!==reportRequest||!report.isConnected)return;
    report.replaceChildren(renderReport(result));reportStatus.textContent=`Сравнение готово. Сопоставлено диалогов: ${result.coverage.compared}.`;
   }catch(failure){if(request!==reportRequest||!report.isConnected)return;report.replaceChildren(h('p',{class:'form-error',role:'alert'},failure.message||'Не удалось построить сравнение.'));reportStatus.textContent='Сравнение не выполнено.';}
   finally{if(request===reportRequest)report.setAttribute('aria-busy','false');}
  }
  scopeSelect.addEventListener('change',()=>{scope=scopeSelect.value;refresh();});modeSelect.addEventListener('change',()=>{mode=modeSelect.value;refresh();});
  let templateBusy=false;
  const templateButton=btn('Скачать шаблон','download',async()=>{
   if(templateBusy)return;const list=candidates();if(!list.length)return showPageError(scope==='test'?'Сначала создайте учебную копию.':'Нет реальных диалогов для шаблона. Загрузите набор из API или JSON.');
   templateBusy=true;templateButton.disabled=true;pageError.hidden=true;
   try{const data=getData();const bundles=await Promise.all(list.map(c=>createReferenceTemplate([c],c.answers?c.criteria:data.criteria,c.answers?c.version:data.version)));download({schema:'freedom-cqa-reference-v1',records:bundles.flatMap(bundle=>bundle.records)},`freedom-cqa-reference-template-${scope}.json`);notify('Шаблон скачан. Замените все __UNLABELED__ на размеченные значения.');}
   catch(failure){showPageError(failure.message||'Не удалось создать шаблон.');}finally{templateBusy=false;templateButton.disabled=false;}
  });
  const exportButton=btn('Экспорт эталонов','download',()=>{try{download(exportReferenceBundle(scopedReferences()),`freedom-cqa-references-${scope}.json`);}catch(failure){showPageError(failure.message||'Не удалось экспортировать эталоны.');}});
  exportButton.disabled=!scopedReferences().length;
  const pageNode=h('section',{class:'validation-page'},
   h('div',{class:'validation-page-heading'},h('div',{},h('h2',{},'Сравнение с эталоном'),h('p',{},'Независимая ручная разметка для проверки сохранённых оценок.')),manual),warning(),
   h('section',{class:'card validation-controls'},h('div',{class:'validation-control-row'},field('Контур сравнения','validation-scope',scopeSelect),field('Версия оценки','validation-mode',modeSelect)),scopeHelp,
    h('div',{class:'validation-tools'},btn('Импорт эталонов','upload',importModal),templateButton,exportButton,referenceCount),
    h('p',{class:'validation-help'},'Эталон — независимая ручная разметка. Шаблон содержит незаполненные значения; оценки GPT в него не копируются.'),pageError),
   h('div',{class:'validation-offline-entry'},h('div',{},h('strong',{},'Учебный стенд · без GPT'),h('p',{},'Проверка оценки и апелляции на копии TEST.')),btn('Создать учебную копию','plus',copyModal)),
   reportStatus,report,offlineSection());
  queueMicrotask(refresh);return pageNode;
 }
 return {page,referenceModal,testModal,testPanel,importModal,setScope};
}
