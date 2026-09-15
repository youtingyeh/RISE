import {JSDOM} from 'jsdom';import fs from 'node:fs';import assert from 'node:assert/strict';
const source=fs.readFileSync('../../resources.js','utf8'),id='10000000-0000-0000-0000-000000000001';
for(const found of [true,false]){
 const d=new JSDOM('<div class="auth-nav"></div><div id="auth-root"></div><p id="auth-status"></p>',{url:'https://youtingyeh.github.io/RISE/resources.html?id='+id,runScripts:'outside-only'});d.window.HTMLElement.prototype.scrollIntoView=()=>{};
 d.window.RISE_AUTH_CONFIG={url:'https://test.supabase.co',publishableKey:'public'};d.window.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:null}}),onAuthStateChange(){}},from(){const q={select(){return q},eq(){return q},order(){return q},range:async()=>({data:[]}),maybeSingle:async()=>({data:found?{id,title:'Direct lesson',body:'Text',youtube_id:'abcdefghijk',files:[]}:null})};return q;}})};
 d.window.eval(source);await new Promise(r=>setTimeout(r,20));
 if(found){assert(d.window.document.querySelector('#resource-detail').textContent.includes('Direct lesson'));assert.equal(d.window.document.querySelector('iframe'),null);assert(d.window.document.querySelector('#resource-detail a').href.includes(encodeURIComponent('resources.html?id='+id)));}
 else assert(d.window.document.querySelector('#auth-status').textContent.includes('下架'));
 d.window.close();
}
console.log('PASS direct links open outside list pagination, preserve login return, unavailable resource notice');
