/* RISE 意見與修正回報：會員送出頁與管理員彙整頁。權限由資料庫 RPC 驗證，前端只負責顯示。 */
(() => {
 'use strict';
 const mode=document.body.dataset.feedback;
 const root=document.getElementById('feedback-root'),statusEl=document.getElementById('feedback-status');
 if(!root||!['member','admin'].includes(mode))return;
 const KIND={bug:'網站問題',content:'內容修正',suggestion:'功能建議',other:'其他'};
 const STATUS={new:'未處理',triaged:'已確認',in_progress:'處理中',resolved:'已解決',wontfix:'暫不處理',duplicate:'重複回報'};
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
  const form=el('form','',card,'fb-form');form.noValidate=true;
  const kind=el('select','',null);for(const [k,v] of Object.entries(KIND)){const o=el('option',v,kind);o.value=k;}
  const wanted=params.get('kind');if(KIND[wanted])kind.value=wanted;
  field(form,'回報類型',kind);
  const page=el('input','',null);page.type='text';page.maxLength=200;page.setAttribute('list','fb-pages');page.autocomplete='off';
  const wantedPage=(params.get('page')||'').slice(0,200);if(/^[A-Za-z0-9_./?=&%#-]+$/.test(wantedPage))page.value=wantedPage;
  const list=el('datalist','',form);list.id='fb-pages';for(const p of PAGES){const o=el('option','',list);o.value=p;}
  field(form,'發生在哪一頁（可略）',page,'可填頁面檔名，例如 math.html；也可以留空。');
  const title=el('input','',null);title.type='text';title.maxLength=120;title.required=true;field(form,'標題（3–120 字）',title);
  const body=el('textarea','',null);body.rows=6;body.maxLength=3000;body.required=true;
  field(form,'說明（10–3000 字）',body,'請寫下你做了什麼、預期看到什麼、實際看到什麼。請不要貼上密碼或學生個資。');
  const count=el('small','0／3000',form,'fb-count');body.addEventListener('input',()=>{count.textContent=body.value.length+'／3000';});
  el('p','送出時會自動附上瀏覽器與螢幕寬度，方便重現問題；不會附上其他個人資料。回報內容只有管理員看得到，你可以在下方追蹤處理進度。',form,'fb-note');
  const submit=el('button','送出回報',form);submit.type='submit';submit.className='button';
  form.addEventListener('submit',async e=>{
   e.preventDefault();if(busy)return;
   if(title.value.trim().length<3||body.value.trim().length<10){say('請填寫標題（至少 3 字）與說明（至少 10 字）。',true);return;}
   busy=true;submit.disabled=true;say('送出中…');
   try{
    const info=(navigator.userAgent||'').slice(0,140)+' · '+innerWidth+'px';
    const r=await timed(client.rpc('rise_submit_feedback',{p_kind:kind.value,p_page:page.value,p_title:title.value,p_body:body.value,p_client_info:info}));
    if(r.error)throw r.error;
    say('已收到，謝謝你。處理進度會顯示在下方「我的回報」。');title.value='';body.value='';count.textContent='0／3000';
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
   const head=el('div','',li,'fb-item-head');el('strong',r.title,head);
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
 const adminState={filter:'open',items:[],summary:null};
 function metric(parent,label,value,warn){const d=el('div','',parent,'admin-metric'+(warn&&value>0?' fb-warn':''));el('strong',String(value),d);el('span',label,d);}
 function renderAdmin(){
  root.replaceChildren();
  const s=adminState.summary;
  const top=el('section','',root,'auth-card fb-card');
  el('h2','今日彙整',top);
  if(s){
   const m=el('div','',top,'admin-metrics');
   metric(m,'新收集（自上次寄出彙整）',s.new_count);metric(m,'未處理',s.untriaged);metric(m,'未結案合計',s.open_total);
   metric(m,'高優先未結案',s.high_open,true);metric(m,'超過 3 天未處理',s.stale_untriaged,true);metric(m,'本期已解決',s.resolved_in_window);
   if(s.repeat_pages.length){
    el('h3','同頁重複回報（建議合併處理）',top);const ul=el('ul','',top,'fb-list');
    for(const g of s.repeat_pages)el('li',g.page+'（'+KIND[g.kind]+'）'+g.count+' 則：'+(g.titles||[]).join('；'),ul);
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
  const sel=el('select','',null);for(const [v,l] of [['open','未結案'],['new','未處理'],['resolved','已解決'],['wontfix','暫不處理'],['duplicate','重複回報'],['','全部']]){const o=el('option',l,sel);o.value=v;}
  sel.value=adminState.filter;const w=el('label','',filters);el('span','顯示',w);w.append(sel);
  sel.onchange=()=>{adminState.filter=sel.value;loadAdmin();};
  if(!adminState.items.length){el('p','這個條件下沒有回報。',list);return;}
  const ul=el('ul','',list,'fb-list');
  for(const r of adminState.items){
   const li=el('li','',ul,'fb-item');
   const head=el('div','',li,'fb-item-head');el('strong',r.title,head);el('span',STATUS[r.status],head,'fb-badge fb-'+r.status);
   el('p',KIND[r.kind]+(r.page?' · '+r.page:'')+' · '+r.submitter+' · '+when(r.created_at)+(r.similar_open?' · 同頁還有 '+r.similar_open+' 則':''),li,'fb-meta');
   el('p',r.body,li,'fb-body');if(r.client_info)el('p','環境：'+r.client_info,li,'fb-meta');
   const f=el('form','',li,'fb-triage');
   const st=el('select','',null);for(const [v,l] of Object.entries(STATUS)){const o=el('option',l,st);o.value=v;}st.value=r.status;field(f,'狀態',st);
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
   const [list,sum]=await Promise.all([timed(client.rpc('rise_admin_feedback',{p_status:adminState.filter})),timed(client.rpc('rise_admin_feedback_summary'))]);
   if(ticket!==loadTicket)return;
   if(list.error)throw list.error;if(sum.error)throw sum.error;
   adminState.items=list.data||[];adminState.summary=sum.data;renderAdmin();if(!quiet)say('');
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
