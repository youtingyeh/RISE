'use strict';
window.RISE_WORKFLOWS=async function({client,user,profile,root,report}){
 const area=document.body.dataset.workflow||'assignments',role=profile.role;
 const staff=['ta','teacher','admin'].includes(role),teacher=['teacher','admin'].includes(role),admin=role==='admin';
 let alive=true,request=0,formCount=0;
 const clear=()=>{alive=false;request++;root.replaceChildren();};
 client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||(session?.user&&session.user.id!==user.id))clear();});
 window.addEventListener('pageshow',e=>{if(e.persisted){clear();location.reload();}});
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=v=>v?new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):'不限時間';
 const checked=result=>{if(result.error)throw result.error;return result.data;};
 const fail=e=>report(['PGRST202','42P01','3F000'].includes(e.code)?'學習流程後端尚未安裝，請管理員執行 backend/learning-workflows.sql。':e.code==='23505'?'這份版本已有你的評語，請重新整理查看。':String(e.message||'').startsWith('rise:')?e.message.slice(5):'操作未完成。請保留輸入、重新確認登入與網路後再試。',true);
 const read=(type,id=null)=>client.rpc('rise_workflow_read',{p_area:type,p_id:id}).then(checked);
 const action=(type,data)=>client.rpc('rise_workflow_action',{p_action:type,p_data:data}).then(checked);
 root.innerHTML='<nav class="wf-tabs" aria-label="學習功能"><a href="assignments.html">'+(staff?'作業批閱':'我的作業')+'</a>'+(staff?'<a href="ta-training.html">助教培訓認證</a>':'')+'<a href="competitions.html">提問競賽</a><a href="learning-report.html">學習成效</a></nav><div id="wf-main"></div>';
 const main=root.querySelector('#wf-main');
 function section(parent,title,description=''){
  const box=document.createElement('section');box.className='auth-card wf-section';
  box.innerHTML='<h2>'+esc(title)+'</h2>'+(description?'<p>'+esc(description)+'</p>':'');parent.append(box);return box;
 }
 function text(parent,value,tag='p'){const p=document.createElement(tag);p.textContent=value;p.className='wf-text';parent.append(p);return p;}
 function button(parent,label,fn){const b=document.createElement('button');b.type='button';b.textContent=label;parent.append(b);b.onclick=async()=>{if(b.disabled||!alive)return;b.disabled=true;try{await fn();}catch(e){fail(e);}finally{b.disabled=false;}};return b;}
 const field=(key,label,type='textarea',value='',required=true)=>'<div class="auth-field"><label for="wf-'+key+'">'+esc(label)+'</label>'+(type==='textarea'?'<textarea rows="5" maxlength="20000"':type==='select'?'<select':'<input type="'+type+'"'+(type==='text'?' maxlength="160"':''))+' id="wf-'+key+'" name="'+key+'" '+(required?'required':'')+'>'+(type==='textarea'?esc(value)+'</textarea>':type==='select'?value+'</select>':'')+'</div>';
 const options=list=>list.map(v=>'<option value="'+esc(v[0])+'">'+esc(v[1])+'</option>').join('');
 const subjects=options([['math','數學'],['physics','物理'],['chemistry','化學'],['multiple','跨學科']]);
 function form(parent,html,label,fn){
  const prefix='wf-form-'+(++formCount)+'-';
  const f=document.createElement('form');f.innerHTML=html.replaceAll('id="wf-','id="'+prefix).replaceAll('for="wf-','for="'+prefix)+'<button type="submit">'+esc(label)+'</button><p class="wf-form-status" role="status"></p>';parent.append(f);
  let busy=false;f.onsubmit=async e=>{e.preventDefault();if(busy||!alive)return;busy=true;const values=Object.fromEntries(new FormData(f)),controls=[...f.querySelectorAll('input,textarea,select,button')],s=f.querySelector('.wf-form-status');controls.forEach(c=>c.disabled=true);s.textContent='正在儲存…';
   try{await fn(values,f);s.textContent='已儲存。';report('已儲存。');}catch(e){s.textContent='未確認儲存成功，輸入已保留。';fail(e);}finally{busy=false;controls.forEach(c=>c.disabled=false);}
  };return f;
 }
 function details(parent,title){const d=document.createElement('details');text(d,title,'summary');parent.append(d);return d;}
 function table(parent,headers,rows){const wrap=document.createElement('div');wrap.className='wf-table-wrap';wrap.innerHTML='<table><thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';parent.append(wrap);}
 async function attachment(parent,file){button(parent,'下載：'+file.name,async()=>{const data=checked(await client.storage.from('rise-work-files').download(file.path));const url=URL.createObjectURL(data);const a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);});}
 const isOwner=item=>teacher&&(admin||item.owner_id===user.id);
 async function assignment(item,box){
  const seq=++request;const data=await read('assignment',item.id);if(seq!==request||!alive)return;
  box.replaceChildren();text(box,item.title,'h3');text(box,item.body);text(box,'截止：'+date(item.due_at)+' · '+(item.closed?'已關閉':item.published?'開放中':'草稿'));
  if(isOwner(item)){
   button(box,item.published?'下架作業':'發布作業',async()=>{await action('assignment_state',{id:item.id,published:!item.published});await assignments();});
   button(box,item.closed?'重新開放':'關閉繳交',async()=>{await action('assignment_state',{id:item.id,closed:!item.closed});await assignments();});
  }
  if(isOwner(item)){const editor=details(box,'調整指派對象');const f=form(editor,'','儲存指派對象',async(values,f)=>{await action('assignment_audience',{id:item.id,...f.riseAudience()});await assignments();});await window.RISE_COURSES.audience(client,f,item);}
  const own=data.revisions.filter(v=>v.student_id===user.id),latest=own[0];
  if(role==='student'&&item.published&&!item.closed&&(!item.due_at||new Date(item.due_at)>new Date())){
   const editor=section(box,latest?'提交修訂版本':'繳交作業','每次提交都保留完整版本。批閱後可參考評語修訂；附件會跟隨各版本保留。');
   let uploaded=[];
   const f=form(editor,field('body','作答內容與完整推理','textarea',latest?.body||'')+field('change_note','這次修改了什麼？','textarea','',!!latest)+'<label>附件（選填，最多 3 份 PDF／JPG／PNG／WebP，每份 5 MB）<input name="uploads" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp"></label>'+(latest?.files?.length?'<label><input name="keep_files" type="checkbox" checked>保留上一版附件（新附件加總最多 3 份）</label>':''),'送出並保存版本',async(data,f)=>{
    const keep=f.querySelector('[name="keep_files"]')?.checked?(latest?.files||[]):[];
    const files=[...f.querySelector('[type="file"]').files];const types={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
    if(keep.length+files.length>3)throw Error('rise:附件加總最多三份。');
    for(const file of files)if(!types[file.type]||file.size===0||file.size>5242880)throw Error('rise:附件格式不支援或超過 5 MB。');
    for(let i=uploaded.length;i<files.length;i++){const file=files[i],path=user.id+'/'+crypto.randomUUID()+'.'+types[file.type];checked(await client.storage.from('rise-work-files').upload(path,file,{contentType:file.type,upsert:false}));uploaded.push({path,name:file.name});}
    await action('assignment_submit',{id:item.id,expected_version:latest?.version||0,body:data.body,change_note:data.change_note,files:[...keep,...uploaded]});await assignment(item,box);
   });
   f.querySelector('[type="file"]').onchange=()=>{uploaded=[];};
  }
  text(box,staff?'繳交與修訂歷程':'我的版本與批閱','h3');
  if(!data.revisions.length)text(box,'尚無繳交紀錄。');
  for(const revision of data.revisions){
   const d=details(box,(staff?'學生 '+(revision.student_name||revision.student_id.slice(0,8))+' · ':'')+'第 '+revision.version+' 版 · '+date(revision.created_at));
   text(d,revision.body);if(revision.change_note)text(d,'修改說明：'+revision.change_note);for(const file of revision.files||[])await attachment(d,file);
   const reviews=data.reviews.filter(g=>g.revision_id===revision.id);
   for(const g of reviews){const review=section(d,'批閱回饋');text(review,date(g.created_at)+' · '+({ta:'助教',teacher:'教師',admin:'管理員'}[g.reviewer_role]||'教學人員'));text(review,'思路分析：'+g.analysis);text(review,'改進建議：'+g.improvement);text(review,'延伸提問：'+g.followup);text(review,'推理表現：'+g.score+'/4 · '+(g.outcome==='completed'?'完成':'請修訂'));}
   if(staff&&!reviews.some(g=>g.reviewer_id===user.id))form(d,field('analysis','思路分析')+field('improvement','改進建議')+field('followup','延伸提問')+field('score','本版推理表現','select',options([['0','0：尚未提供可判讀推理'],['1','1：起步，主要概念待釐清'],['2','2：部分合理，推論尚有缺口'],['3','3：大致完整，少量修正'],['4','4：完整且能說明依據']]))+field('outcome','批閱結果','select',options([['revise','請修訂'],['completed','完成']])),'送出批閱（保存後不覆寫）',async(values)=>{await action('assignment_review',{id:revision.id,...values});await assignment(item,box);});
  }
 }
 async function assignments(){
  const seq=++request,data=await read('assignments');if(seq!==request||!alive)return;main.replaceChildren();
  if(teacher){const creator=details(main,'新增作業');const createForm=form(creator,field('title','作業標題','text')+field('subject','學科','select',subjects)+field('body','作業題目、要求與評量重點')+field('due_at','截止時間（依本機時區；選填）','datetime-local','',false)+'<label><input name="published" type="checkbox">立即發布</label>','建立作業',async(values,f)=>{await action('assignment_create',{...values,...f.riseAudience(),published:f.querySelector('[name="published"]').checked,due_at:values.due_at?new Date(values.due_at).toISOString():null});await assignments();});await window.RISE_COURSES.audience(client,createForm);}
  const list=section(main,staff?'作業批閱工作台':'我的作業');const viewer=section(main,'作業詳情');viewer.hidden=true;
  if(!data.items.length)text(list,'目前沒有可查看的作業。');
  for(const item of data.items)button(list,item.title+' · '+(item.closed?'已關閉':item.published?'已發布':'草稿'),async()=>{viewer.hidden=false;await assignment(item,viewer);viewer.scrollIntoView({block:'start',behavior:'smooth'});});
 }
 const trainingTemplate='培訓練習（試用版；須由管理員審閱後發布）\n\n一、教學溝通：針對「我完全不會」的學生，寫出三個不直接揭露答案的引導問題。\n二、錯誤診斷：學生主張 (a+b)²=a²+b²。說明可能的概念混淆，設計一個數值或圖形檢查。\n三、標準化批閱：對上一例分別撰寫思路分析、改進建議與延伸提問，依 0–4 級規準說明判斷。\n四、回饋倫理：說明如何避免羞辱性回饋、處理不確定的知識，以及保護學生個人資料。\n\n提交時請依序回答四項，修訂時保留修改說明。管理員須人工確認四項能力後才核發平台內部培訓認證。';
 async function training(){
  if(!staff){main.textContent='此頁限教師、助教與管理員使用。';return;}
  const seq=++request,data=await read('training');if(seq!==request||!alive)return;main.replaceChildren();
  text(main,'此為平台內部培訓認證，與教師／助教帳號資格分開；核發不會自動變更帳號角色。認證有效期間一年，可由管理員撤銷。');
  if(admin){const editor=details(main,'建立培訓課程');form(editor,field('title','課程名稱','text')+field('body','教材與考核作業','textarea',trainingTemplate)+'<label><input name="published" type="checkbox">立即發布</label>','建立課程',async(values,f)=>{await action('course_create',{...values,published:f.querySelector('[name="published"]').checked});await training();});}
  if(!data.items.length)text(main,'尚未發布培訓課程。');
  for(const course of data.items){const box=section(main,course.title+(course.published?'':'（草稿）'));text(box,course.body);
   if(admin)button(box,course.published?'下架課程':'發布課程',async()=>{await action('course_publish',{id:course.id,published:!course.published});await training();});
   const submissions=data.submissions.filter(t=>t.course_id===course.id),own=submissions.filter(t=>t.applicant_id===user.id),latest=own[0];
   if(!admin&&course.published){const editor=details(box,latest?'修訂培訓成果':'提交培訓成果');form(editor,field('body','依課程要求撰寫試批與考核內容','textarea',latest?.body||''),'提交審核',async(values)=>{await action('training_submit',{id:course.id,expected_version:latest?.version||0,...values});await training();});}
   const applicants=[...new Set(submissions.map(t=>t.applicant_id))];
   for(const applicant of applicants){const versions=submissions.filter(t=>t.applicant_id===applicant),newest=versions[0],ids=versions.map(v=>v.id),cert=data.certificates.find(c=>ids.includes(c.submission_id));
    const d=details(box,(admin?'申請人 '+(newest.applicant_name||applicant.slice(0,8))+' · ':'我的成果 · ')+'共 '+versions.length+' 版');
    const valid=cert?.decision==='approved'&&new Date(cert.valid_until)>new Date();
    text(d,cert?'認證狀態：'+(valid?'有效至 '+date(cert.valid_until):cert.decision==='returned'?'待補件':cert.decision==='revoked'?'已撤銷':'已到期')+'；審核意見：'+cert.note:'尚待審核');
    if(valid){text(d,'認證編號：'+cert.id);button(d,'下載內部培訓認證紀錄',async()=>{const blob=new Blob(['RISE 平台內部培訓認證\n課程：'+course.title+'\n帳號：'+applicant+'\n認證編號：'+cert.id+'\n核發：'+date(cert.created_at)+'\n有效至：'+date(cert.valid_until)+'\n非學位或法定專業資格；當前有效性請以網站紀錄為準。'],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='RISE-training-'+cert.id+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);});}
    for(const v of versions){const history=details(d,'第 '+v.version+' 版 · '+date(v.created_at));text(history,v.body);for(const c of data.certificates.filter(c=>c.submission_id===v.id))text(history,date(c.created_at)+' · '+c.decision+'：'+c.note);}
    if(admin)form(d,field('decision','審核決定','select',options([['returned','退回補件'],['approved','核發一年認證'],['revoked','撤銷認證']]))+field('note','依四項能力說明審核理由'),'保存審核紀錄',async(values)=>{await action('certify',{id:newest.id,...values});await training();});
   }
  }
 }
 const stateLabel={draft:'草稿',open:'開放投稿',judging:'評審中',results:'結果已發布'};
 async function competition(item,box){
  const seq=++request,data=await read('competition',item.id);if(seq!==request||!alive)return;box.replaceChildren();
  text(box,item.title,'h3');text(box,item.body);text(box,stateLabel[item.state]+' · 截止：'+date(item.deadline));
  text(box,'評量四項各 0–5 分：創新性、深度、適切性、啟發性。總分 20 分，結果為評審平均分，依高中／大專及領域分組呈現；同分並列，不自動核發獎項。');
  if(isOwner(item)){
   if(item.state!=='results'){const choices=data.candidates.map(c=>[c.id,(c.name||'未設定姓名')+' · '+c.role]);if(choices.length)form(box,field('judge_id','指定評審（不能是本競賽參賽者）','select',options(choices)),'加入評審',async(values)=>{await action('judge_assign',{id:item.id,...values});await competition(item,box);});text(box,'評審名單：'+data.judges.map(id=>data.candidates.find(c=>c.id===id)?.name||id.slice(0,8)).join('、'));for(const id of data.judges)button(box,'移除未評分評審：'+(data.candidates.find(c=>c.id===id)?.name||id.slice(0,8)),async()=>{if(!confirm('移除此評審？已有評分的評審不能移除。'))return;await action('judge_remove',{id:item.id,judge_id:id});await competition(item,box);});}
   const next={draft:'open',open:'judging',judging:'results'}[item.state];if(next)button(box,{open:'開放投稿',judging:'截止後進入評審',results:'發布全部結果'}[next],async()=>{if(!confirm('確定切換至「'+stateLabel[next]+'」？此流程不會倒退。'))return;await action('competition_state',{id:item.id,state:next});await competitions();});
  }
  const latest=data.own[0];
  if(['student','ta'].includes(role)&&item.state==='open'&&new Date(item.deadline)>new Date()){
   const editor=section(box,latest?'修改我的投稿':'提交問題作品','請勿在作品中寫入姓名、學校、信箱等識別資料。評審介面不顯示投稿帳號，但無法自動移除你寫在作品內的個資。');
   const f=form(editor,field('division','組別','select',options([['高中','高中'],['大專','大專']]))+field('field','領域','select',options(['自然科學','人文','社會','跨領域'].map(v=>[v,v])))+field('title','問題標題','text')+field('body','問題、背景、動機及可能影響','textarea',latest?.body||''),'保存投稿版本',async(values)=>{await action('competition_submit',{id:item.id,expected_version:latest?.version||0,...values});await competition(item,box);});
   if(latest){f.querySelector('[name="title"]').value=latest.title;f.querySelector('[name="division"]').value=latest.division;f.querySelector('[name="field"]').value=latest.field;}
  }
  for(const entry of data.own){const d=details(box,'我的投稿第 '+entry.version+' 版 · '+date(entry.created_at));text(d,entry.title,'h4');text(d,entry.body);for(const g of data.judgments.filter(g=>g.entry_id===entry.id))text(d,'評審：創新 '+g.innovation+'、深度 '+g.depth+'、適切 '+g.appropriateness+'、啟發 '+g.inspiration+'。'+g.note);}
  if(data.entries.length)text(box,'評審工作台：請先確認無利益衝突。若認出投稿人或有指導關係，請聯絡主辦人處理後再評分。','h3');
  for(const entry of data.entries){const d=details(box,'作品 '+entry.id.slice(0,8)+' · '+entry.division+'/'+entry.field+' · '+entry.title);text(d,entry.body);
   const g=data.judgments.find(g=>g.entry_id===entry.id);if(g)text(d,'已提交評語：'+g.note);
   else if(item.state==='judging')form(d,['innovation','depth','appropriateness','inspiration'].map((k,i)=>field(k,['創新性','深度','適切性','啟發性'][i],'select',options([0,1,2,3,4,5].map(n=>[String(n),String(n)])))).join('')+field('note','評分理由與改進建議'),'確認提交評分（不覆寫）',async(values)=>{await action('competition_judge',{id:entry.id,...values});await competition(item,box);});
  }
  if(item.state==='results'){text(box,'分組結果','h3');table(box,['組別','領域','作品','平均分／20','評審數'],data.results.map(e=>[e.division,e.field,e.title,e.average,e.reviewers]));if(!data.results.length)text(box,'本次沒有可發布的評分結果。');}
 }
 async function competitions(){const seq=++request,data=await read('competitions');if(seq!==request||!alive)return;main.replaceChildren();
  if(teacher){const editor=details(main,'建立提問競賽');form(editor,field('title','競賽名稱','text')+field('body','辦法、資格、評分規準與作品公開範圍')+field('deadline','截止時間（依本機時區）','datetime-local'),'建立草稿',async(values)=>{await action('competition_create',{...values,deadline:new Date(values.deadline).toISOString()});await competitions();});}
  const list=section(main,'提問競賽'),viewer=section(main,'競賽詳情');viewer.hidden=true;if(!data.items.length)text(list,'目前沒有競賽。');
  for(const item of data.items)button(list,item.title+' · '+stateLabel[item.state],async()=>{viewer.hidden=false;await competition(item,viewer);viewer.scrollIntoView({block:'start',behavior:'smooth'});});
 }
 async function analytics(){const seq=++request,data=await read('analytics');if(seq!==request||!alive)return;main.replaceChildren();
  const box=section(main,'學習成效紀錄',data.scope+'。只統計本系統的作業提交與批閱；未提交者不列入。完成代表最新版本最近一次批閱標示完成，修訂次數不等於能力提升。');
  if(data.summary)table(box,['已批閱版本','培訓提交版本','有效培訓認證','競賽投稿（每人每賽一件）'],[[data.summary.reviewed_versions,data.summary.training_submissions,data.summary.valid_certifications,data.summary.competition_entries]]);
  table(box,['學生','已交作業','提交版本','修訂次數','已完成','最新版本待批閱'],data.rows.map(r=>[r.display_name||r.id.slice(0,8),r.assignments,r.versions,r.revisions,r.completed,r.awaiting_review]));
  const timeline=section(main,'各版本推理表現','0–4 級來自教學人員判讀。不同作業難度與評閱者可能不同，不直接以平均分判定成長，也不以此取代正式成績。');
  table(timeline,['學生編號','作業編號','版本','表現／4','結果','時間'],data.timeline.map(r=>[r.student_id.slice(0,8),r.assignment_id.slice(0,8),r.version,r.score,r.outcome==='completed'?'完成':'請修訂',date(r.created_at)]));
  if(!data.rows.length)text(box,'尚無作業紀錄。完成首次提交後便會顯示。');
  button(box,'下載統計 CSV',async()=>{const rows=[['學生','作業','版本','修訂','完成','待批閱'],...data.rows.map(r=>[r.display_name||r.id,r.assignments,r.versions,r.revisions,r.completed,r.awaiting_review])];const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/^\\s*[=+@-]/,"'$&").replaceAll('"','""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='RISE-learning-report.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);});
 }
 button(root.querySelector('nav'),'重新整理',()=>load());
 async function load(){try{if(area==='training')await training();else if(area==='competitions')await competitions();else if(area==='analytics')await analytics();else await assignments();}catch(e){fail(e);}}
 await load();
};

