import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {PGlite} from '@electric-sql/pglite';
const root=new URL('../../',import.meta.url);
const read=p=>readFile(new URL(p,root),'utf8');

// Exercise the actual Edge handler with dependency boundaries mocked.
const source=stripTypeScriptTypes((await read('supabase/functions/rise-question-advisor/index.ts')).replace(/^import .*\n/,'').replace('export async function handler','async function handler').replace('if(import.meta.main)Deno.serve(handler);',''));
let calls=0,claims=0,lastBody,mode='ok',quota=true,verified=true,role='student',configured=true;
const advice={summary:'可釐清控制變因',assumptions:['是否忽略空氣阻力？'],concepts:['質量與重量不同'],relations:['中：證據尚未控制形狀'],next_steps:['比較相同形狀物體'],revised_question:'在空氣阻力可忽略時，質量是否影響落下時間？'};
const db={auth:{getUser:async token=>({data:{user:token==='valid'?{id:'member',email_confirmed_at:verified?'date':null}:null},error:token==='valid'?null:{}})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role}})})})}),rpc:async()=>{claims++;return {data:quota};}};
const context=vm.createContext({Request,Response,Uint8Array,TextDecoder,AbortSignal,Error,JSON,
 Deno:{env:{get:n=>n==='OPENAI_MODEL'?(configured?'model':null):'test'}},createClient:()=>db,
 fetch:async(url,init)=>{calls++;lastBody=JSON.parse(init.body);assert.equal(url,'https://api.openai.com/v1/responses');if(mode==='http')return new Response('',{status:500});if(mode==='timeout'){const e=new Error();e.name='TimeoutError';throw e;}return Response.json({status:mode==='incomplete'?'incomplete':'completed',output:[{type:'message',content:mode==='refusal'?[{type:'refusal'}]:[{type:'output_text',text:mode==='invalid'?'not json':JSON.stringify(advice)}]}]});}
});
vm.runInContext(source,context);
const draft={subject:'multiple',title:'落下時間',body:'紙與硬幣的觀察',background:'',question:'',motivation:'',assumptions:'',evidence:'',impact:'',revision:''};
const req=(options={})=>new Request('https://function.test',{method:'POST',headers:{authorization:'Bearer valid',origin:'test',...options.headers},body:options.raw??JSON.stringify({draft,...options.body})});
let response=await context.handler(req());assert.equal(response.status,200);assert.deepEqual((await response.json()).advice,advice);assert.equal(lastBody.store,false);assert.equal(lastBody.text.format.strict,true);assert.equal(lastBody.input.length,1);
assert.equal((await context.handler(req({headers:{origin:'https://evil.test'}}))).status,403);
assert.equal((await context.handler(req({headers:{authorization:'Bearer invalid'}}))).status,401);
verified=false;assert.equal((await context.handler(req())).status,401);verified=true;
role='unknown';assert.equal((await context.handler(req())).status,403);role='student';
configured=false;assert.equal((await context.handler(req())).status,503);configured=true;
const before=calls;quota=false;assert.equal((await context.handler(req())).status,429);quota=true;assert.equal(calls,before);
assert.equal((await context.handler(req({raw:'x'.repeat(60001)}))).status,413);
assert.equal((await context.handler(req({raw:'{'}))).status,400);
assert.equal((await context.handler(req({body:{draft:{...draft,body:''}}}))).status,400);
for(const [value,status] of [['http',502],['timeout',503],['incomplete',502],['refusal',422],['invalid',502]]){mode=value;assert.equal((await context.handler(req())).status,status);}mode='ok';
console.log('PASS Edge: valid cross-subject input, auth, verification, roles, missing config, quota, size, JSON, refusal, incomplete, upstream errors');

// Execute actual SQL in PostgreSQL-compatible PGlite, including grants and limits.
const pg=new PGlite();
await pg.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email_confirmed_at timestamptz);create table public.rise_profiles(id uuid primary key,role text);");
await pg.exec(await read('backend/question-advisor.sql'));
await pg.exec(await read('backend/question-advisor.sql'));
const uid='00000000-0000-4000-8000-000000000001';
await pg.query("insert into auth.users values($1,now());",[uid]);await pg.query("insert into public.rise_profiles values($1,'student')",[uid]);
const claim=async()=> (await pg.query('select public.rise_claim_advisor_request($1) as allowed',[uid])).rows[0].allowed;
assert.equal(await claim(),true);assert.equal(await claim(),false);
await pg.exec("update public.rise_advisor_usage set last_request=now()-interval '1 minute',requests=9;");assert.equal(await claim(),true);
await pg.exec("update public.rise_advisor_usage set last_request=now()-interval '1 minute';");assert.equal(await claim(),false);
await pg.exec("update public.rise_advisor_usage set requests=1;insert into auth.users values('00000000-0000-4000-8000-000000000002',now());insert into public.rise_advisor_usage values('00000000-0000-4000-8000-000000000002',(now() at time zone 'UTC')::date,199,now());");assert.equal(await claim(),false);
await pg.exec('set role authenticated');
await assert.rejects(claim,/permission denied/);await assert.rejects(()=>pg.query('select * from public.rise_advisor_usage'),/permission denied/);
await pg.exec('reset role;set role service_role');assert.equal(await claim(),false);await pg.exec('reset role');
await pg.close();
console.log('PASS SQL: repeatable migration, first request, cooldown, daily caps, private table, service-only RPC');

// Real HTML DOM: analyze button must not submit, overwrite, or disable normal submission.
const {document,window}=parseHTML('<html><body><form id="question-form">'+Object.keys(draft).map(k=>'<input id="q-'+k+'">').join('')+'<button type="submit">送出</button></form></body></html>');
const form=document.querySelector('form');for(const [k,v] of Object.entries(draft))form.querySelector('#q-'+k).value=v;
let uiMode='ok',pendingResolve;
const ui=vm.createContext({document,window,URL,Event:window.Event,AbortController,TypeError,Error,setTimeout,clearTimeout,
 fetch:async()=>{if(uiMode==='pending')await new Promise(r=>pendingResolve=r);return Response.json(uiMode==='ok'||uiMode==='pending'?{advice}:{code:'not_configured'},{status:uiMode==='error'?503:200});}});
vm.runInContext(await read('question-advisor.js'),ui);window.confirm=()=>true;
window.RISE_QUESTION_ADVISOR({client:{auth:{getSession:async()=>({data:{session:{access_token:'valid'}}})}},form,config:{url:'https://project.test',publishableKey:'public'}});
const analyze=form.querySelector('[data-analyze]'),submit=form.querySelector('[type="submit"]'),result=form.querySelector('[data-result]'),status=form.querySelector('[data-status]');
const flush=()=>new Promise(r=>setTimeout(r,10));
analyze.click();await flush();assert.equal(analyze.type,'button');assert.equal(submit.disabled,false);assert.equal(form.querySelector('#q-body').value,draft.body);assert.equal(result.querySelectorAll('h4').length,5);
result.querySelector('button').click();assert.equal(form.querySelector('#q-question').value,advice.revised_question);assert.equal(result.querySelector('button').disabled,true);
uiMode='error';analyze.click();await flush();assert.match(status.textContent,/尚未啟用/);assert.equal(submit.disabled,false);
uiMode='pending';analyze.click();await flush();form.querySelector('#q-body').value='changed';form.dispatchEvent(new window.Event('input',{bubbles:true}));pendingResolve();await flush();assert.equal(result.children.length,0);
form.dispatchEvent(new window.Event('reset'));assert.equal(status.textContent,'');
console.log('PASS UI: safe rendering, manual adoption, error leaves submit enabled, stale response discarded, reset clears advice');

// Independent management page and no hand-entered duration.
const admin=await read('admin-console.js'),page=await read('admin-videos.html'),video=await read('video-manager.js');
assert(admin.includes('href="admin-videos.html"'));assert(!admin.includes('RISE_VIDEO_MANAGER'));assert(page.includes('data-auth-page="admin-videos"'));assert(page.indexOf('video-manager.js')<page.indexOf('auth.js?'));assert(!video.includes("['duration'"));
vm.runInContext(video,ui);for(const role of ['student','teacher','ta'])await window.RISE_VIDEO_MANAGER({profile:{role},user:{email_confirmed_at:'date'},root:{prepend(){throw Error('unauthorized UI')}}});
assert.equal(window.RISE_PARSE_YOUTUBE('https://youtu.be/abcdefghijk'),'abcdefghijk');assert.throws(()=>window.RISE_PARSE_YOUTUBE('https://evil.test/abcdefghijk'));
assert(!(await read('resources.js')).includes("$('#res-learning')"));
console.log('PASS video: independent admin link, script order, non-admin denied, no duration field, URL validation; removed obsolete resource selector');
