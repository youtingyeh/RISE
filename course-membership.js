'use strict';
window.RISE_COURSES=(()=>{
 const el=(tag,text,parent)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(tag==='label'){n.style.display='block';n.style.marginBottom='12px';}if(parent)parent.append(n);return n;};
 const rpc=async(client,action,data={})=>{const r=await client.rpc('rise_course_action',{p_action:action,p_data:data});if(r.error)throw r.error;return r.data;};
 const error=e=>['PGRST202','42P01','3F000'].includes(e.code)?'課程功能尚未啟用，請管理員執行 backend/course-assignments.sql。':e.code==='23505'?'課程名稱已存在。':String(e.message||'').replace(/^rise:/,'')||'未能儲存，請重新確認登入與網路。';
 function choices(parent,courses,selected=[]){parent.replaceChildren();for(const c of courses){const l=el('label',null,parent);l.style.display='block';const i=el('input',null,l);i.type='checkbox';i.value=c.id;i.checked=selected.includes(c.id);l.append(document.createTextNode(' '+c.title+(c.active===false?'（已停用）':'')));if(c.description)el('small',c.description,l);}if(!courses.length)el('p','目前尚無課程可選擇。',parent);return ()=>[...parent.querySelectorAll('input:checked')].map(i=>i.value);}
 async function registration(client,form){if(!form)return;const box=el('fieldset'),legend=el('legend','所屬課程（選填，可複選）',box);el('p','可先略過，之後在會員中心調整。課程身分不會變更帳號角色。',box);form.querySelector('[type="submit"]').before(box);try{const r=await client.rpc('rise_course_catalog');if(r.error)throw r.error;const list=el('div',null,box);const get=choices(list,r.data);form.riseCourseIds=get;}catch(e){el('p',error(e)+' 你仍可繼續註冊。',box);}}
 async function membership(client,root,profile){if(profile.role!=='student')return;const box=el('section',null,root);box.className='auth-card';el('h2','我的課程',box);el('p','選擇你參加的課程，以查看課程作業。退出後將無法查看或繳交該課作業，既有繳交紀錄仍保留。',box);const status=el('p','載入中…',box);status.setAttribute('role','status');try{const data=await rpc(client,'list');const form=el('form',null,box),list=el('div',null,form),get=choices(list,data.courses,data.selected),save=el('button','儲存課程',form);status.textContent='';form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await rpc(client,'membership',{course_ids:get()});status.textContent='課程已更新，可前往「我的作業」查看。';}catch(e){status.textContent=error(e);}finally{save.disabled=false;}};}catch(e){status.textContent=error(e);}}
 async function admin({client,profile,root}){if(profile.role!=='admin'){root.textContent='僅管理員可管理課程。';return;}root.replaceChildren();el('p','學生可自行選擇課程；若需嚴格限定名單，請將作業指派給特定學生。停用課程只停止新加入，既有學員與作業紀錄會保留。',root);const data=await rpc(client,'list');for(const c of [{title:'',description:'',active:true},...data.courses]){const box=el('section',null,root);box.className='auth-card';el('h2',c.id?c.title:'新增課程分類',box);const f=el('form',null,box),label=el('label','課程名稱',f),title=el('input',null,label);title.value=c.title;title.required=true;title.maxLength=100;const dl=el('label','課程說明',f),desc=el('textarea',null,dl);desc.value=c.description;desc.maxLength=1000;const al=el('label',null,f),active=el('input',null,al);active.type='checkbox';active.checked=c.active;al.append(document.createTextNode('開放學生加入'));const save=el('button',c.id?'儲存變更':'新增課程',f),status=el('p',null,f);status.setAttribute('role','status');f.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await rpc(client,'save',{id:c.id,title:title.value,description:desc.value,active:active.checked});await admin({client,profile,root});}catch(e){status.textContent=error(e);save.disabled=false;}};}}
 function courseDropdown(parent,courses,selected=[]){
  parent.replaceChildren();
  const available=courses.filter(c=>c.active),byId=new Map(courses.map(c=>[c.id,c]));
  const chosen=new Set(selected),label=el('label','選擇目前開放的課程組',parent),select=el('select',null,label);
  select.setAttribute('aria-label','選擇目前開放的課程組');
  el('p','從下拉選單選取課程，可依序加入多個課程組。',parent);
  const list=el('div',null,parent);list.setAttribute('aria-live','polite');
  function draw(){
   select.replaceChildren();const placeholder=el('option',available.length?'請選擇課程組…':'目前沒有開放的課程組',select);placeholder.value='';
   for(const course of available){const option=el('option',course.title,select);option.value=course.id;option.disabled=chosen.has(course.id);}
   select.value='';list.replaceChildren();
   if(!chosen.size)el('p','尚未選擇課程組。',list);
   for(const id of chosen){const course=byId.get(id),row=el('p',(course?.title||'原指派課程')+(!course?.active?'（已停用或無法使用，請移除後重新選擇）':''),list),remove=el('button','移除',row);remove.type='button';remove.setAttribute('aria-label','移除'+(course?.title||'原指派課程'));remove.onclick=()=>{chosen.delete(id);draw();};}
  }
  select.onchange=()=>{const id=select.value;if(available.some(c=>c.id===id))chosen.add(id);draw();};draw();
  return ()=>{if([...chosen].some(id=>!byId.get(id)?.active))throw Error('rise:請移除已停用的課程組，再選擇目前開放的課程組。');return [...chosen];};
 }
 async function audience(client,form,item={}){const box=el('fieldset'),legend=el('legend','指派對象',box);form.querySelector('[type="submit"]').before(box);const mode=el('select',null,box);mode.setAttribute('aria-label','指派對象');for(const [v,t] of [['courses','指定課程'],['students','指定學生'],['all','全部學生']]){const o=el('option',t,mode);o.value=v;}mode.value=item.audience||'courses';const courseBox=el('div',null,box),studentBox=el('div',null,box),status=el('p',null,box);status.setAttribute('role','status');let getCourses=()=>[];const selected=new Map((item.student_ids||[]).map(id=>[id,id]));let ready=false;
 const selectedBox=el('div',null,studentBox),label=el('label','搜尋姓名（至少兩字）或完整會員編號',studentBox),search=el('input',null,label);search.type='search';const find=el('button','搜尋學生',studentBox);find.type='button';const results=el('div',null,studentBox);
 const draw=()=>{selectedBox.replaceChildren();for(const [id,name] of selected){const row=el('p',name+' · '+id,selectedBox),b=el('button','移除',row);b.type='button';b.onclick=()=>{selected.delete(id);draw();};}};draw();
 find.onclick=async()=>{find.disabled=true;status.textContent='';try{const rows=await rpc(client,'roster',{search:search.value});results.replaceChildren();if(!rows.length)el('p','沒有符合的學生，請輸入至少兩字或完整會員編號。',results);for(const r of rows){const b=el('button',r.display_name+' · '+r.id,results);b.type='button';b.onclick=()=>{selected.set(r.id,r.display_name);draw();};}}catch(e){status.textContent=error(e);}finally{find.disabled=false;}};
 mode.onchange=()=>{courseBox.hidden=mode.value!=='courses';studentBox.hidden=mode.value!=='students';};mode.onchange();
 form.riseAudience=()=>{if(!ready)throw Error('rise:請先完成課程後端設定並重新載入。');const course_ids=mode.value==='courses'?getCourses():[],student_ids=mode.value==='students'?[...selected.keys()]:[];if(mode.value==='courses'&&!course_ids.length)throw Error('rise:請選擇至少一門課程。');if(mode.value==='students'&&!student_ids.length)throw Error('rise:請選擇至少一位學生。');return {audience:mode.value,course_ids,student_ids};};
 try{const data=await rpc(client,'list');getCourses=courseDropdown(courseBox,data.courses,item.course_ids||[]);ready=true;}catch(e){status.textContent=error(e);}
 }
 return {registration,membership,admin,audience,error};
})();
