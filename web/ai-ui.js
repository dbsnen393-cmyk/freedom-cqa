/** AI connection controls. Secrets stay in the password field until submitted to this server. */
export function createAIControls({h,icon,btn,tag,modal,notify,onConfigChange}){
 let state={loaded:false,configured:false,provider:'gemini',model:'gemini-3.5-flash-lite',localConfiguration:false,csrfToken:null,verified:false,verifiedAt:null,error:null};
 let pendingLoad=null,settingsPanel=null;
 const panels=new Set();
 const providerLabel=()=>({openai:'OpenAI',gemini:'Gemini',groq:'Groq'}[state.provider]||'ИИ');
 const safeMessage=(value,fallback)=>{
  const candidate=typeof value==='string'?value:typeof value?.message==='string'?value.message:fallback;
  return String(candidate||fallback).replace(/sk-(?:proj-)?[A-Za-z0-9_-]{12,}/g,'[ключ скрыт]').slice(0,500);
 };
 const changed=()=>{
  for(const entry of panels){
   if(!entry.node.isConnected){panels.delete(entry);continue;}
   const next=renderActionPanel(entry.conversation,entry.options);
   const active=document.activeElement;
   const focusedAction=entry.node.contains(active)?active.classList.contains('ai-assess-button')?'.ai-assess-button':active.classList.contains('text-button')?'.text-button':null:null;
   entry.node.replaceChildren(...next.childNodes);
   entry.node.setAttribute('aria-busy',next.getAttribute('aria-busy'));
   if(focusedAction)entry.node.querySelector(focusedAction)?.focus();
  }
  if(typeof onConfigChange==='function')onConfigChange({...state});
 };
 function applyConfig(payload){
  const value=payload?.config&&typeof payload.config==='object'?payload.config:payload;
  if(!value||typeof value!=='object'||typeof value.configured!=='boolean')throw new Error('Сервер не вернул состояние подключения.');
  state={...state,loaded:true,configured:value.configured,provider:['groq','gemini','openai'].includes(value.provider)?value.provider:state.provider,model:typeof value.model==='string'?value.model:state.model,localConfiguration:typeof value.localConfiguration==='boolean'?value.localConfiguration:state.localConfiguration,csrfToken:typeof value.csrfToken==='string'?value.csrfToken:state.csrfToken,verified:value.verified===true,verifiedAt:typeof value.verifiedAt==='string'?value.verifiedAt:null,error:null};
  if(!state.configured){state.verified=false;state.verifiedAt=null;}
 }
 async function request(path,{method='GET',body,timeout=30000}={}){
  const headers={Accept:'application/json'};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(method!=='GET'&&state.csrfToken)headers['X-CQA-Setup-Token']=state.csrfToken;
  let response;try{response=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(timeout)});}catch(error){throw new Error(error?.name==='TimeoutError'?'Сервер отвечает слишком долго. Повторите попытку.':'Не удалось связаться с сервером. Проверьте подключение.');}
  let result;try{result=await response.json();}catch{throw new Error('Сервер вернул ответ в неизвестном формате.');}
  if(!response.ok)throw new Error(safeMessage(result?.error,'Не удалось выполнить запрос.'));
  return result;
 }
 async function loadConfig(){
  if(pendingLoad)return pendingLoad;
  pendingLoad=(async()=>{try{applyConfig(await request('/api/ai/config'));}catch(error){state={...state,loaded:true,error:safeMessage(error,'Не удалось загрузить настройки ИИ.')};}finally{pendingLoad=null;changed();}return {...state};})();
  return pendingLoad;
 }
 const stateText=()=>!state.loaded?'Загрузка подключения':state.error?'Подключение не проверено':!state.configured?'Ключ не добавлен':state.verified?'Доступ проверен':'Ключ сохранён · доступ не проверен';
 function settings(){
  if(settingsPanel?.isConnected)return;
  modal('Подключение ИИ',controls=>{
   const panel=h('div',{class:'ai-settings-shell'},h('div',{class:'modal-content ai-settings'},h('p',{role:'status','aria-live':'polite'},'Загрузка настроек подключения…'),h('div',{class:'modal-actions'},btn('Отмена',null,controls.close))));
   settingsPanel=panel;
   loadConfig().then(()=>{
    // Closing the loading dialog must not reopen it after the response arrives.
    if(!panel.isConnected)return;
    const restoreFocus=panel.contains(document.activeElement);
    panel.replaceChildren(settingsContent(controls));
    if(restoreFocus)panel.querySelector('input:not(:disabled),button:not(:disabled)')?.focus();
   });
   return panel;
  });
 }
 function settingsContent({close,error,showError}){
   if(state.error)return h('div',{class:'modal-content ai-settings'},h('p',{class:'form-error',role:'alert'},state.error),h('div',{class:'modal-actions'},btn('Закрыть',null,close),btn('Повторить загрузку','sliders',()=>{close();settings();},'button primary')));
   const status=h('div',{class:'ai-settings-status','aria-live':'polite'},tag(stateText(),state.verified?'green':state.configured?'amber':'neutral','shield'));
   const resultNote=h('p',{class:'ai-connection-feedback',role:'status',hidden:true});
   const updateStatus=()=>status.replaceChildren(tag(stateText(),state.verified?'green':state.configured?'amber':'neutral','shield'));
   let saving=false,verifying=false;
   const verifyButton=btn('Проверить доступ','shield',verify,'button');
   verifyButton.removeAttribute('aria-label');
   const modelInput=state.localConfiguration?h('input',{id:'ai-model-input',name:'model',type:'text',value:state.model||'gemini-3.5-flash-lite',required:true,maxlength:100,autocomplete:'off',autocapitalize:'none',spellcheck:'false'}):null;
   const keyInput=state.localConfiguration?h('input',{id:'ai-api-key-input',name:'apiKey',type:'password',value:'',required:!state.configured,maxlength:512,autocomplete:'off',autocapitalize:'none',spellcheck:'false',placeholder:state.configured?'Оставьте пустым, чтобы сохранить текущий ключ':'Вставьте ключ '+providerLabel()+' API','aria-describedby':'ai-key-help'}):null;
   const saveButton=state.localConfiguration?h('button',{type:'submit',class:'button primary'},icon('check',17),'Сохранить подключение'):null;
   const disable=value=>{if(saveButton)saveButton.disabled=value;if(modelInput)modelInput.disabled=value;if(keyInput)keyInput.disabled=value;verifyButton.disabled=value||!state.configured;};
   const clearFeedback=()=>{error.hidden=true;error.textContent='';resultNote.hidden=true;resultNote.textContent='';};
   async function verify(){
    if(verifying||saving)return;
    clearFeedback();
    if(!state.configured)return showError('Сначала добавьте API-ключ.');
    if(keyInput?.value.trim()||(modelInput&&modelInput.value.trim()!==state.model))return showError('Сначала сохраните изменения, затем проверьте доступ.');
    verifying=true;disable(true);verifyButton.textContent='Проверка…';resultNote.textContent='Проверяем доступ к модели…';resultNote.hidden=false;
    try{
     const response=await request('/api/ai/verify',{method:'POST',body:{}});
     if(response?.config||typeof response?.configured==='boolean')applyConfig(response);
     else if(response?.verified===true||response?.success===true||response?.ok===true){state={...state,verified:true,verifiedAt:new Date().toISOString(),error:null};}
     else throw new Error('Сервер не подтвердил доступ к модели.');
     if(!state.verified)throw new Error('Ключ сохранён, но доступ к модели не подтверждён.');
     resultNote.textContent='Доступ к модели подтверждён. Разговоры при этой проверке не оценивались.';resultNote.hidden=false;changed();updateStatus();
    }catch(failure){resultNote.hidden=true;state={...state,verified:false,verifiedAt:null};showError(safeMessage(failure,'Не удалось проверить доступ.'));updateStatus();changed();}
    finally{verifying=false;disable(false);verifyButton.replaceChildren(icon('shield',17),'Проверить доступ');}
   }
   if(!state.localConfiguration){
    verifyButton.disabled=!state.configured;
    return h('div',{class:'modal-content ai-settings'},status,h('div',{class:'ai-hosted-setup'},h('strong',{},'Подключение настраивается на сервере'),h('p',{},'Эта веб-версия использует ключ из настроек хостинга. Добавление или замена ключа выполняются там.'),h('p',{},'Текущая модель: ',h('code',{},state.model||'не указана'))),h('p',{class:'ai-settings-help'},'Проверка доступа не отправляет диалоги на оценку.'),error,resultNote,h('div',{class:'modal-actions'},btn('Закрыть',null,close),verifyButton));
   }
   const form=h('form',{class:'modal-content ai-settings',onSubmit:async event=>{
    event.preventDefault();if(saving||verifying)return;
    clearFeedback();const apiKey=keyInput.value.trim(),model=modelInput.value.trim();
    if(!state.configured&&!apiKey)return showError('Добавьте API-ключ '+providerLabel()+'.');
    if(!(state.provider==='groq'?/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/:/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/).test(model))return showError('Укажите точное имя модели, доступной выбранному провайдеру.');
    if(!state.csrfToken)return showError('Сессия настройки устарела. Закройте окно и откройте его снова.');
    saving=true;disable(true);saveButton.textContent='Сохранение…';resultNote.textContent='Сохраняем подключение…';resultNote.hidden=false;
    try{
     const payload={model};if(apiKey)payload.apiKey=apiKey;
     const response=await request('/api/ai/config',{method:'POST',body:payload});
     keyInput.value='';state={...state,verified:false,verifiedAt:null};
     if(response?.config||typeof response?.configured==='boolean')applyConfig(response);else applyConfig(await request('/api/ai/config'));
     keyInput.required=!state.configured;keyInput.placeholder='Оставьте пустым, чтобы сохранить текущий ключ';modelInput.value=state.model;
     updateStatus();changed();resultNote.textContent='Подключение сохранено на сервере. Проверьте доступ к модели.';resultNote.hidden=false;
     if(typeof notify==='function')notify('Настройки ИИ сохранены. Ключ не хранится в браузере.');
    }catch(failure){resultNote.hidden=true;showError(safeMessage(failure,'Не удалось сохранить подключение.'));}
    finally{saving=false;disable(false);saveButton.replaceChildren(icon('check',17),'Сохранить подключение');}
   }},status,h('p',{class:'ai-settings-help'},'Ключ передаётся только серверу этого сервиса. Он не включается в экспорт и не сохраняется в браузере.'),
    h('label',{class:'form-label',for:'ai-api-key-input'},'Ключ '+providerLabel()+' API'),keyInput,h('p',{id:'ai-key-help',class:'ai-field-help'},state.configured?'Текущий ключ скрыт. Заполните поле, только если хотите заменить его.':'Создайте ключ в своём аккаунте '+providerLabel()+' и вставьте его сюда.'),
    h('label',{class:'form-label',for:'ai-model-input'},'Модель'),modelInput,h('p',{class:'ai-field-help'},'Укажите точное имя модели, доступной вашему API-ключу.'),
    error,resultNote,h('div',{class:'ai-settings-verify'},verifyButton,h('span',{},'Проверка доступа не оценивает разговоры.')),h('div',{class:'modal-actions'},btn('Закрыть',null,close),saveButton));
   disable(false);return form;
 }
 function statusButton(){
  const text=!state.loaded?'ИИ: подключение…':state.error?'ИИ: настройки':!state.configured?'Подключить ИИ':state.verified?'ИИ: доступ проверен':'ИИ: ключ сохранён';
  return btn(text,'spark',settings,'ai-status-button '+(state.verified?'is-verified':state.configured?'is-configured':''));
 }
 function renderActionPanel(c,{busy=false,error=null,onAssess}={}){
  const configured=state.loaded&&state.configured&&!state.error;
  const action=btn(busy?'ИИ оценивает диалог…':configured?(c.answers?'Оценить повторно':'Оценить через ИИ'):'Подключить ИИ','spark',()=>{if(busy)return;if(configured){if(typeof onAssess==='function')onAssess();}else settings();},'button primary ai-assess-button');
  action.disabled=busy||(configured&&typeof onAssess!=='function');
  const settingsButton=btn('Настройки','sliders',settings,'text-button');settingsButton.disabled=busy;
  return h('section',{class:'ai-action-panel','aria-label':'Оценка ИИ','aria-busy':String(busy)},h('div',{class:'ai-action-heading'},h('div',{class:'ai-action-icon'},icon('spark',22)),h('div',{},h('h3',{},'Оценка ИИ'),h('p',{},configured?state.model:'Подключите ваш аккаунт '+providerLabel()+' API')),settingsButton),
   h('div',{class:'ai-action-status'},tag(stateText(),state.verified?'green':state.configured?'amber':'neutral',state.verified?'check':'shield')),
   h('p',{class:'ai-action-description'},'Проверка подготовленного диалога по текущему чек-листу с обоснованиями и ссылками на реплики.'),
   error?h('p',{class:'ai-action-error',role:'alert'},safeMessage(error,'Не удалось получить оценку.')):null,
   busy?h('p',{class:'ai-action-progress',role:'status','aria-live':'polite'},h('span',{class:'ai-progress-dot','aria-hidden':'true'}),'Запрос отправлен. Проверяем ответ и рассчитываем итоговый балл.'):null,
   action,h('p',{class:'ai-action-note'},'Передаются текст после маскирования и критерии. Имена и нестандартные персональные данные могут остаться.'));
 }
 function actionPanel(c,options={}){
  const node=renderActionPanel(c,options);
  panels.add({node,conversation:c,options:{...options}});
  return node;
 }
 return {loadConfig,settings,actionPanel,statusButton,get config(){return {...state};}};
}
