import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
const coursesSource=await readFile(new URL('../../course-membership.js',import.meta.url),'utf8');
const source=await readFile(new URL('../../learning-workflows.js',import.meta.url),'utf8');
const me='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
async function mount(role,area,{error=false}={}){
 const {document,window}=parseHTML('<html><body data-workflow="'+area+'"><div id="root"></div></body></html>');
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return this.querySelector('option[selected]')?.getAttribute('value')||this.querySelector('option')?.getAttribute('value')||'';},set(v){for(const o of this.querySelectorAll('option')){if(o.value===v)o.setAttribute('selected','');else o.removeAttribute('selected');}}});
 window.HTMLElement.prototype.scrollIntoView=function(){};
 const root=document.querySelector('#root'),reports=[],actions=[];
 const assignment={id:'assignment',owner_id:me,title:'作業 <img onerror=bad>',body:'內容',published:true,closed:false};
 const rev={id:'revision',assignment_id:'assignment',student_id:role==='student'?me:other,version:1,body:'第一版',change_note:'',files:[],created_at:new Date().toISOString()};
 const course={id:'course',title:'課程',body:'四項能力',published:true};
 const contest={id:'contest',owner_id:me,title:'競賽',body:'辦法',state:'open',deadline:new Date(Date.now()+86400000).toISOString()};
 const reads={assignments:{items:[assignment]},assignment:{revisions:[rev],reviews:[]},training:{items:[course],submissions:[],certificates:[]},competitions:{items:[contest]},competition:{own:[],judges:[],entries:[],judgments:[],candidates:[{id:me,name:'教師',role:'teacher'}],results:[]},analytics:{scope:'測試',summary:{reviewed_versions:0,training_submissions:0,valid_certifications:0,competition_entries:0},rows:[],timeline:[]}};
 class Data{constructor(form){this.rows=[...form.querySelectorAll('input,textarea,select')].filter(x=>x.name&&x.type!=='file'&&(x.type!=='checkbox'||x.checked)).map(x=>[x.name,x.value||'']);}*[Symbol.iterator](){yield* this.rows;}}
 let failWrites=false;
 const client={auth:{onAuthStateChange(){}},rpc:async(name,args)=>{if(error)return {error:{code:'PGRST202'}};if(name==='rise_course_action')return {data:{courses:[{id:'course-id',title:'基礎物理',active:true}],selected:[]}};if(name==='rise_workflow_action'){actions.push(args);return failWrites?{error:{message:'rise:測試失敗'}}:{data:{id:'new'}};}return {data:reads[args.p_area]};},storage:{from:()=>({upload:async()=>({data:{}})})}};
 const context=vm.createContext({window,document,FormData:Data,URL,Blob,Date,crypto:globalThis.crypto,confirm:()=>true,setTimeout,location:{reload(){}}});
 vm.runInContext(coursesSource,context);
 vm.runInContext(source,context);
 await window.RISE_WORKFLOWS({client,user:{id:me},profile:{role},root,report:(s)=>reports.push(s)});
 const press=async label=>{const b=[...root.querySelectorAll('button')].find(b=>b.textContent.includes(label));assert(b,'missing button '+label);await b.onclick();};
 return {root,document,reports,actions,press,setFail:()=>failWrites=true};
}
for(const role of ['student','ta','teacher','admin'])for(const area of ['assignments','training','competitions','analytics']){
 const env=await mount(role,area);assert.equal(env.reports.length,0,role+' '+area);
 const ids=[...env.root.querySelectorAll('[id]')].map(x=>x.id);assert.equal(ids.length,new Set(ids).size);
 assert.equal(env.root.querySelectorAll('img').length,0,'untrusted title rendered as text');
 if(area==='training'&&role==='student')assert.match(env.root.textContent,/限教師/);
 if(area==='assignments'){
  await env.press('作業 <img');
  assert.equal(env.root.querySelectorAll('img').length,0);
  if(role==='student'){
   const form=[...env.root.querySelectorAll('form')].find(f=>f.querySelector('[name="change_note"]'));assert(form);form.querySelector('[name="body"]').value='第二版';form.querySelector('[name="change_note"]').value='補充推理';form.querySelector('[type="file"]').files=[];
   env.setFail();await form.onsubmit({preventDefault(){}});assert.equal(form.querySelector('[name="body"]').value,'第二版');assert.equal(form.querySelector('[type="submit"]').disabled,false);assert.match(env.reports.at(-1),/測試失敗/);assert.equal(env.actions[0].p_data.expected_version,1);
   assert.equal(env.root.querySelector('[name="analysis"]'),null);
  }else assert(env.root.querySelector('[name="analysis"]'));
 }
 if(area==='competitions'){
  await env.press('競賽 ·');
  assert.equal(Boolean(env.root.querySelector('[name="division"]')),['student','ta'].includes(role));
 }
}
const missing=await mount('student','assignments',{error:true});assert.match(missing.reports[0],/learning-workflows.sql/);
console.log('PASS DOM: four roles across four pages, safe rendering, unique labels, structured staff review, student version form, failed submit retains content, missing-backend message');

