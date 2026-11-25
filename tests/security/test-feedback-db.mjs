import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const pg=new PGlite();
await pg.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
create table public.rise_profiles(id uuid primary key references auth.users(id),role text,display_name text);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;`);
const sql=await readFile(new URL('../../backend/feedback.sql',import.meta.url),'utf8');
await pg.exec(sql);await pg.exec(sql);
const users={};for(const [i,role] of ['student','other','admin','unverified','teacher'].entries()){
 const id='00000000-0000-4000-8000-'+String(i+1).padStart(12,'0');users[role]=id;
 await pg.query('insert into auth.users values($1,$2)',[id,role==='unverified'?null:new Date().toISOString()]);
 await pg.query('insert into rise_profiles values($1,$2,$3)',[id,role==='other'?'student':role==='unverified'?'student':role,role+' name']);
}
async function as(role,fn){await pg.query("select set_config('app.uid',$1,false)",[users[role]||'']);await pg.exec('set role '+(role==='service'?'service_role':role?'authenticated':'anon'));try{return await fn();}finally{await pg.exec('reset role');}}
const q=(role,text,args=[])=>as(role,async()=>(await pg.query(text,args)).rows);
const submit=(role,o={})=>q(role,'select public.rise_submit_feedback($1,$2,$3,$4,$5) id',[o.kind||'bug',o.page??'math.html',o.title||'按鈕沒有反應',o.body||'在手機上按下送出沒有反應，請協助確認。',o.info||'Chrome 390px']).then(r=>r[0].id);

// 權限：未登入、未驗證不可送出；資料表不可直接讀寫。
await assert.rejects(()=>submit(null),/permission denied|登入/);
await assert.rejects(()=>submit('unverified'),/驗證/);
await assert.rejects(()=>q('student',"insert into public.rise_feedback(user_id,kind,title,body) values(gen_random_uuid(),'bug','x1x','xxxxxxxxxxxx')"));
await assert.rejects(()=>q('student','select * from public.rise_feedback'));
await assert.rejects(()=>q(null,'select * from public.rise_my_feedback()'));
// 驗證輸入。
await assert.rejects(()=>submit('student',{kind:'spam'}),/類型/);
await assert.rejects(()=>submit('student',{title:'ab'}),/標題/);
await assert.rejects(()=>submit('student',{body:'太短'}),/說明/);
// 送出與去重。
const id1=await submit('student');assert.equal(await submit('student'),id1);
const sneaky=await submit('student',{page:'https://evil.example/x?token=1',title:'外部連結測試',body:'頁面欄位含外部網址，應被清除。'});
assert.equal((await pg.query('select page from rise_feedback where id=$1',[sneaky])).rows[0].page,'');
const id2=await submit('other',{title:'同頁另一個問題',body:'同一頁面上的第二個問題，用來測試重複彙整。'});
// 只看到自己的，且沒有內部備註欄位。
const mine=await q('student','select * from public.rise_my_feedback()');
assert.equal(mine.length,2);assert(!('admin_note' in mine[0]));assert((await q('other','select * from public.rise_my_feedback()')).every(r=>r.id===id2));
// 非管理員不可使用管理 RPC（含教師）。
for(const role of ['student','teacher','unverified',null]){
 await assert.rejects(()=>q(role,'select public.rise_admin_feedback()'));
 await assert.rejects(()=>q(role,"select public.rise_admin_triage_feedback($1,'resolved','normal','','')",[id1]));
 await assert.rejects(()=>q(role,'select public.rise_admin_feedback_summary()'));
}
// 管理員讀取與處理。
const list=(await q('admin','select public.rise_admin_feedback($1) d',['open']))[0].d;
assert.equal(list.length,3);assert.equal(list.find(r=>r.id===id1).similar_open,1);assert.equal(list.find(r=>r.id===id1).submitter,'student name');
await assert.rejects(()=>q('admin',"select public.rise_admin_triage_feedback($1,'duplicate','normal','','')",[id1]),/重複/);
await q('admin',"select public.rise_admin_triage_feedback($1,'duplicate','low','與另一則相同','已合併處理',$2)",[id2,id1]);
await q('admin',"select public.rise_admin_triage_feedback($1,'resolved','high','已修正','已在今日更新修正，謝謝回報。')",[id1]);
await assert.rejects(()=>q('admin',"select public.rise_admin_triage_feedback($1,'bogus','high','','')",[id1]),/狀態/);
const after=await q('student','select * from public.rise_my_feedback()');
assert.equal(after.find(r=>r.id===id1).status,'resolved');assert.equal(after.find(r=>r.id===id1).public_reply,'已在今日更新修正，謝謝回報。');
assert.equal((await pg.query('select count(*)::int n from rise_feedback_events')).rows[0].n,2);
assert.equal((await q('admin',"select public.rise_admin_feedback('resolved') d"))[0].d.length,1);
// 24 小時 10 則限制。
for(let i=0;i<8;i++)await submit('teacher',{title:'限流測試 '+i,body:'限流測試內容第 '+i+' 則，長度足夠。'});
await submit('teacher',{title:'限流測試 8',body:'限流測試內容第 8 則，長度足夠。'});await submit('teacher',{title:'限流測試 9',body:'限流測試內容第 9 則，長度足夠。'});
await assert.rejects(()=>submit('teacher',{title:'限流測試 10',body:'限流測試內容第 10 則，長度足夠。'}),/最多送出 10 則/);
// 每日彙整：只有 service_role；同日只寄一次；失敗可重試；新收集不重複計算。
await assert.rejects(()=>q('admin',"select public.rise_claim_feedback_digest('2026-11-26')"));
const day1=(await q('service',"select public.rise_claim_feedback_digest('2026-11-26','{\"pages\":44,\"failed\":[]}'::jsonb) d"))[0].d;
assert.equal(day1.summary.new_count,13);assert.equal(day1.summary.resolved_in_window,1);assert.equal(day1.site_check.pages,44);
assert.equal((await q('service',"select public.rise_claim_feedback_digest('2026-11-26') d"))[0].d,null); // 寄送中不重領
await q('service',"select public.rise_finish_feedback_digest('2026-11-26',false)");
await pg.query("update rise_feedback_digest set available_at=now()-interval '1 minute'");
assert.equal((await q('service',"select public.rise_claim_feedback_digest('2026-11-26') d"))[0].d.attempts,2);
await q('service',"select public.rise_finish_feedback_digest('2026-11-26',true)");
assert.equal((await q('service',"select public.rise_claim_feedback_digest('2026-11-26') d"))[0].d,null); // 已寄出不重寄
await submit('student',{title:'隔天新增的回報',body:'這是隔天才收到的新回報內容。',page:'physics.html'});
const day2=(await q('service',"select public.rise_claim_feedback_digest('2026-11-27') d"))[0].d;
assert.equal(day2.summary.new_count,1);assert.equal(day2.summary.new_items[0].title,'隔天新增的回報');
assert(day2.summary.open_total>=1);
// 釋放（當天沒有新回報、未寄信）：不留下已寄出紀錄，隔天區間不漏算。
await q('service',"select public.rise_finish_feedback_digest('2026-11-27',true)");
const day3=(await q('service',"select public.rise_claim_feedback_digest('2026-11-28') d"))[0].d;assert.equal(day3.summary.new_count,0);
await q('service',"select public.rise_release_feedback_digest('2026-11-28')");assert.equal((await pg.query("select count(*)::int n from rise_feedback_digest where day='2026-11-28'")).rows[0].n,0);
await assert.rejects(()=>q('admin',"select public.rise_release_feedback_digest('2026-11-27')"));
await submit('student',{title:'第三天的回報',body:'第三天才收到的新回報內容。',page:'chemistry.html'});assert.equal((await q('service',"select public.rise_claim_feedback_digest('2026-11-29') d"))[0].d.summary.new_count,1);
// 重複套用 migration 不清資料。
await pg.exec(sql);assert.equal((await pg.query('select count(*)::int n from rise_feedback')).rows[0].n,15);
for(const t of ['rise_feedback','rise_feedback_events','rise_feedback_digest'])assert.equal((await pg.query('select relrowsecurity r from pg_class where relname=$1',[t])).rows[0].r,true);
await pg.close();console.log('PASS feedback SQL: verified-member submit, validation, dedupe, rate limit, own-only reads without admin notes, admin-only triage/audit, daily digest idempotency and retry, repeatable migration.');
