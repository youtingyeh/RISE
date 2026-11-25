import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import assert from 'node:assert/strict';
let source=fs.readFileSync('../../supabase/functions/rise-feedback-digest/index.ts','utf8').replace(/^import .*;$/gm,'').replace('export async function handler','async function handler').replace('Deno.serve(handler);','');
source=stripTypeScriptTypes(source,{mode:'transform'});
let role='admin',valid=true,fail=false,claim=null,claimArgs=null,finished=[],released=[],mails=[];
const result=data=>({data,error:null});
const createClient=()=>({auth:{getUser:async()=>result({user:valid?{id:'admin',email_confirmed_at:'now'}:null})},
 rpc:async(name,args)=>{if(name==='rise_claim_feedback_digest'){claimArgs=args;return result(claim);}if(name==='rise_finish_feedback_digest'){finished.push(args);return result(null);}if(name==='rise_release_feedback_digest'){released.push(args);return result(null);}return {data:null,error:{code:'x'}};},
 from(){const q={select(){return q},eq(){return q},single(){return Promise.resolve(result({role}))}};return q;}});
const nodemailer={createTransport:()=>({sendMail:async m=>{if(fail)throw Error('secret SMTP detail');mails.push(m);return {accepted:[m.to.address]}},close(){}})};
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-secret',RISE_SMTP_USER:'sender@example.org',RISE_SMTP_PASSWORD:'smtp-secret',RISE_DIGEST_TOKEN:'t'.repeat(32)};
const handler=new Function('createClient','nodemailer','Deno',source+';return handler;')(createClient,nodemailer,{env:{get:k=>env[k]}});
const summary={
 open_total:4,untriaged:2,high_open:1,stale_untriaged:1,resolved_in_window:1,
 by_kind_open:{bug:3,content:1,'private-kind-count-label':5},new_count:3,urgent_open:1,
 buckets:{new:3,needs_info:1,in_progress:3,escalated:1,awaiting_verification:1,closed:4},
 fix_ready:[{case_no:'FB-20261125-0002',page:'join.html?student=private-student',state:'fix_ready'}],
 new_items:[
  {case_no:'FB-20261125-0001',kind:'bug',page:'math.html?email=private-person',title:'private-new-title',body:'private-new-body',priority:'high'},
  {case_no:'FB-20261125-0003',kind:'security',page:'account.html?token=private-token',title:'private-urgent-title',body:'private-urgent-body',urgent:true},
  {case_no:'FB-20261125-0004',kind:'private-unknown-kind',title:'private-unknown-title',body:'private-unknown-body'},
 ],
 repeat_pages:[{page:'math.html?email=private-person',kind:'bug',count:2,titles:['private-repeat-title'],case_nos:['FB-20261125-0001','FB-20261125-0030','private-invalid-case-number']}],
 oldest_open:[{case_no:'FB-20261120-0005',title:'private-oldest-title',page:'x.html?detail=private-detail',status:'private-status'}],
};
const job={day:'2026-11-26',attempts:1,site_check:{checked:44,failed:[{page:'team.html',reason:'private-scan-reason'}],note:'private-scan-note'},summary};
const auth=()=>new Request('https://example.org',{method:'POST',headers:{Origin:'https://youtingyeh.github.io',Authorization:'Bearer token'},body:JSON.stringify({to:'attacker@example.org',site_check:{checked:1,failed:[]}})});
const cron=(token='t'.repeat(32),body={site_check:{checked:44,failed:[{page:'team.html',reason:'HTTP 404'}],note:'ok'}})=>new Request('https://example.org',{method:'POST',headers:{'x-rise-digest-token':token},body:JSON.stringify(body)});
valid=false;assert.equal((await handler(auth())).status,401);valid=true;role='student';assert.equal((await handler(auth())).status,403);assert.equal(mails.length,0);role='admin';
assert.equal((await handler(cron('wrong'))).status,401);assert.equal((await handler(new Request('https://example.org',{method:'POST',headers:{Origin:'https://evil.example'}}))).status,403);
claim=job;let r=await handler(cron());assert.equal((await r.json()).sent,true);
assert.equal(mails[0].to.address,'ytyeh@g.ntu.edu.tw');assert.equal(claimArgs.p_site_check.checked,44);assert.deepEqual(finished.at(-1),{p_day:'2026-11-26',p_sent:true});
const {subject,text}=mails[0];
assert.equal(subject,'【RISE 回報彙整】2026-11-26　新 3／未結案 4／逾期 1');
for(const expected of [
 '網站排查：檢查 44 個頁面｜異常 1 個','待補資料 1','轉交管理者 1','緊急案件未結案 1 則',
 'FB-20261125-0001 [功能異常]','FB-20261125-0003 [疑似安全問題]［緊急］','FB-20261125-0004 [其他]',
 '功能異常 2 則（FB-20261125-0001、FB-20261125-0030）','待管理者處理的修正案件：FB-20261125-0002',
 '最久未結案：FB-20261120-0005','到管理頁處理：https://youtingyeh.github.io/RISE/admin-feedback.html',
])assert(text.includes(expected),expected);
for(const forbidden of ['private-','join.html','math.html','team.html','account.html','x.html','smtp-secret','?']) {
 assert(!text.includes(forbidden),forbidden);
 assert(!subject.includes(forbidden),forbidden);
}
// 沒有新回報：排程不寄信，釋放領取；管理員手動仍可寄出。
mails=[];claim={...job,summary:{...summary,new_count:0,new_items:[]}};r=await handler(cron());let out=await r.json();assert.equal(out.skipped,true);assert.equal(mails.length,0);assert.deepEqual(released.at(-1),{p_day:'2026-11-26'});
mails=[];await handler(auth());assert.equal(mails.length,1);
// 管理員手動寄送：忽略前端指定的收件人與排查資料。
mails=[];claim=job;await handler(auth());assert.equal(mails[0].to.address,'ytyeh@g.ntu.edu.tw');assert.equal(claimArgs.p_site_check,null);
// 管理連結沿用受信任的站址設定，捨棄查詢參數和片段。
env.RISE_SITE_URL='https://school.example/RISE?private-config-query=1#private-fragment';
mails=[];await handler(auth());assert(mails[0].text.includes('https://school.example/RISE/admin-feedback.html'));
assert(!mails[0].text.includes('private-'));
delete env.RISE_SITE_URL;
// 已寄出：不重寄。
mails=[];claim=null;r=await handler(cron());assert.equal((await r.json()).sent,false);assert.equal(mails.length,0);
// SMTP 失敗：回報狀態並釋放重試，不洩漏細節。
fail=true;claim=job;r=await handler(cron());const body=await r.json();assert.equal(r.status,502);assert.equal(finished.at(-1).p_sent,false);assert(!JSON.stringify(body).includes('SMTP'));
console.log('PASS digest edge: admin or scheduled token only, server-fixed recipient, sanitized content, no resend after success, failure releases retry');
env.RISE_DIGEST_TOKEN='';r=await handler(cron());assert.equal(r.status,401);
delete env.RISE_SMTP_USER;fail=false;claim=job;r=await handler(auth());assert.equal(r.status,503);assert((await r.json()).error.includes('RISE_SMTP_USER'));console.log('PASS missing Secret identified without exposing secret values');
