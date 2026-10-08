import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM,VirtualConsole} from 'jsdom';
const source=await readFile(new URL('../../site-features.js',import.meta.url),'utf8');
const editor=await readFile(new URL('../../admin-features.js',import.meta.url),'utf8');
const nav=await readFile(new URL('../../role-navigation.js',import.meta.url),'utf8');
const keys=['science','videos','questions','modules','assignments','discussions','competitions','gallery','dialogues','yearbook','ta_training','ta_forum','plc','club_grants','learning_report','schedule'];
const state=(on=true,admin=false)=>({flags:Object.fromEntries(keys.map(k=>[k,on])),version:1,is_admin:admin});
const pause=()=>new Promise(r=>setTimeout(r,20));
async function setup(path='index.html',data=state()){
 const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e));
 const dom=new JSDOM('<header><nav aria-label="主要導覽"></nav></header><main><a id="contest" href="competitions.html">Contest</a><a id="external" href="https://example.org/competitions.html">External</a><section data-site-feature="competitions">Cards</section><div id="settings"></div></main>',{url:'https://example.test/RISE/'+path,runScripts:'outside-only',virtualConsole});
 const w=dom.window;w.RISE_AUTH_CONFIG={url:'https://example.invalid',publishableKey:'test'};w.fetch=async()=>({ok:!data.code,json:async()=>data});w.setInterval=()=>0;
 const observers=[],NativeObserver=w.MutationObserver,close=w.close.bind(w);
 w.MutationObserver=class extends NativeObserver{constructor(fn){super(fn);observers.push(this);}};
 w.close=()=>{observers.forEach(o=>o.disconnect());assert.deepEqual(errors,[]);close();};
 w.eval(source);await pause();return {dom,w,api:w.RISE_FEATURES};
}
{
 const data=state();data.flags.competitions=false;const {dom,w,api}=await setup('competitions.html',data);
 assert(w.document.querySelector('main').classList.contains('rise-area-main-hidden'));
 assert(w.document.querySelector('#site-feature-gate').textContent.includes('尚未開放'));
 assert(w.document.querySelector('#contest').classList.contains('rise-feature-hidden'));
 assert(!w.document.querySelector('#external').classList.contains('rise-feature-hidden'));
 const late=w.document.createElement('a');late.href='competitions.html';w.document.querySelector('main').append(late);await pause();assert(late.classList.contains('rise-feature-hidden'));
 let identityCallback;data.is_admin=true;
 w.RISE_NAV_CLIENT={auth:{onAuthStateChange:cb=>{identityCallback=cb;}},rpc:()=>({abortSignal:async()=>({data})})};w.dispatchEvent(new w.Event('rise-nav-client'));await pause();
 assert.equal(api.state.admin,true);assert(!w.document.querySelector('main').classList.contains('rise-area-main-hidden'));assert(w.document.querySelector('#site-feature-gate').textContent.includes('管理員預覽'));
 data.is_admin=false;identityCallback('SIGNED_OUT');assert(w.document.querySelector('main').classList.contains('rise-area-main-hidden'));await pause();
 dom.window.close();
}
{
 const {dom,w,api}=await setup('yearbook.html',{code:'PGRST202'});assert.equal(api.state.status,'missing');assert(!w.document.querySelector('main').classList.contains('rise-area-main-hidden'));dom.window.close();
}
{
 const {dom,w,api}=await setup('yearbook.html',{code:'NETWORK'});assert.equal(api.state.status,'error');assert(w.document.querySelector('#site-feature-gate').textContent.includes('暫時無法'));dom.window.close();
}
{
 const data=state(false);const {dom,w}=await setup('index.html',data);w.eval(nav);await pause();
 assert.equal(w.document.querySelector('.rise-nav-group').classList.contains('rise-feature-hidden'),true);
 assert.equal(w.document.querySelector('a[href="account.html"]').classList.contains('rise-feature-hidden'),false);
 assert.equal(w.document.querySelector('main').classList.contains('rise-area-main-hidden'),false);dom.window.close();
}
for(const page of ['support.html','resources.html','resources.html?id=example']){
 const {dom,w}=await setup(page,state(false));assert(w.document.querySelector('main').classList.contains('rise-area-main-hidden'));dom.window.close();
}
{
 const data=state(true,true);const {dom,w,api}=await setup('admin-console.html');let writes=0,fail=false;
 w.confirm=()=>true;
 w.RISE_NAV_CLIENT={auth:{onAuthStateChange:()=>{}},rpc:(name,args)=>name==='rise_site_features'?{abortSignal:async()=>({data:structuredClone(data)})}:{abortSignal:()=>Promise.resolve().then(()=>{
  writes++;if(fail)return {error:{code:'40001'}};Object.assign(data.flags,args.p_changes);data.version++;return {data:structuredClone(data)};
 })}};w.dispatchEvent(new w.Event('rise-nav-client'));await pause();w.eval(editor);
 await w.RISE_ADMIN_FEATURES({root:w.document.querySelector('#settings'),user:{email_confirmed_at:'yes'},profile:{role:'admin'}});await pause();
 assert.equal(w.document.querySelectorAll('[role="switch"]').length,16);
 w.document.querySelector('#site-toggle-competitions').click();await pause();assert.equal(writes,1);assert.equal(api.state.flags.competitions,false);
 fail=true;w.document.querySelector('#site-toggle-yearbook').click();await pause();assert.equal(api.state.flags.yearbook,true);assert(w.document.querySelector('#settings').textContent.includes('沒有覆蓋'));
 fail=false;[...w.document.querySelectorAll('button')].find(b=>b.textContent==='套用精簡模式').click();await pause();assert.deepEqual(Object.keys(api.state.flags).filter(k=>api.state.flags[k]),['science','videos','questions','schedule']);
 assert.equal(w.document.querySelector('[role="switch"]').getAttribute('aria-checked'),'true');dom.window.close();
}
console.log('PASS feature UI: route closure, dynamic links, admin preview/logout, missing SQL, network failure, empty menus, admin switches, conflict handling, simple preset.');
