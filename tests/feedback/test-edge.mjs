import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import assert from 'node:assert/strict';
let source=fs.readFileSync('../../supabase/functions/rise-feedback-digest/index.ts','utf8').replace(/^import .*;$/gm,'').replace('export async function handler','async function handler').replace('Deno.serve(handler);','');
source=stripTypeScriptTypes(source,{mode:'transform'});
let role='admin',valid=true,fail=false,claim=null,claimArgs=null,finished=[],mails=[];
const result=data=>({data,error:null});
const createClient=()=>({auth:{getUser:async()=>result({user:valid?{id:'admin',email_confirmed_at:'now'}:null})},
 rpc:async(name,args)=>{if(name==='rise_claim_feedback_digest'){claimArgs=args;return result(claim);}if(name==='rise_finish_feedback_digest'){finished.push(args);return result(null);}return {data:null,error:{code:'x'}};},
 from(){const q={select(){return q},eq(){return q},single(){return Promise.resolve(result({role}))}};return q;}});
const nodemailer={createTransport:()=>({sendMail:async m=>{if(fail)throw Error('secret SMTP detail');mails.push(m);return {accepted:[m.to.address]}},close(){}})};
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-secret',RISE_SMTP_USER:'sender@example.org',RISE_SMTP_PASSWORD:'smtp-secret',RISE_DIGEST_TOKEN:'t'.repeat(32)};
const handler=new Function('createClient','nodemailer','Deno',source+';return handler;')(createClient,nodemailer,{env:{get:k=>env[k]}});
const summary={window:{since:'2026-11-25T00:00:00Z',until:'2026-11-26T00:00:00Z'},open_total:4,untriaged:2,high_open:1,stale_untriaged:1,resolved_in_window:1,by_kind_open:{bug:3,content:1},new_count:2,
 new_items:[{kind:'bug',page:'math.html',title:'按鈕沒反應\n<script>',body:'手機上點不到',priority:'high'},{kind:'content',page:'',title:'錯字',body:'第二段有錯字',priority:'normal'}],
 repeat_pages:[{page:'math.html',kind:'bug',count:2,titles:['按鈕沒反應','選單']}],oldest_open:[{title:'舊問題',page:'x.html',status:'new',created_at:'2026-11-20T00:00:00Z'}]};
const job={day:'2026-11-26',attempts:1,site_check:{checked:44,failed:[{page:'team.html',reason:'HTTP 404'}]},summary};
const auth=()=>new Request('https://example.org',{method:'POST',headers:{Origin:'https://youtingyeh.github.io',Authorization:'Bearer token'},body:JSON.stringify({to:'attacker@example.org',site_check:{checked:1,failed:[]}})});
const cron=(token='t'.repeat(32),body={site_check:{checked:44,failed:[{page:'team.html',reason:'HTTP 404'}],note:'ok'}})=>new Request('https://example.org',{method:'POST',headers:{'x-rise-digest-token':token},body:JSON.stringify(body)});
valid=false;assert.equal((await handler(auth())).status,401);valid=true;role='student';assert.equal((await handler(auth())).status,403);assert.equal(mails.length,0);role='admin';
assert.equal((await handler(cron('wrong'))).status,401);assert.equal((await handler(new Request('https://example.org',{method:'POST',headers:{Origin:'https://evil.example'}}))).status,403);
claim=job;let r=await handler(cron());assert.equal((await r.json()).sent,true);
assert.equal(mails[0].to.address,'ytyeh@g.ntu.edu.tw');assert.equal(claimArgs.p_site_check.checked,44);assert.deepEqual(finished.at(-1),{p_day:'2026-11-26',p_sent:true});
const text=mails[0].text;for(const s of ['新 2／未結案 4／逾期 1']){assert(mails[0].subject.includes(s));}
for(const s of ['team.html：HTTP 404','按鈕沒反應 <script>','math.html（網站問題）2 則','舊問題','admin-feedback.html'])assert(text.includes(s),s);
assert(!text.includes('\n<script>'));assert(!text.includes('smtp-secret'));
// 管理員手動寄送：忽略前端指定的收件人與排查資料。
mails=[];claim=job;await handler(auth());assert.equal(mails[0].to.address,'ytyeh@g.ntu.edu.tw');assert.equal(claimArgs.p_site_check,null);
// 已寄出：不重寄。
mails=[];claim=null;r=await handler(cron());assert.equal((await r.json()).sent,false);assert.equal(mails.length,0);
// SMTP 失敗：回報狀態並釋放重試，不洩漏細節。
fail=true;claim=job;r=await handler(cron());const body=await r.json();assert.equal(r.status,502);assert.equal(finished.at(-1).p_sent,false);assert(!JSON.stringify(body).includes('SMTP'));
console.log('PASS digest edge: admin or scheduled token only, server-fixed recipient, sanitized content, no resend after success, failure releases retry');
env.RISE_DIGEST_TOKEN='';r=await handler(cron());assert.equal(r.status,401);
delete env.RISE_SMTP_USER;fail=false;claim=job;r=await handler(auth());assert.equal(r.status,503);assert((await r.json()).error.includes('RISE_SMTP_USER'));console.log('PASS missing Secret identified without exposing secret values');
