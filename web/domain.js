                                            
                                                                                                                                                                                  
                                                                          
                                                                                                                 
                                                                                                                                                                                                                                                                   
                                                                                                                                                                                                    
export const initialCriteria = [
 {id:"contact",title:"Установление контакта",description:"Да — оператор поздоровался на языке клиента и представился в первом ответе.",weight:10,type:"boolean",scale:[],allowNA:false,naRule:""},
 {id:"need",title:"Выявление потребности",description:"Да — оператор учёл известные детали и уточнил недостающее до ответа.",weight:15,type:"boolean",scale:[],allowNA:true,naRule:"Данных для ответа хватало с самого начала."},
 {id:"identity",title:"Идентификация",description:"Да — проверка личности подтверждена до раскрытия данных или защищённого действия.",weight:20,type:"boolean",scale:[],allowNA:true,naRule:"Запрос не требовал идентификации."},
 {id:"solution",title:"Корректная и полная консультация",description:"20 — Все существенные вопросы закрыты или дан корректный следующий шаг. 15 — Основной вопрос решён, пропущена второстепенная деталь. 10 — Часть запроса закрыта, существенный вопрос остался открытым. 5 — Есть общая подсказка, но клиенту всё ещё непонятно, как действовать. 0 — Ответа по существу нет или ключевая рекомендация ошибочна.",weight:20,type:"scale",scale:[0,5,10,15,20],allowNA:true,naRule:"Чат закончился до того, как клиент сформулировал запрос."},
 {id:"empathy",title:"Эмпатия и клиентоориентированность",description:"Да — оператор вежлив и, если клиент выразил недовольство или описал неудобство, отреагировал на конкретную проблему.",weight:15,type:"boolean",scale:[],allowNA:false,naRule:""},
 {id:"management",title:"Управление диалогом, скорость и грамотность",description:"10 — Ответы ясные и связные. Если было явное ожидание, оператор предупредил. 7 — Один заметный сбой, но клиент может понять ответ и продолжить. 4 — Клиенту приходится переспрашивать из-за формулировок или порядка ответов. 0 — Из-за бессвязных или противоречивых реплик ход диалога непонятен.",weight:15,type:"scale",scale:[0,4,7,10],allowNA:false,naRule:""},
 {id:"closing",title:"Завершение",description:"Да — оператор подвёл итог или предложил дальнейшую помощь и попрощался.",weight:5,type:"boolean",scale:[],allowNA:true,naRule:"Чат оборвался до возможности его завершить."},
 {id:"critical",title:"Грубые ошибки",description:"Да — выявлено оскорбление клиента, предложение платной услуги в обход компании или раскрытие конфиденциальной информации. Нет — ни одно из трёх не выявлено.",weight:0,type:"flag",scale:[],allowNA:false,naRule:""}
];
export function criterionContribution(criterion,answer) {
 if (!answer || answer.value===null || criterion.type==='flag') return null;
 return criterion.weight*(criterion.type==='scale' ? Number(answer.value)/Math.max(...criterion.scale) : answer.value===true?1:0);
}
export function scoreBreakdown(criteria,answers) {
 let earned=0, applicable=0, excludedWeight=0;
 if (answers) for (const criterion of criteria) {
  const answer=answers[criterion.id], contribution=criterionContribution(criterion,answer);
  if (contribution===null) {
   if (answer?.value===null && criterion.type!=='flag') excludedWeight+=criterion.weight;
   continue;
  }
  applicable+=criterion.weight;
  earned+=contribution;
 }
 return {earned,applicable,excludedWeight,score:applicable?Math.round(earned/applicable*10000)/100:null};
}
export function calculate(criteria,answers) {
 return scoreBreakdown(criteria,answers).score;
}
export function valueLabel(value       ) { return value===null?"N/A":typeof value==="boolean"?(value?"Да":"Нет"):String(value); }
export function formatScore(value            ) { return value===null?"—":value.toLocaleString("ru-RU",{maximumFractionDigits:2}); }
const ru           =[
 {id:1,role:"client",time:"00:00",text:"Здравствуйте! Подскажите, где посмотреть статус заявки на вывод? И можно ли включить уведомления?"},
 {id:2,role:"operator",time:"00:12",text:"Здравствуйте! Меня зовут Алия. Помогу разобраться."},
 {id:3,role:"client",time:"00:25",text:"Переживаю, что заявка потерялась. Вчера её отправила."},
 {id:4,role:"operator",time:"00:41",text:"Понимаю ваше беспокойство из-за заявки. Откройте историю операций и выберите заявку на вывод — там можно посмотреть её текущий статус."},
 {id:5,role:"client",time:"01:06",text:"Нашла, спасибо!"},
 {id:6,role:"system",time:"01:12",text:"Оператор завершил диалог."}
];
const kz           =[
 {id:1,role:"client",time:"00:00",text:"Сәлеметсіз бе! Қолданбадағы тілді қалай өзгертуге болады?"},
 {id:2,role:"operator",time:"00:09",text:"Сәлеметсіз бе! Менің атым Данияр. Қай құрылғыны қолданасыз: iPhone әлде Android?"},
 {id:3,role:"client",time:"00:18",text:"iPhone қолданамын."},
 {id:4,role:"operator",time:"00:35",text:"Түсіндім. Қолданбадағы «Баптаулар» бөлімін ашып, «Тіл» тармағын таңдаңыз."},
 {id:5,role:"client",time:"00:55",text:"Рақмет, қазақ тілін таңдадым!"},
 {id:6,role:"operator",time:"01:04",text:"Көмектесе алғаныма қуаныштымын! Тағы сұрақтарыңыз болса, жазыңыз. Күніңіз жақсы өтсін!"}
];
const en           =[
 {id:1,role:"client",time:"00:00",text:"Hi! I cannot find my monthly statement. Can you help?"},
 {id:2,role:"operator",time:"00:08",text:"Hello! I'm Alex. Are you using the website or the mobile app?"},
 {id:3,role:"client",time:"00:21",text:"The website. This is getting frustrating."},
 {id:4,role:"operator",time:"00:46",text:"Go to your profile, open Documents, and select Statements."},
 {id:5,role:"client",time:"01:03",text:"Found it, thank you."},
 {id:6,role:"operator",time:"01:13",text:"Glad you found the statement. Let us know if you need anything else. Have a good day!"}
];
function answersFor(language       )                       {
 const isRU=language==="RU", isEN=language==="EN";
 return {
  contact:{value:true,reason:"В первой реплике оператор приветствует клиента на его языке и представляется.",evidence:[2]},
  need:{value:isRU?null:true,reason:isRU?"Клиент сразу сформулировал общий вопрос; данных достаточно для ответа.":"Оператор уточнил контекст до предоставления инструкции.",evidence:isRU?[1]:[2,3]},
  identity:{value:null,reason:"Общая инструкция по интерфейсу не требует раскрытия персональных данных или защищённого действия.",evidence:[1,4]},
  solution:{value:isRU?15:20,reason:isRU?"Клиент нашёл заявку. Второстепенный вопрос об уведомлениях остался без ответа.":"Клиент подтвердил, что нашёл нужный раздел. Внутренние правила компании не проверялись: это демонстрационная разметка.",evidence:[1,4,5]},
  empathy:{value:!isEN,reason:isEN?"Клиент выразил недовольство, но оператор не отреагировал на конкретное неудобство.":"Оператор общается вежливо"+(isRU?" и отреагировал на беспокойство клиента.":". Недовольства клиента не было."),evidence:[3,4]},
  management:{value:10,reason:"Ответы последовательны и понятны. Явного ожидания, требующего предупреждения, нет.",evidence:[2,4,5]},
  closing:{value:!isRU,reason:isRU?"После благодарности клиента оператор закрыл чат без итога, предложения помощи и прощания. Проверены последние реплики.":"Оператор подвёл итог или предложил помощь и попрощался.",evidence:[5,6]},
  critical:{value:false,reason:"В проверенном диалоге не обнаружены оскорбления, предложения частных платных услуг или раскрытие конфиденциальной информации.",evidence:[1,2,3,4,5,6]}
 };
}
export const demoConversations                =[
 ["demo-ru-001","Статус заявки на вывод","Алия Садыкова","RU"],
 ["demo-kz-002","Қолданба тілін өзгерту","Данияр Омаров","KZ"],
 ["demo-en-003","Monthly account statement","Alex Morgan","EN"],
 ["demo-ru-004","Статус заявки и уведомления","Алия Садыкова","RU"],
 ["demo-kz-005","Қазақ тілін таңдау","Данияр Омаров","KZ"],
 ["demo-en-006","Finding a statement","Alex Morgan","EN"],
 ["demo-ru-007","Помощь с приложением","Мария Иванова","RU"],
 ["demo-kz-008","Қолданба баптаулары","Данияр Омаров","KZ"]
].map((d,i)=>({id:d[0],title:d[1],operator:d[2],language:d[3],channel:"agent chat",date:"07.11.2026",messages:structuredClone(d[3]==="RU"?ru:d[3]==="KZ"?kz:en),answers:i<6?answersFor(d[3]):null,criteria:structuredClone(initialCriteria),version:1,demo:true}));
