(() => {
  'use strict';
  const CONSENT_VERSION = 'crm-data-uz-v1';
  const QUESTIONS = [
    { young: 'Nima haqida video aytish sizga qiziq?', teen: 'Qaysi mavzu haqida gapirish sizga qiziq?', a: ['Sevimli mashgʻulotim', 'Tabiat va hayvonlar', 'Qiziqarli tajribalar', 'Kitob yoki multfilm'] },
    { young: 'Videoni nimadan boshlasak boʻladi?', teen: 'Videoni boshlash uchun nima yordam beradi?', a: ['Avval reja tuzish', 'Savol bilan boshlash', 'Bir voqeani aytib berish', 'Rasm yoki buyumni koʻrsatish'] },
    { young: 'Kamera oldida qaysi usul qulay?', teen: 'Kamera oldida gapirganda qaysi usul qulay?', a: ['Qisqa jumlalar', 'Doʻstimga aytgandek', 'Misol koʻrsatib', 'Ovoz va kayfiyat bilan'] },
    { young: 'Qisqa video qanday tugashi mumkin?', teen: 'Qisqa video qanday tugasa yaxshi?', a: ['Asosiy fikrni eslatib', 'Tomoshabinga savol berib', 'Keyingi qismga ishora qilib', 'Bitta aniq xulosa bilan'] },
    { young: 'Yangi gʻoya kelsa nima qilasiz?', teen: 'Yangi gʻoya kelganda nima qilasiz?', a: ['Daftarga yozaman', 'Rasm chizaman', 'Ovozli qayd qilaman', 'Darrov kichik reja qilaman'] },
  ];
  const API_URL = window.YBA_API_URL || '';
  const API_KEY = window.YBA_CONFIG?.publishableKey || '';
  const tg = window.Telegram?.WebApp;
  const answers = Array(QUESTIONS.length).fill(-1);
  let current = 0, result = null, selectedProduct = null, consentSubmitted = false, ageGroup = null;
  let activeModule = null, moduleContent = null, moduleAgeGroup = '', moduleDay = 1;
  const moduleAnswers = Object.create(null);
  const moduleDrafts = Object.create(null);
  let selectedPaymentMethod = null;
  let activationPollTimer = null;
  let activationPollDeadline = 0;
  let activationPollInFlight = false;
  const $ = (id) => document.getElementById(id);
  const show = (id, yes) => { $(id).hidden = !yes; };
  const receiptToken = new URL(location.href).searchParams.get('receipt');
  if (receiptToken) { startReceiptVerification(receiptToken); return; }
  if (tg) {
    tg.ready(); tg.expand();
    try { if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes(); } catch { /* Older Telegram clients keep their default gesture behavior. */ }
  }
  // Parent journey: three short presentation rooms, then the payment instructions.
  document.querySelectorAll('.reel-next').forEach(button => button.addEventListener('click', () => {
    const target = $(button.dataset.next);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth' });
  }));
  document.querySelectorAll('.reel-back').forEach(button => button.addEventListener('click', () => {
    const target = $(button.dataset.back);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth' });
  }));
  $('consent-text').textContent = 'Men ota-ona yoki qonuniy vakilman. Test natijasi va yuqoridagi maʼlumotlar akademiya bilan bogʻlanish va tanlangan mahsulot boʻyicha javob berish uchun CRMʼga yuborilishiga roziman. Rozilikni istalgan vaqtda bekor qilib, maʼlumotlarni oʻchirishni soʻrashim mumkin.';
  function showTest() {
    const interests = selectedValues('interest'), formats = selectedValues('format');
    if (!$('child-name').value.trim() || !ageGroup || !interests.length || !formats.length) return setStatus('onboarding-status','Ism, yosh guruhi, kamida bitta qiziqish va formatni tanlang.',true);
    show('products', false); show('test-panel', true); renderQuestion(); $('test-panel').scrollIntoView({behavior:'smooth'});
  }
  function renderQuestion() {
    const item = QUESTIONS[current]; $('question-count').textContent = `${current + 1} / ${QUESTIONS.length}`;
    $('question-title').textContent = ageGroup === '7-10' ? item.young : item.teen; $('progress-bar').style.width = `${((current + 1) / QUESTIONS.length) * 100}%`;
    $('answers').replaceChildren(); $('next-question').disabled = answers[current] < 0;
    item.a.forEach((label, i) => {
      const b = document.createElement('button'); b.className = 'answer' + (answers[current] === i ? ' selected' : ''); b.type = 'button';
      const mark = document.createElement('span'); mark.className = 'answer-mark'; mark.textContent = String.fromCharCode(65 + i);
      const text = document.createElement('span'); text.textContent = label; b.append(mark, text);
      b.addEventListener('click', () => { answers[current] = i; renderQuestion(); }); $('answers').append(b);
    });
    $('back-question').disabled = false; $('back-question').textContent = current === 0 ? 'Orqaga' : 'Orqaga'; $('next-question').textContent = current === QUESTIONS.length - 1 ? 'Natijani koʻrish' : 'Keyingisi';
  }
  function calculateResult() {
    const counts = [0, 0, 0, 0]; answers.forEach((v) => { if (v >= 0) counts[v]++; });
    const labels = ['Reja bilan hikoya qilish', 'Tabiat va kuzatuv', 'Tajriba va kashfiyot', 'Obraz va ijod'];
    const max = Math.max(...counts); const top = counts.map((v, i) => v === max ? labels[i] : null).filter(Boolean);
    result = { answers: [...answers], scores: counts, directions: top };
    $('result-copy').textContent = 'Javoblaringiz boʻyicha sizga mos boshlangʻich yoʻnalish: ' + top.join(', ') + '. Bu tanishuv natijasi; u bolaning qobiliyatini baholamaydi yoki natijani kafolatlamaydi.';
    $('result-tags').replaceChildren(...top.map((x) => { const s = document.createElement('span'); s.className = 'tag'; s.textContent = x; return s; }));
    show('test-panel', false); show('result-panel', true); $('result-panel').scrollIntoView({behavior:'smooth'});
  }
  // Quiz/profile controls were removed from the parent journey; do not bind
  // handlers to their former inputs or allow their hidden rooms to interrupt startup.
  $('products-back').addEventListener('click', () => { show('products', false); $('result-panel').scrollIntoView({behavior:'smooth'}); });
  $('products-next').addEventListener('click', () => {
    if (!selectedProduct || consentSubmitted) return;
    if (selectedProduct === 'platform_30d') {
      show('products', false); show('payment-room', true); $('payment-room').scrollIntoView({behavior:'smooth'});
      return;
    }
    show('products', false); show('consent-panel', true); $('crm-consent').checked = false; $('submit-consent').disabled = true;
    $('consent-panel').scrollIntoView({behavior:'smooth'});
  });
  $('payment-back').addEventListener('click', () => { $('mentor-reel').scrollIntoView({behavior:'smooth'}); });
  function selectPaymentMethod(method) {
    selectedPaymentMethod = method;
    $('select-cash').classList.toggle('selected-product', method === 'cash');
    $('select-card').classList.toggle('selected-product', method === 'card');
    $('card-payment-details').hidden = method !== 'card';
    $('cash-payment-details').hidden = method !== 'cash';
    $('payment-request-status').textContent = method === 'cash'
      ? 'Naqd pulni adminʼga topshirgach, «Naqd pulni topshirdim» tugmasini bosing.'
      : 'Kartaga oʻtkazma qilib, haqiqiy chekni adminʼga koʻrsatgach, xabarni yuboring.';
  }
  $('select-cash').addEventListener('click', () => selectPaymentMethod('cash'));
  $('select-card').addEventListener('click', () => selectPaymentMethod('card'));
  $('confirm-cash-payment').addEventListener('click', () => requestPayment('cash'));
  $('confirm-card-payment').addEventListener('click', () => requestPayment('card'));
  async function requestPayment(method) {
    if (selectedPaymentMethod !== method) return;
    const submitButtons = [$('confirm-cash-payment'), $('confirm-card-payment')];
    if (!API_URL || !tg?.initData) { setStatus('payment-request-status','Botdagi /start tugmasini bosing, keyin Mini Appʼni qayta oching.',true); return; }
    let submitted = false;
    submitButtons.forEach(button => button.disabled = true);
    $('payment-request-status').textContent = 'Soʻrov yuborilmoqda…';
    try {
      const response = await fetch(`${API_URL}/payment-request`, { method:'POST', headers:{'content-type':'application/json','x-telegram-init-data':tg.initData,'apikey':API_KEY}, body:JSON.stringify({method,reportedPaid:true}) });
      const body = await response.json();
      if (!response.ok) {
        if (body.error === 'access_already_active') {
          submitted = true;
          $('select-cash').disabled = true; $('select-card').disabled = true;
          submitButtons.forEach(button => button.disabled = true);
          await openCourse();
          return;
        }
        const messages = { parent_not_linked:'Botda /start tugmasini bosing, keyin Mini Appʼni qayta oching.', payment_card_not_ready:'Ota-ona kartasi tayyor boʻlmadi. Botda /start ni bosing, keyin qayta urinib koʻring.', no_active_admins:'Hozir adminlar xabarnomasini yuborib boʻlmadi. Keyinroq qayta urinib koʻring.' };
        throw new Error(messages[body.error] || 'Soʻrov yuborilmadi. Keyinroq qayta urinib koʻring.');
      }
      const activeMethod=body.method==='card'?'card':'cash';
      const methodLabel = activeMethod === 'cash' ? 'Naqd' : 'Karta';
      if (body.alreadyConfirmed) {
        submitted = true;
        $('payment-request-status').textContent = 'Toʻlov allaqachon admin tomonidan tasdiqlangan.';
        $('select-cash').disabled = true; $('select-card').disabled = true;
        await openCourse();
      } else if (body.notificationPending) {
        $('payment-request-status').textContent = `99 000 soʻm · ${methodLabel} soʻrovi saqlandi, lekin admin xabari yetkazilgani tasdiqlanmadi. Pastdagi tugmani yana bosing yoki chekni ofis adminiga koʻrsating.`;
        submitButtons.find(button => button.id === (method === 'cash' ? 'confirm-cash-payment' : 'confirm-card-payment')).textContent = 'Xabarni qayta yuborish';
        setStatus('payment-request-status', $('payment-request-status').textContent, true);
        startActivationPolling();
      } else {
        submitted = true;
        const status = body.notificationCreated ? `${methodLabel} toʻlovi haqida admin xabardor qilindi.` : 'Toʻlov soʻrovi avval yuborilgan; admin chekni tekshirmoqda.';
        $('payment-request-status').textContent = `${status} Haqiqiy chekni admin tekshiradi va botda tasdiqlaydi.`;
        $('select-cash').disabled = true; $('select-card').disabled = true;
        startActivationPolling();
      }
    } catch (error) {
      setStatus('payment-request-status',error instanceof Error ? error.message : 'Soʻrov yuborilmadi.',true);
    } finally {
      if (!submitted) submitButtons.forEach(button => button.disabled = false);
    }
  }
  $('cancel-consent').addEventListener('click', () => { show('consent-panel', false); show('products', true); $('crm-consent').checked = false; $('submit-consent').disabled = true; $('products').scrollIntoView({behavior:'smooth'}); });
  $('decline-consent').addEventListener('click', () => {
    show('consent-panel', false); show('products', true); $('crm-consent').checked = false; $('submit-consent').disabled = true;
    setStatus('payment-status','Rozilik berilmadi. Natija va mahsulot tanlovi faqat shu brauzerda; serverga yuborilmadi.',false);
    $('products').scrollIntoView({behavior:'smooth'});
  });
  $('crm-consent').addEventListener('change', () => { $('submit-consent').disabled = !$('crm-consent').checked; });
  $('show-link-code').addEventListener('click', () => { show('link-panel', true); $('link-panel').scrollIntoView({behavior:'smooth'}); });
  $('link-back').addEventListener('click', () => { show('link-panel',false); $('welcome-room').scrollIntoView({behavior:'smooth'}); });
  $('show-settings').addEventListener('click',()=>{show('delete-panel',true);$('delete-panel').scrollIntoView({behavior:'smooth'});});
  $('settings-back').addEventListener('click',()=>{show('delete-panel',false);$('welcome-room').scrollIntoView({behavior:'smooth'});});
  document.querySelectorAll('.choose-product').forEach((button) => button.addEventListener('click', () => {
    selectedProduct = button.dataset.product;
    $('products-next').disabled = false;
    document.querySelectorAll('.choose-product').forEach((item) => item.classList.toggle('selected-product', item === button));
    if (selectedProduct === 'platform_30d') {
      show('products', false); show('payment-room', true); $('payment-room').scrollIntoView({behavior:'smooth'});
      return;
    }
    $('payment-status').textContent = 'Alohida oflayn kurs tanlandi: 800 000 soʻm / oy. Avval [JADVAL — egasi beradi] bilan tanishing. Tanlov hozircha faqat shu qurilmada.';
  }));
  $('submit-consent').addEventListener('click', async () => {
    if (!API_URL || !tg?.initData) { setStatus('consent-status', 'Server ulanishi sozlanmagan. Natija brauzerda qoldi.', true); return; }
    const name=$('child-name').value.trim(),interests=selectedValues('interest'),formats=selectedValues('format');
    if (!result || !name || !ageGroup || !interests.length || !formats.length || !$('crm-consent').checked || !selectedProduct) { setStatus('consent-status', 'Natijani yuborish uchun profil maʼlumotlari, mahsulot va ota-ona roziligi kerak.', true); return; }
    const button = $('submit-consent'); button.disabled = true;
    try {
      const response = await fetch(`${API_URL}/consent`, { method:'POST', headers:{'content-type':'application/json','x-telegram-init-data':tg.initData,'apikey':API_KEY}, body:JSON.stringify({ consentGranted:true, consentVersion:CONSENT_VERSION, child:{displayName:name,ageGroup,interests,formats}, testResult:result, parentContact:$('parent-contact').value.trim() || null, selectedProduct }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Yuborilmadi');
      setStatus('consent-status', 'Roziligingiz va natija qayd etildi. CRMʼga yuborish hozircha faollashtirilmagan.', false); $('crm-consent').checked = false;
      consentSubmitted = true;
      show('consent-panel',false); show('products', true);
      document.querySelectorAll('.choose-product').forEach((item) => { item.disabled = true; item.classList.toggle('selected-product', item.dataset.product === selectedProduct); });
      $('products-next').hidden = true;
      $('payment-status').textContent = 'Tanlov va natija rozilik bilan qayd etildi. CRMʼga avtomatik yuborish o‘chiq; bu yerda toʻlov olinmaydi.';
      if (selectedProduct === 'in_person_month') { $('confirm-schedule').disabled = true; $('schedule-next').disabled=true; show('schedule-panel',true); show('media-panel',false); $('schedule-panel').scrollIntoView({behavior:'smooth'}); }
      else if (selectedProduct === 'platform_30d') { $('products').scrollIntoView({behavior:'smooth'}); }
      else { $('products').scrollIntoView({behavior:'smooth'}); }
    } catch (error) { setStatus('consent-status', 'Ulanishda xatolik. Natijani qayta yuborishingiz mumkin.', true); button.disabled = false; }
  });
  $('redeem-code').addEventListener('click', async () => {
    if (!API_URL || !tg?.initData) return setStatus('link-status','Server ulanishi sozlanmagan.',true);
    const code = $('link-code').value.trim(); if (!code) return setStatus('link-status','Bir martalik kodni kiriting.',true);
    try { const r = await fetch(`${API_URL}/link-code`,{method:'POST',headers:{'content-type':'application/json','x-telegram-init-data':tg.initData,'apikey':API_KEY},body:JSON.stringify({code})}); const b=await r.json(); if(!r.ok)throw new Error(b.error); setStatus('link-status','Karta muvaffaqiyatli ulandi.',false); }
    catch { setStatus('link-status','Kod yaroqsiz, muddati tugagan yoki avval ishlatilgan.',true); }
  });
  $('schedule-back').addEventListener('click',()=>{$('schedule-panel').hidden=true;$('products').scrollIntoView({behavior:'smooth'});});
  $('load-schedule').addEventListener('click',loadSchedule);
  $('schedule-next').addEventListener('click',()=>{if($('schedule-next').disabled)return;show('media-panel',true);$('media-panel').scrollIntoView({behavior:'smooth'});});
  $('media-back').addEventListener('click',()=>{$('media-panel').hidden=true;$('schedule-panel').scrollIntoView({behavior:'smooth'});});
  $('media-next').addEventListener('click',()=>{$('products').scrollIntoView({behavior:'smooth'});});
  async function loadSchedule() {
    if(selectedProduct!=='in_person_month'||!consentSubmitted)return setStatus('schedule-status','Avval mahsulotni tanlang va ota-ona roziligini yuboring.',true);
    if (!API_URL || !tg?.initData) { $('schedule-content').textContent='[JADVAL — egasi beradi]'; return; }
    try {
      const r=await fetch(`${API_URL}/schedule`,{headers:{'x-telegram-init-data':tg.initData,'apikey':API_KEY}}); const data=await r.json();
      if(!r.ok||!data.schedule){$('schedule-content').textContent='[JADVAL — egasi beradi]';$('confirm-schedule').disabled=true;return;}
      $('schedule-content').replaceChildren();
      const title=document.createElement('h3');title.textContent=data.schedule.versionLabel||'Kurs jadvali';
      const body=document.createElement('pre');body.className='schedule-json';body.textContent=JSON.stringify(data.schedule.schedule,null,2);
      $('schedule-content').append(title,body);$('confirm-schedule').dataset.version=data.schedule.id;$('confirm-schedule').disabled=true;
      setStatus('schedule-status','Jadvalni tasdiqlash toʻlovdan oldin talab qilinadi.',false);
    } catch { $('schedule-content').textContent='[JADVAL — egasi beradi]'; }
  }
  $('confirm-schedule').addEventListener('click',async()=>{
    if(!API_URL||!tg?.initData||!$('confirm-schedule').dataset.version)return setStatus('schedule-status','Jadval hali mavjud emas yoki ulanish sozlanmagan.',true);
    try{const r=await fetch(`${API_URL}/confirm-schedule`,{method:'POST',headers:{'content-type':'application/json','x-telegram-init-data':tg.initData,'apikey':API_KEY},body:JSON.stringify({scheduleVersionId:$('confirm-schedule').dataset.version})});const b=await r.json();if(!r.ok)throw new Error(b.error);setStatus('schedule-status','Jadval tasdiqlandi. Toʻlov bu Mini Appʼda olinmaydi.',false);$('schedule-next').disabled=false;show('media-panel',true);}
    catch{setStatus('schedule-status','Jadval tasdiqlanmadi. Avval test natijasini rozilik bilan yuboring.',true);}
  });
  $('save-media-consent').addEventListener('click',async()=>{
    if(!API_URL||!tg?.initData)return setStatus('media-status','Server ulanishi sozlanmagan.',true);
    const granted=$('media-consent').checked;
    try{const r=await fetch(`${API_URL}/media-consent`,{method:'POST',headers:{'content-type':'application/json','x-telegram-init-data':tg.initData,'apikey':API_KEY},body:JSON.stringify({granted})});const b=await r.json();if(!r.ok)throw new Error(b.error);setStatus('media-status',granted?'Alohida rozilik qayd etildi. Uni qaytarib olish uchun katakni yechib, yana shu tugmani bosing.':'Alohida rozilik yoqilmadi yoki qaytarib olindi.',false);}
    catch{setStatus('media-status','Avval CRM roziligi bilan profil yarating yoki keyinroq qayta urinib koʻring.',true);}
  });
  $('open-course').addEventListener('click', openCourse);
  $('modules-back').addEventListener('click',()=>{show('modules-panel',false);$('welcome-room').scrollIntoView({behavior:'smooth'});});
  document.querySelectorAll('input[name="module-age"]').forEach(input=>input.addEventListener('change',()=>{
    moduleAgeGroup=input.value;
    $('module-days').hidden=false;
    renderModuleDays();
    renderModuleDay(moduleDay);
  }));
  async function openCourse({silent=false}={}){
    const status=$('course-entry-status');
    if(!API_URL||!tg?.initData){if(!silent)setStatus('course-entry-status','Botdagi /start ni bosing va Mini Appʼni Telegram ichidan qayta oching.',true);return false;}
    const button=$('open-course');if(!silent){button.disabled=true;setStatus('course-entry-status','Toʻlov tasdiqlangani tekshirilmoqda…',false);}
    try{
      const r=await fetch(`${API_URL}/module?number=1`,{headers:{'x-telegram-init-data':tg.initData,'apikey':API_KEY}});
      const b=await r.json();
      if(!r.ok){
        if(silent)return false;
        const messages={access_expired_or_missing:'Faol toʻlov topilmadi yoki 30 kunlik kirish muddati tugagan. Agar toʻlovni kecha qilgan boʻlsangiz, botdagi /start ni bosing va admin bilan bogʻlaning.',module_not_open:'1-modul hozircha ochilmagan.',module_unavailable:'Toʻlov faol, lekin 1-modul hali nashr qilinmagan. Admin modulni faollashtirishi kerak.'};
        setStatus('course-entry-status',messages[b.error]||'Kursni ochib boʻlmadi. Botdagi /start ni bosing yoki admin bilan bogʻlaning.',true);return false;
      }
      activeModule=1;moduleContent=b.module.content;moduleAgeGroup='';moduleDay=1;
      Object.keys(moduleAnswers).forEach(k=>delete moduleAnswers[k]);Object.keys(moduleDrafts).forEach(k=>delete moduleDrafts[k]);
      document.querySelectorAll('input[name="module-age"]').forEach(x=>x.checked=false);
      $('module-title').textContent=moduleContent.title||'1-modul';$('module-intro').textContent=moduleContent.intro||'';
      $('module-lesson').replaceChildren();$('module-days').replaceChildren();$('module-days').hidden=true;$('module-profile').replaceChildren();$('module-profile').hidden=true;
      $('module-progress-note').hidden=b.progress?.completed!==true;
      setStatus('course-entry-status','Toʻlov faol. 1-modul ochildi.',false);
      show('modules-panel',true);$('modules-panel').scrollIntoView({behavior:'smooth'});
      stopActivationPolling();
      return true;
    }catch{if(!silent)setStatus('course-entry-status','Kirishni tekshirib boʻlmadi. Internetni tekshirib, qayta urinib koʻring.',true);return false;}
    finally{if(!silent)button.disabled=false;}
  }
  function stopActivationPolling(){if(activationPollTimer!==null){clearInterval(activationPollTimer);activationPollTimer=null;}}
  function startActivationPolling(){
    if(activationPollTimer!==null)return;
    activationPollDeadline=Date.now()+10*60_000;
    $('payment-request-status').textContent='Admin toʻlovni tasdiqlashi bilan 1-modul avtomatik ochiladi.';
    activationPollTimer=window.setInterval(async()=>{
      if(Date.now()>=activationPollDeadline){stopActivationPolling();return;}
      if(document.hidden||!tg?.initData||activationPollInFlight)return;
      activationPollInFlight=true;
      try{if(await openCourse({silent:true}))stopActivationPolling();}
      finally{activationPollInFlight=false;}
    },8000);
  }
  function renderModuleDays(){
    $('module-days').replaceChildren();
    for(let day=1;day<=7;day++){
      const button=document.createElement('button');button.type='button';button.className='module-day'+(day===moduleDay?' active':'');button.textContent=`${day}-kun`;
      button.addEventListener('click',()=>{moduleDay=day;renderModuleDays();renderModuleDay(day);});$('module-days').append(button);
    }
  }
  function renderModuleDay(dayNo){
    if(!moduleContent||!moduleAgeGroup)return;
    const day=moduleContent.days?.find(x=>x.day===dayNo);if(!day)return;
    const box=document.createElement('article');box.className='module-lesson';
    const meta=document.createElement('p');meta.className='eyebrow';meta.textContent=`${dayNo}-kun · 10–15 daqiqa`;
    const title=document.createElement('h3');title.textContent=day.title;
    const goal=document.createElement('p');goal.textContent=day.goal;
    const taskLabel=document.createElement('h4');taskLabel.textContent='Bugungi mashgʻulot';
    const task=document.createElement('p');task.textContent=moduleAgeGroup==='7-10'?day.young:day.older;
    box.append(meta,title,goal,taskLabel,task);
    if(dayNo===2||dayNo===6){
      const prompt=document.createElement('p');prompt.className='small-note';prompt.textContent=dayNo===2?'Ixtiyoriy shaxsiy qoralama: uni faqat qogʻozda yoki shu sahifada yozing. Serverga yuborilmaydi.':'Rejangizni qogʻozda tuzish mumkin; sahifaga yozsangiz ham serverga yuborilmaydi.';
      const draft=document.createElement('textarea');draft.className='module-draft';draft.rows=dayNo===2?3:4;draft.maxLength=500;draft.placeholder=dayNo===2?'Menga … yoqadi. Men …ni oʻrgandim. Men …ni sinab koʻrmoqchiman.':'Boshlanish: …\nAsosiy fikr: …\nYakun: …';draft.value=moduleDrafts[dayNo]||'';
      draft.addEventListener('input',()=>{moduleDrafts[dayNo]=draft.value;});box.append(prompt,draft);
    }
    const question=document.createElement('h4');question.textContent=`Mini-savol: ${day.question}`;box.append(question);
    const options=document.createElement('div');options.className='module-options';
    (day.options||[]).forEach((label,index)=>{
      const option=document.createElement('button');option.type='button';option.className='module-option'+(moduleAnswers[dayNo]===index?' selected':'');option.textContent=label;
      option.addEventListener('click',()=>{moduleAnswers[dayNo]=index;renderModuleDay(dayNo);});options.append(option);
    });
    box.append(options);
    const nav=document.createElement('div');nav.className='room-nav module-nav';
    const prev=document.createElement('button');prev.type='button';prev.className='button quiet';prev.textContent=dayNo===1?'Orqaga':'Oldingi kun';prev.disabled=dayNo===1;prev.addEventListener('click',()=>{moduleDay--;renderModuleDays();renderModuleDay(moduleDay);});
    const next=document.createElement('button');next.type='button';next.className='button primary';next.textContent=dayNo===7?'Yakuniy profilni koʻrish':'Keyingi kun';next.disabled=!Number.isInteger(moduleAnswers[dayNo]);
    next.addEventListener('click',()=>{if(dayNo===7){showModuleProfile();return;}moduleDay++;renderModuleDays();renderModuleDay(moduleDay);});nav.append(prev,next);box.append(nav);
    if(dayNo===7)for(const notice of moduleContent.notices||[]){const p=document.createElement('p');p.className='small-note';p.textContent=notice;box.append(p);}
    $('module-lesson').replaceChildren(box);$('module-profile').hidden=true;
  }
  function showModuleProfile(){
    const profile=$('module-profile');profile.replaceChildren();profile.hidden=false;
    const heading=document.createElement('h3');heading.textContent='Mening ijodiy boshlanishim';profile.append(heading);
    const topicOptions=moduleContent.days.find(x=>x.day===1)?.options||[];
    const strengthOptions=moduleContent.days.find(x=>x.day===3)?.options||[];
    const formatOptions=moduleContent.days.find(x=>x.day===5)?.options||[];
    const topic=topicOptions[moduleAnswers[1]]||topicOptions[moduleAnswers[7]]||'Hali tanlanmagan';
    const strength=strengthOptions[moduleAnswers[3]]||'Yangi narsalarni sinab koʻrish';
    const format=formatOptions[moduleAnswers[5]]||'Qisqa video';
    for(const [label,value] of [['Qiziqtirgan mavzu',topic],['Sizga yoqqan yondashuv',strength],['Sinab koʻrmoqchi boʻlgan format',format]]){
      const p=document.createElement('p');const b=document.createElement('strong');b.textContent=`${label}: `;p.append(b,document.createTextNode(value));profile.append(p);
    }
    const ideas=(moduleContent.ideaTemplates?.[topic]||['Qiziqqan mavzuingiz haqida bitta savolga javob beruvchi qisqa video','Yangi oʻrgangan narsangizni uch qadamda tushuntirish','Yoqtirgan mashgʻulotingizdan bir lahzani hikoya qilish']).slice(0,3);
    const listTitle=document.createElement('h4');listTitle.textContent='Birinchi video uchun gʻoyalar';const list=document.createElement('ol');ideas.forEach(idea=>{const li=document.createElement('li');li.textContent=idea;list.append(li);});profile.append(listTitle,list);
    const note=document.createElement('p');note.className='privacy-note';note.textContent='Bu sizning hozirgi qiziqishlaringiz asosidagi fikrlar. Bu qobiliyat bahosi, saralash yoki natija vaʼdasi emas. Javoblar va profil faqat shu sahifada hisoblandi; serverga yuborilmadi va saqlanmadi.';profile.append(note);
    const restart=document.createElement('button');restart.type='button';restart.className='button quiet';restart.textContent='Gʻoyalarni qayta tanlash';restart.addEventListener('click',()=>{moduleDay=1;renderModuleDays();renderModuleDay(1);});profile.append(restart);
    saveModuleCompletion();profile.scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function saveModuleCompletion(){
    if(!API_URL||!tg?.initData)return;
    try{
      const r=await fetch(`${API_URL}/progress`,{method:'POST',headers:{'content-type':'application/json','x-telegram-init-data':tg.initData,'apikey':API_KEY},body:JSON.stringify({moduleNo:1,progress:{completed:true}})});
      if(!r.ok)throw new Error();$('module-progress-note').hidden=false;
    }catch{setStatus('progress-status','Profil serverga yuborilmadi. Javoblaringiz va natijangiz sahifada qoldi.',false);}
  }
  $('request-delete').addEventListener('click', async () => {
    if (!confirm('Mahalliy profil va natijani oʻchirishni soʻraysizmi?')) return;
    const telegramInitData=tg?.initData;
    clearLocalData();
    if (!API_URL || !telegramInitData) return setStatus('delete-status','Mahalliy xotira tozalandi. Serverga soʻrov yuborish uchun Telegram va API ulanishi kerak.',true);
    try { const r=await fetch(`${API_URL}/delete`,{method:'POST',headers:{'content-type':'application/json','x-telegram-init-data':telegramInitData,'apikey':API_KEY},body:'{}'}); if(!r.ok)throw new Error(); setStatus('delete-status','Mahalliy xotira tozalandi. Soʻrov qabul qilindi va CRM outboxʼiga «delete» hodisasi qoʻshildi.',false); }
    catch { setStatus('delete-status','Soʻrov yuborilmadi. Qayta urinib koʻring.',true); }
  });
  function clearLocalData(){
    try{localStorage.clear();}catch{}
    try{sessionStorage.clear();}catch{}
    answers.fill(-1);current=0;result=null;selectedProduct=null;consentSubmitted=false;ageGroup=null;activeModule=null;selectedPaymentMethod=null;
    ['child-name','parent-contact','link-code','module-progress'].forEach(id=>{if($(id))$(id).value='';});
    document.querySelectorAll('input[type=checkbox],input[type=radio]').forEach(input=>{input.checked=false;});
    $('products-next').disabled=true;$('submit-consent').disabled=true;$('products-next').hidden=false;$('next-question').disabled=true;
    document.querySelectorAll('.choose-product').forEach(button=>{button.disabled=false;button.classList.remove('selected-product');});
    $('answers').replaceChildren();$('question-title').textContent='';$('question-count').textContent='1 / 5';$('progress-bar').style.width='0%';
    $('result-copy').textContent='';$('result-tags').replaceChildren();$('module-content').replaceChildren();$('progress-label').hidden=true;$('module-progress').hidden=true;$('save-progress').hidden=true;
    document.querySelectorAll('.status').forEach(el=>{el.textContent='';el.className='status';});
    document.querySelectorAll('.room').forEach(room=>{room.hidden=!room.classList.contains('reel-room')&&room.id!=='delete-panel';});
    $('payment-status').textContent='Mahsulot tanlang. Bu toʻlov emas; toʻlov tugmasi mavjud emas.';
    $('payment-request-status').textContent='Hali usul tanlanmagan.';$('select-cash').disabled=false;$('select-card').disabled=false;$('select-cash').classList.remove('selected-product');$('select-card').classList.remove('selected-product');$('confirm-cash-payment').disabled=false;$('confirm-card-payment').disabled=false;$('cash-payment-details').hidden=true;$('card-payment-details').hidden=true;
    $('confirm-schedule').disabled=true;delete $('confirm-schedule').dataset.version;$('schedule-content').textContent='[JADVAL — egasi beradi]';
    $('delete-panel').scrollTop=0;
  }
  async function startReceiptVerification(token) {
    document.querySelectorAll('.shell > section').forEach(section => { section.hidden = section.id !== 'receipt-verification'; });
    document.body.classList.add('receipt-verification-mode');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token) || !API_URL) {
      setStatus('receipt-verification-status','Tasdiq topilmadi. QR-kod yaroqsiz yoki maʼlumotlar mavjud emas.',true); return;
    }
    try {
      const headers = API_KEY ? { apikey: API_KEY } : {};
      const response = await fetch(`${API_URL}/receipt-verify?id=${encodeURIComponent(token)}`,{headers});
      const data = await response.json();
      if (response.status === 404) throw new Error('receipt_not_found');
      if (!response.ok || data.authentic !== true) throw new Error('verification_unavailable');
      const date = value => new Intl.DateTimeFormat('uz-UZ',{timeZone:'Asia/Tashkent',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(value));
      $('verified-receipt-number').textContent = data.receiptNo;
      $('verified-receipt-amount').textContent = `${Number(data.amountUzs).toLocaleString('uz-UZ')} soʻm`;
      $('verified-receipt-method').textContent = data.method === 'card' ? 'Karta' : 'Naqd';
      $('verified-receipt-date').textContent = date(data.confirmedAt);
      $('verified-receipt-period').textContent = data.accessUntil ? `${date(data.confirmedAt)} dan ${date(data.accessUntil)} gacha` : 'Kirish muddati mavjud emas';
      $('receipt-verification-details').hidden = false;
      if(data.status==='cancelled') setStatus('receipt-verification-status','Bu elektron tasdiq bekor qilingan.',true);
      else if(data.status==='expired') setStatus('receipt-verification-status','Toʻlov yozuvi haqiqiy. Platformaga kirish muddati tugagan.',false);
      else setStatus('receipt-verification-status','Toʻlov yozuvi akademiya tizimida topildi. Yuqoridagi maʼlumotlarni PDF bilan solishtiring.',false);
    } catch (error) {
      const notFound = error instanceof Error && error.message === 'receipt_not_found';
      setStatus('receipt-verification-status',notFound?'Tasdiq topilmadi. QR-kod yaroqsiz yoki maʼlumotlar mavjud emas.':'Tekshirish xizmati vaqtincha ishlamayapti. Keyinroq qayta urinib koʻring.',true);
    }
  }
  function selectedValues(name){return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(x=>x.value);}
  function setStatus(id, text, error) { const el=$(id); el.textContent=text; el.className='status '+(error?'error':'ok'); }
})();

