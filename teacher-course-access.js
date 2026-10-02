'use strict';
window.RISE_TEACHER_ACCESS=(()=>{
 const el=(tag,text,parent)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(parent)parent.append(n);return n;};
 const rpc=async(client,action,data={})=>{const r=await client.rpc('rise_teacher_access',{p_action:action,p_data:data});if(r.error)throw r.error;return r.data;};
 function picker(parent,courses,initial={},allowNone=false){
  const box=el('fieldset',null,parent);el('legend',allowNone?'管理員核准的課程範圍':'申請任教課程與資料查看範圍',box);
  el('p',allowNone?'指定課程只授權查看該課學員及相關作業；全部課程包含日後新增的課程。':'選擇任教課程，或申請全部課程。申請不會立即取得學生資料權限，須由管理員核准。',box);
  const label=el('label','存取範圍',box),mode=el('select',null,label);
  for(const [value,title] of [...(allowNone?[['none','尚未授權／撤銷存取']]:[]),['courses','指定課程（可複選）'],['all',allowNone?'全部課程':'申請全部課程']]){const o=el('option',title,mode);o.value=value;}
  mode.value=['courses','all',...(allowNone?['none']:[])].includes(initial.scope)?initial.scope:(allowNone?'none':'courses');
  const list=el('div',null,box);
  for(const c of courses){const l=el('label',null,list);l.style.display='block';const i=el('input',null,l);i.type='checkbox';i.value=c.id;i.checked=(initial.course_ids||[]).includes(c.id);l.append(document.createTextNode(' '+c.title+(c.active===false?'（已停止加入）':'')));}
  if(!courses.length)el('p','尚無課程分類，請管理員先建立課程。',list);
  mode.onchange=()=>{list.hidden=mode.value!=='courses';};mode.onchange();
  return {box,get(){const ids=mode.value==='courses'?[...list.querySelectorAll('input:checked')].map(i=>i.value):[];if(mode.value==='courses'&&!ids.length)throw Error('rise:請至少選擇一門課程。');return {scope:mode.value,course_ids:ids};}};
 }
 async function application(client,parent,role,application){const r=await client.rpc('rise_course_catalog');if(r.error)throw r.error;const p=picker(parent,r.data,{scope:application?.requested_access,course_ids:application?.requested_course_ids});const update=()=>{p.box.hidden=role.value!=='teacher';};role.addEventListener('change',update);update();return ()=>role.value==='teacher'?p.get():{scope:'none',course_ids:[]};}
 async function reviews(client,rows,root){const data=await rpc(client,'list');const result=new Map();for(const a of rows){const box=root.querySelector('[data-course-review="'+a.id+'"]');if(!box||a.requested_role!=='teacher')continue;const names=(a.requested_course_ids||[]).map(id=>data.courses.find(c=>c.id===id)?.title||'已移除課程');el('p','申請查看範圍：'+(a.requested_access==='all'?'全部課程':a.requested_access==='courses'?names.join('、'):'舊申請未指定課程，請管理員確認'),box);if(a.status==='pending')result.set(a.id,picker(box,data.courses,{scope:a.requested_access,course_ids:a.requested_course_ids},true));}return result;}
 async function admin({client,profile,root}){if(profile.role!=='admin'){root.textContent='此頁僅限管理員使用。';return;}const data=await rpc(client,'list');root.replaceChildren();el('p','尚未授權的教師無法查看其他學生的成效。課程學員以目前加入名單為準；跨課程學生的其他課程作業不會因此開放。更改權限會立即影響後續查詢。',root);if(!data.teachers.length)el('p','目前沒有教師帳號，請先完成資格審核。',root);for(const teacher of data.teachers){const box=el('section',null,root);box.className='auth-card';el('h2',teacher.display_name||'未填姓名',box);el('p',teacher.email,box);const form=el('form',null,box),p=picker(form,data.courses,teacher,true),save=el('button','儲存課程權限',form),status=el('p',null,form);status.setAttribute('role','status');form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await rpc(client,'save',{user_id:teacher.id,...p.get()});status.textContent='課程權限已儲存。';}catch(e){status.textContent=error(e);}finally{save.disabled=false;}};}}
 function error(e){return ['PGRST202','42P01','42703'].includes(e.code)?'教師課程權限尚未安裝，請執行 backend/teacher-course-access.sql。':String(e.message||e).replace(/^rise:/,'');}
 return {application,reviews,admin,error,picker};
})();
