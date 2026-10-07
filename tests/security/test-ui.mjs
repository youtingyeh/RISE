import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {secretFindings} from '../../tools/security-check.mjs';
const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8');
const history=await read('question-history.js');
const dom=new JSDOM('<main id="root"></main>',{url:'https://example.invalid',runScripts:'outside-only'});
dom.window.eval(history);const root=dom.window.document.querySelector('#root');
const calls=[];let fail=false;
const version={version:2,title:'Title <img>',body:'reasoning',created_at:'2026-10-07',change_note:'new reasoning'};
const client={from:()=>({select:()=>({eq:()=>({order:async()=>({data:[version]})})})}),rpc:async(name,args)=>{
 calls.push({name,args});
 if(name==='rise_question_timeline')return {data:{items:args.p_offset?[]:[{...version,kind:'version'},...Array.from({length:100},(_,i)=>({kind:'reply',id:i,version:2,author_name:'Student <script>',body:'Follow-up '+i,created_at:'2026-10-07'}))]}};
 if(fail)return {error:{message:'denied'}};return {data:null};
}};
const reports=[];const result=await dom.window.RISE_QUESTION_HISTORY({client,root,user:{id:'u'},profile:{role:'student'},question:{id:'q',user_id:'u'},report:s=>reports.push(s),reload:async()=>{throw Error('offline')}});
assert.equal(result.timeline,true);assert.equal(root.querySelectorAll('article').length,100);assert.equal(root.querySelector('img'),null);assert.equal(root.querySelector('script'),null);
const more=[...root.querySelectorAll('button')].find(b=>b.textContent==='載入更多歷程');assert.equal(more.hidden,false);await more.onclick();assert.equal(calls.at(-1).args.p_offset,100);assert.equal(more.hidden,true);
const form=root.querySelector('form');for(const el of form.querySelectorAll('textarea'))el.value='filled';await form.onsubmit({preventDefault(){}});assert.match(reports.at(-1),/已保存.*不必重複提交/);
// Missing migration retains version UI instead of silently dropping the history panel.
root.replaceChildren();client.rpc=async()=>({error:{code:'PGRST202'}});
const fallback=await dom.window.RISE_QUESTION_HISTORY({client,root,user:{id:'u'},profile:{role:'student'},question:{id:'q',user_id:'u'},report:()=>{},reload:async()=>{}});assert.equal(fallback.timeline,false);assert.match(root.textContent,/提問版本歷程/);
// Evidence download is on-demand, short-lived, and uses the Storage API.
const auth=(await read('auth.js')).replace('  init();','  window.test={showEvidence,set(c){client=c;}};');
const evidence=new JSDOM('<main id="auth-root"></main><p id="auth-status"></p>',{url:'https://example.invalid',runScripts:'outside-only'});
const requests=[];evidence.window.eval(auth);evidence.window.URL.createObjectURL=()=> 'blob:test';evidence.window.URL.revokeObjectURL=()=>{};evidence.window.setTimeout=()=>0;evidence.window.HTMLAnchorElement.prototype.click=function(){};
evidence.window.fetch=async(url,opts)=>{requests.push({url,opts});return {ok:true,blob:async()=>new evidence.window.Blob(['proof'])};};
evidence.window.test.set({storage:{from:bucket=>({createSignedUrl:async(path,seconds)=>{requests.push({bucket,path,seconds});return {data:{signedUrl:'https://project.invalid/storage/signed'}};}})}});
const box=evidence.window.document.querySelector('main');await evidence.window.test.showEvidence(box,[{path:'u/proof.pdf',name:'Proof'}]);assert.equal(requests.length,0);await box.querySelector('button').onclick();assert.equal(requests[0].seconds,60);assert.equal(requests[0].bucket,'rise-credentials');assert.equal(requests[1].opts.referrerPolicy,'no-referrer');
// Public OER renderer never interpolates publication text as HTML.
dom.window.eval(await read('public-resources.js'));await dom.window.RISE_PUBLIC_RESOURCES({client:{rpc:async()=>({data:[{title:'<img src=x>',body:'<script>bad</script>',attribution:'Author',license:'CC BY',year:2026}]})},root});assert.equal(root.querySelector('img'),null);assert.equal(root.querySelector('script'),null);assert(root.querySelector('a[href="yearbook.html"]'));
const jwt=role=>Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.signature';
assert.equal(secretFindings(jwt('anon')).length,0);assert.equal(secretFindings(jwt('service_role')).length,1);
assert.equal(secretFindings('sb_'+'secret_'+'x'.repeat(30)).length,1);assert.equal(secretFindings('-----BEGIN '+'PRIVATE KEY-----').length,1);
console.log('PASS timeline pagination/fallback/XSS, committed feedback status, short-lived signed evidence, public OER safety, key scan positive/negative controls.');
dom.window.close();evidence.window.close();
for(const [role,missing] of [['admin',false],['student',true],['student',false]]){
 const d=new JSDOM('<body data-auth-page="account"><main id="auth-root"></main><p id="auth-status"></p></body>',{url:'https://example.invalid/account.html',runScripts:'outside-only'});
 const actions=[],u={id:'self',email:'self@example.invalid',email_confirmed_at:'date'};
 const db={auth:{getUser:async()=>({data:{user:u}})},rpc:async(name)=>{
  actions.push(name);
  if(missing&&name==='rise_prepare_account_delete')return {error:{code:'PGRST202'}};
  if(name==='rise_delete_my_account')return {error:{message:'rise:附件尚未清理完成'}};
  return {data:name==='rise_my_ta_certification'?[]:false};
 },from:()=>{const q={select(){return q},eq(){return q},order(){return q},single:async()=>({data:{role,display_name:'Self'}}),maybeSingle:async()=>({data:null}),range:async()=>({data:[]}),limit:async()=>({data:[]})};return q;},storage:{from:bucket=>({list:async()=>{actions.push(bucket);return {data:[]};},remove:async()=>({data:[]})})}};
 d.window.confirm=()=>true;d.window.eval((await read('auth.js')).replace('  init();','  window.test={accountPage,set(c){client=c;}};'));d.window.test.set(db);await d.window.test.accountPage();
 const button=d.window.document.querySelector('#delete-account');
 if(role==='admin')assert.equal(button,null);
 else{
  const input=d.window.document.querySelector('#delete-account-confirmation');input.value=u.email;input.dispatchEvent(new d.window.Event('input'));button.click();await new Promise(r=>setTimeout(r,10));
  assert.equal(actions[0],'rise_prepare_account_delete');
  if(missing)assert.equal(actions.length,1);
  else{assert(actions.includes('rise-work-files'));assert.equal(actions.at(-1),'rise_delete_my_account');const cancel=[...d.window.document.querySelectorAll('button')].find(x=>x.textContent==='中止未完成的刪除流程');assert.equal(cancel.disabled,false);await cancel.onclick();assert.equal(actions.at(-1),'rise_cancel_account_delete');}
 }
 d.window.close();
}
console.log('PASS account UI: admin has no self-delete control; missing migration blocks before cleanup; work files cleaned; incomplete deletion can be cancelled.');
