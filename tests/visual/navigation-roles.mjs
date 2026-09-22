import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../role-navigation.js',import.meta.url),'utf8');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attrs={};this.handlers={};this.classList={add(){}};}
 append(...xs){this.children.push(...xs);}replaceChildren(...xs){this.children=xs;}
 setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return k==='href'?this.href:this.attrs[k];}
 addEventListener(k,fn){this.handlers[k]=fn;}contains(x){return this===x||this.children.some(c=>c.contains?.(x));}
 get firstElementChild(){return this.children[0];}get lastElementChild(){return this.children.at(-1);}focus(){}
}
function setup(initialRole,verified=true,error=false){
 const nav=new Element('nav'),listeners={},authListeners=[];let role=initialRole;
 const links=()=>{const out=[];function walk(e){if(e.tag==='a')out.push(e);e.children.forEach(walk);}walk(nav);return out;};
 const document={documentElement:{},querySelectorAll:s=>s==='a[href]'?links():[nav],createElement:tag=>new Element(tag),addEventListener(){}};
 const client={auth:{getUser:async()=>({data:{user:role?{id:'u',email_confirmed_at:verified?'yes':null}:null}}),onAuthStateChange:fn=>authListeners.push(fn)},from:()=>({select(){return this;},eq(){return this;},single:async()=>error?{error:{message:'failed'}}:{data:{role}}})};
 const window={RISE_NAV_CLIENT:client,addEventListener:(k,fn)=>listeners[k]=fn};
 vm.runInNewContext(source,{window,document,URL,location:{href:'https://example.test/RISE/index.html',pathname:'/RISE/index.html'},MutationObserver:class{observe(){}},setTimeout:fn=>Promise.resolve().then(fn)});
 return {nav,authListeners,listeners,buttons:()=>nav.children.filter(x=>x.tag==='div').map(x=>x.children[0].textContent),setRole:r=>{role=r;}};
}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
for(const role of [null,'student','ta','teacher','admin']){
 const s=setup(role);assert.deepEqual(s.buttons(),['學生專區']);await flush();
 const expected=role==='admin'?['學生專區','助教專區','教師專區']:role==='ta'?['學生專區','助教專區']:role==='teacher'?['學生專區','教師專區']:['學生專區'];
 assert.deepEqual(s.buttons(),expected);
 s.setRole(null);s.authListeners[0]('SIGNED_OUT');assert.deepEqual(s.buttons(),['學生專區']);await flush();assert.deepEqual(s.buttons(),['學生專區']);
}
for(const params of [['teacher',false,false],['teacher',true,true],['unknown',true,false]]){const s=setup(...params);await flush();assert.deepEqual(s.buttons(),['學生專區']);}
const changed=setup('admin');await flush();changed.setRole('student');changed.listeners.focus();await flush();assert.deepEqual(changed.buttons(),['學生專區']);
const auth=await readFile(new URL('../../auth.js',import.meta.url),'utf8');assert(auth.includes("if (!['teacher','ta','admin'].includes(profile.role))"));
const sql=await readFile(new URL('../../backend/qa-upgrade.sql',import.meta.url),'utf8');assert(sql.includes('if not rise_private.can_answer() then raise exception'));
console.log('PASS: guest/student/TA/teacher/admin navigation, default deny, unverified and failed profile lookup, sign-out, role change; staff route and RPC guard present.');
