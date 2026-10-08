/* Site publication/availability controls. Existing RLS remains authoritative for data access. */
(() => {
 'use strict';
 const catalog=[
  ['science','科學探索與教材','數學、物理、化學及教材閱讀／管理'],
  ['videos','影音探索','影片清單與影片播放頁'],
  ['questions','學生提問與待答','學生提問、提問練習與教學人員待答工作台'],
  ['modules','單元教材與習作','多層次單元與習作'],
  ['assignments','作業與批閱','作業指派、學生提交與批閱'],
  ['discussions','討論題公告','公告閱讀、討論與教師發布'],
  ['competitions','提問競賽','投稿、競賽管理與評審'],
  ['gallery','得獎作品展覽','已授權公開的競賽成果'],
  ['dialogues','對談提問徵集','活動前摘要提交與評選'],
  ['yearbook','數思年鑑','對談影音、文字稿與學者解答'],
  ['ta_training','助教培訓認證','培訓課程與認證申請'],
  ['ta_forum','月度助教論壇','教學人員交流'],
  ['plc','教師共備社群','教案與學習案例分享'],
  ['club_grants','社團補助','申請與審核流程'],
  ['learning_report','學習紀錄與成效','學生個人紀錄與教師課程分析'],
  ['schedule','重要日程','活動日曆與日程入口']
 ];
 const routes={science:['science.html','math.html','physics.html','chemistry.html'],videos:['explore.html','video-detail.html'],questions:['questions.html','staff-questions.html','inquiry.html'],modules:['modules.html','learning.html'],assignments:['assignments.html'],discussions:['discussions.html'],competitions:['competitions.html'],gallery:['competition-gallery.html'],dialogues:['dialogues.html'],yearbook:['yearbook.html'],ta_training:['ta-training.html'],ta_forum:['ta-forum.html'],plc:['plc.html'],club_grants:['club-grants.html'],learning_report:['learning-report.html'],schedule:['schedule.html']};
 let status='loading',flags={},version=null,admin=false,client=null,seq=0,identityEpoch=0;
 const base=new URL('./',location.href),names={...Object.fromEntries(catalog.map(([k,v])=>[k,v])),staff_home:'教學工作台',resources_home:'教學資源'};
 const composites={staff_home:['questions','science','discussions'],resources_home:['science','yearbook','gallery','dialogues']};
 function keyFor(href){
  try{const u=new URL(href,location.href);if(u.origin!==base.origin||new URL('./',u).pathname!==base.pathname)return null;
   const page=u.pathname.split('/').pop();
   if(page==='resources.html')return u.searchParams.has('id')||u.searchParams.has('destination')?'science':'resources_home';
   if(page==='support.html')return 'staff_home';
   return Object.keys(routes).find(k=>routes[k].includes(page))||null;
  }catch{return null;}
 }
 const available=key=>!key||admin||status==='missing'||(composites[key]?composites[key].some(available):status==='ready'&&flags[key]===true);
 function accept(data){
  if(!data||!Number.isSafeInteger(data.version)||!data.flags||catalog.some(([key])=>typeof data.flags[key]!=='boolean'))throw Error('Invalid feature settings');
  flags={...data.flags};version=data.version;admin=data.is_admin===true;status='ready';
 }
 function changed(){scan();window.dispatchEvent(new Event('rise-features-change'));}
 async function refresh(){
  const ticket=++seq;
  try{
   let result;
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
   try{
    if(client)result=await client.rpc('rise_site_features').abortSignal(controller.signal);
    else{const cfg=window.RISE_AUTH_CONFIG||{};
     const response=await fetch((cfg.url||'').replace(/\/$/,'')+'/rest/v1/rpc/rise_site_features',{method:'POST',headers:{apikey:cfg.publishableKey||'','Content-Type':'application/json'},body:'{}',signal:controller.signal,cache:'no-store'});
     const data=await response.json();result=response.ok?{data}:{error:data};
    }
   }finally{clearTimeout(timer);}
   if(ticket!==seq)return;
   if(result.error)throw result.error;accept(result.data);
  }catch(e){if(ticket!==seq)return;admin=false;status=['PGRST202','42883'].includes(e.code)?'missing':'error';}
  changed();
 }
 function connect(){
  const next=window.RISE_NAV_CLIENT;if(!next||next===client)return;
  client=next;admin=false;
  client.auth.onAuthStateChange(()=>{++seq;++identityEpoch;admin=false;changed();setTimeout(()=>refresh(),0);});
  refresh();
 }
 function scan(){
  document.querySelectorAll('a[href]').forEach(a=>{const key=keyFor(a.getAttribute('href'));a.classList.toggle('rise-feature-hidden',!!key&&!available(key));});
  document.querySelectorAll('[data-site-feature]').forEach(el=>el.classList.toggle('rise-feature-hidden',!available(el.dataset.siteFeature)));
  document.querySelectorAll('[data-site-feature-any]').forEach(el=>el.classList.toggle('rise-feature-hidden',!el.dataset.siteFeatureAny.split(' ').some(available)));
  document.querySelectorAll('.video-card').forEach(el=>el.classList.toggle('rise-feature-hidden',!available('videos')));
  document.querySelectorAll('.rise-nav-group').forEach(group=>{
   const links=[...group.querySelectorAll('a[href]')];group.classList.toggle('rise-feature-hidden',links.length>0&&links.every(a=>a.hidden||a.classList.contains('rise-feature-hidden')));
  });
  const main=document.querySelector('main'),key=keyFor(location.href);if(!main||!key)return;
  const blocked=!available(key);
  main.classList.toggle('rise-area-main-hidden',blocked);main.inert=blocked;
  let gate=document.getElementById('site-feature-gate');
  if(!gate){gate=document.createElement('section');gate.id='site-feature-gate';gate.className='rise-feature-gate';main.before(gate);}
  const closed=composites[key]?composites[key].every(k=>flags[k]===false):flags[key]===false;
  const mode=blocked?status==='loading'?'loading':status==='error'?'error':'closed':admin&&closed?'preview':'open';
  if(gate.dataset.mode===mode)return;
  gate.dataset.mode=mode;gate.hidden=mode==='open';gate.replaceChildren();
  if(mode==='open')return;
  const h=document.createElement('h1'),p=document.createElement('p');
  h.textContent=mode==='preview'?'管理員預覽':mode==='loading'?'正在確認開放狀態':mode==='error'?'暫時無法確認開放狀態':names[key]+'尚未開放';
  if(mode==='preview'){h.remove();p.textContent='管理員預覽：此區尚未對外開放，你仍可準備內容。';gate.append(p);return;}
  p.textContent=mode==='error'?'請重試或稍後再回來；會員中心與登入功能仍可使用。':mode==='loading'?'請稍候。':'此區正在籌備中。已提交的資料會保留，開放後可繼續使用。';gate.append(h,p);
  const home=document.createElement('a');home.href='index.html';home.textContent='返回首頁';gate.append(home);
  const account=document.createElement('a');account.href='account.html';account.textContent='會員中心';gate.append(account);
  const retry=document.createElement('button');retry.type='button';retry.textContent='重新確認';retry.onclick=()=>refresh();gate.append(retry);
 }
 window.RISE_FEATURES={catalog,keyFor,available,refresh,
  get state(){return {status,flags:{...flags},version,admin};},
  async save(changes,expectedVersion){
   if(!client)throw Error('尚未登入管理員帳號。');
   const epoch=identityEpoch;
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
   let result;
   try{result=await client.rpc('rise_set_site_features',{p_changes:changes,p_version:expectedVersion}).abortSignal(controller.signal);}
   finally{clearTimeout(timer);}
   if(result.error)throw result.error;
   if(epoch!==identityEpoch||result.data.version<version){await refresh();return this.state;}
   ++seq;accept(result.data);changed();return this.state;
  }
 };
 window.addEventListener('rise-nav-client',connect);
 window.addEventListener('focus',()=>refresh());
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
 setInterval(()=>{if(!document.hidden)refresh();},60000);
 new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
 scan();connect();if(!client)refresh();
})();
