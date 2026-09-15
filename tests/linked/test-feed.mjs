import {JSDOM} from 'jsdom';import fs from 'node:fs';import assert from 'node:assert/strict';
const source=fs.readFileSync('../../resource-feed.js','utf8');
for(const page of ['science','learning']){
 const calls=[];const dom=new JSDOM(`<div data-resource-feed="${page}"></div>`,{url:'https://youtingyeh.github.io/RISE/'+page+'.html?subject=physics',runScripts:'outside-only'});
 const rows=[{id:'10000000-0000-0000-0000-000000000001',title:'<img onerror=x>',summary:'description',subject:'physics',kind:'video'}];
 dom.window.RISE_AUTH_CONFIG={url:'https://test.supabase.co',publishableKey:'public'};
 dom.window.supabase={createClient:()=>({from(){const q={select(){return q},eq(k,v){calls.push([k,v]);return q},order(){return q},range:async()=>({data:rows})};return q;}})};
 dom.window.eval(source);await new Promise(r=>setTimeout(r,20));
 assert(calls.some(c=>c[0]==='status'&&c[1]==='published'));assert(calls.some(c=>c[0]==='subject'&&c[1]==='physics'));
 assert.equal(dom.window.document.querySelector('#feed-list img'),null);assert(dom.window.document.querySelector('#feed-list a').href.endsWith('resources.html?id='+rows[0].id));
 const selector=dom.window.document.querySelector('#feed-kind');selector.value='material';selector.onchange();await new Promise(r=>setTimeout(r,20));assert(calls.some(c=>c[0]==='kind'&&c[1]==='material'));dom.window.close();
}
console.log('PASS both feeds query published only, subject/type filtering, safe title rendering, direct resource links');
