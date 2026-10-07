-- RISE 2026-10-07. Apply AFTER program-refinement.sql. Repeatable; no data deletion.
begin;
do $$begin
 if to_regprocedure('public.rise_question_timeline(uuid,integer)') is null
 or to_regclass('public.rise_watch_sessions') is null then
  raise exception 'Run backend/program-refinement.sql and its prerequisites first.';
 end if;
end $$;

-- Existing RISE tables only. Private schemas use deny-all RLS plus guarded RPCs.
do $$declare t record;begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p') and (n.nspname in ('rise_private','rise_work','rise_program') or (n.nspname='public' and c.relname like 'rise\_%' escape '\')) loop
  execute format('alter table %I.%I enable row level security',t.nspname,t.relname);
  if t.nspname<>'public' then execute format('revoke all on %I.%I from public,anon,authenticated',t.nspname,t.relname);end if;
 end loop;
end $$;
create or replace function rise_private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.rise_profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and p.role='admin' and u.email_confirmed_at is not null);
$$;
revoke all on function rise_private.is_admin() from public,anon;
grant execute on function rise_private.is_admin() to authenticated;
-- Old column-level grants can otherwise bypass the submission RPC.
revoke insert,update,delete on public.rise_questions,public.rise_answers,public.rise_question_versions from public,anon,authenticated;
revoke insert(user_id,subject,title,body) on public.rise_questions from public,anon,authenticated;
alter view public.rise_watch_history set (security_invoker=true);
do $$declare t text;begin
 foreach t in array array['rise_questions','rise_answers','rise_question_versions','rise_question_images','rise_watch_sessions','rise_teacher_applications','rise_application_events'] loop
  execute format('drop policy if exists rise_verified_read on public.%I',t);
  execute format('create policy rise_verified_read on public.%I as restrictive for select to authenticated using (rise_private.is_verified())',t);
 end loop;
end $$;
-- Public bucket access bypasses download RLS. Keep every existing RISE attachment bucket private.
update storage.buckets set public=false where id in ('rise-credentials','rise-question-images','rise-teaching-files','rise-work-files');
drop policy if exists rise_credentials_verified on storage.objects;
create policy rise_credentials_verified on storage.objects as restrictive for select to authenticated
using(bucket_id<>'rise-credentials' or (rise_private.is_verified() and (split_part(name,'/',1)=auth.uid()::text or rise_private.is_admin())));

create table if not exists rise_private.account_deletions(
 user_id uuid primary key references auth.users(id) on delete cascade,prepared_at timestamptz not null default now());
alter table rise_private.account_deletions enable row level security;
revoke all on rise_private.account_deletions from public,anon,authenticated;
create or replace function public.rise_prepare_account_delete() returns void language plpgsql security definer set search_path='' as $$
declare r text;
begin
 perform pg_advisory_xact_lock(723461092);
 select role into r from public.rise_profiles where id=auth.uid() for update;
 if not found or r='admin' or not rise_private.is_verified() then raise exception 'rise:僅已驗證的非管理員帳號能自行刪除。' using errcode='42501';end if;
 insert into rise_private.account_deletions(user_id) values(auth.uid()) on conflict do nothing;
end $$;
-- Serialize upload authorization against the final account deletion; no client-supplied user ID.
create or replace function rise_private.account_upload_open() returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.rise_profiles where id=auth.uid() for share;
 return found and rise_private.is_verified() and not exists(select 1 from rise_private.account_deletions where user_id=auth.uid());
end $$;
revoke all on function rise_private.account_upload_open() from public,anon;
grant execute on function rise_private.account_upload_open() to authenticated;
drop policy if exists rise_account_upload_guard on storage.objects;
create policy rise_account_upload_guard on storage.objects as restrictive for insert to authenticated
with check(bucket_id not in ('rise-credentials','rise-question-images','rise-teaching-files','rise-work-files') or rise_private.account_upload_open());
drop policy if exists rise_account_update_guard on storage.objects;
create policy rise_account_update_guard on storage.objects as restrictive for update to authenticated
using(bucket_id not in ('rise-credentials','rise-question-images','rise-teaching-files','rise-work-files') or rise_private.account_upload_open())
with check(bucket_id not in ('rise-credentials','rise-question-images','rise-teaching-files','rise-work-files') or rise_private.account_upload_open());
create or replace function rise_private.account_deleting() returns boolean language sql stable security definer set search_path='' as $$
 select rise_private.is_verified() and exists(select 1 from rise_private.account_deletions d join public.rise_profiles p on p.id=d.user_id where d.user_id=auth.uid() and p.role<>'admin');
$$;
revoke all on function rise_private.account_deleting() from public,anon;
grant execute on function rise_private.account_deleting() to authenticated;
-- Work attachments were missing from self-deletion cleanup. Delete only after explicit preparation.
drop policy if exists rise_work_self_cleanup on storage.objects;
create policy rise_work_self_cleanup on storage.objects for delete to authenticated
using(bucket_id='rise-work-files' and split_part(name,'/',1)=auth.uid()::text and rise_private.account_deleting());
-- Prevent a pending self-deletion from being promoted into an administrator mid-cleanup.
create or replace function rise_private.protect_deleting_role() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.role is distinct from new.role and exists(select 1 from rise_private.account_deletions where user_id=old.id) then raise exception 'rise:帳號刪除流程尚未完成，不能變更角色。';end if;
 return new;
end $$;
revoke all on function rise_private.protect_deleting_role() from public,anon,authenticated;
drop trigger if exists rise_protect_deleting_role on public.rise_profiles;
create trigger rise_protect_deleting_role before update of role on public.rise_profiles for each row execute function rise_private.protect_deleting_role();

create or replace function public.rise_delete_my_account() returns boolean language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();r text;drive_left boolean;
begin
 perform pg_advisory_xact_lock(723461092);
 select role into r from public.rise_profiles where id=u for update;
 if not found or r='admin' or not rise_private.is_verified() then raise exception 'rise:僅已驗證的非管理員帳號能自行刪除。' using errcode='42501';end if;
 if not exists(select 1 from rise_private.account_deletions where user_id=u) then raise exception 'rise:請從會員中心確認並開始刪除流程。';end if;
 if exists(select 1 from storage.objects o where split_part(o.name,'/',1)=u::text or coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner')=u::text) then
  raise exception 'rise:附件尚未清理完成，帳號尚未刪除。請保留此頁重試或聯絡管理員。';end if;
 if to_regclass('public.rise_drive_files') is not null then
  execute 'select exists(select 1 from public.rise_drive_files where user_id=$1)' into drive_left using u;
  if drive_left then raise exception 'rise:Google Drive 附件尚未清理完成，帳號尚未刪除。';end if;
 end if;
 -- One PostgreSQL transaction: cascades all owned relational records or rolls everything back.
 delete from auth.users where id=u;
 if not found then raise exception 'rise:找不到目前登入帳號。';end if;
 return true;
end $$;
revoke all on function public.rise_prepare_account_delete(),public.rise_delete_my_account() from public,anon;
grant execute on function public.rise_prepare_account_delete(),public.rise_delete_my_account() to authenticated;
create or replace function public.rise_cancel_account_delete() returns void language plpgsql security definer set search_path='' as $$
declare r text;
begin
 perform pg_advisory_xact_lock(723461092);
 select role into r from public.rise_profiles where id=auth.uid() for update;
 if not found or r='admin' or not rise_private.is_verified() then raise exception 'rise:無權取消此帳號的刪除流程。' using errcode='42501';end if;
 delete from rise_private.account_deletions where user_id=auth.uid();
 update public.rise_qa_account_state set deleting=false where user_id=auth.uid();
 if to_regclass('public.rise_drive_owners') is not null then execute 'update public.rise_drive_owners set deleting=false where user_id=$1' using auth.uid();end if;
end $$;
revoke all on function public.rise_cancel_account_delete() from public,anon;
grant execute on function public.rise_cancel_account_delete() to authenticated;

-- Correct legacy admin-console SQL and remove direct Storage metadata deletion.
-- 已安裝帳號系統 rise_profiles 後執行；可重複執行，不刪除會員。
create schema if not exists rise_private;
create table if not exists rise_private.admin_console_settings(
 id boolean primary key default true check(id), started_at timestamptz not null default now()
);
insert into rise_private.admin_console_settings(id) values(true) on conflict do nothing;
create table if not exists rise_private.member_activity(
 user_id uuid not null references auth.users(id) on delete cascade,
 activity_date date not null,
 last_seen_at timestamptz not null default now(),
 primary key(user_id,activity_date)
);
create index if not exists rise_activity_date on rise_private.member_activity(activity_date,user_id);
create table if not exists rise_private.member_role_events(
 id bigint generated always as identity primary key,
 actor_id uuid references auth.users(id) on delete set null,
 target_id uuid references auth.users(id) on delete set null,
 old_role text not null,new_role text not null,created_at timestamptz not null default now()
);
alter table rise_private.member_activity enable row level security;
alter table rise_private.member_role_events enable row level security;
alter table rise_private.admin_console_settings enable row level security;
revoke all on rise_private.member_activity,rise_private.member_role_events,rise_private.admin_console_settings from public,anon,authenticated;
create or replace function rise_private.console_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.rise_profiles p join auth.users u on u.id=p.id
 where p.id=auth.uid() and p.role='admin' and u.email_confirmed_at is not null);
$$;
revoke all on function rise_private.console_admin() from public,anon,authenticated;

-- 不接受 user_id 或客戶端時間；一天一位會員只算一次活躍。
create or replace function public.rise_record_activity() returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then return;end if;
 insert into rise_private.member_activity(user_id,activity_date,last_seen_at)
 values(auth.uid(),(now() at time zone 'Asia/Taipei')::date,now())
 on conflict(user_id,activity_date) do update set last_seen_at=excluded.last_seen_at
 where rise_private.member_activity.last_seen_at < now()-interval '5 minutes';
end;$$;

create or replace function public.rise_admin_members(p_search text default '',p_role text default 'all',p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not rise_private.console_admin() then raise exception 'rise:僅限已驗證的管理員使用。' using errcode='42501';end if;
 if p_role is null or p_role not in ('all','student','ta','teacher','admin','missing') or char_length(coalesce(p_search,''))>200 then raise exception 'rise:搜尋條件不正確。';end if;
 with matched as (
 select u.id,u.email,coalesce(p.display_name,'尚未建立會員資料') display_name,p.role,
 u.created_at,u.email_confirmed_at,u.last_sign_in_at,
 (select max(a.last_seen_at) from rise_private.member_activity a where a.user_id=u.id) last_active_at
 from auth.users u left join public.rise_profiles p on p.id=u.id
 where (p_role='all' or p.role=p_role or (p_role='missing' and p.id is null))
 and (coalesce(p_search,'')='' or strpos(lower(coalesce(u.email,'')),lower(p_search))>0 or strpos(lower(coalesce(p.display_name,'')),lower(p_search))>0)
 ), paged as (select * from matched order by created_at desc,id limit 25 offset greatest(0,least(coalesce(p_offset,0),1000000)))
 select jsonb_build_object('total',(select count(*) from matched),'items',coalesce((select jsonb_agg(to_jsonb(paged) order by created_at desc,id) from paged),'[]'::jsonb)) into result;
 return result;
end;$$;

create or replace function public.rise_admin_statistics() returns jsonb
language plpgsql security definer set search_path='' as $$
declare today date:=(now() at time zone 'Asia/Taipei')::date; result jsonb;
begin
 if not rise_private.console_admin() then raise exception 'rise:僅限已驗證的管理員使用。' using errcode='42501';end if;
 select jsonb_build_object(
 'total',(select count(*) from auth.users),
 'verified',(select count(*) from auth.users where email_confirmed_at is not null),
 'new_7',(select count(*) from auth.users where (created_at at time zone 'Asia/Taipei')::date>=today-6),
 'active_today',(select count(distinct user_id) from rise_private.member_activity where activity_date=today),
 'active_7',(select count(distinct user_id) from rise_private.member_activity where activity_date>=today-6),
 'active_30',(select count(distinct user_id) from rise_private.member_activity where activity_date>=today-29),
 'started_at',(select started_at from rise_private.admin_console_settings where id),
 'roles',(select coalesce(jsonb_object_agg(role,n),'{}'::jsonb) from (select coalesce(p.role,'missing') role,count(*) n from auth.users u left join public.rise_profiles p on p.id=u.id group by p.role) r),
 'daily',(select jsonb_agg(jsonb_build_object('date',d,'active',(select count(*) from rise_private.member_activity where activity_date=d),'registrations',(select count(*) from auth.users where (created_at at time zone 'Asia/Taipei')::date=d)) order by d) from (select today-i d from generate_series(0,29) i) days)
 ) into result;
 return result;
end;$$;

create or replace function public.rise_admin_set_role(p_user_id uuid,p_role text,p_expected_role text) returns void
language plpgsql security definer set search_path='' as $$
declare previous text;
begin
 -- 管理員角色修改序列化，避免同時移除所有管理員。
 perform pg_advisory_xact_lock(723461092);
 if not rise_private.console_admin() then raise exception 'rise:僅限已驗證的管理員使用。' using errcode='42501';end if;
 if p_user_id=auth.uid() then raise exception 'rise:不能在此修改自己的角色。';end if;
 if p_role is null or p_role not in ('student','ta','teacher','admin') then raise exception 'rise:角色不正確。';end if;
 select role into previous from public.rise_profiles where id=p_user_id for update;
 if not found then raise exception 'rise:找不到會員資料，請先在後端補齊。';end if;
 if previous is distinct from p_expected_role then raise exception 'rise:角色已變更，請重新整理。';end if;
 if previous=p_role then return;end if;
 if p_role<>'student' and not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null) then raise exception 'rise:會員須先完成信箱驗證。';end if;
 if previous='admin' and p_role<>'admin' and (select count(*) from public.rise_profiles where role='admin')<=1 then raise exception 'rise:必須保留至少一位管理員。';end if;
 update public.rise_profiles set role=p_role where id=p_user_id;
 insert into rise_private.member_role_events(actor_id,target_id,old_role,new_role) values(auth.uid(),p_user_id,previous,p_role);
end;$$;

create or replace function public.rise_admin_update_member(p_user_id uuid,p_display_name text,p_expected_name text) returns void
language plpgsql security definer set search_path='' as $$
declare previous_name text;
begin
 if not rise_private.console_admin() then raise exception 'rise:僅限已驗證的管理員使用。' using errcode='42501';end if;
 if p_user_id is null or char_length(trim(coalesce(p_display_name,''))) not between 1 and 80 then raise exception 'rise:姓名需為1至80字。';end if;
 select display_name into previous_name from public.rise_profiles where id=p_user_id for update;
 if not found then raise exception 'rise:找不到會員資料，請先在後端補齊。';end if;
 if previous_name is distinct from p_expected_name then raise exception 'rise:姓名已被其他人更新，請重新整理。';end if;
 update public.rise_profiles set display_name=trim(p_display_name) where id=p_user_id;
end;$$;

create or replace function public.rise_admin_delete_member(p_user_id uuid,p_expected_role text) returns void
language plpgsql security definer set search_path='' as $$
declare previous_role text;
begin
 perform pg_advisory_xact_lock(723461092);
 if not rise_private.console_admin() then raise exception 'rise:僅限已驗證的管理員使用。' using errcode='42501';end if;
 if p_user_id is null or p_user_id=auth.uid() then raise exception 'rise:不能刪除目前登入的管理員帳號。';end if;
 select role into previous_role from public.rise_profiles where id=p_user_id for update;
 if not found then raise exception 'rise:找不到會員資料，請先在後端補齊。';end if;
 if previous_role is distinct from p_expected_role then raise exception 'rise:會員資料已變更，請重新整理。';end if;
 if previous_role='admin' and (select count(*) from public.rise_profiles where role='admin')<=1 then raise exception 'rise:必須保留至少一位管理員。';end if;
 -- Never delete Storage metadata directly: remove actual files through the Storage API first.
 if exists(select 1 from storage.objects o where split_part(o.name,'/',1)=p_user_id::text or coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner')=p_user_id::text) then
  raise exception 'rise:此會員仍有附件。請管理員先透過 Storage API 清理實體檔案，再刪除帳號。';end if;
 delete from auth.users where id=p_user_id;
end;$$;

revoke all on function public.rise_record_activity() from public,anon;
revoke all on function public.rise_admin_members(text,text,integer) from public,anon;
revoke all on function public.rise_admin_statistics() from public,anon;
revoke all on function public.rise_admin_set_role(uuid,text,text) from public,anon;
revoke all on function public.rise_admin_update_member(uuid,text,text) from public,anon;
revoke all on function public.rise_admin_delete_member(uuid,text) from public,anon;
grant execute on function public.rise_record_activity() to authenticated;
grant execute on function public.rise_admin_members(text,text,integer) to authenticated;
grant execute on function public.rise_admin_statistics() to authenticated;
grant execute on function public.rise_admin_set_role(uuid,text,text) to authenticated;
grant execute on function public.rise_admin_update_member(uuid,text,text) to authenticated;
grant execute on function public.rise_admin_delete_member(uuid,text) to authenticated;
notify pgrst,'reload schema';

commit;
