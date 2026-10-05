import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
const source=await readFile(new URL('../../role-navigation.js',import.meta.url),'utf8');
for(const role of ['guest','student','ta','teacher','admin']){
 const {window,document}=parseHTML('<html><body><header><nav aria-label="主要導覽"></nav></header><a href="admin-console.html">舊管理入口</a></body></html>');
 let change;const client={auth:{getUser:async()=>({data:{user:role==='guest'?null:{id:'user',email_confirmed_at:'2026-01-01'}}}),onAuthStateChange(fn){change=fn;}},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role}})})})})};
 window.RISE_NAV_CLIENT=client;
 vm.runInContext(source,vm.createContext({window,document,location:{href:'https://example.test/index.html',pathname:'/index.html'},URL,setTimeout,MutationObserver:class{observe(){}}}));
 await new Promise(r=>setTimeout(r,0));
 assert.equal([...document.querySelectorAll('header button')].some(b=>b.textContent==='管理員專區'),role==='admin');
 for(const a of document.querySelectorAll('a[href^="admin-"]'))assert.equal(!a.hidden,role==='admin');
 if(role==='admin'){assert(document.querySelector('a[href="admin-console.html#member-management"]'));change('SIGNED_OUT');assert(!document.querySelector('header a[href="admin-console.html"]'));}
}
const adminSource=await readFile(new URL('../../admin-console.js',import.meta.url),'utf8');
for(const role of ['student','teacher','ta']){const {window,document}=parseHTML('<html><body><div id="root"></div></body></html>');vm.runInContext(adminSource,vm.createContext({window,document}));const root=document.querySelector('#root');await window.RISE_ADMIN_CONSOLE({profile:{role},user:{email_confirmed_at:'yes'},root});assert.match(root.textContent,/僅限管理員/);assert.equal(root.querySelector('form'),null);}
console.log('PASS: guest/student/TA/teacher/admin navigation, admin shortcuts, logout cleanup, non-admin console rejection.');
