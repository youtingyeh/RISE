import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const source=await readFile(new URL('../../feedback.js',import.meta.url),'utf8');
const user={id:'member',email_confirmed_at:'2026-11-25T00:00:00Z'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(mode,rpc,{signedIn=user,query=''}={}){
  const file=mode==='admin'?'admin-feedback.html':'feedback.html';
  const dom=new JSDOM(`<body data-feedback="${mode}"><p id="feedback-status"></p><div id="feedback-root"></div></body>`,{
    url:`https://example.test/RISE/${file}${query}`,runScripts:'outside-only',
  });
  const {window}=dom;
  let listener;
  window.RISE_NAV_CLIENT={auth:{getUser:async()=>({data:{user:signedIn}}),onAuthStateChange:fn=>{listener=fn;}},rpc};
  window.confirm=()=>true;
  window.eval(source);
  return {window,document:window.document,signOut:()=>listener('SIGNED_OUT'),close:()=>window.close()};
}
const click=(document,label)=>{
  const button=[...document.querySelectorAll('button')].find(node=>node.textContent===label);
  assert.ok(button,`Missing ${label}`);
  button.click();
};

{
  const guest=fixture('member',()=>assert.fail('Guest called member RPC'),{signedIn:null});
  await tick();
  assert.equal(guest.document.querySelector('form'),null);
  assert.ok(guest.document.querySelector('a[href="login.html"]'));
  guest.close();

  const unavailable=fixture('member',async name=>name==='rise_feedback_submission_ready'?
    {error:{code:'PGRST202'}}:{data:[]});
  await tick();
  assert.equal(unavailable.document.querySelector('.fb-form'),null);
  assert.match(unavailable.document.getElementById('feedback-root').textContent,/暫時無法送出回報/);
  unavailable.close();

  let finishListing;
  const pendingListing=new Promise(resolve=>{finishListing=resolve;});
  const submitted=[];
  const member=fixture('member',async(name,params)=>{
    if(name==='rise_feedback_submission_ready')return {data:true};
    if(name==='rise_my_feedback')return pendingListing;
    if(name==='rise_submit_feedback'){submitted.push(params);return {data:{case_no:'FB-20261125-0001'}};}
    assert.fail(`Unexpected member request: ${name}`);
  },{query:'?kind=suggestion&page=join.html%3Fprivate%3Dtest%23fragment'});
  await tick();
  const form=member.document.querySelector('.fb-form');
  const body=form.querySelector('textarea');
  const page=form.querySelector('input[list]');
  assert.equal(page.value,'join.html');
  body.value='這是一段送出前應保留的測試草稿內容';
  finishListing({data:[]});
  await tick();
  assert.equal(member.document.querySelector('.fb-form'),form);
  assert.match(body.value,/應保留/);
  page.value='join.html?secret=discard#also-discard';
  form.requestSubmit();
  await tick();
  assert.equal(submitted.length,1);
  assert.equal(submitted[0].p_page,'join.html');
  assert.equal(submitted[0].p_client_info,'');
  member.signOut();
  assert.equal(member.document.querySelector('.fb-form'),null);
  member.close();
}

{
  const calls=[];
  let enabled=false;
  let authorization=null;
  let evidence=null;
  const row={id:'case',case_no:'FB-20261125-0002',kind:'bug',page:'join.html',triage_class:'link_candidate',title:'broken link',body:'<b>literal</b>',status:'new',priority:'normal',admin_note:'internal',public_reply:'private reply'};
  const admin=fixture('admin',async(name,params)=>{
    calls.push([name,params]);
    if(name==='rise_admin_feedback')return {data:params.p_status==='urgent'?[]:[{...row,autofix:authorization?{state:'queued',attempts:0,authorization,link_text:'前往會員中心',...evidence}:null}]};
    if(name==='rise_admin_feedback_summary')return {data:{repeat_pages:[]}};
    if(name==='rise_feedback_get_repair_settings')return {data:{enabled}};
    if(name==='rise_feedback_set_repair_settings'){enabled=params.p_enabled;return {data:{enabled}};}
    if(name==='rise_feedback_repair_authorize'){authorization='9f13e895-da39-47b9-8f5f-afc28b300d32';return {data:null};}
    if(name==='rise_feedback_repair_revoke'){authorization=null;return {data:null};}
    assert.fail(`Unexpected admin request: ${name}`);
  });
  await tick();
  assert.equal(admin.document.querySelector('.fb-item b'),null);
  assert.match(admin.document.querySelector('.fb-repair-settings').textContent,/排程設定：關閉/);
  assert.doesNotMatch(admin.document.getElementById('feedback-root').textContent,/核准發布/);
  click(admin.document,'開啟修正草稿排程');
  await tick();
  assert.deepEqual({...calls.find(([name])=>name==='rise_feedback_set_repair_settings')[1]},{p_enabled:true});
  assert.match(admin.document.querySelector('.fb-repair-settings').textContent,/排程設定：開啟/);
  const form=admin.document.querySelector('.fb-repair-authorize');
  form.querySelector('input').value='前往會員中心';
  evidence={state:'fix_ready',workflow_run_url:'https://github.com/youtingyeh/RISE/actions/runs/123',workflow_patch_name:'fix-01.patch'};
  form.requestSubmit();
  await tick();
  assert.deepEqual({...calls.find(([name])=>name==='rise_feedback_repair_authorize')[1]},{p_feedback:'case',p_link_text:'前往會員中心'});
  assert.ok(admin.document.querySelector('a[href="https://github.com/youtingyeh/RISE/actions/runs/123"]'));
  assert.match(admin.document.querySelector('.fb-autofix').textContent,/fix-01\.patch/);
  click(admin.document,'撤銷本案草稿授權');
  await tick();
  assert.deepEqual({...calls.find(([name])=>name==='rise_feedback_repair_revoke')[1]},{p_feedback:'case'});
  assert.ok(admin.document.querySelector('.fb-repair-authorize'));
  assert.equal(admin.document.querySelector('.fb-triage option[value="wontfix"]').textContent,'接受現況');
  admin.signOut();
  assert.equal(admin.document.querySelector('.fb-item'),null);
  admin.close();
}

console.log('PASS feedback UI: submission readiness, draft preservation, private payload, sign-out clearing, admin opt-in switch and case authorization/revocation.');
