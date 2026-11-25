-- RISE 意見回報：案件編號、分流、緊急通知佇列、自動修正狀態機。
-- 在 backend/feedback.sql 之後執行；可重複執行，不刪除既有回報。
-- 自動修正的「嘗試次數上限 2 次」由資料庫約束與函式強制，排程重啟、改日、重跑都不會重置。
begin;
do $$begin
 if to_regclass('public.rise_feedback') is null then raise exception 'Run backend/feedback.sql first.';end if;
 if to_regprocedure('public.rise_feedback_submission_ready()') is not null then
  raise exception 'Feedback repair controls are installed. Do not rerun feedback-autofix.sql.';
 end if;
end $$;

-- ---------- 欄位與約束 ----------
alter table public.rise_feedback drop constraint if exists rise_feedback_kind_check;
alter table public.rise_feedback add constraint rise_feedback_kind_check check(kind in ('bug','security','suggestion','other','content'));
alter table public.rise_feedback drop constraint if exists rise_feedback_status_check;
alter table public.rise_feedback add constraint rise_feedback_status_check check(status in
 ('new','triaged','in_progress','needs_info','escalated','fix_ready','awaiting_verification','resolved','wontfix','duplicate'));
alter table public.rise_feedback add column if not exists case_no text;
alter table public.rise_feedback add column if not exists steps text not null default '' check(char_length(steps)<=2000);
alter table public.rise_feedback add column if not exists expected text not null default '' check(char_length(expected)<=1000);
alter table public.rise_feedback add column if not exists actual text not null default '' check(char_length(actual)<=1000);
alter table public.rise_feedback add column if not exists urgent boolean not null default false;
alter table public.rise_feedback add column if not exists triage_class text not null default 'unclassified';
alter table public.rise_feedback drop constraint if exists rise_feedback_triage_class_check;
alter table public.rise_feedback add constraint rise_feedback_triage_class_check check(triage_class in ('unclassified','link_candidate','security','suggestion','other'));
-- 建議的 AI 摘要欄位：僅供管理者參考，系統不會把它當成驗收標準。目前沒有任何程式自動寫入。
alter table public.rise_feedback add column if not exists ai_summary text not null default '' check(char_length(ai_summary)<=2000);
alter table public.rise_feedback add column if not exists is_simulation boolean not null default false;

create sequence if not exists public.rise_feedback_case_seq;
revoke all on sequence public.rise_feedback_case_seq from public,anon,authenticated;
grant usage,select on sequence public.rise_feedback_case_seq to service_role;
update public.rise_feedback f set case_no='FB-'||to_char(f.created_at at time zone 'Asia/Taipei','YYYYMMDD')||'-'||lpad(nextval('public.rise_feedback_case_seq')::text,4,'0')
 where f.case_no is null;
create unique index if not exists rise_feedback_case_no_idx on public.rise_feedback(case_no);

create table if not exists public.rise_feedback_alerts(
 id bigint generated always as identity primary key,
 feedback_id uuid not null unique references public.rise_feedback(id) on delete cascade,
 state text not null default 'pending' check(state in ('pending','sending','sent')),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 sent_at timestamptz,
 created_at timestamptz not null default now()
);

create table if not exists public.rise_autofix_cases(
 feedback_id uuid primary key references public.rise_feedback(id) on delete cascade,
 state text not null default 'queued' check(state in ('queued','attempting','attempt_failed','fix_ready','approved','rejected','published','verified','escalated','needs_info')),
 attempts integer not null default 0 check(attempts between 0 and 2),
 stop_reason text not null default '',
 branch text not null default '',
 commit_sha text not null default '',
 published_sha text not null default '',
 before_result jsonb,
 after_result jsonb,
 diff_summary jsonb,
 verify_command text not null default '',
 keep_regression boolean not null default false,
 approved_by uuid references auth.users(id) on delete set null,
 approved_at timestamptz,
 is_simulation boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.rise_autofix_events(
 id bigint generated always as identity primary key,
 feedback_id uuid not null references public.rise_feedback(id) on delete cascade,
 attempt integer not null default 0,
 phase text not null,
 result jsonb not null default '{}'::jsonb,
 is_simulation boolean not null default false,
 created_at timestamptz not null default now()
);

alter table public.rise_feedback_alerts enable row level security;
alter table public.rise_autofix_cases enable row level security;
alter table public.rise_autofix_events enable row level security;
revoke all on public.rise_feedback_alerts,public.rise_autofix_cases,public.rise_autofix_events from public,anon,authenticated;
grant all on public.rise_feedback_alerts,public.rise_autofix_cases,public.rise_autofix_events to service_role;
grant usage,select on all sequences in schema public to service_role;

-- ---------- 分流（只用於路由；回報文字永遠只是資料，不會被執行或解讀為指令） ----------
create or replace function rise_private.feedback_classify(p_kind text,p_page text,p_text text,out is_urgent boolean,out triage text)
language plpgsql immutable set search_path='' as $$
begin
 is_urgent:=p_kind='security'
  or p_text ~* '(密碼|驗證碼|登入|權限|角色|越權|個資|個人資料|資料遺失|資料不見|被刪|刪除|洩漏|外洩|看到別人|金鑰|token|password|permission|privilege|leak|injection|xss)'
  or p_page ~* '^(login|register|account|reset-password|forgot-password|verify-email|teacher-apply|admin-[a-z-]+)\.html';
 triage:=case
  when is_urgent then 'security'
  when p_kind='suggestion' then 'suggestion'
  when p_kind='bug' and p_text ~* '(連結|404|找不到頁面|點了|點擊|按了|導向|跳到|打不開|開不起來|link)' then 'link_candidate'
  else 'other' end;
end $$;
revoke all on function rise_private.feedback_classify(text,text,text) from public,anon,authenticated;

-- ---------- 送出（取代舊的五參數版本） ----------
drop function if exists public.rise_submit_feedback(text,text,text,text,text);
create or replace function public.rise_submit_feedback(p_kind text,p_page text,p_title text,p_body text,p_steps text,p_expected text,p_actual text,p_client_info text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();new_id uuid;new_case text;clean_page text;clean_body text:=btrim(coalesce(p_body,''));clean_title text:=btrim(coalesce(p_title,''));
 clean_steps text:=btrim(coalesce(p_steps,''));clean_expected text:=btrim(coalesce(p_expected,''));clean_actual text:=btrim(coalesce(p_actual,''));
 c record;
begin
 if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null)
  then raise exception 'rise:請先登入並驗證信箱再送出回報。' using errcode='42501';end if;
 if not exists(select 1 from public.rise_profiles where id=uid) then raise exception 'rise:找不到會員資料。' using errcode='42501';end if;
 if p_kind is null or p_kind not in ('bug','security','suggestion','other') then raise exception 'rise:請選擇回報類型。';end if;
 if char_length(clean_body) not between 10 and 3000 then raise exception 'rise:問題描述需為 10 到 3000 字。';end if;
 if clean_title='' then clean_title:=left(regexp_replace(clean_body,'\s+',' ','g'),40);end if;
 if char_length(clean_title) not between 3 and 120 then raise exception 'rise:標題需為 3 到 120 字。';end if;
 if char_length(clean_steps)>2000 or char_length(clean_expected)>1000 or char_length(clean_actual)>1000 then raise exception 'rise:操作步驟或結果欄位過長。';end if;
 clean_page:=left(regexp_replace(btrim(coalesce(p_page,'')),'^.*/RISE/',''),200);
 if clean_page<>'' and clean_page !~ '^[A-Za-z0-9_./?=&%#-]+$' then clean_page:='';end if;
 if p_kind='bug' and (clean_page='' or char_length(clean_steps)<2 or char_length(clean_expected)<2 or char_length(clean_actual)<2)
  then raise exception 'rise:功能異常請填寫發生頁面、操作步驟、預期結果與實際結果。';end if;
 if (select count(*) from public.rise_feedback where user_id=uid and created_at>now()-interval '24 hours')>=10
  then raise exception 'rise:24 小時內最多送出 10 則回報，請明天再試或直接寄信給管理員。' using errcode='54000';end if;
 select f.id,f.case_no into new_id,new_case from public.rise_feedback f where f.user_id=uid and f.kind=p_kind and f.page=clean_page and f.body=clean_body and f.created_at>now()-interval '24 hours' limit 1;
 if new_id is not null then return jsonb_build_object('id',new_id,'case_no',new_case,'duplicate',true);end if;
 select * into c from rise_private.feedback_classify(p_kind,clean_page,clean_title||' '||clean_body||' '||clean_steps||' '||clean_actual);
 new_case:='FB-'||to_char(now() at time zone 'Asia/Taipei','YYYYMMDD')||'-'||lpad(nextval('public.rise_feedback_case_seq')::text,4,'0');
 insert into public.rise_feedback(user_id,kind,page,title,body,steps,expected,actual,client_info,case_no,urgent,triage_class,status,priority)
 values(uid,p_kind,clean_page,clean_title,clean_body,clean_steps,clean_expected,clean_actual,left(coalesce(p_client_info,''),200),new_case,c.is_urgent,c.triage,
  case when c.is_urgent then 'escalated' else 'new' end,case when c.is_urgent then 'high' else 'normal' end) returning id into new_id;
 if c.is_urgent then insert into public.rise_feedback_alerts(feedback_id) values(new_id) on conflict do nothing;end if;
 return jsonb_build_object('id',new_id,'case_no',new_case,'urgent',c.is_urgent);
end $$;
revoke all on function public.rise_submit_feedback(text,text,text,text,text,text,text,text) from public,anon;
grant execute on function public.rise_submit_feedback(text,text,text,text,text,text,text,text) to authenticated;

-- 我的回報：只含自己的案件；內部狀態一律對外顯示為「處理中」，不揭露分流或安全標記。
drop function if exists public.rise_my_feedback();
create or replace function public.rise_my_feedback() returns table(id uuid,case_no text,kind text,page text,title text,body text,status text,public_reply text,created_at timestamptz,updated_at timestamptz)
language sql stable security definer set search_path='' as $$
 select f.id,f.case_no,f.kind,f.page,f.title,f.body,
  case when f.status in ('triaged','in_progress','escalated','fix_ready','awaiting_verification') then 'in_progress' else f.status end,
  f.public_reply,f.created_at,f.updated_at
 from public.rise_feedback f where f.user_id=auth.uid() order by f.created_at desc limit 100;
$$;
revoke all on function public.rise_my_feedback() from public,anon;
grant execute on function public.rise_my_feedback() to authenticated;

-- ---------- 管理員讀取與處理 ----------
create or replace function public.rise_admin_feedback(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not rise_private.feedback_is_admin() then raise exception 'rise:僅已驗證的管理員可以查看回報。' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(r) order by r.urgent desc,r.created_at desc) from (
  select f.id,f.case_no,f.kind,f.page,f.title,f.body,f.steps,f.expected,f.actual,f.client_info,f.status,f.priority,f.urgent,f.triage_class,f.ai_summary,f.is_simulation,
   f.admin_note,f.public_reply,f.duplicate_of,f.created_at,f.updated_at,
   coalesce(nullif(p.display_name,''),'（未填姓名）') as submitter,
   (select count(*) from public.rise_feedback g where g.id<>f.id and g.kind=f.kind and g.page=f.page and g.page<>'' and g.status in ('new','triaged','in_progress','needs_info','escalated','fix_ready','awaiting_verification')) as similar_open,
   (select to_jsonb(a)-'feedback_id' from public.rise_autofix_cases a where a.feedback_id=f.id) as autofix
  from public.rise_feedback f left join public.rise_profiles p on p.id=f.user_id
  where p_status is null or p_status='' or
   (p_status='open' and f.status in ('new','triaged','in_progress','needs_info','escalated','fix_ready','awaiting_verification')) or
   (p_status='urgent' and f.urgent and f.status not in ('resolved','wontfix','duplicate')) or f.status=p_status
  order by f.created_at desc limit 500) r),'[]'::jsonb);
end $$;
revoke all on function public.rise_admin_feedback(text) from public,anon;
grant execute on function public.rise_admin_feedback(text) to authenticated;

create or replace function public.rise_admin_triage_feedback(p_id uuid,p_status text,p_priority text,p_admin_note text,p_public_reply text,p_duplicate_of uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare old public.rise_feedback;
begin
 if not rise_private.feedback_is_admin() then raise exception 'rise:僅已驗證的管理員可以處理回報。' using errcode='42501';end if;
 -- fix_ready／awaiting_verification 只由自動修正流程與核准動作設定。
 if p_status not in ('new','triaged','in_progress','needs_info','escalated','resolved','wontfix','duplicate') then raise exception 'rise:狀態不正確。';end if;
 if p_priority not in ('low','normal','high') then raise exception 'rise:優先順序不正確。';end if;
 if char_length(coalesce(p_admin_note,''))>2000 or char_length(coalesce(p_public_reply,''))>1000 then raise exception 'rise:備註或回覆過長。';end if;
 if p_status='duplicate' and (p_duplicate_of is null or p_duplicate_of=p_id or not exists(select 1 from public.rise_feedback where id=p_duplicate_of))
  then raise exception 'rise:標記重複時請指定另一則存在的回報。';end if;
 select * into old from public.rise_feedback where id=p_id for update;
 if not found then raise exception 'rise:找不到這則回報。';end if;
 if old.status in ('fix_ready','awaiting_verification') and p_status<>old.status
  then raise exception 'rise:此案件有待核准或待複驗的修正，請在自動修正面板決定，或先退回。';end if;
 update public.rise_feedback set status=p_status,priority=p_priority,admin_note=coalesce(p_admin_note,''),public_reply=coalesce(p_public_reply,''),
  duplicate_of=case when p_status='duplicate' then p_duplicate_of else null end,triaged_by=auth.uid(),updated_at=now() where id=p_id;
 insert into public.rise_feedback_events(feedback_id,actor_id,changes) values(p_id,auth.uid(),jsonb_build_object(
  'from',jsonb_build_object('status',old.status,'priority',old.priority),'to',jsonb_build_object('status',p_status,'priority',p_priority)));
end $$;
revoke all on function public.rise_admin_triage_feedback(uuid,text,text,text,text,uuid) from public,anon;
grant execute on function public.rise_admin_triage_feedback(uuid,text,text,text,text,uuid) to authenticated;

-- 管理者對「測試通過，待核准發布」的決定。核准只改狀態；實際合併由發布程式在重跑檢查器之後執行。
create or replace function public.rise_admin_autofix_decide(p_feedback uuid,p_decision text,p_keep_regression boolean default false,p_note text default '')
returns void language plpgsql security definer set search_path='' as $$
declare a public.rise_autofix_cases;
begin
 if not rise_private.feedback_is_admin() then raise exception 'rise:僅已驗證的管理員可以核准或退回修正。' using errcode='42501';end if;
 if p_decision not in ('approve','reject') then raise exception 'rise:決定不正確。';end if;
 select * into a from public.rise_autofix_cases where feedback_id=p_feedback for update;
 if not found or a.state<>'fix_ready' then raise exception 'rise:此案件目前沒有待核准的修正。';end if;
 if p_decision='approve' then
  update public.rise_autofix_cases set state='approved',keep_regression=coalesce(p_keep_regression,false),approved_by=auth.uid(),approved_at=now(),updated_at=now() where feedback_id=p_feedback;
 else
  update public.rise_autofix_cases set state='rejected',stop_reason='rejected_by_admin',updated_at=now() where feedback_id=p_feedback;
  update public.rise_feedback set status='escalated',admin_note=left(coalesce(p_note,''),2000),updated_at=now() where id=p_feedback;
 end if;
 insert into public.rise_autofix_events(feedback_id,attempt,phase,result,is_simulation) values(p_feedback,a.attempts,'admin_'||p_decision,jsonb_build_object('actor',auth.uid(),'keep_regression',coalesce(p_keep_regression,false)),a.is_simulation);
end $$;
revoke all on function public.rise_admin_autofix_decide(uuid,text,boolean,text) from public,anon;
grant execute on function public.rise_admin_autofix_decide(uuid,text,boolean,text) to authenticated;

-- ---------- 自動修正狀態機（僅 service_role；前端與一般會員不可呼叫） ----------
create or replace function public.rise_autofix_candidates() returns table(feedback_id uuid,case_no text,kind text,page text,attempts integer)
language sql stable security definer set search_path='' as $$
 select f.id,f.case_no,f.kind,f.page,coalesce(a.attempts,0) from public.rise_feedback f
 left join public.rise_autofix_cases a on a.feedback_id=f.id
 where f.urgent=false and f.kind='bug' and f.triage_class='link_candidate' and f.status in ('new','triaged')
  and (a.feedback_id is null or a.state in ('queued','attempt_failed')) and coalesce(a.attempts,0)<2
 order by f.created_at;
$$;
revoke all on function public.rise_autofix_candidates() from public,anon,authenticated;
grant execute on function public.rise_autofix_candidates() to service_role;

create or replace function public.rise_autofix_begin_attempt(p_feedback uuid,p_branch text,p_simulation boolean default false) returns integer
language plpgsql security definer set search_path='' as $$
declare f public.rise_feedback;a public.rise_autofix_cases;
begin
 select * into f from public.rise_feedback where id=p_feedback for update;
 if not found then raise exception 'rise:case-missing';end if;
 if f.urgent then raise exception 'rise:urgent-case';end if;
 insert into public.rise_autofix_cases(feedback_id,is_simulation) values(p_feedback,coalesce(p_simulation,false)) on conflict do nothing;
 select * into a from public.rise_autofix_cases where feedback_id=p_feedback for update;
 if a.attempts>=2 then raise exception 'rise:attempt-limit';end if;
 if a.state not in ('queued','attempt_failed') then raise exception 'rise:not-eligible';end if;
 update public.rise_autofix_cases set attempts=attempts+1,state='attempting',branch=left(coalesce(p_branch,''),120),updated_at=now() where feedback_id=p_feedback returning * into a;
 update public.rise_feedback set status='in_progress',updated_at=now() where id=p_feedback;
 insert into public.rise_autofix_events(feedback_id,attempt,phase,result,is_simulation) values(p_feedback,a.attempts,'begin',jsonb_build_object('branch',a.branch),a.is_simulation);
 return a.attempts;
end $$;
revoke all on function public.rise_autofix_begin_attempt(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.rise_autofix_begin_attempt(uuid,text,boolean) to service_role;

create or replace function public.rise_autofix_log(p_feedback uuid,p_attempt integer,p_phase text,p_result jsonb) returns void
language sql security definer set search_path='' as $$
 insert into public.rise_autofix_events(feedback_id,attempt,phase,result,is_simulation)
 select p_feedback,coalesce(p_attempt,0),left(p_phase,40),coalesce(p_result,'{}'::jsonb),f.is_simulation from public.rise_feedback f where f.id=p_feedback;
$$;
revoke all on function public.rise_autofix_log(uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.rise_autofix_log(uuid,integer,text,jsonb) to service_role;

create or replace function public.rise_autofix_finish(p_feedback uuid,p_outcome text,p_payload jsonb default '{}'::jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare a public.rise_autofix_cases;sim boolean;
begin
 select is_simulation into sim from public.rise_feedback where id=p_feedback for update;
 if not found then raise exception 'rise:case-missing';end if;
 insert into public.rise_autofix_cases(feedback_id,is_simulation) values(p_feedback,coalesce(sim,false)) on conflict do nothing;
 select * into a from public.rise_autofix_cases where feedback_id=p_feedback for update;
 if p_outcome='fix_ready' then
  if a.state<>'attempting' then raise exception 'rise:not-attempting';end if;
  update public.rise_autofix_cases set state='fix_ready',before_result=p_payload->'before',after_result=p_payload->'after',diff_summary=p_payload->'diff',
   branch=coalesce(p_payload->>'branch',branch),commit_sha=coalesce(p_payload->>'commit',''),verify_command=left(coalesce(p_payload->>'verify_command',''),500),updated_at=now() where feedback_id=p_feedback;
  update public.rise_feedback set status='fix_ready',updated_at=now() where id=p_feedback;
 elsif p_outcome='attempt_failed' then
  if a.state<>'attempting' then raise exception 'rise:not-attempting';end if;
  if a.attempts>=2 then
   update public.rise_autofix_cases set state='escalated',stop_reason='two_failures',after_result=p_payload->'after',updated_at=now() where feedback_id=p_feedback;
   update public.rise_feedback set status='escalated',updated_at=now() where id=p_feedback;
   p_outcome:='escalated';
  else
   update public.rise_autofix_cases set state='attempt_failed',after_result=p_payload->'after',updated_at=now() where feedback_id=p_feedback;
   update public.rise_feedback set status='triaged',updated_at=now() where id=p_feedback;
  end if;
 elsif p_outcome in ('escalate','needs_info') then
  if a.state in ('fix_ready','approved','published','verified') then raise exception 'rise:already-resolved-by-pipeline';end if;
  update public.rise_autofix_cases set state=case when p_outcome='needs_info' then 'needs_info' else 'escalated' end,stop_reason=left(coalesce(p_payload->>'reason',''),300),
   before_result=coalesce(p_payload->'before',before_result),updated_at=now() where feedback_id=p_feedback;
  update public.rise_feedback set status=case when p_outcome='needs_info' then 'needs_info' else 'escalated' end,updated_at=now() where id=p_feedback;
 else raise exception 'rise:unknown-outcome';end if;
 insert into public.rise_autofix_events(feedback_id,attempt,phase,result,is_simulation) values(p_feedback,a.attempts,'finish:'||p_outcome,coalesce(p_payload,'{}'::jsonb),coalesce(sim,false));
 return p_outcome;
end $$;
revoke all on function public.rise_autofix_finish(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.rise_autofix_finish(uuid,text,jsonb) to service_role;

drop function if exists public.rise_autofix_approved();
create or replace function public.rise_autofix_approved() returns table(feedback_id uuid,case_no text,branch text,commit_sha text,keep_regression boolean,page text,diff_summary jsonb)
language sql stable security definer set search_path='' as $$
 select a.feedback_id,f.case_no,a.branch,a.commit_sha,a.keep_regression,f.page,a.diff_summary from public.rise_autofix_cases a join public.rise_feedback f on f.id=a.feedback_id where a.state='approved' order by a.approved_at;
$$;
revoke all on function public.rise_autofix_approved() from public,anon,authenticated;
grant execute on function public.rise_autofix_approved() to service_role;

create or replace function public.rise_autofix_mark_published(p_feedback uuid,p_sha text) returns void
language plpgsql security definer set search_path='' as $$
begin
 update public.rise_autofix_cases set state='published',published_sha=left(coalesce(p_sha,''),64),updated_at=now() where feedback_id=p_feedback and state='approved';
 if not found then raise exception 'rise:not-approved';end if;
 update public.rise_feedback set status='awaiting_verification',updated_at=now() where id=p_feedback;
 insert into public.rise_autofix_events(feedback_id,attempt,phase,result,is_simulation) select p_feedback,a.attempts,'published',jsonb_build_object('sha',p_sha),a.is_simulation from public.rise_autofix_cases a where a.feedback_id=p_feedback;
end $$;
revoke all on function public.rise_autofix_mark_published(uuid,text) from public,anon,authenticated;
grant execute on function public.rise_autofix_mark_published(uuid,text) to service_role;

drop function if exists public.rise_autofix_awaiting_verification();
create or replace function public.rise_autofix_awaiting_verification() returns table(feedback_id uuid,case_no text,page text,published_sha text,diff_summary jsonb)
language sql stable security definer set search_path='' as $$
 select a.feedback_id,f.case_no,f.page,a.published_sha,a.diff_summary from public.rise_autofix_cases a join public.rise_feedback f on f.id=a.feedback_id where a.state='published' order by a.updated_at;
$$;
revoke all on function public.rise_autofix_awaiting_verification() from public,anon,authenticated;
grant execute on function public.rise_autofix_awaiting_verification() to service_role;

create or replace function public.rise_autofix_mark_verified(p_feedback uuid,p_ok boolean,p_result jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare sim boolean;att integer;
begin
 update public.rise_autofix_cases set state=case when p_ok then 'verified' else 'escalated' end,
  stop_reason=case when p_ok then stop_reason else 'post_publish_verify_failed' end,after_result=coalesce(p_result,after_result),updated_at=now()
 where feedback_id=p_feedback and state='published' returning is_simulation,attempts into sim,att;
 if not found then raise exception 'rise:not-published';end if;
 update public.rise_feedback set status=case when p_ok then 'resolved' else 'escalated' end,updated_at=now() where id=p_feedback;
 insert into public.rise_autofix_events(feedback_id,attempt,phase,result,is_simulation) values(p_feedback,att,'post_publish_verify',jsonb_build_object('ok',p_ok)||coalesce(p_result,'{}'::jsonb),sim);
end $$;
revoke all on function public.rise_autofix_mark_verified(uuid,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.rise_autofix_mark_verified(uuid,boolean,jsonb) to service_role;

-- ---------- 緊急通知佇列（內容只含案件編號與類型，不含回報內文） ----------
create or replace function public.rise_claim_feedback_alert() returns table(id bigint,feedback_id uuid,case_no text,kind text,created_at timestamptz)
language sql security definer set search_path='' as $$
 update public.rise_feedback_alerts a set state='sending',attempts=a.attempts+1,available_at=now()+interval '10 minutes'
 from public.rise_feedback f where f.id=a.feedback_id and a.id in (select x.id from public.rise_feedback_alerts x where x.state<>'sent' and x.available_at<=now() order by x.created_at for update skip locked limit 1)
 returning a.id,a.feedback_id,f.case_no,f.kind,a.created_at;
$$;
revoke all on function public.rise_claim_feedback_alert() from public,anon,authenticated;
grant execute on function public.rise_claim_feedback_alert() to service_role;
create or replace function public.rise_finish_feedback_alert(p_id bigint,p_sent boolean) returns void
language sql security definer set search_path='' as $$
 update public.rise_feedback_alerts set state=case when p_sent then 'sent' else 'pending' end,sent_at=case when p_sent then now() else sent_at end,
  available_at=case when p_sent then available_at else now()+interval '10 minutes' end where id=p_id and state='sending';
$$;
revoke all on function public.rise_finish_feedback_alert(bigint,boolean) from public,anon,authenticated;
grant execute on function public.rise_finish_feedback_alert(bigint,boolean) to service_role;

-- ---------- 每日彙整改為依狀態分組 ----------
create or replace function rise_private.feedback_summary(p_since timestamptz,p_until timestamptz) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'generated_at',now(),
  'window',jsonb_build_object('since',p_since,'until',p_until),
  'open_total',(select count(*) from public.rise_feedback where status in ('new','triaged','in_progress','needs_info','escalated','fix_ready','awaiting_verification')),
  'untriaged',(select count(*) from public.rise_feedback where status='new'),
  'high_open',(select count(*) from public.rise_feedback where priority='high' and status in ('new','triaged','in_progress','needs_info','escalated','fix_ready','awaiting_verification')),
  'urgent_open',(select count(*) from public.rise_feedback where urgent and status not in ('resolved','wontfix','duplicate')),
  'stale_untriaged',(select count(*) from public.rise_feedback where status='new' and created_at<now()-interval '3 days'),
  'resolved_in_window',(select count(*) from public.rise_feedback where status in ('resolved','wontfix','duplicate') and updated_at>=p_since and updated_at<p_until),
  'buckets',jsonb_build_object(
   'new',(select count(*) from public.rise_feedback where created_at>=p_since and created_at<p_until),
   'needs_info',(select count(*) from public.rise_feedback where status='needs_info'),
   'in_progress',(select count(*) from public.rise_feedback where status in ('triaged','in_progress')),
   'escalated',(select count(*) from public.rise_feedback where status='escalated'),
   'awaiting_verification',(select count(*) from public.rise_feedback where status in ('fix_ready','awaiting_verification')),
   'closed',(select count(*) from public.rise_feedback where status in ('resolved','wontfix','duplicate') and updated_at>=p_since and updated_at<p_until)),
  'by_kind_open',coalesce((select jsonb_object_agg(kind,n) from (select kind,count(*) n from public.rise_feedback where status in ('new','triaged','in_progress','needs_info','escalated','fix_ready','awaiting_verification') group by kind) s),'{}'::jsonb),
  'new_items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'case_no',case_no,'kind',kind,'page',page,'title',title,'body',left(body,400),'priority',priority,'urgent',urgent,'status',status,'created_at',created_at) order by created_at) from (
    select * from public.rise_feedback where created_at>=p_since and created_at<p_until order by created_at limit 50) n),'[]'::jsonb),
  'new_count',(select count(*) from public.rise_feedback where created_at>=p_since and created_at<p_until),
  'fix_ready',coalesce((select jsonb_agg(jsonb_build_object('case_no',f.case_no,'page',f.page,'state',a.state) order by a.updated_at) from public.rise_autofix_cases a join public.rise_feedback f on f.id=a.feedback_id where a.state in ('fix_ready','approved','published')),'[]'::jsonb),
  'repeat_pages',coalesce((select jsonb_agg(jsonb_build_object('page',page,'kind',kind,'count',n,'titles',titles,'case_nos',cases) order by n desc) from (
    select page,kind,count(*) n,(array_agg(left(title,60) order by created_at desc))[1:3] titles,(array_agg(case_no order by created_at desc))[1:5] cases from public.rise_feedback
    where page<>'' and status in ('new','triaged','in_progress','needs_info','escalated','fix_ready','awaiting_verification') group by page,kind having count(*)>=2 order by count(*) desc limit 10) g),'[]'::jsonb),
  'oldest_open',coalesce((select jsonb_agg(jsonb_build_object('id',id,'case_no',case_no,'title',left(title,80),'page',page,'status',status,'priority',priority,'created_at',created_at) order by created_at) from (
    select * from public.rise_feedback where status in ('new','triaged','in_progress','needs_info','escalated','fix_ready','awaiting_verification') order by created_at limit 5) o),'[]'::jsonb)
 );
$$;
revoke all on function rise_private.feedback_summary(timestamptz,timestamptz) from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
