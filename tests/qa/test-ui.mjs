import {JSDOM} from 'jsdom';
import fs from 'node:fs';import assert from 'node:assert/strict';
const code=fs.readFileSync('../../auth.js','utf8').replace('  init();','  window.test={questionPage,set(c,u,p){client=c;user=u;profile=p;}};');
function make(role='student',page='questions'){
 const d=new JSDOM('<body data-auth-page="'+page+'"><div id="auth-root"></div><p id="auth-status"></p><div id="auth-notice"></div></body>',{url:'https://youtingyeh.github.io/RISE/questions.html',runScripts:'outside-only'});
 const calls=[],u={id:'my-id'},p={role};
 const client={rpc:async(name,args)=>{calls.push([name,args]);return {data:name==='rise_staff_question_queue'?[]:'id'};},storage:{from(){return {upload:async()=>({data:{}})}}},from(table){const q={select(){return q},eq(k,v){calls.push(['eq',k,v]);return q},order(){return q},range:async()=>({data:[]})};return q;}};
 d.window.URL.createObjectURL=()=> 'blob:test';d.window.URL.revokeObjectURL=()=>{};
 d.window.createImageBitmap=async()=>({width:100,height:100,close(){}});
 d.window.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});
 d.window.HTMLCanvasElement.prototype.toBlob=function(cb){cb(new d.window.Blob(['PNG'],{type:'image/png'}));};
 d.window.eval(code);d.window.test.set(client,u,p);return {d,calls,client};
}
let {d,calls}=make();await d.window.test.questionPage();assert(d.window.document.querySelector('#q-images'));assert(calls.some(c=>c[0]==='eq'&&c[1]==='user_id'&&c[2]==='my-id'));
const input=d.window.document.querySelector('#q-images');Object.defineProperty(input,'files',{configurable:true,value:[new d.window.File(['x'],'test.png',{type:'image/png'})]});await input.onchange();assert.equal(d.window.document.querySelectorAll('#q-image-preview img').length,1);
d.window.document.querySelector('#q-image-preview button').click();assert.equal(d.window.document.querySelectorAll('#q-image-preview img').length,0);
await input.onchange();d.window.document.querySelector('#q-title').value='Title';d.window.document.querySelector('#q-body').value='Body';
const form=d.window.document.querySelector('#question-form');await form.onsubmit({preventDefault(){},target:form});assert.equal(calls.find(c=>c[0]==='rise_submit_question')[1].p_images.length,1);assert.equal(d.window.document.querySelectorAll('#q-image-preview img').length,0);d.window.close();
({d,calls}=make('ta','staff-questions'));await d.window.test.questionPage(true);assert(!d.window.document.querySelector('#question-form'));assert.equal(d.window.document.querySelector('#q-filter').value,'unanswered');assert(calls.some(c=>c[0]==='rise_staff_question_queue'&&c[1].p_filter==='unanswered'));d.window.close();
console.log('PASS student own-question filter, image preview/remove/upload, separate staff queue without student form');


// A committed question remains successful even when optional follow-up work fails.
for(const failure of ['link-error','link-network','refresh']){
 const state=make();const {d,client,calls}=state;
 await d.window.test.questionPage();
 const doc=d.window.document,form=doc.querySelector('#question-form');
 doc.querySelector('#q-title').value='Title';doc.querySelector('#q-body').value='Body';
 form.dataset.advisorAnalysisHash='a'.repeat(64);
 const original=client.rpc;
 client.rpc=async(name,args)=>{
   if(name==='rise_submit_question')assert.equal(doc.querySelector('#q-title').disabled,true);
   if(name==='rise_link_question_analysis'){
     assert.equal(args.p_input_hash,'a'.repeat(64));
     if(failure==='link-network')throw new TypeError('Network unavailable');
     if(failure==='link-error')return {error:{message:'Missing refinement migration'}};
   }
   return original(name,args);
 };
 if(failure==='refresh')client.from=()=>{const q={select(){return q},eq(){return q},order(){return q},range:async()=>{throw new TypeError('Offline')}};return q;};
 await form.onsubmit({preventDefault(){},target:form});
 assert.equal(calls.filter(c=>c[0]==='rise_submit_question').length,1);
 assert.match(doc.querySelector('#auth-status').textContent,/已送出.*不必重複送出/);
 assert.equal(doc.querySelector('#q-title').value,'');
 assert.equal(doc.querySelector('#q-title').disabled,false);
 assert.equal(form.querySelector('[type="submit"]').disabled,false);
 d.window.close();
}
console.log('PASS submission: optional AI RPC error/network error/list refresh failure preserve committed success and restore controls.');
