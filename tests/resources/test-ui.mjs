import {JSDOM} from 'jsdom';import fs from 'node:fs';import assert from 'node:assert/strict';
const code=fs.readFileSync('../../resources.js','utf8');
async function make(role){
 const d=new JSDOM('<div class="auth-nav"></div><div id="auth-root"></div><p id="auth-status"></p>',{url:'https://youtingyeh.github.io/RISE/resources.html',runScripts:'outside-only'});d.window.HTMLElement.prototype.scrollIntoView=()=>{};
 const calls=[],u=role?{id:'u',email_confirmed_at:'now'}:null;
 const client={auth:{getUser:async()=>({data:{user:u}}),onAuthStateChange(){}},rpc:async(name,args)=>{calls.push([name,args]);return {data:{id:'new',version:1,...args.p_document}}},from(table){const q={select(){return q},eq(){return q},order(){return q},range:async()=>({data:[]}),single:async()=>({data:{role}})};return q;}};
 d.window.RISE_AUTH_CONFIG={url:'https://example.supabase.co',publishableKey:'public'};d.window.supabase={createClient:()=>client};d.window.eval(code);await new Promise(r=>setTimeout(r,20));return {d,calls};
}
for(const role of [null,'student','ta']){const {d}=await make(role);assert(!d.window.document.querySelector('#res-new'));d.window.close();}
for(const role of ['teacher','admin']){const {d,calls}=await make(role);d.window.document.querySelector('#res-new').click();assert(d.window.document.querySelector('#res-upload'));d.window.document.querySelector('#res-title').value='<script>alert(1)</script>';d.window.document.querySelector('#res-body').value='Text';d.window.document.querySelector('#res-preview').click();assert.equal(d.window.document.querySelector('#res-text-preview script'),null);assert(d.window.document.querySelector('#res-text-preview').textContent.includes('<script>'));
const form=d.window.document.querySelector('#res-form');await form.onsubmit({preventDefault(){},target:form,submitter:{value:'published'}});assert.equal(calls[0][0],'rise_save_resource');assert.equal(calls[0][1].p_document.status,'published');d.window.close();}
console.log('PASS reader roles cannot edit, teacher/admin editor, literal-text preview, publish submission');
