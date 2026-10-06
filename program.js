'use strict';
window.RISE_PROGRAM=async function({client,user,profile,root,report}){
 const area=document.body.dataset.program,role=profile.role,admin=role==='admin',teacher=['teacher','admin'].includes(role),staff=['ta','teacher','admin'].includes(role);
 let alive=true;client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||(user&&session?.user&&session.user.id!==user.id)){alive=false;root.replaceChildren();}});
 const el=(tag,value,parent=root)=>{const n=document.createElement(tag);if(value!==null)n.textContent=value;parent.append(n);return n;};
 const section=(title,desc,parent=root)=>{const n=el('section',null,parent);n.className='auth-card';el('h2',title,n);if(desc)el('p',desc,n);return n;};
 const fail=e=>alive&&report(['PGRST202','42P01','42703'].includes(e.code)?'此功能尚未啟用，請管理員依 backend/program/README.md 完成後端更新。':String(e.message||e).replace(/^rise:/,''),true);
 const rpc=async(action,data={},module=false)=>{const r=await client.rpc(module?'rise_module_api':'rise_program_api',{p_action:action,p_data:data});if(r.error)throw r.error;if(!alive)throw Error('登入狀態已變更。');return r.data;};
 const link=(parent,label,url)=>{try{const u=new URL(url,location.href);if(u.protocol!=='https:'&&u.origin!==location.origin)return;const a=el('a',label,parent);a.href=u.href;a.rel='noopener noreferrer';a.target='_blank';}catch{}};
 const button=(parent,label,fn)=>{const b=el('button',label,parent);b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){fail(e);}finally{b.disabled=false;}};return b;};
 function form(parent,specs,label,fn,initial={}){
  const f=el('form',null,parent),inputs={};for(const spec of specs){const [name,title,type='textarea',opts=null,optional=false]=spec;const l=el('label',title,f);l.className='auth-field';l.style.display='block';const n=el(type==='select'?'select':type==='textarea'?'textarea':'input',null,l);inputs[name]=n;n.name=name;if(type==='select'){for(const [v,t] of opts||[]){const o=el('option',t,n);o.value=v;}}else if(type!=='textarea')n.type=type;if(type==='textarea'){n.rows=4;n.maxLength=30000;}if(type==='checkbox')n.checked=Boolean(initial[name]);else n.value=initial[name]??(type==='select'?opts?.[0]?.[0]||'':'');n.required=!optional&&type!=='checkbox';}
  const save=el('button',label,f);save.type='submit';const status=el('p','',f);status.setAttribute('role','status');
  f.onsubmit=async e=>{e.preventDefault();if(!alive||save.disabled)return;save.disabled=true;status.textContent='正在儲存…';try{const values=Object.fromEntries(Object.entries(inputs).map(([k,n])=>[k,n.type==='checkbox'?n.checked:n.value.trim()]));await fn(values,f);status.textContent='已儲存。';report('已儲存。');}catch(e){status.textContent='未能儲存，輸入已保留。';fail(e);}finally{save.disabled=false;}};return f;
 }
 function editor(parent,title,build){button(parent,'＋ '+title,async()=>{const dialog=el('dialog',null,parent);dialog.className='program-dialog';el('h2',title,dialog);button(dialog,'關閉',()=>{dialog.close();dialog.remove();});await build(dialog);dialog.showModal();});}
 const feedback=[['analysis','思路分析'],['improvement','改進建議'],['followup','延伸提問']];
 const stateName={pending:'待審核',approved:'已核准',returned:'退回補件',rejected:'未核准'};
 const nowMonth=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}).slice(0,7);
 async function modules(){
  const data=await rpc('list',{},true);if(!alive)return;root.replaceChildren();
  el('p','每個單元包含核心講義、延伸閱讀、挑戰題庫與 3–5 題過程導向習作。開啟單元會記錄學習進度；完成習作與教師評定通過分開計算。');
  if(teacher)editor(root,'新增三層教材單元',async parent=>{
   const access=await client.rpc('rise_teacher_access',{p_action:'self',p_data:{}});if(access.error)throw access.error;
   const opts=[...(access.data.scope==='all'?[['','所有學生']]:[]),...access.data.courses.map(c=>[c.id,c.title])];if(!opts.length){el('p','請先由管理員授予任教課程。',parent);return;}
   const fields=[['course_id','適用課程','select',opts],['title','單元名稱','text'],['minutes','預估課程時間（1–30 分鐘）','number'],['core','核心講義'],['reading','延伸閱讀'],['challenge','挑戰題庫'],...Array.from({length:5},(_,i)=>['exercise'+i,'練習題 '+(i+1)+(i>2?'（選填）':''),'textarea',null,i>2]),['visual_url','GeoGebra／Desmos／PhET 視覺化工具網址','url',null,true],['published','立即發布','checkbox']];
   const f=form(parent,fields,'建立單元',async v=>{await rpc('save',{...v,exercises:Array.from({length:5},(_,i)=>v['exercise'+i]).filter(Boolean)},true);parent.close();await modules();},{minutes:20});f.elements?.namedItem('minutes')?.setAttribute('max','30');
  });
  if(!data.items.length)el('p','目前沒有已發布的單元。');
  for(const unit of data.items){const card=section(unit.title+(unit.published?'':'（草稿）'),unit.minutes+' 分鐘 · '+unit.exercises.length+' 題練習');if(teacher&&(admin||unit.owner_id===user.id))button(card,unit.published?'下架單元':'發布單元',async()=>{await rpc('state',{id:unit.id,published:!unit.published},true);await modules();});button(card,'開始單元／查看學習歷程',async()=>{
   await rpc('open',{id:unit.id},true);const detail=await rpc('detail',{id:unit.id},true);card.querySelector('[data-unit-detail]')?.remove();const view=section(unit.title,'',card);view.dataset.unitDetail='';
   for(const [key,title] of [['core','核心講義'],['reading','延伸閱讀'],['challenge','挑戰題庫']]){el('h3',title,view);el('p',unit[key],view).style.whiteSpace='pre-wrap';}
   const visual=section('視覺化探索','',view);if(unit.visual_url)link(visual,'開啟互動工具 ↗',unit.visual_url);else el('p','此單元尚未加入互動工具；教師可搭配即時繪圖或模擬示範。',visual);
   const own=detail.submissions.filter(s=>s.student_id===user.id),latest=own[0];
   if(role==='student'&&unit.published)form(view,[...unit.exercises.map((q,i)=>['answer'+i,'第 '+(i+1)+' 題：'+q]),['change_note','本次修改說明','textarea',null,!latest]],latest?'提交習作新版本':'提交完整習作',async v=>{await rpc('submit',{id:unit.id,expected_version:latest?.version||0,answers:unit.exercises.map((_,i)=>v['answer'+i]),change_note:v.change_note},true);await modules();},Object.fromEntries((latest?.answers||[]).map((v,i)=>['answer'+i,v])));
   for(const s of detail.submissions){const h=section((s.student_name||'學生')+' · 習作第 '+s.version+' 版 · '+new Date(s.created_at).toLocaleString('zh-TW'),s.change_note,view);s.answers.forEach((a,i)=>el('p','第 '+(i+1)+' 題：'+a,h));const reviews=detail.reviews.filter(g=>g.practice_id===s.id);for(const g of reviews){el('strong',g.passed?'批閱結果：通過':'批閱結果：請修訂',h);feedback.forEach(([k,t])=>el('p',t+'：'+g[k],h));}if(teacher&&!reviews.some(g=>g.reviewer_id===user.id))form(h,[...feedback,['passed','評定結果','select',[['false','請修訂'],['true','通過']]]],'提交批閱',async v=>{await rpc('review',{id:s.id,...v,passed:v.passed==='true'},true);await modules();});}
  });}
 }
 async function events(){
  const items=await rpc('events');if(!alive)return;root.replaceChildren();
  if(teacher)editor(root,'建立大師講堂／青年論壇徵集',parent=>form(parent,[['title','活動名稱','text'],['kind','活動類型','select',[['master','理學大師講堂'],['youth','青年學者論壇']]],['body','活動內容與提問指引'],['deadline','提問截止時間','datetime-local']],'發布徵集',async v=>{await rpc('event_save',{...v,deadline:new Date(v.deadline).toISOString()});parent.close();await events();}));
  if(!items.length)el('p','目前沒有開放的活動徵集。');
  for(const item of items){const card=section(item.title,item.body+'\n截止：'+new Date(item.deadline).toLocaleString('zh-TW'));button(card,'查看活動與提交摘要',async()=>{
   const data=await rpc('event_detail',{id:item.id});card.querySelector('[data-event-detail]')?.remove();const view=section('提問摘要與評選','',card),own=data.questions.filter(q=>q.student_id===user.id),latest=own[0];view.dataset.eventDetail='';
   if(role==='student'&&new Date(item.deadline)>new Date())form(view,[['summary','問題摘要、背景與想請教學者的內容'],['public_consent','同意入選問題於活動現場公開朗讀（非必要）','checkbox']],'提交摘要版本',async v=>{await rpc('event_submit',{id:item.id,expected_version:latest?.version||0,...v});await events();},{summary:latest?.summary||'',public_consent:latest?.public_consent||false});
   for(const q of data.questions){const h=section('提問第 '+q.version+' 版',q.summary,view),s=data.selections.find(s=>s.question_id===q.id);el('p',q.public_consent?'同意現場公開':'尚未同意現場公開，需另行確認',h);if(s)el('p',(s.selected?'入選':'未入選')+'：'+s.note,h);else if(teacher&&(admin||item.owner_id===user.id)&&!data.questions.some(n=>n.student_id===q.student_id&&n.version>q.version))form(h,[['selected','評選決定','select',[['true','入選'],['false','未入選']]],['note','評選理由與建議']],'保存評選',async v=>{await rpc('event_select',{id:q.id,...v,selected:v.selected==='true'});await events();});}
  });}
 }
 async function community(){
  const isTA=area==='ta_forum';if(!(isTA?staff:teacher)){root.textContent='此社群限核准的教學人員使用。';return;}
  root.replaceChildren();const filter=el('label',isTA?'月份':'篩選月份'),month=el('input',null,filter);month.type='month';month.value=nowMonth();const list=el('div',null);
  async function draw(){const items=await rpc('posts',{area,month:month.value?month.value+'-01':''});list.replaceChildren();if(!items.length)el('p','此月份尚無分享，可建立新主題。',list);for(const post of items){const card=section(post.title,post.body,list);el('p',post.month+' · '+(post.school||'未填學校'),card);if(post.resource_url)link(card,'開啟分享教材 ↗',post.resource_url);button(card,'參與討論',async()=>{const replies=await rpc('replies',{id:post.id}),thread=section('交流與回饋','',card);for(const reply of replies)el('p',reply.body,thread);form(thread,[['body','回覆內容']],'送出回覆',async v=>{await rpc('reply',{id:post.id,...v});await draw();});});}}
  month.onchange=()=>draw().catch(fail);
  editor(root,isTA?'新增月度助教論壇主題':'分享教案／學習案例',parent=>form(parent,[['month','交流月份','month'],['title','分享主題','text'],['kind','分享類型','select',[['experience','教學經驗'],['lesson','教案'],['case','學習案例']]],['school','學校／單位','text',null,true],['body','教案、案例或教學反思'],['resource_url','教材或檔案分享連結（HTTPS）','url',null,true],['anonymized','確認已移除學生個資並取得分享授權','checkbox']],'發布分享',async v=>{await rpc('post_save',{...v,area,month:v.month+'-01'});parent.close();await draw();},{month:nowMonth()}));await draw();
 }
 async function clubs(){if(!teacher){root.textContent='社團補助由教師提出，管理員審核。';return;}const items=await rpc('clubs');root.replaceChildren();el('p','申請送出後由管理員審核。網站核准不代表款項已撥付；實際補助額度與核銷依正式公告辦理。');
  editor(root,'申請數思社／理學思維社補助',parent=>form(parent,[['school','學校名稱','text'],['club','社團類別','select',[['數思社','數思社'],['理學思維社','理學思維社']]],['plan','活動目的、時程、預期成果與經費明細'],['budget','申請金額（新臺幣）','number']],'送出補助申請',async v=>{await rpc('club_submit',v);parent.close();await clubs();}));
  for(const item of items){const card=section(item.school+' · '+item.club,item.plan);el('p','申請金額：NT$ '+item.budget+' · '+stateName[item.status],card);if(item.review_note)el('p','審核意見：'+item.review_note,card);if(admin&&item.applicant_id!==user.id&&item.status==='pending')form(card,[['status','審核決定','select',[['returned','退回補件'],['approved','核准'],['rejected','未核准']]],['note','審核意見']],'儲存審核',async v=>{await rpc('club_review',{id:item.id,...v});await clubs();});}
 }
 async function publication(){if(!admin){root.textContent='此頁僅限管理員使用。';return;}root.replaceChildren();
  editor(root,'新增年鑑與開放教育資源',parent=>form(parent,[['year','年鑑年度','number'],['title','標題','text'],['kind','內容類別','select',[['dialogue','對談影片'],['transcript','文字稿'],['question','優秀提問'],['answer','學者解答'],['reading','延伸閱讀']]],['body','文字內容／摘要'],['url','影片或原始資料連結','url',null,true],['attribution','作者、來源及授權說明'],['license','開放授權','select',[['CC BY 4.0','CC BY 4.0'],['CC BY-SA 4.0','CC BY-SA 4.0'],['CC0','CC0']]],['rights_confirmed','確認已取得文字、影音及引用問題的公開與開放授權','checkbox'],['published','立即公開','checkbox']],'保存年鑑資源',async v=>{await rpc('oer_save',v);parent.close();await publication();},{year:new Date().getFullYear()}));
  for(const item of await rpc('oer_admin')){const card=section(item.title,item.published?'已公開':'草稿');button(card,item.published?'下架':'發布',async()=>{await rpc('oer_save',{id:item.id,published:!item.published});await publication();});}
  const awards=section('得獎作品展覽管理','只列出已結賽的最新作品；必須取得投稿者公開同意才能發布。');
  for(const item of await rpc('award_candidates')){const card=section(item.competition+' · '+item.title,item.division+'／'+item.field,awards);if(!item.consent){el('p','尚未取得公開同意，不能發布。',card);continue;}form(card,[['award','獎項名稱','text'],['published','公開展示','checkbox']],'儲存展覽設定',async v=>{await rpc('award_save',{id:item.id,...v});await publication();},{award:item.award||'',published:item.published||false});}
 }
 async function publicPage(){const items=await rpc(area==='awards'?'awards_public':'oer_public');root.replaceChildren();if(!items.length)el('p','目前尚未有正式發布的內容。');for(const item of items){const card=section((item.year?item.year+' · ':'')+item.title,item.body);if(area==='awards'){el('p',item.competition+' · '+item.award+' · '+item.division+'／'+item.field,card);for(const [k,t] of [['background','說明背景'],['motivation','提問動機'],['impact','可能影響']])el('p',t+'：'+(item[k]||''),card);}else{el('p','來源／作者：'+item.attribution+' · 授權：'+item.license,card);if(item.url){link(card,'查看原始影音／資源 ↗',item.url);if(item.kind==='dialogue'){try{const u=new URL(item.url);const id=u.hostname==='youtu.be'?u.pathname.slice(1):['youtube.com','www.youtube.com'].includes(u.hostname)?u.searchParams.get('v'):null;if(id&&/^[A-Za-z0-9_-]{11}$/.test(id)){const frame=el('iframe',null,card);frame.src='https://www.youtube-nocookie.com/embed/'+id;frame.title=item.title;frame.loading='lazy';frame.allowFullscreen=true;frame.style.cssText='width:100%;aspect-ratio:16/9;border:0';frame.referrerPolicy='strict-origin-when-cross-origin';}}catch{}}}}}}
 try{if(area==='modules')await modules();else if(area==='dialogues')await events();else if(['plc','ta_forum'].includes(area))await community();else if(area==='clubs')await clubs();else if(area==='publication')await publication();else await publicPage();}catch(e){fail(e);}
};
