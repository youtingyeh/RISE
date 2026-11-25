import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const pg=new PGlite();
await pg.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
create table public.rise_profiles(id uuid primary key references auth.users(id),role text,display_name text);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;`);
for(const f of ['feedback.sql','feedback-autofix.sql','feedback-autofix.sql'])await pg.exec(await readFile(new URL('../../backend/'+f,import.meta.url),'utf8'));
const users={};for(const [i,role] of ['student','admin','teacher'].entries()){
 const id='00000000-0000-4000-8000-'+String(i+1).padStart(12,'0');users[role]=id;
 await pg.query('insert into auth.users values($1,now())',[id]);await pg.query('insert into rise_profiles values($1,$2,$3)',[id,role,role]);
}
async function as(role,fn){await pg.query("select set_config('app.uid',$1,false)",[users[role]||'']);await pg.exec('set role '+(role==='service'?'service_role':role?'authenticated':'anon'));try{return await fn();}finally{await pg.exec('reset role');}}
const q=(role,text,args=[])=>as(role,async()=>(await pg.query(text,args)).rows);
const submit=(role,o)=>q(role,'select public.rise_submit_feedback($1,$2,$3,$4,$5,$6,$7,$8) r',[o.kind,o.page??'',o.title??'',o.body,o.steps??'',o.expected??'',o.actual??'','test']).then(r=>r[0].r);
const linkBug={kind:'bug',page:'join.html',title:'【模擬案例】連結壞掉',body:'加入我們頁上的「首頁」連結點了沒有反應。',steps:'打開 join.html，點首頁連結',expected:'回到首頁',actual:'顯示找不到頁面'};

// 欄位規則：功能異常需完整欄位；建議只需描述；標題可省略。
await assert.rejects(()=>submit('student',{kind:'bug',body:'只有描述但沒有頁面與步驟。'}),/發生頁面/);
const sug=await submit('student',{kind:'suggestion',body:'希望首頁可以加入更多提問範例，方便新同學。'});
assert.match(sug.case_no,/^FB-\d{8}-\d{4}$/);assert.equal(sug.urgent,false);
assert.equal((await pg.query('select title,triage_class,status from rise_feedback where id=$1',[sug.id])).rows[0].triage_class,'suggestion');
const link=await submit('student',linkBug);assert.equal(link.urgent,false);
assert.equal((await pg.query('select triage_class,status from rise_feedback where id=$1',[link.id])).rows[0].triage_class,'link_candidate');
assert.notEqual(link.case_no,sug.case_no);

// 疑似安全／登入／權限／個資：立即標示緊急、轉交管理者、加入通知佇列；永遠不進自動修正。
const sec=await submit('student',{kind:'security',body:'我好像可以看到別的同學的提問內容。'});assert.equal(sec.urgent,true);
const perm=await submit('student',{...linkBug,title:'【模擬案例】角色權限',body:'學生帳號可以進入管理員頁面，角色權限疑似有問題。',page:'admin-console.html'});assert.equal(perm.urgent,true);
const login=await submit('student',{...linkBug,body:'登入頁的連結點了沒反應。',page:'login.html'});assert.equal(login.urgent,true);
for(const r of [sec,perm,login])assert.deepEqual((await pg.query('select status,priority,urgent from rise_feedback where id=$1',[r.id])).rows[0],{status:'escalated',priority:'high',urgent:true});
assert.equal((await pg.query("select count(*)::int n from rise_feedback_alerts where state='pending'")).rows[0].n,3);
const cand=(await q('service','select * from public.rise_autofix_candidates()'));assert.deepEqual(cand.map(r=>r.feedback_id),[link.id]);
await assert.rejects(()=>q('service','select public.rise_autofix_begin_attempt($1,$2)',[sec.id,'b']),/urgent-case/);

// 個人視角：看不到內部狀態、分流或內部備註；別人的案件看不到。
const mine=await q('student','select * from public.rise_my_feedback()');assert(mine.length>=5);assert(!('urgent' in mine[0]));
assert(mine.find(r=>r.id===sec.id).status==='in_progress');assert.equal((await q('teacher','select * from public.rise_my_feedback()')).length,0);

// 權限：自動修正與通知佇列函式不得由會員、教師、管理員或匿名呼叫（只有 service_role）。
for(const role of ['student','teacher','admin',null]){
 for(const call of ['select * from public.rise_autofix_candidates()',"select public.rise_autofix_begin_attempt('"+link.id+"','x')","select public.rise_autofix_finish('"+link.id+"','fix_ready','{}')",'select * from public.rise_autofix_approved()',"select public.rise_autofix_mark_published('"+link.id+"','x')",'select * from public.rise_claim_feedback_alert()','select * from public.rise_autofix_cases'])
  await assert.rejects(()=>q(role,call),undefined,role+' '+call);
}
for(const role of ['student','teacher',null])await assert.rejects(()=>q(role,"select public.rise_admin_autofix_decide($1,'approve')",[link.id]));

// 狀態機：第一次失敗可再試，第二次失敗自動轉交，第三次被資料庫拒絕。
assert.equal((await q('service','select public.rise_autofix_begin_attempt($1,$2,true) n',[link.id,'autofix/a']))[0].n,1);
await assert.rejects(()=>q('service','select public.rise_autofix_begin_attempt($1,$2)',[link.id,'autofix/a']),/not-eligible/);
assert.equal((await q('service',"select public.rise_autofix_finish($1,'attempt_failed','{}') o",[link.id]))[0].o,'attempt_failed');
assert.equal((await q('service','select * from public.rise_autofix_candidates()')).length,1); // 仍在候選，attempts=1
assert.equal((await q('service','select public.rise_autofix_begin_attempt($1,$2) n',[link.id,'autofix/a']))[0].n,2);
assert.equal((await q('service',"select public.rise_autofix_finish($1,'attempt_failed','{}') o",[link.id]))[0].o,'escalated');
assert.equal((await q('service','select * from public.rise_autofix_candidates()')).length,0);
await assert.rejects(()=>q('service','select public.rise_autofix_begin_attempt($1,$2)',[link.id,'autofix/a']),/attempt-limit|not-eligible/);
await assert.rejects(()=>pg.query('update rise_autofix_cases set attempts=3 where feedback_id=$1',[link.id])); // 約束：最多 2
assert.deepEqual((await pg.query('select state,attempts,stop_reason from rise_autofix_cases where feedback_id=$1',[link.id])).rows[0],{state:'escalated',attempts:2,stop_reason:'two_failures'});
assert.equal((await pg.query('select status from rise_feedback where id=$1',[link.id])).rows[0].status,'escalated');

// 成功路徑：fix_ready → 管理者核准 → 發布 → 複驗 → 已結案。
const ok=await submit('student',{...linkBug,body:'加入我們頁的「關於計畫」連結點了找不到頁面。',title:'【模擬案例】第二個連結'});
await q('service','select public.rise_autofix_begin_attempt($1,$2,true)',[ok.id,'autofix/b']);
await q('service',"select public.rise_autofix_finish($1,'fix_ready',$2)",[ok.id,{before:{ok:false},after:{ok:true},diff:{files:['join.html']},branch:'autofix/b',commit:'abc123',verify_command:'node x'}]);
assert.equal((await pg.query('select status from rise_feedback where id=$1',[ok.id])).rows[0].status,'fix_ready');
assert.equal((await q('student','select status from public.rise_my_feedback() where id=$1',[ok.id]))[0].status,'in_progress');
await assert.rejects(()=>q('admin',"select public.rise_admin_triage_feedback($1,'resolved','normal','','')",[ok.id]),/待核准/);
const adminRow=(await q('admin','select public.rise_admin_feedback($1) d',['open']))[0].d.find(r=>r.id===ok.id);
assert.equal(adminRow.autofix.state,'fix_ready');assert.equal(adminRow.autofix.attempts,1);assert.equal(adminRow.is_simulation,false);
await q('admin',"select public.rise_admin_autofix_decide($1,'approve',true)",[ok.id]);
assert.equal((await q('service','select * from public.rise_autofix_approved()'))[0].keep_regression,true);
await q('service',"select public.rise_autofix_mark_published($1,'sha1')",[ok.id]);
assert.equal((await q('service','select * from public.rise_autofix_awaiting_verification()')).length,1);
await q('service',"select public.rise_autofix_mark_verified($1,true,'{\"ok\":true}')",[ok.id]);
assert.equal((await pg.query('select status from rise_feedback where id=$1',[ok.id])).rows[0].status,'resolved');
await assert.rejects(()=>q('service',"select public.rise_autofix_mark_published($1,'sha2')",[ok.id]),/not-approved/);

// 管理者退回；緊急清單與每日摘要的狀態分組。
await q('service','select public.rise_autofix_begin_attempt($1,$2)',[sug.id,'x']).catch(()=>{});
const urgentList=(await q('admin',"select public.rise_admin_feedback('urgent') d"))[0].d;assert.equal(urgentList.length,3);assert(urgentList.every(r=>r.urgent));
const sum=(await q('admin','select public.rise_admin_feedback_summary() d'))[0].d;
assert.equal(sum.urgent_open,3);assert(sum.buckets.escalated>=4);assert.equal(sum.buckets.closed,1);assert.equal(sum.new_count,6);
// 緊急通知佇列：領取、失敗重試、已寄出不重寄。
const a1=(await q('service','select * from public.rise_claim_feedback_alert()'));assert.equal(a1.length,1);assert(a1[0].case_no.startsWith('FB-'));assert(!('body' in a1[0]));
await q('service','select public.rise_finish_feedback_alert($1,false)',[a1[0].id]);
const next=await q('service','select * from public.rise_claim_feedback_alert()');assert(next.every(r=>r.id!==a1[0].id)); // 失敗的 10 分鐘內不重領同一筆
for(const r of next)await q('service','select public.rise_finish_feedback_alert($1,false)',[r.id]);
await pg.query("update rise_feedback_alerts set available_at=now()-interval '1 minute'");
let sent=0;for(;;){const a=await q('service','select * from public.rise_claim_feedback_alert()');if(!a.length)break;await q('service','select public.rise_finish_feedback_alert($1,true)',[a[0].id]);sent++;}
assert.equal(sent,3);assert.equal((await q('service','select * from public.rise_claim_feedback_alert()')).length,0);
for(const t of ['rise_autofix_cases','rise_autofix_events','rise_feedback_alerts'])assert.equal((await pg.query('select relrowsecurity r from pg_class where relname=$1',[t])).rows[0].r,true);
await pg.close();console.log('PASS autofix SQL: case numbers, field rules, urgent routing + alert queue, service-only pipeline RPCs, 2-attempt hard stop (DB-enforced), approve/publish/verify path, admin-only decisions, status-grouped summary, repeatable migration.');
