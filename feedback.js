/* RISE 意見與修正回報：會員送出頁與管理員彙整頁。權限由資料庫 RPC 驗證，前端只負責顯示。 */
(() => {
 'use strict';
 const mode=document.body.dataset.feedback;
 const root=document.getElementById('feedback-root'),statusEl=document.getElementById('feedback-status');
 if(!root||!['member','admin'].includes(mode))return;
 const KIND={bug:'功能異常',security:'疑似安全問題',suggestion:'改善建議',other:'其他',content:'內容修正'};
 const FORM_KINDS=['bug','security','suggestion','other'];
 const STATUS={new:'未處理',triaged:'已確認',in_progress:'處理中',needs_info:'待補資料',escalated:'轉交管理者',fix_ready:'修正草稿待審閱',awaiting_verification:'已發布待複驗',resolved:'已解決',wontfix:'接受現況',duplicate:'重複回報'};
 const FIX_STATE={queued:'等待排程',attempting:'正在檢查或準備草稿',attempt_failed:'第一次未通過，等待重試',fix_ready:'草稿檢查通過，等待人工審閱',approved:'舊版核准紀錄',rejected:'已退回',published:'已有發布紀錄，待複驗',verified:'已複驗並結案',escalated:'已轉交管理者',needs_info:'待補資料',revoked:'授權已撤銷',cancelled:'已取消'};
 const STOP={two_failures:'連續兩次修正失敗，已停止',page_out_of_scope:'頁面不在草稿範圍',cannot_reproduce:'無法重現問題',ambiguous_or_unknown_target:'正確目的頁有歧義或沒有對應設定',too_many_broken_links:'失效連結過多',inconclusive_reproduction:'無法判定重現結果',not_reproduced_in_browser:'在瀏覽器實際點擊時未重現',rejected_by_admin:'管理者退回',post_publish_verify_failed:'發布後複驗未通過',authorization_revoked:'管理者撤銷授權',repair_lease_expired:'排程執行逾時或設定已變更'};
 const PRIORITY={low:'低',normal:'一般',high:'高'};
 const PAGES=['index.html','about.html','join.html','team.html','schedule.html','science.html','math.html','physics.html','chemistry.html','explore.html','video-detail.html','resources.html','yearbook.html','competition-gallery.html','questions.html','inquiry.html','modules.html','assignments.html','discussions.html','competitions.html','dialogues.html','learning-report.html','ta-training.html','ta-forum.html','plc.html','account.html','login.html','register.html','privacy.html'];
 const REPAIR_PAGES=['join.html','schedule.html'];
 const MISSING=['PGRST202','42883','42P01','PGRST205'];
 let client=null,user=null,busy=false,loadTicket=0,sessionTicket=0,fieldId=0;
 const el=(tag,text,parent,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;if(parent)parent.append(e);return e;};
 const when=v=>v?new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'';
 const say=(text,error)=>{statusEl.textContent=text||'';statusEl.classList.toggle('error',!!error);};
 function explain(e){
  const m=String(e?.message||'');
  if(m.startsWith('rise:'))return m.slice(5);
  if(MISSING.includes(e?.code))return '回報服務尚未完成啟用，請稍後再試或聯絡計畫團隊。';
  if(e?.code==='42501')return '沒有權限執行這項操作，請重新登入後再試。';
  return '操作沒有完成，請確認網路後再試一次。';
 }
 const timed=async(promise)=>{let id;const t=new Promise((_,rej)=>{id=setTimeout(()=>rej(Error('timeout')),15000);});try{return await Promise.race([promise,t]);}finally{clearTimeout(id);}};
 function pageName(value){
  try{const base=new URL('./',location.href),candidate=new URL(value.trim(),base);const name=candidate.pathname.slice(base.pathname.length);
   return candidate.origin===base.origin&&candidate.pathname.startsWith(base.pathname)&&/^[a-zA-Z0-9_-]+\.html$/.test(name)?name:'';
  }catch{return '';}
 }
 function mailLink(parent){const mail=el('a','寄信給管理員',parent);mail.href='mailto:'+(window.RISE_SITE_INFO?.contactEmail||'ytyeh@g.ntu.edu.tw');return mail;}

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
   const row=el('p','',card,'fb-actions');const a=el('a','登入',row,'button');a.href='login.html';mailLink(row);
   return false;
  }
  if(!user.email_confirmed_at){
   const card=el('section','',root,'auth-card');el('h2','請先驗證信箱',card);el('p','驗證信箱後才能送出回報。請到會員中心重新寄送驗證信。',card);
   const a=el('a','前往會員中心',card,'button');a.href='account.html';return false;
  }
  return true;
 }
 function field(parent,label,control,hint){
  const wrap=el('label','',parent,'fb-field');el('span',label,wrap,'fb-label');wrap.append(control);
  if(hint){const note=el('small',hint,wrap,'fb-hint');note.id='fb-hint-'+(++fieldId);control.setAttribute('aria-describedby',note.id);}
  return control;
 }
 function renderMemberForm(card,mine){
  card.replaceChildren();
  const params=new URLSearchParams(location.search);
  el('h2','送出回報',card);
  const warn=el('p','請勿填入密碼、驗證碼、身分證字號或學生個人資料。若發現疑似安全問題，請選「疑似安全問題」並只描述現象，不要貼上帳密或可直接利用的細節；管理者會優先處理。',card,'fb-warning');warn.setAttribute('role','note');
  const form=el('form','',card,'fb-form');form.noValidate=true;
  const kind=el('select','',null);for(const k of FORM_KINDS){const o=el('option',KIND[k],kind);o.value=k;}
  const wanted=params.get('kind');if(FORM_KINDS.includes(wanted))kind.value=wanted;
  field(form,'回報類型',kind);
  const page=el('input','',null);page.type='text';page.maxLength=200;page.setAttribute('list','fb-pages');page.autocomplete='off';
  page.value=pageName(params.get('page')||'');
  const list=el('datalist','',form);list.id='fb-pages';for(const p of PAGES){const o=el('option','',list);o.value=p;}
  field(form,'發生在哪一頁',page,'填本站頁面檔名，例如 math.html。功能異常必填，網址的查詢參數會移除。');
  const title=el('input','',null);title.type='text';title.maxLength=120;field(form,'標題（可略，會自動取描述開頭）',title);
  const body=el('textarea','',null);body.rows=5;body.maxLength=3000;body.required=true;
  field(form,'問題描述（10–3000 字）',body);
  const count=el('small','0／3000',form,'fb-count');body.addEventListener('input',()=>{count.textContent=body.value.length+'／3000';});
  const detail=el('div','',form,'fb-detail');
  const steps=el('textarea','',null);steps.rows=3;steps.maxLength=2000;field(detail,'操作步驟',steps,'你做了哪些步驟？例如：開啟 join.html，點「前往會員中心」。');
  const expected=el('textarea','',null);expected.rows=2;expected.maxLength=1000;field(detail,'預期結果',expected);
  const actual=el('textarea','',null);actual.rows=2;actual.maxLength=1000;field(detail,'實際結果',actual);
  const controls=[page,title,body,steps,expected,actual];
  for(const control of controls)control.addEventListener('input',()=>control.removeAttribute('aria-invalid'));
  const sync=()=>{detail.hidden=kind.value==='suggestion';for(const control of [page,steps,expected,actual])control.required=kind.value==='bug';};kind.addEventListener('change',sync);sync();
  el('p','回報會連結至你的會員帳號。你與管理員可以查看案情，你也可以用案件編號追蹤進度。系統只提交你填寫的欄位與頁面檔名。',form,'fb-note');
  const submit=el('button','送出回報',form);submit.type='submit';submit.className='button';
  form.addEventListener('submit',async e=>{
   e.preventDefault();if(busy)return;
   const k=kind.value,need=k==='bug',reportedPage=pageName(page.value),ticket=sessionTicket;
   for(const control of controls)control.removeAttribute('aria-invalid');
   const invalid=(control,message)=>{control.setAttribute('aria-invalid','true');say(message,true);control.focus();};
   if((need||page.value.trim())&&!reportedPage){invalid(page,'請填本站的頁面檔名，例如 math.html。');return;}
   if(title.value.trim()&&title.value.trim().length<3){invalid(title,'請填寫至少 3 字的標題，或留空。');return;}
   if(body.value.trim().length<10){invalid(body,'請填寫問題描述（至少 10 字）。');return;}
   if(need){const missing=[steps,expected,actual].find(f=>f.value.trim().length<2);if(missing){invalid(missing,'功能異常請填寫操作步驟、預期結果與實際結果。');return;}}
   busy=true;submit.disabled=true;say('送出中…');
   try{
    const hide=k==='suggestion';
    const r=await timed(client.rpc('rise_submit_feedback',{p_kind:k,p_page:reportedPage,p_title:title.value,p_body:body.value,p_steps:hide?'':steps.value,p_expected:hide?'':expected.value,p_actual:hide?'':actual.value,p_client_info:''}));
    if(ticket!==sessionTicket)return;
    if(r.error)throw r.error;
    const res=r.data||{};
    if(typeof res.case_no!=='string'||!res.case_no)throw Error('missing-case-number');
    say('已收到，謝謝你。案件編號：'+res.case_no+'。請保留編號；處理進度會顯示在下方「我的回報」。');
    title.value='';body.value='';steps.value='';expected.value='';actual.value='';count.textContent='0／3000';
    if(res.urgent)notifyUrgent();
    await loadMine(mine);
   }catch(err){if(ticket===sessionTicket)say(explain(err),true);}
   finally{if(ticket===sessionTicket){busy=false;submit.disabled=false;}}
  });
 }
 function renderMine(mineCard,mine){
  mineCard.replaceChildren();el('h2','我的回報',mineCard);
  if(mine===null){el('p','載入中…',mineCard);return;}
  if(mine==='error'){el('p','暫時讀不到你的回報紀錄，請稍後再試。',mineCard);return;}
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
 async function loadMine(mine){
  const ticket=++loadTicket;
  try{
   const r=await timed(client.rpc('rise_my_feedback'));
   if(ticket!==loadTicket)return;
   if(r.error)throw r.error;
   renderMine(mine,r.data||[]);
  }catch{if(ticket===loadTicket)renderMine(mine,'error');}
 }
 async function openMember(ticket){
  if(!memberGate())return;
  const card=el('section','',root,'auth-card fb-card');el('p','正在確認回報服務…',card);
  const mine=el('section','',root,'auth-card fb-card');renderMine(mine,null);loadMine(mine);
  try{
   const result=await timed(client.rpc('rise_feedback_submission_ready'));
   if(ticket!==sessionTicket)return;
   if(result.error)throw result.error;
   if(result.data!==true&&result.data?.ready!==true)throw Error('service-not-ready');
   renderMemberForm(card,mine);
  }catch(err){if(ticket!==sessionTicket)return;card.replaceChildren();el('h2','暫時無法送出回報',card);el('p',explain(err),card);mailLink(card);}
 }

 /* ---------- 管理員：彙整、分類、寄信 ---------- */
 const adminState={filter:'open',items:[],urgent:[],summary:null,repair:null};
 const closedStatuses=['resolved','wontfix','duplicate'];
 const managedStatuses=['fix_ready','awaiting_verification'];
 function metric(parent,label,value,warn){const d=el('div','',parent,'admin-metric'+(warn&&value>0?' fb-warn':''));el('strong',String(value),d);el('span',label,d);}
 async function saveAdminAction(button,name,params,success){
  if(busy)return;
  const ticket=sessionTicket;busy=true;button.disabled=true;say('儲存中…');
  try{
   const result=await timed(client.rpc(name,params));
   if(ticket!==sessionTicket)return;
   if(result.error)throw result.error;
   say(success);await loadAdmin(true);
  }catch(err){if(ticket===sessionTicket)say(explain(err),true);}
  finally{if(ticket===sessionTicket){busy=false;button.disabled=false;}}
 }
 function repairSettings(){
  const card=el('section','',root,'auth-card fb-card fb-repair-settings');el('h2','受限的修正草稿排程',card);
  el('p','預設關閉。開啟後，只處理你逐案授權的 join.html 或 schedule.html 站內失效連結。排程在 GitHub Actions 提供檢查結果與差異檔，由維護者審閱後手動建立 PR、合併和發布。',card,'fb-note');
  if(adminState.repair===null){el('p','目前讀不到排程設定。請先確認回報服務已完成升級；無法在此頁變更或授權。',card,'fb-warning');return;}
  const row=el('div','',card,'fb-actions');
  const enabled=adminState.repair;
  const button=el('button',enabled?'關閉修正草稿排程':'開啟修正草稿排程',row,'button'+(enabled?' secondary':''));button.type='button';
  el('strong',enabled?'排程設定：開啟':'排程設定：關閉',row,enabled?'fb-enabled':'fb-meta');
  button.onclick=()=>{
   if(busy||!confirm(enabled?'關閉修正草稿排程？既有檢查結果與差異檔會保留。':'開啟修正草稿排程？只有明確授權的案件符合資格。'))return;
   saveAdminAction(button,'rise_feedback_set_repair_settings',{p_enabled:!enabled},enabled?'已關閉修正草稿排程。':'已開啟修正草稿排程。');
  };
 }
 function autofixPanel(parent,r){
  const a=r.autofix||{};
  const eligible=!r.urgent&&!r.is_simulation&&r.kind==='bug'&&r.triage_class==='link_candidate'&&REPAIR_PAGES.includes(r.page);
  if(!r.autofix&&!eligible)return;
  const box=el('div','',parent,'fb-autofix');
  const authorized=Boolean(a.authorization);
  el('h4','站內連結修正草稿',box);
  if(a.state)el('p','狀態：'+(FIX_STATE[a.state]||a.state)+'　嘗試次數：'+(a.attempts??0)+'／2'+(a.stop_reason?'　停止原因：'+(STOP[a.stop_reason]||a.stop_reason):'')+(a.is_simulation?'　【模擬案例】':''),box,'fb-meta');
  if(a.link_text)el('p','授權連結文字：'+a.link_text,box,'fb-meta');
  if(a.authorized_at)el('p','授權時間：'+when(a.authorized_at)+(a.authorized_by?'　授權者：'+a.authorized_by:''),box,'fb-meta');
  const b=a.before_result,af=a.after_result;
  if(Array.isArray(b?.expected)){
   el('p','修改前：預期 '+b.expected.map(x=>x.text+' → '+x.lands_on).join('、')+'；實際 '+(b.actual||[]).map(x=>x.text+' → '+(x.landed||'?')+'（'+(x.title||'')+'）').join('、'),box,'fb-body');
  }
  if(Array.isArray(af?.clicks))el('p','修改後：'+af.clicks.map(x=>x.text+' → '+x.landed+'（'+x.title+'）'+(x.ok?' ✓':' ✗')).join('、')+'；靜態檢查 '+(af.static_check?.ok?'通過':'未通過'),box,'fb-body');
  if(Array.isArray(af?.problems))el('p','最近一次未通過：'+af.phase+'：'+af.problems.join('；'),box,'fb-body');
  if(a.branch)el('p','分支：'+a.branch,box,'fb-meta');
  if(a.commit_sha)el('p','提交：'+a.commit_sha,box,'fb-meta');
  if(a.diff_summary){
   el('p','修改檔案：'+(a.diff_summary.files||[]).join('、')+'；變動 '+a.diff_summary.changed_lines+' 行',box,'fb-meta');
   if(a.diff_summary.patch){const d=el('details','',box);el('summary','查看修改差異',d);el('pre',a.diff_summary.patch,d,'fb-patch');}
  }
  if(a.verify_command){el('p','可重跑的檢查：',box,'fb-meta');el('code',a.verify_command,box);}
  if(/^https:\/\/github\.com\/youtingyeh\/RISE\/actions\/runs\/[1-9]\d*$/i.test(a.workflow_run_url||'')){
   const link=el('a','在 GitHub Actions 查看檢查與差異檔',box,'button secondary');link.href=a.workflow_run_url;
   if(/^fix-\d{2}\.patch$/.test(a.workflow_patch_name||''))el('p','差異檔：'+a.workflow_patch_name,box,'fb-meta');
  }else if(a.state==='fix_ready'){
   el('p','本案有草稿檢查紀錄，目前沒有可確認的 GitHub Actions 執行連結。',box,'fb-hint');
  }
  if(authorized&&adminState.repair!==null){
   const revoke=el('button','撤銷本案草稿授權',box,'button secondary');revoke.type='button';
   revoke.onclick=()=>{
    if(busy||!confirm('撤銷 '+r.case_no+' 的修正草稿授權？既有檢查結果與差異檔會保留。'))return;
    saveAdminAction(revoke,'rise_feedback_repair_revoke',{p_feedback:r.id},'已撤銷本案修正草稿授權。');
   };
  }else if(eligible&&['new','triaged'].includes(r.status)&&(a.attempts??0)<2&&!['attempting','published','verified'].includes(a.state)&&adminState.repair!==null){
   const form=el('form','',box,'fb-repair-authorize');
   const linkText=el('input','',null);linkText.type='text';linkText.required=true;linkText.maxLength=160;
   field(form,'要修正的連結文字',linkText,'輸入頁面上的完整連結文字。排程只會依預先設定的目的頁核對。');
   const button=el('button','授權本案準備草稿',form,'button secondary');button.type='submit';
   form.onsubmit=event=>{
    event.preventDefault();if(busy)return;
    const label=linkText.value.trim();
    if(!label){say('請填寫完整連結文字。',true);linkText.focus();return;}
    if(!confirm('授權排程檢查 '+r.case_no+' 的站內連結「'+label+'」並準備草稿？'))return;
    saveAdminAction(button,'rise_feedback_repair_authorize',{p_feedback:r.id,p_link_text:label},adminState.repair?'已授權本案準備草稿。':'已授權本案，排程目前仍關閉。');
   };
  }
 }
 function renderAdmin(){
  root.replaceChildren();
  const s=adminState.summary;
  if(adminState.urgent.length){
   const ub=el('section','',root,'auth-card fb-card fb-urgent');ub.setAttribute('role','alert');
   el('h2','待優先處理：疑似安全、登入、角色權限、個資或資料遺失（'+adminState.urgent.length+' 則）',ub);
   el('p','這些案件由管理者處理。私人通知以實際收信為準；請優先查看本區。',ub,'fb-note');
   const ul=el('ul','',ub,'fb-list');for(const r of adminState.urgent){const li=el('li','',ul);li.textContent=r.case_no+'　'+KIND[r.kind]+'　'+(r.is_simulation?'【模擬案例】':'')+r.title+'（'+STATUS[r.status]+'，'+when(r.created_at)+'）';}
   const see=el('button','只顯示緊急案件',ub);see.type='button';see.onclick=()=>{adminState.filter='urgent';loadAdmin();};
  }
  repairSettings();
  const top=el('section','',root,'auth-card fb-card');
  el('h2','今日彙整',top);
  if(s){
   const m=el('div','',top,'admin-metrics');const bk=s.buckets||{};
   metric(m,'新增（自上次寄出彙整）',bk.new??s.new_count);metric(m,'待補資料',bk.needs_info??0);metric(m,'處理中',bk.in_progress??0);
   metric(m,'轉交管理者',bk.escalated??0,true);metric(m,'待審閱／複驗',bk.awaiting_verification??0);metric(m,'已結案（本期）',bk.closed??s.resolved_in_window);
   metric(m,'緊急未結案',s.urgent_open??0,true);metric(m,'超過 3 天未處理',s.stale_untriaged,true);metric(m,'未結案合計',s.open_total);
   if(s.repeat_pages?.length){
    el('h3','同頁重複回報（建議合併處理）',top);const ul=el('ul','',top,'fb-list');
    for(const g of s.repeat_pages)el('li',g.page+'（'+KIND[g.kind]+'）'+g.count+' 則：'+(g.titles||[]).join('；')+((g.case_nos||[]).length?'（'+g.case_nos.join('、')+'）':''),ul);
   }
  }
  const actions=el('p','',top,'fb-actions');
  const send=el('button','立即寄出今日彙整信',actions);send.type='button';send.className='button';
  el('span','收件人由系統設定。每日排程有新回報時才寄信；如需檢查寄信，可以手動提出寄送要求。',actions,'fb-hint');
  send.onclick=async()=>{
   if(busy)return;const ticket=sessionTicket;busy=true;send.disabled=true;say('寄送中…');
   try{
    const {data}=await client.auth.getSession();const cfg=window.RISE_AUTH_CONFIG||{};
    const res=await timed(fetch(cfg.url.replace(/\/$/,'')+'/functions/v1/rise-feedback-digest',{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,apikey:cfg.publishableKey,'Content-Type':'application/json'},body:'{}'}));
    const out=await res.json().catch(()=>({}));
    if(ticket!==sessionTicket)return;
    if(res.ok&&out.sent)say('已寄出 '+out.day+' 的彙整信：新 '+out.new_count+' 則、未結案 '+out.open_total+' 則。');
    else if(res.ok)say(out.reason||'今日彙整已寄出。');
    else say(out.error||'寄送沒有完成。',true);
   }catch{if(ticket===sessionTicket)say('寄送沒有完成：請確認彙整信服務已部署，並確認網路。',true);}
   finally{if(ticket===sessionTicket){busy=false;send.disabled=false;}}
  };
  const list=el('section','',root,'auth-card fb-card');
  el('h2','回報清單',list);
  const filters=el('div','',list,'admin-filters');
  const sel=el('select','',null);for(const [v,l] of [['open','未結案'],['urgent','緊急待處理'],['new',STATUS.new],['needs_info',STATUS.needs_info],['escalated',STATUS.escalated],['fix_ready',STATUS.fix_ready],['awaiting_verification',STATUS.awaiting_verification],['resolved',STATUS.resolved],['wontfix',STATUS.wontfix],['duplicate',STATUS.duplicate],['','全部']]){const o=el('option',l,sel);o.value=v;}
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
   autofixPanel(li,r);
   const f=el('form','',li,'fb-triage');
   const st=el('select','',null);
   for(const [v,l] of Object.entries(STATUS)){
    if(v!==r.status&&(managedStatuses.includes(v)||(managedStatuses.includes(r.status)&&!['resolved','wontfix'].includes(v))))continue;
    const o=el('option',l,st);o.value=v;
   }
   st.value=r.status;field(f,'狀態',st,'人工確認修正已生效後，可標記已解決；決定保留現狀時，可選接受現況。');
   const pr=el('select','',null);for(const [v,l] of Object.entries(PRIORITY)){const o=el('option',l,pr);o.value=v;}pr.value=r.priority;field(f,'優先順序',pr);
   const dup=el('select','',null);const none=el('option','（不是重複）',dup);none.value='';
   for(const o of adminState.items.filter(x=>x.id!==r.id)){const op=el('option',o.title.slice(0,40),dup);op.value=o.id;}
   dup.value=r.duplicate_of||'';field(f,'重複於',dup);
   const note=el('textarea','',null);note.rows=2;note.maxLength=2000;note.value=r.admin_note;field(f,'內部備註（只有管理員看得到）',note);
   const reply=el('textarea','',null);reply.rows=2;reply.maxLength=1000;reply.value=r.public_reply;field(f,'回覆給回報者（對方可見）',reply);
   const save=el('button','儲存',f);save.type='submit';
   f.onsubmit=async e=>{
    e.preventDefault();if(busy)return;
    if(st.value!==r.status&&closedStatuses.includes(st.value)&&!confirm('將 '+r.case_no+' 結案，狀態設為「'+STATUS[st.value]+'」？'))return;
    saveAdminAction(save,'rise_admin_triage_feedback',{p_id:r.id,p_status:st.value,p_priority:pr.value,p_admin_note:note.value,p_public_reply:reply.value,p_duplicate_of:st.value==='duplicate'?(dup.value||null):null},'已儲存。');
   };
  }
 }
 async function loadAdmin(quiet){
  const ticket=++loadTicket;if(!quiet)say('載入中…');
  try{
   const [list,sum,urgent,settings]=await Promise.all([timed(client.rpc('rise_admin_feedback',{p_status:adminState.filter})),timed(client.rpc('rise_admin_feedback_summary')),timed(client.rpc('rise_admin_feedback',{p_status:'urgent'})),timed(client.rpc('rise_feedback_get_repair_settings')).catch(()=>null)]);
   if(ticket!==loadTicket)return;
   if(list.error)throw list.error;if(sum.error)throw sum.error;if(urgent.error)throw urgent.error;
   adminState.items=list.data||[];adminState.urgent=urgent.data||[];adminState.summary=sum.data;
   adminState.repair=!settings?.error&&typeof settings?.data?.enabled==='boolean'?settings.data.enabled:null;
   renderAdmin();if(!quiet)say('');
  }catch(err){if(ticket!==loadTicket)return;root.replaceChildren();say(err?.code==='42501'?'只有已驗證的管理員可以使用這一頁。':explain(err),true);}
 }

 let viewStarted=false;
 function setUser(next){
  if(viewStarted&&user?.id===next?.id&&Boolean(user?.email_confirmed_at)===Boolean(next?.email_confirmed_at))return;
  user=next;viewStarted=true;const ticket=++sessionTicket;++loadTicket;busy=false;root.replaceChildren();say('');
  if(mode==='member')openMember(ticket);
  else if(!user||!user.email_confirmed_at)say('請先以已驗證信箱的管理員帳號登入。',true);
  else loadAdmin();
 }
 function start(c){
  client=c;
  const refresh=async()=>{
   const ticket=sessionTicket;
   try{const {data}=await timed(client.auth.getUser());if(ticket===sessionTicket)setUser(data?.user||null);}
   catch{if(ticket===sessionTicket)setUser(null);}
  };
  client.auth.onAuthStateChange?.((event)=>{
   if(event==='SIGNED_OUT')setUser(null);
   else if(event==='SIGNED_IN'||event==='USER_UPDATED')setTimeout(refresh,0);
  });
  refresh();
 }
 let started=false;
 const go=()=>{if(!started&&window.RISE_NAV_CLIENT){started=true;start(window.RISE_NAV_CLIENT);}};
 window.addEventListener('rise-nav-client',go);go();
 setTimeout(()=>{if(!started){root.replaceChildren();say('無法連線到帳號服務，請重新整理頁面。',true);}},12000);
})();
