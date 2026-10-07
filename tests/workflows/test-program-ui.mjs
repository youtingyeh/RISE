import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {parseHTML} from 'linkedom';import vm from 'node:vm';
const source=await readFile(new URL('../../program.js',import.meta.url),'utf8');
for(const role of ['student','ta','teacher','admin','guest'])for(const area of ['modules','dialogues','ta_forum','plc','clubs','publication','yearbook','awards']){
 const {document,window}=parseHTML('<html><body data-program="'+area+'"><div id="root"></div></body></html>');
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},set(v){for(const o of this.querySelectorAll('option')){if(o.value===v)o.setAttribute('selected','');else o.removeAttribute('selected');}}});
 window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','');};window.HTMLElement.prototype.close=function(){this.removeAttribute('open');};
 const root=document.querySelector('#root'),errors=[],calls=[];
 const client={auth:{onAuthStateChange(){}},rpc:async(name,args)=>{calls.push({name,args});if(name==='rise_teacher_access')return {data:{scope:'all',courses:[]}};return {data:args.p_action==='list'?{items:[]}:[]};}};
 vm.runInContext(source,vm.createContext({window,document,URL,Date,location:{href:'https://example.test/modules.html',origin:'https://example.test'}}));
 await window.RISE_PROGRAM({client,profile:{role},user:{id:'user'},root,report:s=>errors.push(s)});assert.deepEqual(errors,[],role+' '+area);
 if(['plc','clubs'].includes(area)&&!['teacher','admin'].includes(role))assert.equal(root.querySelector('button'),null);
 if(area==='publication'&&role!=='admin')assert.equal(root.querySelector('button'),null);
 const create=[...root.querySelectorAll('button')].find(b=>b.textContent.startsWith('＋'));if(create){await create.onclick();assert(root.querySelector('dialog[open]'));assert(root.querySelector('form'));assert.deepEqual(errors,[],role+' '+area);}
 assert.equal(root.querySelector('details'),null);
}
const historySource=await readFile(new URL('../../question-history.js',import.meta.url),'utf8');
for(const role of ['student','ta','teacher']){
 const {document,window}=parseHTML('<html><body><div id="root"></div></body></html>');const calls=[],root=document.querySelector('#root'),reports=[];vm.runInContext(historySource,vm.createContext({window,document}));
 const client={from:()=>({select:()=>({eq:()=>({order:async()=>({data:[{version:2,title:'A <img>',body:'Text',change_note:'Updated',created_at:'2026-10-01'}]})})})}),rpc:async(name,args)=>{calls.push({name,args});return {data:name==='rise_question_timeline'?{items:[]}:null};}};
 await window.RISE_QUESTION_HISTORY({client,user:{id:'u'},profile:{role},question:{id:'q',user_id:'u'},root,report:s=>reports.push(s),reload:async()=>{}});
 assert.equal(root.querySelector('img'),null);const f=root.querySelector('form');for(const input of f.querySelectorAll('textarea')){assert(input.required);input.value='Reasoning';}await f.onsubmit({preventDefault(){}});
 const saved=calls.find(c=>c.name===(role==='student'?'rise_revise_question':'rise_review_question'));assert(saved);assert.equal(saved.args.p_version,2);
}
console.log('PASS 40 program/role screens, explicit action dialogs, restricted community/management forms, question version and triple-feedback forms.');
