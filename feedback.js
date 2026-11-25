/* RISE 意見與修正回報：會員送出頁與管理員彙整頁。權限由資料庫 RPC 驗證，前端只負責顯示。 */
(() => {
 'use strict';
 const mode=document.body.dataset.feedback;
 const root=document.getElementById('feedback-root'),statusEl=document.getElementById('feedback-status');
 if(!root||!['member','admin'].includes(mode))return;
 const KIND={bug:'功能異常',security:'疑似安全問題',suggestion:'改善建議',other:'其他',content:'內容修正'};
 const FORM_KINDS=['bug','security','suggestion','other'];
 const STATUS={new:'未處理',triaged:'已確認',in_progress:'處理中',needs_info:'待補資料',escalated:'轉交管理者',fix_ready:'測試通過待核准',awaiting_verification:'已發布待複驗',resolved:'已解決',wontfix:'暫不處理',duplicate:'重複回報'};
 const FIX_STATE={queued:'排隊中',attempting:'修正中',attempt_failed:'第一次修正失敗，待重試',fix_ready:'測試通過，待核准發布',approved:'已核准，待發布',rejected:'已退回',published:'已發布，待複驗',verified:'已複驗並結案',escalated:'已轉交管理者',needs_info:'待補資料'};
 const STOP={two_failures:'連續兩次修正失敗，已停止',page_out_of_scope:'頁面不在自動修正範圍',cannot_reproduce:'無法重現問題',ambiguous_or_unknown_target:'正確目的頁有歧義或沒有對應設定',too_many_broken_links:'失效連結過多',inconclusive_reproduction:'無法判定重現結果',not_reproduced_in_browser:'在瀏覽器實際點擊時未重現',rejected_by_admin:'管理者退回',post_publish_verify_failed:'發布後複驗未通過'};
 const PRIORITY={low:'低',normal:'一般',high:'高'};
 const PAGES=['index.html','about.html','join.html','team.html','schedule.html','science.html','math.html','physics.html','chemistry.html','explore.html','video-detail.html','resources.html','yearbook.html','competition-gallery.html','questions.html','inquiry.html','modules.html','assignments.html','discussions.html','competitions.html','dialogues.html','learning-report.html','ta-training.html','ta-forum.html','plc.html','account.html','login.html','register.html','privacy.html'];
 let client=null,user=null,busy=false,loadTicket=0;
 const el=(tag,text,parent,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;if(parent)parent.append(e);return e;};
 const when=v=>v?new Date(v).toLocaleString('zh-TW',{hour12:false}):'';
 const say=(text,error)=>{statusEl.textContent=text||'';statusEl.classList.toggle('error',!!error);};
 function explain(e){
  const m=String(e?.message||'');
  if(m.startsWith('rise:'))return m.slice(5);
  if(['PGRST202','42883','42P01','PGRST205'].includes(e?.code))return '回報功能尚未啟用：管理員需先在 Supabase 執行 backend/feedback.sql。';
  if(e?.code==='42501')return '沒有權限執行這項操作，請重新登入後再試。';
  return '操作沒有完成，請確認網路後再試一次。';
 }
 const timed=async(promise)=>{const t=new Promise((_,rej)=>setTimeout(()=>rej(Error('timeout')),15000));return Promise.race([promise,t]);};

 /* 疑似安全等緊急案件：送出後立即請後端寄出管理者通知（僅案件編號，不含內容）。失敗也不影響案件；管理頁仍會標示待優先處理。 */
 async function notifyUrgent(){
  try{const {data}=await client.auth.getSession();const cfg=window.RISE_AUTH_CONFIG||{};
   await timed(fetch(cfg.url.replace(/\/$/,'')+'/functions/v1/rise-feedback-alert',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,apikey:cfg.publishableKey,'Content-Type':'application/json'},body:'{}'}));}catch{}
 }

 /* ---------- 會員：送出與我的回報 ---------- */
 function memberGate(){
  root.replaceChildren();
  if(!user){
   const card=el('section','',root,'auth-card');
   el('h2','請先登入',card);el('p','為避免垃圾訊息，送出回報需要已驗證信箱的會員帳號。看到網站問題但還沒有帳號，也可以直接寄信給管理員。',card);
   const row=el('p','',card);const a=el('a','登入',row,'button');a.href='login.html';
   const mail=el('a','寄信給管理員',row);mail.href='mailto:'+(window.RISE_SITE_INFO?.contactEmail||'ytyeh@g.ntu.edu.tw');mail.style.marginLeft='16px';
   return false;
  }
  if(!user.email_confirmed_at){
   const card=el('section','',root,'auth-card');el('h2','請先驗證信箱',card);el('p','驗證信箱後才能送出回報。請到會員中心重新寄送驗證信。',card);
   const a=el('a','前往會員中心',card,'button');a.href='account.html';return false;
  }
  return true;
 }
 function field(parent,label,control,hint){
  const wrap=el('label','',parent,'fb-field');el('span',label,wrap,'fb-label');wrap.append(control);if(hint)el('small',hint,wrap,'fb-hint');return control;
 }
 function renderMember(mine){
  if(!memberGate())return;
  root.replaceChildren();
  const params=new URLSearchParams(location.search);
  const card=el('section','',root,'auth-card fb-card');
  el('h2','送出回報',card);
  const warn=el('p','請勿填入密碼、驗證碼、身分證字號或學生個人資料。若發現疑似安全問題，請選「疑似安全問題」並只描述現象，不要貼上帳密或可直接利用的細節；管理者會優先處理。',card,'fb-warning');warn.setAttribute('role','note');
  const form=el('form','',card,'fb-form');form.noValidate=true;
  const kind=el('select','',null);for(const k of FORM_KINDS){const o=el('option',KIND[k],kind);o.value=k;}
  const wanted=params.get('kind');if(FORM_KINDS.includes(wanted))kind.value=wanted;
  field(form,'回報類型',kind);
  const page=el('input','',null);page.type='text';page.maxLength=200;page.setAttribute('list','fb-pages');page.autocomplete='off';
  const wantedPage=(params.get('page')||'').slice(0,200);if(/^[A-Za-z0-9_./?=&%#-]+$/.test(wantedPage))page.value=wantedPage;
  const list=el('datalist','',form);list.id='fb-pages';for(const p of PAGES){const o=el('option','',list);o.value=p;}
  const pageField=field(form,'發生在哪一頁',page,'填頁面檔名，例如 math.html。功能異常必填。').parentElement;
  const title=el('input','',null);title.type='text';title.maxLength=120;field(form,'標題（可略，會自動取描述開頭）',title);
  const body=el('textarea','',null);body.rows=5;body.maxLength=3000;body.required=true;
  field(form,'問題描述（10–3000 字）',body);
  const count=el('small','0／3000',form,'fb-count');body.addEventListener('input',()=>{count.textContent=body.value.length+'／3000';});
  const detail=el('div','',form,'fb-detail');
  const steps=el('textarea','',null);steps.rows=3;steps.maxLength=2000;field(detail,'操作步驟',steps,'你做了哪些步驟？例如：開啟 join.html，點「前往會員中心」。');
  const expected=el('textarea','',null);expected.rows=2;expected.maxLength=1000;field(detail,'預期結果',expected);
  const actual=el('textarea','',null);actual.rows=2;actual.maxLength=1000;field(detail,'實際結果',actual);
  const sync=()=>{detail.hidden=kind.value==='suggestion';pageField.hidden=false;};kind.addEventListener('change',sync);sync();
  el('p','送出時會自動附上瀏覽器與螢幕寬度，方便重現問題；不會附上其他個人資料。回報內容與處理紀錄只有管理者看得到，你可以在下方用案件編號追蹤進度。',form,'fb-note');
  const submit=el('button','送出回報',form);submit.type='submit';submit.className='button';
  form.addEventListener('submit',async e=>{
   e.preventDefault();if(busy)return;
   const k=kind.value,need=k==='bug';
   if(body.value.trim().length<10){say('請填寫問題描述（至少 10 字）。',true);return;}
   if(need&&(!page.value.trim()||steps.value.trim().length<2||expected.value.trim().length<2||actual.value.trim().length<2)){say('功能異常請填寫發生頁面、操作步驟、預期結果與實際結果。',true);return;}
   busy=true;submit.disabled=true;say('送出中…');
   try{
    const info=(navigator.userAgent||'').slice(0,140)+' · '+innerWidth+'px';
    const hide=k==='suggestion';
    const r=await timed(client.rpc('rise_submit_feedback',{p_kind:k,p_page:page.value,p_title:title.value,p_body:body.value,p_steps:hide?'':steps.value,p_expected:hide?'':expected.value,p_actual:hide?'':actual.value,p_client_info:info}));
    if(r.error)throw r.error;
    const res=r.data||{};
    say('已收到，謝謝你。案件編號：'+(res.case_no||'')+'。請保留編號；處理進度會顯示在下方「我的回報」。');
    title.value='';body.value='';steps.value='';expected.value='';actual.value='';count.textContent='0／3000';
    if(res.urgent)notifyUrgent();
    await loadMine(true);
   }catch(err){say(explain(err),true);}
   finally{busy=false;submit.disabled=false;}
  });
  const mineCard=el('section','',root,'auth-card fb-card');el('h2','我的回報',mineCard);
  if(mine===null){el('p','載入中…',mineCard);return;}
  if(mine==='error'){el('p','暫時讀不到你的回報紀錄，不影響送出。',mineCard);return;}
  if(!mine.length){el('p','還沒有送出過回報。',mineCard);return;}
  const ul=el('ul','',mineCard,'fb-list');
  for(const r of mine){
   const li=el('li','',ul,'fb-item');
   const head=el('div','',li,'fb-item-head');el('strong',(r.case_no?r.case_no+'　':'')+r.title,head);
   el('span',STATUS[r.status]||r.status,head,'fb-badge fb-'+r.status);
   el('p',KIND[r.kind]+(r.page?' · '+r.page:'')+' · '+when(r.created_at),li,'fb-meta');
   el('p',r.body,li,'fb-body');
   if(r.public_reply)el('p','管理員回覆：'+r.public_reply,li,'fb-reply');
  }
 }
 async function loadMine(keepForm){
  const ticket=++loadTicket;
  if(!keepForm)renderMember(null);
  try{
   const r=await timed(client.rpc('rise_my_feedback'));
   if(ticket!==loadTicket)return;
   if(r.error)throw r.error;
   renderMember(r.data||[]);
  }catch(err){if(ticket!==loadTicket)return;if(['PGRST202','42883','42P01'].includes(err?.code)){say(explain(err),true);renderMember([]);}else renderMember('error');}
 }

 /* ---------- 管理員：彙整、分類、寄信 ---------- */
 const adminState={filter:'open',items:[],urgent:[],summary:null};
 function metric(parent,label,value,warn){const d=el('div','',parent,'admin-metric'+(warn&&value>0?' fb-warn':''));el('strong',String(value),d);el('span',label,d);}
 function autofixPanel(parent,r){
  const a=r.autofix,box=el('div','',parent,'fb-autofix');
  el('h4','自動修正（限公開說明頁的站內連結錯誤）',box);
  el('p','狀態：'+(FIX_STATE[a.state]||a.state)+'　嘗試次數：'+a.attempts+'／2'+(a.stop_reason?'　停止原因：'+(STOP[a.stop_reason]||a.stop_reason):'')+(a.is_simulation?'　【模擬案例】':''),box,'fb-meta');
  const b=a.before_result,af=a.after_result;
  if(b&&b.expected){
   el('p','修改前：預期 '+b.expected.map(x=>x.text+' → '+x.lands_on).join('、')+'；實際 '+(b.actual||[]).map(x=>x.text+' → '+(x.landed||'?')+'（'+(x.title||'')+'）').join('、'),box,'fb-body');
  }
  if(af&&af.clicks)el('p','修改後：'+af.clicks.map(x=>x.text+' → '+x.landed+'（'+x.title+'）'+(x.ok?' ✓':' ✗')).join('、')+'；靜態檢查 '+(af.static_check?.ok?'通過':'未通過'),box,'fb-body');
  if(af&&af.problems)el('p','最近一次未通過：'+af.phase+'：'+af.problems.join('；'),box,'fb-body');
  if(a.diff_summary){
   el('p','修改檔案：'+(a.diff_summary.files||[]).join('、')+'；變動 '+a.diff_summary.changed_lines+' 行；分支 '+a.branch,box,'fb-meta');
   if(a.diff_summary.patch){const d=el('details','',box);el('summary','查看修改差異',d);el('pre',a.diff_summary.patch,d,'fb-patch');}
  }
  if(a.verify_command){el('p','可重跑的檢查：',box,'fb-meta');el('code',a.verify_command,box);}
  if(a.state==='fix_ready'){
   const row=el('div','',box,'fb-actions');
   const keep=el('input','',null);keep.type='checkbox';keep.id='keep-'+r.id;const kl=el('label','',row);kl.append(keep,document.createTextNode(' 保留為後續更新的回歸測試'));
   const ok=el('button','核准發布',row);ok.type='button';ok.className='button';
   const no=el('button','退回',row);no.type='button';
   el('p','核准只是授權；發布程式會在合併前以乾淨主線重跑檢查器與靜態檢查，通過才會發布並在發布後複驗，複驗通過才結案。',box,'fb-hint');
   const decide=async d=>{
    if(busy)return;if(!confirm(d==='approve'?'確定核准發布 '+r.case_no+' 的修正？':'確定退回 '+r.case_no+' 的修正？'))return;
    busy=true;ok.disabled=no.disabled=true;say('處理中…');
    try{const res=await timed(client.rpc('rise_admin_autofix_decide',{p_feedback:r.id,p_decision:d,p_keep_regression:keep.checked,p_note:''}));if(res.error)throw res.error;say(d==='approve'?'已核准，等待發布程式處理。':'已退回並轉交管理者。');busy=false;await loadAdmin(true);}
    catch(err){say(explain(err),true);busy=false;ok.disabled=no.disabled=false;}
   };
   ok.onclick=()=>decide('approve');no.onclick=()=>decide('reject');
  }
 }
 function renderAdmin(){
  root.replaceChildren();
  const s=adminState.summary;
  if(adminState.urgent.length){
   const ub=el('section','',root,'auth-card fb-card fb-urgent');ub.setAttribute('role','alert');
   el('h2','待優先處理：疑似安全、登入、角色權限、個資或資料遺失（'+adminState.urgent.length+' 則）',ub);
   el('p','這些案件不會進入自動修正；系統已嘗試以私人信件通知管理者，若未收到信，請以此區為準。',ub,'fb-note');
   const ul=el('ul','',ub,'fb-list');for(const r of adminState.urgent){const li=el('li','',ul);li.textContent=r.case_no+'　'+KIND[r.kind]+'　'+(r.is_simulation?'【模擬案例】':'')+r.title+'（'+STATUS[r.status]+'，'+when(r.created_at)+'）';}
   const see=el('button','只顯示緊急案件',ub);see.type='button';see.onclick=()=>{adminState.filter='urgent';loadAdmin();};
  }
  const top=el('section','',root,'auth-card fb-card');
  el('h2','今日彙整',top);
  if(s){
   const m=el('div','',top,'admin-metrics');const bk=s.buckets||{};
   metric(m,'新增（自上次寄出彙整）',bk.new??s.new_count);metric(m,'待補資料',bk.needs_info??0);metric(m,'處理中',bk.in_progress??0);
   metric(m,'轉交管理者',bk.escalated??0,true);metric(m,'待驗證（待核准／待複驗）',bk.awaiting_verification??0);metric(m,'已結案（本期）',bk.closed??s.resolved_in_window);
   metric(m,'緊急未結案',s.urgent_open??0,true);metric(m,'超過 3 天未處理',s.stale_untriaged,true);metric(m,'未結案合計',s.open_total);
   if(s.repeat_pages.length){
    el('h3','同頁重複回報（建議合併處理）',top);const ul=el('ul','',top,'fb-list');
    for(const g of s.repeat_pages)el('li',g.page+'（'+KIND[g.kind]+'）'+g.count+' 則：'+(g.titles||[]).join('；')+((g.case_nos||[]).length?'（'+g.case_nos.join('、')+'）':''),ul);
   }
  }
  const actions=el('p','',top,'fb-actions');
  const send=el('button','立即寄出今日彙整信',actions);send.type='button';send.className='button';
  el('span','收件人固定為管理員信箱。排程每天早上檢查，只有出現新回報時才會寄信；這個按鈕不論有無新回報都會寄出。',actions,'fb-hint');
  send.onclick=async()=>{
   if(busy)return;busy=true;send.disabled=true;say('寄送中…');
   try{
    const {data}=await client.auth.getSession();const cfg=window.RISE_AUTH_CONFIG||{};
    const res=await timed(fetch(cfg.url.replace(/\/$/,'')+'/functions/v1/rise-feedback-digest',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,apikey:cfg.publishableKey,'Content-Type':'application/json'},body:'{}'}));
    const out=await res.json().catch(()=>({}));
    if(res.ok&&out.sent)say('已寄出 '+out.day+' 的彙整信：新 '+out.new_count+' 則、未結案 '+out.open_total+' 則。');
    else if(res.ok)say(out.reason||'今日彙整已寄出。');
    else say(out.error||'寄送沒有完成。',true);
   }catch{say('寄送沒有完成：請確認 rise-feedback-digest 已部署，並確認網路。',true);}
   finally{busy=false;send.disabled=false;}
  };
  const list=el('section','',root,'auth-card fb-card');
  el('h2','回報清單',list);
  const filters=el('div','',list,'admin-filters');
  const sel=el('select','',null);for(const [v,l] of [['open','未結案'],['urgent','緊急待處理'],['new','未處理'],['needs_info','待補資料'],['escalated','轉交管理者'],['fix_ready','測試通過待核准發布'],['awaiting_verification','已發布待複驗'],['resolved','已解決'],['wontfix','暫不處理'],['duplicate','重複回報'],['','全部']]){const o=el('option',l,sel);o.value=v;}
  sel.value=adminState.filter;const w=el('label','',filters);el('span','顯示',w);w.append(sel);
  sel.onchange=()=>{adminState.filter=sel.value;loadAdmin();};
  if(!adminState.items.length){el('p','這個條件下沒有回報。',list);return;}
  const ul=el('ul','',list,'fb-list');
  for(const r of adminState.items){
   const li=el('li','',ul,'fb-item');
   const head=el('div','',li,'fb-item-head');el('strong',r.case_no+'　'+r.title,head);const badges=el('span','',head,'fb-badges');if(r.urgent)el('span','緊急',badges,'fb-badge fb-new');if(r.is_simulation)el('span','模擬案例',badges,'fb-badge fb-sim');el('span',STATUS[r.status],badges,'fb-badge fb-'+r.status);
   el('p',KIND[r.kind]+(r.page?' · '+r.page:'')+' · '+r.submitter+' · '+when(r.created_at)+(r.similar_open?' · 同頁還有 '+r.similar_open+' 則':''),li,'fb-meta');
   el('p',r.body,li,'fb-body');
   for(const [lab,val] of [['操作步驟',r.steps],['預期結果',r.expected],['實際結果',r.actual]])if(val)el('p',lab+'：'+val,li,'fb-body');
   if(r.client_info)el('p','環境：'+r.client_info,li,'fb-meta');
   if(r.ai_summary)el('p','AI 摘要（僅供參考，不是驗收標準）：'+r.ai_summary,li,'fb-meta');
   if(r.autofix)autofixPanel(li,r);
   const f=el('form','',li,'fb-triage');
   const st=el('select','',null);for(const [v,l] of Object.entries(STATUS)){if(['fix_ready','awaiting_verification'].includes(v)&&r.status!==v)continue;const o=el('option',l,st);o.value=v;}st.value=r.status;field(f,'狀態',st);
   const pr=el('select','',null);for(const [v,l] of Object.entries(PRIORITY)){const o=el('option',l,pr);o.value=v;}pr.value=r.priority;field(f,'優先順序',pr);
   const dup=el('select','',null);const none=el('option','（不是重複）',dup);none.value='';
   for(const o of adminState.items.filter(x=>x.id!==r.id)){const op=el('option',o.title.slice(0,40),dup);op.value=o.id;}
   dup.value=r.duplicate_of||'';field(f,'重複於',dup);
   const note=el('textarea','',null);note.rows=2;note.maxLength=2000;note.value=r.admin_note;field(f,'內部備註（只有管理員看得到）',note);
   const reply=el('textarea','',null);reply.rows=2;reply.maxLength=1000;reply.value=r.public_reply;field(f,'回覆給回報者（對方可見）',reply);
   const save=el('button','儲存',f);save.type='submit';
   f.onsubmit=async e=>{
    e.preventDefault();if(busy)return;busy=true;save.disabled=true;say('儲存中…');
    try{
     const res=await timed(client.rpc('rise_admin_triage_feedback',{p_id:r.id,p_status:st.value,p_priority:pr.value,p_admin_note:note.value,p_public_reply:reply.value,p_duplicate_of:st.value==='duplicate'?(dup.value||null):null}));
     if(res.error)throw res.error;say('已儲存。');busy=false;await loadAdmin(true);
    }catch(err){say(explain(err),true);busy=false;save.disabled=false;}
   };
  }
 }
 async function loadAdmin(quiet){
  const ticket=++loadTicket;if(!quiet)say('載入中…');
  try{
   const [list,sum,urgent]=await Promise.all([timed(client.rpc('rise_admin_feedback',{p_status:adminState.filter})),timed(client.rpc('rise_admin_feedback_summary')),timed(client.rpc('rise_admin_feedback',{p_status:'urgent'}))]);
   if(ticket!==loadTicket)return;
   if(list.error)throw list.error;if(sum.error)throw sum.error;if(urgent.error)throw urgent.error;
   adminState.items=list.data||[];adminState.urgent=urgent.data||[];adminState.summary=sum.data;renderAdmin();if(!quiet)say('');
  }catch(err){if(ticket!==loadTicket)return;root.replaceChildren();say(err?.code==='42501'?'只有已驗證的管理員可以使用這一頁。':explain(err),true);}
 }

 async function start(c){
  client=c;
  try{
   const {data}=await client.auth.getUser();user=data?.user||null;
  }catch{user=null;}
  if(mode==='member')user&&user.email_confirmed_at?loadMine():memberGate();
  else if(!user){root.replaceChildren();say('請先以管理員帳號登入。',true);}
  else loadAdmin();
 }
 let started=false;
 const go=()=>{if(!started&&window.RISE_NAV_CLIENT){started=true;start(window.RISE_NAV_CLIENT);}};
 window.addEventListener('rise-nav-client',go);go();
 setTimeout(()=>{if(!started){root.replaceChildren();say('無法連線到帳號服務，請重新整理頁面。',true);}},12000);
})();
