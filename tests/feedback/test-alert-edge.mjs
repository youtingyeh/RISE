import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import assert from 'node:assert/strict';
let source=fs.readFileSync('../../supabase/functions/rise-feedback-alert/index.ts','utf8').replace(/^import .*;$/gm,'').replace('export async function handler','async function handler').replace('Deno.serve(handler);','');
source=stripTypeScriptTypes(source,{mode:'transform'});
let valid=true,fail=false,queue=[],finished=[],mails=[];
const result=data=>({data,error:null});
const createClient=()=>({auth:{getUser:async()=>result({user:valid?{id:'u',email_confirmed_at:'now'}:null})},rpc:async(name,args)=>{if(name==='rise_claim_feedback_alert')return result(queue.splice(0,1));if(name==='rise_finish_feedback_alert'){finished.push(args);return result(null);}return {data:null,error:{code:'x'}};}});
const nodemailer={createTransport:()=>({sendMail:async m=>{if(fail)throw Error('smtp secret detail');mails.push(m);return {accepted:[m.to.address]}},close(){}})};
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'srv',RISE_SMTP_USER:'sender@example.org',RISE_SMTP_PASSWORD:'pw',RISE_DIGEST_TOKEN:'t'.repeat(32)};
const handler=new Function('createClient','nodemailer','Deno',source+';return handler;')(createClient,nodemailer,{env:{get:k=>env[k]}});
const member=()=>new Request('https://example.org',{method:'POST',headers:{Origin:'https://youtingyeh.github.io',Authorization:'Bearer t'},body:JSON.stringify({to:'attacker@example.org',text:'偽造內容'})});
const job=(id=1)=>({id,feedback_id:'f',case_no:'FB-20261125-0007',kind:'security',created_at:'2026-11-25T01:00:00Z'});
valid=false;assert.equal((await handler(member())).status,401);valid=true;
assert.equal((await handler(new Request('https://example.org',{method:'POST',headers:{'x-rise-digest-token':'bad'}}))).status,401);
assert.equal((await handler(new Request('https://example.org',{method:'POST',headers:{Origin:'https://evil.example',Authorization:'Bearer t'}}))).status,403);
queue=[job(1)];let r=await handler(member());assert.deepEqual(await r.json(),{sent:1,failed:0});
assert.equal(mails[0].to.address,'ytyeh@g.ntu.edu.tw');assert(mails[0].subject.includes('FB-20261125-0007'));assert(mails[0].text.includes('admin-feedback.html'));
assert(!mails[0].text.includes('偽造內容')&&!mails[0].text.includes('attacker'));assert.deepEqual(finished.at(-1),{p_id:1,p_sent:true});
// 沒有佇列：不寄信。排程 token 也可呼叫。
mails=[];r=await handler(new Request('https://example.org',{method:'POST',headers:{'x-rise-digest-token':'t'.repeat(32)}}));assert.deepEqual(await r.json(),{sent:0,failed:0});assert.equal(mails.length,0);
// 失敗：釋放重試，不洩漏細節。
fail=true;queue=[job(2)];r=await handler(member());const out=await r.json();assert.equal(out.failed,1);assert.deepEqual(finished.at(-1),{p_id:2,p_sent:false});assert(!JSON.stringify(out).includes('smtp'));
console.log('PASS alert edge: verified member or schedule token, fixed recipient, content-free message, retry on failure, no forged content');
