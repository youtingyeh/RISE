import {JSDOM} from 'jsdom';
import fs from 'node:fs';import assert from 'node:assert/strict';
const code=fs.readFileSync('../../auth.js','utf8').replace('  init();','  window.test={questionPage,set(c,u,p){client=c;user=u;profile=p;}};');
function make(){
 const d=new JSDOM('<body data-auth-page="questions"><div id="auth-root"></div><p id="auth-status"></p><div id="auth-notice"></div></body>',{url:'https://youtingyeh.github.io/RISE/questions.html',runScripts:'outside-only'});
 const calls=[],u={id:'my-id'},p={role:'student'};
 const client={rpc:async(name,args)=>{calls.push([name,args]);return {data:name==='rise_staff_question_queue'?[]:'id'};},storage:{from(){return {upload:async()=>({data:{}})}}},from(table){const q={select(){return q},eq(k,v){calls.push(['eq',k,v]);return q},order(){return q},range:async()=>({data:[]})};return q;}};
 d.window.URL.createObjectURL=()=> 'blob:test';d.window.URL.revokeObjectURL=()=>{};
 d.window.createImageBitmap=async()=>({width:100,height:100,close(){}});
 d.window.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});
 d.window.HTMLCanvasElement.prototype.toBlob=function(cb){cb(new d.window.Blob(['PNG'],{type:'image/png'}));};
 d.window.eval(code);d.window.test.set(client,u,p);return {d,calls};
}
let {d,calls}=make();await d.window.test.questionPage();assert(d.window.document.querySelector('#q-images'));assert(calls.some(c=>c[0]==='eq'&&c[1]==='user_id'&&c[2]==='my-id'));
const input=d.window.document.querySelector('#q-images');Object.defineProperty(input,'files',{configurable:true,value:[new d.window.File(['x'],'test.png',{type:'image/png'})]});await input.onchange();assert.equal(d.window.document.querySelectorAll('#q-image-preview img').length,1);
d.window.document.querySelector('#q-image-preview button').click();assert.equal(d.window.document.querySelectorAll('#q-image-preview img').length,0);
await input.onchange();d.window.document.querySelector('#q-title').value='Title';d.window.document.querySelector('#q-body').value='Body';
const form=d.window.document.querySelector('#question-form');await form.onsubmit({preventDefault(){},target:form});assert.equal(calls.find(c=>c[0]==='rise_submit_question')[1].p_images.length,1);assert.equal(d.window.document.querySelectorAll('#q-image-preview img').length,0);d.window.close();
({d,calls}=make());await d.window.test.questionPage(true);assert(!d.window.document.querySelector('#question-form'));assert.equal(d.window.document.querySelector('#q-filter').value,'unanswered');assert(calls.some(c=>c[0]==='rise_staff_question_queue'&&c[1].p_filter==='unanswered'));d.window.close();
console.log('PASS student own-question filter, image preview/remove/upload, separate staff queue without student form');
