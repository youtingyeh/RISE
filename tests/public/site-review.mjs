import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {JSDOM,VirtualConsole} from 'jsdom';
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8');
const info=await read('site-info.js'),shell=await read('site-shell.js'),features=await read('site-features.js'),auth=await read('auth.js');
const tick=()=>new Promise(r=>setTimeout(r,15));
function setup(html,url='index.html'){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
 const d=new JSDOM(html,{url:'https://youtingyeh.github.io/RISE/'+url,runScripts:'outside-only',virtualConsole:vc});
 const w=d.window,observers=[],Native=w.MutationObserver,close=w.close.bind(w);
 w.MutationObserver=class extends Native{constructor(fn){super(fn);observers.push(this);}};
 w.close=()=>{observers.forEach(o=>o.disconnect());assert.deepEqual(errors,[]);close();};return d;
}
// One shared footer even when an async renderer replaces it; text remains safe.
{
 const d=setup('<footer class="site-footer">old</footer>');d.window.eval(info);d.window.eval(shell);await tick();
 let f=d.window.document.querySelector('footer');assert.equal(f.querySelectorAll('a[href="mailto:ytyeh@g.ntu.edu.tw"]').length,1);
 assert(f.textContent.includes('化學'));assert(f.textContent.includes('營運中心（擬設）'));
 f.outerHTML='<footer class="site-footer">replacement</footer>';await tick();f=d.window.document.querySelector('footer');assert(f.querySelector('a[href="join.html"]'));assert.equal(f.querySelectorAll('[aria-label="頁尾導覽"]').length,1);d.window.close();
}
// Outage preserves explicitly marked introductory text, never the feature entry or route.
for(const path of ['index.html','science.html']){
 const d=setup('<main><article data-site-feature="science" data-public-introduction>Introduction<a href="science.html">Open</a></article><section data-site-feature="science">Materials</section></main>',path),w=d.window;
 w.RISE_AUTH_CONFIG={url:'https://example.invalid',publishableKey:'public'};w.setInterval=()=>0;
 w.fetch=async()=>({ok:false,json:async()=>({code:'NETWORK'})});w.eval(features);await tick();
 assert(!w.document.querySelector('article').classList.contains('rise-feature-hidden'));
 assert(w.document.querySelector('article a').classList.contains('rise-feature-hidden'));
 assert(w.document.querySelector('main section').classList.contains('rise-feature-hidden'));
 assert.equal(w.document.querySelector('main').classList.contains('rise-area-main-hidden'),path==='science.html');
 const flags=Object.fromEntries(w.RISE_FEATURES.catalog.map(([key])=>[key,false]));
 w.fetch=async()=>({ok:true,json:async()=>({flags,version:1,is_admin:false})});await w.RISE_FEATURES.refresh();
 assert(w.document.querySelector('article').classList.contains('rise-feature-hidden'));d.window.close();
}
// Registration query parameters preselect intent; arbitrary role values cannot add authority.
for(const [kind,expected] of [['ta','ta'],['teacher','teacher'],['admin','student'],['<script>','student']]){
 const d=setup('<body data-auth-page="register"><div id="auth-root"></div><p id="auth-status"></p><div id="auth-notice"></div></body>','register.html?kind='+encodeURIComponent(kind));
 d.window.eval(auth.replace('  init();','  window.renderRegistration=renderPublic;'));d.window.renderRegistration();
 assert.equal(d.window.document.querySelector('input[name="kind"]:checked').value,expected);assert.equal(d.window.document.querySelector('input[value="admin"]'),null);d.window.close();
}
// Initialization exceptions produce only one friendly notice, never raw technical details.
{
 const d=setup('<body data-auth-page="login"><div id="auth-root"></div><p id="auth-status"></p><div id="auth-notice"></div></body>','login.html');
 d.window.RISE_AUTH_CONFIG={url:'https://example.invalid',publishableKey:'public'};
 d.window.supabase={createClient(){throw Error("Cannot set properties of null (setting 'onclick')");}};
 d.window.eval(auth);await tick();
 assert.equal(d.window.document.querySelector('#auth-status').textContent,'');assert.match(d.window.document.querySelector('#auth-notice').textContent,/暫時無法載入/);assert(!d.window.document.body.textContent.includes('onclick'));d.window.close();
}
// Public recruitment works without executing scripts or connecting to the database.
const join=await read('join.html'),j=new JSDOM(join);assert(j.window.document.querySelector('a[href="register.html?kind=ta"]'));assert(j.window.document.querySelector('a[href="register.html?kind=teacher"]'));assert(j.window.document.querySelector('#join-ta'));assert(j.window.document.querySelector('a[href="#join-main"]'));j.window.close();
const sitemap=await read('sitemap.xml');for(const p of ['math.html','physics.html','chemistry.html','join.html'])assert(sitemap.includes('/'+p));
for(const p of ['admin-console.html','account.html','questions.html','reset-password.html'])assert(!sitemap.includes('/'+p));
for(const p of (await readdir(new URL('../../',import.meta.url))).filter(p=>p.endsWith('.html'))){
 const html=await read(p),doc=new JSDOM(html);assert.equal(doc.window.document.querySelectorAll('meta[name="description"]').length,1,p);assert(doc.window.document.querySelector('meta[property="og:image"]'),p);assert(doc.window.document.querySelector('link[rel="icon"]'),p);assert(html.indexOf('<meta charset=')<100,p);doc.window.close();
}
const homepage=await read('index.html');assert(!homepage.includes('15 個檔案版本'));assert(!homepage.includes('複製給我'));
console.log('PASS public review: shared footer, outage/closed-area separation, recruitment without login, role-intent allowlist, friendly single error, social metadata and three-subject sitemap.');
