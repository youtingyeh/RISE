import {JSDOM} from 'jsdom';import fs from 'node:fs';import assert from 'node:assert/strict';
const id=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
for(const destination of ['science','learning']){
 const d=new JSDOM(`<div data-resource-feed="${destination}"></div>`,{url:'https://youtingyeh.github.io/RISE/'+destination+'.html',runScripts:'outside-only'}),calls=[];
 d.window.HTMLElement.prototype.scrollIntoView=()=>{};d.window.RISE_AUTH_CONFIG={url:'https://test.supabase.co',publishableKey:'public'};
 d.window.supabase={createClient:()=>({rpc:async(name,args)=>{calls.push([name,args]);return {data:name==='rise_resource_groups'?[{owner_id:id(9),collection:'<img src=x>',subject:'math',item_count:20}]:[{id:id(1),title:'First',summary:'Text',kind:'article',item_order:1}]};}})};
 d.window.eval(fs.readFileSync('../../resource-feed.js','utf8'));await new Promise(r=>setTimeout(r,20));assert.equal(calls[0][1].p_destination,destination);assert.equal(d.window.document.querySelectorAll('#feed-list article').length,1);assert.equal(d.window.document.querySelector('#feed-list img'),null);
 d.window.document.querySelector('#feed-list button').click();await new Promise(r=>setTimeout(r,20));assert.equal(calls[1][0],'rise_resource_group_items');assert(d.window.document.querySelector('#feed-detail a').href.endsWith('resources.html?id='+id(1)));d.window.close();
}
console.log('PASS grouped feed and resource links');
